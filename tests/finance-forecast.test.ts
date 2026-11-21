import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addMonthKey,
  applyBasisPoints,
  basisPoints,
  cashFlowForecast,
  cashFlowForecastCsv,
  cashFlowForecastQuerySchema,
  levelKey,
  revenueForecast,
  revenueForecastCsv,
  revenueForecastQuerySchema,
  schoolYearOfDay,
  shiftMonths,
  type CashFlowInput,
  type ForecastContract,
  type ForecastInvoice,
  type ForecastProspect,
  type RevenueForecastInput,
} from '../packages/school-core/src/lib/finance-forecast.ts'

// Gelir ve nakit akışı tahmini (DOM-FIN-063; ON-246, ON-247; IST-104, IST-105, IST-117).

const TODAY = '2026-10-06'

const invoice = (
  id: string,
  studentId: string,
  amount: number,
  dueDay: string,
  extra: Partial<ForecastInvoice> = {},
): ForecastInvoice => ({
  id,
  studentId,
  amount,
  dueDate: `${dueDay}T09:00:00.000Z`,
  paidAt: null,
  ...extra,
})

const contract = (
  id: string,
  studentId: string,
  amount: number,
  extra: Partial<ForecastContract> = {},
): ForecastContract => ({
  id,
  studentId,
  amount,
  date: '2026-05-01T09:00:00.000Z',
  academicYear: 2026,
  ...extra,
})

const prospect = (
  stage: string,
  createdDay: string,
  extra: Partial<ForecastProspect> = {},
): ForecastProspect => ({
  stage,
  createdAt: `${createdDay}T09:00:00.000Z`,
  ...extra,
})

const TARIFF = {
  academicYear: 2026,
  items: [
    { kind: 'tuition' as const, level: '7', amountCents: 40_000_000, unit: 'year' as const },
    { kind: 'tuition' as const, level: '8', amountCents: 60_000_000, unit: 'year' as const },
    { kind: 'meal' as const, level: null, amountCents: 5_000_000, unit: 'year' as const },
  ],
}

function revenueInput(overrides: Partial<RevenueForecastInput> = {}): RevenueForecastInput {
  return {
    year: 2026,
    enrollmentYear: 2026,
    institutionType: 'school',
    today: TODAY,
    invoices: [],
    contracts: [],
    renewals: [],
    prospects: [],
    tariff: TARIFF,
    ...overrides,
  }
}

test('DOM-FIN-063 yardımcılar: oran, ay kaydırma, eğitim yılı ve düzey anahtarı', () => {
  assert.equal(basisPoints(1, 3), 3333)
  assert.equal(basisPoints(5, 0), null)
  assert.equal(applyBasisPoints(10_001, 5000), 5001)
  assert.equal(shiftMonths('2026-03-31', -1), '2026-02-28')
  assert.equal(shiftMonths('2024-02-29', -24), '2022-02-28')
  assert.equal(shiftMonths('2026-10-06', -24), '2024-10-06')
  assert.equal(addMonthKey('2026-11', 3), '2027-02')
  assert.equal(schoolYearOfDay('2026-09-01'), 2026)
  assert.equal(schoolYearOfDay('2026-08-31'), 2025)
  assert.equal(levelKey('7. Sınıf · Ortaokul'), '7')
  assert.equal(levelKey('07'), '7')
  assert.equal(levelKey('Genel İngilizce b1+'), 'B1+')
  assert.equal(levelKey('Pre-A1 çocuk'), 'PRE-A1')
  assert.equal(levelKey('Hazırlık'), 'HAZIRLIK')
  assert.equal(levelKey('  '), null)
  assert.equal(levelKey(null), null)
})

