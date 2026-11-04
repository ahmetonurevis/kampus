import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'
import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'

import type { App } from '../src/app.ts'
import { schema, type Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { records } from '../src/db/schema/records.ts'
import {
  resubmissionRequests,
  rubrics,
  rubricScores,
  rubricVersions,
  submissionVersions,
  taskAssignments,
  taskSubmissions,
} from '../src/db/schema/skills.ts'
import { insertRubricScore, insertSecondRatingRequest } from '../src/db/skills.ts'
import { AppError } from '../src/errors.ts'
import type { ServiceContext } from '../src/plugins/authenticate.ts'
import {
  listGradingQueue,
  listOpenAppeals,
  requestTaskResubmission,
  scoreTaskSubmission,
} from '../src/services/task-grading.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
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
const APPEAL_REASON = 'GIZLI-ITIRAZ paragraf düzeni yanlış değerlendirildi'

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
  let tenantCount = 0
  let clientIp = '127.0.0.1'

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
  async function tenant(overrides: Partial<InstitutionOverrides> = {}) {
    now = FIXED_NOW
    // Genel hız sınırı (dakikada 300, IP başına) dosyanın bütününe değil her kiracıya düşsün.
    clientIp = `10.0.${(tenantCount += 1)}.1`
    const institution = await createInstitution(app, overrides)
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
      // Aynı sınıfın ikinci öğretmen hesabı: atamayı görür, bağımsız puanlayıcı olabilir.
      colleague: await signInAs(app, await member('ogretmen', 'teacher', 't-eng')),
      otherStudent: await signInAs(app, await member('ogrenci', 'student', 's-3')),
      otherParent: await signInAs(app, await member('veli', 'child', 's-3')),
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
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    cookie?: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
      remoteAddress: clientIp,
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
  const requestSecond = (
    submissionId: string,
    cookie: string,
    version: number,
    body: unknown = { versionNumber: 1 },
  ) =>
    call('POST', `/task-submissions/${submissionId}/second-rating-requests`, cookie, body, {
      ...match(version),
      ...key(),
    })
  const secondScore = (
    submissionId: string,
    cookie: string,
    version: number,
    body: unknown = scoreBody(),
  ) =>
    call('POST', `/task-submissions/${submissionId}/second-scores`, cookie, body, {
      ...match(version),
      ...key(),
    })
  const drawSample = (assignmentId: string, cookie: string, version: number) =>
    call(
      'POST',
      `/task-assignments/${assignmentId}/second-rating-sample`,
      cookie,
      {},
      {
        ...match(version),
        ...key(),
      },
    )
  const appeal = (
    submissionId: string,
    cookie: string,
    body: unknown = { versionNumber: 1, reason: APPEAL_REASON },
  ) => call('POST', `/task-submissions/${submissionId}/appeals`, cookie, body, key())
  const decide = (
    submissionId: string,
    appealId: string,
    cookie: string,
    version: number,
    body: unknown,
  ) =>
    call('POST', `/task-submissions/${submissionId}/appeals/${appealId}/decision`, cookie, body, {
      ...match(version),
      ...key(),
    })
  /** Ret yanıtı, istek kimliği dışında (yanıtların birebir aynılığı için). */
  const refusal = (response: Awaited<ReturnType<typeof call>>) => {
    const body = response.json()
    delete body.requestId
    return [response.statusCode, body]
  }
  /**
   * Kursiyer ve velinin teslim ayrıntısı ve listesi; sonda (sıra bozulmasın diye) atama ayrıntısı
   * ve listesindeki durum özetleri (IST-051): onlar da puanlamadan önceki ve sonraki hâliyle aynı
   * kalmalı (DOM-BEC-045).
   */
  async function learnerViews(t: Tenant, submissionId: string, assignmentId: string) {
    const views: Json[] = []
    for (const cookie of [t.cookies.student, t.cookies.parent])
      views.push(
        await ok(await detail(submissionId, cookie)),
        await ok(await call('GET', `/task-submissions?assignmentId=${assignmentId}`, cookie)),
      )
    for (const cookie of [t.cookies.student, t.cookies.parent])
      views.push(...(await assignmentViews(cookie, assignmentId)))
    return views
  }
  /**
   * Atama ayrıntısı ve listesindeki kursiyer durum özeti ve içerik (son tarih gibi atama ayarları
   * uzatmayla meşru olarak değişir; özet değişmemeli).
   */
  async function assignmentViews(cookie: string, assignmentId: string) {
    const detailed = await ok(await call('GET', `/task-assignments/${assignmentId}`, cookie))
    const listed = await ok(await call('GET', '/task-assignments', cookie))
    return [
      { progress: detailed.progress, content: detailed.content },
      listed.map((row: Json) => ({ id: row.id, progress: row.progress })),
    ]
  }
  const afterDue = () => new Date(new Date(DUE).getTime() + 3_600_000)
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

  async function setup(
    settings: Record<string, unknown> = {},
    overrides: Partial<InstitutionOverrides> = {},
  ) {
    const t = await tenant(overrides)
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

  test('DOM-BEC-045, DOM-BEC-024: geri bildirim açılmadan kursiyer ve veli puanı, yorumu, satır sürümünü ve kilidi görmez (yanıt puanlamadan öncekiyle aynı); açılınca görür; puanlayan öğretmen kesinleşmemiş puanını görür, yönetici koordinatör sayılmaz', async () => {
    const { t, assignmentId, submission } = await setup()
    const id = submission.id as string
    const learnerViews = async () => {
      const views: Json[] = []
      for (const cookie of [t.cookies.student, t.cookies.parent])
        views.push(
          await ok(await detail(id, cookie)),
          await ok(await call('GET', `/task-submissions?assignmentId=${assignmentId}`, cookie)),
        )
      for (const cookie of [t.cookies.student, t.cookies.parent])
        views.push(...(await assignmentViews(cookie, assignmentId)))
      return views
    }
    const before = await learnerViews()
    for (const view of [before[0], before[2]]) {
      assert.equal(view.rowVersion, null)
      assert.equal(view.allowance.blockedBy, 'limit')
    }
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
    assert.equal(scored.rowVersion, 2)
    // Puan teslimin satır sürümünü artırdı; kursiyer ve velinin yanıtı yine birebir aynı.
    assert.deepEqual(await learnerViews(), before)
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const response = await detail(id, cookie)
      const seen = await ok(response)
      assert.equal(seen.versions[0].score, null)
      assert.equal(seen.latestVersion.score, null)
      assert.equal(seen.rowVersion, null)
      assert.equal(seen.allowance.blockedBy, 'limit')
      const listed = await call('GET', `/task-submissions?assignmentId=${assignmentId}`, cookie)
      for (const body of [response.body, listed.body])
        for (const text of [FEEDBACK, CRITERION_NOTE, 'percent":6', 'graded', '"locked"'])
          assert.ok(!body.includes(text), text)
      assert.equal((await ok(listed))[0].latestVersion.score, null)
      assert.equal((await ok(listed))[0].rowVersion, null)
    }
    // Puanlayan öğretmen kendi kesinleşmemiş puanını görür; yönetici koordinatör sayılmaz,
    // ikinci puanlayıcı olabileceği için ilk puanı görmez (DOM-BEC-024).
    assert.equal((await ok(await detail(id, t.cookies.teacher))).versions[0].score.settled, false)
    const admin = await ok(await detail(id, t.cookies.admin))
    assert.equal(admin.versions[0].score, null)
    assert.equal(admin.latestVersion.score, null)
    assert.equal(admin.rowVersion, 2)

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
      assert.equal(seen.rowVersion, null)
    }
    // Kesinleşmiş puanı yönetici de görür.
    assert.equal((await ok(await detail(id, t.cookies.admin))).versions[0].score.settled, true)
  })

  test('DOM-BEC-041, DOM-BEC-045: öğretmenin puanladığı alıştırma teslimini veli puan, rubrik ve geri bildirimle görmez (ayrıntı, liste, atama özeti); öğrenci ve öğretmen görür; değerlendirmede veli görür', async () => {
    const practice = await setup({ attempts: { kind: 'practice' } })
    const { t } = practice
    const id = practice.submission.id as string
    await ok(await score(id, t.cookies.teacher, 1), 201)
    const forbidden = [FEEDBACK, CRITERION_NOTE, 'percent":6', 'rubricVersionId', '"criteria"']
    const hidden = async (cookie: string) => {
      const response = await detail(id, cookie)
      const seen = await ok(response)
      const listResponse = await call(
        'GET',
        `/task-submissions?assignmentId=${practice.assignmentId}`,
        cookie,
      )
      const listed = (await ok(listResponse))[0]
      assert.equal(seen.versions[0].score, null)
      assert.equal(seen.latestVersion.score, null)
      assert.equal(listed.latestVersion.score, null)
      for (const body of [response.body, listResponse.body])
        for (const text of forbidden) assert.ok(!body.includes(text), text)
      const progress = (
        await ok(await call('GET', `/task-assignments/${practice.assignmentId}`, cookie))
      ).progress
      assert.equal(progress[0].score, null)
    }
    await hidden(t.cookies.parent)
    // Öğrenci ve öğretmen puanı ve geri bildirimi görür.
    for (const cookie of [t.cookies.student, t.cookies.teacher]) {
      const seen = await ok(await detail(id, cookie))
      assert.equal(seen.versions[0].score.percent, 60)
      assert.equal(seen.versions[0].score.overallComment, FEEDBACK)
      assert.equal(seen.latestVersion.score.percent, 60)
    }
    assert.equal(
      (await ok(await call('GET', `/task-assignments/${practice.assignmentId}`, t.cookies.student)))
        .progress[0].score.percent,
      60,
    )
    // Aynı teslim değerlendirmede olsaydı veli puanı görürdü (gizleme yalnız alıştırmaya özgü).
    const evaluation = await setup({ attempts: { kind: 'evaluation', maxAttempts: 1 } })
    await ok(await score(evaluation.submission.id, evaluation.t.cookies.teacher, 1), 201)
    const seen = await ok(await detail(evaluation.submission.id, evaluation.t.cookies.parent))
    assert.equal(seen.versions[0].score.percent, 60)
  })

  test('DOM-BEC-024, DOM-BEC-045: sürüm hakkı kalan teslimde pencere açıkken ikinci puanlama istenmez (409 second_rating_window_open); pencere kapanınca istenir; kursiyerin yanıtı ve yeni sürüm reddi istemden ve puanlamadan önceki ve sonraki hâliyle birebir aynı', async () => {
    const { t, assignmentId, submission } = await setup({
      submission: { submissionKind: 'text', maxVersions: 2 },
    })
    const id = submission.id as string
    const open = await learnerViews(t, id, assignmentId)
    assert.deepEqual(
      [open[0].allowance.canSubmit, open[0].allowance.blockedBy, open[0].allowance.remaining],
      [true, null, 1],
    )
    fails(await requestSecond(id, t.cookies.teacher, 1), 409, 'second_rating_window_open')
    assert.deepEqual(await learnerViews(t, id, assignmentId), open)
    assert.equal((await storedRows(t.institution.id)).submissions[0]?.version, 1)

    // Pencere kapandı (geç kabul yok): yeni sürüm puanlamadan bağımsız olarak kapalıdır.
    now = afterDue()
    const closed = await learnerViews(t, id, assignmentId)
    assert.deepEqual(
      [closed[0].allowance.canSubmit, closed[0].allowance.blockedBy],
      [false, 'locked'],
    )
    const refusedBefore = refusal(await resubmit(assignmentId, 'Second version.'))
    assert.equal(refusedBefore[0], 422)
    const requested = await requestSecond(id, t.cookies.teacher, 1)
    const afterRequest = await ok(requested, 201)
    assert.equal(requested.headers.location, `/api/v1/task-submissions/${id}`)
    assert.equal(afterRequest.versions[0].grading.secondRatingRequested, true)
    assert.equal(afterRequest.rowVersion, 2)
    assert.deepEqual(await learnerViews(t, id, assignmentId), closed)
    fails(await requestSecond(id, t.cookies.admin, 2), 409, 'second_rating_exists')
    // İkinci puanlama başladıktan sonra pencere yeniden açılmaz (açılsa ret puanlamayı ele verirdi).
    const assignment = await ok(
      await call('GET', `/task-assignments/${assignmentId}`, t.cookies.admin),
    )
    const extended = await app.inject({
      method: 'PATCH',
      url: `/api/v1/task-assignments/${assignmentId}`,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        cookie: t.cookies.admin,
        'content-type': 'application/json',
        ...match(assignment.rowVersion),
      },
      payload: JSON.stringify({ deadline: { dueAt: '2026-10-30T20:59:00.000Z' } }),
    })
    fails(extended, 409, 'second_rating_started')

    const scored = await ok(await score(id, t.cookies.teacher, 2), 201)
    assert.deepEqual(
      [scored.versions[0].score.settled, scored.versions[0].grading.status],
      [false, 'pending'],
    )
    assert.equal(scored.versions[0].grading.missing, 'second')
    assert.deepEqual(await learnerViews(t, id, assignmentId), closed)
    assert.deepEqual(refusal(await resubmit(assignmentId, 'Second version.')), refusedBefore)
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const body = (await detail(id, cookie)).body
      for (const text of [FEEDBACK, 'graded', 'grading":{', 'appealDeadline":"'])
        assert.ok(!body.includes(text), text)
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
    // Öğrencinin yanıtında satır sürümü yok; öğretmen güncel sürümü kendi okumasından alır.
    assert.equal(next.rowVersion, null)
    const current = (await ok(await detail(id, t.cookies.teacher))).rowVersion as number
    // Eski sürüm artık puanlanmaz; yeni sürüm puanlanır.
    const stale = await score(id, t.cookies.teacher, current, scoreBody())
    fails(stale, 409, 'version_not_latest')
    await ok(await score(id, t.cookies.teacher, current, scoreBody({ versionNumber: 2 })), 201)
    assert.deepEqual(await ok(await queue(t.cookies.teacher)), [])
    const versions = await db
      .select({ number: submissionVersions.versionNumber })
      .from(submissionVersions)
      .where(eq(submissionVersions.institutionId, t.institution.id))
    assert.equal(versions.length, 2)
  })

  test('DOM-BEC-040, DOM-BEC-044, IST-047: yeniden teslim geçmişi: her sürüm kendi turunun son tarihiyle okunur (sonraki istek eski sürümü geç yapmaz); atamanın son tarihi geçse de istenen sürümün taslağı kaydedilir ve taslaktan teslim edilir; her sürüm kendi geri bildirimini ve turunu taşır; tur kapanınca taslak ve teslim 422', async () => {
    const { t, assignmentId, submission } = await setup()
    const id = submission.id as string
    const HOUR = 3_600_000
    const DAY = 24 * HOUR
    const readRowVersion = async () =>
      (await ok(await detail(id, t.cookies.teacher))).rowVersion as number
    now = new Date(new Date(DUE).getTime() - HOUR)
    const firstRequestedAt = now.toISOString()
    await ok(await score(id, t.cookies.teacher, await readRowVersion()), 201)
    const firstDue = new Date(new Date(DUE).getTime() + 5 * DAY).toISOString()
    await ok(
      await requestResubmission(id, t.cookies.teacher, await readRowVersion(), {
        versionNumber: 1,
        dueAt: firstDue,
      }),
      201,
    )

    // Atamanın son tarihi geçti, yeniden teslim süresi sürüyor.
    now = new Date(new Date(DUE).getTime() + 2 * DAY)
    const draft = await ok(
      await call('PATCH', `/task-assignments/${assignmentId}/draft`, t.cookies.student, {
        body: 'Second version from the draft.',
      }),
    )
    const second = await ok(
      await call(
        'POST',
        `/task-assignments/${assignmentId}/draft/submit`,
        t.cookies.student,
        {},
        { ...match(draft.revision), ...key() },
      ),
      201,
    )
    assert.equal(second.status, 'submitted')
    assert.equal(second.versions[1].late, false)

    await ok(
      await score(id, t.cookies.teacher, await readRowVersion(), scoreBody({ versionNumber: 2 })),
      201,
    )
    const secondRequestedAt = now.toISOString()
    const secondDue = new Date(now.getTime() + 3 * DAY).toISOString()
    await ok(
      await requestResubmission(id, t.cookies.teacher, await readRowVersion(), {
        versionNumber: 2,
        dueAt: secondDue,
      }),
      201,
    )
    const expected = [
      [1, false, { dueAt: firstDue, requestedAt: firstRequestedAt }],
      [2, false, { dueAt: secondDue, requestedAt: secondRequestedAt }],
    ]
    for (const cookie of [t.cookies.student, t.cookies.parent, t.cookies.teacher]) {
      const history = await ok(await detail(id, cookie))
      assert.deepEqual(
        history.versions.map((v: Json) => [v.number, v.late, v.resubmissionRequest]),
        expected,
      )
      // Her sürümün geri bildirimi geçmişte kalır; son istek ayrıca özette.
      assert.deepEqual(
        history.versions.map((v: Json) => v.score?.overallComment ?? null),
        [FEEDBACK, FEEDBACK],
      )
      assert.deepEqual(history.resubmission, { versionNumber: 2, dueAt: secondDue })
    }

    // Üçüncü sürüm ikinci turun penceresinde; kuyruk ve ayrıntı aynı puanlama süresini verir.
    now = new Date(now.getTime() + DAY)
    const third = await ok(await resubmit(assignmentId, 'Third version.'), 201)
    assert.equal(third.versions[2].late, false)
    assert.equal(third.versions[2].resubmissionRequest, null)
    const teacherView = await ok(await detail(id, t.cookies.teacher))
    const queued = (await ok(await queue(t.cookies.teacher))).find((row: Json) => row.id === id)
    assert.equal(queued.grading.dueAt, teacherView.versions[2].grading.dueAt)
    assert.equal(
      queued.grading.dueAt,
      new Date(new Date(secondDue).getTime() + 7 * DAY).toISOString(),
    )

    // İkinci tur kapandı: sıradaki sürümün taslağı ve teslimi kapanır (geç kabul yok).
    now = new Date(new Date(secondDue).getTime() + 1)
    const before = await storedRows(t.institution.id)
    fails(
      await call(
        'PATCH',
        `/task-assignments/${assignmentId}/draft`,
        t.cookies.student,
        {
          body: 'Late draft.',
        },
        match(draft.revision),
      ),
      422,
      'submission_closed',
    )
    fails(await resubmit(assignmentId, 'Fourth.'), 422, 'submission_closed')
    assert.deepEqual(await storedRows(t.institution.id), before)
  })

  test('IST-051, DOM-BEC-040, DOM-BEC-045: kursiyer ve veli atama listesinde ve ayrıntısında kendi durum özetini görür (hak, son teslim, yeni sürüm hakkı, özetin eskiyeceği an, açılmış puan); veli yalnız kendi çocuğu, başka çocuğun ataması 404; özet satır sürümü taşımaz', async () => {
    const t = await tenant()
    cookieOf.student = t.cookies.student
    const assignment = await ok(
      await call(
        'POST',
        '/task-assignments',
        t.cookies.admin,
        {
          resourceVersionId: t.homeworkId,
          settings: {
            deadline: { dueAt: DUE },
            submission: { submissionKind: 'text', maxVersions: 2 },
            rubricVersionId: t.rubricVersionId,
          },
          targets: [{ kind: 'class', id: '9-A' }],
        },
        key(),
      ),
      201,
    )
    const assignmentId = assignment.id as string
    const progressOf = async (cookie: string) => {
      const listed = await ok(await call('GET', '/task-assignments', cookie))
      const detailed = await ok(await call('GET', `/task-assignments/${assignmentId}`, cookie))
      assert.deepEqual(listed[0].progress, detailed.progress)
      assert.equal(detailed.progress.length, 1)
      return detailed.progress[0]
    }
    const fresh = await progressOf(t.cookies.student)
    assert.deepEqual(fresh, {
      learnerId: 's-1',
      status: 'pending',
      resubmissionRequested: false,
      attemptId: null,
      submissionId: null,
      lastActivityAt: null,
      used: 0,
      limit: 2,
      remaining: 2,
      canAct: true,
      // IST-051: yeni sürüm açıkken pencerenin kapanışı; istemci bu andan sonra yeniden okur.
      actionableUntil: DUE,
      blockedBy: null,
      score: null,
    })

    const submission = await ok(await resubmit(assignmentId), 201)
    const sent = await progressOf(t.cookies.student)
    assert.deepEqual(
      [sent.status, sent.used, sent.remaining, sent.canAct, sent.submissionId, sent.score],
      ['submitted', 1, 1, true, submission.id, null],
    )
    assert.equal(sent.lastActivityAt, submission.versions[0].submittedAt)
    assert.deepEqual(await progressOf(t.cookies.parent), sent)

    // İkinci puanlama yok: ilk puan kesinleşir, geri bildirim açılır; hak "değerlendirildi" olur.
    await ok(await score(submission.id, t.cookies.teacher, 1), 201)
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const graded = await progressOf(cookie)
      assert.deepEqual(graded.score, { earned: 6, possible: 10, percent: 60 })
      assert.deepEqual(
        [graded.canAct, graded.blockedBy, graded.actionableUntil],
        [false, 'graded', null],
      )
      assert.ok(!('rowVersion' in graded))
    }
    const dueAt = new Date(now.getTime() + 3 * 24 * 3_600_000).toISOString()
    await ok(
      await requestResubmission(submission.id, t.cookies.teacher, 2, { versionNumber: 1, dueAt }),
      201,
    )
    const reopened = await progressOf(t.cookies.student)
    // Yeniden teslim istendi: özet istenen son tarihte eskir (DOM-BEC-040).
    assert.deepEqual(
      [
        reopened.resubmissionRequested,
        reopened.canAct,
        reopened.blockedBy,
        reopened.actionableUntil,
      ],
      [true, true, null, dueAt],
    )

    // Başka çocuğun velisi ve başka öğrenci atamayı görmez (404), listesinde yoktur.
    for (const cookie of [t.cookies.otherParent, t.cookies.otherStudent]) {
      fails(await call('GET', `/task-assignments/${assignmentId}`, cookie), 404, 'not_found')
      assert.deepEqual(await ok(await call('GET', '/task-assignments', cookie)), [])
    }
  })

  test('DOM-YTK-028: puanlama kuyruğu atamayı görenlere: atayan olmayan ama atamayı gören öğretmen ve yönetici bekleyen teslimi görür, başka sınıfın öğretmeni görmez ve toplamına sayılmaz; puanlanınca düşer; atama süzgeci', async () => {
    const { t, assignmentId, submission } = await setup()
    const id = submission.id as string
    for (const cookie of [t.cookies.teacher, t.cookies.admin]) {
      const response = await queue(cookie)
      const rows = await ok(response)
      assert.equal(response.json().meta.total, 1)
      assert.deepEqual(
        rows.map((row: Json) => [row.id, row.assignmentId, row.latestVersion.number]),
        [[id, assignmentId, 1]],
      )
      assert.equal('body' in rows[0].latestVersion, false)
      assert.equal(rows[0].latestVersion.score, null)
    }
    const hidden = await queue(t.cookies.otherTeacher)
    assert.deepEqual(await ok(hidden), [])
    assert.equal(hidden.json().meta.total, 0)
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

  test('DOM-YTK-028: arşivli atamada puan ve yeniden teslim isteği 404 (öğrenci yazmalarıyla aynı kapsam kalıbı); okumalar açık, kuyrukta yok; kayıt değişmez', async () => {
    const { t, assignmentId, submission } = await setup()
    const id = submission.id as string
    await ok(await score(id, t.cookies.teacher, 1), 201)
    await db
      .update(taskAssignments)
      .set({ archivedAt: now })
      .where(
        and(
          eq(taskAssignments.institutionId, t.institution.id),
          eq(taskAssignments.id, assignmentId),
        ),
      )
    const stored = await storedRows(t.institution.id)
    const dueAt = new Date(now.getTime() + 3 * 24 * 3_600_000).toISOString()
    for (const cookie of [t.cookies.teacher, t.cookies.admin]) {
      fails(await score(id, cookie, 2), 404, 'not_found')
      fails(await requestResubmission(id, cookie, 2, { versionNumber: 1, dueAt }), 404, 'not_found')
      assert.equal((await ok(await detail(id, cookie))).versions[0].score.settled, true)
      const response = await queue(cookie)
      assert.deepEqual(await ok(response), [])
      assert.equal(response.json().meta.total, 0)
    }
    assert.equal((await ok(await detail(id, t.cookies.student))).id, id)
    assert.deepEqual(await storedRows(t.institution.id), stored)
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

  test('DOM-BEC-021, DOM-BEC-045: log ve denetimde geri bildirim metni ve öğrenci kimliği yok; denetime yalnız alan adları; puanın tek score satırı var, bildirim ayrı notification.create eylemiyle', async () => {
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
        // Geri bildirimi açan puan bildirim kaydı da ekler (F6a, DOM-BEC-045); işlem
        // çalıştırıcısı bunu yalnız alan adlarıyla, puandan ayrı `notification.create` eylemiyle
        // yazar; metin ve alıcı yoktur. Puanın tek `task_submission.score` satırı vardır.
        {
          action: 'notification.create',
          entityId: id,
          changes: { fields: ['audience', 'createdAt', 'id', 'kind', 'studentId', 'subject'] },
        },
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

  test('DOM-BEC-024, DOM-BEC-045: sürüm hakkı dolunca pencere açıkken de istenir; ret yanıtı puanlamadan öncekiyle aynı (422 version_limit_reached); kesinleşmiş puana istem 409 second_rating_too_late; istenmeyen sürüme ikinci puan 409', async () => {
    const { t, assignmentId, submission } = await setup()
    const id = submission.id as string
    const before = await learnerViews(t, id, assignmentId)
    const refusedBefore = refusal(await resubmit(assignmentId, 'Second version.'))
    assert.equal(refusedBefore[0], 422)
    fails(await secondScore(id, t.cookies.admin, 1), 409, 'second_rating_not_requested')
    fails(
      await requestSecond(id, t.cookies.teacher, 1, { versionNumber: 2 }),
      404,
      'submission_version_not_found',
    )
    fails(
      await requestSecond(id, t.cookies.teacher, 1, { versionNumber: 1, extra: true }),
      400,
      'validation_failed',
    )
    await ok(await requestSecond(id, t.cookies.teacher, 1), 201)
    await ok(await score(id, t.cookies.teacher, 2), 201)
    assert.deepEqual(await learnerViews(t, id, assignmentId), before)
    assert.deepEqual(refusal(await resubmit(assignmentId, 'Second version.')), refusedBefore)

    // İlk puanı kesinleşmiş başka teslim: istem açılmış sonucu geri almaz.
    const settled = await setup()
    const other = settled.submission.id as string
    await ok(await score(other, settled.t.cookies.teacher, 1), 201)
    fails(await requestSecond(other, settled.t.cookies.teacher, 2), 409, 'second_rating_too_late')
    fails(await secondScore(other, settled.t.cookies.admin, 2), 409, 'second_rating_not_requested')
    assert.equal((await storedRows(settled.t.institution.id)).scores, 1)
  })

  test('DOM-BEC-024: kör puanlama: ikinci puanlayıcı ilk puanı görmez, aynı öğretmen ikinci puan veremez; uyuşmazlıkta sonuç kursiyere kapalı, okumada uyuşmazlık kriterleri; uyuşmazlıkta yeniden teslim ve itiraz açılmaz', async () => {
    const { t, assignmentId, submission } = await setup()
    const id = submission.id as string
    const before = await learnerViews(t, id, assignmentId)
    await ok(await requestSecond(id, t.cookies.admin, 1), 201)
    await ok(await score(id, t.cookies.teacher, 2), 201)
    // İkinci puanlayıcı (yönetici veya başka öğretmen) ilk puanı görmez.
    for (const cookie of [t.cookies.admin, t.cookies.colleague]) {
      const seen = await ok(await detail(id, cookie))
      assert.equal(seen.versions[0].score, null)
      assert.equal(seen.latestVersion.score, null)
      assert.deepEqual(
        [seen.versions[0].grading.status, seen.versions[0].grading.missing],
        ['pending', 'second'],
      )
      const raw = (await detail(id, cookie)).body
      assert.ok(!raw.includes(FEEDBACK) && !raw.includes(CRITERION_NOTE))
    }
    fails(await secondScore(id, t.cookies.teacher, 3), 409, 'rater_not_independent')
    const disagreeing = scoreBody({
      criteria: [
        { criterionId: 'task', band: 1, comment: 'Görev eksik kaldı.' },
        { criterionId: 'grammar', band: 2, comment: 'Zaman hataları var.' },
      ],
      overallComment: 'İkinci puanlayıcının yorumu.',
    })
    const second = await ok(await secondScore(id, t.cookies.colleague, 3, disagreeing), 201)
    assert.deepEqual(second.versions[0].grading.disagreementCriterionIds, ['task'])
    assert.equal(second.versions[0].grading.status, 'disagreement')
    // İkinci puanlayıcı yalnız kendi puanını görür; ilk puan yine gizli.
    assert.equal(second.versions[0].score.overallComment, 'İkinci puanlayıcının yorumu.')
    assert.equal(second.versions[0].score.settled, false)
    fails(await secondScore(id, t.cookies.admin, 4), 409, 'rubric_score_exists')
    assert.equal((await ok(await detail(id, t.cookies.admin))).versions[0].score, null)
    // Uyuşmazlık: son puan koordinatörle gelecek (F4b3b2b); kursiyer ve veliye hiçbir şey açılmaz.
    assert.deepEqual(await learnerViews(t, id, assignmentId), before)
    for (const cookie of [t.cookies.student, t.cookies.parent])
      fails(await appeal(id, cookie), 409, 'appeal_not_open')
    fails(
      await requestResubmission(id, t.cookies.teacher, 4, {
        versionNumber: 1,
        dueAt: new Date(now.getTime() + 24 * 3_600_000).toISOString(),
      }),
      409,
      'resubmission_not_graded',
    )
    assert.deepEqual(
      (await ok(await queue(t.cookies.admin, '&awaiting=second'))).map((row: Json) => row.id),
      [],
    )
  })

  test('DOM-BEC-024: örneklem teslim penceresi kapanınca bir kez seçilir (%10, en az bir); seçilmeden ilk puan 409; ikinci puan bekleyenler kuyrukta ayrı; rol × kapsam, başka kurum 404, modül kapalı 403', async () => {
    const t = await tenant()
    cookieOf.student = t.cookies.student
    const created = await ok(
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
            highStakes: true,
          },
          targets: [
            { kind: 'class', id: '9-A' },
            { kind: 'class', id: '9-B' },
          ],
        },
        key(),
      ),
      201,
    )
    const assignmentId = created.id as string
    const first = await ok(await resubmit(assignmentId), 201)
    cookieOf.student = t.cookies.otherStudent
    const otherSubmission = await ok(await resubmit(assignmentId, 'Another text.'), 201)
    const ids = [first.id as string, otherSubmission.id as string].sort()
    const version = created.rowVersion as number

    fails(await score(first.id, t.cookies.teacher, 1), 409, 'second_rating_sample_pending')
    const pending = await ok(await queue(t.cookies.teacher))
    assert.deepEqual(
      pending.map((row: Json) => [row.grading.awaiting, row.grading.samplePending]),
      [
        [['first'], true],
        [['first'], true],
      ],
    )
    fails(
      await drawSample(assignmentId, t.cookies.admin, version),
      409,
      'second_rating_window_open',
    )
    for (const cookie of [t.cookies.student, t.cookies.parent, t.cookies.frontDesk])
      fails(await drawSample(assignmentId, cookie, version), 403, 'forbidden')
    const other = await createInstitution(app)
    fails(
      await drawSample(assignmentId, await signInAs(app, other.admin), version),
      404,
      'not_found',
    )
    const closedModule = await createInstitution(app, { enabledModules: { learning: false } })
    fails(
      await drawSample(assignmentId, await signInAs(app, closedModule.admin), version),
      403,
      'module_disabled',
    )

    now = afterDue()
    fails(await drawSample(assignmentId, t.cookies.teacher, version + 5), 409, 'version_conflict')
    const response = await drawSample(assignmentId, t.cookies.teacher, version)
    const sample = await ok(response, 201)
    assert.equal(
      response.headers.location,
      `/api/v1/task-submissions/grading-queue?assignmentId=${assignmentId}&awaiting=second`,
    )
    assert.deepEqual(
      [sample.percent, sample.submissionCount, sample.submissionIds.length],
      [10, 2, 1],
    )
    assert.ok(ids.includes(sample.submissionIds[0]))
    fails(
      await drawSample(assignmentId, t.cookies.admin, sample.rowVersion),
      409,
      'second_rating_sample_drawn',
    )
    const sampled = sample.submissionIds[0] as string
    const unsampled = ids.find((value) => value !== sampled) as string
    assert.deepEqual(
      (await ok(await queue(t.cookies.teacher, '&awaiting=second'))).map((row: Json) => [
        row.id,
        row.grading.awaiting,
      ]),
      [[sampled, ['first', 'second']]],
    )
    // Örneklemdeki teslim ilk puandan sonra ikinci puanı bekler; dışındaki hemen kesinleşir.
    await ok(await score(sampled, t.cookies.teacher, 2), 201)
    await ok(await score(unsampled, t.cookies.teacher, 1), 201)
    assert.deepEqual(await ok(await queue(t.cookies.teacher)), [])
    assert.deepEqual(
      (await ok(await queue(t.cookies.admin, '&awaiting=second'))).map((row: Json) => row.id),
      [sampled],
    )
    assert.deepEqual(await ok(await queue(t.cookies.admin, '&awaiting=first')), [])
    const learner = sampled === first.id ? t.cookies.student : t.cookies.otherStudent
    const unsampledLearner =
      learner === t.cookies.student ? t.cookies.otherStudent : t.cookies.student
    assert.equal((await ok(await detail(sampled, learner))).versions[0].score, null)
    assert.equal(
      (await ok(await detail(unsampled, unsampledLearner))).versions[0].score.settled,
      true,
    )
    fails(await queue(t.cookies.admin, '&awaiting=third'), 400, 'validation_failed')
  })

  test('DOM-BEC-025: kuyruk satırında puanlama süresi (son teslim + 7 gün, son an dahil zamanında); gecikene göre süzgeç; geçersiz süzgeç 400', async () => {
    const { t } = await setup()
    const due = new Date(new Date(DUE).getTime() + 7 * 24 * 3_600_000)
    const [row] = await ok(await queue(t.cookies.teacher))
    assert.deepEqual([row.grading.dueAt, row.grading.overdue], [due.toISOString(), false])
    assert.equal((await ok(await queue(t.cookies.teacher, '&overdue=true'))).length, 0)
    now = due
    assert.equal((await ok(await queue(t.cookies.teacher, '&overdue=false'))).length, 1)
    now = new Date(due.getTime() + 1)
    const [late] = await ok(await queue(t.cookies.teacher, '&overdue=true'))
    assert.equal(late.grading.overdue, true)
    assert.equal((await ok(await queue(t.cookies.teacher, '&overdue=false'))).length, 0)
    const staff = await ok(await detail(late.id, t.cookies.teacher))
    assert.deepEqual(
      [staff.versions[0].grading.dueAt, staff.versions[0].grading.overdue],
      [due.toISOString(), true],
    )
    fails(await queue(t.cookies.teacher, '&overdue=yes'), 400, 'validation_failed')
  })

  test('DOM-BEC-025: öğrenci veya velisi duyurudan sonra 5 iş günü içinde itiraz eder (hafta sonu sayılmaz, son an dahil); duyurudan önce 409, süre geçince 422; sürüm başına bir; veli yalnız kendi çocuğu; personel 403; başka kurum 404; gerekçe loglanmaz', async () => {
    const { t, submission } = await setup()
    const id = submission.id as string
    const from = logs.length
    for (const cookie of [t.cookies.student, t.cookies.parent])
      fails(await appeal(id, cookie), 409, 'appeal_not_open')
    await ok(await score(id, t.cookies.teacher, 1), 201)
    // Duyuru salı 6 Ekim 12.00 (İstanbul): 7, 8, 9, 12, 13 Ekim iş günü; son an 13 Ekim 23.59.59.
    const deadline = '2026-10-13T20:59:59.999Z'
    for (const cookie of [t.cookies.student, t.cookies.parent, t.cookies.teacher])
      assert.equal((await ok(await detail(id, cookie))).versions[0].appealDeadline, deadline)
    for (const cookie of [t.cookies.teacher, t.cookies.admin, t.cookies.frontDesk])
      fails(await appeal(id, cookie), 403, 'forbidden')
    fails(await appeal(id, t.cookies.otherParent), 404, 'not_found')
    fails(await appeal(id, t.cookies.otherStudent), 404, 'not_found')
    const other = await createInstitution(app)
    fails(await appeal(id, await signInAs(app, other.admin)), 403, 'forbidden')
    fails(
      await appeal(id, t.cookies.student, { versionNumber: 1, reason: 'kısa' }),
      400,
      'validation_failed',
    )
    fails(
      await appeal(id, t.cookies.student, { versionNumber: 2, reason: APPEAL_REASON }),
      404,
      'submission_version_not_found',
    )
    now = new Date(Date.parse(deadline) + 1)
    fails(await appeal(id, t.cookies.student), 422, 'appeal_window_closed')
    now = new Date(Date.parse(deadline))
    const response = await appeal(id, t.cookies.parent)
    const filed = await ok(response, 201)
    assert.equal(response.headers.location, `/api/v1/task-submissions/${id}`)
    assert.deepEqual(
      [filed.versions[0].appeal.reason, filed.versions[0].appeal.outcome],
      [APPEAL_REASON, null],
    )
    assert.equal(filed.rowVersion, null)
    assert.equal(filed.versions[0].appealDeadline, null)
    fails(await appeal(id, t.cookies.student), 409, 'appeal_exists')
    assert.equal(
      (await ok(await detail(id, t.cookies.teacher))).versions[0].appeal.reason,
      APPEAL_REASON,
    )
    const written = logs.slice(from).join('\n')
    assert.ok(written.includes('task_submission.appeal'), 'işlem logu yok')
    assert.ok(!written.includes('GIZLI-ITIRAZ'), 'itiraz gerekçesi loglandı')
    const [audit] = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.institution.id),
          eq(auditLog.action, 'task_submission.appeal'),
        ),
      )
    assert.deepEqual(audit?.changes, { fields: ['reason', 'filedAt'] })
  })

  test('DOM-BEC-025: itirazı ilk puanlayıcı karara bağlayamaz (409 rater_not_independent); yönetici karar veremez (403), okur; başka öğretmen kabul eder, son puan geçerli olur, ilk puan kayıt geçmişinde kalır; itirazdan sonra yeni itiraz süresi gösterilmez; ikinci karar 409; öğrenci 403; gerekçe loglanmaz', async () => {
    const { t, submission } = await setup()
    const id = submission.id as string
    await ok(await score(id, t.cookies.teacher, 1), 201)
    const filed = await ok(await appeal(id, t.cookies.student), 201)
    const appealId = filed.versions[0].appeal.id as string
    const staffVersion = (await ok(await detail(id, t.cookies.teacher))).rowVersion as number
    const upheld = {
      outcome: 'upheld',
      reason: 'GIZLI-KARAR kriterler yeniden okundu',
      score: {
        criteria: [
          { criterionId: 'task', band: 5, comment: null },
          { criterionId: 'grammar', band: 5, comment: null },
        ],
        overallComment: 'Yeniden değerlendirme sonucu.',
      },
    }
    const from = logs.length
    fails(
      await decide(id, appealId, t.cookies.teacher, staffVersion, upheld),
      409,
      'rater_not_independent',
    )
    fails(await decide(id, appealId, t.cookies.student, staffVersion, upheld), 403, 'forbidden')
    // Yönetici itirazı okur ama karar veremez (DOM-BEC-025); atamayı görmeyen öğretmen 404.
    fails(await decide(id, appealId, t.cookies.admin, staffVersion, upheld), 403, 'forbidden')
    const stranger = await signInAs(app, (await createInstitution(app)).admin)
    fails(await decide(id, appealId, stranger, staffVersion, upheld), 403, 'forbidden')
    fails(
      await decide(id, appealId, t.cookies.otherTeacher, staffVersion, upheld),
      404,
      'not_found',
    )
    assert.equal(
      (await ok(await detail(id, t.cookies.admin))).versions[0].appeal.id,
      appealId,
      'yönetici itirazı okuyamadı',
    )
    fails(
      await decide(id, appealId, t.cookies.colleague, staffVersion, { ...upheld, total: 10 }),
      400,
      'validation_failed',
    )
    fails(
      await decide(id, randomUUID(), t.cookies.colleague, staffVersion, upheld),
      404,
      'not_found',
    )
    assert.equal((await storedRows(t.institution.id)).scores, 1)
    const decided = await ok(await decide(id, appealId, t.cookies.colleague, staffVersion, upheld))
    assert.deepEqual(
      [decided.versions[0].appeal.outcome, decided.versions[0].score.percent],
      ['upheld', 100],
    )
    const seen = await ok(await detail(id, t.cookies.student))
    assert.deepEqual(
      [seen.versions[0].score.percent, seen.versions[0].appeal.decisionReason],
      [100, upheld.reason],
    )
    // Kabul edilen itirazın son puanı yeni bir itiraz süresi açmaz (sürüm başına bir itiraz).
    for (const cookie of [t.cookies.student, t.cookies.parent, t.cookies.colleague])
      assert.equal((await ok(await detail(id, cookie))).versions[0].appealDeadline, null)
    fails(await appeal(id, t.cookies.student), 409, 'appeal_exists')
    const roles = await db
      .select({ role: rubricScores.raterRole })
      .from(rubricScores)
      .where(eq(rubricScores.institutionId, t.institution.id))
    assert.deepEqual(roles.map((row) => row.role).sort(), ['final', 'first'])
    fails(
      await decide(id, appealId, t.cookies.colleague, decided.rowVersion, {
        outcome: 'rejected',
        reason: 'İkinci karar denemesi.',
      }),
      409,
      'appeal_decided',
    )
    assert.ok(!logs.slice(from).join('\n').includes('GIZLI-KARAR'), 'karar gerekçesi loglandı')
  })

  /** Yöneticinin atama son tarihi değişikliği (`If-Match`: atamanın güncel `rowVersion`'ı). */
  async function extendDeadline(t: Tenant, assignmentId: string, dueAt: string) {
    const assignment = await ok(
      await call('GET', `/task-assignments/${assignmentId}`, t.cookies.admin),
    )
    return app.inject({
      method: 'PATCH',
      url: `/api/v1/task-assignments/${assignmentId}`,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        cookie: t.cookies.admin,
        'content-type': 'application/json',
        ...match(assignment.rowVersion),
        ...key(),
      },
      payload: JSON.stringify({ deadline: { dueAt } }),
    })
  }
  const DAY = 24 * 3_600_000

  test('DOM-BEC-024: son tarihsiz örneklemli görevde örneklem kilidi yok: ilk puan hemen verilir, kuyrukta örneklem beklenmez ve süre gönderimden başlar; örneklem 409 second_rating_sample_unavailable; ikinci puan elle istenir', async () => {
    // Değerlendirme son tarih ister; son tarihsiz görev alıştırmadır.
    const { t, assignmentId, submission } = await setup({
      attempts: { kind: 'practice' },
      deadline: { dueAt: null },
      secondRatingPercent: 20,
    })
    const id = submission.id as string
    const [row] = await ok(await queue(t.cookies.teacher))
    assert.deepEqual(
      [row.grading.awaiting, row.grading.samplePending, row.grading.dueAt],
      [['first'], false, new Date(FIXED_NOW.getTime() + 7 * DAY).toISOString()],
    )
    const assignment = await ok(
      await call('GET', `/task-assignments/${assignmentId}`, t.cookies.admin),
    )
    assert.equal(assignment.secondRatingSampledAt, null)
    now = new Date(FIXED_NOW.getTime() + 60 * DAY)
    fails(
      await drawSample(assignmentId, t.cookies.admin, assignment.rowVersion),
      409,
      'second_rating_sample_unavailable',
    )
    // Sürüm hakkı dolmuş teslim için ikinci puan elle istenir; ilk puan örneklemi beklemez.
    await ok(await requestSecond(id, t.cookies.teacher, 1), 201)
    const scored = await ok(await score(id, t.cookies.teacher, 2), 201)
    assert.deepEqual(
      [scored.versions[0].grading.status, scored.versions[0].grading.missing],
      ['pending', 'second'],
    )
    assert.deepEqual(
      (await ok(await queue(t.cookies.colleague, '&awaiting=second'))).map((r: Json) => r.id),
      [id],
    )
  })

  test('DOM-BEC-024, DOM-BEC-025: örneklemli görevde puanlama süresi örneklemin seçildiği andan başlar; örneklem seçilmeden süre yok (dueAt null), gecikmiş sayılmaz; örneklem anı yalnız personelin atama görünümünde', async () => {
    const { t, assignmentId, submission } = await setup({ highStakes: true })
    const id = submission.id as string
    // Örneklem seçilmeden süre işlemez: son teslimden 30 gün sonra da gecikmiş değil.
    now = new Date(Date.parse(DUE) + 30 * DAY)
    const [waiting] = await ok(await queue(t.cookies.teacher))
    assert.deepEqual(
      [waiting.grading.samplePending, waiting.grading.dueAt, waiting.grading.overdue],
      [true, null, false],
    )
    assert.equal((await ok(await queue(t.cookies.teacher, '&overdue=true'))).length, 0)
    assert.equal((await ok(await queue(t.cookies.teacher, '&overdue=false'))).length, 1)
    const staffBefore = (await ok(await detail(id, t.cookies.teacher))).versions[0].grading
    assert.deepEqual([staffBefore.dueAt, staffBefore.overdue], [null, false])

    const sampledAt = now
    const assignment = await ok(
      await call('GET', `/task-assignments/${assignmentId}`, t.cookies.admin),
    )
    await ok(await drawSample(assignmentId, t.cookies.admin, assignment.rowVersion), 201)
    const due = new Date(sampledAt.getTime() + 7 * DAY).toISOString()
    const [started] = await ok(await queue(t.cookies.teacher))
    assert.deepEqual(
      [started.grading.samplePending, started.grading.dueAt, started.grading.overdue],
      [false, due, false],
    )
    assert.equal((await ok(await detail(id, t.cookies.teacher))).versions[0].grading.dueAt, due)
    now = new Date(Date.parse(due) + 1)
    const [late] = await ok(await queue(t.cookies.teacher, '&overdue=true'))
    assert.deepEqual([late.id, late.grading.overdue], [id, true])
    assert.equal((await ok(await queue(t.cookies.teacher, '&overdue=false'))).length, 0)

    // Örneklem anı personelin atama görünümünde; kursiyer ve veli görmez.
    for (const cookie of [t.cookies.admin, t.cookies.teacher]) {
      const staff = await ok(await call('GET', `/task-assignments/${assignmentId}`, cookie))
      assert.equal(staff.secondRatingSampledAt, sampledAt.toISOString())
    }
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const response = await call('GET', `/task-assignments/${assignmentId}`, cookie)
      const learner = await ok(response)
      assert.equal(learner.view, 'learner')
      assert.ok(!('secondRatingSampledAt' in learner))
      assert.ok(!response.body.includes('secondRating'))
      const list = await call('GET', '/task-assignments?page=1&pageSize=20', cookie)
      assert.ok(!list.body.includes('secondRating'))
    }
  })

  test('DOM-BEC-024, DOM-BEC-045: pencere açıkken hakkı dolmuş teslim için yapılan elle istek son tarih uzatmasını engellemez; istek yapılan kursiyerin yanıtı ve yeni sürüm reddi uzatmadan önce ve sonra aynı; pencere kapandıktan sonraki istek kilitler', async () => {
    const { t, assignmentId, submission } = await setup()
    const id = submission.id as string
    await ok(await requestSecond(id, t.cookies.teacher, 1), 201)
    await ok(await score(id, t.cookies.teacher, 2), 201)
    const before = await learnerViews(t, id, assignmentId)
    assert.deepEqual(
      [before[0].allowance.canSubmit, before[0].allowance.blockedBy],
      [false, 'limit'],
    )
    const refusedBefore = refusal(await resubmit(assignmentId, 'Second version.'))
    assert.equal(refusedBefore[0], 422)
    const extendedDue = '2026-10-30T20:59:00.000Z'
    const extended = await ok(await extendDeadline(t, assignmentId, extendedDue))
    assert.equal(extended.deadline.dueAt, extendedDue)
    assert.deepEqual(await learnerViews(t, id, assignmentId), before)
    assert.deepEqual(refusal(await resubmit(assignmentId, 'Second version.')), refusedBefore)

    // Pencere kapandıktan sonra yapılan istek pencereyi kilitler.
    const closed = await setup()
    const other = closed.submission.id as string
    now = afterDue()
    await ok(await requestSecond(other, closed.t.cookies.teacher, 1), 201)
    fails(
      await extendDeadline(closed.t, closed.assignmentId, extendedDue),
      409,
      'second_rating_started',
    )
  })

  test('DOM-BEC-025: itiraz yalnız son sürümün sonucuna: v1 duyurulur, v2 kesinleşir, v1 itirazı 409 appeal_not_latest; v2 itirazı kabul edilir', async () => {
    const { t, assignmentId, submission } = await setup()
    const id = submission.id as string
    await ok(await score(id, t.cookies.teacher, 1), 201)
    assert.ok((await ok(await detail(id, t.cookies.student))).versions[0].appealDeadline)
    await ok(
      await requestResubmission(id, t.cookies.teacher, 2, {
        versionNumber: 1,
        dueAt: new Date(now.getTime() + 3 * DAY).toISOString(),
      }),
      201,
    )
    await ok(await resubmit(assignmentId, 'Second version.'), 201)
    const staff = await ok(await detail(id, t.cookies.teacher))
    await ok(
      await score(id, t.cookies.teacher, staff.rowVersion, scoreBody({ versionNumber: 2 })),
      201,
    )
    for (const cookie of [t.cookies.student, t.cookies.parent])
      fails(await appeal(id, cookie), 409, 'appeal_not_latest')
    assert.equal((await storedRows(t.institution.id)).scores, 2)
    const filed = await ok(
      await appeal(id, t.cookies.student, { versionNumber: 2, reason: APPEAL_REASON }),
      201,
    )
    assert.deepEqual(
      filed.versions.map((v: Json) => v.appeal?.reason ?? null),
      [null, APPEAL_REASON],
    )
  })

  test('DOM-BEC-024, DOM-BEC-025: uyuşmazlıklı (koordinatör bekleyen) teslim kuyruktan düşmez: yönetici ve atamayı gören öğretmenler awaitingResolution ile görür, süre aşımı da görünür; ikinci puandan önce uyuşmazlık bilgisi yok (kör puanlama)', async () => {
    const { t, submission } = await setup()
    const id = submission.id as string
    await ok(await requestSecond(id, t.cookies.admin, 1), 201)
    await ok(await score(id, t.cookies.teacher, 2), 201)
    // İkinci puanı vermemiş puanlayıcı: yalnız bekleyen ikinci puan, uyuşmazlık bilgisi yok.
    const [blind] = await ok(await queue(t.cookies.colleague))
    assert.deepEqual(
      [blind.grading.awaiting, blind.grading.awaitingResolution],
      [['second'], false],
    )
    assert.deepEqual(await ok(await queue(t.cookies.teacher)), [])
    const disagreeing = scoreBody({
      criteria: [
        { criterionId: 'task', band: 1, comment: 'Görev eksik kaldı.' },
        { criterionId: 'grammar', band: 2, comment: 'Zaman hataları var.' },
      ],
      overallComment: 'İkinci puanlayıcının yorumu.',
    })
    await ok(await secondScore(id, t.cookies.colleague, 3, disagreeing), 201)
    for (const cookie of [t.cookies.admin, t.cookies.teacher, t.cookies.colleague]) {
      const rows = await ok(await queue(cookie))
      assert.deepEqual(
        rows.map((row: Json) => [row.id, row.grading.awaiting, row.grading.awaitingResolution]),
        [[id, [], true]],
      )
    }
    assert.deepEqual(await ok(await queue(t.cookies.otherTeacher)), [])
    for (const filter of ['&awaiting=first', '&awaiting=second'])
      assert.deepEqual(await ok(await queue(t.cookies.admin, filter)), [])
    const due = new Date(Date.parse(DUE) + 7 * DAY)
    now = new Date(due.getTime() + 1)
    const [late] = await ok(await queue(t.cookies.admin, '&overdue=true'))
    assert.deepEqual(
      [late.id, late.grading.dueAt, late.grading.overdue, late.grading.awaitingResolution],
      [id, due.toISOString(), true, true],
    )
  })

  /** Aktörün bildirim listesi (F6a); yalnız geri bildirim türü ve konu teslimi. */
  async function feedbackNotices(cookie: string) {
    const list = (await ok(await call('GET', '/notifications', cookie))) as Json[]
    return list
      .filter((n) => n.kind === 'feedback_released')
      .map((n) => [n.audience, n.studentId, n.subject.id] as const)
  }

  test('DOM-BEC-041, DOM-BEC-045: öğretmenin puanladığı alıştırma teslimi için feedback_released yalnız öğrenciye gider, veliye gitmez; aynı puan değerlendirmede öğrenciye ve veliye bildirim üretir', async () => {
    const practice = await setup({ attempts: { kind: 'practice' } })
    const practiceId = practice.submission.id as string
    await ok(await score(practiceId, practice.t.cookies.teacher, 1), 201)
    assert.deepEqual(await feedbackNotices(practice.t.cookies.student), [
      ['student', 's-1', practiceId],
    ])
    assert.deepEqual(await feedbackNotices(practice.t.cookies.parent), [])

    const evaluation = await setup({ attempts: { kind: 'evaluation', maxAttempts: 1 } })
    const evaluationId = evaluation.submission.id as string
    await ok(await score(evaluationId, evaluation.t.cookies.teacher, 1), 201)
    assert.deepEqual(await feedbackNotices(evaluation.t.cookies.student), [
      ['student', 's-1', evaluationId],
    ])
    assert.deepEqual(await feedbackNotices(evaluation.t.cookies.parent), [
      ['parent', 's-1', evaluationId],
    ])
  })

  test('DOM-BEC-045, DOM-ILT-023: puanı kesinleştiren ilk puan öğrenciye ve veliye bildirim üretir; başka öğrenci ve veliye gitmez; bildirimde puan ve geri bildirim metni yok, logda da yok', async () => {
    const { t, submission } = await setup()
    const id = submission.id as string
    for (const cookie of [t.cookies.student, t.cookies.parent])
      assert.deepEqual(await feedbackNotices(cookie), [])
    logs.length = 0
    await ok(await score(id, t.cookies.teacher, 1), 201)
    assert.deepEqual(await feedbackNotices(t.cookies.student), [['student', 's-1', id]])
    assert.deepEqual(await feedbackNotices(t.cookies.parent), [['parent', 's-1', id]])
    for (const cookie of [t.cookies.otherStudent, t.cookies.otherParent, t.cookies.teacher])
      assert.deepEqual(await feedbackNotices(cookie), [])
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const body = (await call('GET', '/notifications', cookie)).body
      for (const text of [FEEDBACK, CRITERION_NOTE, 'percent', 'band'])
        assert.ok(!body.includes(text), text)
    }
    const logText = logs.join('\n')
    for (const text of [FEEDBACK, CRITERION_NOTE, 'Deniz']) assert.ok(!logText.includes(text), text)
  })

  test('DOM-BEC-045, DOM-BEC-024: ikinci puanlama istenmişse ilk puan bildirim üretmez; uyuşan ikinci puan geri bildirimi açar ve bir kez bildirir', async () => {
    const { t, submission } = await setup()
    const id = submission.id as string
    await ok(await requestSecond(id, t.cookies.admin, 1), 201)
    await ok(await score(id, t.cookies.teacher, 2), 201)
    for (const cookie of [t.cookies.student, t.cookies.parent])
      assert.deepEqual(await feedbackNotices(cookie), [])
    await ok(await secondScore(id, t.cookies.colleague, 3), 201)
    assert.deepEqual(await feedbackNotices(t.cookies.student), [['student', 's-1', id]])
    assert.deepEqual(await feedbackNotices(t.cookies.parent), [['parent', 's-1', id]])
  })

  test('DOM-BEC-045, DOM-BEC-024: uyuşmayan ikinci puan geri bildirimi açmaz ve bildirim üretmez; ilk açılış koordinatör puanındadır (F4b3b2b)', async () => {
    const { t, submission } = await setup()
    const id = submission.id as string
    await ok(await requestSecond(id, t.cookies.admin, 1), 201)
    await ok(await score(id, t.cookies.teacher, 2), 201)
    const disagreeing = scoreBody({
      criteria: [
        { criterionId: 'task', band: 1, comment: 'Görev eksik kaldı.' },
        { criterionId: 'grammar', band: 2, comment: 'Zaman hataları var.' },
      ],
      overallComment: 'İkinci puanlayıcının yorumu.',
    })
    const second = await ok(await secondScore(id, t.cookies.colleague, 3, disagreeing), 201)
    assert.equal(second.versions[0].grading.status, 'disagreement')
    for (const cookie of [t.cookies.student, t.cookies.parent])
      assert.deepEqual(await feedbackNotices(cookie), [])
    const rows = await db
      .select({ id: records.id })
      .from(records)
      .where(
        and(eq(records.institutionId, t.institution.id), eq(records.collection, 'notifications')),
      )
    assert.equal(rows.length, 0)
  })

  test('DOM-YTK-040: iletişim modülü kapalıyken puan yazılır ama bildirim kaydı üretilmez', async () => {
    const { t, submission } = await setup({}, { enabledModules: { communication: false } })
    await ok(await score(submission.id as string, t.cookies.teacher, 1), 201)
    const rows = await db
      .select({ id: records.id })
      .from(records)
      .where(
        and(eq(records.institutionId, t.institution.id), eq(records.collection, 'notifications')),
      )
    assert.equal(rows.length, 0)
  })
  /** Kurumun bildirim kayıtları: tür, kitle, öğrenci ve konu teslimi (sıralı). */
  async function noticeRows(institutionId: string) {
    const rows = await db
      .select({ data: records.data })
      .from(records)
      .where(and(eq(records.institutionId, institutionId), eq(records.collection, 'notifications')))
    return rows
      .map(({ data }) => {
        const row = data as Json
        return [row.kind, row.audience, row.studentId, row.subject.id] as const
      })
      .sort()
  }
  /** Aktörün itiraz kararı bildirimleri ve başlıkları (liste ucundan). */
  async function appealNotices(cookie: string) {
    const list = (await ok(await call('GET', '/notifications', cookie))) as Json[]
    return list
      .filter((n) => n.kind === 'appeal_decided')
      .map((n) => [n.audience, n.studentId, n.subject.id, n.title] as const)
  }
  const UPHELD = {
    outcome: 'upheld',
    reason: 'GIZLI-KARAR kriterler yeniden okundu',
    score: {
      criteria: [
        { criterionId: 'task', band: 5, comment: null },
        { criterionId: 'grammar', band: 5, comment: null },
      ],
      overallComment: 'Yeniden değerlendirme sonucu.',
    },
  }
  const REJECTED = { outcome: 'rejected', reason: 'GIZLI-KARAR puan doğru bulundu' }
  /** Puanlı, itirazı açılmış teslim; karar `colleague` ile verilir (`rowVersion` personelin). */
  async function appealed(t: Tenant, submissionId: string) {
    await ok(await score(submissionId, t.cookies.teacher, 1), 201)
    const filed = await ok(await appeal(submissionId, t.cookies.student), 201)
    const rowVersion = (await ok(await detail(submissionId, t.cookies.teacher))).rowVersion
    return { appealId: filed.versions[0].appeal.id as string, rowVersion: rowVersion as number }
  }
  const OTHERS = (t: Tenant) => [
    t.cookies.otherStudent,
    t.cookies.otherParent,
    t.cookies.teacher,
    t.cookies.colleague,
    t.cookies.admin,
  ]

  for (const [outcome, body] of [
    ['upheld', UPHELD],
    ['rejected', REJECTED],
  ] as const)
    test(`DOM-BEC-025, DOM-ILT-023, IST-065: itiraz kararı (${outcome}) aynı işlemde öğrenciye ve veliye tek appeal_decided bildirimi yazar; puan değişmediği retle de bildirilir; ikinci feedback_released yok; başkasına gitmez; bildirimde sonuç, gerekçe ve puan yok`, async () => {
      const { t, submission } = await setup()
      const id = submission.id as string
      const { appealId, rowVersion } = await appealed(t, id)
      // Puanın kendisi geri bildirimi zaten açmıştı: yalnız o bildirim var.
      assert.deepEqual(await noticeRows(t.institution.id), [
        ['feedback_released', 'parent', 's-1', id],
        ['feedback_released', 'student', 's-1', id],
      ])
      await ok(await decide(id, appealId, t.cookies.colleague, rowVersion, body))
      assert.deepEqual(await noticeRows(t.institution.id), [
        ['appeal_decided', 'parent', 's-1', id],
        ['appeal_decided', 'student', 's-1', id],
        ['feedback_released', 'parent', 's-1', id],
        ['feedback_released', 'student', 's-1', id],
      ])
      assert.deepEqual(await appealNotices(t.cookies.student), [
        ['student', 's-1', id, 'Görev itirazın sonuçlandı.'],
      ])
      assert.deepEqual(await appealNotices(t.cookies.parent), [
        ['parent', 's-1', id, 'Deniz için görev itirazı sonuçlandı.'],
      ])
      for (const cookie of OTHERS(t)) assert.deepEqual(await appealNotices(cookie), [])
      for (const cookie of [t.cookies.student, t.cookies.parent]) {
        const text = (await call('GET', '/notifications', cookie)).body
        for (const hidden of ['GIZLI-', 'upheld', 'rejected', 'percent', 'band'])
          assert.ok(!text.includes(hidden), hidden)
      }
      // Sonuçlanmış karar yeniden verilemez; ikinci bildirim yazılmaz.
      fails(
        await decide(id, appealId, t.cookies.colleague, rowVersion + 1, body),
        409,
        'appeal_decided',
      )
      assert.equal((await noticeRows(t.institution.id)).length, 4)
    })

  test('DOM-BEC-025, IST-065: aynı Idempotency-Key ile karar tekrarı yanıtı yeniden oynatır ve tek bildirim bırakır', async () => {
    const { t, submission } = await setup()
    const id = submission.id as string
    const { appealId, rowVersion } = await appealed(t, id)
    const send = () =>
      call(
        'POST',
        `/task-submissions/${id}/appeals/${appealId}/decision`,
        t.cookies.colleague,
        REJECTED,
        { ...match(rowVersion), 'idempotency-key': 'karar-tekrar-1' },
      )
    await ok(await send())
    await ok(await send())
    const decided = (await noticeRows(t.institution.id)).filter(
      ([kind]) => kind === 'appeal_decided',
    )
    assert.deepEqual(decided, [
      ['appeal_decided', 'parent', 's-1', id],
      ['appeal_decided', 'student', 's-1', id],
    ])
  })

  test('DOM-BEC-025, IST-065: karar işlem içinde başarısız olursa ne karar, ne yeni puan ne bildirim kalır (atomik); aynı karar sonra geçer ve bir kez bildirir', async () => {
    const { t, submission } = await setup()
    const id = submission.id as string
    const { appealId, rowVersion } = await appealed(t, id)
    const before = await noticeRows(t.institution.id)
    await db.execute(sql`
      CREATE FUNCTION og021_fail_final() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'karar çakışması' USING ERRCODE = '40001';
      END $$ LANGUAGE plpgsql`)
    await db.execute(
      sql.raw(`CREATE TRIGGER og021_fail_final BEFORE INSERT ON rubric_scores
        FOR EACH ROW WHEN (NEW.rater_role = 'final') EXECUTE FUNCTION og021_fail_final()`),
    )
    try {
      const failed = await decide(id, appealId, t.cookies.colleague, rowVersion, UPHELD)
      assert.equal(failed.statusCode, 409, failed.body)
    } finally {
      await db.execute(sql`DROP TRIGGER og021_fail_final ON rubric_scores`)
      await db.execute(sql`DROP FUNCTION og021_fail_final()`)
    }
    assert.deepEqual(await noticeRows(t.institution.id), before)
    assert.equal((await storedRows(t.institution.id)).scores, 1)
    assert.equal((await ok(await detail(id, t.cookies.teacher))).versions[0].appeal.outcome, null)
    await ok(await decide(id, appealId, t.cookies.colleague, rowVersion, UPHELD))
    assert.equal(
      (await noticeRows(t.institution.id)).filter(([kind]) => kind === 'appeal_decided').length,
      2,
    )
  })

  for (const closed of ['communication', 'learning'] as const)
    test(`DOM-YTK-040, IST-065: ${closed} modülü kapanınca itiraz kararı (iletişimde yazılır, öğrenmede 403) appeal_decided bildirimi üretmez`, async () => {
      // Modül itiraz açıldıktan sonra kapanır: kapalı modülde itiraz ucu zaten 403 verir.
      const { t, submission } = await setup()
      const id = submission.id as string
      const { appealId, rowVersion } = await appealed(t, id)
      await db.execute(
        sql`UPDATE institutions SET enabled_modules = enabled_modules || ${JSON.stringify({ [closed]: false })}::jsonb WHERE id = ${t.institution.id}`,
      )
      const before = await noticeRows(t.institution.id)
      const response = await decide(id, appealId, t.cookies.colleague, rowVersion, REJECTED)
      if (closed === 'communication') await ok(response)
      else fails(response, 403, 'module_disabled')
      assert.deepEqual(await noticeRows(t.institution.id), before)
    })

  test('IST-065: başka kurumun itiraz kararı bu kurumun öğrenci ve velisine bildirim düşürmez', async () => {
    const { t, submission } = await setup()
    const { t: other, submission: otherSubmission } = await setup()
    const { appealId, rowVersion } = await appealed(other, otherSubmission.id as string)
    await ok(
      await decide(
        otherSubmission.id as string,
        appealId,
        other.cookies.colleague,
        rowVersion,
        REJECTED,
      ),
    )
    assert.deepEqual(await noticeRows(t.institution.id), [])
    for (const cookie of [t.cookies.student, t.cookies.parent, t.cookies.teacher])
      assert.deepEqual(await appealNotices(cookie), [])
    assert.equal(submission.id === otherSubmission.id, false)
    assert.equal(
      (await noticeRows(other.institution.id)).filter(([kind]) => kind === 'appeal_decided').length,
      2,
    )
  })

  // --- Açık itiraz kuyruğu (OG-1010; DOM-BEC-025) ---------------------------------------------

  const appealQueue = (cookie: string, query = 'page=1&pageSize=20') =>
    call('GET', `/task-appeals?${query}`, cookie)

  /**
   * İkinci rubrikli atama (varsayılan hedef 9-B) ve `s-3`'ün teslimi; puanlanmaz. Birinci
   * atamadan (9-A) ayrı bir kapsamdır; aynı içerikle çakışmamak için içerik verilebilir.
   */
  async function submittedInOtherClass(
    t: Tenant,
    options: { targets?: { kind: string; id: string }[]; resourceVersionId?: string } = {},
  ) {
    const assignment = await ok(
      await call(
        'POST',
        '/task-assignments',
        t.cookies.admin,
        {
          resourceVersionId: options.resourceVersionId ?? t.homeworkId,
          settings: {
            deadline: { dueAt: DUE },
            submission: { submissionKind: 'text', maxVersions: 1 },
            rubricVersionId: t.rubricVersionId,
          },
          targets: options.targets ?? [{ kind: 'class', id: '9-B' }],
        },
        key(),
      ),
      201,
    )
    const made = await ok(
      await call(
        'POST',
        `/task-assignments/${assignment.id}/submissions`,
        t.cookies.otherStudent,
        { submissionKind: 'text', body: SECRET_TEXT },
        key(),
      ),
      201,
    )
    return { assignmentId: assignment.id as string, submissionId: made.id as string }
  }

  /** Başka bir yayımlanmış ödev içeriği (aynı içerikle atama çakışması olmasın diye). */
  async function anotherHomework(t: Tenant) {
    return (
      await seedResource(db, t.institution.id, {
        ownerUserId: t.teacher.id,
        versions: [{ status: 'published', input: homework() }],
      })
    ).versions[0]!.id
  }

  /** `s-3` teslim eder, `t-mat` puanlar, `s-3` itiraz eder: `t-eng` onu görmez, `t-mat` ilkini görmez. */
  async function appealedInOtherClass(t: Tenant, resourceVersionId?: string) {
    const { submissionId } = await submittedInOtherClass(
      t,
      resourceVersionId === undefined ? {} : { resourceVersionId },
    )
    await ok(await score(submissionId, t.cookies.otherTeacher, 1), 201)
    const filed = await ok(await appeal(submissionId, t.cookies.otherStudent), 201)
    return { submissionId, appealId: filed.versions[0].appeal.id as string }
  }

  /** Servis çağrısındaki veritabanı sorgularını sayan bağlam (aynı PGlite istemcisi, sayaçlı günlükçü). */
  function countingContext(t: Tenant) {
    const counter = { queries: 0 }
    const counted = drizzle({
      client: (db as unknown as { $client: PGlite }).$client,
      schema,
      logger: {
        logQuery: () => {
          counter.queries += 1
        },
      },
    }) as unknown as Database
    const ctx: ServiceContext = {
      db: counted,
      institutionId: t.institution.id,
      actor: {
        userId: t.institution.admin.id,
        role: 'yonetici',
        membershipId: t.institution.adminMembershipId,
      },
      now,
      log: app.log,
    }
    return { counter, ctx }
  }

  test('DOM-BEC-025, DOM-YTK-028: açık itiraz kuyruğu 401; öğrenci, veli ve ön büro 403; modül kapalıyken 403; bilinmeyen ve geçersiz sorgu 400', async () => {
    const { t } = await setup()
    fails(await appealQueue(''), 401, 'unauthenticated')
    for (const cookie of [
      t.cookies.student,
      t.cookies.parent,
      t.cookies.otherStudent,
      t.cookies.frontDesk,
    ])
      fails(await appealQueue(cookie), 403, 'forbidden')
    for (const query of [
      'status=decided',
      'status=open&sort=filedAt',
      'institutionId=x',
      'pageSize=101',
      'page=0',
    ])
      fails(await appealQueue(t.cookies.admin, query), 400, 'validation_failed')
    const closed = await createInstitution(app, { enabledModules: { learning: false } })
    fails(await appealQueue(await signInAs(app, closed.admin)), 403, 'module_disabled')
  })

  test('DOM-BEC-025, DOM-YTK-028: öğretmen yalnız kapsamındaki açık itirazları görür, yönetici kurumun hepsini; satırda görev başlığı, öğrenci adı, açılma zamanı ve kimlikler var; yanıtta gerekçe yok; sayfalama', async () => {
    const { t, submission } = await setup()
    const { appealId } = await appealed(t, submission.id as string)
    const second = await appealedInOtherClass(t)
    const rows = async (cookie: string) => (await ok(await appealQueue(cookie))) as Json[]
    const ids = async (cookie: string) => (await rows(cookie)).map((row) => row.id)
    assert.deepEqual(await ids(t.cookies.teacher), [appealId])
    assert.deepEqual(await ids(t.cookies.colleague), [appealId])
    assert.deepEqual(await ids(t.cookies.otherTeacher), [second.appealId])
    // İki itiraz aynı anda açıldı (sabit saat): sıra `filedAt`, eşitte kimlik; yalnız küme sınanır.
    assert.deepEqual((await ids(t.cookies.admin)).sort(), [appealId, second.appealId].sort())
    const [row] = await rows(t.cookies.teacher)
    assert.deepEqual(
      [row?.submissionId, row?.assignmentTitle, row?.learnerName, row?.versionNumber],
      [submission.id, 'Hafta sonu yazısı', 'Deniz Yılmaz', 1],
    )
    assert.equal(row?.filedAt, FIXED_NOW.toISOString())
    assert.ok(row?.assignmentId && row?.versionId && row?.learnerId)
    const body = (await appealQueue(t.cookies.admin)).body
    for (const text of [APPEAL_REASON, FEEDBACK, SECRET_TEXT]) assert.ok(!body.includes(text))
    // Eşit zamanda sıra kimliğe göredir (rastgele UUID): sayfalar sıralı kimlik dizisini izler.
    const order = [appealId, second.appealId].sort()
    const paged = (await appealQueue(t.cookies.admin, 'page=2&pageSize=1')).json()
    assert.deepEqual(paged.meta, { page: 2, pageSize: 1, total: 2 })
    assert.deepEqual(
      paged.data.map((item: Json) => item.id),
      [order[1]],
    )
    const first = (await appealQueue(t.cookies.admin, 'page=1&pageSize=1')).json()
    assert.deepEqual(
      first.data.map((item: Json) => item.id),
      [order[0]],
    )
    const beyond = (await appealQueue(t.cookies.admin, 'page=3&pageSize=1')).json()
    assert.deepEqual([beyond.data, beyond.meta.total], [[], 2])
  })

  test('DOM-BEC-025: karara bağlanmış itiraz status=open listesinden çıkar ve toplam düşer; başka kurumun itirazı görünmez ve etkilenmez', async () => {
    const { t, submission } = await setup()
    const id = submission.id as string
    const { appealId, rowVersion } = await appealed(t, id)
    const { t: other, submission: otherSubmission } = await setup()
    const otherAppeal = await appealed(other, otherSubmission.id as string)
    for (const cookie of [t.cookies.admin, t.cookies.colleague]) {
      const response = (await appealQueue(cookie)).json()
      assert.deepEqual(
        response.data.map((row: Json) => row.id),
        [appealId],
      )
      assert.equal(response.meta.total, 1)
    }
    assert.ok(!(await appealQueue(t.cookies.admin)).body.includes(otherAppeal.appealId))
    await ok(await decide(id, appealId, t.cookies.colleague, rowVersion, REJECTED))
    for (const cookie of [t.cookies.admin, t.cookies.colleague, t.cookies.teacher]) {
      const response = (await appealQueue(cookie, 'status=open&page=1&pageSize=20')).json()
      assert.deepEqual([response.data, response.meta.total], [[], 0])
    }
    assert.deepEqual(
      ((await ok(await appealQueue(other.cookies.admin))) as Json[]).map((row) => row.id),
      [otherAppeal.appealId],
    )
  })

  test('DOM-BEC-025: scoredByViewer itirazlı sürümü puanlayan öğretmende true, diğer öğretmen ve yöneticide false (kuyruk ve teslim ayrıntısı); kursiyer ve veliye gitmez; true olan karar verirse 409 rater_not_independent', async () => {
    const { t, submission } = await setup()
    const id = submission.id as string
    const { appealId, rowVersion } = await appealed(t, id)
    const flag = async (cookie: string) =>
      ((await ok(await appealQueue(cookie))) as Json[])[0]?.scoredByViewer
    assert.equal(await flag(t.cookies.teacher), true)
    assert.equal(await flag(t.cookies.colleague), false)
    assert.equal(await flag(t.cookies.admin), false)
    const gradingOf = async (cookie: string) =>
      (await ok(await detail(id, cookie))).versions[0].grading.scoredByViewer
    assert.equal(await gradingOf(t.cookies.teacher), true)
    assert.equal(await gradingOf(t.cookies.colleague), false)
    assert.equal(await gradingOf(t.cookies.admin), false)
    for (const cookie of [t.cookies.student, t.cookies.parent])
      assert.equal((await ok(await detail(id, cookie))).versions[0].grading, null)
    fails(
      await decide(id, appealId, t.cookies.teacher, rowVersion, REJECTED),
      409,
      'rater_not_independent',
    )
    await ok(await decide(id, appealId, t.cookies.colleague, rowVersion, REJECTED))
  })

  test('DOM-YTK-027, OG-213: öğretmen kapsamı dışındaki öğrencinin itirazında learnerName null; yönetici ve kapsamındaki öğrencide ad gelir', async () => {
    const t = await tenant()
    // 9-A ve 9-B hedefli tek atama: `t-eng` atamayı 9-A yüzünden görür ama `s-3` onun öğrencisi değil.
    const { submissionId: other } = await submittedInOtherClass(t, {
      targets: [
        { kind: 'class', id: '9-A' },
        { kind: 'class', id: '9-B' },
      ],
    })
    await ok(await score(other, t.cookies.otherTeacher, 1), 201)
    const filed = await ok(await appeal(other, t.cookies.otherStudent), 201)
    const otherAppeal = filed.versions[0].appeal.id as string
    const names = async (cookie: string) =>
      Object.fromEntries(
        ((await ok(await appealQueue(cookie))) as Json[]).map((row) => [row.id, row.learnerName]),
      )
    assert.deepEqual(await names(t.cookies.teacher), { [otherAppeal]: null })
    assert.deepEqual(await names(t.cookies.admin), { [otherAppeal]: 'Can Arslan' })
    assert.ok(!(await appealQueue(t.cookies.teacher)).body.includes('Can Arslan'))
  })

  test('OG-1011: itiraz ve puanlama kuyruğu sayfadaki atamaları toplu yükler; sorgu sayısı atama sayısına bağlı değil', async () => {
    const { t } = await setup()
    // Birinci atama (9-A): `s-1` teslimi puanlanmamış, puanlama kuyruğunda. İkinci (9-B): itirazlı.
    await appealedInOtherClass(t)
    const { counter, ctx } = countingContext(t)
    const measure = async () => {
      counter.queries = 0
      const appeals = await listOpenAppeals(ctx, { page: 1, pageSize: 20 })
      const appealQueries = counter.queries
      counter.queries = 0
      const grading = await listGradingQueue(ctx, { page: 1, pageSize: 20 })
      return { appeals, grading, appealQueries, gradingQueries: counter.queries }
    }
    const one = await measure()
    assert.deepEqual([one.appeals.items.length, one.grading.items.length], [1, 1])
    // Üçüncü atama itirazlı, dördüncüsü puanlanmamış: her kuyrukta iki ayrı atama.
    await appealedInOtherClass(t, await anotherHomework(t))
    await submittedInOtherClass(t, { resourceVersionId: await anotherHomework(t) })
    const many = await measure()
    assert.deepEqual([many.appeals.items.length, many.grading.items.length], [2, 2])
    assert.equal(many.appealQueries, one.appealQueries)
    assert.equal(many.gradingQueries, one.gradingQueries)
  })
})
