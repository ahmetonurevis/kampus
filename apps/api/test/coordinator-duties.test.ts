import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { records } from '../src/db/schema/records.ts'
import { coordinatorDuties } from '../src/db/schema/coordinator-duties.ts'
import { rubrics, rubricScores, rubricVersions } from '../src/db/schema/skills.ts'
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
 * Zümre başkanı / akademik koordinatör ek görevi ve uyuşmazlıkta son puan (F4b3b2b;
 * DOM-YTK-027, DOM-BEC-024, DOM-BEC-045). Kural core `lib/coordinator-duties.ts` ve
 * `skills/rubric.ts`'tedir; burada rol × kapsam, kapsam dışı koordinatör, puanlayıcı-koordinatör
 * reddi, kursiyere sızıntı olmaması, son puanın geri bildirim bildirimi (F6a), başka kurum ve
 * modül kapalı denetlenir.
 */

type Json = ReturnType<typeof JSON.parse>

const DUE = '2026-10-20T20:59:00.000Z'
const SECRET_TEXT = 'GIZLI-YAZI my weekend was very nice'
const FEEDBACK = 'GIZLI-GERI-BILDIRIM paragraf düzeni iyi'
const FINAL_NOTE = 'GIZLI-SON-PUAN koordinatör kararı'

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

const scoreBody = (extra: Record<string, unknown> = {}) => ({
  versionNumber: 1,
  criteria: [
    { criterionId: 'task', band: 4, comment: null },
    { criterionId: 'grammar', band: 2, comment: 'Zaman uyumuna dikkat.' },
  ],
  overallComment: FEEDBACK,
  ...extra,
})
const disagreeing = () =>
  scoreBody({
    criteria: [
      { criterionId: 'task', band: 1, comment: 'Görev eksik kaldı.' },
      { criterionId: 'grammar', band: 2, comment: 'Zaman hataları var.' },
    ],
    overallComment: 'İkinci puanlayıcının yorumu.',
  })
const finalBody = () =>
  scoreBody({
    criteria: [
      { criterionId: 'task', band: 3, comment: null },
      { criterionId: 'grammar', band: 2, comment: 'Zaman uyumu.' },
    ],
    overallComment: FINAL_NOTE,
  })

