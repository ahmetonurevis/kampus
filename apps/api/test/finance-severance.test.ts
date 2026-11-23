import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, count, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
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
 * Kıdem ve ihbar tazminatı tahmini (ON-205, ON-341; DOM-FIN-094). Kural dalları birim testindedir
 * (`tests/finance-severance.test.ts`); burada rol, modül, doğrulama, yanıt şekli, kurumun bordro
 * parametresinden tavan (K-344), ücret tanımından öneri ve kaynağı (K-345, K-346), ücret okumasının
 * denetimi ve kurum sınırı (K-347). Hesap saklanmaz (K-273). FIXED_NOW 2026-10-06.
 */

const FINANCE = '/api/v1/finance'
const URL = `${FINANCE}/severance-estimates`
const SUGGESTION = `${FINANCE}/severance-pay-suggestion`
const BODY = {
  startDate: '2023-01-02',
  endDate: '2025-06-30',
  grossWageCents: 3_000_000,
  exitReason: 'employer_termination',
}
const BRACKETS_2026 = [
  { lowerBoundCents: 0, rateBasisPoints: 1500 },
  { lowerBoundCents: 19_000_000, rateBasisPoints: 2000 },
  { lowerBoundCents: 40_000_000, rateBasisPoints: 2700 },
  { lowerBoundCents: 150_000_000, rateBasisPoints: 3500 },
  { lowerBoundCents: 530_000_000, rateBasisPoints: 4000 },
]
/** Yıl ortası (temmuz) kurum seti: kıdem tavanı 75.000 ₺. */
const JULY_SET = {
  effectiveFrom: '2026-07-01',
  minimumWageGrossCents: 3_303_000,
  incomeTaxBrackets: BRACKETS_2026,
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
  severanceCeilingCents: 7_500_000,
  source: 'Memur maaş katsayısı genelgesi (örnek)',
}

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('kıdem ve ihbar tazminatı tahmini (DOM-FIN-094)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.205.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(method: 'GET' | 'POST', url: string, cookie: string | null, payload?: unknown) {
    return app.inject({
      method,
      url,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
    assert.equal(response.json().data, undefined)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.205.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, cookie: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  async function person(t: Tenant, role: Role, name: string) {
    const user = await createUser(app, { name })
    return (await ensureMember(app.auth, db, { institutionId: t.id, userId: user.id, role })).id
  }
  const estimate = (cookie: string | null, payload: Json) => call('POST', URL, cookie, payload)
  const suggestionOf = (cookie: string | null, query: string) =>
    call('GET', `${SUGGESTION}?${query}`, cookie)
  const rate = async (t: Tenant, body: Json) =>
    ok(await call('POST', `${FINANCE}/pay-rates`, t.cookie, body), 201)
  const auditCount = async (institutionId: string, action?: string) =>
    (
      await db
        .select({ value: count() })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.institutionId, institutionId),
            action === undefined ? undefined : eq(auditLog.action, action),
          ),
        )
    )[0]?.value ?? 0
  const reads = (institutionId: string) =>
    db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, institutionId),
          eq(auditLog.action, 'finance.pay_rate.read'),
        ),
      )

  /** Aylık brüt 60.000 ₺, nakdi yol 2.500 ₺, ayni yemek 4.000 ₺ ve ek ders ücreti olan öğretmen. */
  async function teacherWithRates(t: Tenant) {
    const id = await person(t, 'ogretmen', 'Selin Kaya')
    const wage = await rate(t, {
      component: 'wage',
      membershipId: id,
      rateType: 'monthly_gross',
      amountCents: 6_000_000,
      startDate: '2025-09-01',
    })
    const transport = await rate(t, {
      component: 'benefit',
      membershipId: id,
      rateType: 'transport',
      benefitForm: 'cash',
      taxable: true,
      amountCents: 250_000,
      startDate: '2025-09-01',
    })
    await rate(t, {
      component: 'benefit',
      membershipId: id,
      rateType: 'meal',
      benefitForm: 'in_kind',
      taxable: false,
      amountCents: 400_000,
      startDate: '2025-09-01',
    })
    await rate(t, {
      component: 'lesson',
      membershipId: id,
      rateType: 'extra',
      amountCents: 50_000,
      startDate: '2025-09-01',
    })
    return {
      id,
      wageId: String((wage.rate as Json).id),
      transportId: String((transport.rate as Json).id),
    }
  }

  test('DOM-FIN-094: oturumsuz 401; yönetici dışı roller 403; finance kapalıyken 403 module_disabled', async () => {
    assertError(await estimate(null, BODY), 401)
    assertError(await suggestionOf(null, 'membershipId=m-1'), 401)
    const a = await institution()
    const teacher = await person(a, 'ogretmen', 'Selin Kaya')
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await signInAs(app, await createMember(app, a.id, role))
      assertError(await estimate(cookie, BODY), 403)
      assertError(await estimate(cookie, { ...BODY, membershipId: teacher }), 403)
      assertError(await suggestionOf(cookie, `membershipId=${teacher}`), 403)
    }
    assert.equal(await auditCount(a.id, 'finance.pay_rate.read'), 0)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await estimate(closed.cookie, BODY), 403, 'module_disabled')
    assertError(await suggestionOf(closed.cookie, 'membershipId=m-1'), 403, 'module_disabled')
  })

  test('DOM-FIN-094: tarih sırası, sıfır ücret, bilinmeyen neden ve gövdedeki institutionId 400 (kayıt yok)', async () => {
    const a = await institution()
    const audits = await auditCount(a.id)
    const cases: [Json, string][] = [
      [{ ...BODY, endDate: '2021-12-31' }, 'endDate'],
      [{ ...BODY, grossWageCents: 0 }, 'grossWageCents'],
      [{ ...BODY, exitReason: 'layoff' }, 'exitReason'],
      [{ ...BODY, startDate: '2023-02-30' }, 'startDate'],
      [{ ...BODY, regularBenefitsCents: -1 }, 'regularBenefitsCents'],
      [{ ...BODY, membershipId: '' }, 'membershipId'],
      [{ ...BODY, institutionId: 'b' }, ''],
    ]
    for (const [payload, path] of cases) {
      const response = await estimate(a.cookie, payload)
      assert.equal(response.statusCode, 400, `${JSON.stringify(payload)}: ${response.body}`)
      const body = response.json()
      assert.equal(body.code, 'validation_failed')
      if (path !== '')
        assert.ok(
          body.issues.some((issue: { path: string[] }) => issue.path.join('.') === path),
          `${path}: ${response.body}`,
        )
    }
    assert.equal((await suggestionOf(a.cookie, 'date=2026-06-30')).statusCode, 400)
    assert.equal((await suggestionOf(a.cookie, 'membershipId=m&date=2026-02-30')).statusCode, 400)
    assert.equal(await auditCount(a.id), audits)
  })

  test('DOM-FIN-094: kalem kalem döküm ve parametre kaynağı döner; personel seçilmezse hiçbir denetim satırı yazılmaz', async () => {
    const a = await institution()
    const before = await auditCount(a.id)
    const data = ok(await estimate(a.cookie, { ...BODY, cumulativeTaxBaseCents: 15_000_000 }))
    assert.deepEqual(data.service, {
      startDate: '2023-01-02',
      endDate: '2025-06-30',
      totalDays: 911,
      years: 2,
      months: 5,
      days: 29,
      remainderDays: 180,
    })
    const severance = data.severance as Json
    const notice = data.notice as Json
    assert.equal(severance.status, 'eligible')
    assert.equal(severance.days, 74.79)
    assert.equal(severance.grossCents, 7_479_452)
    assert.equal(severance.incomeTaxCents, 0)
    assert.equal(severance.stampTaxCents, 56_769)
    assert.equal(notice.weeks, 6)
    assert.equal(notice.grossCents, 4_200_000)
    assert.equal(notice.incomeTaxMethod, 'cumulative_base')
    assert.equal(notice.incomeTaxCents, 800_000)
    assert.deepEqual(data.parameters, {
      source: 'payroll_parameters',
      setId: 'platform-2025-01-01',
      origin: 'platform',
      version: null,
      effectiveFrom: '2025-01-01',
      stampTaxRatePer100k: 759,
    })
    assert.equal(data.paySource, null)
    assert.deepEqual(data.warnings, [])
    assert.equal(await auditCount(a.id), before)

    // Aynı istek ikinci kez aynı sonucu verir (yan etki yok).
    assert.deepEqual(
      ok(await estimate(a.cookie, { ...BODY, cumulativeTaxBaseCents: 15_000_000 })),
      data,
    )

    // Son setin yarıyılından sonraki çıkış: son bilinen tavan ve uyarı.
    const stale = ok(await estimate(a.cookie, { ...BODY, endDate: '2026-11-15' }))
    assert.equal((stale.severance as Json & { ceiling: Json }).ceiling.stale, true)
    assert.deepEqual(stale.warnings, ['ceiling_stale'])
    // 2025 öncesi çıkış yedek tablodan.
    const early = ok(await estimate(a.cookie, { ...BODY, endDate: '2024-03-31' }))
    assert.equal((early.parameters as Json).source, 'fallback_table')
  })

  test('DOM-FIN-094: tavan kurumun çıkış günündeki setinden; yıl ortası (temmuz) seti 1 Temmuz’dan geçerli, önceki çıkışın sonucu değişmez (K-344)', async () => {
    const a = await institution()
    const body = { ...BODY, startDate: '2018-01-01', grossWageCents: 9_000_000 }
    const june = ok(await estimate(a.cookie, { ...body, endDate: '2026-06-30' }))
    const julyBefore = ok(await estimate(a.cookie, { ...body, endDate: '2026-07-15' }))
    assert.deepEqual(julyBefore.warnings, ['ceiling_stale'])
    assert.equal((julyBefore.severance as { ceiling: Json }).ceiling.monthlyCents, 6_494_877)

    const created = ok(await call('POST', `${FINANCE}/payroll-parameters`, a.cookie, JULY_SET), 201)
    const julyAfter = ok(await estimate(a.cookie, { ...body, endDate: '2026-07-15' }))
    const line = julyAfter.severance as Json & { ceiling: Json }
    assert.equal(line.ceilingApplied, true)
    assert.equal(line.baseMonthlyCents, 7_500_000)
    assert.deepEqual(line.ceiling, { from: '2026-07-01', monthlyCents: 7_500_000, stale: false })
    assert.deepEqual(julyAfter.warnings, [])
    assert.deepEqual(julyAfter.parameters, {
      source: 'payroll_parameters',
      setId: created.id,
      origin: 'institution',
      version: 1,
      effectiveFrom: '2026-07-01',
      stampTaxRatePer100k: 759,
    })
    // Geriye dönük: temmuz setinden önceki çıkış günü aynı sonucu verir.
    assert.deepEqual(ok(await estimate(a.cookie, { ...body, endDate: '2026-06-30' })), june)

    // Başka kurumun seti A'nın hesabını etkilemez.
    const b = await institution()
    assert.equal(
      (
        ok(await estimate(b.cookie, { ...body, endDate: '2026-07-15' })).severance as Json as {
          baseMonthlyCents: number
        }
      ).baseMonthlyCents,
      6_494_877,
    )
  })

  test('DOM-FIN-094: çıkış günündeki ücret önerisi aylık brüt + nakdi yan hak; okuma denetime düşer (K-345, K-347)', async () => {
    const a = await institution()
    const teacher = await teacherWithRates(a)
    const readsBefore = await auditCount(a.id, 'finance.pay_rate.read')
    const data = ok(await suggestionOf(a.cookie, `membershipId=${teacher.id}&date=2026-06-30`))
    assert.equal(data.name, 'Selin Kaya')
    assert.equal(data.date, '2026-06-30')
    assert.equal(data.status, 'suggested')
    assert.equal(data.grossWageCents, 6_000_000)
    assert.equal(data.regularBenefitsCents, 250_000)
    assert.equal((data.wage as Json).id, teacher.wageId)
    assert.deepEqual(
      (data.benefits as Json[]).map((item) => [item.rateType, item.benefitForm, item.included]),
      [
        ['meal', 'in_kind', false],
        ['transport', 'cash', true],
      ],
    )
    // Tanımın başlamadığı gün: ana ücret yok, öneri yok.
    const early = ok(await suggestionOf(a.cookie, `membershipId=${teacher.id}&date=2025-08-31`))
    assert.equal(early.status, 'no_wage')
    assert.equal(early.grossWageCents, null)
    // Varsayılan gün bugündür.
    assert.equal(ok(await suggestionOf(a.cookie, `membershipId=${teacher.id}`)).date, '2026-10-06')

    const rows = await reads(a.id)
    assert.equal(rows.length, readsBefore + 3)
    assert.ok(rows.every((row) => row.entityId === teacher.id))
    assert.ok(rows.every((row) => !JSON.stringify(row.changes).includes('6000000')))
  })

  test('DOM-FIN-094: personel seçili hesap öneri kaynağını döner; değiştirilen ücret işaretlenir, okuma denetlenir (K-346)', async () => {
    const a = await institution()
    const teacher = await teacherWithRates(a)
    const body = {
      ...BODY,
      startDate: '2022-09-01',
      endDate: '2026-06-30',
      grossWageCents: 6_000_000,
      regularBenefitsCents: 250_000,
      membershipId: teacher.id,
    }
    const readsBefore = await auditCount(a.id, 'finance.pay_rate.read')
    const data = ok(await estimate(a.cookie, body))
    assert.deepEqual(data.paySource, {
      membershipId: teacher.id,
      date: '2026-06-30',
      status: 'suggested',
      wageRateId: teacher.wageId,
      wageRateType: 'monthly_gross',
      wageStartDate: '2025-09-01',
      benefitRateIds: [teacher.transportId],
      excludedBenefitCount: 1,
      suggestedGrossWageCents: 6_000_000,
      suggestedBenefitsCents: 250_000,
      grossWageChanged: false,
      benefitsChanged: false,
    })
    assert.equal((data.wage as Json).dressedWageCents, 6_250_000)
    assert.deepEqual(data.warnings, [])
    const edited = ok(await estimate(a.cookie, { ...body, regularBenefitsCents: 0 }))
    assert.equal((edited.paySource as Json).benefitsChanged, true)
    assert.equal((edited.wage as Json).dressedWageCents, 6_000_000)
    assert.equal(await auditCount(a.id, 'finance.pay_rate.read'), readsBefore + 2)
  })

  test('DOM-FIN-094: net tanımlı ücrette öneri yapılmaz; hesap elle girilen ücretle uyarıyla döner (K-345)', async () => {
    const a = await institution()
    const id = await person(a, 'onburo', 'Merve Ak')
    await rate(a, {
      component: 'wage',
      membershipId: id,
      rateType: 'monthly_net',
      amountCents: 4_000_000,
      startDate: '2025-01-01',
    })
    const suggestion = ok(await suggestionOf(a.cookie, `membershipId=${id}&date=2026-06-30`))
    assert.equal(suggestion.status, 'net_wage')
    assert.equal(suggestion.grossWageCents, null)
    assert.equal(suggestion.regularBenefitsCents, null)
    assert.equal((suggestion.wage as Json).rateType, 'monthly_net')
    const data = ok(
      await estimate(a.cookie, {
        ...BODY,
        endDate: '2026-06-30',
        grossWageCents: 5_200_000,
        membershipId: id,
      }),
    )
    assert.equal((data.paySource as Json).status, 'net_wage')
    assert.equal((data.paySource as Json).grossWageChanged, true)
    assert.deepEqual(data.warnings, ['pay_suggestion_unavailable'])
  })

  test('DOM-FIN-094: kurumlar arası: başka kurumun personeli ve personel olmayan üyelik 404; B denetimine satır düşmez (K-347)', async () => {
    const a = await institution()
    const b = await institution({ type: 'language_school' })
    const bTeacher = await teacherWithRates(b)
    const parent = await person(a, 'veli', 'Ayşe Yılmaz')
    const bReads = await auditCount(b.id)
    const aReads = await auditCount(a.id, 'finance.pay_rate.read')
    assertError(await suggestionOf(a.cookie, `membershipId=${bTeacher.id}&date=2026-06-30`), 404)
    assertError(await estimate(a.cookie, { ...BODY, membershipId: bTeacher.id }), 404)
    assertError(await suggestionOf(a.cookie, `membershipId=${parent}`), 404)
    assertError(await estimate(a.cookie, { ...BODY, membershipId: 'yok-boyle-uyelik' }), 404)
    assert.equal(await auditCount(b.id), bReads)
    assert.equal(await auditCount(a.id, 'finance.pay_rate.read'), aReads)
    // Personelsiz hesap iki kurumda aynı girdiyle aynıdır (kurum seti yoksa).
    assert.deepEqual(ok(await estimate(a.cookie, BODY)), ok(await estimate(b.cookie, BODY)))
  })
})
