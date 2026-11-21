import assert from 'node:assert/strict'
import test from 'node:test'

import { csvAmount } from '../packages/school-core/src/lib/csv.ts'
import {
  cashFlowForecast,
  revenueForecast,
  type CashFlowForecast,
  type RevenueForecast,
} from '../packages/school-core/src/lib/finance-forecast.ts'
import {
  financeScenarioComparison,
  financeScenarioCsv,
  financeScenarioRequestSchema,
  financeScenarioSchema,
  scenarioCashFlow,
  scenarioOutcome,
  type FinanceScenario,
} from '../packages/school-core/src/lib/finance-scenarios.ts'

// Gelir senaryo analizi (DOM-FIN-067; ON-248, K24). Temel: bir yeni kayıt (9.000.000 kuruş), bir
// yenileme (8.000.000), huniden 0,5 beklenen kayıt (4.722.000 net), indirim oranı %5,56.

const TODAY = '2026-10-06'

function forecast(
  overrides: {
    committed?: Partial<RevenueForecast['committed']>
    pipeline?: Partial<NonNullable<RevenueForecast['pipeline']>> | null
    assumptions?: Partial<RevenueForecast['assumptions']>
  } = {},
): RevenueForecast {
  const committed = {
    totalCents: 0,
    newEnrollmentCents: 9_000_000,
    renewalCents: 8_000_000,
    students: 2,
    newStudents: 1,
    renewalStudents: 1,
    ...overrides.committed,
  }
  committed.totalCents = committed.newEnrollmentCents + committed.renewalCents
  const pipeline =
    overrides.pipeline === null
      ? null
      : {
          prospects: 1,
          steps: [],
          grossCents: 5_000_000,
          discountCents: 278_000,
          netCents: 4_722_000,
          unpricedProspects: 0,
          unratedProspects: 0,
          expectedEnrollments: 0.5,
          ...overrides.pipeline,
        }
  return {
    year: 2026,
    enrollmentYear: 2026,
    today: TODAY,
    committed,
    contracts: { count: 2, listCents: 0, discountCents: 0, scholarshipCents: 0, netCents: 0 },
    pipeline,
    expectedTotalCents: committed.totalCents + (pipeline?.netCents ?? 0),
    assumptions: {
      pipelineStatus: pipeline === null ? 'crm_disabled' : 'included',
      historyFrom: '2024-10-06',
      historyTo: TODAY,
      historyClosedProspects: 4,
      tariffYear: 2026,
      tariffCarriedOver: false,
      discountReferenceYear: 2026,
      discountRateBasisPoints: 556,
      contractAverageCents: 9_000_000,
      priceSources: { tariffLevel: 0, tariffAverage: 1, contractAverage: 0, none: 0 },
      ...overrides.assumptions,
    },
  }
}

const scenario = (input: Record<string, unknown> = {}): FinanceScenario =>
  financeScenarioSchema.parse(input)

test('DOM-FIN-067: değişimsiz senaryo temeli verir (iki kapsamda da)', () => {
  const base = forecast()
  for (const applyToExistingContracts of [false, true]) {
    const outcome = scenarioOutcome(base, scenario({ applyToExistingContracts }))
    assert.equal(outcome.expectedTotalCents, 21_722_000)
    assert.equal(outcome.newEnrollment.netCents, 13_722_000)
    assert.equal(outcome.newEnrollment.students, 1.5)
    assert.equal(outcome.renewal.netCents, 8_000_000)
    assert.equal(outcome.differenceCents, 0)
    assert.equal(outcome.differenceBasisPoints, 0)
    assert.equal(outcome.discountRateBasisPoints, 556)
  }
  // Kuruş yuvarlaması temeli bozmaz: kesirli birim fiyat.
  const odd = forecast({ pipeline: { netCents: 1_000_001, expectedEnrollments: 0.3 } })
  assert.equal(scenarioOutcome(odd, scenario()).expectedTotalCents, odd.expectedTotalCents)
  assert.equal(
    scenarioOutcome(odd, scenario({ applyToExistingContracts: true })).expectedTotalCents,
    odd.expectedTotalCents,
  )
})

