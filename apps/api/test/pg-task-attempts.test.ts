import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { taskAttempts } from '../src/db/schema/skills.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { createPgDatabase, PG_SKIP } from './support/pg.ts'
import { seedResource } from './support/resources-sample.ts'

/**
 * PostgreSQL 16: görev denemesinin eşzamanlı başlatılması ve teslimi (DOM-BEC-042, 043; ADR 0004
 * karar 6). Yazmalar kurum kilidi altında sıralanır: hak 1 iken aynı anda iki başlatma tek deneme
 * açar, aynı sürümle iki teslimden yalnız biri yazılır. PGlite tek bağlantılı olduğundan gerçek
 * eşzamanlılık yalnız burada sınanır.
 */

describe('PostgreSQL 16: eşzamanlı görev denemesi', { skip: PG_SKIP }, () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createPgDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(url: string, cookie: string, payload: unknown, headers: Record<string, string>) {
    return app.inject({
      method: 'POST',
      url: `/api/v1${url}`,
      headers: { origin: TEST_ORIGIN, cookie, 'content-type': 'application/json', ...headers },
      payload: JSON.stringify(payload),
    })
  }
  const key = () => ({ 'idempotency-key': randomUUID() })

  /** Deniz (`s-1`) 9-A'da; yönetici tek soruluk değerlendirmeyi (hak 1) 9-A'ya atar. */
  async function setup() {
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
      versions: [
        {
          status: 'published',
          input: {
            title: 'Okuma sorusu',
            content: {
              type: 'question',
              question: {
                questionType: 'multiple_choice',
                stem: 'Where does Ann live?',
                options: [
                  { id: 'a', text: 'In Izmir.' },
                  { id: 'b', text: 'In Bursa.' },
                  { id: 'c', text: 'In Van.' },
                  { id: 'd', text: 'In Rize.' },
                ],
              },
            },
            answerKey: {
              questionType: 'multiple_choice',
              correctOptionId: 'a',
              explanation: 'Metnin ilk cümlesi.',
            },
            license: { kind: 'institution_original' },
            tags: { gradeLevels: [9], primarySkill: 'reading', cefrLevel: 'A2' },
          },
        },
      ],
    })
    const created = await call(
      '/task-assignments',
      admin,
      {
        resourceVersionId: versions[0]!.id,
        settings: { deadline: { dueAt: '2026-10-20T20:59:00.000Z' } },
        targets: [{ kind: 'class', id: '9-A' }],
      },
      key(),
    )
    assert.equal(created.statusCode, 201, created.body)
    return { institution, student, assignmentId: created.json().data.id as string }
  }

  const attemptRows = (institutionId: string) =>
    db
      .select({ id: taskAttempts.id, version: taskAttempts.version })
      .from(taskAttempts)
      .where(eq(taskAttempts.institutionId, institutionId))

  test('DOM-BEC-042: hak 1 iken eşzamanlı iki başlatma: biri 201, diğeri 409 attempt_in_progress; tek deneme satırı', async () => {
    const { institution, student, assignmentId } = await setup()
    const begin = () => call(`/task-assignments/${assignmentId}/attempts`, student, {}, key())
    const responses = await Promise.all([begin(), begin()])
    assert.deepEqual(responses.map((r) => r.statusCode).sort(), [201, 409])
    const loser = responses.find((r) => r.statusCode === 409)
    assert.equal(loser?.json().code, 'attempt_in_progress', loser?.body)
    assert.equal((await attemptRows(institution.id)).length, 1)
  })

  test('DOM-BEC-043: aynı sürümle eşzamanlı iki teslim: biri 200, diğeri 409; teslim ve denetim tek', async () => {
    const { institution, student, assignmentId } = await setup()
    const started = await call(`/task-assignments/${assignmentId}/attempts`, student, {}, key())
    assert.equal(started.statusCode, 201, started.body)
    const attemptId = started.json().data.id as string
    const send = (optionId: string) =>
      call(
        `/task-attempts/${attemptId}/submit`,
        student,
        {
          answers: {
            [started.json().data.questions[0].questionVersionId]: {
              questionType: 'multiple_choice',
              optionId,
            },
          },
        },
        { ...key(), 'if-match': '"1"' },
      )
    const responses = await Promise.all([send('a'), send('b')])
    assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409])
    const loser = responses.find((r) => r.statusCode === 409)
    assert.equal(loser?.json().code, 'version_conflict', loser?.body)
    const winner = responses.find((r) => r.statusCode === 200)?.json().data
    assert.deepEqual(await attemptRows(institution.id), [{ id: attemptId, version: 2 }])
    const [stored] = await db
      .select({ answers: taskAttempts.answers })
      .from(taskAttempts)
      .where(eq(taskAttempts.id, attemptId))
    assert.deepEqual(stored?.answers, winner.answers)
    const audits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, institution.id), eq(auditLog.action, 'task_attempt.submit')),
      )
    assert.equal(audits.length, 1)
  })
})
