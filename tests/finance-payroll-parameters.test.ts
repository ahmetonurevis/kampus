import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertPayrollEffectiveFromFree,
  basisPointsLabel,
  effectivePayrollParameters,
  incomeTaxBracketRows,
  incomeTaxBracketsSchema,
  mergePayrollParameterUpdate,
  monthStarts,
  multiplierLabel,
  PAYROLL_PARAMETER_FIELDS,
  PAYROLL_PARAMETER_LABELS,
  PAYROLL_PARAMETER_READ_ROLES,
  PAYROLL_PARAMETER_WRITE_ROLES,
  PAYROLL_PLATFORM_DEFAULTS,
  payrollDerivedValues,
  payrollParameterRows,
  payrollParameterSetSchema,
  payrollParameterTimeline,
  payrollParameterYear,
  payrollPeriodLabel,
  payrollYearOptions,
  requireEffectivePayrollParameters,
  severanceCeilingRows,
  stampTaxLabel,
  updatePayrollParameterSetSchema,
  wageTariffBrackets,
  type PayrollInstitutionSet,
  type PayrollParameterValues,
} from '../packages/school-core/src/lib/finance-payroll-parameters.ts'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  SEVERANCE_CEILINGS,
  WAGE_INCOME_TAX_TARIFFS,
} from '../packages/school-core/src/lib/finance-severance.ts'

// Bordro parametreleri (DOM-FIN-100; ON-197). Yürürlük tarihli set, platform varsayılanı + kurum
// kopyası (K-308…K-311). Değerler doğrulanmalı (M-40).

const platform2026 = PAYROLL_PLATFORM_DEFAULTS.find((set) => set.effectiveFrom === '2026-01-01')
assert.ok(platform2026)
const VALUES_2026: PayrollParameterValues = payrollParameterSetSchema.parse(
  Object.fromEntries(
    Object.entries(platform2026).filter(([key]) => key !== 'id' && key !== 'unverifiedFields'),
  ),
)

const institutionSet = (
  overrides: Partial<PayrollParameterValues> & { id?: string; version?: number } = {},
): PayrollInstitutionSet => ({
  ...VALUES_2026,
  incomeTaxBrackets: VALUES_2026.incomeTaxBrackets.map((bracket) => ({ ...bracket })),
  source: 'Kurum mali müşaviri yazısı',
  id: 'pp-test-1',
  version: 1,
  ...overrides,
})

test('DOM-FIN-100: platform varsayılanları şemadan geçer, artan ve sabit kimliklidir', () => {
  for (const set of PAYROLL_PLATFORM_DEFAULTS) {
    const { id, unverifiedFields, ...values } = set
    assert.deepEqual(payrollParameterSetSchema.parse(values), values, id)
    assert.equal(id, `platform-${set.effectiveFrom}`)
    for (const field of unverifiedFields) assert.ok(PAYROLL_PARAMETER_FIELDS.includes(field))
  }
  const starts = PAYROLL_PLATFORM_DEFAULTS.map((set) => set.effectiveFrom)
  assert.deepEqual(starts, [...starts].sort())
  assert.deepEqual(PAYROLL_PARAMETER_READ_ROLES, ['yonetici', 'onburo'])
  assert.deepEqual(PAYROLL_PARAMETER_WRITE_ROLES, ['yonetici'])
  assert.deepEqual(Object.keys(PAYROLL_PARAMETER_LABELS), PAYROLL_PARAMETER_FIELDS)
})

test('DOM-FIN-100: net asgari ücret brütten hesaplanır (K-310); 2025 ve 2026 resmî net tutarı', () => {
  const derived2026 = payrollDerivedValues(VALUES_2026)
  assert.equal(derived2026.minimumWageNetCents, 2_807_550)
  assert.equal(derived2026.minimumWageEmployeeSgkCents, 462_420)
  assert.equal(derived2026.minimumWageEmployeeUnemploymentCents, 33_030)
  assert.equal(derived2026.sgkFloorCents, 3_303_000)
  assert.equal(derived2026.sgkCeilingCents, 29_727_000)
  assert.equal(derived2026.sgkEmployerNetRateBasisPoints, 1575)
  const set2025 = PAYROLL_PLATFORM_DEFAULTS[0]
  assert.ok(set2025)
  // 26.005,50 × %1 = 260,055 → 260,06 (yarım yukarı); net 22.104,67 ₺.
  assert.equal(payrollDerivedValues(set2025).minimumWageNetCents, 2_210_467)
  assert.equal(payrollDerivedValues(set2025).sgkCeilingCents, 19_504_125)
})

