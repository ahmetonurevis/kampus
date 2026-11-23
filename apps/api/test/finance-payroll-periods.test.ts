import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { staffPayRates } from '../src/db/schema/finance-pay-rates.ts'
import { payrollParameterSets } from '../src/db/schema/finance-payroll-parameters.ts'
import { payrollAdjustments, payrollPeriods } from '../src/db/schema/finance-payroll-periods.ts'
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
 * Bordro onayı ve dönem kilidi uçları (DOM-FIN-108; ON-200; K-356…K-359). Her test kendi kurumunu
 * kurar. FIXED_NOW 2026-10-06: bu ay 2026-10, eylül onaylanabilir, kasım ileri ay.
 */

const FINANCE = '/api/v1/finance'
const PERIODS = `${FINANCE}/payroll-periods`
const ADJUSTMENTS = `${FINANCE}/payroll-adjustments`
const RATES = `${FINANCE}/pay-rates`
const PARAMETERS = `${FINANCE}/payroll-parameters`
const PARAMETER_SET = {
  effectiveFrom: '2026-10-01',
  minimumWageGrossCents: 3_600_000,
  incomeTaxBrackets: [
    { lowerBoundCents: 0, rateBasisPoints: 1500 },
    { lowerBoundCents: 19_000_000, rateBasisPoints: 2000 },
  ],
  sgkEmployeeRateBasisPoints: 1400,
  sgkEmployerRateBasisPoints: 2075,
  sgkEmployerIncentiveBasisPoints: 500,
  unemploymentEmployeeRateBasisPoints: 100,
  unemploymentEmployerRateBasisPoints: 200,
  sgkFloorMultiplierBasisPoints: 10_000,
  sgkCeilingMultiplierBasisPoints: 90_000,
  stampTaxRatePer100k: 759,
  minimumWageIncomeTaxExempt: true,
  minimumWageStampTaxExempt: true,
  severanceCeilingCents: 7_000_000,
  source: 'Kurum mali müşaviri yazısı (örnek)',
}

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>
interface MonthView extends Json {
  month: string
  state: string
  version: number | null
  current: (Json & { inputsHash: string }) | null
  approved: Json | null
}