test('DOM-FIN-063 sorgu şemaları: varsayılan, sınır ve bilinmeyen alan reddi', () => {
  assert.deepEqual(revenueForecastQuerySchema.parse({}), {})
  assert.deepEqual(revenueForecastQuerySchema.parse({ year: '2027' }), { year: 2027 })
  assert.equal(revenueForecastQuerySchema.safeParse({ year: '1999' }).success, false)
  assert.equal(revenueForecastQuerySchema.safeParse({ institutionId: 'x' }).success, false)
  assert.deepEqual(cashFlowForecastQuerySchema.parse({}), { months: 12 })
  assert.deepEqual(cashFlowForecastQuerySchema.parse({ months: '3', monthlyExpenseCents: '0' }), {
    months: 3,
    monthlyExpenseCents: 0,
  })
  assert.equal(cashFlowForecastQuerySchema.safeParse({ months: '25' }).success, false)
  assert.equal(cashFlowForecastQuerySchema.safeParse({ months: '0' }).success, false)
  assert.equal(cashFlowForecastQuerySchema.safeParse({ monthlyExpenseCents: '-1' }).success, false)
  assert.equal(cashFlowForecastQuerySchema.safeParse({ monthlyExpenseCents: '1.5' }).success, false)
})

test('DOM-FIN-063 kesin gelir: yılın taksitleri yeni kayıt ve yenileme diye ayrılır', () => {
  const forecast = revenueForecast(
    revenueInput({
      invoices: [
        invoice('i1', 's1', 1_000_000, '2026-09-15', { academicYear: 2026 }),
        invoice('i2', 's1', 1_000_000, '2026-10-15', { academicYear: 2026, paidAt: null }),
        invoice('i3', 's2', 3_000_000, '2026-09-15', { academicYear: 2026 }),
        // Başka yılın taksiti girmez.
        invoice('i4', 's2', 9_000_000, '2025-09-15', { academicYear: 2025 }),
        // Yılı sözleşmesinden okunur.
        invoice('i5', 's3', 500_000, '2025-12-01', { contractId: 'k3' }),
        // Yılı ve sözleşmesi yoksa vade gününün eğitim yılı.
        invoice('i6', 's4', 700_000, '2027-03-01'),
        invoice('i7', 's4', 800_000, '2026-08-31'),
      ],
      contracts: [contract('k3', 's3', 500_000, { academicYear: 2026 })],
      renewals: [
        { studentId: 's2', year: 2026, status: 'Etkin' },
        { studentId: 's1', year: 2026, status: 'İptal' },
        { studentId: 's3', year: 2025, status: 'Etkin' },
      ],
    }),
  )
  assert.deepEqual(forecast.committed, {
    totalCents: 6_200_000,
    newEnrollmentCents: 3_200_000,
    renewalCents: 3_000_000,
    students: 4,
    newStudents: 3,
    renewalStudents: 1,
  })
})

test('DOM-FIN-063 indirim etkisi: yürürlükteki sözleşmeler; iptal ve yerine geçen sürüm girmez', () => {
  const approval = { approvedAt: '2026-05-02T09:00:00.000Z' } as ForecastContract['approval']
  const forecast = revenueForecast(
    revenueInput({
      contracts: [
        contract('k1', 's1', 8_200_000, {
          grossCents: 10_000_000,
          discounts: [{ kind: 'sibling', amountCents: 1_000_000 }],
          extras: [{ kind: 'meal', amountCents: 200_000 }],
          scholarship: { programId: 'p1', amountCents: 1_000_000 },
        }),
        // Eski sözleşme: tarifesiz, liste fiyatı tutarıdır.
        contract('k2', 's2', 3_000_000),
        contract('k3', 's3', 5_000_000, { cancelledAt: '2026-06-01T09:00:00.000Z' }),
        contract('k4', 's4', 4_000_000, { grossCents: 4_000_000, approval }),
        contract('k5', 's4', 3_000_000, {
          grossCents: 4_000_000,
          discounts: [{ kind: 'early_registration', amountCents: 1_000_000 }],
          amendsContractId: 'k4',
          approval,
        }),
        contract('k6', 's5', 2_000_000, { academicYear: 2025, grossCents: 2_000_000 }),
      ],
    }),
  )
  assert.deepEqual(forecast.contracts, {
    count: 3,
    listCents: 10_200_000 + 3_000_000 + 4_000_000,
    discountCents: 2_000_000,
    scholarshipCents: 1_000_000,
    netCents: 8_200_000 + 3_000_000 + 3_000_000,
  })
  // İndirim oranı tarifeli sözleşmelerden: (1M + 1M burs + 1M) / (10M + 4M).
  assert.equal(forecast.assumptions.discountReferenceYear, 2026)
  assert.equal(forecast.assumptions.discountRateBasisPoints, 2143)
  assert.equal(forecast.assumptions.contractAverageCents, 7_000_000)
})

