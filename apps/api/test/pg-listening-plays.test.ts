import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { files } from '../src/db/schema/files.ts'
import { resourceVersionFiles } from '../src/db/schema/resources.ts'
import { attemptMediaPlays, taskAssignments } from '../src/db/schema/skills.ts'
import { listeningWindowMs, RESOURCE_VERSION_ATTACHMENT } from '../src/services/listening-plays.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { tempStorage } from './support/files-sample.ts'
import { createPgDatabase, PG_SKIP } from './support/pg.ts'
import { seedResource } from './support/resources-sample.ts'

/**
 * Altyapı birimi, PostgreSQL 16: dinleme hakkının eşzamanlı sayımı (OG-049; IST-045, DOM-BEC-005).
 * Deneme satırı `for update` ile kilitlenir; aynı anda gelen bağlantı isteklerinden yalnız biri
 * sayar, ötekiler yeniden bağlantı penceresinde sayılmadan bağlantı alır. PGlite tek bağlantılı
 * olduğundan gerçek eşzamanlılık yalnız burada sınanır. Gerçek akışı iddia etmez: dosya soru
 * sürümüne elle bağlanır (okuma kuralı kaynağınkidir, sürüm 9-A'ya paylaşılır) ve atamanın hakkı veritabanında verilir (API dolu
 * hakkı 422 ile reddeder; `TODO(dinleme-icerik-bagi)`, ayrıntı `listening-plays.test.ts`).
 */

const WINDOW = listeningWindowMs(null)

describe('PostgreSQL 16: eşzamanlı dinleme sayımı', { skip: PG_SKIP }, () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let now = FIXED_NOW

  before(async () => {
    ;({ db, close } = await createPgDatabase())
    store = await tempStorage()
    app = await buildTestApp(db, { storage: store.storage, clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
    await store.remove()
  })

  function call(method: 'GET' | 'POST', url: string, cookie: string, payload?: unknown) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        ...(payload === undefined
          ? {}
          : { 'content-type': 'application/json', 'idempotency-key': randomUUID() }),
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }

  /** Deniz (`s-1`) 9-A'da; yönetici dinleme sorusunu 9-A'ya atar, hak veritabanında verilir, Deniz başlatır. */
  async function setup(listeningPlays: 1 | 2) {
    now = FIXED_NOW
    const institution = await createInstitution(app)
    await insertMissingRecords(
      db,
      institution.id,
      [
        {
          collection: 'classes',
          id: '9-A',
          data: { id: '9-A', grade: 9, level: '9', branchId: 'b-1', teacherId: 't-eng' },
        },
        {
          collection: 'students',
          id: 's-1',
          data: { id: 's-1', name: 'Deniz Yılmaz', classId: '9-A', isActive: true },
        },
      ],
      FIXED_NOW,
    )
    const student = await signInAs(
      app,
      await createMember(app, institution.id, 'ogrenci', [{ kind: 'student', recordId: 's-1' }]),
    )
    const admin = await signInAs(app, institution.admin)
    const { versions } = await seedResource(db, institution.id, {
      ownerUserId: institution.admin.id,
      // Dosyanın okuma kuralı kaynağınkidir (DOM-KYN-006): 9-A'ya paylaşılan sürümü öğrenci okur.
      shareScope: 'classes',
      sharedClassIds: ['9-A'],
      versions: [
        {
          status: 'published',
          input: {
            title: 'Dinleme sorusu',
            content: {
              type: 'question',
              question: {
                questionType: 'multiple_choice',
                stem: 'What does Tom do on Sundays?',
                options: [
                  { id: 'a', text: 'He swims.' },
                  { id: 'b', text: 'He reads.' },
                  { id: 'c', text: 'He cooks.' },
                  { id: 'd', text: 'He sleeps.' },
                ],
              },
            },
            answerKey: {
              questionType: 'multiple_choice',
              correctOptionId: 'b',
              explanation: 'Pazar günleri okur.',
            },
            license: { kind: 'institution_original' },
            tags: { gradeLevels: [9], primarySkill: 'listening', cefrLevel: 'A2' },
          },
        },
      ],
    })
    const versionId = versions[0]!.id
    const fileId = randomUUID()
    await db.insert(files).values({
      institutionId: institution.id,
      id: fileId,
      purpose: 'listening_audio',
      status: 'ready',
      storageKey: `${institution.id}/listening_audio/2026/10/${fileId}`,
      contentType: 'audio/mpeg',
      byteSize: 2048,
      sha256: 'c'.repeat(64),
      uploadedByUserId: institution.admin.id,
      attachedType: RESOURCE_VERSION_ATTACHMENT,
      attachedId: versionId,
      attachedAt: FIXED_NOW,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    await db.insert(resourceVersionFiles).values({
      institutionId: institution.id,
      versionId,
      fileId,
      position: 0,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    const created = await call('POST', '/task-assignments', admin, {
      resourceVersionId: versionId,
      settings: { deadline: { dueAt: '2026-10-20T20:59:00.000Z' } },
      targets: [{ kind: 'class', id: '9-A' }],
    })
    assert.equal(created.statusCode, 201, created.body)
    await db
      .update(taskAssignments)
      .set({ listeningPlays })
      .where(eq(taskAssignments.id, created.json().data.id as string))
    const started = await call(
      'POST',
      `/task-assignments/${created.json().data.id}/attempts`,
      student,
      {},
    )
    assert.equal(started.statusCode, 201, started.body)
    return { institution, student, fileId }
  }

  const playRows = (institutionId: string) =>
    db
      .select({ playNumber: attemptMediaPlays.playNumber })
      .from(attemptMediaPlays)
      .where(eq(attemptMediaPlays.institutionId, institutionId))

  test('IST-045: hak 1 iken eşzamanlı beş bağlantı isteği: hepsi 200, biri sayar, tek satır; pencere sonrası hepsi 422', async () => {
    const { institution, student, fileId } = await setup(1)
    const request = () => call('GET', `/files/${fileId}/url`, student)
    const responses = await Promise.all(Array.from({ length: 5 }, request))
    for (const response of responses) assert.equal(response.statusCode, 200, response.body)
    const counted = responses.filter((response) => response.json().data.listening.counted)
    assert.equal(counted.length, 1)
    assert.equal((await playRows(institution.id)).length, 1)

    now = new Date(FIXED_NOW.getTime() + WINDOW)
    const late = await Promise.all([request(), request()])
    for (const response of late) {
      assert.equal(response.statusCode, 422, response.body)
      assert.equal(response.json().code, 'listening_plays_exhausted')
    }
    assert.equal((await playRows(institution.id)).length, 1)
  })

  test('IST-045: hak 2 iken pencere dışında eşzamanlı iki istek ikinci hakkı bir kez tüketir', async () => {
    const { institution, student, fileId } = await setup(2)
    const request = () => call('GET', `/files/${fileId}/url`, student)
    assert.equal((await request()).statusCode, 200)
    now = new Date(FIXED_NOW.getTime() + WINDOW)
    const responses = await Promise.all([request(), request()])
    for (const response of responses) assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(
      responses.map((response) => response.json().data.listening.used),
      [2, 2],
    )
    assert.deepEqual((await playRows(institution.id)).map((row) => row.playNumber).sort(), [1, 2])
  })
})