test('DOM-FIN-067: öğrenci değişimi yüzde ya da adet; yeni kayıt ve yenileme ayrı', () => {
  const base = forecast()
  const doubled = scenarioOutcome(
    base,
    scenario({ newStudents: { unit: 'percent', value: 10_000 } }),
  )
  // 1,5 → 3 öğrenci: sözleşmeli 1 kalır, 2 öğrenci huni birim netiyle (9.444.000).
  assert.equal(doubled.newEnrollment.students, 3)
  assert.equal(doubled.newEnrollment.contractedStudents, 1)
  assert.equal(doubled.newEnrollment.netCents, 9_000_000 + 18_888_000)
  assert.equal(doubled.renewal.netCents, 8_000_000)
  assert.equal(doubled.differenceCents, 14_166_000)
  assert.equal(doubled.differenceBasisPoints, 6521)

  // Azalma önce huniden düşer: 1,35 öğrenci → sözleşmeli 1 + 0,35 huni.
  const fewer = scenarioOutcome(base, scenario({ newStudents: { unit: 'percent', value: -1000 } }))
  assert.equal(fewer.newEnrollment.students, 1.35)
  assert.equal(fewer.newEnrollment.netCents, 9_000_000 + 3_305_400)

  const renewals = scenarioOutcome(base, scenario({ renewalStudents: { unit: 'count', value: 2 } }))
  assert.equal(renewals.renewal.students, 3)
  assert.equal(renewals.renewal.netCents, 24_000_000)
  assert.equal(renewals.newEnrollment.netCents, 13_722_000)
})

test('DOM-FIN-067 sınır: öğrenci sıfırın altına inmez; sözleşmeli öğrenci kaybı orantılı düşer', () => {
  const base = forecast()
  for (const change of [
    { unit: 'count', value: -1 },
    { unit: 'count', value: -5 },
    { unit: 'percent', value: -10_000 },
  ]) {
    const outcome = scenarioOutcome(base, scenario({ renewalStudents: change }))
    assert.equal(outcome.renewal.students, 0, JSON.stringify(change))
    assert.equal(outcome.renewal.contractedStudents, 0)
    assert.equal(outcome.renewal.netCents, 0)
  }
  const lost = scenarioOutcome(
    forecast({ committed: { renewalStudents: 3, renewalCents: 10_000_000 } }),
    scenario({ renewalStudents: { unit: 'count', value: -1 } }),
  )
  assert.equal(lost.renewal.contractedStudents, 2)
  assert.equal(lost.renewal.netCents, 6_666_667)
})

test('DOM-FIN-067: fiyat değişimi varsayılan olarak mevcut sözleşmeleri değiştirmez', () => {
  const base = forecast()
  const onlyNew = scenarioOutcome(base, scenario({ priceChangeBasisPoints: 1000 }))
  assert.equal(onlyNew.newEnrollment.netCents, 9_000_000 + 5_194_200)
  assert.equal(onlyNew.renewal.netCents, 8_000_000)
  assert.equal(onlyNew.differenceCents, 472_200)
  assert.equal(onlyNew.differenceBasisPoints, 217)

  const all = scenarioOutcome(
    base,
    scenario({ priceChangeBasisPoints: 1000, applyToExistingContracts: true }),
  )
  assert.equal(all.newEnrollment.netCents, 15_094_200)
  assert.equal(all.renewal.netCents, 8_800_000)
  assert.equal(all.differenceCents, 2_172_200)
  assert.equal(all.differenceBasisPoints, 1000)

  const cut = scenarioOutcome(base, scenario({ priceChangeBasisPoints: -5000 }))
  assert.equal(cut.newEnrollment.netCents, 9_000_000 + 2_361_000)
})