const HISTORY: ForecastProspect[] = [
  // Görüşmeye ulaşan dört kapanmış adaydan ikisi kayıt oldu.
  prospect('Kayıt oldu', '2026-03-01', { studentId: 's1', meeting: {} }),
  prospect('Kayıt oldu', '2026-04-01', { studentId: 's2' }),
  prospect('Vazgeçti', '2026-05-01', { meeting: {} }),
  prospect('Vazgeçti', '2025-11-01', { trialAt: '2025-11-10T09:00:00.000Z' }),
  // Görüşmeye ulaşmadan vazgeçen.
  prospect('Vazgeçti', '2026-01-10'),
  // Pencere dışında (24 aydan eski) ve tarihsiz kapanmış aday örnekleme girmez.
  prospect('Kayıt oldu', '2024-10-05', { studentId: 's9' }),
  { stage: 'Vazgeçti' },
]

test('DOM-FIN-063 huni beklentisi: kapanmış adaylardan adım oranı, tarifeden düzey fiyatı', () => {
  const forecast = revenueForecast(
    revenueInput({
      contracts: [
        contract('k1', 's1', 9_000_000, {
          grossCents: 10_000_000,
          discounts: [{ kind: 'sibling', amountCents: 1_000_000 }],
        }),
      ],
      prospects: [
        ...HISTORY,
        prospect('Yeni aday', '2026-09-01', { interest: '7. Sınıf · Ortaokul' }),
        prospect('Görüşme planlandı', '2026-09-02', { interest: '8. Sınıf' }),
        prospect('Teklif verildi', '2026-09-03', { interest: 'Lise hazırlık', meeting: {} }),
        // Pencere dışı açık aday beklentiye girmez.
        prospect('Yeni aday', '2024-01-01', { interest: '7. Sınıf' }),
      ],
    }),
  )
  const pipeline = forecast.pipeline
  assert.ok(pipeline)
  assert.equal(forecast.assumptions.pipelineStatus, 'included')
  assert.equal(forecast.assumptions.historyFrom, '2024-10-06')
  assert.equal(forecast.assumptions.historyClosedProspects, 5)
  assert.equal(pipeline.prospects, 3)
  assert.deepEqual(
    pipeline.steps.map((step) => step.step),
    ['prospect', 'meeting'],
    'okulda deneme adımı yok',
  )
  const [first, meeting] = pipeline.steps
  assert.ok(first && meeting)
  // Aday adımı: 5 kapanmıştan 2 kayıt → %40; görüşme adımı: 4'ten 2 → %50.
  assert.equal(first.sampleSize, 5)
  assert.equal(first.rateBasisPoints, 4000)
  assert.equal(meeting.sampleSize, 4)
  assert.equal(meeting.rateBasisPoints, 5000)
  // 7. sınıf: 400.000 ₺ × %40 = 160.000 ₺; indirim oranı %10.
  assert.equal(first.prospects, 1)
  assert.equal(first.grossCents, 16_000_000)
  assert.equal(first.discountCents, 1_600_000)
  assert.equal(first.netCents, 14_400_000)
  // 8. sınıf 600.000 ₺ ve eşleşmeyen düzey ortalama 500.000 ₺; ikisi × %50.
  assert.equal(meeting.prospects, 2)
  assert.equal(meeting.grossCents, 30_000_000 + 25_000_000)
  assert.equal(meeting.discountCents, 3_000_000 + 2_500_000)
  assert.deepEqual(forecast.assumptions.priceSources, {
    tariffLevel: 2,
    tariffAverage: 1,
    contractAverage: 0,
    none: 0,
  })
  assert.equal(pipeline.netCents, 14_400_000 + 49_500_000)
  assert.equal(forecast.expectedTotalCents, forecast.committed.totalCents + pipeline.netCents)
  assert.equal(forecast.assumptions.tariffYear, 2026)
  assert.equal(forecast.assumptions.tariffCarriedOver, false)
})

