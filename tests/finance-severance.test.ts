import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addMonthsClamped,
  FINANCE_SEVERANCE_ROLES,
  INCOME_TAX_METHOD_LABELS,
  NOTICE_STATUS_LABELS,
  noticeWeeks,
  SEVERANCE_EXIT_REASON_INFO,
  SEVERANCE_EXIT_REASONS,
  SEVERANCE_FALLBACK_CEILINGS,
  SEVERANCE_STATUS_LABELS,
  severanceEstimate,
  severanceParametersOn,
  severancePaySource,
  severanceRequestSchema,
  servicePeriod,
  servicePeriodLabel,
  severanceBreakdownRows,
  severanceFacts,
  severanceNotes,
  severanceWarningCodes,
  severanceWarnings,
  WAGE_INCOME_TAX_FALLBACK_TARIFFS,
  type SeveranceRequestInput,
} from '../packages/school-core/src/lib/finance-severance.ts'
import { severancePaySuggestion } from '../packages/school-core/src/lib/finance-pay-rates.ts'
import {
  PAYROLL_PLATFORM_DEFAULTS,
  type PayrollInstitutionSet,
} from '../packages/school-core/src/lib/finance-payroll-parameters.ts'

// Kıdem ve ihbar tazminatı tahmini (DOM-FIN-094; ON-205, ON-341). Saf hesap; kayıt yok (K-273).
// Tavan, dilim ve damga oranı çıkış günündeki bordro parametre setinden (K-344).

const input = (overrides: Partial<SeveranceRequestInput> = {}): SeveranceRequestInput => ({
  startDate: '2023-01-02',
  endDate: '2025-06-30',
  grossWageCents: 3_000_000,
  exitReason: 'employer_termination',
  ...overrides,
})

test('DOM-FIN-094: tavan altı kıdem tam yıl × 30 gün + artık gün / 365; damga binde 7,59, gelir vergisi yok', () => {
  const result = severanceEstimate(input())
  assert.deepEqual(result.service, {
    startDate: '2023-01-02',
    endDate: '2025-06-30',
    totalDays: 911,
    years: 2,
    months: 5,
    days: 29,
    remainderDays: 180,
  })
  const { severance } = result
  assert.equal(severance.status, 'eligible')
  assert.equal(severance.ceilingApplied, false)
  assert.equal(severance.ceiling.from, '2025-01-01')
  assert.equal(severance.baseMonthlyCents, 3_000_000)
  assert.equal(severance.dailyWageCents, 100_000)
  // 60 gün + 180 × 30 / 365 = 74,79 gün
  assert.equal(severance.days, 74.79)
  // 30.000 × (2 + 180/365) = 74.794,52 ₺
  assert.equal(severance.grossCents, 7_479_452)
  assert.equal(severance.incomeTaxCents, 0)
  assert.equal(severance.stampTaxCents, 56_769)
  assert.equal(severance.netCents, 7_479_452 - 56_769)
})

test('DOM-FIN-094: tavan aşımında aylık giydirilmiş ücret çıkış günündeki tavanla sınırlanır', () => {
  const result = severanceEstimate(
    input({
      startDate: '2020-03-15',
      endDate: '2025-09-30',
      grossWageCents: 5_000_000,
      regularBenefitsCents: 500_000,
    }),
  )
  assert.equal(result.wage.dressedWageCents, 5_500_000)
  assert.equal(result.wage.dailyDressedWageCents, 183_333)
  const { severance } = result
  assert.equal(severance.ceiling.from, '2025-07-01')
  assert.equal(severance.ceiling.monthlyCents, 5_391_968)
  assert.equal(severance.ceilingApplied, true)
  assert.equal(severance.baseMonthlyCents, 5_391_968)
  assert.equal(severance.fullYears, 5)
  assert.equal(severance.remainderDays, 200)
  // 53.919,68 × (5 + 200/365) = 299.143,43 ₺
  assert.equal(severance.grossCents, 29_914_343)
  assert.equal(severance.stampTaxCents, 227_050)
  // İhbarda tavan yok: 55.000 × 56 / 30
  assert.equal(result.notice.weeks, 8)
  assert.equal(result.notice.days, 56)
  assert.equal(result.notice.grossCents, 10_266_667)
  assert.deepEqual(result.totals, {
    grossCents: 29_914_343 + 10_266_667,
    incomeTaxCents: 1_540_000,
    stampTaxCents: 227_050 + 77_924,
    netCents: 29_914_343 - 227_050 + 10_266_667 - 1_540_000 - 77_924,
  })
})