test('DOM-FIN-100: istisna kapalıyken asgari ücrete ilk dilim gelir vergisi ve damga vergisi kesilir', () => {
  const derived = payrollDerivedValues({
    ...VALUES_2026,
    minimumWageIncomeTaxExempt: false,
    minimumWageStampTaxExempt: false,
  })
  // Matrah 33.030 − 4.624,20 − 330,30 = 28.075,50; %15 = 4.211,325 → 4.211,33.
  assert.equal(derived.minimumWageIncomeTaxCents, 421_133)
  // 33.030 × binde 7,59 = 250,6977 → 250,70.
  assert.equal(derived.minimumWageStampTaxCents, 25_070)
  assert.equal(derived.minimumWageNetCents, 2_807_550 - 421_133 - 25_070)
})

test('DOM-FIN-100: dilim doğrulaması — ilk dilim 0, alt sınırlar ve oranlar kesin artan, oran 0–100 (K-311)', () => {
  const valid = [
    { lowerBoundCents: 0, rateBasisPoints: 1500 },
    { lowerBoundCents: 100, rateBasisPoints: 2000 },
  ]
  assert.equal(incomeTaxBracketsSchema.safeParse(valid).success, true)
  const failures: [unknown, string][] = [
    [[], 'En az bir gelir vergisi dilimi girin.'],
    [[{ lowerBoundCents: 5, rateBasisPoints: 1500 }], "İlk dilim 0 ₺'den başlamalıdır."],
    [
      [valid[0], { lowerBoundCents: 0, rateBasisPoints: 2000 }],
      'Dilim alt sınırları artan sırada olmalı; dilimler çakışamaz.',
    ],
    [
      [valid[0], { lowerBoundCents: 100, rateBasisPoints: 1500 }],
      'Dilim oranı bir önceki dilimin oranından büyük olmalıdır (artan oranlı tarife).',
    ],
    [[{ lowerBoundCents: 0, rateBasisPoints: 10_001 }], "Dilim oranı %100'ü aşamaz."],
    [[{ lowerBoundCents: 0, rateBasisPoints: -1 }], 'Dilim oranı eksi olamaz.'],
    [[{ lowerBoundCents: 0, rateBasisPoints: 15.5 }], 'Dilim oranı on binde bir'],
    [
      Array.from({ length: 11 }, (_, index) => ({
        lowerBoundCents: index * 100,
        rateBasisPoints: index * 100,
      })),
      'En fazla 10 dilim',
    ],
    [[{ lowerBoundCents: 0, rateBasisPoints: 1500, upToCents: 5 }], 'Tanınmayan anahtar'],
  ]
  for (const [input, message] of failures) {
    const result = incomeTaxBracketsSchema.safeParse(input)
    assert.equal(result.success, false, message)
    assert.ok(
      result.error?.issues.some((issue) => issue.message.includes(message)),
      `${message}: ${JSON.stringify(result.error?.issues)}`,
    )
  }
  // Oran %0 ve %100 sınırları kabul edilir.
  assert.equal(
    incomeTaxBracketsSchema.safeParse([
      { lowerBoundCents: 0, rateBasisPoints: 0 },
      { lowerBoundCents: 1, rateBasisPoints: 10_000 },
    ]).success,
    true,
  )
})