test('DOM-FIN-063 dil okulu: deneme adımı, sözleşme ortalaması fiyatı ve önceki yılın tarifesi', () => {
  const forecast = revenueForecast(
    revenueInput({
      institutionType: 'language_school',
      year: 2027,
      // Ders saati birimli tarife yıllık öğrenim kalemi taşımaz.
      tariff: {
        academicYear: 2026,
        items: [{ kind: 'tuition', level: 'B1', amountCents: 50_000, unit: 'lesson_hour' }],
      },
      contracts: [
        contract('k1', 's1', 2_000_000, { grossCents: 2_000_000 }),
        contract('k2', 's2', 3_000_000, {
          grossCents: 4_000_000,
          academicYear: 2026,
          discounts: [{ kind: 'corporate', amountCents: 1_000_000 }],
        }),
      ],
      prospects: [
        prospect('Kayıt oldu', '2026-06-01', { studentId: 's1', trialLesson: {} }),
        prospect('Vazgeçti', '2026-06-02', { trialLesson: {} }),
        prospect('Vazgeçti', '2026-06-03', { trialLesson: {} }),
        prospect('Vazgeçti', '2026-06-04', { trialLesson: {} }),
        prospect('Görüşme planlandı', '2026-09-01', { interest: 'B1', trialLesson: {} }),
      ],
    }),
  )
  const trial = forecast.pipeline?.steps.find((step) => step.step === 'trial')
  assert.ok(trial)
  assert.equal(trial.rateBasisPoints, 2500)
  // Fiyat 2026 sözleşmelerinin liste ortalaması (300.000 ₺) × %25; indirim oranı 1M / 6M.
  assert.equal(trial.grossCents, 750_000)
  assert.equal(forecast.assumptions.discountReferenceYear, 2026)
  assert.equal(forecast.assumptions.discountRateBasisPoints, 1667)
  assert.equal(trial.discountCents, 125_025)
  assert.equal(forecast.assumptions.priceSources.contractAverage, 1)
  assert.equal(forecast.assumptions.tariffCarriedOver, true)
  assert.equal(forecast.assumptions.tariffYear, 2026)
})

test('DOM-FIN-063 huni: örneklemsiz adım ve fiyatsız aday beklentiye girmez, ayrıca sayılır', () => {
  const forecast = revenueForecast(
    revenueInput({
      tariff: null,
      prospects: [
        prospect('Kayıt oldu', '2026-06-01', { studentId: 's1' }),
        prospect('Yeni aday', '2026-09-01', { interest: '7' }),
        prospect('Görüşme planlandı', '2026-09-01', { interest: '7' }),
      ],
    }),
  )
  assert.ok(forecast.pipeline)
  assert.equal(forecast.pipeline.unpricedProspects, 2)
  assert.equal(forecast.pipeline.unratedProspects, 0)
  assert.equal(forecast.pipeline.netCents, 0)
  assert.equal(forecast.assumptions.priceSources.none, 2)
  assert.equal(forecast.assumptions.tariffYear, null)
  assert.equal(forecast.assumptions.discountReferenceYear, null)
  assert.equal(forecast.assumptions.discountRateBasisPoints, 0)

  const unrated = revenueForecast(
    revenueInput({
      prospects: [prospect('Görüşme planlandı', '2026-09-01', { interest: '7' })],
    }),
  )
  const meeting = unrated.pipeline?.steps.find((step) => step.step === 'meeting')
  assert.equal(meeting?.rateBasisPoints, null)
  assert.equal(meeting?.sampleSize, 0)
  assert.equal(unrated.pipeline?.unratedProspects, 1)
  assert.equal(unrated.pipeline?.grossCents, 0)
})

test('DOM-FIN-063 huni: geçmiş yılda ve crm kapalıyken hesaplanmaz', () => {
  const past = revenueForecast(
    revenueInput({ year: 2025, prospects: [prospect('Yeni aday', '2026-09-01')] }),
  )
  assert.equal(past.pipeline, null)
  assert.equal(past.assumptions.pipelineStatus, 'past_year')
  const closed = revenueForecast(revenueInput({ prospects: null }))
  assert.equal(closed.pipeline, null)
  assert.equal(closed.assumptions.pipelineStatus, 'crm_disabled')
  assert.equal(closed.assumptions.historyClosedProspects, 0)
  assert.equal(closed.expectedTotalCents, closed.committed.totalCents)
})