test('DOM-FIN-094: tavan dönem sınırında değişir; aynı ücret 30 Haziran ve 1 Temmuz çıkışında farklı tavana takılır', () => {
  const june = severanceEstimate(input({ endDate: '2025-06-30', grossWageCents: 5_000_000 }))
  const july = severanceEstimate(input({ endDate: '2025-07-01', grossWageCents: 5_000_000 }))
  assert.equal(june.severance.ceiling.monthlyCents, 4_665_543)
  assert.equal(june.severance.ceilingApplied, true)
  assert.equal(july.severance.ceiling.monthlyCents, 5_391_968)
  assert.equal(july.severance.ceilingApplied, false)
  assert.equal(july.severance.baseMonthlyCents, 5_000_000)
  // Ücret tam tavana eşitse tavan "uygulanmış" sayılmaz.
  const equal = severanceEstimate(input({ endDate: '2025-07-01', grossWageCents: 5_391_968 }))
  assert.equal(equal.severance.ceilingApplied, false)
})

test('DOM-FIN-094: tavan yarıyılda değişir; son setin yarıyılından sonra güncel değil uyarısı (K-344)', () => {
  for (let index = 1; index < SEVERANCE_FALLBACK_CEILINGS.length; index += 1)
    assert.ok(
      (SEVERANCE_FALLBACK_CEILINGS[index - 1]?.from ?? '') <
        (SEVERANCE_FALLBACK_CEILINGS[index]?.from ?? ''),
    )
  assert.deepEqual(severanceParametersOn('2026-06-30').ceiling, {
    from: '2026-01-01',
    monthlyCents: 6_494_877,
    stale: false,
  })
  assert.equal(severanceParametersOn('2026-07-01').ceiling.stale, true)
  assert.equal(severanceParametersOn('2025-12-31').ceiling.stale, false)
  assert.equal(severanceParametersOn('2024-12-31').ceiling.stale, false)
  assert.throws(() => severanceParametersOn('2021-12-31'), RangeError)
  const stale = severanceEstimate(input({ endDate: '2026-11-15' }))
  assert.equal(stale.severance.ceiling.stale, true)
  assert.match(severanceWarnings(stale).join(' '), /1 Ocak 2026 dönemi tavanı/)
})

test('DOM-FIN-094: bir yıldan az çalışmada kıdem yok; tam bir yıl (giriş ve çıkış dahil) hak doğurur', () => {
  const short = severanceEstimate(input({ startDate: '2024-01-01', endDate: '2024-12-30' }))
  assert.equal(short.severance.status, 'under_one_year')
  assert.equal(short.severance.grossCents, 0)
  assert.equal(short.severance.stampTaxCents, 0)
  assert.equal(short.severance.days, 0)
  const year = severanceEstimate(input({ startDate: '2024-01-01', endDate: '2024-12-31' }))
  assert.equal(year.severance.status, 'eligible')
  assert.equal(year.service.years, 1)
  assert.equal(year.service.remainderDays, 0)
  assert.equal(year.severance.days, 30)
  assert.equal(year.severance.grossCents, 3_000_000)
})

test('DOM-FIN-094: artık gün yılın 365te biri; 29 Şubat girişinin yıl dönümü 28 Şubattır', () => {
  // 2023-01-01 tavanı 19.982,83 ₺; ücret tavan altında kalsın.
  const extra = severanceEstimate(
    input({ startDate: '2022-01-01', endDate: '2023-01-01', grossWageCents: 1_500_000 }),
  )
  assert.equal(extra.service.years, 1)
  assert.equal(extra.service.remainderDays, 1)
  assert.equal(extra.severance.days, 30.08)
  // 15.000 × 366 / 365 = 15.041,10 ₺
  assert.equal(extra.severance.grossCents, 1_504_110)
  assert.equal(addMonthsClamped('2024-02-29', 12), '2025-02-28')
  assert.equal(addMonthsClamped('2024-01-31', 1), '2024-02-29')
  assert.equal(addMonthsClamped('2023-12-31', 2), '2024-02-29')
  const leap = servicePeriod('2024-02-29', '2025-02-27')
  assert.equal(leap.years, 1)
  assert.equal(leap.remainderDays, 0)
  assert.equal(leap.totalDays, 365)
  const almost = servicePeriod('2024-02-29', '2025-02-26')
  assert.equal(almost.years, 0)
  assert.equal(almost.months, 11)
})

test('DOM-FIN-094: ihbar süresi sınırları (4857 md. 17; K-275)', () => {
  const cases: [string, 2 | 4 | 6 | 8][] = [
    ['2024-01-01', 2],
    ['2024-06-29', 2], // altı aydan bir gün eksik
    ['2024-06-30', 4], // tam altı ay
    ['2025-06-30', 4], // tam bir buçuk yıl
    ['2025-07-01', 6], // bir buçuk yıldan fazla
    ['2026-12-31', 6], // tam üç yıl
    ['2027-01-01', 8], // üç yıldan fazla
  ]
  for (const [endDate, weeks] of cases)
    assert.equal(noticeWeeks('2024-01-01', endDate), weeks, endDate)
  const result = severanceEstimate(input({ startDate: '2024-01-01', endDate: '2024-06-29' }))
  assert.equal(result.notice.weeks, 2)
  assert.equal(result.notice.days, 14)
  assert.equal(result.notice.grossCents, 1_400_000)
})

