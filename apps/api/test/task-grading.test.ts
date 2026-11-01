import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  resubmissionRequests,
  rubrics,
  rubricScores,
  rubricVersions,
  submissionVersions,
  taskSubmissions,
} from '../src/db/schema/skills.ts'
import { insertRubricScore, insertSecondRatingRequest } from '../src/db/skills.ts'
import { AppError } from '../src/errors.ts'
import type { ServiceContext } from '../src/plugins/authenticate.ts'
import { requestTaskResubmission, scoreTaskSubmission } from '../src/services/task-grading.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { seedResource } from './support/resources-sample.ts'
import { sampleRubricData } from './support/skills-sample.ts'

/**
 * Yazma tesliminin öğretmen puanlaması, yeniden teslim isteği ve puanlama kuyruğu (F4b3b1;
 * ADR 0004 karar 6; DOM-BEC-020…023, 040, 045; DOM-YTK-028). Kural core `skills/rubric.ts` ve
 * `skills/assignment.ts`'tedir; burada rol × kapsam, atayan olmayan ama atamayı gören öğretmen,
 * rubrik dışı/eksik kriter, istemci toplamının reddi, geri bildirimin açılması, yeniden teslimden
 * sonra yeni sürüm, aynı sürüme ikinci puan, başka kurum, modül kapalı ve log/denetimde metin
 * olmaması denetlenir.
 */

type Json = ReturnType<typeof JSON.parse>

const DUE = '2026-10-20T20:59:00.000Z'
const SECRET_TEXT = 'GIZLI-YAZI my weekend was very nice'
const FEEDBACK = 'GIZLI-GERI-BILDIRIM paragraf düzeni iyi'
const CRITERION_NOTE = 'GIZLI-KRITER zaman uyumuna dikkat'

const homework = (): Partial<ResourceVersionInput> => ({
  title: 'Hafta sonu yazısı',
  content: {
    type: 'homework_template',
    instructions: 'Hafta sonunu anlatan kısa bir metin yaz.',
    submissionKinds: ['text'],
    criteria: 'Zaman ifadeleri, paragraf düzeni ve yazım.',
    rubricId: null,
  },
  license: { kind: 'institution_original' },
  tags: { subjectId: 'ingilizce', gradeLevels: [9], primarySkill: 'writing', cefrLevel: 'A2' },
})

/** Geçerli puan gövdesi: `task` 4, `grammar` 2 (hedefin altı, yorumlu); toplam 6/10 → %60. */
const scoreBody = (extra: Record<string, unknown> = {}) => ({
  versionNumber: 1,
  criteria: [
    { criterionId: 'task', band: 4, comment: null },
    { criterionId: 'grammar', band: 2, comment: CRITERION_NOTE },
  ],
  overallComment: FEEDBACK,
  ...extra,
})