test('DOM-FIN-100: set şeması — ay başı, yıl aralığı, alanlar arası kurallar ve bilinmeyen alan', () => {
  const issues = (input: unknown) =>
    payrollParameterSetSchema.safeParse(input).error?.issues.map((issue) => issue.message) ?? []
  assert.deepEqual(issues(VALUES_2026), [])
  assert.ok(
    issues({ ...VALUES_2026, effectiveFrom: '2026-07-15' }).includes(
      'Yürürlük başlangıcı ayın ilk günü olmalıdır.',
    ),
  )
  assert.ok(
    issues({ ...VALUES_2026, effectiveFrom: '2019-12-01' }).includes(
      'Yürürlük başlangıcı 2020 ile 2099 yılları arasında olmalıdır.',
    ),
  )
  assert.ok(
    issues({ ...VALUES_2026, sgkEmployerIncentiveBasisPoints: 2100 }).includes(
      'İşveren prim indirimi işveren payından büyük olamaz.',
    ),
  )
  assert.ok(
    issues({ ...VALUES_2026, sgkCeilingMultiplierBasisPoints: 10_000 }).includes(
      'SGK tavan çarpanı taban çarpanından büyük olmalıdır.',
    ),
  )
  assert.ok(
    issues({ ...VALUES_2026, minimumWageGrossCents: 0 }).includes(
      'Brüt asgari ücret sıfırdan büyük olmalıdır.',
    ),
  )
  assert.ok(
    issues({ ...VALUES_2026, stampTaxRatePer100k: 10_001 }).includes(
      "Damga vergisi oranı %10'u aşamaz.",
    ),
  )
  assert.ok(issues({ ...VALUES_2026, source: ' a ' }).length > 0)
  assert.ok(issues({ ...VALUES_2026, institutionId: 'x' }).length > 0)
  assert.equal(updatePayrollParameterSetSchema.safeParse({}).success, false)
})

test('DOM-FIN-100: düzeltme birleşik seti doğrular ve yalnız değişen alan adlarını döner', () => {
  const current = institutionSet()
  const { values, changed } = mergePayrollParameterUpdate(current, {
    minimumWageGrossCents: 3_500_000,
    sgkEmployeeRateBasisPoints: current.sgkEmployeeRateBasisPoints,
    incomeTaxBrackets: current.incomeTaxBrackets.map((bracket) => ({ ...bracket })),
  })
  assert.equal(values.minimumWageGrossCents, 3_500_000)
  assert.deepEqual(changed, ['minimumWageGrossCents'])
  // Birleşik sette tavan tabanın altına inerse şema reddeder; mevcut set değişmez.
  assert.throws(() =>
    mergePayrollParameterUpdate(current, { sgkFloorMultiplierBasisPoints: 100_000 }),
  )
  assert.equal(current.sgkFloorMultiplierBasisPoints, 10_000)
  assert.equal(current.minimumWageGrossCents, 3_303_000)
})

test('DOM-FIN-100: aynı yürürlük başlangıcı 409 payroll_parameters_exist', () => {
  assert.doesNotThrow(() => assertPayrollEffectiveFromFree(false))
  assert.throws(
    () => assertPayrollEffectiveFromFree(true),
    (error) =>
      error instanceof DomainError &&
      error.code === 'payroll_parameters_exist' &&
      error.kind === 'conflict',
  )
})