test('DOM-FIN-094: ihbar verildiyse ya da neden ihbar doğurmuyorsa ihbar sıfır; hafta yine gösterilir', () => {
  const given = severanceEstimate(input({ noticeGiven: true }))
  assert.equal(given.notice.status, 'notice_given')
  assert.equal(given.notice.weeks, 6)
  assert.equal(given.notice.days, 0)
  assert.equal(given.notice.grossCents, 0)
  assert.equal(given.notice.incomeTaxMethod, 'none')
  assert.equal(given.notice.incomeTaxRateBasisPoints, 0)
  assert.equal(given.notice.netCents, 0)
  assert.equal(given.severance.status, 'eligible')

  const retirement = severanceEstimate(input({ exitReason: 'retirement' }))
  assert.equal(retirement.notice.status, 'reason_not_entitled')
  assert.equal(retirement.notice.grossCents, 0)
  assert.equal(retirement.severance.grossCents, 7_479_452)
})

test('DOM-FIN-094: istifa ve ahlak-iyi niyet feshi kıdem ve ihbar doğurmaz; istifada işçinin ihbar borcu uyarısı', () => {
  for (const exitReason of ['resignation', 'employer_misconduct'] as const) {
    const result = severanceEstimate(input({ exitReason }))
    assert.equal(result.severance.status, 'reason_not_entitled', exitReason)
    assert.equal(result.notice.status, 'reason_not_entitled', exitReason)
    assert.deepEqual(result.totals, {
      grossCents: 0,
      incomeTaxCents: 0,
      stampTaxCents: 0,
      netCents: 0,
    })
  }
  const resigned = severanceEstimate(input({ exitReason: 'resignation' }))
  assert.deepEqual(severanceWarningCodes(resigned), ['resignation_notice_owed'])
  assert.match(severanceWarnings(resigned).join(' '), /çalışan işverene öder/)
  assert.deepEqual(
    severanceWarnings(severanceEstimate(input({ exitReason: 'resignation', noticeGiven: true }))),
    [],
  )
})

test('DOM-FIN-094: çıkış nedeni tablosu tam; yalnız işveren feshi ihbar doğurur (K-275)', () => {
  assert.deepEqual(
    Object.keys(SEVERANCE_EXIT_REASON_INFO).sort(),
    [...SEVERANCE_EXIT_REASONS].sort(),
  )
  const notice = SEVERANCE_EXIT_REASONS.filter(
    (reason) => SEVERANCE_EXIT_REASON_INFO[reason].notice,
  )
  assert.deepEqual(notice, ['employer_termination'])
  const noSeverance = SEVERANCE_EXIT_REASONS.filter(
    (reason) => !SEVERANCE_EXIT_REASON_INFO[reason].severance,
  )
  assert.deepEqual(noSeverance, ['resignation', 'employer_misconduct'])
  for (const reason of SEVERANCE_EXIT_REASONS) {
    const result = severanceEstimate(input({ exitReason: reason }))
    assert.equal(
      result.severance.grossCents > 0,
      SEVERANCE_EXIT_REASON_INFO[reason].severance,
      reason,
    )
    assert.equal(result.notice.grossCents > 0, SEVERANCE_EXIT_REASON_INFO[reason].notice, reason)
  }
  assert.deepEqual(FINANCE_SEVERANCE_ROLES, ['yonetici'])
})

test('DOM-FIN-094: ihbarda gelir vergisi; matrah yoksa ilk dilim, girilirse dilim geçişli (K-274)', () => {
  const first = severanceEstimate(input())
  assert.equal(first.notice.grossCents, 4_200_000)
  assert.equal(first.notice.incomeTaxMethod, 'first_bracket')
  assert.equal(first.notice.incomeTaxCents, 630_000)
  assert.equal(first.notice.incomeTaxRateBasisPoints, 1500)
  assert.equal(first.notice.stampTaxCents, 31_878)
  assert.equal(first.notice.netCents, 4_200_000 - 630_000 - 31_878)

  // 2025: 158.000 ₺'ye kadar %15, sonra %20. Matrah 150.000 → 8.000 × %15 + 34.000 × %20 = 8.000 ₺.
  const crossing = severanceEstimate(input({ cumulativeTaxBaseCents: 15_000_000 }))
  assert.equal(crossing.notice.incomeTaxMethod, 'cumulative_base')
  assert.equal(crossing.notice.taxYear, 2025)
  assert.equal(crossing.notice.incomeTaxCents, 800_000)
  assert.equal(crossing.notice.incomeTaxRateBasisPoints, 1905)

  // Üst dilim: 2025 ücret tarifesinde 4.300.000 ₺ üstü %40.
  const top = severanceEstimate(input({ cumulativeTaxBaseCents: 500_000_000 }))
  assert.equal(top.notice.incomeTaxCents, 1_680_000)
  // Sıfır matrah ilk dilimle aynı (42.000 < 158.000).
  const zero = severanceEstimate(input({ cumulativeTaxBaseCents: 0 }))
  assert.equal(zero.notice.incomeTaxCents, 630_000)
})