test('DOM-FIN-067: indirim ve burs oranı puanla değişir, %0–%100 arasına sıkışır', () => {
  const base = forecast()
  const more = scenarioOutcome(base, scenario({ discountChangeBasisPoints: 200 }))
  assert.equal(more.discountRateBasisPoints, 756)
  // 4.722.000 × (1 − 0,0756) ÷ (1 − 0,0556)
  assert.equal(more.newEnrollment.netCents, 9_000_000 + 4_622_000)
  assert.equal(more.renewal.netCents, 8_000_000)

  const full = scenarioOutcome(base, scenario({ discountChangeBasisPoints: 10_000 }))
  assert.equal(full.discountRateBasisPoints, 10_000)
  assert.equal(full.newEnrollment.netCents, 9_000_000)

  const none = scenarioOutcome(
    base,
    scenario({ discountChangeBasisPoints: -10_000, applyToExistingContracts: true }),
  )
  assert.equal(none.discountRateBasisPoints, 0)
  // Bütün öğrenci brüte döner: 13.722.000 ÷ 0,9444 = 14.529.859,6…
  assert.equal(none.newEnrollment.netCents, 14_529_860)
})

test('DOM-FIN-067: öğrencisi olmayan segmentte eklenen öğrenci sözleşme liste ortalamasıyla fiyatlanır', () => {
  const empty = forecast({
    committed: { newStudents: 0, newEnrollmentCents: 0, renewalStudents: 0, renewalCents: 0 },
    pipeline: null,
    assumptions: { discountRateBasisPoints: 1000, contractAverageCents: 10_000_000 },
  })
  const added = scenarioOutcome(
    empty,
    scenario({ newStudents: { unit: 'count', value: 3 }, priceChangeBasisPoints: 1000 }),
  )
  assert.equal(added.newEnrollment.netCents, 29_700_000)
  assert.equal(added.newEnrollment.unpricedStudents, 0)
  assert.equal(added.differenceBasisPoints, null, 'temel sıfırsa oran yok')

  const unpriced = scenarioOutcome(
    forecast({
      committed: { newStudents: 0, newEnrollmentCents: 0 },
      pipeline: null,
      assumptions: { contractAverageCents: null },
    }),
    scenario({ newStudents: { unit: 'count', value: 2 } }),
  )
  assert.equal(unpriced.newEnrollment.students, 2)
  assert.equal(unpriced.newEnrollment.unpricedStudents, 2)
  assert.equal(unpriced.newEnrollment.netCents, 0)

  // Temel oran %100 iken net brütü vermez: liste ortalaması kullanılır.
  const fullScholarship = scenarioOutcome(
    forecast({
      committed: { newEnrollmentCents: 0, renewalStudents: 0, renewalCents: 0 },
      pipeline: null,
      assumptions: { discountRateBasisPoints: 10_000, contractAverageCents: 10_000_000 },
    }),
    scenario({ discountChangeBasisPoints: -5000, applyToExistingContracts: true }),
  )
  assert.equal(fullScholarship.newEnrollment.netCents, 5_000_000)
})

test('DOM-FIN-067: sonuç tutarları kuruş tamsayıdır', () => {
  const base = forecast({ pipeline: { netCents: 1_234_567, expectedEnrollments: 0.3333 } })
  for (const value of [-9999, -333, 1, 777, 19_999])
    for (const applyToExistingContracts of [false, true]) {
      const outcome = scenarioOutcome(
        base,
        scenario({
          newStudents: { unit: 'percent', value },
          renewalStudents: {
            unit: 'percent',
            value: -value / 3 > -10_000 ? Math.trunc(-value / 3) : 0,
          },
          priceChangeBasisPoints: 333,
          discountChangeBasisPoints: 77,
          applyToExistingContracts,
        }),
      )
      for (const cents of [
        outcome.newEnrollment.netCents,
        outcome.renewal.netCents,
        outcome.expectedTotalCents,
        outcome.differenceCents,
      ])
        assert.ok(Number.isInteger(cents), `${String(value)}: ${String(cents)}`)
    }
})

