import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addMonthsClamped,
  FINANCE_SEVERANCE_ROLES,
  INCOME_TAX_METHOD_LABELS,
  NOTICE_STATUS_LABELS,
  noticeWeeks,
  SEVERANCE_CEILINGS,
  SEVERANCE_EXIT_REASON_INFO,
  SEVERANCE_EXIT_REASONS,
  SEVERANCE_STATUS_LABELS,
  severanceCeilingOn,
  severanceEstimate,
  severanceRequestSchema,
  servicePeriod,
  servicePeriodLabel,
  severanceBreakdownRows,
  severanceFacts,
  severanceNotes,
  severanceWarningCodes,
  severanceWarnings,
  wageTariffFor,
  WAGE_INCOME_TAX_TARIFFS,
  type SeveranceRequestInput,
} from '../packages/school-core/src/lib/finance-severance.ts'

// Kıdem ve ihbar tazminatı tahmini (DOM-FIN-094; ON-205). Elle girdili saf hesap; kayıt yok (K-273).

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

test('DOM-FIN-094: tavan tablosu sıralı ve son dönemden altı ay sonra güncel değil uyarısı verir', () => {
  for (let index = 1; index < SEVERANCE_CEILINGS.length; index += 1)
    assert.ok((SEVERANCE_CEILINGS[index - 1]?.from ?? '') < (SEVERANCE_CEILINGS[index]?.from ?? ''))
  assert.deepEqual(severanceCeilingOn('2026-06-30'), {
    from: '2026-01-01',
    monthlyCents: 6_494_877,
    stale: false,
  })
  assert.equal(severanceCeilingOn('2026-07-01').stale, true)
  assert.equal(severanceCeilingOn('2025-12-31').stale, false)
  assert.throws(() => severanceCeilingOn('2021-12-31'), RangeError)
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

test('DOM-FIN-094: tarife yılı tabloda yoksa en yakın önceki yıl kullanılır ve uyarı verilir', () => {
  assert.deepEqual(Object.keys(WAGE_INCOME_TAX_TARIFFS), ['2022', '2023', '2024', '2025', '2026'])
  assert.equal(wageTariffFor(2024).stale, false)
  assert.deepEqual(
    { year: wageTariffFor(2027).year, stale: wageTariffFor(2027).stale },
    { year: 2026, stale: true },
  )
  assert.equal(wageTariffFor(2010).year, 2022)
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