test('DOM-FIN-100: geçerli set — dönem sınırları, yıl ortası değişim, tablo öncesi ve sonrası', () => {
  const on = (day: string, sets: PayrollInstitutionSet[] = []) =>
    effectivePayrollParameters(day, sets)
  assert.equal(on('2024-12-31'), null)
  assert.equal(on('2025-01-01')?.id, 'platform-2025-01-01')
  // Kıdem tavanı temmuzda değişir: 30 Haziran eski, 1 Temmuz yeni set.
  assert.equal(on('2025-06-30')?.values.severanceCeilingCents, 4_665_543)
  assert.equal(on('2025-07-01')?.values.severanceCeilingCents, 5_391_968)
  assert.equal(on('2025-12-31')?.id, 'platform-2025-07-01')
  assert.equal(on('2026-01-01')?.values.minimumWageGrossCents, 3_303_000)
  assert.equal(on('2026-11-16')?.stale, false)
  // Tabloda olmayan yıl: son bilinen set, `stale`.
  const later = on('2027-03-01')
  assert.equal(later?.id, 'platform-2026-01-01')
  assert.equal(later?.stale, true)
  assert.equal(later?.origin, 'platform')
  assert.equal(later?.version, null)

  // Kurumun yıl ortası asgari ücret artışı: 1 Temmuz 2026'dan itibaren kurum seti.
  const midYear = institutionSet({ effectiveFrom: '2026-07-01', minimumWageGrossCents: 3_600_000 })
  assert.equal(on('2026-06-30', [midYear])?.origin, 'platform')
  const july = on('2026-07-01', [midYear])
  assert.equal(july?.origin, 'institution')
  assert.equal(july?.overridesPlatform, false)
  assert.equal(july?.values.minimumWageGrossCents, 3_600_000)
  assert.deepEqual(july?.unverifiedFields, [])
  assert.equal(july?.version, 1)

  assert.throws(
    () => requireEffectivePayrollParameters('2024-06-01', []),
    (error) => error instanceof DomainError && error.code === 'payroll_parameters_missing',
  )
  assert.equal(requireEffectivePayrollParameters('2026-02-01', []).id, 'platform-2026-01-01')
})

test('DOM-FIN-100: aynı başlangıçta kurum kopyası platformu ezer; kopya yoksa platform değeri geri gelir (K-309)', () => {
  const copy = institutionSet({ effectiveFrom: '2026-01-01', severanceCeilingCents: 7_000_000 })
  const timeline = payrollParameterTimeline([copy])
  assert.equal(timeline.length, PAYROLL_PLATFORM_DEFAULTS.length)
  const replaced = timeline.find((set) => set.values.effectiveFrom === '2026-01-01')
  assert.equal(replaced?.origin, 'institution')
  assert.equal(replaced?.overridesPlatform, true)
  assert.equal(
    effectivePayrollParameters('2026-05-01', [copy])?.values.severanceCeilingCents,
    7_000_000,
  )
  assert.equal(
    effectivePayrollParameters('2026-05-01', [])?.values.severanceCeilingCents,
    6_494_877,
  )
  // Platformdan önceki kurum seti tablonun başını öne çeker.
  const early = institutionSet({ id: 'pp-test-2', effectiveFrom: '2024-01-01' })
  assert.equal(effectivePayrollParameters('2024-03-01', [early])?.id, 'pp-test-2')
  // Platform seti çağıranın değişikliğinden etkilenmez.
  replaced?.values.incomeTaxBrackets.push({ lowerBoundCents: 1, rateBasisPoints: 1 })
  assert.equal(platform2026.incomeTaxBrackets.length, 5)
})

test('DOM-FIN-100: yıllık tablo — dönemler, önceki yıldan süren set ve yıl seçenekleri', () => {
  const year2025 = payrollParameterYear(2025, [])
  assert.deepEqual(
    year2025.periods.map((period) => [period.periodStart, period.periodEnd, period.carriedOver]),
    [
      ['2025-01-01', '2025-06-30', false],
      ['2025-07-01', '2025-12-31', false],
    ],
  )
  assert.deepEqual(year2025.availableYears, [2025, 2026])

  const midYear = institutionSet({ effectiveFrom: '2026-07-01', minimumWageGrossCents: 3_600_000 })
  const year2026 = payrollParameterYear(2026, [midYear])
  assert.deepEqual(
    year2026.periods.map((period) => [period.periodStart, period.periodEnd, period.origin]),
    [
      ['2026-01-01', '2026-06-30', 'platform'],
      ['2026-07-01', '2026-12-31', 'institution'],
    ],
  )
  assert.equal(year2026.periods[1]?.derived.minimumWageNetCents, 3_060_000)

  // 2027'de set yok: 2026 seti önceki yıldan sürer.
  const year2027 = payrollParameterYear(2027, [midYear])
  assert.equal(year2027.periods.length, 1)
  assert.equal(year2027.periods[0]?.carriedOver, true)
  assert.equal(year2027.periods[0]?.periodStart, '2027-01-01')
  assert.equal(year2027.periods[0]?.values.effectiveFrom, '2026-07-01')
  // Yılın içinde başlayan setle önceki yıldan süren set birlikte.
  const march2027 = institutionSet({ id: 'pp-test-3', effectiveFrom: '2027-03-01' })
  assert.deepEqual(
    payrollParameterYear(2027, [midYear, march2027]).periods.map((period) => [
      period.periodStart,
      period.periodEnd,
      period.carriedOver,
    ]),
    [
      ['2027-01-01', '2027-02-28', true],
      ['2027-03-01', '2027-12-31', false],
    ],
  )
  assert.deepEqual(payrollParameterYear(2024, []).periods, [])

  assert.deepEqual(payrollYearOptions([2025, 2026], 2026), [2027, 2026, 2025])
  assert.deepEqual(payrollYearOptions([], 2026), [2027, 2026])
  assert.equal(monthStarts(2026)[6], '2026-07-01')
  assert.equal(monthStarts(2026).length, 12)
})

