import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { performanceReports } from '../src/db/schema/finance-performance-reports.ts'
import { ensureMember } from '../src/services/identity.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  createUser,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * Performans raporu uçları (DOM-FIN-137; ON-220; K-466…K-468). Dönem, öz değerlendirme ve ders
 * gözlemi kendi uçlarıyla kurulur; her test kendi kurumunu kurar. FIXED_NOW 2026-10-06; dönem
 * 2026-09-01–2026-10-05.
 */

const PERIODS = '/api/v1/finance/performance-periods'
const REVIEWS = '/api/v1/finance/performance-reviews'
const OBS_TEMPLATES = '/api/v1/finance/lesson-observation-templates'
const OBSERVATIONS = '/api/v1/finance/lesson-observations'
const SELF = '/api/v1/finance/self-evaluations'
const GOALS = [
  { title: 'Okuma becerisi', criterion: 'Sınıf ortalaması B1', weight: 60 },
  { title: 'Veli iletişimi', criterion: 'Her ay görüşme', weight: 40 },
]
const QUESTIONS = [
  { kind: 'scale', text: 'Ders planlarımı zamanında hazırladım', required: true },
  { kind: 'open', text: 'Bu dönemin en güçlü yanınız neydi?', required: true },
]
const levels = [0, 1, 2, 3, 4, 5].map((level) => ({ level, description: `Seviye ${level}` }))
const OBS_TEMPLATE = {
  name: 'Ders gözlem formu',
  criteria: [
    { title: 'Sınıf yönetimi', weight: 2, levels },
    { title: 'Öğrenci katılımı', weight: 1, levels },
  ],
}
const OPINION = 'Gizli-yonetici-gorusu: dönem hedeflerine ulaştı.'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-137: performans raporu uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.220.0.1'

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
  const key = () => ({ 'idempotency-key': randomUUID() })
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.220.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  async function person(t: Tenant, role: Role, name: string) {
    const user = await createUser(app, { name })
    const membership = await ensureMember(app.auth, db, {
      institutionId: t.id,
      userId: user.id,
      role,
    })
    return { membershipId: membership.id, user }
  }
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))

  const advance = async (t: Tenant, p: Json, statuses: string[]) => {
    let current = p
    for (const status of statuses)
      current = ok(
        await call(
          'POST',
          `${PERIODS}/${String(current.id)}/status`,
          t.admin,
          { status },
          ifMatch(current.version),
        ),
      )
    return current
  }
  const enroll = async (t: Tenant, p: Json, membershipId: string) =>
    ok(
      await call(
        'POST',
        `${PERIODS}/${String(p.id)}/reviews`,
        t.admin,
        { membershipId, goals: GOALS },
        key(),
      ),
      201,
    )
  const score = async (t: Tenant, review: Json, scores: number[]) =>
    ok(
      await call(
        'PATCH',
        `${REVIEWS}/${String(review.id)}`,
        t.admin,
        { scores, staffComment: 'Değerlendirmeye katılıyorum.' },
        ifMatch(review.version),
      ),
    )
  async function observe(
    t: Tenant,
    form: Json,
    teacher: string,
    observedDate: string,
    ratings: [number, number],
    periodId?: string,
  ) {
    const draft = ok(
      await call(
        'POST',
        OBSERVATIONS,
        t.admin,
        {
          templateId: form.id,
          teacherMembershipId: teacher,
          observedDate,
          ...(periodId === undefined ? {} : { performancePeriodId: periodId }),
        },
        key(),
      ),
      201,
    )
    const rated = ok(
      await call(
        'PATCH',
        `${OBSERVATIONS}/${String(draft.id)}`,
        t.admin,
        {
          ratings: [
            { criterionId: 'k1', level: ratings[0] },
            { criterionId: 'k2', level: ratings[1] },
          ],
          generalNote: 'Güçlü bir ders',
        },
        ifMatch(draft.version),
      ),
    )
    return ok(
      await call(
        'POST',
        `${OBSERVATIONS}/${String(rated.id)}/complete`,
        t.admin,
        {},
        ifMatch(rated.version),
      ),
    )
  }

  const summary = (cookie: string | null, p: Json) =>
    call('GET', `${PERIODS}/${String(p.id)}/report-summary`, cookie)
  const rows = (cookie: string | null, p: Json, query = '') =>
    call('GET', `${PERIODS}/${String(p.id)}/reports${query}`, cookie)
  const report = (cookie: string | null, review: Json, query = '') =>
    call('GET', `${REVIEWS}/${String(review.id)}/report${query}`, cookie)
  const finalize = (
    cookie: string | null,
    review: Json,
    body: unknown = { managerOpinion: OPINION },
    headers: Record<string, string> = key(),
  ) => call('POST', `${REVIEWS}/${String(review.id)}/report/finalize`, cookie, body, headers)
  const acknowledge = (
    cookie: string | null,
    review: Json,
    body: unknown = { channel: 'paper', acknowledgedDate: '2026-10-06' },
    headers: Record<string, string> = key(),
  ) => call('POST', `${REVIEWS}/${String(review.id)}/report/acknowledge`, cookie, body, headers)
  const reportRows = (institutionId: string) =>
    db.select().from(performanceReports).where(eq(performanceReports.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  /**
   * Değerlendirme aşamasında dönem: Selin (öğretmen) gönderilmiş öz değerlendirme, iki dönem
   * gözlemi (biri döneme bağlı, biri günüyle) ve dönem dışı bir gözlemle; puanlar 5 ve 4.
   */
  async function evaluated(t: Tenant, others: string[] = []) {
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    let p = ok(
      await call(
        'POST',
        PERIODS,
        t.admin,
        { name: '2026 güz dönemi', startDate: '2026-09-01', endDate: '2026-10-05' },
        key(),
      ),
      201,
    )
    let review = await enroll(t, p, selin.membershipId)
    const extra = []
    for (const membershipId of others) extra.push(await enroll(t, p, membershipId))
    ok(
      await call(
        'POST',
        `${PERIODS}/${String(p.id)}/self-evaluation-template`,
        t.admin,
        { questions: QUESTIONS },
        key(),
      ),
      201,
    )
    p = await advance(t, p, ['active'])
    const response = ok(
      await call(
        'POST',
        `${PERIODS}/${String(p.id)}/self-evaluations`,
        t.admin,
        {
          membershipId: selin.membershipId,
          channel: 'paper',
          answers: [{ score: 4 }, { text: 'Veli iletişimi güçlü' }],
        },
        key(),
      ),
      201,
    )
    ok(
      await call(
        'POST',
        `${SELF}/${String(response.id)}/submit`,
        t.admin,
        {},
        ifMatch(response.version),
      ),
    )
    const form = ok(await call('POST', OBS_TEMPLATES, t.admin, OBS_TEMPLATE, key()), 201)
    // (4×2 + 3×1) / 15 → %73; (5×2 + 5×1) / 15 → %100; dönem dışı gözlem rapora girmez.
    await observe(t, form, selin.membershipId, '2026-10-01', [4, 3], String(p.id))
    await observe(t, form, selin.membershipId, '2026-09-15', [5, 5])
    await observe(t, form, selin.membershipId, '2026-08-20', [3, 3])
    p = await advance(t, p, ['interim', 'evaluation'])
    review = await score(t, review, [5, 4])
    for (const other of extra) await score(t, other, [3, 3])
    return { selin, p, review, form }
  }

  async function closed(t: Tenant) {
    const setup = await evaluated(t)
    return { ...setup, p: await advance(t, setup.p, ['closed']) }
  }

  test('kimliksiz istek 401', async () => {
    const p = { id: randomUUID() }
    assertError(await summary(null, p), 401)
    assertError(await rows(null, p), 401)
    assertError(await report(null, p), 401)
    assertError(await finalize(null, p), 401)
    assertError(await acknowledge(null, p), 401)
  })

  test('DOM-FIN-137 K-468: ön büro, veli ve öğrenci 403; öğretmen yalnız rapor okur', async () => {
    const t = await institution()
    const { p, review } = await closed(t)
    for (const role of ['onburo', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await summary(cookie, p), 403)
      assertError(await rows(cookie, p), 403)
      assertError(await report(cookie, review), 403)
      assertError(await finalize(cookie, review), 403)
      assertError(await acknowledge(cookie, review), 403)
    }
    const teacher = await member(t.id, 'ogretmen')
    assertError(await summary(teacher, p), 403)
    assertError(await rows(teacher, p), 403)
    assertError(await finalize(teacher, review), 403)
    assertError(await acknowledge(teacher, review), 403)
    // Başka öğretmenin raporu görünmez (404), denetime de düşmez.
    assertError(await report(teacher, review), 404)
    assert.equal((await reportRows(t.id)).length, 0)
    assert.equal((await auditOf(t.id, 'finance.performance_report.read')).length, 0)
  })

  test('DOM-FIN-137: finance modülü kapalıyken uçlar 403 module_disabled', async () => {
    const off = await institution({ enabledModules: { finance: false } })
    const p = { id: randomUUID() }
    assertError(await summary(off.admin, p), 403, 'module_disabled')
    assertError(await rows(off.admin, p), 403, 'module_disabled')
    assertError(await report(off.admin, p), 403, 'module_disabled')
    assertError(await finalize(off.admin, p), 403, 'module_disabled')
    assertError(await acknowledge(off.admin, p), 403, 'module_disabled')
  })

  test('DOM-FIN-137 K-466: rapor bölümleri değerlendirme, öz değerlendirme, gözlem ve görüştür', async () => {
    const t = await institution()
    const { p, review } = await evaluated(t)
    const draft = ok(await report(t.admin, review))
    assert.deepEqual(draft.sections, [
      'evaluation',
      'selfEvaluation',
      'observations',
      'managerOpinion',
    ])
    assert.equal(draft.staffName, 'Selin Kaya')
    assert.equal(draft.status, 'draft')
    assert.equal(draft.managerOpinion, null)
    const evaluation = draft.evaluation as Json
    // 5×60 + 4×40 = 460 / 100 → 4,6
    assert.equal(evaluation.overallScore, 4.6)
    assert.equal(evaluation.staffComment, 'Değerlendirmeye katılıyorum.')
    const self = draft.selfEvaluation as Json
    assert.equal(self.status, 'submitted')
    assert.equal(self.channel, 'paper')
    assert.equal(self.scaleAverage, 4)
    assert.deepEqual(self.items, [
      { question: QUESTIONS[0]?.text, kind: 'scale', score: 4, text: null },
      { question: QUESTIONS[1]?.text, kind: 'open', score: null, text: 'Veli iletişimi güçlü' },
    ])
    const observations = draft.observations as Json
    assert.equal(observations.count, 2)
    assert.equal(observations.averagePercent, 86.5)
    assert.deepEqual(
      (observations.items as Json[]).map((item) => [item.observedDate, item.percent]),
      [
        ['2026-09-15', 100],
        ['2026-10-01', 73],
      ],
    )

    // Her okuma denetime düşer; PDF ayrı eylemdir. Değer değil alan adı yazılır.
    ok(await report(t.admin, review, '?purpose=pdf'))
    assertError(await report(t.admin, review, '?purpose=csv'), 400)
    const [read] = await auditOf(t.id, 'finance.performance_report.read')
    const [exported] = await auditOf(t.id, 'finance.performance_report.export')
    assert.equal(read?.entityId, review.id)
    assert.equal(exported?.entityId, review.id)
    assert.ok(read?.changes?.fields?.includes('managerOpinion'))
    assert.equal(JSON.stringify(read?.changes).includes('Veli iletişimi'), false)

    // Dönem kapanmadan kesinleşmez; kayıt yazılmaz.
    assertError(await finalize(t.admin, review), 422, 'performance_report_period_open')
    assert.equal((await reportRows(t.id)).length, 0)
    assert.equal(p.status, 'evaluation')
  })

  test('DOM-FIN-137 K-467: kapanan dönemde görüşle bir kez kesinleşir; sonraki gözlem girmez', async () => {
    const t = await institution()
    const { selin, review, form } = await closed(t)
    assertError(await finalize(t.admin, review, { managerOpinion: 'Kısa' }), 400)
    assertError(
      await finalize(t.admin, review, { managerOpinion: OPINION, institutionId: 'baska' }),
      400,
    )
    assertError(await finalize(t.admin, review, { managerOpinion: OPINION }, {}), 400)
    assert.equal((await reportRows(t.id)).length, 0)

    const headers = key()
    const first = await finalize(t.admin, review, undefined, headers)
    assert.equal(first.statusCode, 201, first.body)
    const replay = await finalize(t.admin, review, undefined, headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    const done = first.json().data as Json
    assert.equal(done.status, 'finalized')
    assert.equal(done.managerOpinion, OPINION)
    assert.equal(done.finalizedByName, 'Test Yönetici')
    assert.equal(done.finalizedAt, FIXED_NOW.toISOString())
    assertError(
      await finalize(t.admin, review, { managerOpinion: 'Başka bir görüş metni' }),
      409,
      'performance_report_finalized',
    )
    const stored = await reportRows(t.id)
    assert.equal(stored.length, 1)
    assert.equal(stored[0]?.managerOpinion, OPINION)
    const [audit] = await auditOf(t.id, 'finance.performance_report.finalize')
    assert.deepEqual(audit?.changes?.fields, ['reviewId', 'managerOpinion', 'finalizedAt'])
    assert.equal(JSON.stringify(audit?.changes).includes('Gizli'), false)

    // Kesinleşmeden sonra (aynı an değil, sonraki saatte) tamamlanan gözlem rapora girmez.
    const later = await buildTestApp(db, { clock: () => new Date('2026-10-06T12:00:00.000Z') })
    try {
      const response = await later.inject({
        method: 'POST',
        url: OBSERVATIONS,
        remoteAddress: clientIp,
        headers: {
          origin: TEST_ORIGIN,
          cookie: t.admin,
          'content-type': 'application/json',
          ...key(),
        },
        payload: JSON.stringify({
          templateId: form.id,
          teacherMembershipId: selin.membershipId,
          observedDate: '2026-09-20',
        }),
      })
      assert.equal(response.statusCode, 201, response.body)
      const draft = response.json().data as Json
      const rated = await later.inject({
        method: 'PATCH',
        url: `${OBSERVATIONS}/${String(draft.id)}`,
        remoteAddress: clientIp,
        headers: {
          origin: TEST_ORIGIN,
          cookie: t.admin,
          'content-type': 'application/json',
          ...ifMatch(draft.version),
        },
        payload: JSON.stringify({
          ratings: [
            { criterionId: 'k1', level: 3 },
            { criterionId: 'k2', level: 3 },
          ],
          generalNote: 'Sonradan gözlem',
        }),
      })
      const ratedRow = rated.json().data as Json
      const completed = await later.inject({
        method: 'POST',
        url: `${OBSERVATIONS}/${String(draft.id)}/complete`,
        remoteAddress: clientIp,
        headers: {
          origin: TEST_ORIGIN,
          cookie: t.admin,
          'content-type': 'application/json',
          ...ifMatch(ratedRow.version),
        },
        payload: '{}',
      })
      assert.equal(completed.statusCode, 200, completed.body)
    } finally {
      await later.close()
    }
    const after = ok(await report(t.admin, review))
    assert.equal((after.observations as Json).count, 2)

    // Veritabanı güvencesi: kesinleşen görüş doğrudan değiştirilemez, satır silinemez.
    await assert.rejects(
      db
        .update(performanceReports)
        .set({ managerOpinion: 'Değiştirilmiş görüş metni' })
        .where(eq(performanceReports.institutionId, t.id)),
    )
    await assert.rejects(
      db.delete(performanceReports).where(eq(performanceReports.institutionId, t.id)),
    )
  })

  test('DOM-FIN-137 K-467: okudum kaydı kesinleşmiş rapora bir kez, kanal ve günle', async () => {
    const t = await institution()
    const { review } = await closed(t)
    assertError(await acknowledge(t.admin, review), 422, 'performance_report_not_finalized')
    ok(await finalize(t.admin, review), 201)
    assertError(
      await acknowledge(t.admin, review, { channel: 'sms', acknowledgedDate: '2026-10-06' }),
      400,
    )
    assertError(await acknowledge(t.admin, review, { channel: 'paper' }), 400)
    assertError(await acknowledge(t.admin, review, undefined, {}), 400)
    assertError(
      await acknowledge(t.admin, review, { channel: 'paper', acknowledgedDate: '2026-10-07' }),
      422,
      'performance_report_ack_date_future',
    )
    assertError(
      await acknowledge(t.admin, review, { channel: 'paper', acknowledgedDate: '2026-10-05' }),
      422,
      'performance_report_ack_before_final',
    )
    const [unchanged] = await reportRows(t.id)
    assert.equal(unchanged?.acknowledgedDate, null)
    assert.equal(unchanged?.version, 1)

    const headers = key()
    const body = { channel: 'in_person', acknowledgedDate: '2026-10-06' }
    const read = ok(await acknowledge(t.admin, review, body, headers))
    assert.equal(read.status, 'acknowledged')
    assert.equal(read.acknowledgementChannel, 'in_person')
    assert.equal(read.acknowledgedDate, '2026-10-06')
    assert.equal(read.acknowledgementRecordedByName, 'Test Yönetici')
    const replay = await acknowledge(t.admin, review, body, headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(await acknowledge(t.admin, review, body), 409, 'performance_report_acknowledged')
    const stored = await reportRows(t.id)
    assert.equal(stored.length, 1)
    assert.equal(stored[0]?.version, 2)
    assert.equal(stored[0]?.acknowledgementChannel, 'in_person')
    assert.equal((await auditOf(t.id, 'finance.performance_report.acknowledge')).length, 1)
    // Okuma kaydı da bir kez yazılır: veritabanı ikinci güncellemeyi reddeder.
    await assert.rejects(
      db
        .update(performanceReports)
        .set({ acknowledgementChannel: 'email' })
        .where(eq(performanceReports.institutionId, t.id)),
    )
  })

  test('DOM-FIN-137 K-468: öğretmen kendi raporunu yalnız kesinleşince okur; okuma denetlenir', async () => {
    const t = await institution()
    const { selin, review } = await closed(t)
    const own = await signInAs(app, selin.user)
    assertError(await report(own, review), 404)
    ok(await finalize(t.admin, review), 201)
    const data = ok(await report(own, review, '?purpose=pdf'))
    assert.equal(data.staffName, 'Selin Kaya')
    assert.equal(data.managerOpinion, OPINION)
    const [exported] = await auditOf(t.id, 'finance.performance_report.export')
    assert.equal(exported?.actorRole, 'ogretmen')
  })

  test('DOM-FIN-137 K-466: dönem özeti ortalama ve dağılım; satırlar denetime düşer', async () => {
    const t = await institution()
    const ali = await person(t, 'onburo', 'Ali Demir')
    const { p: evaluating, review } = await evaluated(t, [ali.membershipId])
    const p = await advance(t, evaluating, ['closed'])
    let data = ok(await summary(t.admin, p))
    // Selin 4,6 ve Ali 3,0: ortalama 3,8; bantlar 3 ve 4.
    assert.equal(data.staffCount, 2)
    assert.equal(data.scoredCount, 2)
    assert.equal(data.averageScore, 3.8)
    assert.equal(data.minScore, 3)
    assert.equal(data.maxScore, 4.6)
    assert.deepEqual(
      (data.distribution as Json[]).map((band) => band.count),
      [0, 0, 1, 1, 0],
    )
    assert.equal(data.observationCount, 2)
    assert.equal(data.observationAverage, 86.5)
    assert.equal(data.selfEvaluationSubmitted, 1)
    assert.equal(data.finalizedCount, 0)
    assert.equal(JSON.stringify(data).includes('Selin'), false)

    ok(await finalize(t.admin, review), 201)
    ok(await acknowledge(t.admin, review), 200)
    data = ok(await summary(t.admin, p))
    assert.equal(data.finalizedCount, 1)
    assert.equal(data.acknowledgedCount, 1)

    const list = await rows(t.admin, p, '?q=Selin')
    assert.equal(list.statusCode, 200, list.body)
    const [row] = list.json().data as Json[]
    assert.equal(list.json().meta.total, 1)
    assert.equal(row?.staffName, 'Selin Kaya')
    assert.equal(row?.overallScore, 4.6)
    assert.equal(row?.selfEvaluationStatus, 'submitted')
    assert.equal(row?.observationCount, 2)
    assert.equal(row?.observationAverage, 86.5)
    assert.equal(row?.status, 'acknowledged')
    assertError(await rows(t.admin, p, '?sort=name'), 400)
    const all = ok(await rows(t.admin, p)) as unknown as Json[]
    assert.deepEqual(
      all.map((item) => [item.staffName, item.overallScore, item.observationCount, item.status]),
      [
        ['Ali Demir', 3, 0, 'draft'],
        ['Selin Kaya', 4.6, 2, 'acknowledged'],
      ],
    )
    const audits = await auditOf(t.id, 'finance.performance_report.list')
    assert.deepEqual(audits.map((audit) => audit.changes?.counts?.rows).sort(), [1, 2])
  })

  test('DOM-FIN-137: başka kurumun dönemi ve raporu 404; A değişmez', async () => {
    const a = await institution()
    const { p, review } = await closed(a)
    const b = await institution()
    assertError(await summary(b.admin, p), 404)
    assertError(await rows(b.admin, p), 404)
    assertError(await report(b.admin, review), 404)
    assertError(await finalize(b.admin, review), 404)
    assertError(await acknowledge(b.admin, review), 404)
    assert.equal((await reportRows(a.id)).length, 0)
    assert.equal((await reportRows(b.id)).length, 0)
    assert.equal((await auditOf(b.id, 'finance.performance_report.read')).length, 0)
  })
})
