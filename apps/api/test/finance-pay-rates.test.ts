import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships } from '../src/db/schema/auth.ts'
import { staffPayRates } from '../src/db/schema/finance-pay-rates.ts'
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
 * Personel ücret tanımı uçları (DOM-FIN-099; ON-194; K-304…K-307). Her test kendi kurumunu kurar;
 * personel adlı kullanıcıyla açılır. FIXED_NOW 2026-10-06.
 */

const FINANCE = '/api/v1/finance'
const RATES = `${FINANCE}/pay-rates`
const STAFF = `${FINANCE}/pay-rate-staff`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-099: personel ücret tanımı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.94.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST',
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
    clientIp = `10.94.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  /** Adlı personel ya da veli üyeliği (giriş yapmaz). */
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
  const wage = (membershipId: string, startDate: string, amountCents = 4_500_000): Json => ({
    component: 'wage',
    membershipId,
    rateType: 'monthly_gross',
    amountCents,
    startDate,
  })
  const create = (cookie: string, body: Json, headers: Record<string, string> = {}) =>
    call('POST', RATES, cookie, body, headers)
  const created = async (cookie: string, body: Json) => {
    const data = ok(await create(cookie, body), 201)
    return { rate: data.rate as Json, closedRate: data.closedRate as Json | null }
  }
  const end = (cookie: string, rate: Json, endDate: string | null) =>
    call('POST', `${RATES}/${String(rate.id)}/end`, cookie, { endDate }, ifMatch(rate.version))
  const cancel = (cookie: string, rate: Json, reason = 'Yanlış tutar girildi') =>
    call('POST', `${RATES}/${String(rate.id)}/cancel`, cookie, { reason }, ifMatch(rate.version))
  const rowsOf = (institutionId: string) =>
    db.select().from(staffPayRates).where(eq(staffPayRates.institutionId, institutionId))
  const staffListOf = async (cookie: string, query = '') => {
    const response = await get(`${STAFF}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }
  const detailOf = async (cookie: string, membershipId: string, query = '') =>
    ok(await get(`${STAFF}/${membershipId}${query}`, cookie))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('kimliksiz istek 401', async () => {
    const url = `${RATES}/${randomUUID()}`
    assertError(await get(STAFF, null), 401)
    assertError(await get(`${STAFF}/m-1`, null), 401)
    assertError(await call('POST', RATES, null, wage('m-1', '2026-09-01')), 401)
    assertError(await call('POST', `${url}/end`, null, { endDate: null }, ifMatch(1)), 401)
    assertError(await call('POST', `${url}/cancel`, null, { reason: 'Yanlış' }, ifMatch(1)), 401)
  })

  test('DOM-FIN-099: ön büro, öğretmen, veli ve öğrenci 403; tanım değişmez (K-306)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const { rate } = await created(t.admin, wage(selin, '2026-09-01'))
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(STAFF, cookie), 403)
      assertError(await get(`${STAFF}/${selin}`, cookie), 403)
      assertError(await create(cookie, wage(selin, '2026-10-01')), 403)
      assertError(await end(cookie, rate, '2026-12-31'), 403)
      assertError(await cancel(cookie, rate), 403)
    }
    const rows = await rowsOf(t.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.endDate, null)
    assert.equal(rows[0]?.version, 1)
    assert.equal((await auditOf(t.id, 'finance.pay_rate.read')).length, 0)
  })

  test('DOM-FIN-099: finance modülü kapalıyken ücret uçları 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(STAFF, closed.admin), 403, 'module_disabled')
    assertError(await get(`${STAFF}/m-1`, closed.admin), 403, 'module_disabled')
    assertError(await create(closed.admin, wage('m-1', '2026-09-01')), 403, 'module_disabled')
  })

  test('DOM-FIN-099: yeni tanım öncekini bir gün önceye kapatır; geçmiş ve şu tarihte geçerli ücret (K-304)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const first = await created(t.admin, {
      ...wage(selin, '2026-01-01', 4_000_000),
      note: ' Giriş ',
    })
    assert.equal(first.closedRate, null)
    assert.equal(first.rate.state, 'active')
    assert.equal(first.rate.note, 'Giriş')
    // Ana ücret türü değişse de aynı yuvadır: saatlik ücrete geçiş aylığı kapatır.
    const second = await created(t.admin, {
      ...wage(selin, '2026-11-01', 50_000),
      rateType: 'hourly',
    })
    assert.equal(second.rate.state, 'scheduled')
    assert.equal(second.closedRate?.id, first.rate.id)
    assert.equal(second.closedRate?.endDate, '2026-10-31')
    assert.equal(second.closedRate?.autoClosed, true)
    // Ek ders ve yan haklar ayrı yuvadır; ana ücreti kapatmaz.
    await created(t.admin, {
      component: 'lesson',
      membershipId: selin,
      rateType: 'extra',
      amountCents: 30_000,
      startDate: '2026-09-01',
    })
    await created(t.admin, {
      component: 'benefit',
      membershipId: selin,
      rateType: 'meal',
      benefitForm: 'in_kind',
      taxable: false,
      amountCents: 300_000,
      startDate: '2026-09-01',
      endDate: '2027-06-30',
    })

    const today = await detailOf(t.admin, selin)
    assert.equal(today.name, 'Selin Kaya')
    assert.equal(today.date, '2026-10-06')
    assert.equal((today.rates as Json[]).length, 4)
    const effective = today.effective as Json[]
    assert.deepEqual(
      effective.map((rate) => [rate.component, rate.rateType, rate.amountCents]),
      [
        ['wage', 'monthly_gross', 4_000_000],
        ['lesson', 'extra', 30_000],
        ['benefit', 'meal', 300_000],
      ],
    )
    const later = await detailOf(t.admin, selin, '?date=2026-11-01')
    assert.deepEqual(
      (later.effective as Json[]).map((rate) => rate.rateType),
      ['hourly', 'extra', 'meal'],
    )
    // Denetimde tutar ve not yok; kapatma ayrı satırdır, her tutarlı okuma kayıtlıdır (K-307).
    const creates = await auditOf(t.id, 'finance.pay_rate.create')
    assert.equal(creates.length, 4)
    assert.equal(JSON.stringify(creates).includes('4000000'), false)
    assert.ok(creates.every((row) => !JSON.stringify(row.changes).includes('Giriş')))
    assert.equal((await auditOf(t.id, 'finance.pay_rate.close')).length, 1)
    const reads = await auditOf(t.id, 'finance.pay_rate.read')
    assert.equal(reads.length, 2)
    assert.deepEqual(reads[0]?.changes, { fields: ['amountCents'] })
    assert.equal(reads[0]?.entityId, selin)
  })

  test('DOM-FIN-099: personel listesi varsayılan maskeli; tutar gösterimi denetime düşer (K-306, K-307)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const merve = await person(t, 'onburo', 'Merve Ak')
    await person(t, 'veli', 'Ayşe Yılmaz')
    await created(t.admin, wage(selin, '2026-09-01'))
    const masked = await staffListOf(t.admin)
    const names = masked.data.map((row) => row.name)
    assert.ok(names.includes('Selin Kaya') && names.includes('Merve Ak'))
    assert.equal(names.includes('Ayşe Yılmaz'), false)
    const row = masked.data.find((item) => item.membershipId === selin)
    assert.deepEqual(row?.wage, {
      rateType: 'monthly_gross',
      amountCents: null,
      startDate: '2026-09-01',
    })
    assert.equal(masked.data.find((item) => item.membershipId === merve)?.wage, null)
    assert.equal((await auditOf(t.id, 'finance.pay_rate.read')).length, 0)

    const shown = await staffListOf(t.admin, '?showAmounts=true&q=selin')
    assert.equal(shown.meta.total, 1)
    assert.equal((shown.data[0]?.wage as Json).amountCents, 4_500_000)
    const reads = await auditOf(t.id, 'finance.pay_rate.read')
    assert.equal(reads.length, 1)
    assert.equal(reads[0]?.entityId, t.id)
    const before = await staffListOf(t.admin, '?date=2026-08-31')
    assert.equal(before.data.find((item) => item.membershipId === selin)?.wage, null)
    assertError(await get(`${STAFF}?showAmounts=evet`, t.admin), 400)
    assertError(await get(`${STAFF}?institutionId=x`, t.admin), 400)
  })

  test('DOM-FIN-099: geçersiz gövde 400, kural reddi 422; kayıt değişmez (K-304, K-305)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const parent = await person(t, 'veli', 'Ayşe Yılmaz')
    const left = await person(t, 'onburo', 'Ahmet Ayrılan')
    await db.update(memberships).set({ deactivatedAt: FIXED_NOW }).where(eq(memberships.id, left))
    await created(t.admin, wage(selin, '2026-09-01'))
    const before = await rowsOf(t.id)

    for (const bad of [
      { ...wage(selin, '2026-10-01'), amountCents: 0 },
      { ...wage(selin, '2026-10-01'), rateType: 'meal' },
      { ...wage(selin, '2026-10-01'), endDate: '2026-09-30' },
      { ...wage(selin, '2026-10-01'), benefitForm: 'cash' },
      {
        component: 'benefit',
        membershipId: selin,
        rateType: 'meal',
        amountCents: 1,
        startDate: '2026-10-01',
      },
    ])
      assertError(await create(t.admin, bad), 400)
    assertError(
      await create(t.admin, wage(selin, '2026-09-01')),
      422,
      'pay_rate_start_not_after_latest',
    )
    assertError(
      await create(t.admin, wage(selin, '2026-08-01')),
      422,
      'pay_rate_start_not_after_latest',
    )
    assertError(await create(t.admin, wage('yok', '2026-10-01')), 422, 'pay_rate_staff_not_found')
    assertError(await create(t.admin, wage(parent, '2026-10-01')), 422, 'pay_rate_not_staff')
    assertError(await create(t.admin, wage(left, '2026-10-01')), 422, 'pay_rate_staff_inactive')
    assert.deepEqual(await rowsOf(t.id), before)
    assertError(await get(`${STAFF}/${parent}`, t.admin), 404)
    assertError(await get(`${STAFF}/yok`, t.admin), 404)
  })

  test('DOM-FIN-099: bitiş yalnız son tanımda değişir; If-Match ve sürüm denetlenir (K-304)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const first = await created(t.admin, wage(selin, '2026-01-01'))
    const second = await created(t.admin, wage(selin, '2026-09-01', 5_000_000))
    const old = second.closedRate as Json
    assertError(await end(t.admin, old, '2026-12-31'), 422, 'pay_rate_not_latest')
    assertError(await end(t.admin, first.rate, '2026-12-31'), 409)
    assertError(await end(t.admin, second.rate, '2026-08-31'), 422, 'pay_rate_end_before_start')
    assertError(await end(t.admin, second.rate, null), 422, 'pay_rate_end_unchanged')
    assertError(
      await call('POST', `${RATES}/${String(second.rate.id)}/end`, t.admin, { endDate: null }),
      400,
      'if_match_required',
    )
    const ended = ok(await end(t.admin, second.rate, '2027-06-30'))
    assert.equal(ended.endDate, '2027-06-30')
    assert.equal(ended.version, 2)
    assertError(await end(t.admin, second.rate, '2027-07-31'), 409)
    // Bitiş sonrası boşlukla başlayan tanım öncekini kapatmaz.
    const third = await created(t.admin, wage(selin, '2027-09-01', 5_500_000))
    assert.equal(third.closedRate, null)
    assert.equal((await auditOf(t.id, 'finance.pay_rate.end')).length, 1)
  })

  test('DOM-FIN-099: iptal yalnız son tanımda; kapattığı tanımın eski bitişi geri yazılır (K-304)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    await created(t.admin, { ...wage(selin, '2026-01-01'), endDate: '2026-12-31' })
    const second = await created(t.admin, wage(selin, '2026-09-01', 5_000_000))
    const old = second.closedRate as Json
    assert.equal(old.endDate, '2026-08-31')
    assertError(await cancel(t.admin, old), 422, 'pay_rate_not_latest')
    assertError(await cancel(t.admin, second.rate, 'kısa'), 400)
    const cancelled = ok(await cancel(t.admin, second.rate))
    const reopened = cancelled.reopenedRate as Json
    assert.equal(reopened.id, old.id)
    assert.equal(reopened.endDate, '2026-12-31')
    assert.equal(reopened.autoClosed, false)
    assertError(await cancel(t.admin, { ...second.rate, version: 2 }), 404)
    const rows = await rowsOf(t.id)
    const archived = rows.find((row) => row.id === second.rate.id)
    assert.equal(archived?.cancelReason, 'Yanlış tutar girildi')
    assert.ok(archived?.archivedAt)
    const detail = await detailOf(t.admin, selin)
    assert.equal((detail.rates as Json[]).length, 1)
    // İptalden sonra aynı gün yeniden tanım yazılabilir.
    const again = await created(t.admin, wage(selin, '2026-09-01', 5_100_000))
    assert.equal(again.closedRate?.endDate, '2026-08-31')
    const cancelAudit = await auditOf(t.id, 'finance.pay_rate.cancel')
    assert.equal(cancelAudit.length, 1)
    assert.equal(JSON.stringify(cancelAudit).includes('Yanlış tutar'), false)
    assert.equal((await auditOf(t.id, 'finance.pay_rate.reopen')).length, 1)
  })

  test('DOM-FIN-099: başka kurumun personeli ve tanımı 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bStaff = await person(b, 'ogretmen', 'Beta Öğretmen')
    const bRate = (await created(b.admin, wage(bStaff, '2026-09-01'))).rate
    const bUrl = `${RATES}/${String(bRate.id)}`

    assertError(await get(`${STAFF}/${bStaff}`, a.admin), 404)
    assertError(
      await call('POST', `${bUrl}/end`, a.admin, { endDate: '2026-12-31' }, ifMatch(1)),
      404,
    )
    assertError(
      await call('POST', `${bUrl}/cancel`, a.admin, { reason: 'Başka kurum' }, ifMatch(1)),
      404,
    )
    assert.equal(
      (await staffListOf(a.admin)).data.some((item) => item.membershipId === bStaff),
      false,
    )
    assertError(await create(a.admin, wage(bStaff, '2026-10-01')), 422, 'pay_rate_staff_not_found')
    assertError(await create(a.admin, { ...wage(bStaff, '2026-10-01'), institutionId: b.id }), 400)
    assert.equal((await rowsOf(a.id)).length, 0)
    const [bRow] = await rowsOf(b.id)
    assert.equal(bRow?.endDate, null)
    assert.equal(bRow?.archivedAt, null)
    assert.equal(bRow?.version, 1)
    assert.equal((await auditOf(b.id, 'finance.pay_rate.read')).length, 0)
  })

  test('DOM-FIN-099: Idempotency-Key ile yinelenen tanım aynı yanıtı döner, tek satır yazılır', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const headers = { 'idempotency-key': randomUUID() }
    const first = await create(t.admin, wage(selin, '2026-09-01'), headers)
    const second = await create(t.admin, wage(selin, '2026-09-01'), headers)
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.rate.id, first.json().data.rate.id)
    assert.equal((await rowsOf(t.id)).length, 1)
    // Anahtarsız tekrar aynı başlangıçla 422 olur; ikinci satır açılmaz.
    assertError(
      await create(t.admin, wage(selin, '2026-09-01')),
      422,
      'pay_rate_start_not_after_latest',
    )
  })
})