test('DOM-FIN-063 gelir tahmini CSV: kesin, huni ve toplam satırları; oran yüzde', () => {
  const forecast = revenueForecast(
    revenueInput({
      invoices: [invoice('i1', 's1', 1_000_000, '2026-09-15', { academicYear: 2026 })],
      prospects: [...HISTORY, prospect('Yeni aday', '2026-09-01', { interest: '7' })],
    }),
  )
  const lines = revenueForecastCsv(forecast, 'school').split('\r\n')
  assert.equal(
    lines[0],
    '"Kalem";"Aday";"Örneklem";"Dönüşüm oranı (%)";"Brüt";"İndirim ve burs";"Net"',
  )
  assert.equal(lines[1], '"Kesin gelir · yeni kayıt";"";"";"";"";"";10000,00')
  assert.equal(lines[4], '"Huni · Aday";1;5;40,00;160000,00;0,00;160000,00')
  assert.equal(lines[5], '"Huni · Tanışma görüşmesi";0;4;50,00;0,00;0,00;0,00')
  assert.equal(lines.at(-1), '"Beklenen toplam";"";"";"";"";"";170000,00')
})

function cashInput(overrides: Partial<CashFlowInput> = {}): CashFlowInput {
  return {
    today: TODAY,
    months: 3,
    monthlyExpenseCents: null,
    invoices: [],
    allocated: new Map(),
    pendingRefunds: [],
    ...overrides,
  }
}

const paidOn = (day: string) => `${day}T10:00:00.000Z`

test('DOM-FIN-063 nakit akışı: geçmiş tahsil oranıyla beklenen tahsilat ve tahsil riski', () => {
  const forecast = cashFlowForecast(
    cashInput({
      invoices: [
        // Örneklem (2025-10-06 … 2026-09-06 vadeli): 300 vadesinde, 100 geç, 100 hiç ödenmedi.
        invoice('h1', 's1', 300_000, '2026-01-10', { paidAt: paidOn('2026-02-09') }),
        invoice('h2', 's1', 100_000, '2026-02-10', { paidAt: paidOn('2026-03-20') }),
        invoice('h3', 's2', 100_000, '2026-09-01'),
        // Örneklem dışında: 30 günü dolmamış ve 12 aydan eski.
        invoice('h4', 's2', 999_000, '2026-09-20', { paidAt: paidOn('2026-09-20') }),
        invoice('h5', 's2', 999_000, '2025-10-05', { paidAt: paidOn('2025-10-05') }),
        // Gelecek vadeler: kısmi ödemede yalnız kalan; bugünün taksiti bu aydadır.
        invoice('f1', 's1', 1_000_000, TODAY),
        invoice('f2', 's1', 1_000_000, '2026-11-15'),
        invoice('f3', 's2', 2_000_000, '2026-12-01'),
        invoice('f4', 's2', 4_000_000, '2027-01-01'),
        invoice('f5', 's2', 500_000, '2026-11-20', { paidAt: paidOn('2026-10-01') }),
      ],
      allocated: new Map([
        ['f2', 400_000],
        ['h3', 20_000],
      ]),
      pendingRefunds: [],
    }),
  )
  assert.equal(forecast.assumptions.historyFrom, '2025-10-06')
  assert.equal(forecast.assumptions.historyTo, '2026-09-06')
  assert.equal(forecast.assumptions.historyInvoices, 3)
  assert.equal(forecast.assumptions.historyAmountCents, 500_000)
  assert.equal(forecast.assumptions.onTimeRateBasisPoints, 6000)
  assert.equal(forecast.assumptions.onTimeRateSource, 'history')
  assert.equal(forecast.assumptions.lateRecoveryRateBasisPoints, 5000)
  assert.equal(forecast.assumptions.expenseSource, 'none')
  assert.deepEqual(
    forecast.months.map((month) => month.month),
    ['2026-10', '2026-11', '2026-12'],
  )
  const [october, november, december] = forecast.months
  assert.ok(october && november && december)
  assert.equal(october.scheduledCents, 1_000_000)
  assert.equal(october.expectedCollectionCents, 600_000)
  assert.equal(october.atRiskCents, 400_000)
  // Gecikmiş açık: h3 kalan 80.000 × %50.
  assert.equal(forecast.overdueOpenCents, 80_000)
  assert.equal(october.overdueRecoveryCents, 40_000)
  assert.equal(november.scheduledCents, 600_000)
  assert.equal(november.overdueRecoveryCents, 0)
  assert.equal(december.scheduledCents, 2_000_000)
  assert.equal(forecast.beyondHorizonCents, 4_000_000)
  assert.equal(october.expenseCents, null)
  assert.equal(october.netCents, 640_000)
  assert.equal(december.cumulativeNetCents, 640_000 + 360_000 + 1_200_000)
  assert.equal(forecast.totals.netCents, december.cumulativeNetCents)
  assert.equal(forecast.totals.expenseCents, null)
  assert.equal(forecast.totals.scheduledCents, 3_600_000)
})