describe('DOM-FIN-108: bordro onayı ve dönem kilidi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.108.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
  const key = () => ({ 'idempotency-key': randomUUID() })
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"`, ...key() })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.108.${String((tenantCount += 1))}.1`
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
  const wage = (membershipId: string, startDate: string, amountCents = 4_500_000): Json => ({
    component: 'wage',
    membershipId,
    rateType: 'monthly_gross',
    amountCents,
    startDate,
  })
  const createRate = (cookie: string, body: Json) => call('POST', RATES, cookie, body)
  const yearOf = async (cookie: string, year = 2026) =>
    ok(await get(`${PERIODS}?year=${String(year)}`, cookie)) as {
      year: number
      currentMonth: string
      lockedMonths: string[]
      months: MonthView[]
    }
  const monthOf = async (cookie: string, month: string) => {
    const view = (await yearOf(cookie, Number(month.slice(0, 4)))).months.find(
      (item) => item.month === month,
    )
    assert.ok(view)
    return view
  }
  const approve = (
    cookie: string | null,
    month: string,
    inputsHash: string,
    headers: Record<string, string> = key(),
  ) => call('POST', `${PERIODS}/${month}/approve`, cookie, { inputsHash }, headers)
  async function approved(cookie: string, month: string) {
    const view = await monthOf(cookie, month)
    assert.ok(view.current, `${month} için güncel özet yok`)
    return ok(
      await approve(cookie, month, view.current.inputsHash),
      view.version === null ? 201 : 200,
    ) as MonthView
  }
  const reopen = (
    cookie: string,
    month: string,
    version: unknown,
    reason = 'Ek ders eksik girildi',
  ) => call('POST', `${PERIODS}/${month}/reopen`, cookie, { reason }, ifMatch(version))
  const adjustment = (membershipId: string, amountCents = 125_000): Json => ({
    membershipId,
    item: 'lesson',
    amountCents,
    reason: 'Eylül ek dersi eksik ödendi',
  })
  const createAdjustment = (
    cookie: string | null,
    month: string,
    body: Json,
    headers: Record<string, string> = key(),
  ) => call('POST', `${PERIODS}/${month}/adjustments`, cookie, body, headers)
  const cancelAdjustment = (cookie: string, item: Json, reason = 'Yanlış personel seçildi') =>
    call(
      'POST',
      `${ADJUSTMENTS}/${String(item.id)}/cancel`,
      cookie,
      { reason },
      ifMatch(item.version),
    )
  const listAdjustments = async (cookie: string, month: string) => {
    const response = await get(`${PERIODS}/${month}/adjustments`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }
  const periodRows = (institutionId: string) =>
    db.select().from(payrollPeriods).where(eq(payrollPeriods.institutionId, institutionId))
  const adjustmentRows = (institutionId: string) =>
    db.select().from(payrollAdjustments).where(eq(payrollAdjustments.institutionId, institutionId))
  const rateRows = (institutionId: string) =>
    db.select().from(staffPayRates).where(eq(staffPayRates.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    assertError(await get(PERIODS, null), 401)
    assertError(await approve(null, '2026-09', 'a'.repeat(64)), 401)
    assertError(await call('POST', `${PERIODS}/2026-09/reopen`, null, { reason: 'abcdef' }), 401)
    assertError(await get(`${PERIODS}/2026-09/adjustments`, null), 401)
    assertError(await createAdjustment(null, '2026-09', adjustment('m-1')), 401)
    assertError(await call('POST', `${ADJUSTMENTS}/${id}/cancel`, null, { reason: 'abcdef' }), 401)
  })

  test('DOM-FIN-108: ön büro, öğretmen, veli ve öğrenci 403; dönem değişmez (K-359)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    await approved(t.admin, '2026-09')
    const item = ok(await createAdjustment(t.admin, '2026-09', adjustment(selin)), 201)
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(PERIODS, cookie), 403)
      assertError(await approve(cookie, '2026-08', 'a'.repeat(64)), 403)
      assertError(await reopen(cookie, '2026-09', 1), 403)
      assertError(await get(`${PERIODS}/2026-09/adjustments`, cookie), 403)
      assertError(await createAdjustment(cookie, '2026-09', adjustment(selin)), 403)
      assertError(await cancelAdjustment(cookie, item), 403)
    }
    const rows = await periodRows(t.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.status, 'approved')
    assert.equal((await adjustmentRows(t.id))[0]?.archivedAt, null)
  })

  test('DOM-FIN-108: finance modülü kapalıyken uçlar 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(PERIODS, closed.admin), 403, 'module_disabled')
    assertError(await approve(closed.admin, '2026-09', 'a'.repeat(64)), 403, 'module_disabled')
    assertError(await get(`${PERIODS}/2026-09/adjustments`, closed.admin), 403, 'module_disabled')
  })

  test('DOM-FIN-108: ay listesi, onay özeti ve damgası; onaylanan ay kilitlenir (K-356)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const merve = await person(t, 'onburo', 'Merve Ak')
    ok(await createRate(t.admin, wage(selin, '2026-01-01', 4_000_000)), 201)
    ok(await createRate(t.admin, wage(selin, '2026-09-15', 4_500_000)), 201)
    ok(
      await createRate(t.admin, {
        ...wage(merve, '2026-08-01'),
        rateType: 'hourly',
        amountCents: 30_000,
      }),
      201,
    )

    const year = await yearOf(t.admin)
    assert.equal(year.months.length, 12)
    assert.equal(year.currentMonth, '2026-10')
    assert.deepEqual(year.lockedMonths, [])
    const september = year.months.find((item) => item.month === '2026-09')
    assert.equal(september?.state, 'open')
    assert.deepEqual(
      { ...september?.current, inputsHash: undefined },
      {
        staffCount: 2,
        rateCount: 3,
        monthlyGrossTotalCents: 4_500_000,
        adjustmentCount: 0,
        adjustmentTotalCents: 0,
        parameterSetId: 'platform-2026-01-01',
        parameterEffectiveFrom: '2026-01-01',
        inputsHash: undefined,
      },
    )
    // Başlamamış ayın güncel özeti yoktur.
    assert.equal(year.months.find((item) => item.month === '2026-11')?.current, null)

    const view = await approved(t.admin, '2026-09')
    assert.equal(view.state, 'approved')
    assert.equal(view.version, 1)
    assert.equal(view.approvedByName, 'Test Yönetici')
    assert.equal(view.approvedAt, FIXED_NOW.toISOString())
    assert.deepEqual(view.approved, september?.current)
    const rows = await periodRows(t.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.inputsHash, september?.current?.inputsHash)
    assert.equal(rows[0]?.monthlyGrossTotalCents, 4_500_000)
    assert.deepEqual((await yearOf(t.admin)).lockedMonths, ['2026-09'])
    const audit = await auditOf(t.id, 'finance.payroll_period.approve')
    assert.equal(audit.length, 1)
    assert.deepEqual(audit[0]?.changes, { fields: ['status', 'approvedAt', 'inputsHash'] })
  })

  test('DOM-FIN-108 K-426: K-426 öncesi onaylanan dönem değişmez; yeniden açılan ay yeni damgayla onaylanır', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    ok(await createRate(t.admin, wage(selin, '2026-01-01')), 201)
    const view = await approved(t.admin, '2026-08')
    // Eski biçimle üretilmiş damga (kesinti ve hesap revizyonu kapsamıyordu) saklı kalır.
    const legacy = 'c'.repeat(64)
    await db
      .update(payrollPeriods)
      .set({ inputsHash: legacy })
      .where(and(eq(payrollPeriods.institutionId, t.id), eq(payrollPeriods.month, '2026-08')))
    const august = await monthOf(t.admin, '2026-08')
    assert.equal(august.state, 'approved')
    assert.equal((august.approved as Json).inputsHash, legacy)
    assert.equal(august.current, null)
    assert.equal(august.checks, null)
    assert.deepEqual((await yearOf(t.admin)).lockedMonths, ['2026-08'])
    // Yeniden açılan ayın güncel damgası yeniden hesaplanır ve onay onunla geçer.
    ok(await reopen(t.admin, '2026-08', view.version))
    const reopened = await monthOf(t.admin, '2026-08')
    assert.notEqual(reopened.current?.inputsHash, legacy)
    assert.ok(reopened.checks)
    assertError(await approve(t.admin, '2026-08', legacy), 409, 'payroll_inputs_changed')
    assert.equal((await approved(t.admin, '2026-08')).state, 'approved')
  })

  test('DOM-FIN-108: onay hataları ve mükerrer onay (K-356)', async () => {
    const t = await institution()
    const september = await monthOf(t.admin, '2026-09')
    const hash = september.current?.inputsHash ?? ''
    // Idempotency-Key zorunlu; gövde katı.
    assertError(await approve(t.admin, '2026-09', hash, {}), 400, 'idempotency_key_required')
    assertError(
      await call(
        'POST',
        `${PERIODS}/2026-09/approve`,
        t.admin,
        { inputsHash: hash, institutionId: 'x' },
        key(),
      ),
      400,
    )
    assertError(await approve(t.admin, '2026-13', hash), 400)
    assertError(await approve(t.admin, '2026-09', 'f'.repeat(64)), 409, 'payroll_inputs_changed')
    assertError(await approve(t.admin, '2026-11', hash), 422, 'payroll_period_in_future')
    assert.equal((await periodRows(t.id)).length, 0)

    const headers = key()
    const first = await approve(t.admin, '2026-09', hash, headers)
    assert.equal(first.statusCode, 201, first.body)
    const replay = await approve(t.admin, '2026-09', hash, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), first.json())
    assertError(await approve(t.admin, '2026-09', hash), 409, 'payroll_period_already_approved')
    assert.equal((await periodRows(t.id)).length, 1)
  })

  test('DOM-FIN-108: girdi siz bakarken değişirse onay 409 payroll_inputs_changed', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const before = await monthOf(t.admin, '2026-09')
    ok(await createRate(t.admin, wage(selin, '2026-09-01')), 201)
    assertError(
      await approve(t.admin, '2026-09', before.current?.inputsHash ?? ''),
      409,
      'payroll_inputs_changed',
    )
    assert.equal((await periodRows(t.id)).length, 0)
  })

  test('DOM-FIN-108: kilitli aya düşen ücret tanımı yazmaları 409, ileri tarihli tanım serbest (K-357)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const old = ok(await createRate(t.admin, wage(selin, '2026-08-01')), 201).rate as Json
    await approved(t.admin, '2026-09')
    const before = await rateRows(t.id)

    // Geçmişe (kilitli eylüle) başlayan tanım reddedilir; önceki tanım da kapanmaz.
    const locked = await createRate(t.admin, wage(selin, '2026-09-15', 5_000_000))
    assertError(locked, 409, 'payroll_period_locked')
    assert.deepEqual(locked.json().issues?.[0]?.path, ['startDate'])
    // Bitişi kilitli aya çekmek ve kilitli ayı kapsayan tanımı iptal etmek reddedilir.
    assertError(
      await call(
        'POST',
        `${RATES}/${String(old.id)}/end`,
        t.admin,
        { endDate: '2026-09-20' },
        ifMatch(old.version),
      ),
      409,
      'payroll_period_locked',
    )
    assertError(
      await call(
        'POST',
        `${RATES}/${String(old.id)}/cancel`,
        t.admin,
        { reason: 'Yanlış tutar' },
        ifMatch(old.version),
      ),
      409,
      'payroll_period_locked',
    )
    assert.deepEqual(await rateRows(t.id), before)

    // İleri tarihli yeni tanım serbest: önceki tanım ekim başından kapanır, eylül değişmez.
    const next = ok(await createRate(t.admin, wage(selin, '2026-10-01', 5_000_000)), 201)
    assert.equal((next.closedRate as Json).endDate, '2026-09-30')
    // Ekimdeki bitiş değişikliği de serbest.
    const rate = next.rate as Json
    ok(
      await call(
        'POST',
        `${RATES}/${String(rate.id)}/end`,
        t.admin,
        { endDate: '2026-12-31' },
        ifMatch(rate.version),
      ),
    )
  })

  test('DOM-FIN-108: kilitli ayda geçerli seti değiştiren bordro parametresi yazmaları 409 (K-357)', async () => {
    const t = await institution()
    await approved(t.admin, '2026-09')
    // Mart başlangıçlı set eylülde de geçerli olurdu.
    assertError(
      await call('POST', PARAMETERS, t.admin, { ...PARAMETER_SET, effectiveFrom: '2026-03-01' }),
      409,
      'payroll_period_locked',
    )
    const saved = ok(await call('POST', PARAMETERS, t.admin, PARAMETER_SET), 201)
    // Başlangıcını kilitli aya çekmek reddedilir; başka alan düzeltmesi ve arşiv serbest.
    assertError(
      await call(
        'PATCH',
        `${PARAMETERS}/${String(saved.id)}`,
        t.admin,
        { effectiveFrom: '2026-09-01' },
        ifMatch(saved.version),
      ),
      409,
      'payroll_period_locked',
    )
    const patched = ok(
      await call(
        'PATCH',
        `${PARAMETERS}/${String(saved.id)}`,
        t.admin,
        { source: 'Düzeltilmiş kaynak yazısı' },
        ifMatch(saved.version),
      ),
    )
    ok(
      await call(
        'DELETE',
        `${PARAMETERS}/${String(saved.id)}`,
        t.admin,
        undefined,
        ifMatch(patched.version),
      ),
    )
    const rows = await db
      .select()
      .from(payrollParameterSets)
      .where(eq(payrollParameterSets.institutionId, t.id))
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.effectiveFrom, '2026-10-01')
  })

  test('DOM-FIN-108: yeniden açma gerekçeli, kilit kalkar, yeniden onay ikinci onaydır (K-356)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const view = await approved(t.admin, '2026-09')
    assertError(
      await call('POST', `${PERIODS}/2026-09/reopen`, t.admin, { reason: 'Ek ders eksik' }, key()),
      400,
      'if_match_required',
    )
    assertError(await reopen(t.admin, '2026-09', view.version, 'kısa'), 400, 'validation_failed')
    assertError(await reopen(t.admin, '2026-09', 7), 409, 'version_conflict')
    assertError(await reopen(t.admin, '2026-08', 1), 409, 'payroll_period_not_approved')
    assert.equal((await periodRows(t.id))[0]?.status, 'approved')

    const opened = ok(await reopen(t.admin, '2026-09', view.version)) as MonthView
    assert.equal(opened.state, 'reopened')
    assert.equal(opened.reopenReason, 'Ek ders eksik girildi')
    assert.equal(opened.reopenedByName, 'Test Yönetici')
    assertError(
      await reopen(t.admin, '2026-09', opened.version),
      409,
      'payroll_period_not_approved',
    )
    assert.deepEqual((await yearOf(t.admin)).lockedMonths, [])
    // Açılan aya tanım yazılır; yeniden onay özeti yeniler.
    ok(await createRate(t.admin, wage(selin, '2026-09-01')), 201)
    const again = await approved(t.admin, '2026-09')
    assert.equal(again.approvalCount, 2)
    assert.equal((again.approved as Json).staffCount, 1)
    assert.equal(again.reopenReason, 'Ek ders eksik girildi')
    assert.equal((await auditOf(t.id, 'finance.payroll_period.approve')).length, 2)
    const reopenAudit = await auditOf(t.id, 'finance.payroll_period.reopen')
    assert.equal(reopenAudit.length, 1)
    assert.doesNotMatch(JSON.stringify(reopenAudit[0]?.changes), /Ek ders eksik/)
  })

  test('DOM-FIN-108: düzeltme kaydı yalnız kilitli ayda, sonraki ilk kilitsiz aya aktarılır (K-358)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const parent = await person(t, 'veli', 'Ayşe Yılmaz')
    assertError(
      await createAdjustment(t.admin, '2026-09', adjustment(selin)),
      422,
      'payroll_period_not_locked',
    )
    await approved(t.admin, '2026-08')
    await approved(t.admin, '2026-09')
    assertError(
      await createAdjustment(t.admin, '2026-09', adjustment(selin, 0)),
      400,
      'validation_failed',
    )
    assertError(
      await createAdjustment(t.admin, '2026-09', { ...adjustment(selin), institutionId: 'x' }),
      400,
    )
    assertError(
      await createAdjustment(t.admin, '2026-09', adjustment('m-yok')),
      422,
      'payroll_adjustment_staff_not_found',
    )
    assertError(
      await createAdjustment(t.admin, '2026-09', adjustment(parent)),
      422,
      'payroll_adjustment_not_staff',
    )
    assertError(
      await createAdjustment(t.admin, '2026-09', adjustment(selin), {}),
      400,
      'idempotency_key_required',
    )
    assert.equal((await adjustmentRows(t.id)).length, 0)

    const headers = key()
    const first = await createAdjustment(t.admin, '2026-08', adjustment(selin, -50_000), headers)
    assert.equal(first.statusCode, 201, first.body)
    const created = first.json().data as Json
    // Eylül de kilitli: ağustos farkı ekime aktarılır.
    assert.equal(created.targetMonth, '2026-10')
    assert.equal(created.sourceMonth, '2026-08')
    assert.equal(created.amountCents, -50_000)
    assert.equal(created.staffName, 'Selin Kaya')
    const replay = await createAdjustment(t.admin, '2026-08', adjustment(selin, -50_000), headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await adjustmentRows(t.id)).length, 1)

    // Asıl dönem değişmez; ekimin güncel özeti düzeltmeyi taşır.
    const year = await yearOf(t.admin)
    const august = year.months.find((item) => item.month === '2026-08')
    assert.equal(august?.state, 'approved')
    assert.equal(august?.adjustmentCount, 1)
    assert.equal((august?.approved as Json).adjustmentCount, 0)
    const october = year.months.find((item) => item.month === '2026-10')
    assert.equal(october?.current?.adjustmentCount, 1)
    assert.equal(october?.current?.adjustmentTotalCents, -50_000)

    // Liste tutar içerir: her okuma denetime düşer.
    const list = await listAdjustments(t.admin, '2026-08')
    assert.equal(list.meta.total, 1)
    assert.equal(list.data[0]?.id, created.id)
    assert.equal((await listAdjustments(t.admin, '2026-11')).meta.total, 0)
    const reads = await auditOf(t.id, 'finance.payroll_adjustment.read')
    assert.equal(reads.length, 1)
    assert.deepEqual(reads[0]?.changes, { fields: ['amountCents'] })
    const creates = await auditOf(t.id, 'finance.payroll_adjustment.create')
    assert.equal(creates.length, 1)
    assert.doesNotMatch(JSON.stringify(creates[0]?.changes), /50000|Eylül ek dersi/)

    // Düzeltmesi olan ay yeniden açılmaz.
    const augustRow = (await periodRows(t.id)).find((row) => row.month === '2026-08')
    assertError(
      await reopen(t.admin, '2026-08', augustRow?.version),
      422,
      'payroll_period_has_adjustments',
    )
  })

  test('DOM-FIN-108: düzeltme iptali; hedef ay onaylandıysa 409 (K-358)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    await approved(t.admin, '2026-08')
    const first = ok(await createAdjustment(t.admin, '2026-08', adjustment(selin)), 201)
    const second = ok(await createAdjustment(t.admin, '2026-08', adjustment(selin, 20_000)), 201)
    assert.equal(first.targetMonth, '2026-09')

    assertError(
      await call(
        'POST',
        `${ADJUSTMENTS}/${String(first.id)}/cancel`,
        t.admin,
        { reason: 'Yanlış' },
        key(),
      ),
      400,
      'if_match_required',
    )
    assertError(await cancelAdjustment(t.admin, first, 'kısa'), 400, 'validation_failed')
    assertError(await cancelAdjustment(t.admin, { ...first, version: 9 }), 409, 'version_conflict')
    ok(await cancelAdjustment(t.admin, first))
    assertError(await cancelAdjustment(t.admin, first), 404)
    const rows = await adjustmentRows(t.id)
    const cancelled = rows.find((row) => row.id === first.id)
    assert.ok(cancelled?.archivedAt)
    assert.equal(cancelled?.cancelReason, 'Yanlış personel seçildi')

    // Eylül onaylanınca ikinci düzeltme eylülün girdisidir: iptal edilmez.
    const september = await approved(t.admin, '2026-09')
    assert.equal((september.approved as Json).adjustmentCount, 1)
    assertError(await cancelAdjustment(t.admin, second), 409, 'payroll_period_locked')
    assert.equal((await adjustmentRows(t.id)).find((row) => row.id === second.id)?.archivedAt, null)
  })

  test('DOM-FIN-108: başka kurumun dönemi ve düzeltmesi 404 ve B değişmez; kilit kuruma özeldir', async () => {
    const a = await institution()
    const b = await institution()
    const bStaff = await person(b, 'ogretmen', 'Beta Öğretmen')
    const aStaff = await person(a, 'ogretmen', 'Alfa Öğretmen')
    await approved(b.admin, '2026-08')
    const bItem = ok(await createAdjustment(b.admin, '2026-08', adjustment(bStaff)), 201)
    const bPeriod = (await periodRows(b.id))[0]

    // A'nın listesinde B'nin onayı ve kilidi yok; A'nın ağustosu açıktır.
    const aYear = await yearOf(a.admin)
    assert.deepEqual(aYear.lockedMonths, [])
    assert.equal(aYear.months.find((item) => item.month === '2026-08')?.state, 'open')
    assert.equal((await listAdjustments(a.admin, '2026-08')).meta.total, 0)
    // B'nin düzeltmesi A'dan 404; B'nin dönemi A'dan yeniden açılamaz (A'da kayıt yok).
    assertError(await cancelAdjustment(a.admin, bItem), 404)
    assertError(
      await reopen(a.admin, '2026-08', bPeriod?.version),
      409,
      'payroll_period_not_approved',
    )
    // B'nin personeline A'dan düzeltme yazılamaz.
    await approved(a.admin, '2026-08')
    assertError(
      await createAdjustment(a.admin, '2026-08', adjustment(bStaff)),
      422,
      'payroll_adjustment_staff_not_found',
    )
    // B'nin kilidi A'nın tanım yazmasını etkilemez.
    ok(await createRate(a.admin, wage(aStaff, '2026-09-01')), 201)
    assert.deepEqual(await periodRows(b.id), [bPeriod])
    assert.equal((await adjustmentRows(b.id))[0]?.archivedAt, null)
  })
})
