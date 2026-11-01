import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
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
 */

describe('PostgreSQL 16: dosya kotası yarışı', { skip: PG_SKIP }, () => {
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
})