describe('zümre başkanı ve akademik koordinatör', () => {
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
   * `t-eng` 9-A'nın, `t-mat` 9-B'nin öğretmenidir; `t-head` İngilizce branşındadır ama sınıfı
   * yoktur (atamayı görmez). Deniz (`s-1`) 9-A'dadır. Atamayı yönetici 9-A'ya yapar.
   */
  async function tenant(type: 'school' | 'language_school' = 'school') {
    now = FIXED_NOW
    clientIp = `10.1.${(tenantCount += 1)}.1`
    const institution = await createInstitution(app, { type })
    await insertMissingRecords(
      db,
      institution.id,
      [
        ...[
          ['t-eng', 'Selin Kaya', 'ingilizce'],
          ['t-mat', 'Murat Demir', 'matematik'],
          ['t-head', 'Zeynep Ak', 'ingilizce'],
        ].map(([id, name, subjectId]) => ({
          collection: 'teachers' as const,
          id: id!,
          data: { id, name, subjectId, branchId: 'b-1' },
        })),
        ...['9-A', '9-B'].map((id, index) => ({
          collection: 'classes' as const,
          id,
          data: { id, grade: 9, level: '9', branchId: 'b-1', teacherId: ['t-eng', 't-mat'][index] },
        })),
        {
          collection: 'students',
          id: 's-1',
          data: { id: 's-1', name: 'Deniz Yılmaz', classId: '9-A', isActive: true },
        },
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
    const users = {
      teacher: await member('ogretmen', 'teacher', 't-eng'),
      colleague: await member('ogretmen', 'teacher', 't-eng'),
      mathTeacher: await member('ogretmen', 'teacher', 't-mat'),
      head: await member('ogretmen', 'teacher', 't-head'),
      student: await member('ogrenci', 'student', 's-1'),
      parent: await member('veli', 'child', 's-1'),
      frontDesk: await createMember(app, institution.id, 'onburo'),
    }
    const cookies = {
      admin: await signInAs(app, institution.admin),
      teacher: await signInAs(app, users.teacher),
      colleague: await signInAs(app, users.colleague),
      mathTeacher: await signInAs(app, users.mathTeacher),
      head: await signInAs(app, users.head),
      student: await signInAs(app, users.student),
      parent: await signInAs(app, users.parent),
      frontDesk: await signInAs(app, users.frontDesk),
    }
    const homeworkId = (
      await seedResource(db, institution.id, {
        ownerUserId: users.teacher.id,
        versions: [{ status: 'published', input: homework() }],
      })
    ).versions[0]!.id
    const rubricId = randomUUID()
    const rubricVersionId = randomUUID()
    const at = { createdAt: FIXED_NOW, updatedAt: FIXED_NOW }
    await db
      .insert(rubrics)
      .values({ institutionId: institution.id, id: rubricId, ownerUserId: users.teacher.id, ...at })
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
    return { institution, users, cookies, homeworkId, rubricVersionId }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  function call(
    method: 'GET' | 'POST' | 'DELETE',
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

  const assign = (cookie: string, body: unknown, headers: Record<string, string> = key()) =>
    call('POST', '/coordinator-duties', cookie, body, headers)
  const remove = (cookie: string, dutyId: string, version?: number) =>
    call(
      'DELETE',
      `/coordinator-duties/${dutyId}`,
      cookie,
      undefined,
      version === undefined ? {} : match(version),
    )
  const dutyRows = (institutionId: string) =>
    db.select().from(coordinatorDuties).where(eq(coordinatorDuties.institutionId, institutionId))

  /** Yönetici 9-A'ya rubrikli yazma görevi atar; öğrenci teslim eder; iki puan uyuşmaz. */
  async function disputed(t: Tenant) {
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
          },
          targets: [{ kind: 'class', id: '9-A' }],
        },
        key(),
      ),
      201,
    )
    const submission = await ok(
      await call(
        'POST',
        `/task-assignments/${assignment.id}/submissions`,
        t.cookies.student,
        { submissionKind: 'text', body: SECRET_TEXT },
        key(),
      ),
      201,
    )
    const id = submission.id as string
    const post = (path: string, cookie: string, version: number, body: unknown) =>
      call('POST', `/task-submissions/${id}/${path}`, cookie, body, { ...match(version), ...key() })
    await ok(await post('second-rating-requests', t.cookies.admin, 1, { versionNumber: 1 }), 201)
    await ok(await post('scores', t.cookies.teacher, 2, scoreBody()), 201)
    await ok(await post('second-scores', t.cookies.colleague, 3, disagreeing()), 201)
    return { id, assignmentId: assignment.id as string, rowVersion: 4 }
  }
  const finalScore = (
    id: string,
    cookie: string,
    version: number,
    body: unknown = finalBody(),
    headers: Record<string, string> = key(),
  ) =>
    call('POST', `/task-submissions/${id}/final-scores`, cookie, body, {
      ...match(version),
      ...headers,
    })
  const detail = (id: string, cookie: string) => call('GET', `/task-submissions/${id}`, cookie)
  const queue = (cookie: string, extra = '') =>
    call('GET', `/task-submissions/grading-queue?page=1&pageSize=20${extra}`, cookie)
  async function learnerViews(t: Tenant, id: string, assignmentId: string) {
    const views: string[] = []
    for (const cookie of [t.cookies.student, t.cookies.parent])
      views.push(
        JSON.stringify(await ok(await detail(id, cookie))),
        JSON.stringify(
          await ok(await call('GET', `/task-submissions?assignmentId=${assignmentId}`, cookie)),
        ),
      )
    return views
  }

  test('DOM-YTK-027: yönetici zümre başkanlığını öğretmenin kendi branşında verir; 201 + Location, aynı anahtar tekrarı ikinci satır yazmaz, aynı görev 409; branş dışı, öğretmen olmayan ve kadro kaydı olmayan 422; başka kurumun üyeliği 404; kayıt değişmez', async () => {
    const t = await tenant()
    const body = { membershipId: t.users.head.membershipId, scopeId: 'ingilizce' }
    const headers = key()
    const response = await assign(t.cookies.admin, body, headers)
    const duty = await ok(response, 201)
    assert.equal(response.headers.location, `/api/v1/coordinator-duties/${duty.id}`)
    assert.deepEqual(
      [duty.membershipId, duty.kind, duty.scopeId, duty.archivedAt, duty.rowVersion],
      [t.users.head.membershipId, 'subject_head', 'ingilizce', null, 1],
    )
    const replay = await assign(t.cookies.admin, body, headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(await ok(replay, 201), duty)
    fails(await assign(t.cookies.admin, body), 409, 'coordinator_duty_exists')
    fails(
      await assign(t.cookies.admin, { ...body, scopeId: 'matematik' }),
      422,
      'duty_outside_branch',
    )
    fails(
      await assign(t.cookies.admin, { membershipId: t.users.student.membershipId, scopeId: 'x' }),
      422,
      'duty_requires_teacher',
    )
    const unlinked = await createMember(app, t.institution.id, 'ogretmen')
    fails(
      await assign(t.cookies.admin, { membershipId: unlinked.membershipId, scopeId: 'ingilizce' }),
      422,
      'teacher_record_required',
    )
    const other = await createInstitution(app)
    const stranger = await createMember(app, other.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-head' } as never,
    ])
    fails(
      await assign(t.cookies.admin, { membershipId: stranger.membershipId, scopeId: 'ingilizce' }),
      404,
      'not_found',
    )
    fails(
      await assign(t.cookies.admin, { ...body, kind: 'subject_head' }),
      400,
      'validation_failed',
    )
    fails(await assign(t.cookies.admin, body, {}), 400, 'idempotency_key_required')
    assert.equal((await dutyRows(t.institution.id)).length, 1)
  })

  test('DOM-YTK-027: rol × kapsam: oturumsuz 401; öğretmen, öğrenci, veli ve ön büro atayamaz ve kaldıramaz (403); öğretmen yalnız kendi görevini okur, başkasınınki 404; başka kurumun yöneticisi 404', async () => {
    const t = await tenant()
    const duty = await ok(
      await assign(t.cookies.admin, {
        membershipId: t.users.head.membershipId,
        scopeId: 'ingilizce',
      }),
      201,
    )
    const body = { membershipId: t.users.teacher.membershipId, scopeId: 'ingilizce' }
    fails(await assign('', body), 401, 'unauthenticated')
    for (const cookie of [
      t.cookies.teacher,
      t.cookies.student,
      t.cookies.parent,
      t.cookies.frontDesk,
    ]) {
      fails(await assign(cookie, body), 403, 'forbidden')
      fails(await remove(cookie, duty.id, 1), 403, 'forbidden')
    }
    for (const cookie of [t.cookies.student, t.cookies.parent, t.cookies.frontDesk])
      fails(await call('GET', '/coordinator-duties', cookie), 403, 'forbidden')
    assert.deepEqual(
      (await ok(await call('GET', '/coordinator-duties', t.cookies.head))).map(
        (row: Json) => row.id,
      ),
      [duty.id],
    )
    assert.deepEqual(
      await ok(await call('GET', `/coordinator-duties/${duty.id}`, t.cookies.head)),
      duty,
    )
    assert.deepEqual(await ok(await call('GET', '/coordinator-duties', t.cookies.teacher)), [])
    assert.deepEqual(
      await ok(
        await call(
          'GET',
          `/coordinator-duties?membershipId=${t.users.head.membershipId}`,
          t.cookies.teacher,
        ),
      ),
      [],
    )
    fails(await call('GET', `/coordinator-duties/${duty.id}`, t.cookies.teacher), 404, 'not_found')
    fails(
      await call('GET', '/coordinator-duties?unknown=1', t.cookies.admin),
      400,
      'validation_failed',
    )
    const other = await signInAs(app, (await createInstitution(app)).admin)
    fails(await call('GET', `/coordinator-duties/${duty.id}`, other), 404, 'not_found')
    fails(await remove(other, duty.id, 1), 404, 'not_found')
    assert.deepEqual(await ok(await call('GET', '/coordinator-duties', other)), [])
    assert.equal((await dutyRows(t.institution.id)).length, 1)
  })

  test('DOM-YTK-027: kaldırma arşivdir: If-Match yoksa 400, eski sürüm 409, kaldırılan görev 404; aynı görev yeniden verilebilir; denetime yalnız alan adları', async () => {
    const t = await tenant()
    const body = { membershipId: t.users.head.membershipId, scopeId: 'ingilizce' }
    const duty = await ok(await assign(t.cookies.admin, body), 201)
    fails(await remove(t.cookies.admin, duty.id), 400, 'if_match_required')
    fails(await remove(t.cookies.admin, duty.id, 2), 409, 'version_conflict')
    const removed = await ok(await remove(t.cookies.admin, duty.id, 1))
    assert.equal(removed.archivedAt, FIXED_NOW.toISOString())
    assert.equal(removed.rowVersion, 2)
    fails(await remove(t.cookies.admin, duty.id, 2), 404, 'not_found')
    fails(await call('GET', `/coordinator-duties/${duty.id}`, t.cookies.admin), 404, 'not_found')
    assert.deepEqual(await ok(await call('GET', '/coordinator-duties', t.cookies.head)), [])
    await ok(await assign(t.cookies.admin, body), 201)
    const audits = await db
      .select({ action: auditLog.action, changes: auditLog.changes })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.institution.id),
          eq(auditLog.entityType, 'coordinator_duty'),
        ),
      )
    assert.deepEqual(audits, [
      {
        action: 'coordinator_duty.assign',
        changes: { fields: ['membershipId', 'kind', 'scopeId'] },
      },
      { action: 'coordinator_duty.remove', changes: { fields: ['archivedAt'] } },
      {
        action: 'coordinator_duty.assign',
        changes: { fields: ['membershipId', 'kind', 'scopeId'] },
      },
    ])
  })

  test('DOM-YTK-027: dil okulunda akademik koordinatör CEFR seviyesiyle atanır; geçersiz seviye 422', async () => {
    const t = await tenant('language_school')
    const duty = await ok(
      await assign(t.cookies.admin, { membershipId: t.users.head.membershipId, scopeId: 'B1+' }),
      201,
    )
    assert.deepEqual([duty.kind, duty.scopeId], ['academic_coordinator', 'B1+'])
    fails(
      await assign(t.cookies.admin, { membershipId: t.users.head.membershipId, scopeId: 'C1+' }),
      422,
      'invalid_cefr_level',
    )
  })

  test('DOM-BEC-024, DOM-YTK-027: uyuşmazlıkta son puanı kapsamındaki koordinatör verir; atamayı görmese de uyuşmazlıklı teslimi okur ve iki puanı görür; kapsam dışı koordinatör 404, koordinatör olmayan 403, puanlayıcı-koordinatör 409, yönetici 403; kursiyere son puana kadar hiçbir şey açılmaz', async () => {
    const t = await tenant()
    const { id, assignmentId, rowVersion } = await disputed(t)
    const before = await learnerViews(t, id, assignmentId)
    // Görev verilmeden zümre başkanı adayı teslimi göremez.
    fails(await detail(id, t.cookies.head), 404, 'not_found')
    assert.deepEqual(await ok(await queue(t.cookies.head)), [])
    for (const [user, scopeId] of [
      [t.users.head, 'ingilizce'],
      [t.users.teacher, 'ingilizce'],
      [t.users.mathTeacher, 'matematik'],
    ] as const)
      await ok(await assign(t.cookies.admin, { membershipId: user.membershipId, scopeId }), 201)

    const seen = await ok(await detail(id, t.cookies.head))
    const grading = seen.versions[0].grading
    assert.deepEqual(
      [grading.status, grading.canResolve, grading.raterScores.map((row: Json) => row.raterRole)],
      ['disagreement', true, ['first', 'second']],
    )
    assert.equal(seen.versions[0].score.settled, false)
    // Puanlayıcı-koordinatör kör kalır: yalnız kendi puanını görür, son puanı veremez.
    const rater = (await ok(await detail(id, t.cookies.teacher))).versions[0].grading
    assert.deepEqual(
      [rater.canResolve, rater.raterScores.map((row: Json) => row.raterRole)],
      [false, ['first']],
    )
    // Teslim listesi koordinatöre açılmaz; yalnız uyuşmazlıklı teslim tek tek okunur.
    fails(
      await call('GET', `/task-submissions?assignmentId=${assignmentId}`, t.cookies.head),
      404,
      'not_found',
    )

    for (const cookie of [t.cookies.head, t.cookies.admin]) {
      const rows = await ok(await queue(cookie, '&awaiting=resolution'))
      assert.deepEqual(
        rows.map((row: Json) => [
          row.id,
          row.assignmentTitle,
          row.grading.awaitingResolution,
          row.grading.overdue,
        ]),
        // Atamayı görmeyen koordinatör de görev başlığını kuyruktan okur (OG-058).
        [[id, 'Hafta sonu yazısı', true, false]],
      )
    }
    assert.deepEqual(await ok(await queue(t.cookies.head, '&awaiting=first')), [])
    assert.deepEqual(await ok(await queue(t.cookies.mathTeacher, '&awaiting=resolution')), [])
    // Süre aşımı koordinatör satırında da görünür (DOM-BEC-025).
    now = new Date(Date.parse(DUE) + 7 * 24 * 3_600_000 + 1)
    const [late] = await ok(await queue(t.cookies.head, '&awaiting=resolution&overdue=true'))
    assert.equal(late.grading.overdue, true)

    fails(await finalScore(id, t.cookies.admin, rowVersion), 403, 'forbidden')
    fails(await finalScore(id, t.cookies.student, rowVersion), 403, 'forbidden')
    fails(await finalScore(id, t.cookies.mathTeacher, rowVersion), 404, 'not_found')
    fails(await finalScore(id, t.cookies.colleague, rowVersion), 403, 'coordinator_required')
    fails(await finalScore(id, t.cookies.teacher, rowVersion), 409, 'rater_not_independent')
    fails(await finalScore(id, t.cookies.head, rowVersion + 1), 409, 'version_conflict')
    fails(
      await finalScore(id, t.cookies.head, rowVersion, finalBody(), {}),
      400,
      'idempotency_key_required',
    )
    fails(
      await finalScore(id, t.cookies.head, rowVersion, { ...finalBody(), total: 9 }),
      400,
      'validation_failed',
    )
    assert.deepEqual(await learnerViews(t, id, assignmentId), before)
    for (const view of before)
      for (const text of ['GIZLI-GERI-BILDIRIM', 'İkinci puanlayıcının', 'GIZLI-SON-PUAN'])
        assert.ok(!view.includes(text), 'kursiyere puan sızdı')

    const resolved = await finalScore(id, t.cookies.head, rowVersion)
    const data = await ok(resolved, 201)
    assert.equal(resolved.headers.location, `/api/v1/task-submissions/${id}`)
    assert.deepEqual(
      [
        data.versions[0].grading.status,
        data.versions[0].score.settled,
        data.versions[0].score.overallComment,
      ],
      ['settled', true, FINAL_NOTE],
    )
    fails(await finalScore(id, t.cookies.head, rowVersion + 1), 409, 'final_score_not_needed')
    // Son puan sonucu kesinleştirir; geri bildirim açılır (DOM-BEC-045).
    const learner = await ok(await detail(id, t.cookies.student))
    assert.equal(learner.versions[0].score.overallComment, FINAL_NOTE)
    assert.equal(learner.versions[0].grading, null)
    assert.deepEqual(await ok(await queue(t.cookies.head, '&awaiting=resolution')), [])
    // Görev kaldırılınca koordinatör erişimi biter.
    const [duty] = await ok(
      await call(
        'GET',
        `/coordinator-duties?membershipId=${t.users.head.membershipId}`,
        t.cookies.admin,
      ),
    )
    await ok(await remove(t.cookies.admin, duty.id, duty.rowVersion))
    fails(await detail(id, t.cookies.head), 404, 'not_found')
    const finals = await db
      .select()
      .from(rubricScores)
      .where(
        and(eq(rubricScores.institutionId, t.institution.id), eq(rubricScores.raterRole, 'final')),
      )
    assert.equal(finals.length, 1)
  })

  test('DOM-BEC-024, DOM-YTK-027: atamayı gören koordinatör ikinci puan beklenirken ilk puanı kuyrukta ve ayrıntıda görmez; ikinci puanı verince de kör kalır, son puanı veremez', async () => {
    const t = await tenant()
    // Zümre başkanı aynı zamanda 9-A'nın öğretmeni (`t-eng`): atamayı görür.
    await ok(
      await assign(t.cookies.admin, {
        membershipId: t.users.colleague.membershipId,
        scopeId: 'ingilizce',
      }),
      201,
    )
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
          },
          targets: [{ kind: 'class', id: '9-A' }],
        },
        key(),
      ),
      201,
    )
    const id = (
      await ok(
        await call(
          'POST',
          `/task-assignments/${assignment.id}/submissions`,
          t.cookies.student,
          { submissionKind: 'text', body: SECRET_TEXT },
          key(),
        ),
        201,
      )
    ).id as string
    const post = (path: string, cookie: string, version: number, body: unknown) =>
      call('POST', `/task-submissions/${id}/${path}`, cookie, body, { ...match(version), ...key() })
    await ok(await post('second-rating-requests', t.cookies.admin, 1, { versionNumber: 1 }), 201)
    await ok(await post('scores', t.cookies.teacher, 2, scoreBody()), 201)

    const blindRow = async () => {
      const rows = await ok(await queue(t.cookies.colleague))
      return rows.find((row: Json) => row.id === id)
    }
    assert.equal((await blindRow()).latestVersion.score, null)
    const pending = (await ok(await detail(id, t.cookies.colleague))).versions[0]
    assert.deepEqual(
      [pending.score, pending.grading.raterScores, pending.grading.canResolve],
      [null, [], false],
    )
    assert.ok(!JSON.stringify(pending).includes('GIZLI-GERI-BILDIRIM'), 'ilk puan sızdı')

    // İkinci puanı kendisi verir; o sürümün puanlayıcısı olduğu için kör kalır.
    await ok(await post('second-scores', t.cookies.colleague, 3, disagreeing()), 201)
    const rated = (await ok(await detail(id, t.cookies.colleague))).versions[0].grading
    assert.deepEqual(
      [rated.status, rated.canResolve, rated.raterScores.map((row: Json) => row.raterRole)],
      ['disagreement', false, ['second']],
    )
    fails(await finalScore(id, t.cookies.colleague, 4), 409, 'rater_not_independent')
  })

  /**
   * Üç uyuşmazlık: `own` İngilizce teslimi `teacher` ile `colleague` puanlar, `english` ile `math`
   * teslimlerini `colleague` ile `extra` puanlar (`math` matematik içeriğidir). Hepsi 9-A'dadır;
   * `teacher` (zümre başkanı, 9-A öğretmeni) üçünü de atama olarak görür.
   */
  async function disputeSet(t: Tenant) {
    const extra = await createMember(app, t.institution.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-eng' } as never,
    ])
    const extraCookie = await signInAs(app, extra)
    const seed = async (subjectId: string, title: string) =>
      (
        await seedResource(db, t.institution.id, {
          ownerUserId: t.users.teacher.id,
          versions: [
            {
              status: 'published',
              input: {
                ...homework(),
                title,
                tags: { ...homework().tags!, subjectId },
              } as Partial<ResourceVersionInput>,
            },
          ],
        })
      ).versions[0]!.id
    const englishHomework = await seed('ingilizce', 'İkinci yazı')
    const mathHomework = await seed('matematik', 'Problem çözümü')
    const dispute = async (resourceVersionId: string, first: string, second: string) => {
      const assignment = await ok(
        await call(
          'POST',
          '/task-assignments',
          t.cookies.admin,
          {
            resourceVersionId,
            settings: {
              deadline: { dueAt: DUE },
              submission: { submissionKind: 'text', maxVersions: 1 },
              rubricVersionId: t.rubricVersionId,
            },
            targets: [{ kind: 'class', id: '9-A' }],
          },
          key(),
        ),
        201,
      )
      const id = (
        await ok(
          await call(
            'POST',
            `/task-assignments/${assignment.id}/submissions`,
            t.cookies.student,
            { submissionKind: 'text', body: SECRET_TEXT },
            key(),
          ),
          201,
        )
      ).id as string
      const post = (path: string, cookie: string, version: number, body: unknown) =>
        call('POST', `/task-submissions/${id}/${path}`, cookie, body, {
          ...match(version),
          ...key(),
        })
      await ok(await post('second-rating-requests', t.cookies.admin, 1, { versionNumber: 1 }), 201)
      await ok(await post('scores', first, 2, scoreBody()), 201)
      await ok(await post('second-scores', second, 3, disagreeing()), 201)
      return id
    }
    for (const [user, scopeId] of [
      [t.users.head, 'ingilizce'],
      [t.users.teacher, 'ingilizce'],
      [t.users.mathTeacher, 'matematik'],
    ] as const)
      await ok(await assign(t.cookies.admin, { membershipId: user.membershipId, scopeId }), 201)
    return {
      own: await dispute(t.homeworkId, t.cookies.teacher, t.cookies.colleague),
      english: await dispute(englishHomework, t.cookies.colleague, extraCookie),
      math: await dispute(mathHomework, t.cookies.colleague, extraCookie),
    }
  }
  const resolutionIds = async (cookie: string, extra = '') =>
    (await ok(await queue(cookie, `&awaiting=resolution${extra}`))).map((row: Json) => row.id)

  test('OG-058, DOM-YTK-027: uyuşmazlık kuyruğu alan dışını listelemez: İngilizce zümre başkanı kendi sınıfındaki matematik uyuşmazlığını görmez; matematik koordinatörü atamayı görmese de listeler', async () => {
    const t = await tenant()
    const { math, english } = await disputeSet(t)
    const teacherIds = await resolutionIds(t.cookies.teacher)
    assert.ok(!teacherIds.includes(math), 'alan dışı uyuşmazlık kuyrukta')
    assert.ok(teacherIds.includes(english))
    assert.deepEqual(await resolutionIds(t.cookies.mathTeacher), [math])
    assert.ok(!(await resolutionIds(t.cookies.head)).includes(math))
  })

  test('OG-058, DOM-BEC-024: uyuşmazlık kuyruğu kişinin kendi puanladığı teslimi listelemez; son puanı veremeyeceği satır kuyrukta yoktur', async () => {
    const t = await tenant()
    const { own, english } = await disputeSet(t)
    assert.ok(!(await resolutionIds(t.cookies.teacher)).includes(own), 'kendi puanladığı kuyrukta')
    fails(await finalScore(own, t.cookies.teacher, 4), 409, 'rater_not_independent')
    // İkinci puanlayıcı da son puanı veremez.
    assert.ok(!(await resolutionIds(t.cookies.colleague)).includes(english))
    // Aynı teslim başka koordinatörde listelenir.
    assert.ok((await resolutionIds(t.cookies.head)).includes(own))
  })

  test('OG-058, DOM-BEC-024, DOM-YTK-027: alanındaki ve puanlamadığı uyuşmazlık listelenir; toplam ve sayfalama süzülmüş satırlar üzerindendir; yönetici davranışı değişmez', async () => {
    const t = await tenant()
    const { own, english, math } = await disputeSet(t)
    assert.deepEqual(await resolutionIds(t.cookies.teacher), [english])
    assert.deepEqual((await resolutionIds(t.cookies.head)).sort(), [english, own].sort())
    const paged = await queue(t.cookies.head, '&awaiting=resolution&pageSize=1')
    assert.equal(paged.json().data.length, 1)
    assert.equal(paged.json().meta.total, 2)
    const second = await queue(t.cookies.head, '&awaiting=resolution&pageSize=1&page=2')
    assert.deepEqual([second.json().data.length, second.json().meta.total], [1, 2])
    const teacherPage = await queue(t.cookies.teacher, '&awaiting=resolution&pageSize=1')
    assert.deepEqual([teacherPage.json().data.length, teacherPage.json().meta.total], [1, 1])
    assert.deepEqual((await resolutionIds(t.cookies.admin)).sort(), [english, math, own].sort())
  })

  /** Kurumun bildirim kayıtları (F6a): alıcı kitlesi, öğrenci ve konu teslimi. */
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
  /** Aktörün `feedback_released` bildirimleri (liste ucundan). */
  async function feedbackNotices(cookie: string) {
    const list = (await ok(await call('GET', '/notifications', cookie))) as Json[]
    return list
      .filter((n) => n.kind === 'feedback_released')
      .map((n) => [n.audience, n.studentId, n.subject.id] as const)
  }

  test('DOM-BEC-045, DOM-BEC-024, DOM-YTK-027, DOM-ILT-023: uyuşmazlıkta geri bildirimi açan koordinatör son puanı aynı işlemde öğrenciye ve veliye tek feedback_released bildirimi yazar; uyuşmazlığa kadar ve reddedilen son puanda bildirim yok; bildirimde puan ve metin yok', async () => {
    const t = await tenant()
    await ok(
      await assign(t.cookies.admin, {
        membershipId: t.users.head.membershipId,
        scopeId: 'ingilizce',
      }),
      201,
    )
    const { id, rowVersion } = await disputed(t)
    // İkinci puan bekleyen ilk puan ve uyuşmayan ikinci puan geri bildirimi açmaz.
    assert.deepEqual(await noticeRows(t.institution.id), [])
    fails(await finalScore(id, t.cookies.head, rowVersion + 1), 409, 'version_conflict')
    fails(await finalScore(id, t.cookies.colleague, rowVersion), 403, 'coordinator_required')
    assert.deepEqual(await noticeRows(t.institution.id), [])

    await ok(await finalScore(id, t.cookies.head, rowVersion), 201)
    assert.deepEqual(await noticeRows(t.institution.id), [
      ['feedback_released', 'parent', 's-1', id],
      ['feedback_released', 'student', 's-1', id],
    ])
    assert.deepEqual(await feedbackNotices(t.cookies.student), [['student', 's-1', id]])
    assert.deepEqual(await feedbackNotices(t.cookies.parent), [['parent', 's-1', id]])
    for (const cookie of [t.cookies.head, t.cookies.teacher])
      assert.deepEqual(await feedbackNotices(cookie), [])
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const body = (await call('GET', '/notifications', cookie)).body
      for (const text of ['GIZLI-', 'percent', 'band']) assert.ok(!body.includes(text), text)
    }
    // Kesinleşmiş sonuca ikinci son puan reddedilir; yeni bildirim üretilmez.
    fails(await finalScore(id, t.cookies.head, rowVersion + 1), 409, 'final_score_not_needed')
    assert.equal((await noticeRows(t.institution.id)).length, 2)
    const [audit] = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.institution.id),
          eq(auditLog.action, 'task_submission.final_score'),
        ),
      )
    assert.deepEqual(audit?.changes, { fields: ['criteria', 'overallComment', 'scoredAt'] })
  })

  test('DOM-BEC-045, DOM-BEC-024: son puanın yazılması işlem içinde başarısız olursa ne puan ne bildirim kalır (atomik); aynı istek sonra geçer ve bir kez bildirir', async () => {
    const t = await tenant()
    await ok(
      await assign(t.cookies.admin, {
        membershipId: t.users.head.membershipId,
        scopeId: 'ingilizce',
      }),
      201,
    )
    const { id, rowVersion } = await disputed(t)
    // Son puan satırı yazılırken serileştirme hatası: bildirim aynı işlemde geri alınmalı.
    await db.execute(sql`
      CREATE FUNCTION og003_fail_final() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'son puan çakışması' USING ERRCODE = '40001';
      END $$ LANGUAGE plpgsql`)
    await db.execute(
      sql.raw(`CREATE TRIGGER og003_fail_final BEFORE INSERT ON rubric_scores
        FOR EACH ROW WHEN (NEW.rater_role = 'final') EXECUTE FUNCTION og003_fail_final()`),
    )
    try {
      const failed = await finalScore(id, t.cookies.head, rowVersion)
      assert.equal(failed.statusCode, 409, failed.body)
    } finally {
      await db.execute(sql`DROP TRIGGER og003_fail_final ON rubric_scores`)
      await db.execute(sql`DROP FUNCTION og003_fail_final()`)
    }
    assert.deepEqual(await noticeRows(t.institution.id), [])
    const finals = await db
      .select({ id: rubricScores.id })
      .from(rubricScores)
      .where(
        and(eq(rubricScores.institutionId, t.institution.id), eq(rubricScores.raterRole, 'final')),
      )
    assert.equal(finals.length, 0)
    await ok(await finalScore(id, t.cookies.head, rowVersion), 201)
    assert.deepEqual(await feedbackNotices(t.cookies.student), [['student', 's-1', id]])
    assert.equal((await noticeRows(t.institution.id)).length, 2)
  })

  test('DOM-YTK-027: görev öğrenci bazında not yazma yetkisi vermez: atamayı görmeyen koordinatör ilk ve ikinci puan veremez (404); log ve denetimde metin yok; başka kurum 404; modül kapalı 403', async () => {
    const t = await tenant()
    await ok(
      await assign(t.cookies.admin, {
        membershipId: t.users.head.membershipId,
        scopeId: 'ingilizce',
      }),
      201,
    )
    const { id, rowVersion } = await disputed(t)
    const from = logs.length
    for (const path of ['scores', 'second-scores'])
      fails(
        await call('POST', `/task-submissions/${id}/${path}`, t.cookies.head, scoreBody(), {
          ...match(rowVersion),
          ...key(),
        }),
        404,
        'not_found',
      )
    await ok(await finalScore(id, t.cookies.head, rowVersion), 201)
    const written = logs.slice(from).join('\n')
    assert.ok(written.includes('task_submission.final_score'), 'işlem logu yok')
    for (const text of ['s-1', 'GIZLI-']) assert.ok(!written.includes(text), `${text} loglandı`)
    const [audit] = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.institution.id),
          eq(auditLog.action, 'task_submission.final_score'),
        ),
      )
    assert.deepEqual(audit?.changes, { fields: ['criteria', 'overallComment', 'scoredAt'] })

    const other = await createInstitution(app)
    const outsider = await createMember(app, other.id, 'ogretmen')
    fails(await finalScore(id, await signInAs(app, outsider), 1), 404, 'not_found')
    const closed = await createInstitution(app, { enabledModules: { learning: false } })
    const closedTeacher = await createMember(app, closed.id, 'ogretmen')
    fails(
      await finalScore(randomUUID(), await signInAs(app, closedTeacher), 1),
      403,
      'module_disabled',
    )
  })
})