test('DOM-FIN-067: huni beklenen kayıt sayısı gelir tahmininden gelir', () => {
  const result = revenueForecast({
    year: 2026,
    enrollmentYear: 2026,
    institutionType: 'school',
    today: TODAY,
    invoices: [],
    contracts: [],
    renewals: [],
    prospects: [
      { stage: 'Kayıt oldu', studentId: 'x', createdAt: '2026-06-01T09:00:00.000Z' },
      { stage: 'Vazgeçti', createdAt: '2026-06-01T09:00:00.000Z' },
      { stage: 'Yeni aday', createdAt: '2026-09-01T09:00:00.000Z', interest: '7' },
      { stage: 'Yeni aday', createdAt: '2026-09-02T09:00:00.000Z', interest: '7' },
    ],
    tariff: {
      academicYear: 2026,
      items: [{ kind: 'tuition', level: '7', amountCents: 10_000_000, unit: 'year' }],
    },
  })
  assert.equal(result.pipeline?.expectedEnrollments, 1)
  const comparison = financeScenarioComparison({
    forecast: result,
    scenarios: [scenario({ newStudents: { unit: 'count', value: 1 } })],
    cashFlow: null,
  })
  assert.equal(comparison.baseline.newEnrollment.students, 1)
  assert.equal(comparison.baseline.expectedTotalCents, 10_000_000)
  assert.equal(comparison.scenarios[0]?.expectedTotalCents, 20_000_000)
  assert.equal(comparison.cashFlow, null)
})

function baseCashFlow(months = 3): CashFlowForecast {
  return cashFlowForecast({
    today: TODAY,
    months,
    monthlyExpenseCents: null,
    invoices: [
      {
        id: 'i1',
        amount: 500_000,
        dueDate: '2026-11-15T09:00:00.000Z',
        paidAt: null,
      },
    ],
    allocated: new Map(),
    pendingRefunds: [],
  })
}

test('DOM-FIN-067 nakit akışı: fark yılın kalan aylarına eşit yayılır, kalan kuruş son aya', () => {
  const flow = scenarioCashFlow(baseCashFlow(), 2026, [1_100_000, -1_000_003])
  assert.equal(flow.spreadFrom, '2026-10')
  assert.equal(flow.spreadTo, '2027-08')
  assert.equal(flow.spreadMonths, 11)
  assert.deepEqual(
    flow.baseline.map((month) => [month.month, month.netCents, month.cumulativeNetCents]),
    [
      ['2026-10', 0, 0],
      ['2026-11', 500_000, 500_000],
      ['2026-12', 0, 500_000],
    ],
  )
  const [up, down] = flow.scenarios
  assert.deepEqual(
    up?.months.map((month) => [month.changeCents, month.netCents, month.cumulativeNetCents]),
    [
      [100_000, 100_000, 100_000],
      [100_000, 600_000, 700_000],
      [100_000, 100_000, 800_000],
    ],
  )
  assert.equal(up?.totalChangeCents, 300_000)
  assert.equal(up?.beyondHorizonChangeCents, 800_000)
  assert.equal(down?.totalChangeCents, -90_909 * 3)
  // 7 ay × −90.909 ve son ay −90.913: toplam korunur.
  assert.equal(down?.beyondHorizonChangeCents, -90_909 * 7 - 90_913)

  const rated = scenarioCashFlow(
    {
      ...baseCashFlow(),
      assumptions: { ...baseCashFlow().assumptions, onTimeRateBasisPoints: 8000 },
    },
    2026,
    [1_100_000],
  )
  assert.equal(rated.scenarios[0]?.months[0]?.changeCents, 80_000)
  assert.equal(rated.onTimeRateBasisPoints, 8000)
})

test('DOM-FIN-067 nakit akışı: geçmiş yılda fark yazılmaz; gelecek yıl ufuk dışına düşer', () => {
  const past = scenarioCashFlow(baseCashFlow(), 2024, [1_000_000])
  assert.equal(past.spreadMonths, 0)
  assert.equal(past.spreadFrom, null)
  assert.equal(past.scenarios[0]?.totalChangeCents, 0)
  assert.equal(past.scenarios[0]?.beyondHorizonChangeCents, 0)

  const next = scenarioCashFlow(baseCashFlow(), 2027, [1_200_000])
  assert.equal(next.spreadFrom, '2027-09')
  assert.equal(next.spreadMonths, 12)
  assert.equal(next.scenarios[0]?.totalChangeCents, 0)
  assert.equal(next.scenarios[0]?.beyondHorizonChangeCents, 1_200_000)
})