test('DOM-FIN-094: çıkış yılı için set yoksa son setin dilimleri kullanılır ve uyarı verilir', () => {
  assert.deepEqual(Object.keys(WAGE_INCOME_TAX_FALLBACK_TARIFFS), ['2022', '2023', '2024'])
  assert.equal(severanceParametersOn('2024-05-01').tariff.stale, false)
  assert.equal(severanceParametersOn('2024-05-01').tariff.year, 2024)
  assert.deepEqual(
    {
      year: severanceParametersOn('2027-02-01').tariff.year,
      stale: severanceParametersOn('2027-02-01').tariff.stale,
    },
    { year: 2026, stale: true },
  )
  const later = severanceEstimate(
    input({ endDate: '2027-02-01', cumulativeTaxBaseCents: 1_000_000 }),
  )
  assert.equal(later.notice.taxYear, 2026)
  assert.equal(later.notice.taxTableStale, true)
  assert.match(severanceWarnings(later).join(' '), /2026 tarifesi kullanıldı/)
  // Matrah girilmediyse tarife uyarısı yok (yalnız ilk dilim oranı kullanılır).
  const flat = severanceEstimate(input({ endDate: '2027-02-01' }))
  assert.equal(
    severanceWarnings(flat).some((line) => line.includes('tarifesi')),
    false,
  )
})

test('DOM-FIN-094: doğrulama: tarih sırası, tavan tablosundan önceki çıkış, sıfır ücret, bilinmeyen alan', () => {
  const issues = (overrides: Record<string, unknown>) => {
    const parsed = severanceRequestSchema.safeParse({ ...input(), ...overrides })
    return parsed.success
      ? []
      : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
  }
  assert.deepEqual(issues({}), [])
  assert.deepEqual(issues({ endDate: '2023-01-01' }), [
    'endDate: Çıkış günü işe giriş gününden önce olamaz.',
  ])
  assert.deepEqual(issues({ startDate: '2020-01-01', endDate: '2021-12-31' }), [
    'endDate: Çıkış günü 2022 yılından önce olamaz; tavan tablosu 2022 ile başlar.',
  ])
  assert.deepEqual(issues({ startDate: '1959-12-31' }), [
    'startDate: İşe giriş günü 1960 yılından önce olamaz.',
  ])
  assert.deepEqual(issues({ grossWageCents: 0 }), [
    'grossWageCents: Brüt ücret sıfırdan büyük olmalıdır.',
  ])
  assert.deepEqual(issues({ grossWageCents: 1_000_000_001 }), [
    'grossWageCents: Brüt ücret en fazla 10.000.000 ₺ olabilir.',
  ])
  assert.deepEqual(issues({ regularBenefitsCents: -1 }), [
    'regularBenefitsCents: Yan ödeme eksi olamaz.',
  ])
  assert.deepEqual(issues({ grossWageCents: 10.5 }), [
    'grossWageCents: Brüt ücret kuruş cinsinden tam sayı olmalıdır.',
  ])
  assert.deepEqual(issues({ cumulativeTaxBaseCents: -5 }), [
    'cumulativeTaxBaseCents: Kümülatif matrah eksi olamaz.',
  ])
  assert.deepEqual(issues({ exitReason: 'layoff' }), ['exitReason: Çıkış nedenini seçin.'])
  assert.deepEqual(issues({ startDate: '2023-02-30' }), ['startDate: Geçerli bir tarih seçin.'])
  assert.equal(issues({ institutionId: 'b' }).length, 1)
  assert.throws(() => severanceEstimate(input({ grossWageCents: 0 })))
})

test('DOM-FIN-094: aynı girdi aynı sonucu verir; varsayılanlar yan ödeme 0, ihbar verilmedi, matrah yok', () => {
  const parsed = severanceRequestSchema.parse(input())
  assert.equal(parsed.regularBenefitsCents, 0)
  assert.equal(parsed.noticeGiven, false)
  assert.equal(parsed.cumulativeTaxBaseCents, null)
  assert.deepEqual(severanceEstimate(input()), severanceEstimate(input()))
  // Tek günlük çalışma: kıdem yok, ihbar 2 hafta.
  const oneDay = severanceEstimate(input({ startDate: '2025-03-03', endDate: '2025-03-03' }))
  assert.equal(oneDay.service.totalDays, 1)
  assert.equal(oneDay.severance.status, 'under_one_year')
  assert.equal(oneDay.notice.weeks, 2)
})

