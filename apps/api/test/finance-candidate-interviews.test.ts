import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  candidateInterviewEvaluations,
  candidateInterviews,
  interviewTemplateVersions,
} from '../src/db/schema/finance-candidate-interviews.ts'
import { ensureMember } from '../src/services/identity.ts'
import {
  buildTestApp,
  createInstitution,
  createUser,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * Aday değerlendirme ve mülakat uçları (DOM-FIN-138; ON-178; K-469…K-471). Her test kendi kurumunu
 * kurar. FIXED_NOW 2026-10-06T09:00Z.
 */

const FINANCE = '/api/v1/finance'
const TEMPLATES = `${FINANCE}/interview-templates`
const OBSERVATION_TEMPLATES = `${FINANCE}/lesson-observation-templates`
const INTERVIEWS = `${FINANCE}/candidate-interviews`
const ASSIGNED = `${INTERVIEWS}/assigned`
const POSTINGS = `${FINANCE}/job-postings`
const APPLICATIONS = `${FINANCE}/job-applications`
const ANONYMIZE = `${FINANCE}/job-application-anonymizations`
const PAST = '2026-10-05T10:00:00+03:00'
const FUTURE = '2026-10-09T10:00:00+03:00'

const TEMPLATE = {
  name: 'Öğretmen mülakat formu',
  scaleMax: 5,
  criteria: [
    { title: 'Alan bilgisi', weight: 2 },
    { title: 'İletişim', weight: 1 },
  ],
}
const levels = [0, 1, 2, 3, 4, 5].map((level) => ({ level, description: `Seviye ${level}` }))
const OBSERVATION_TEMPLATE = {
  name: 'Ders gözlem formu',
  criteria: [
    { title: 'Sınıf yönetimi', weight: 2, levels },
    { title: 'Öğrenci katılımı', weight: 1, levels },
  ],
}

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-138: aday mülakatı ve değerlendirme uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.178.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    cookie: string | null,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const get = (url: string, cookie: string | null) => call('GET', url, cookie)
  const post = (url: string, cookie: string | null, body: unknown, key: string = randomUUID()) =>
    call('POST', url, cookie, body, { 'idempotency-key': key })
  const versioned = (
    method: 'POST' | 'PATCH',
    url: string,
    cookie: string | null,
    body: unknown,
    version: unknown,
  ) => call(method, url, cookie, body, { 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.178.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return {
      id: created.id,
      admin: await signInAs(app, created.admin),
      adminMembershipId: created.adminMembershipId,
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  async function person(t: Tenant, role: Role, name: string) {
    const user = await createUser(app, { name })
    const membership = await ensureMember(app.auth, db, {
      institutionId: t.id,
      userId: user.id,
      role,
    })
    return { membershipId: membership.id, cookie: await signInAs(app, user) }
  }

  /** Yayında ilan, başvuru ve istenen aşama. */
  async function application(t: Tenant, stage: 'interview' | 'screening' = 'interview') {
    const draft = ok(
      await post(POSTINGS, t.admin, {
        title: 'İngilizce öğretmeni',
        position: 'İngilizce öğretmeni',
        employmentType: 'full_time',
        description: 'Ortaokul İngilizce dersleri için öğretmen arıyoruz.',
        publishOn: '2026-09-01',
        deadlineOn: '2026-10-31',
      }),
      201,
    )
    ok(
      await versioned(
        'POST',
        `${POSTINGS}/${String(draft.id)}/status`,
        t.admin,
        { status: 'published' },
        draft.version,
      ),
    )
    const created = ok(
      await post(APPLICATIONS, t.admin, {
        jobPostingId: draft.id,
        candidateName: 'Deniz Aday',
        email: `aday-${randomUUID()}@ornek.com`,
        channel: 'email',
        receivedOn: '2026-09-10',
        privacyNoticeVersion: 'v1',
        privacyNoticeShownOn: '2026-09-10',
      }),
      201,
    )
    return ok(
      await versioned(
        'POST',
        `${APPLICATIONS}/${String(created.id)}/stage`,
        t.admin,
        { stage, changedOn: '2026-10-01' },
        created.version,
      ),
    )
  }
  const template = async (t: Tenant) => ok(await post(TEMPLATES, t.admin, TEMPLATE), 201)
  const interviewsUrl = (app: Json) => `${APPLICATIONS}/${String(app.id)}/interviews`
  const plan = (cookie: string | null, app: Json, body: Json, key?: string) =>
    post(
      interviewsUrl(app),
      cookie,
      {
        type: 'in_person',
        scheduledAt: PAST,
        location: 'Müdür odası',
        ...body,
      },
      key,
    )
  const complete = (cookie: string | null, row: Json) =>
    versioned('POST', `${INTERVIEWS}/${String(row.id)}/complete`, cookie, {}, row.version)
  const evaluate = (cookie: string | null, row: Json, body: Json, key?: string) =>
    post(`${INTERVIEWS}/${String(row.id)}/evaluation`, cookie, body, key)
  const interviewRows = (institutionId: string) =>
    db
      .select()
      .from(candidateInterviews)
      .where(eq(candidateInterviews.institutionId, institutionId))

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    assertError(await get(TEMPLATES, null), 401)
    assertError(await post(TEMPLATES, null, TEMPLATE), 401)
    assertError(await get(`${APPLICATIONS}/${id}/interviews`, null), 401)
    assertError(await post(`${APPLICATIONS}/${id}/interviews`, null, {}), 401)
    assertError(await get(ASSIGNED, null), 401)
    assertError(await versioned('PATCH', `${INTERVIEWS}/${id}`, null, { location: 'x' }, 1), 401)
    assertError(await versioned('POST', `${INTERVIEWS}/${id}/complete`, null, {}, 1), 401)
    assertError(await versioned('POST', `${INTERVIEWS}/${id}/cancel`, null, {}, 1), 401)
    assertError(await post(`${INTERVIEWS}/${id}/evaluation`, null, {}), 401)
  })

  test('DOM-FIN-138: ön büro ve öğretmen yönetici uçlarında 403; ön büro değerlendirici listesinde 403; modül kapalı 403', async () => {
    const t = await institution()
    const desk = await person(t, 'onburo', 'Ön Büro')
    const teacher = await person(t, 'ogretmen', 'Selin Kaya')
    const app1 = await application(t)
    for (const cookie of [desk.cookie, teacher.cookie]) {
      assertError(await get(TEMPLATES, cookie), 403)
      assertError(await post(TEMPLATES, cookie, TEMPLATE), 403)
      assertError(await get(interviewsUrl(app1), cookie), 403)
      assertError(await plan(cookie, app1, {}), 403)
    }
    assertError(await get(ASSIGNED, desk.cookie), 403)
    assert.equal((await get(ASSIGNED, teacher.cookie)).statusCode, 200)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(TEMPLATES, closed.admin), 403, 'module_disabled')
    assertError(await get(ASSIGNED, closed.admin), 403, 'module_disabled')
  })

  test('DOM-FIN-138 K-469 K-470: plan, yapıldı, değerlendirici formu bir kez, puan sunucuda; özet ve teklif kapısı', async () => {
    const t = await institution()
    const form = await template(t)
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const app1 = await application(t)
    const key = randomUUID()
    const body = {
      templateId: form.id,
      evaluatorMembershipIds: [t.adminMembershipId, selin.membershipId],
    }
    const planned = ok(await plan(t.admin, app1, body, key), 201)
    assert.equal(planned.status, 'planned')
    assert.equal(planned.evaluatorCount, 2)
    assert.equal((planned.form as Json).versionNumber, 1)
    const replay = await plan(t.admin, app1, body, key)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await interviewRows(t.id)).length, 1)

    // Teklif kapısı: yapılmış mülakat yokken 422 (K-469).
    assertError(
      await versioned(
        'POST',
        `${APPLICATIONS}/${String(app1.id)}/stage`,
        t.admin,
        { stage: 'offer', changedOn: '2026-10-06' },
        app1.version,
      ),
      422,
      'job_application_interview_required',
    )
    const ratings = [
      { criterionId: 'k1', score: 5, note: 'Alan bilgisi güçlü' },
      { criterionId: 'k2', score: 3 },
    ]
    assertError(
      await evaluate(t.admin, planned, { ratings, generalNote: 'İyi aday.' }),
      422,
      'candidate_interview_not_completed',
    )
    const done = ok(await complete(t.admin, planned))
    assert.equal(done.status, 'completed')
    const mine = ok(await evaluate(t.admin, done, { ratings, generalNote: 'İyi aday.' }))
    const own = (mine.evaluations as Json[]).find((row) => row.mine === true)
    assert.deepEqual(own?.score, { total: 13, max: 15, percent: 87 })
    assertError(
      await evaluate(t.admin, done, { ratings, generalNote: 'Fikrim değişti.' }),
      409,
      'candidate_evaluation_submitted',
    )
    assertError(
      await evaluate(selin.cookie, done, {
        ratings: [
          { criterionId: 'k1', score: 9 },
          { criterionId: 'k2', score: 3 },
        ],
        generalNote: 'Uygun.',
      }),
      422,
      'candidate_evaluation_score_range',
    )
    const assigned = (await get(`${ASSIGNED}?pending=true`, selin.cookie)).json()
    assert.equal(assigned.meta.total, 1)
    assert.equal(assigned.data[0].candidateName, 'Deniz Aday')
    assert.equal(assigned.data[0].evaluation.mine, true)
    const teacherView = ok(
      await evaluate(selin.cookie, done, {
        ratings: [
          { criterionId: 'k1', score: 3 },
          { criterionId: 'k2', score: 3 },
        ],
        generalNote: 'Uygun.',
      }),
    )
    assert.equal(
      (teacherView.evaluations as Json[]).length,
      1,
      'öğretmen yalnız kendi satırını görür',
    )
    assert.equal((await get(`${ASSIGNED}?pending=true`, selin.cookie)).json().meta.total, 0)

    const list = ok(await get(interviewsUrl(app1), t.admin))
    const [interview] = list.interviews as Json[]
    assert.equal(interview?.submittedCount, 2)
    assert.equal(interview?.averagePercent, 74)
    assert.deepEqual(list.summary, {
      plannedCount: 0,
      completedCount: 1,
      cancelledCount: 0,
      submittedCount: 2,
      interviewAveragePercent: 74,
      sampleLessonAveragePercent: null,
    })
    const detail = ok(await get(`${APPLICATIONS}/${String(app1.id)}`, t.admin))
    assert.equal((detail.interviewSummary as Json).completedCount, 1)
    const offered = ok(
      await versioned(
        'POST',
        `${APPLICATIONS}/${String(app1.id)}/stage`,
        t.admin,
        { stage: 'offer', changedOn: '2026-10-06' },
        detail.version,
      ),
    )
    assert.equal(offered.stage, 'offer')
    assertError(
      await versioned(
        'PATCH',
        `${TEMPLATES}/${String(form.id)}`,
        t.admin,
        { scaleMax: 10 },
        form.version,
      ),
      409,
      'interview_template_used',
    )
    const next = ok(
      await versioned(
        'POST',
        `${TEMPLATES}/${String(form.id)}/versions`,
        t.admin,
        { ...TEMPLATE, scaleMax: 10 },
        form.version,
      ),
      201,
    )
    assert.equal(next.versionNumber, 2)
    assert.equal(next.used, false)
    const versions = await db
      .select()
      .from(interviewTemplateVersions)
      .where(eq(interviewTemplateVersions.institutionId, t.id))
    assert.equal(versions.length, 2)
    const audit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          eq(auditLog.action, 'finance.candidate_interview.evaluate'),
        ),
      )
    assert.equal(audit.length, 2)
    assert.deepEqual(audit[0]?.changes, { fields: ['ratings', 'generalNote', 'submittedAt'] })
    assert.ok(!JSON.stringify(audit).includes('Alan bilgisi güçlü'))
  })

  test('DOM-FIN-138 K-469: aşama, form, değerlendirici, an ve durum kuralları; reddedilen istekte kayıt değişmez', async () => {
    const t = await institution()
    const form = await template(t)
    const desk = await person(t, 'onburo', 'Ön Büro')
    const screening = await application(t, 'screening')
    const body = { templateId: form.id, evaluatorMembershipIds: [t.adminMembershipId] }
    assertError(await plan(t.admin, screening, body), 422, 'candidate_interview_stage')
    const app1 = await application(t)
    assertError(await plan(t.admin, app1, { ...body, location: null }), 400)
    assertError(await plan(t.admin, app1, { ...body, type: 'online', location: null }), 400)
    assertError(
      await plan(t.admin, app1, { ...body, evaluatorMembershipIds: [desk.membershipId] }),
      422,
      'candidate_interview_evaluator_invalid',
    )
    assertError(
      await plan(t.admin, app1, { ...body, evaluatorMembershipIds: ['yok'] }),
      422,
      'candidate_interview_evaluator_not_found',
    )
    assertError(
      await plan(t.admin, app1, { ...body, type: 'sample_lesson' }),
      422,
      'candidate_interview_template_not_found',
    )
    assertError(await plan(t.admin, app1, { ...body, institutionId: randomUUID() }), 400)
    assert.equal((await interviewRows(t.id)).length, 0)

    const online = ok(
      await plan(t.admin, app1, {
        ...body,
        type: 'online',
        location: null,
        meetingUrl: 'https://meet.ornek.com/abc',
        scheduledAt: FUTURE,
      }),
      201,
    )
    assertError(await complete(t.admin, online), 422, 'candidate_interview_not_started')
    assertError(
      await versioned(
        'PATCH',
        `${INTERVIEWS}/${String(online.id)}`,
        t.admin,
        { meetingUrl: null },
        online.version,
      ),
      422,
      'candidate_interview_link_required',
    )
    const moved = ok(
      await versioned(
        'PATCH',
        `${INTERVIEWS}/${String(online.id)}`,
        t.admin,
        { scheduledAt: PAST },
        online.version,
      ),
    )
    assert.equal(moved.scheduledAt, '2026-10-05T07:00:00.000Z')
    assertError(await complete(t.admin, online), 409)
    const cancelled = ok(
      await versioned(
        'POST',
        `${INTERVIEWS}/${String(online.id)}/cancel`,
        t.admin,
        {},
        moved.version,
      ),
    )
    assert.equal(cancelled.status, 'cancelled')
    assertError(await complete(t.admin, cancelled), 422, 'candidate_interview_not_planned')
    // İptal edilen mülakat teklif kapısını açmaz.
    const current = ok(await get(`${APPLICATIONS}/${String(app1.id)}`, t.admin))
    assertError(
      await versioned(
        'POST',
        `${APPLICATIONS}/${String(app1.id)}/stage`,
        t.admin,
        { stage: 'hired', changedOn: '2026-10-06' },
        current.version,
      ),
      422,
      'job_application_interview_required',
    )
    ok(
      await versioned('POST', `${TEMPLATES}/${String(form.id)}/archive`, t.admin, {}, form.version),
    )
    assertError(await plan(t.admin, app1, body), 422, 'candidate_interview_template_archived')
  })

  test('DOM-FIN-138 K-471: örnek ders gözlem formu sürümüyle, gözlem puan kuralı; kullanılan gözlem formu kilitli', async () => {
    const t = await institution()
    const observationForm = ok(
      await post(OBSERVATION_TEMPLATES, t.admin, OBSERVATION_TEMPLATE),
      201,
    )
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const app1 = await application(t)
    const sample = ok(
      await plan(t.admin, app1, {
        type: 'sample_lesson',
        location: '5-A sınıfı',
        templateId: observationForm.id,
        evaluatorMembershipIds: [selin.membershipId],
      }),
      201,
    )
    assert.equal((sample.form as Json).kind, 'observation')
    assert.equal((sample.form as Json).scaleMin, 0)
    const lockedForm = ok(await get(OBSERVATION_TEMPLATES, t.admin)) as unknown as Json[]
    assert.equal(lockedForm[0]?.used, true)
    assertError(
      await versioned(
        'PATCH',
        `${OBSERVATION_TEMPLATES}/${String(observationForm.id)}`,
        t.admin,
        { name: 'Yeni ad' },
        observationForm.version,
      ),
      409,
      'observation_template_used',
    )
    const done = ok(await complete(t.admin, sample))
    assertError(
      await evaluate(t.admin, done, {
        ratings: [
          { criterionId: 'k1', score: 4 },
          { criterionId: 'k2', score: 4 },
        ],
        generalNote: 'Yönetici değerlendirici değil.',
      }),
      422,
      'candidate_interview_not_evaluator',
    )
    assertError(
      await evaluate(selin.cookie, done, {
        ratings: [
          { criterionId: 'k1', score: 2 },
          { criterionId: 'k2', score: 4 },
        ],
        generalNote: 'Sınıf yönetimi zayıf.',
      }),
      422,
      'candidate_evaluation_note_required',
    )
    const evaluated = ok(
      await evaluate(selin.cookie, done, {
        ratings: [
          { criterionId: 'k1', score: 2, note: 'Geçişler dağınık' },
          { criterionId: 'k2', score: 4 },
        ],
        generalNote: 'Gelişime açık.',
      }),
    )
    // Gözlem kuralı: (2×2 + 4×1) / (5×3) = 8/15 → 53.
    assert.deepEqual((evaluated.evaluations as Json[])[0]?.score, {
      total: 8,
      max: 15,
      percent: 53,
    })
    const summary = ok(await get(interviewsUrl(app1), t.admin)).summary as Json
    assert.equal(summary.sampleLessonAveragePercent, 53)
    assert.equal(summary.interviewAveragePercent, null)
  })

  test('DOM-FIN-138 K-471: anonimleştirme mülakat notlarını, yer ve bağlantıyı siler; planlı mülakat iptal olur', async () => {
    const t = await institution()
    const form = await template(t)
    const app1 = await application(t)
    const body = { templateId: form.id, evaluatorMembershipIds: [t.adminMembershipId] }
    const first = ok(await plan(t.admin, app1, body), 201)
    const done = ok(await complete(t.admin, first))
    ok(
      await evaluate(t.admin, done, {
        ratings: [
          { criterionId: 'k1', score: 4, note: 'Not silinmeli' },
          { criterionId: 'k2', score: 4 },
        ],
        generalNote: 'Genel not silinmeli.',
      }),
    )
    ok(await plan(t.admin, app1, { ...body, scheduledAt: FUTURE }), 201)
    ok(
      await post(ANONYMIZE, t.admin, {
        applicationIds: [app1.id],
        reason: 'data_subject_request',
      }),
    )
    const rows = await interviewRows(t.id)
    assert.deepEqual(rows.map((row) => row.status).sort(), ['cancelled', 'completed'])
    assert.ok(rows.every((row) => row.location === null && row.meetingUrl === null))
    const [evaluation] = await db
      .select()
      .from(candidateInterviewEvaluations)
      .where(
        and(
          eq(candidateInterviewEvaluations.institutionId, t.id),
          eq(candidateInterviewEvaluations.candidateInterviewId, String(done.id)),
        ),
      )
    assert.equal(evaluation?.generalNote, null)
    assert.deepEqual(
      evaluation?.ratings?.map((rating) => [rating.score, rating.note]),
      [
        [4, null],
        [4, null],
      ],
    )
    const list = ok(await get(interviewsUrl(app1), t.admin))
    assert.equal((list.summary as Json).interviewAveragePercent, 80, 'puanlar kalır')
    assert.equal((await get(ASSIGNED, t.admin)).json().meta.total, 0)
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          eq(auditLog.action, 'finance.job_application.anonymize'),
        ),
      )
    assert.ok(
      (audit?.changes as { fields: string[] }).fields.includes(
        'interviews.evaluations.generalNote',
      ),
    )
  })

  test('DOM-FIN-138: başka kurumun başvurusu, mülakatı ve formu 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bForm = await template(b)
    const bApp = await application(b)
    const bInterview = ok(
      await plan(b.admin, bApp, {
        templateId: bForm.id,
        evaluatorMembershipIds: [b.adminMembershipId],
      }),
      201,
    )
    const aApp = await application(a)
    const bInterviewUrl = `${INTERVIEWS}/${String(bInterview.id)}`
    const bFormUrl = `${TEMPLATES}/${String(bForm.id)}`
    assertError(await get(interviewsUrl(bApp), a.admin), 404)
    assertError(
      await plan(a.admin, bApp, {
        templateId: bForm.id,
        evaluatorMembershipIds: [a.adminMembershipId],
      }),
      404,
    )
    assertError(
      await plan(a.admin, aApp, {
        templateId: bForm.id,
        evaluatorMembershipIds: [a.adminMembershipId],
      }),
      422,
      'candidate_interview_template_not_found',
    )
    const aForm = await template(a)
    assertError(
      await plan(a.admin, aApp, {
        templateId: aForm.id,
        evaluatorMembershipIds: [b.adminMembershipId],
      }),
      422,
      'candidate_interview_evaluator_not_found',
    )
    assertError(
      await versioned('PATCH', bInterviewUrl, a.admin, { location: 'A' }, bInterview.version),
      404,
    )
    assertError(await complete(a.admin, bInterview), 404)
    assertError(
      await versioned('POST', `${bInterviewUrl}/cancel`, a.admin, {}, bInterview.version),
      404,
    )
    assertError(
      await evaluate(a.admin, bInterview, {
        ratings: [{ criterionId: 'k1', score: 3 }],
        generalNote: 'Başka kurum.',
      }),
      404,
    )
    assertError(
      await versioned('PATCH', bFormUrl, a.admin, { name: 'A formu' }, bForm.version),
      404,
    )
    assertError(
      await versioned('POST', `${bFormUrl}/versions`, a.admin, TEMPLATE, bForm.version),
      404,
    )
    assertError(await versioned('POST', `${bFormUrl}/archive`, a.admin, {}, bForm.version), 404)
    const aTemplates = (await get(TEMPLATES, a.admin)).json()
    assert.equal(aTemplates.meta.total, 1)
    assert.ok(!(aTemplates.data as Json[]).some((row) => row.id === bForm.id))
    assert.equal((await get(ASSIGNED, a.admin)).json().meta.total, 0)
    assertError(await post(TEMPLATES, a.admin, { ...TEMPLATE, institutionId: b.id }), 400)
    const [bRow] = await interviewRows(b.id)
    assert.equal(bRow?.status, 'planned')
    assert.equal(bRow?.location, 'Müdür odası')
    assert.equal((await interviewRows(a.id)).length, 0)
  })
})