test('DOM-FIN-067 doğrulama: varsayılanlar, sınırlar, bilinmeyen alan ve senaryo sayısı', () => {
  assert.deepEqual(financeScenarioSchema.parse({}), {
    newStudents: { unit: 'percent', value: 0 },
    renewalStudents: { unit: 'percent', value: 0 },
    priceChangeBasisPoints: 0,
    discountChangeBasisPoints: 0,
    applyToExistingContracts: false,
  })
  const invalid = [
    { newStudents: { unit: 'percent', value: -10_001 } },
    { newStudents: { unit: 'percent', value: 20_001 } },
    { newStudents: { unit: 'count', value: 10_001 } },
    { newStudents: { unit: 'count', value: 1.5 } },
    { newStudents: { unit: 'kişi', value: 1 } },
    { priceChangeBasisPoints: -5001 },
    { priceChangeBasisPoints: 20_001 },
    { discountChangeBasisPoints: 10_001 },
    { discountChangeBasisPoints: -10_001 },
    { applyToExistingContracts: 'evet' },
    { name: 'Kötümser' },
  ]
  for (const input of invalid)
    assert.equal(financeScenarioSchema.safeParse(input).success, false, JSON.stringify(input))
  for (const input of [
    { newStudents: { unit: 'percent', value: -10_000 } },
    { newStudents: { unit: 'percent', value: 20_000 } },
    { renewalStudents: { unit: 'count', value: -10_000 } },
    { priceChangeBasisPoints: -5000 },
    { priceChangeBasisPoints: 20_000 },
    { discountChangeBasisPoints: 10_000 },
  ])
    assert.equal(financeScenarioSchema.safeParse(input).success, true, JSON.stringify(input))

  const request = (extra: Record<string, unknown>) =>
    financeScenarioRequestSchema.safeParse({ scenarios: [{}], ...extra })
  assert.equal(request({}).success, true)
  assert.equal(request({ scenarios: [] }).success, false)
  assert.equal(request({ scenarios: [{}, {}, {}, {}, {}] }).success, false)
  assert.equal(request({ scenarios: [{}, {}, {}, {}] }).success, true)
  assert.equal(request({ cashFlowMonths: 0 }).success, false)
  assert.equal(request({ cashFlowMonths: 25 }).success, false)
  assert.equal(request({ year: 1999 }).success, false)
  assert.equal(request({ institutionId: 'x' }).success, false)
  const message = request({ scenarios: [] })
  assert.equal(message.success ? '' : message.error.issues[0]?.message, 'En az bir senaryo girin.')
})

test('DOM-FIN-067 CSV: ölçüt satırları, temel ve senaryo sütunları, nakit akışı ayları', () => {
  const comparison = financeScenarioComparison({
    forecast: forecast(),
    scenarios: [
      scenario({ newStudents: { unit: 'percent', value: -1000 }, priceChangeBasisPoints: 2500 }),
      scenario({ renewalStudents: { unit: 'count', value: 3 }, applyToExistingContracts: true }),
    ],
    cashFlow: baseCashFlow(2),
  })
  const lines = financeScenarioCsv(comparison, ['=Kötümser']).split('\r\n')
  assert.equal(lines[0], '"Ölçüt";"Temel";"\'=Kötümser";"Senaryo 2"')
  assert.equal(lines[1], '"Yeni kayıt değişimi";"";"%-10";"%0"')
  assert.equal(lines[2], '"Yenileme değişimi";"";"%0";"3 öğrenci artış"')
  assert.equal(lines[3], '"Fiyat değişimi (%)";"";25,00;0,00')
  assert.equal(lines[5], '"Mevcut sözleşmelere uygulanır";"";"Hayır";"Evet"')
  assert.equal(lines[6], '"Yeni kayıt öğrenci";1,50;1,35;1,50')
  const [first, second] = comparison.scenarios
  assert.ok(
    lines.includes(
      `"Beklenen toplam";217220,00;${csvAmount(first?.expectedTotalCents ?? 0)};${csvAmount(second?.expectedTotalCents ?? 0)}`,
    ),
  )
  assert.equal(lines.filter((line) => line.startsWith('"Nakit akışı net')).length, 2)
  assert.match(lines[lines.length - 1] ?? '', /^"Nakit akışı net · 2026-11";5000,00;/)
})