test('DOM-FIN-094: gösterim metinleri', () => {
  assert.equal(servicePeriodLabel({ years: 3, months: 2, days: 5 }), '3 yıl 2 ay 5 gün')
  assert.equal(servicePeriodLabel({ years: 0, months: 0, days: 0 }), '0 gün')
  assert.equal(servicePeriodLabel({ years: 1, months: 0, days: 0 }), '1 yıl')
  assert.ok(SEVERANCE_STATUS_LABELS.under_one_year.includes('bir yıldan az'))
  assert.ok(NOTICE_STATUS_LABELS.notice_given.includes('İhbar süresi verildi'))
  assert.ok(INCOME_TAX_METHOD_LABELS.first_bracket.includes('İlk dilim'))
})

test('DOM-FIN-094: döküm satırları, dayanaklar ve notlar ekran ile PDF için aynıdır', () => {
  const result = severanceEstimate(
    input({
      startDate: '2020-03-15',
      endDate: '2025-09-30',
      grossWageCents: 5_000_000,
      regularBenefitsCents: 500_000,
    }),
  )
  assert.deepEqual(severanceBreakdownRows(result), [
    ['Hak', 'Var', 'Var', '—'],
    ['Esas gün', '166,44', '56', '—'],
    ['Günlük brüt ücret', '1.797,32 ₺', '1.833,33 ₺', '—'],
    ['Brüt tutar', '299.143,43 ₺', '102.666,67 ₺', '401.810,10 ₺'],
    ['Gelir vergisi', '0,00 ₺', '15.400,00 ₺', '15.400,00 ₺'],
    ['Damga vergisi', '2.270,50 ₺', '779,24 ₺', '3.049,74 ₺'],
    ['Net tutar', '296.872,93 ₺', '86.487,43 ₺', '383.360,36 ₺'],
  ])
  const facts = Object.fromEntries(severanceFacts(result))
  assert.equal(facts['Hizmet süresi'], '5 yıl 6 ay 16 gün')
  assert.equal(facts['Giydirilmiş aylık brüt'], '55.000,00 ₺')
  assert.equal(facts['Kıdem tavanı'], '53.919,68 ₺ (1 Temmuz 2025 dönemi), uygulandı')
  assert.equal(facts['İhbar süresi'], '8 hafta')
  assert.match(facts['İhbarda gelir vergisi'] ?? '', /İlk dilim oranı.*2025 tarifesi/)
  assert.deepEqual(severanceNotes(result), [])

  const given = severanceEstimate(input({ noticeGiven: true, startDate: '2025-01-01' }))
  assert.deepEqual(severanceNotes(given), [
    'Kıdem: Hizmet süresi bir yıldan az; kıdem tazminatı doğmaz.',
    'İhbar: İhbar süresi verildi; ihbar tazminatı doğmaz.',
  ])
  const givenFacts = Object.fromEntries(severanceFacts(given))
  assert.equal(givenFacts['İhbar süresi'], '4 hafta (verildi)')
  assert.equal(givenFacts['İhbarda gelir vergisi'], 'Gelir vergisi yok')
  assert.equal(givenFacts['Kıdem tavanı'], '46.655,43 ₺ (1 Ocak 2025 dönemi)')
  assert.deepEqual(severanceBreakdownRows(given)[0], ['Hak', 'Yok', 'Yok', '—'])
})

// --- ON-341: bordro parametresinden tavan ve dilim, ücret tanımından öneri ----------------------

const PLATFORM_2026 = PAYROLL_PLATFORM_DEFAULTS.find((set) => set.effectiveFrom === '2026-01-01')
if (!PLATFORM_2026) throw new Error('2026 platform seti yok')

/** Kurum kopyası: 2026 platform değerleri üstüne değişiklik. */
const institutionSet = (overrides: Partial<PayrollInstitutionSet> = {}): PayrollInstitutionSet => ({
  effectiveFrom: PLATFORM_2026.effectiveFrom,
  minimumWageGrossCents: PLATFORM_2026.minimumWageGrossCents,
  incomeTaxBrackets: PLATFORM_2026.incomeTaxBrackets.map((bracket) => ({ ...bracket })),
  sgkEmployeeRateBasisPoints: PLATFORM_2026.sgkEmployeeRateBasisPoints,
  sgkEmployerRateBasisPoints: PLATFORM_2026.sgkEmployerRateBasisPoints,
  sgkEmployerIncentiveBasisPoints: PLATFORM_2026.sgkEmployerIncentiveBasisPoints,
  unemploymentEmployeeRateBasisPoints: PLATFORM_2026.unemploymentEmployeeRateBasisPoints,
  unemploymentEmployerRateBasisPoints: PLATFORM_2026.unemploymentEmployerRateBasisPoints,
  sgkFloorMultiplierBasisPoints: PLATFORM_2026.sgkFloorMultiplierBasisPoints,
  sgkCeilingMultiplierBasisPoints: PLATFORM_2026.sgkCeilingMultiplierBasisPoints,
  stampTaxRatePer100k: PLATFORM_2026.stampTaxRatePer100k,
  minimumWageIncomeTaxExempt: PLATFORM_2026.minimumWageIncomeTaxExempt,
  minimumWageStampTaxExempt: PLATFORM_2026.minimumWageStampTaxExempt,
  severanceCeilingCents: PLATFORM_2026.severanceCeilingCents,
  source: PLATFORM_2026.source,
  id: 'set-kurum',
  version: 1,
  ...overrides,
})

