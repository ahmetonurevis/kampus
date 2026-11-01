import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import {
  rubrics,
  rubricScores,
  scoreAppeals,
  rubricVersions,
  submissionDrafts,
  submissionVersions,
  taskSubmissions,
} from '../src/db/schema/skills.ts'
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
import { sampleRubricData } from './support/skills-sample.ts'

/**
 * PostgreSQL 16: yazma taslağının ve teslim sürümünün eşzamanlı yazılması (IST-047, DOM-BEC-040;
 * ADR 0004 karar 6). Yazmalar kurum kilidi altında sıralanır: aynı revizyonla iki taslak kaydından
 * biri 409 `draft_conflict` alır; sürüm sınırı 1 iken iki eşzamanlı teslimden yalnız biri yazılır;
 * aynı sürüme eşzamanlı iki öğretmen puanından yalnız biri yazılır (F4b3b1, DOM-BEC-021); aynı
 * sürüme öğrenci ve velinin eşzamanlı itirazından yalnız biri yazılır (F4b3b2a, DOM-BEC-025).
 * PGlite tek bağlantılı olduğundan gerçek eşzamanlılık yalnız burada sınanır.
 */

describe('PostgreSQL 16: eşzamanlı yazma taslağı, teslimi ve puanı', { skip: PG_SKIP }, () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  let now = FIXED_NOW

  before(async () => {
    ;({ db, close } = await createPgDatabase())
    app = await buildTestApp(db, { clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    cookie: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const key = () => ({ 'idempotency-key': randomUUID() })

  /** Deniz (`s-1`) 9-A'da; yönetici yazma görevini (en çok 1 sürüm) 9-A'ya atar. */
  async function setup(settings: Record<string, unknown> = {}) {
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
    const parent = await signInAs(
      app,
      await createMember(app, institution.id, 'veli', [{ kind: 'child', recordId: 's-1' }]),
    )
    const { versions } = await seedResource(db, institution.id, {
      ownerUserId: institution.admin.id,
      versions: [
        {
          status: 'published',
          input: {
            title: 'Hafta sonu yazısı',
            content: {
              type: 'homework_template',
              instructions: 'Hafta sonunu anlatan kısa bir metin yaz.',
              submissionKinds: ['text'],
              criteria: 'Zaman ifadeleri ve yazım.',
              rubricId: null,
            },
            license: { kind: 'institution_original' },
            tags: { gradeLevels: [9], primarySkill: 'writing', cefrLevel: 'A2' },
          },
        },
      ],
    })
    const rubricId = randomUUID()
    const rubricVersionId = randomUUID()
    const at = { createdAt: FIXED_NOW, updatedAt: FIXED_NOW }
    await db.insert(rubrics).values({
      institutionId: institution.id,
      id: rubricId,
      ownerUserId: institution.admin.id,
      ...at,
    })
    await db.insert(rubricVersions).values({
      institutionId: institution.id,
      id: rubricVersionId,
      rubricId,
      versionNumber: 1,
      status: 'published',
      ...sampleRubricData(),
      publishedAt: FIXED_NOW,
      ...at,
    })
    const created = await call(
      'POST',
      '/task-assignments',
      admin,
      {
        resourceVersionId: versions[0]!.id,
        settings: {
          deadline: { dueAt: '2026-10-20T20:59:00.000Z' },
          submission: { submissionKind: 'text', maxVersions: 1 },
          rubricVersionId,
          ...settings,
        },
        targets: [{ kind: 'class', id: '9-A' }],
      },
      key(),
    )
    assert.equal(created.statusCode, 201, created.body)
    return {
      institution,
      student,
      parent,
      admin,
      assignmentId: created.json().data.id as string,
    }
  }

  test('IST-047: aynı taslağa eşzamanlı iki kayıt: biri 200, diğeri 409 draft_conflict; eşzamanlı ilk kayıtta geride kalan 400; taslak kazananın metni', async () => {
    const { institution, student, assignmentId } = await setup()
    const save = (body: string, headers: Record<string, string> = {}) =>
      call('PATCH', `/task-assignments/${assignmentId}/draft`, student, { body }, headers)
    // Eşzamanlı iki ilk kayıt (başlıksız): tek satır açılır; geride kalan taslağı var bulur ve
    // başlıksız olduğu için 400 `if_match_required` alır.
    const firsts = await Promise.all([save('ilk a'), save('ilk b')])
    assert.deepEqual(firsts.map((r) => r.statusCode).sort(), [200, 400])
    assert.equal(firsts.find((r) => r.statusCode === 400)?.json().code, 'if_match_required')
    const responses = await Promise.all([
      save('ikinci a', { 'if-match': '"1"' }),
      save('ikinci b', { 'if-match': '"1"' }),
    ])
    assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409])
    const loser = responses.find((r) => r.statusCode === 409)
    assert.equal(loser?.json().code, 'draft_conflict', loser?.body)
    const winner = responses.find((r) => r.statusCode === 200)?.json().data
    assert.equal(winner.revision, 2)
    const rows = await db
      .select({ body: submissionDrafts.body, version: submissionDrafts.version })
      .from(submissionDrafts)
      .where(eq(submissionDrafts.institutionId, institution.id))
    assert.deepEqual(rows, [{ body: winner.body, version: 2 }])
  })

  test('DOM-BEC-040: sürüm sınırı 1 iken eşzamanlı iki teslim: biri 201, diğeri 422 version_limit_reached; tek teslim ve tek sürüm', async () => {
    const { institution, student, parent, assignmentId } = await setup()
    const send = (body: string) =>
      call(
        'POST',
        `/task-assignments/${assignmentId}/submissions`,
        student,
        { submissionKind: 'text', body },
        key(),
      )
    const responses = await Promise.all([send('Birinci metin.'), send('İkinci metin.')])
    assert.deepEqual(responses.map((r) => r.statusCode).sort(), [201, 422])
    const loser = responses.find((r) => r.statusCode === 422)
    assert.equal(loser?.json().code, 'version_limit_reached', loser?.body)
    const [submissions, versions] = await Promise.all([
      db.select().from(taskSubmissions).where(eq(taskSubmissions.institutionId, institution.id)),
      db
        .select()
        .from(submissionVersions)
        .where(eq(submissionVersions.institutionId, institution.id)),
    ])
    assert.equal(submissions.length, 1)
    assert.equal(versions.length, 1)
    // IST-051: kursiyer ve velinin atama özeti toplu sorgularla (PostgreSQL 16) aynı teslimi okur.
    for (const cookie of [student, parent]) {
      const listed = await call('GET', '/task-assignments', cookie)
      assert.equal(listed.statusCode, 200, listed.body)
      const [progress] = listed.json().data[0].progress
      assert.deepEqual(
        [progress.submissionId, progress.used, progress.remaining, progress.blockedBy],
        [submissions[0]!.id, 1, 0, 'limit'],
      )
    }
  })

  test('DOM-BEC-021: aynı teslim sürümüne eşzamanlı iki puan: biri 201, diğeri 409; tek puan satırı', async () => {
    const { institution, student, admin, assignmentId } = await setup()
    const submitted = await call(
      'POST',
      `/task-assignments/${assignmentId}/submissions`,
      student,
      { submissionKind: 'text', body: 'Birinci metin.' },
      key(),
    )
    assert.equal(submitted.statusCode, 201, submitted.body)
    const submissionId = submitted.json().data.id as string
    const score = (band: number) =>
      call(
        'POST',
        `/task-submissions/${submissionId}/scores`,
        admin,
        {
          versionNumber: 1,
          criteria: [
            { criterionId: 'task', band, comment: null },
            { criterionId: 'grammar', band, comment: null },
          ],
          overallComment: 'Genel yorum yazıldı.',
        },
        { ...key(), 'if-match': '"1"' },
      )
    const responses = await Promise.all([score(3), score(4)])
    assert.deepEqual(responses.map((r) => r.statusCode).sort(), [201, 409])
    const loser = responses.find((r) => r.statusCode === 409)
    assert.ok(['version_conflict', 'rubric_score_exists'].includes(loser?.json().code), loser?.body)
    const rows = await db
      .select({ criteria: rubricScores.criteria })
      .from(rubricScores)
      .where(eq(rubricScores.institutionId, institution.id))
    assert.equal(rows.length, 1)
    const winner = responses.find((r) => r.statusCode === 201)?.json().data
    assert.equal(rows[0]?.criteria[0]?.band, winner.versions[0].score.criteria[0].band)
  })

  test('DOM-BEC-025: aynı sürüme öğrenci ve veliden eşzamanlı iki itiraz: biri 201, diğeri 409 appeal_exists; tek itiraz satırı', async () => {
    const { institution, student, parent, admin, assignmentId } = await setup()
    const submitted = await call(
      'POST',
      `/task-assignments/${assignmentId}/submissions`,
      student,
      { submissionKind: 'text', body: 'Birinci metin.' },
      key(),
    )
    assert.equal(submitted.statusCode, 201, submitted.body)
    const submissionId = submitted.json().data.id as string
    const scored = await call(
      'POST',
      `/task-submissions/${submissionId}/scores`,
      admin,
      {
        versionNumber: 1,
        criteria: [
          { criterionId: 'task', band: 3, comment: null },
          { criterionId: 'grammar', band: 3, comment: null },
        ],
        overallComment: 'Genel yorum yazıldı.',
      },
      { ...key(), 'if-match': '"1"' },
    )
    assert.equal(scored.statusCode, 201, scored.body)
    const file = (cookie: string, reason: string) =>
      call(
        'POST',
        `/task-submissions/${submissionId}/appeals`,
        cookie,
        { versionNumber: 1, reason },
        key(),
      )
    const responses = await Promise.all([
      file(student, 'Öğrencinin itiraz gerekçesi.'),
      file(parent, 'Velinin itiraz gerekçesi yazıldı.'),
    ])
    assert.deepEqual(responses.map((r) => r.statusCode).sort(), [201, 409])
    assert.equal(responses.find((r) => r.statusCode === 409)?.json().code, 'appeal_exists')
    const rows = await db
      .select({ reason: scoreAppeals.reason })
      .from(scoreAppeals)
      .where(eq(scoreAppeals.institutionId, institution.id))
    assert.equal(rows.length, 1)
    const winner = responses.find((r) => r.statusCode === 201)?.json().data
    assert.equal(rows[0]?.reason, winner.versions[0].appeal.reason)
  })

  /** Puanlama kuyruğu (yönetici veya öğretmen). */
  async function gradingQueue(cookie: string, extra = '') {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/task-submissions/grading-queue?page=1&pageSize=20${extra}`,
      headers: { origin: TEST_ORIGIN, cookie },
    })
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: { id: string; grading: Record<string, unknown> }[] }
  }
  const DAY = 24 * 3_600_000
  const DUE = '2026-10-20T20:59:00.000Z'

  test('DOM-BEC-024, DOM-BEC-025: kuyruk SQL’i PostgreSQL 16’da: uyuşmazlıklı teslim kuyrukta kalır (jsonb bant farkı); örneklem seçilmemiş görevin süresi yok, gecikme süzgecinde gecikmemiş sayılır', async () => {
    const { institution, student, admin, assignmentId } = await setup()
    await insertMissingRecords(
      db,
      institution.id,
      [
        {
          collection: 'teachers',
          id: 't-eng',
          data: { id: 't-eng', name: 'Selin Kaya', subjectId: 'ingilizce', branchId: 'b-1' },
        },
      ],
      FIXED_NOW,
    )
    const teacher = await signInAs(
      app,
      await createMember(app, institution.id, 'ogretmen', [{ kind: 'teacher', recordId: 't-eng' }]),
    )
    const submitted = await call(
      'POST',
      `/task-assignments/${assignmentId}/submissions`,
      student,
      { submissionKind: 'text', body: 'Birinci metin.' },
      key(),
    )
    assert.equal(submitted.statusCode, 201, submitted.body)
    const submissionId = submitted.json().data.id as string
    const write = async (path: string, cookie: string, version: number, body: unknown) => {
      const response = await call(
        'POST',
        `/task-submissions/${submissionId}/${path}`,
        cookie,
        body,
        {
          ...key(),
          'if-match': `"${version}"`,
        },
      )
      assert.equal(response.statusCode, 201, response.body)
    }
    const scoreBody = (task: number) => ({
      versionNumber: 1,
      criteria: [
        { criterionId: 'task', band: task, comment: 'Görev kısmen karşılandı.' },
        { criterionId: 'grammar', band: 3, comment: null },
      ],
      overallComment: 'Genel yorum yazıldı.',
    })
    await write('second-rating-requests', admin, 1, { versionNumber: 1 })
    await write('scores', admin, 2, scoreBody(4))
    await write('second-scores', teacher, 3, scoreBody(2))
    for (const cookie of [admin, teacher]) {
      const { data } = await gradingQueue(cookie)
      assert.deepEqual(
        data.map((row) => [row.id, row.grading.awaiting, row.grading.awaitingResolution]),
        [[submissionId, [], true]],
      )
    }
    assert.equal((await gradingQueue(admin, '&awaiting=second')).data.length, 0)
    now = new Date(Date.parse(DUE) + 7 * DAY + 1)
    assert.deepEqual(
      (await gradingQueue(admin, '&overdue=true')).data.map((row) => row.id),
      [submissionId],
    )

    // Örneklem seçilmemiş görev: süre işlemez, gecikmemiş süzgecinde kalır.
    const sampled = await setup({ highStakes: true })
    const pending = await call(
      'POST',
      `/task-assignments/${sampled.assignmentId}/submissions`,
      sampled.student,
      { submissionKind: 'text', body: 'Birinci metin.' },
      key(),
    )
    assert.equal(pending.statusCode, 201, pending.body)
    now = new Date(Date.parse(DUE) + 30 * DAY)
    assert.equal((await gradingQueue(sampled.admin, '&overdue=true')).data.length, 0)
    const [row] = (await gradingQueue(sampled.admin, '&overdue=false')).data
    assert.deepEqual(
      [row?.grading.samplePending, row?.grading.dueAt, row?.grading.overdue],
      [true, null, false],
    )
  })
})