test('DOM-FIN-063 nakit akışı: örneklem yoksa oran varsayılan, iade ve elle gider düşülür', () => {
  const forecast = cashFlowForecast(
    cashInput({
      months: 2,
      monthlyExpenseCents: 100_000,
      invoices: [
        invoice('f1', 's1', 1_000_000, '2026-11-01'),
        invoice('o1', 's1', 300_000, '2026-10-01'),
      ],
      pendingRefunds: [
        { refundCents: 50_000, refundDueDate: '2026-09-15' },
        { refundCents: 70_000, refundDueDate: '2026-11-30' },
        { refundCents: 90_000, refundDueDate: '2027-05-01' },
        { refundCents: 0, refundDueDate: '2026-10-10' },
      ],
    }),
  )
  assert.equal(forecast.assumptions.onTimeRateSource, 'default')
  assert.equal(forecast.assumptions.onTimeRateBasisPoints, 10_000)
  assert.equal(forecast.assumptions.lateRecoveryRateSource, 'default')
  assert.equal(forecast.assumptions.lateRecoveryRateBasisPoints, 0)
  assert.equal(forecast.assumptions.expenseSource, 'manual')
  const [october, november] = forecast.months
  assert.ok(october && november)
  // Vadesi geçmiş iade ilk aya; ufuk dışı iade aylara girmez, toplamda kalır.
  assert.equal(october.refundCents, 50_000)
  assert.equal(october.overdueRecoveryCents, 0)
  assert.equal(october.netCents, -150_000)
  assert.equal(november.refundCents, 70_000)
  assert.equal(november.netCents, 1_000_000 - 70_000 - 100_000)
  assert.equal(forecast.pendingRefundCents, 210_000)
  assert.equal(forecast.totals.refundCents, 120_000)
  assert.equal(forecast.totals.expenseCents, 200_000)
  assert.equal(forecast.overdueOpenCents, 300_000)
})

test('DOM-FIN-063 nakit akışı CSV: ay satırları, boş gider hücresi ve toplam', () => {
  const forecast = cashFlowForecast(
    cashInput({ months: 1, invoices: [invoice('f1', 's1', 123_456, '2026-10-20')] }),
  )
  const lines = cashFlowForecastCsv(forecast).split('\r\n')
  assert.equal(lines.length, 3)
  assert.match(lines[0] ?? '', /^"Ay";"Planlanan tahsilat";/)
  assert.equal(lines[1], '"2026-10";1234,56;1234,56;0,00;0,00;0,00;"";1234,56;1234,56')
  assert.equal(lines[2], '"Toplam";1234,56;1234,56;0,00;0,00;0,00;"";1234,56;""')
  const withExpense = cashFlowForecast(
    cashInput({ months: 1, monthlyExpenseCents: 2_000_000, invoices: [] }),
  )
  assert.match(
    cashFlowForecastCsv(withExpense),
    /"2026-10";0,00;0,00;0,00;0,00;0,00;20000,00;-20000,00;-20000,00/,
  )
})