/** ON-205'teki sabit tablolar: parametre setine geçiş bu değerleri değiştirmemelidir. */
const ON205_CEILINGS = [
  ['2022-01-01', 1_084_859],
  ['2022-07-01', 1_537_140],
  ['2023-01-01', 1_998_283],
  ['2023-07-01', 2_348_983],
  ['2024-01-01', 3_505_858],
  ['2024-07-01', 4_182_842],
  ['2025-01-01', 4_665_543],
  ['2025-07-01', 5_391_968],
  ['2026-01-01', 6_494_877],
] as const
const ON205_TARIFF_LIMITS: Readonly<Record<number, readonly number[]>> = {
  2022: [3_200_000, 7_000_000, 25_000_000, 88_000_000],
  2023: [7_000_000, 15_000_000, 55_000_000, 190_000_000],
  2024: [11_000_000, 23_000_000, 87_000_000, 300_000_000],
  2025: [15_800_000, 33_000_000, 120_000_000, 430_000_000],
  2026: [19_000_000, 40_000_000, 150_000_000, 530_000_000],
}

test('DOM-FIN-094: geriye dönük — kurum seti yokken her dönemin tavanı, dilimleri ve damga oranı ON-205 tablosuyla aynı (K-344)', () => {
  for (const [from, monthlyCents] of ON205_CEILINGS)
    for (const day of [from, addMonthsClamped(from, 5).slice(0, 8) + '28']) {
      const parameters = severanceParametersOn(day)
      assert.equal(parameters.ceiling.monthlyCents, monthlyCents, `tavan ${day}`)
      assert.equal(parameters.ceiling.from, from, `dönem ${day}`)
      assert.equal(parameters.stampTaxRatePer100k, 759, `damga ${day}`)
      const limits = ON205_TARIFF_LIMITS[Number(day.slice(0, 4))]
      assert.deepEqual(
        parameters.tariff.brackets.map((bracket) => bracket.upToCents),
        [...(limits ?? []), null],
        `dilimler ${day}`,
      )
      assert.equal(parameters.source, from < '2025-01-01' ? 'fallback_table' : 'payroll_parameters')
    }
  // Bilinen bir hesabın tutarları kuruşu kuruşuna aynıdır (ekran ve PDF'teki eski sonuç).
  const old = severanceEstimate(
    input({
      startDate: '2020-03-15',
      endDate: '2025-09-30',
      grossWageCents: 5_000_000,
      regularBenefitsCents: 500_000,
    }),
  )
  assert.equal(old.totals.netCents, 38_336_036)
  assert.deepEqual(old.parameters, {
    source: 'payroll_parameters',
    setId: 'platform-2025-07-01',
    origin: 'platform',
    version: null,
    effectiveFrom: '2025-07-01',
    stampTaxRatePer100k: 759,
  })
  assert.equal(old.paySource, null)
  const early = severanceEstimate(input({ startDate: '2021-01-04', endDate: '2023-08-31' }))
  assert.equal(early.parameters.source, 'fallback_table')
  assert.equal(early.parameters.setId, null)
  assert.equal(early.severance.ceiling.monthlyCents, 2_348_983)
})