test('DOM-FIN-100: kıdem hesaplayıcısıyla okuma bağı — tavan ve dilimler aynı (DOM-FIN-094, H-34)', () => {
  const rows = severanceCeilingRows([])
  for (const row of rows)
    assert.deepEqual(
      SEVERANCE_CEILINGS.find((ceiling) => ceiling.from === row.from),
      row,
      `kıdem tavanı ${row.from}`,
    )
  for (const set of PAYROLL_PLATFORM_DEFAULTS)
    assert.deepEqual(
      wageTariffBrackets(set.incomeTaxBrackets),
      WAGE_INCOME_TAX_TARIFFS[Number(set.effectiveFrom.slice(0, 4))],
      `tarife ${set.effectiveFrom}`,
    )
  assert.deepEqual(severanceCeilingRows([institutionSet({ effectiveFrom: '2026-07-01' })]).at(-1), {
    from: '2026-07-01',
    monthlyCents: 6_494_877,
  })
})

test('DOM-FIN-100: gösterim satırları ve doğrulanmalı işareti', () => {
  assert.equal(basisPointsLabel(2075), '%20,75')
  assert.equal(basisPointsLabel(1400), '%14')
  assert.equal(stampTaxLabel(759), 'binde 7,59')
  assert.equal(multiplierLabel(75_000), '7,5 kat')
  assert.deepEqual(incomeTaxBracketRows(VALUES_2026.incomeTaxBrackets)[0], [
    '0,00 ₺ – 190.000,00 ₺',
    '%15',
  ])
  assert.deepEqual(incomeTaxBracketRows(VALUES_2026.incomeTaxBrackets).at(-1), [
    '5.300.000,00 ₺ üzeri',
    '%40',
  ])
  const [period] = payrollParameterYear(2026, []).periods
  assert.ok(period)
  assert.equal(payrollPeriodLabel(period), '1 Ocak 2026 – 31 Aralık 2026')
  const rows = payrollParameterRows(period)
  const byKey = new Map(rows.map((row) => [row.key, row]))
  assert.equal(byKey.get('minimumWageNetCents')?.value, '28.075,50 ₺')
  assert.equal(byKey.get('minimumWageNetCents')?.derived, true)
  assert.equal(byKey.get('minimumWageNetCents')?.unverified, true)
  assert.equal(byKey.get('stampTaxRatePer100k')?.value, 'binde 7,59')
  assert.equal(byKey.get('stampTaxRatePer100k')?.unverified, false)
  assert.equal(byKey.get('sgkCeilingCents')?.value, '297.270,00 ₺')
  assert.equal(byKey.get('minimumWageIncomeTaxExempt')?.value, 'Uygulanır')
  assert.equal(byKey.get('severanceCeilingCents')?.unverified, true)
  const own = payrollParameterRows({
    values: { ...VALUES_2026, minimumWageStampTaxExempt: false },
    derived: payrollDerivedValues(VALUES_2026),
    unverifiedFields: [],
  })
  assert.ok(own.every((row) => !row.unverified))
  assert.equal(own.find((row) => row.key === 'minimumWageStampTaxExempt')?.value, 'Uygulanmaz')
})
