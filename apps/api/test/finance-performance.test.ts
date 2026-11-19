import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships } from '../src/db/schema/auth.ts'
import { performancePeriods, performanceReviews } from '../src/db/schema/finance-performance.ts'
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
 * Personel performans dönemi uçları (DOM-FIN-124; ON-211; K-427…K-429). Her test kendi kurumunu
 * kurar. FIXED_NOW 2026-10-06; dönem 2026-09-01 – 2027-01-31.
 */

const PERIODS = '/api/v1/finance/performance-periods'
const REVIEWS = '/api/v1/finance/performance-reviews'
const GOALS = [
  { title: 'Okuma becerisi', criterion: 'Sınıf ortalaması B1', weight: 60 },
  { title: 'Veli görüşmesi', criterion: 'Her veliyle iki görüşme', weight: 40 },
]

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-124: performans dönemi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.211.0.1'

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
    clientIp = `10.211.${String((tenantCount += 1))}.1`
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
    return membership.id
  }
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))

  const createPeriod = (
    cookie: string | null,
    body: Json = {},
    headers: Record<string, string> = key(),
  ) =>
    call(
      'POST',
      PERIODS,
      cookie,
      { name: '2026 güz dönemi', startDate: '2026-09-01', endDate: '2027-01-31', ...body },
      headers,
    )
  const period = async (t: Tenant) => ok(await createPeriod(t.admin), 201)
  const advance = (cookie: string | null, p: Json, status: string) =>
    call('POST', `${PERIODS}/${String(p.id)}/status`, cookie, { status }, ifMatch(p.version))
  /** Dönemi verilen aşamaya kadar ilerletir. */
  async function moveTo(t: Tenant, p: Json, statuses: string[]) {
    let current = p
    for (const status of statuses) current = ok(await advance(t.admin, current, status))
    return current
  }
  const addReview = (
    cookie: string | null,
    p: Json,
    membershipId: string,
    goals: unknown = GOALS,
    headers: Record<string, string> = key(),
  ) => call('POST', `${PERIODS}/${String(p.id)}/reviews`, cookie, { membershipId, goals }, headers)
  const patch = (cookie: string | null, review: Json, body: Json) =>
    call('PATCH', `${REVIEWS}/${String(review.id)}`, cookie, body, ifMatch(review.version))
  const reviewsOf = (cookie: string | null, p: Json) =>
    call('GET', `${PERIODS}/${String(p.id)}/reviews`, cookie)
  const rowsOf = (institutionId: string) =>
    db.select().from(performanceReviews).where(eq(performanceReviews.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    const p = { id, version: 1 }
    assertError(await call('GET', PERIODS, null), 401)
    assertError(await createPeriod(null), 401)
    assertError(await advance(null, p, 'active'), 401)
    assertError(await reviewsOf(null, p), 401)
    assertError(await addReview(null, p, 'm-1'), 401)
    assertError(await patch(null, p, { interimNote: 'x' }), 401)
  })

  test('DOM-FIN-124 K-429: yönetici dışındaki roller 403; kayıt değişmez, okuma denetlenmez', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const p = await period(t)
    const review = ok(await addReview(t.admin, p, selin), 201)
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await call('GET', PERIODS, cookie), 403)
      assertError(await createPeriod(cookie), 403)
      assertError(await advance(cookie, p, 'active'), 403)
      assertError(await reviewsOf(cookie, p), 403)
      assertError(await addReview(cookie, p, selin), 403)
      assertError(await patch(cookie, review, { goals: [{ ...GOALS[0], weight: 100 }] }), 403)
    }
    const rows = await rowsOf(t.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.version, 1)
    assert.equal((await auditOf(t.id, 'finance.performance_review.read')).length, 0)
  })

  test('DOM-FIN-124: finance modülü kapalıyken uçlar 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    const p = { id: randomUUID(), version: 1 }
    assertError(await call('GET', PERIODS, closed.admin), 403, 'module_disabled')
    assertError(await createPeriod(closed.admin), 403, 'module_disabled')
    assertError(await reviewsOf(closed.admin, p), 403, 'module_disabled')
    assertError(await addReview(closed.admin, p, 'm-1'), 403, 'module_disabled')
  })

  test('DOM-FIN-124: dönem açılır, idempotent; geçersiz girdi 400 ve satır yazılmaz', async () => {
    const t = await institution()
    const headers = key()
    const first = await createPeriod(t.admin, {}, headers)
    const replay = await createPeriod(t.admin, {}, headers)
    assert.equal(first.statusCode, 201, first.body)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    const created = first.json().data as Json
    assert.equal(created.status, 'planning')
    assert.equal(created.reviewCount, 0)
    assertError(await createPeriod(t.admin, { endDate: '2026-08-01' }), 400)
    assertError(await createPeriod(t.admin, {}, {}), 400)
    const rows = await db
      .select()
      .from(performancePeriods)
      .where(eq(performancePeriods.institutionId, t.id))
    assert.equal(rows.length, 1)
    const list = (await call('GET', `${PERIODS}?status=planning`, t.admin)).json() as {
      data: Json[]
      meta: { total: number }
    }
    assert.equal(list.meta.total, 1)
    assert.equal((await auditOf(t.id, 'finance.performance_period.create')).length, 1)
  })

  test('DOM-FIN-124 K-428: personel eklenir; ağırlık toplamı, mükerrer kayıt ve kendi kaydı reddedilir', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const parent = await person(t, 'veli', 'Ayşe Yılmaz')
    const p = await period(t)
    const headers = key()
    const review = ok(await addReview(t.admin, p, selin, GOALS, headers), 201)
    assert.equal(review.staffName, 'Selin Kaya')
    assert.equal(review.overallScore, null)
    assert.equal(review.scored, false)
    const replay = await addReview(t.admin, p, selin, GOALS, headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(await addReview(t.admin, p, selin), 409, 'performance_review_exists')
    assertError(await addReview(t.admin, p, parent), 422, 'performance_not_staff')
    assertError(await addReview(t.admin, p, 'm-yok'), 422, 'performance_staff_not_found')
    assertError(await addReview(t.admin, p, selin, [{ ...GOALS[0], weight: 50 }]), 400)
    const [own] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.institutionId, t.id), eq(memberships.role, 'yonetici')))
    assertError(await addReview(t.admin, p, own?.id ?? ''), 422, 'performance_self_review')
    assert.equal((await rowsOf(t.id)).length, 1)
  })

  test('DOM-FIN-124 K-427 K-428: aşamalar boyunca hedef, ara görüşme, puan; kapanınca kilit', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    let p = await period(t)
    let review = ok(await addReview(t.admin, p, selin), 201)

    assertError(await advance(t.admin, p, 'evaluation'), 409, 'performance_status_invalid')
    assertError(
      await patch(t.admin, review, {
        goals: [...GOALS, { title: 'Materyal', criterion: 'Dönemde iki set', weight: 10 }],
      }),
      400,
    )
    review = ok(await patch(t.admin, review, { goals: [{ ...GOALS[0], weight: 100 }] }))
    assert.equal((review.goals as Json[]).length, 1)
    review = ok(await patch(t.admin, review, { goals: GOALS }))
    assertError(
      await patch(t.admin, review, { interimNote: 'Erken not' }),
      422,
      'performance_interim_not_open',
    )

    p = await moveTo(t, p, ['active', 'interim'])
    assertError(
      await patch(t.admin, review, { interimDate: '2026-12-01' }),
      422,
      'performance_interim_date_future',
    )
    review = ok(
      await patch(t.admin, review, {
        interimNote: 'Okuma hedefinde iyi',
        interimDate: '2026-10-01',
      }),
    )
    assert.equal(review.interimDate, '2026-10-01')
    assertError(
      await patch(t.admin, review, { scores: [4, 3] }),
      422,
      'performance_evaluation_not_open',
    )

    p = await moveTo(t, p, ['evaluation'])
    assertError(await patch(t.admin, review, { goals: GOALS }), 422, 'performance_goals_locked')
    review = ok(await patch(t.admin, review, { scores: [4, null] }))
    assert.equal(review.overallScore, null)
    assertError(await advance(t.admin, p, 'closed'), 422, 'performance_period_unscored')
    review = ok(
      await patch(t.admin, review, { scores: [4, 3], staffComment: 'Değerlendirmeye katılıyorum' }),
    )
    assert.equal(review.overallScore, 3.6)
    assert.equal(review.scored, true)
    assert.equal(typeof review.evaluatorName, 'string')
    assert.equal(review.staffComment, 'Değerlendirmeye katılıyorum')

    p = await moveTo(t, p, ['closed'])
    assert.equal(p.status, 'closed')
    assert.equal(p.scoredCount, 1)
    assertError(await advance(t.admin, p, 'closed'), 409, 'performance_period_closed')
    assertError(
      await patch(t.admin, review, { staffComment: 'Geç görüş' }),
      409,
      'performance_period_closed',
    )
    const other = await person(t, 'onburo', 'Ali Demir')
    assertError(await addReview(t.admin, p, other), 409, 'performance_period_closed')
    const [row] = await rowsOf(t.id)
    assert.equal(row?.staffComment, 'Değerlendirmeye katılıyorum')

    const updates = await auditOf(t.id, 'finance.performance_review.update')
    assert.ok(updates.length >= 5)
    for (const entry of updates)
      assert.equal(JSON.stringify(entry.changes).includes('katılıyorum'), false)
  })

  test('DOM-FIN-124 K-429: kayıt okuması denetime alan adlarıyla düşer, değer yazılmaz', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const p = await period(t)
    ok(await addReview(t.admin, p, selin), 201)
    const response = await reviewsOf(t.admin, p)
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json() as { data: Json[]; meta: { total: number } }
    assert.equal(body.meta.total, 1)
    assert.deepEqual(
      (body.data[0]?.goals as Json[]).map((goal) => goal.weight),
      [60, 40],
    )
    const reads = await auditOf(t.id, 'finance.performance_review.read')
    assert.equal(reads.length, 1)
    assert.equal(reads[0]?.entityId, p.id)
    assert.deepEqual(reads[0]?.changes?.counts, { reviews: 1 })
    assert.equal(JSON.stringify(reads[0]?.changes).includes('Selin'), false)
  })

  test('DOM-FIN-124: başka kurumun dönemi ve kaydı 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const selin = await person(b, 'ogretmen', 'Selin Kaya')
    const pb = await period(b)
    const review = ok(await addReview(b.admin, pb, selin), 201)
    const aSelin = await person(a, 'ogretmen', 'Deniz Kaya')
    assertError(await reviewsOf(a.admin, pb), 404)
    assertError(await advance(a.admin, pb, 'active'), 404)
    assertError(await addReview(a.admin, pb, aSelin), 404)
    assertError(await patch(a.admin, review, { goals: [{ ...GOALS[0], weight: 100 }] }), 404)
    const pa = await period(a)
    assertError(await createPeriod(a.admin, { institutionId: b.id }), 400)
    assertError(
      await call(
        'POST',
        `${PERIODS}/${String(pa.id)}/reviews`,
        a.admin,
        { membershipId: aSelin, goals: GOALS, institutionId: b.id },
        key(),
      ),
      400,
    )
    assertError(await addReview(a.admin, pa, selin), 422, 'performance_staff_not_found')
    const list = (await call('GET', PERIODS, a.admin)).json() as { data: Json[] }
    assert.deepEqual(
      list.data.map((row) => row.id),
      [pa.id],
    )
    const [row] = await rowsOf(b.id)
    assert.equal(row?.version, 1)
    const [periodRow] = await db
      .select()
      .from(performancePeriods)
      .where(eq(performancePeriods.id, String(pb.id)))
    assert.equal(periodRow?.status, 'planning')
  })

  test('DOM-FIN-124: eski sürümle düzeltme 409 ve kayıt değişmez', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const p = await period(t)
    const review = ok(await addReview(t.admin, p, selin), 201)
    ok(await patch(t.admin, review, { goals: [{ ...GOALS[0], weight: 100 }] }))
    assertError(await patch(t.admin, review, { goals: GOALS }), 409)
    const [row] = await rowsOf(t.id)
    assert.equal(row?.goals.length, 1)
    assertError(await advance(t.admin, { ...p, version: 9 }, 'active'), 409)
  })
})