test('DOM-FIN-094: tavan aşımı kurumun çıkış günündeki setinin tavanıyla; kurum seti platformun yerini alır (K-344)', () => {
  const sets = [institutionSet({ effectiveFrom: '2026-01-01', severanceCeilingCents: 6_000_000 })]
  const request = input({
    startDate: '2021-01-01',
    endDate: '2026-03-31',
    grossWageCents: 8_000_000,
  })
  const own = severanceEstimate(request, { parameters: severanceParametersOn('2026-03-31', sets) })
  assert.equal(own.severance.ceilingApplied, true)
  assert.equal(own.severance.baseMonthlyCents, 6_000_000)
  assert.equal(own.parameters.origin, 'institution')
  assert.equal(own.parameters.setId, 'set-kurum')
  assert.equal(own.parameters.version, 1)
  const platform = severanceEstimate(request)
  assert.equal(platform.severance.baseMonthlyCents, 6_494_877)
  assert.ok(own.severance.grossCents < platform.severance.grossCents)
  assert.equal(
    Object.fromEntries(severanceFacts(own))['Parametre kaynağı'],
    'Kurumun bordro parametresi, 1 Ocak 2026 dönemi',
  )
  assert.equal(
    Object.fromEntries(severanceFacts(platform))['Parametre kaynağı'],
    'Platformun bordro parametresi, 1 Ocak 2026 dönemi',
  )
  // Damga oranı ve dilimler de setten gelir.
  const stamp = severanceEstimate(request, {
    parameters: severanceParametersOn('2026-03-31', [
      institutionSet({
        stampTaxRatePer100k: 1000,
        incomeTaxBrackets: [
          { lowerBoundCents: 0, rateBasisPoints: 1000 },
          { lowerBoundCents: 50_000_000, rateBasisPoints: 2000 },
        ],
      }),
    ]),
  })
  assert.equal(stamp.severance.stampTaxCents, Math.round(stamp.severance.grossCents / 100))
  assert.equal(stamp.notice.incomeTaxCents, Math.round(stamp.notice.grossCents / 10))
  assert.equal(Object.fromEntries(severanceFacts(stamp))['Damga vergisi oranı'], 'binde 10')
})

test('DOM-FIN-094: yıl ortası (temmuz) tavan değişimi: 30 Haziran eski, 1 Temmuz yeni set; temmuz seti yoksa uyarı (K-344, H-44)', () => {
  const july = institutionSet({
    id: 'set-temmuz',
    effectiveFrom: '2026-07-01',
    severanceCeilingCents: 7_500_000,
  })
  const request = (endDate: string) =>
    input({ startDate: '2020-01-01', endDate, grossWageCents: 10_000_000 })
  const june30 = severanceEstimate(request('2026-06-30'), {
    parameters: severanceParametersOn('2026-06-30', [july]),
  })
  const july1 = severanceEstimate(request('2026-07-01'), {
    parameters: severanceParametersOn('2026-07-01', [july]),
  })
  assert.equal(june30.severance.ceiling.monthlyCents, 6_494_877)
  assert.equal(june30.severance.ceiling.stale, false)
  assert.equal(july1.severance.ceiling.monthlyCents, 7_500_000)
  assert.equal(july1.severance.ceiling.from, '2026-07-01')
  assert.equal(july1.severance.ceiling.stale, false)
  assert.deepEqual(severanceWarningCodes(july1), [])
  // Temmuz seti girilmemişse ocak tavanı kullanılır ve uyarı verilir.
  const missing = severanceEstimate(request('2026-07-01'))
  assert.equal(missing.severance.ceiling.monthlyCents, 6_494_877)
  assert.deepEqual(severanceWarningCodes(missing), ['ceiling_stale'])
  // Yıl içi (mart) asgari ücret seti tavanı taşır; aynı yarıyılda uyarı yok.
  const march = institutionSet({ id: 'set-mart', effectiveFrom: '2026-03-01' })
  assert.equal(severanceParametersOn('2026-05-31', [march]).ceiling.stale, false)
  assert.equal(severanceParametersOn('2026-08-31', [march]).ceiling.stale, true)
})

test('DOM-FIN-094: saklanan sonuç değişmez — sonradan eklenen ya da değişen set önceki çıkış gününün sonucunu etkilemez (K-346)', () => {
  const request = input({
    startDate: '2019-05-06',
    endDate: '2026-03-31',
    grossWageCents: 9_000_000,
  })
  const before = severanceEstimate(request, { parameters: severanceParametersOn('2026-03-31', []) })
  const snapshot = structuredClone(before)
  const laterSets = [
    institutionSet({
      id: 'set-temmuz',
      effectiveFrom: '2026-07-01',
      severanceCeilingCents: 9_999_999,
    }),
  ]
  const after = severanceEstimate(request, {
    parameters: severanceParametersOn('2026-03-31', laterSets),
  })
  assert.deepEqual(after, before)
  // Yanıt, parametre nesnesine bağlı değildir: sonradan değişen nesne eski sonucu bozmaz.
  const parameters = severanceParametersOn('2026-03-31', [])
  const result = severanceEstimate(request, { parameters })
  parameters.ceiling.monthlyCents = 1
  parameters.stampTaxRatePer100k = 1
  assert.deepEqual(result, snapshot)
})