describe('yazma tesliminin öğretmen puanlaması', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let now = FIXED_NOW
  const logs: string[] = []

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { logs, clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
  })

  /**
   * `t-eng` 9-A'nın öğretmenidir, `t-mat` 9-B'nin. Deniz (`s-1`) 9-A'da. Atamayı yönetici yapar:
   * `t-eng` atayan değildir ama 9-A hedefi yüzünden atamayı görür (DOM-YTK-028).
   */
  async function tenant() {
    now = FIXED_NOW
    const institution = await createInstitution(app)
    await insertMissingRecords(
      db,
      institution.id,
      [
        {
          collection: 'teachers',
          id: 't-eng',
          data: { id: 't-eng', name: 'Selin Kaya', subjectId: 'ingilizce', branchId: 'b-1' },
        },
        {
          collection: 'teachers',
          id: 't-mat',
          data: { id: 't-mat', name: 'Murat Demir', subjectId: 'matematik', branchId: 'b-1' },
        },
        ...['9-A', '9-B'].map((id, index) => ({
          collection: 'classes' as const,
          id,
          data: { id, grade: 9, level: '9', branchId: 'b-1', teacherId: ['t-eng', 't-mat'][index] },
        })),
        ...[
          ['s-1', 'Deniz Yılmaz', '9-A'],
          ['s-3', 'Can Arslan', '9-B'],
        ].map(([id, name, classId]) => ({
          collection: 'students' as const,
          id: id!,
          data: { id, name, classId, isActive: true },
        })),
        {
          collection: 'assignments',
          id: 'as-1',
          data: { id: 'as-1', classId: '9-A', teacherId: 't-eng', subjectId: 'ingilizce' },
        },
        {
          collection: 'assignments',
          id: 'as-2',
          data: { id: 'as-2', classId: '9-B', teacherId: 't-mat', subjectId: 'matematik' },
        },
      ],
      FIXED_NOW,
    )
    const member = (role: 'ogretmen' | 'ogrenci' | 'veli', kind: string, recordId: string) =>
      createMember(app, institution.id, role, [{ kind, recordId } as never])
    const teacher = await member('ogretmen', 'teacher', 't-eng')
    const parent = await member('veli', 'child', 's-1')
    const cookies = {
      admin: await signInAs(app, institution.admin),
      teacher: await signInAs(app, teacher),
      otherTeacher: await signInAs(app, await member('ogretmen', 'teacher', 't-mat')),
      student: await signInAs(app, await member('ogrenci', 'student', 's-1')),
      parent: await signInAs(app, parent),
      frontDesk: await signInAs(app, await createMember(app, institution.id, 'onburo')),
    }
    const homeworkId = (
      await seedResource(db, institution.id, {
        ownerUserId: teacher.id,
        versions: [{ status: 'published', input: homework() }],
      })
    ).versions[0]!.id
    const rubricId = randomUUID()
    const rubricVersionId = randomUUID()
    const at = { createdAt: FIXED_NOW, updatedAt: FIXED_NOW }
    await db
      .insert(rubrics)
      .values({ institutionId: institution.id, id: rubricId, ownerUserId: teacher.id, ...at })
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
    return { institution, teacher, parent, cookies, homeworkId, rubricVersionId }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  function call(
    method: 'GET' | 'POST',
    url: string,
    cookie?: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie ? { cookie } : {}),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const key = () => ({ 'idempotency-key': randomUUID() })
  const match = (value: number) => ({ 'if-match': `"${value}"` })

  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function fails(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code, response.body)
  }

  /** Yönetici 9-A'ya rubrikli yazma görevi atar; öğrenci teslim eder. */
  async function submitted(t: Tenant, settings: Record<string, unknown> = {}) {
    const assignment = await ok(
      await call(
        'POST',
        '/task-assignments',
        t.cookies.admin,
        {
          resourceVersionId: t.homeworkId,
          settings: {
            deadline: { dueAt: DUE },
            submission: { submissionKind: 'text', maxVersions: 1 },
            rubricVersionId: t.rubricVersionId,
            ...settings,
          },
          targets: [{ kind: 'class', id: '9-A' }],
        },
        key(),
      ),
      201,
    )
    const submission = await ok(await resubmit(assignment.id), 201)
    return { assignmentId: assignment.id as string, submission }
  }
  const resubmit = (assignmentId: string, body = SECRET_TEXT) =>
    call(
      'POST',
      `/task-assignments/${assignmentId}/submissions`,
      cookieOf.student,
      { submissionKind: 'text', body },
      key(),
    )
  // `resubmit` kiracıdan bağımsız çağrılsın diye son kiracının öğrenci çerezi.
  const cookieOf = { student: '' }

  const score = (
    submissionId: string,
    cookie: string,
    version: number,
    body: unknown = scoreBody(),
    headers: Record<string, string> = key(),
  ) =>
    call('POST', `/task-submissions/${submissionId}/scores`, cookie, body, {
      ...match(version),
      ...headers,
    })
  const requestResubmission = (
    submissionId: string,
    cookie: string,
    version: number,
    body: unknown,
  ) =>
    call('POST', `/task-submissions/${submissionId}/resubmission-requests`, cookie, body, {
      ...match(version),
      ...key(),
    })
  const detail = (submissionId: string, cookie: string) =>
    call('GET', `/task-submissions/${submissionId}`, cookie)
  const queue = (cookie: string, extra = '') =>
    call('GET', `/task-submissions/grading-queue?page=1&pageSize=20${extra}`, cookie)

  async function storedRows(institutionId: string) {
    const [scores, requests, submissions] = await Promise.all([
      db.select().from(rubricScores).where(eq(rubricScores.institutionId, institutionId)),
      db
        .select()
        .from(resubmissionRequests)
        .where(eq(resubmissionRequests.institutionId, institutionId)),
      db
        .select({ id: taskSubmissions.id, version: taskSubmissions.version })
        .from(taskSubmissions)
        .where(eq(taskSubmissions.institutionId, institutionId)),
    ])
    return { scores: scores.length, requests: requests.length, submissions }
  }

  async function setup(settings: Record<string, unknown> = {}) {
    const t = await tenant()
    cookieOf.student = t.cookies.student
    return { t, ...(await submitted(t, settings)) }
  }

  test('DOM-YTK-028: 401; öğrenci, veli ve ön büro 403; atamayı görmeyen öğretmen ve başka kurum 404; anahtarsız 400, If-Match yoksa 400, eski sürüm 409; modül kapalıyken 403; kayıt değişmez', async () => {
    const { t, submission } = await setup()
    const id = submission.id as string
    fails(await score(id, '', 1), 401, 'unauthenticated')
    fails(await queue(''), 401, 'unauthenticated')
    for (const cookie of [t.cookies.student, t.cookies.parent, t.cookies.frontDesk]) {
      fails(await score(id, cookie, 1), 403, 'forbidden')
      fails(
        await requestResubmission(id, cookie, 1, { versionNumber: 1, dueAt: DUE }),
        403,
        'forbidden',
      )
      fails(await queue(cookie), 403, 'forbidden')
    }
    fails(await score(id, t.cookies.otherTeacher, 1), 404, 'not_found')
    fails(
      await requestResubmission(id, t.cookies.otherTeacher, 1, { versionNumber: 1, dueAt: DUE }),
      404,
      'not_found',
    )
    fails(
      await call('POST', `/task-submissions/${id}/scores`, t.cookies.teacher, scoreBody(), key()),
      400,
      'if_match_required',
    )
    fails(
      await call('POST', `/task-submissions/${id}/scores`, t.cookies.teacher, scoreBody(), {
        ...match(1),
      }),
      400,
      'idempotency_key_required',
    )
    fails(await score(id, t.cookies.teacher, 7), 409, 'version_conflict')

    const other = await createInstitution(app)
    const otherAdmin = await signInAs(app, other.admin)
    fails(await score(id, otherAdmin, 1), 404, 'not_found')
    fails(
      await requestResubmission(id, otherAdmin, 1, { versionNumber: 1, dueAt: DUE }),
      404,
      'not_found',
    )
    assert.deepEqual((await ok(await queue(otherAdmin))).length, 0)
    // Gövdedeki kurum kimliği etkisiz ve bilinmeyen alan olarak 400.
    fails(
      await score(id, t.cookies.teacher, 1, scoreBody({ institutionId: other.id })),
      400,
      'validation_failed',
    )
    assert.deepEqual(await storedRows(t.institution.id), {
      scores: 0,
      requests: 0,
      submissions: [{ id, version: 1 }],
    })

    const closed = await createInstitution(app, { enabledModules: { learning: false } })
    const admin = await signInAs(app, closed.admin)
    const unknown = '00000000-0000-4000-8000-000000000001'
    for (const response of await Promise.all([
      score(unknown, admin, 1),
      requestResubmission(unknown, admin, 1, { versionNumber: 1, dueAt: DUE }),
      queue(admin),
    ]))
      fails(response, 403, 'module_disabled')
  })

  test('DOM-BEC-021, DOM-BEC-022, DOM-YTK-028: atayan olmayan ama atamayı gören öğretmen puanlar; toplam sunucuda hesaplanır, rubrik sürümü atamanınki; istemci toplamı ve kriter satırındaki fazladan alan 400; aynı anahtar tekrarı ikinci puan yazmaz', async () => {
    const { t, submission } = await setup()
    const id = submission.id as string
    // İstemcinin toplamı, yüzdesi, rubrik sürümü ve puanlayıcı rolü kabul edilmez.
    for (const extra of [
      { total: 10 },
      { percent: 100 },
      { rubricVersionId: t.rubricVersionId },
      { raterRole: 'final' },
      // Kriter satırı da katıdır: istemcinin ağırlıklı puanı (`weighted`) 400 alır.
      {
        criteria: [
          { criterionId: 'task', band: 4, comment: null, weighted: 99 },
          { criterionId: 'grammar', band: 2, comment: CRITERION_NOTE },
        ],
      },
    ])
      fails(await score(id, t.cookies.teacher, 1, scoreBody(extra)), 400, 'validation_failed')
    assert.equal((await storedRows(t.institution.id)).scores, 0)

    const headers = key()
    // Puan kriter bantlarından sunucuda hesaplanır.
    const body = scoreBody({
      criteria: [
        { criterionId: 'task', band: 4, comment: null },
        { criterionId: 'grammar', band: 2, comment: CRITERION_NOTE },
      ],
    })
    const response = await score(id, t.cookies.teacher, 1, body, headers)
    const scored = await ok(response, 201)
    assert.equal(response.headers.location, `/api/v1/task-submissions/${id}`)
    assert.equal(scored.rowVersion, 2)
    const [version] = scored.versions
    assert.deepEqual(
      {
        settled: version.score.settled,
        rubricVersionId: version.score.rubricVersionId,
        total: version.score.total,
        max: version.score.max,
        percent: version.score.percent,
        overallComment: version.score.overallComment,
      },
      {
        settled: true,
        rubricVersionId: t.rubricVersionId,
        total: 6,
        max: 10,
        percent: 60,
        overallComment: FEEDBACK,
      },
    )
    assert.deepEqual(
      version.score.criteria.map((c: Json) => [c.criterionId, c.band, c.weighted, c.meaning]),
      [
        ['task', 4, 4, 'above'],
        ['grammar', 2, 2, 'below'],
      ],
    )
    assert.equal(version.score.criteria[1].comment, CRITERION_NOTE)
    assert.equal(scored.latestVersion.score.percent, 60)
    assert.equal(scored.allowance.blockedBy, 'graded')

    const replay = await score(id, t.cookies.teacher, 1, body, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    const [stored] = await db
      .select()
      .from(rubricScores)
      .where(eq(rubricScores.institutionId, t.institution.id))
    assert.equal((await storedRows(t.institution.id)).scores, 1)
    // Toplam saklanmaz; kriter satırındaki istemci alanı da saklanmaz.
    assert.equal('total' in (stored ?? {}), false)
    assert.deepEqual(stored?.criteria, [
      { criterionId: 'task', band: 4, comment: null },
      { criterionId: 'grammar', band: 2, comment: CRITERION_NOTE },
    ])
    assert.equal(stored?.rubricVersionId, t.rubricVersionId)
    assert.equal(stored?.raterRole, 'first')
    // Puan değişmez (tetikleyici).
    await assert.rejects(
      db
        .update(rubricScores)
        .set({ overallComment: 'değişti' })
        .where(eq(rubricScores.institutionId, t.institution.id)),
    )
  })

  test('DOM-BEC-021: rubrik dışı, tekrar eden veya eksik kriter ve yorumsuz düşük bant 422; geçersiz bant 400; bilinmeyen sürüm 404; kayıt değişmez', async () => {
    const { t, submission } = await setup()
    const id = submission.id as string
    const cases: [unknown, number, string][] = [
      [
        scoreBody({
          criteria: [
            { criterionId: 'task', band: 4, comment: null },
            { criterionId: 'style', band: 4, comment: null },
          ],
        }),
        422,
        'rubric_criterion_invalid',
      ],
      [
        scoreBody({
          criteria: [
            { criterionId: 'task', band: 4, comment: null },
            { criterionId: 'task', band: 3, comment: null },
          ],
        }),
        422,
        'rubric_criterion_invalid',
      ],
      [
        scoreBody({ criteria: [{ criterionId: 'task', band: 4, comment: null }] }),
        422,
        'rubric_criterion_missing',
      ],
      [
        scoreBody({
          criteria: [
            { criterionId: 'task', band: 4, comment: null },
            { criterionId: 'grammar', band: 1, comment: null },
          ],
        }),
        422,
        'criterion_comment_required',
      ],
      [
        scoreBody({
          criteria: [
            { criterionId: 'task', band: 6, comment: null },
            { criterionId: 'grammar', band: 3, comment: null },
          ],
        }),
        400,
        'validation_failed',
      ],
      [scoreBody({ overallComment: '' }), 400, 'validation_failed'],
      [scoreBody({ versionNumber: 4 }), 404, 'not_found'],
    ]
    for (const [body, status, code] of cases)
      fails(await score(id, t.cookies.teacher, 1, body), status, code)
    assert.deepEqual(await storedRows(t.institution.id), {
      scores: 0,
      requests: 0,
      submissions: [{ id, version: 1 }],
    })
  })

  test('DOM-BEC-021: aynı sürümün ikinci ilk puanı 409 rubric_score_exists (yönetici de); puan değişmez', async () => {
    const { t, submission } = await setup()
    const id = submission.id as string
    await ok(await score(id, t.cookies.teacher, 1), 201)
    fails(await score(id, t.cookies.admin, 2), 409, 'rubric_score_exists')
    fails(await score(id, t.cookies.teacher, 2), 409, 'rubric_score_exists')
    fails(await score(id, t.cookies.teacher, 1), 409, 'version_conflict')
    assert.deepEqual(await storedRows(t.institution.id), {
      scores: 1,
      requests: 0,
      submissions: [{ id, version: 2 }],
    })
  })

  test('DOM-BEC-045: geri bildirim açılmadan kursiyer ve veli puanı ve yorumu görmez; açılınca görür; personel kesinleşmemiş puanını görür', async () => {
    const { t, assignmentId, submission } = await setup()
    const id = submission.id as string
    // İkinci puanlama istendi: ilk puan verilse de puanlama sürer, geri bildirim kapalıdır.
    await insertSecondRatingRequest(
      db,
      t.institution.id,
      {
        submissionId: id,
        source: 'manual',
        requestedByUserId: t.institution.admin.id,
        requestedAt: now.toISOString(),
      },
      now,
    )
    const scored = await ok(await score(id, t.cookies.teacher, 1), 201)
    assert.equal(scored.versions[0].score.settled, false)
    assert.equal(scored.versions[0].score.overallComment, FEEDBACK)
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const response = await detail(id, cookie)
      const seen = await ok(response)
      assert.equal(seen.versions[0].score, null)
      assert.equal(seen.latestVersion.score, null)
      assert.equal(seen.allowance.blockedBy, 'locked')
      const listed = await call('GET', `/task-submissions?assignmentId=${assignmentId}`, cookie)
      for (const body of [response.body, listed.body])
        for (const text of [FEEDBACK, CRITERION_NOTE, 'percent":6', 'graded'])
          assert.ok(!body.includes(text), text)
      assert.equal((await ok(listed))[0].latestVersion.score, null)
    }
    // Yönetici de kesinleşmemiş puanı görür (personel).
    assert.equal((await ok(await detail(id, t.cookies.admin))).versions[0].score.settled, false)

    // İkinci puan uyuşur: puan kesinleşir, geri bildirim açılır.
    const [version] = scored.versions
    await insertRubricScore(
      db,
      t.institution.id,
      {
        id: randomUUID(),
        submissionVersionId: version.id,
        rubricVersionId: t.rubricVersionId,
        raterUserId: t.institution.admin.id,
        raterRole: 'second',
        criteria: [
          { criterionId: 'task', band: 4, comment: null },
          { criterionId: 'grammar', band: 3, comment: null },
        ],
        overallComment: 'İkinci puan',
        scoredAt: now.toISOString(),
      },
      now,
    )
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const seen = await ok(await detail(id, cookie))
      assert.equal(seen.versions[0].score.settled, true)
      assert.equal(seen.versions[0].score.percent, 60)
      assert.equal(seen.versions[0].score.overallComment, FEEDBACK)
      assert.equal(seen.versions[0].score.criteria[1].comment, CRITERION_NOTE)
      assert.equal(seen.latestVersion.score.percent, 60)
      assert.equal(seen.allowance.blockedBy, 'graded')
    }
  })

  test('DOM-BEC-040: yeniden teslim yalnız kesinleşmiş puandan sonra; istekten sonra öğrenci yeni sürüm gönderir, sürüm kuyruğa döner; ikinci istek 409, geçersiz tarih 422', async () => {
    const { t, assignmentId, submission } = await setup()
    const id = submission.id as string
    const dueAt = new Date(now.getTime() + 3 * 24 * 3_600_000).toISOString()
    fails(
      await requestResubmission(id, t.cookies.teacher, 1, { versionNumber: 1, dueAt }),
      409,
      'resubmission_not_graded',
    )
    fails(await resubmit(assignmentId), 422, 'version_limit_reached')
    await ok(await score(id, t.cookies.teacher, 1), 201)
    fails(await resubmit(assignmentId), 409, 'resubmission_not_requested')
    fails(
      await requestResubmission(id, t.cookies.teacher, 2, {
        versionNumber: 1,
        dueAt: new Date(now.getTime() + 20 * 24 * 3_600_000).toISOString(),
      }),
      422,
      'resubmission_due_invalid',
    )
    fails(
      await requestResubmission(id, t.cookies.teacher, 2, { versionNumber: 1, dueAt, extra: 1 }),
      400,
      'validation_failed',
    )
    assert.equal((await storedRows(t.institution.id)).requests, 0)

    const response = await requestResubmission(id, t.cookies.teacher, 2, {
      versionNumber: 1,
      dueAt,
    })
    const requested = await ok(response, 201)
    assert.equal(response.headers.location, `/api/v1/task-submissions/${id}`)
    assert.deepEqual(requested.resubmission, { versionNumber: 1, dueAt })
    assert.equal(requested.allowance.resubmissionOpen, true)
    assert.equal(requested.rowVersion, 3)
    fails(
      await requestResubmission(id, t.cookies.teacher, 3, { versionNumber: 1, dueAt }),
      409,
      'resubmission_exists',
    )
    const student = await ok(await detail(id, t.cookies.student))
    assert.deepEqual(student.resubmission, { versionNumber: 1, dueAt })
    assert.equal(student.allowance.canSubmit, true)

    // Yeni sürüm hakka sayılmaz (`maxVersions: 1`); puanlanmamış olarak kuyruğa döner.
    const next = await ok(await resubmit(assignmentId, 'Second version.'), 201)
    assert.equal(next.versionCount, 2)
    assert.equal(next.latestVersion.score, null)
    assert.deepEqual(
      (await ok(await queue(t.cookies.teacher))).map((row: Json) => [row.id, row.versionCount]),
      [[id, 2]],
    )
    // Eski sürüm artık puanlanmaz; yeni sürüm puanlanır.
    const stale = await score(id, t.cookies.teacher, next.rowVersion, scoreBody())
    fails(stale, 409, 'version_not_latest')
    await ok(
      await score(id, t.cookies.teacher, next.rowVersion, scoreBody({ versionNumber: 2 })),
      201,
    )
    assert.deepEqual(await ok(await queue(t.cookies.teacher)), [])
    const versions = await db
      .select({ number: submissionVersions.versionNumber })
      .from(submissionVersions)
      .where(eq(submissionVersions.institutionId, t.institution.id))
    assert.equal(versions.length, 2)
  })

  test('DOM-YTK-028: puanlama kuyruğu atamayı görenlere: öğretmen ve yönetici bekleyen teslimi görür, başka sınıfın öğretmeni görmez; puanlanınca düşer; atama süzgeci', async () => {
    const { t, assignmentId, submission } = await setup()
    const id = submission.id as string
    for (const cookie of [t.cookies.teacher, t.cookies.admin]) {
      const rows = await ok(await queue(cookie))
      assert.deepEqual(
        rows.map((row: Json) => [row.id, row.assignmentId, row.latestVersion.number]),
        [[id, assignmentId, 1]],
      )
      assert.equal('body' in rows[0].latestVersion, false)
      assert.equal(rows[0].latestVersion.score, null)
    }
    assert.deepEqual(await ok(await queue(t.cookies.otherTeacher)), [])
    assert.equal(
      (await ok(await queue(t.cookies.teacher, `&assignmentId=${assignmentId}`))).length,
      1,
    )
    assert.deepEqual(await ok(await queue(t.cookies.teacher, `&assignmentId=${randomUUID()}`)), [])
    fails(await queue(t.cookies.teacher, '&learnerId=s-1'), 400, 'validation_failed')
    await ok(await score(id, t.cookies.teacher, 1), 201)
    const response = await queue(t.cookies.admin)
    assert.deepEqual(await ok(response), [])
    assert.equal(response.json().meta.total, 0)
  })

  test('DOM-YTK-028: servis de yalnız personele puanlatır: veli çocuğunun teslimini puanlayamaz ve yeniden teslim isteyemez (403); kayıt değişmez', async () => {
    const { t, submission } = await setup()
    const ctx: ServiceContext = {
      db,
      institutionId: t.institution.id,
      actor: { userId: t.parent.id, role: 'veli', membershipId: t.parent.membershipId },
      now,
      log: app.log,
    }
    const forbidden = (error: unknown) =>
      error instanceof AppError && error.statusCode === 403 && error.code === 'forbidden'
    const before = await storedRows(t.institution.id)
    await assert.rejects(
      scoreTaskSubmission(
        ctx,
        {
          submissionId: submission.id,
          expectedVersion: 1,
          versionNumber: 1,
          score: scoreBody(),
        },
        null,
      ),
      forbidden,
    )
    await assert.rejects(
      requestTaskResubmission(
        ctx,
        {
          submissionId: submission.id,
          expectedVersion: 1,
          request: { versionNumber: 1, dueAt: DUE },
        },
        null,
      ),
      forbidden,
    )
    assert.deepEqual(await storedRows(t.institution.id), before)
  })

  test('DOM-BEC-021: log ve denetimde geri bildirim metni ve öğrenci kimliği yok; denetime yalnız alan adları', async () => {
    const { t, submission } = await setup()
    const id = submission.id as string
    const from = logs.length
    fails(await score(id, t.cookies.teacher, 1, scoreBody({ versionNumber: 3 })), 404, 'not_found')
    await ok(await score(id, t.cookies.teacher, 1), 201)
    await ok(
      await requestResubmission(id, t.cookies.teacher, 2, {
        versionNumber: 1,
        dueAt: new Date(now.getTime() + 24 * 3_600_000).toISOString(),
      }),
      201,
    )
    await ok(await detail(id, t.cookies.student))
    await ok(await queue(t.cookies.teacher))
    const written = logs.slice(from).join('\n')
    assert.ok(written.includes('task_submission.score'), 'işlem logu yok')
    for (const text of ['s-1', 'GIZLI-YAZI', 'GIZLI-GERI-BILDIRIM', 'GIZLI-KRITER'])
      assert.ok(!written.includes(text), `${text} loglandı`)
    const audits = await db
      .select({ action: auditLog.action, entityId: auditLog.entityId, changes: auditLog.changes })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.institution.id),
          eq(auditLog.entityType, 'task_submission'),
        ),
      )
    assert.deepEqual(
      audits.filter((row) => row.action !== 'task_submission.submit'),
      [
        {
          action: 'task_submission.score',
          entityId: id,
          changes: { fields: ['criteria', 'overallComment', 'scoredAt'] },
        },
        {
          action: 'task_submission.request_resubmission',
          entityId: id,
          changes: { fields: ['versionNumber', 'dueAt'] },
        },
      ],
    )
  })
})
