import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql, type SQL } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertFile } from '../src/db/files.ts'
import { files } from '../src/db/schema/files.ts'
import { institutionSettings } from '../src/db/schema/institution-settings.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { multipart, PDF, tempStorage, uploadParts } from './support/files-sample.ts'
import { createPgDatabase, PG_SKIP } from './support/pg.ts'

/**
 * PostgreSQL 16: kurum kotası yarışı (ADR 0003 karar 3; DOM-KYN-004). İki yükleme aynı anda
 * kotanın son boşluğuna yazmaya çalışır; kota denetimi ve satır yazımı kurum kilidi altında
 * olduğu için yalnız biri sığar, öteki 422 `storage_quota_exceeded` alır ve nesnesi silinir.
 * Ayrıca dosya içerik tetikleyicisinin (migration 0015, 0033) gerçek PostgreSQL'deki davranışı.
 */

describe('PostgreSQL 16: dosya kotası yarışı ve içerik tetikleyicisi', { skip: PG_SKIP }, () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>

  before(async () => {
    ;({ db, close } = await createPgDatabase())
    store = await tempStorage()
    app = await buildTestApp(db, { storage: store.storage })
  })
  after(async () => {
    await app.close()
    await close()
    await store.remove()
  })

  test('DOM-KYN-004 eşzamanlı iki yüklemeden kotayı aşan reddedilir, nesnesi kalmaz', async () => {
    const institution = await createInstitution(app)
    await db
      .update(institutionSettings)
      .set({ storageQuotaBytes: PDF.length + 10 })
      .where(eq(institutionSettings.institutionId, institution.id))
    const students = await Promise.all([
      createMember(app, institution.id, 'ogrenci'),
      createMember(app, institution.id, 'ogrenci'),
    ])
    const cookies = await Promise.all(students.map((student) => signInAs(app, student)))
    const responses = await Promise.all(
      cookies.map((cookie, index) => {
        const body = multipart(uploadParts('submission', PDF))
        return app.inject({
          method: 'POST',
          url: '/api/v1/files',
          headers: {
            origin: TEST_ORIGIN,
            cookie,
            'content-type': body.contentType,
            'idempotency-key': `test-quota-race-${index}-0001`,
          },
          payload: body.payload,
        })
      }),
    )
    const statuses = responses.map((response) => response.statusCode).sort()
    assert.deepEqual(statuses, [201, 422])
    const rejected = responses.find((response) => response.statusCode === 422)
    assert.equal(rejected?.json().code, 'storage_quota_exceeded')
    const rows = await db.select().from(files).where(eq(files.institutionId, institution.id))
    assert.equal(rows.length, 1)
    const stored = (await store.files()).filter((path) => path.includes(institution.id))
    assert.equal(stored.length, 1)
  })

  test("migration 0033, OG-262: ready ses dosyası processing'e döndürülüp içeriği değiştirilemez (iki adımlı delme); içerik yalnız ses amacında processing → ready geçişinde değişir", async () => {
    const institution = await createInstitution(app)
    const now = new Date()
    const insert = (purpose: 'listening_audio' | 'document') => {
      const id = randomUUID()
      return db.transaction((tx) =>
        insertFile(
          tx,
          institution.id,
          {
            id,
            purpose,
            storageKey: `${institution.id}/${purpose}/2026/10/${id}`,
            contentType: purpose === 'document' ? 'application/pdf' : 'audio/mpeg',
            byteSize: 10,
            sha256: 'a'.repeat(64),
            originalName: null,
            uploadedByUserId: institution.admin.id,
          },
          now,
          'processing',
        ),
      )
    }
    const update = (id: string, set: SQL) =>
      db.execute(
        sql`update files set ${set} where institution_id = ${institution.id} and id = ${id}`,
      )
    const immutable = (error: unknown) => {
      const cause: unknown = error instanceof Error ? error.cause : null
      return (
        (cause instanceof Error && Reflect.get(cause, 'code') === '55000') ||
        Reflect.get(error as object, 'code') === '55000'
      )
    }
    const rowOf = async (id: string) =>
      (
        await db
          .select()
          .from(files)
          .where(and(eq(files.institutionId, institution.id), eq(files.id, id)))
      )[0]

    const audio = await insert('listening_audio')
    // Dönüşümün tek geçişi: processing → ready, yeni nesnenin içeriğiyle.
    await update(
      audio.id,
      sql`status = 'ready', storage_key = ${`${audio.storageKey}-m4a`}, content_type = 'audio/mp4', byte_size = 20, sha256 = ${'b'.repeat(64)}`,
    )
    // Adım 1 reddedilir: ready → processing.
    await assert.rejects(update(audio.id, sql`status = 'processing'`), immutable)
    // Ara durumdan da processing'e dönülmez.
    await update(audio.id, sql`status = 'pending'`)
    await assert.rejects(update(audio.id, sql`status = 'processing'`), immutable)
    await update(audio.id, sql`status = 'ready'`)
    // Tek güncellemede dönüş ve içerik değişimi de reddedilir.
    await assert.rejects(
      update(audio.id, sql`status = 'processing', sha256 = ${'c'.repeat(64)}`),
      immutable,
    )
    const kept = await rowOf(audio.id)
    assert.equal(kept?.sha256, 'b'.repeat(64))
    assert.equal(kept?.storageKey, `${audio.storageKey}-m4a`)
    // Silinecek özgün anahtar yalnız dönüşüm geçişinde yazılır; sonra başka nesneye yöneltilemez.
    await assert.rejects(
      update(audio.id, sql`superseded_storage_key = ${`${institution.id}/baska`}`),
      immutable,
    )

    const rejected = await insert('listening_audio')
    await update(rejected.id, sql`status = 'rejected'`)
    await assert.rejects(update(rejected.id, sql`status = 'processing'`), immutable)

    // Ses dışı amaçta processing → ready içeriği değiştiremez.
    const document = await insert('document')
    await assert.rejects(
      update(document.id, sql`status = 'ready', sha256 = ${'d'.repeat(64)}`),
      immutable,
    )
    await update(document.id, sql`status = 'ready'`)
    assert.equal((await rowOf(document.id))?.sha256, 'a'.repeat(64))
  })
})