const RATES = [
  {
    id: 'w-0001-aaaa',
    component: 'wage' as const,
    rateType: 'monthly_gross',
    amountCents: 6_000_000,
    startDate: '2025-09-01',
    endDate: null,
    benefitForm: null,
  },
  {
    id: 'b-yol-0001',
    component: 'benefit' as const,
    rateType: 'transport',
    amountCents: 250_000,
    startDate: '2025-09-01',
    endDate: null,
    benefitForm: 'cash' as const,
  },
  {
    id: 'b-yemek-01',
    component: 'benefit' as const,
    rateType: 'meal',
    amountCents: 400_000,
    startDate: '2025-09-01',
    endDate: null,
    benefitForm: 'in_kind' as const,
  },
  {
    id: 'l-ek-00001',
    component: 'lesson' as const,
    rateType: 'extra',
    amountCents: 50_000,
    startDate: '2025-09-01',
    endDate: null,
    benefitForm: null,
  },
]

test('DOM-FIN-094: öneri kaynağı sonuçta: tanım kimliği, başlangıç günü, ayni hariç; elle değişiklik işaretlenir (K-345, K-346)', () => {
  const request = input({
    startDate: '2022-09-01',
    endDate: '2026-06-30',
    grossWageCents: 6_000_000,
    regularBenefitsCents: 250_000,
  })
  const suggestion = severancePaySuggestion(RATES, '2026-06-30')
  const source = severancePaySource(
    'm-1',
    '2026-06-30',
    suggestion,
    severanceRequestSchema.parse(request),
  )
  assert.deepEqual(source, {
    membershipId: 'm-1',
    date: '2026-06-30',
    status: 'suggested',
    wageRateId: 'w-0001-aaaa',
    wageRateType: 'monthly_gross',
    wageStartDate: '2025-09-01',
    benefitRateIds: ['b-yol-0001'],
    excludedBenefitCount: 1,
    suggestedGrossWageCents: 6_000_000,
    suggestedBenefitsCents: 250_000,
    grossWageChanged: false,
    benefitsChanged: false,
  })
  const result = severanceEstimate(request, { paySource: source })
  assert.equal(result.wage.dressedWageCents, 6_250_000)
  const facts = Object.fromEntries(severanceFacts(result))
  assert.equal(
    facts['Ücret kaynağı'],
    'Ücret tanımı: Aylık brüt, 1 Eylül 2025 başlangıçlı (tanım w-0001-a), 30 Haziran 2026 günü geçerli',
  )
  assert.equal(facts['Yan ödeme kaynağı'], '1 nakdi yan hak (tanım b-yol-00), 1 ayni yan hak hariç')
  assert.deepEqual(severanceWarningCodes(result), [])

  const edited = severancePaySource(
    'm-1',
    '2026-06-30',
    suggestion,
    severanceRequestSchema.parse({ ...request, grossWageCents: 6_100_000 }),
  )
  assert.equal(edited.grossWageChanged, true)
  assert.equal(edited.benefitsChanged, false)
  assert.match(
    Object.fromEntries(
      severanceFacts(
        severanceEstimate({ ...request, grossWageCents: 6_100_000 }, { paySource: edited }),
      ),
    )['Ücret kaynağı'] ?? '',
    /; öneri değiştirildi$/,
  )
  // Personel seçilmediyse kaynak elle girilmiştir.
  assert.equal(
    Object.fromEntries(severanceFacts(severanceEstimate(request)))['Ücret kaynağı'],
    'Elle girildi',
  )
})

test('DOM-FIN-094: net tanımlı ücrette öneri yapılmaz; sonuç uyarı taşır (K-345, M-39)', () => {
  const net = RATES.map((rate) =>
    rate.id === 'w-0001-aaaa' ? { ...rate, rateType: 'monthly_net' } : rate,
  )
  const suggestion = severancePaySuggestion(net, '2026-06-30')
  assert.equal(suggestion.status, 'net_wage')
  assert.equal(suggestion.grossWageCents, null)
  assert.equal(suggestion.regularBenefitsCents, null)
  const request = input({
    startDate: '2022-09-01',
    endDate: '2026-06-30',
    grossWageCents: 7_000_000,
  })
  const source = severancePaySource(
    'm-1',
    '2026-06-30',
    suggestion,
    severanceRequestSchema.parse(request),
  )
  assert.equal(source.wageRateType, 'monthly_net')
  assert.equal(source.grossWageChanged, true)
  const result = severanceEstimate(request, { paySource: source })
  assert.deepEqual(severanceWarningCodes(result), ['pay_suggestion_unavailable'])
  assert.deepEqual(severanceWarnings(result), [
    'Ücret tanımından öneri yapılmadı (ana ücret net tanımlı, brüte çevrilmez); hesap elle girilen ücretle yapıldı.',
  ])
  assert.equal(
    Object.fromEntries(severanceFacts(result))['Ücret kaynağı'],
    'Ücret tanımından öneri yapılmadı (aylık net); elle girildi',
  )
  assert.equal(Object.fromEntries(severanceFacts(result))['Yan ödeme kaynağı'], undefined)
  assert.equal(severancePaySuggestion([], '2026-06-30').status, 'no_wage')
})
