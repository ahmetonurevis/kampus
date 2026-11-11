import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BOARD_REPORT_CASH_FLOW_MONTHS,
  BOARD_REPORT_TOP_VARIANCES,
  boardBudgetPeriod,
  boardBudgetSummary,
  boardCostSummary,
  boardForecastSummary,
  boardForecastYear,
  overlapDays,
  type BoardBudgetPeriodOption,
} from '../packages/school-core/src/lib/finance-board-report-sections.ts'
import { boardReportQuerySchema } from '../packages/school-core/src/lib/finance-board-report.ts'
import type {
  BudgetActualRow,
  BudgetActuals,
} from '../packages/school-core/src/lib/finance-budget-actuals.ts'
import type {
  CampusConsolidation,
  CampusConsolidationRow,
} from '../packages/school-core/src/lib/finance-campus-consolidation.ts'
import {
  cashFlowForecast,
  revenueForecast,
} from '../packages/school-core/src/lib/finance-forecast.ts'
import { isDomainError } from './support/domain-error.ts'

// DOM-FIN-064 yönetim kurulu raporunun bütçe, maliyet ve tahmin bölümleri (ON-329).
const TODAY = '2026-11-20'
const REPORT = { from: '2026-09-01', endDate: '2027-08-31' }

const period = (
  id: string,
  status: BoardBudgetPeriodOption['status'],
  startDate: string,
  endDate: string,
  name = id,
): BoardBudgetPeriodOption => ({ id, name, status, startDate, endDate })

test('DOM-FIN-064 bütçe dönemi: örtüşme günü uçlar dahil sayılır', () => {
  const range = { startDate: '2026-09-01', endDate: '2026-09-30' }
  assert.equal(overlapDays(range, range), 30)
  assert.equal(overlapDays(range, { startDate: '2026-09-30', endDate: '2026-12-31' }), 1)
  assert.equal(overlapDays(range, { startDate: '2026-10-01', endDate: '2026-12-31' }), 0)
})

test('DOM-FIN-064 bütçe dönemi: seçilmezse en çok örtüşen açık ya da kapalı dönem (K-113)', () => {
  const periods = [
    period('draft-full', 'draft', '2026-09-01', '2027-08-31'),
    period('open-half', 'open', '2027-01-01', '2027-08-31'),
    period('closed-short', 'closed', '2026-06-01', '2026-09-30'),
    period('old', 'closed', '2025-09-01', '2026-08-31'),
  ]
  const matched = boardBudgetPeriod({ periods, report: REPORT, budgetPeriodId: undefined })
  assert.equal(matched?.id, 'open-half')
  assert.equal(matched?.selection, 'matched')
  // Taslak yalnız açık ya da kapalı dönem örtüşmüyorsa alınır.
  const onlyDraft = boardBudgetPeriod({
    periods: [periods[0]!, periods[3]!],
    report: REPORT,
    budgetPeriodId: undefined,
  })
  assert.equal(onlyDraft?.id, 'draft-full')
  // Eşit örtüşmede geç başlayan, sonra ad sırası.
  const tie = boardBudgetPeriod({
    periods: [
      period('b', 'open', '2026-09-01', '2026-12-31', 'B dönemi'),
      period('a', 'closed', '2026-09-01', '2026-12-31', 'A dönemi'),
    ],
    report: REPORT,
    budgetPeriodId: undefined,
  })
  assert.equal(tie?.id, 'a')
  assert.equal(
    boardBudgetPeriod({ periods: [periods[3]!], report: REPORT, budgetPeriodId: undefined }),
    null,
  )
  assert.equal(boardBudgetPeriod({ periods: [], report: REPORT, budgetPeriodId: undefined }), null)
})

test('DOM-FIN-064 bütçe dönemi: yönetici seçimi uyumdan bağımsızdır, olmayan dönem 422', () => {
  const periods = [
    period('old', 'closed', '2025-09-01', '2026-08-31'),
    period('draft', 'draft', '2026-09-01', '2027-08-31'),
  ]
  const chosen = boardBudgetPeriod({ periods, report: REPORT, budgetPeriodId: 'old' })
  assert.deepEqual(chosen, { ...periods[0], selection: 'chosen' })
  assert.throws(
    () => boardBudgetPeriod({ periods, report: REPORT, budgetPeriodId: 'missing' }),
    isDomainError('board_report_budget_period_not_found'),
  )
})

test('DOM-FIN-064 sorgu: bütçe dönemi kimliği isteğe bağlı UUID', () => {
  const id = '0b8f6c2e-4c1a-4f55-9d7e-2b1f0a9e6d11'
  assert.equal(boardReportQuerySchema.parse({ year: '2026' }).budgetPeriodId, undefined)
  assert.equal(
    boardReportQuerySchema.parse({ year: '2026', budgetPeriodId: id }).budgetPeriodId,
    id,
  )
  assert.equal(
    boardReportQuerySchema.safeParse({ year: '2026', budgetPeriodId: 'x' }).success,
    false,
  )
})

// --- Bütçe–gerçekleşen ----------------------------------------------------------------------

function row(
  overrides: Partial<BudgetActualRow> & Pick<BudgetActualRow, 'itemId'>,
): BudgetActualRow {
  return {
    key: `${overrides.itemId}:${overrides.costCenterId ?? 'none'}`,
    itemCode: overrides.itemId.toUpperCase(),
    itemName: `Kalem ${overrides.itemId}`,
    itemKind: 'income',
    feeKind: 'tuition',
    costCenterId: null,
    costCenterCode: null,
    costCenterName: null,
    costCenterPath: null,
    hasLine: true,
    plannedCents: 0,
    plannedToDateCents: 0,
    actualCents: 0,
    varianceCents: 0,
    realizationBasisPoints: null,
    status: 'mapped',
    months: [],
    ...overrides,
  }
}

function actuals(
  rows: BudgetActualRow[],
  expenseData: 'none' | 'available' = 'none',
): BudgetActuals {
  const sum = (pick: (item: BudgetActualRow) => number) => rows.reduce((t, r) => t + pick(r), 0)
  const income = rows.filter((item) => item.itemKind === 'income')
  const incomePlanned = income.reduce((t, r) => t + r.plannedCents, 0)
  const incomeActual = income.reduce((t, r) => t + (r.actualCents ?? 0), 0)
  const expensePlanned = sum((item) => (item.itemKind === 'expense' ? item.plannedCents : 0))
  return {
    periodId: 'p1',
    basis: 'accrual',
    startDate: '2026-09-01',
    endDate: '2027-08-31',
    asOfDate: TODAY,
    months: [],
    expenseData,
    rows,
    unmatched: [],
    totals: {
      income: {
        plannedCents: incomePlanned,
        actualCents: incomeActual,
        varianceCents: incomeActual - incomePlanned,
        realizationBasisPoints: Math.round((incomeActual * 10_000) / incomePlanned),
        unmatchedCents: 1_500,
      },
      expense: {
        plannedCents: expensePlanned,
        actualCents: null,
        varianceCents: null,
        realizationBasisPoints: null,
      },
      net: { plannedCents: incomePlanned - expensePlanned, actualCents: null },
    },
    openingImportCents: 0,
  }
}

test('DOM-FIN-064 bütçe özeti: toplamlar bütçe–gerçekleşen raporundandır, gider verisi yoksa null', () => {
  const report = actuals([
    row({
      itemId: 'g1',
      costCenterId: 'kad',
      plannedCents: 600_000,
      plannedToDateCents: 200_000,
      actualCents: 150_000,
    }),
    row({
      itemId: 'g1',
      costCenterId: 'ata',
      plannedCents: 400_000,
      plannedToDateCents: 100_000,
      actualCents: 160_000,
    }),
    row({
      itemId: 'p1',
      itemKind: 'expense',
      feeKind: null,
      plannedCents: 900_000,
      plannedToDateCents: 300_000,
      actualCents: null,
      status: 'no_expense_data',
    }),
  ])
  const summary = boardBudgetSummary(report)
  assert.equal(summary.expenseData, 'none')
  assert.deepEqual(summary.income, {
    ...report.totals.income,
    plannedToDateCents: 300_000,
  })
  assert.deepEqual(summary.expense, { ...report.totals.expense, plannedToDateCents: 300_000 })
  assert.deepEqual(summary.net, report.totals.net)
  assert.equal(summary.asOfDate, TODAY)
  // Kalem sapması merkezler toplanarak, bugüne kadarki planla ölçülür; gider kalemi girmez.
  assert.deepEqual(summary.topVariances, [
    {
      itemCode: 'G1',
      itemName: 'Kalem g1',
      itemKind: 'income',
      plannedCents: 1_000_000,
      plannedToDateCents: 300_000,
      actualCents: 310_000,
      varianceCents: 10_000,
      realizationBasisPoints: 10_333,
      comparedTo: 'to_date',
    },
  ])
})

test('DOM-FIN-064 bütçe özeti: en çok sapan kalemler mutlak sapmayla sıralanır, sınırlanır', () => {
  const rows = Array.from({ length: BOARD_REPORT_TOP_VARIANCES + 2 }, (_, index) =>
    row({
      itemId: `k${String(index)}`,
      plannedCents: 100_000,
      plannedToDateCents: null,
      actualCents: 100_000 + (index % 2 === 0 ? 1 : -1) * index * 1_000,
    }),
  )
  rows.push(row({ itemId: 'zero', plannedCents: 0, plannedToDateCents: null, actualCents: 5 }))
  rows.push(row({ itemId: 'even', plannedCents: 50, plannedToDateCents: 50, actualCents: 50 }))
  const summary = boardBudgetSummary(actuals(rows))
  assert.equal(summary.topVariances.length, BOARD_REPORT_TOP_VARIANCES)
  assert.deepEqual(
    summary.topVariances.map((item) => [item.itemCode, item.varianceCents, item.comparedTo]),
    [
      ['K6', 6_000, 'period'],
      ['K5', -5_000, 'period'],
      ['K4', 4_000, 'period'],
      ['K3', -3_000, 'period'],
      ['K2', 2_000, 'period'],
    ],
  )
  assert.equal(summary.income.plannedToDateCents, null)
  // Sapması sıfır kalem listeye girmez; planı sıfır kalemin oranı yoktur.
  const small = boardBudgetSummary(actuals(rows), 20)
  assert.ok(!small.topVariances.some((item) => item.itemCode === 'EVEN'))
  assert.equal(
    small.topVariances.find((item) => item.itemCode === 'ZERO')?.realizationBasisPoints,
    null,
  )
})

// --- Kampüs konsolide -----------------------------------------------------------------------

const campus = (overrides: Partial<CampusConsolidationRow>): CampusConsolidationRow => ({
  campusId: 'kad',
  name: 'Kadıköy',
  isActive: true,
  hasCostCenter: true,
  studentCount: 6,
  accruedCents: 600_000,
  collectedCents: 500_000,
  reversedCents: 0,
  refundedCents: 0,
  netCollectedCents: 500_000,
  budgetExpenseCents: 1_200_000,
  budgetSharedCents: 300_000,
  studentShareBasisPoints: 6_667,
  accruedShareBasisPoints: 6_000,
  netCollectedShareBasisPoints: 10_000,
  budgetExpenseShareBasisPoints: 8_000,
  accruedPerStudentCents: 100_000,
  budgetExpensePerStudentCents: 200_000,
  suppressed: false,
  ...overrides,
})

const TOTALS: CampusConsolidation['totals'] = {
  studentCount: 9,
  accruedCents: 1_000_000,
  collectedCents: 500_000,
  reversedCents: 0,
  refundedCents: 0,
  netCollectedCents: 500_000,
  budgetExpenseCents: 1_500_000,
  budgetSharedCents: 300_000,
  accruedPerStudentCents: 111_111,
  budgetExpensePerStudentCents: 166_667,
  suppressed: false,
}
const consolidationOf = (campuses: CampusConsolidationRow[]): CampusConsolidation => ({
  from: '2026-09-01',
  to: '2027-08-31',
  minGroupSize: 5,
  campuses,
  totals: TOTALS,
})
const ATASEHIR = campus({
  campusId: 'ata',
  name: 'Ataşehir',
  studentCount: 3,
  accruedCents: 400_000,
  netCollectedCents: 0,
  budgetExpenseCents: 300_000,
  accruedPerStudentCents: null,
  budgetExpensePerStudentCents: null,
  suppressed: true,
})
const HIDDEN_CAMPUS = {
  studentCount: null,
  accruedCents: null,
  netCollectedCents: null,
  budgetExpenseCents: null,
  accruedPerStudentCents: null,
  budgetExpensePerStudentCents: null,
  suppressed: true,
}

test('DOM-FIN-064 maliyet özeti: 5 kişiden az kampüsün tutarları da gizlenir (K-116)', () => {
  const summary = boardCostSummary(
    consolidationOf([
      campus({}),
      campus({ campusId: 'bey', name: 'Beylikdüzü', studentCount: 12, accruedCents: 2_000_000 }),
      ATASEHIR,
    ]),
  )
  assert.equal(summary.minGroupSize, 5)
  // Ataşehir'in 3 öğrencisi: tahakkuk tek kişinin ücretini belli eder; sayı ve tutar gizli.
  assert.deepEqual(summary.campuses[2], { campusId: 'ata', name: 'Ataşehir', ...HIDDEN_CAMPUS })
  // Toplamdan geri hesaplanmasın diye en küçük görünür kampüs (Kadıköy, 6) de gizlenir (ON-328).
  assert.deepEqual(summary.campuses[0], { campusId: 'kad', name: 'Kadıköy', ...HIDDEN_CAMPUS })
  assert.equal(summary.campuses[1]?.accruedCents, 2_000_000)
  assert.equal(summary.campuses[1]?.suppressed, false)
  // Kurum geneli toplam görünür (K-77).
  assert.deepEqual(summary.totals, {
    studentCount: 9,
    accruedCents: 1_000_000,
    netCollectedCents: 500_000,
    budgetExpenseCents: 1_500_000,
    accruedPerStudentCents: 111_111,
    budgetExpensePerStudentCents: 166_667,
    suppressed: false,
  })
  // Kurul özeti kişi kimliği ya da öğrenci listesi taşımaz.
  assert.doesNotMatch(JSON.stringify(summary), /studentId|"students"/)
})

test('DOM-FIN-064 maliyet özeti: gizlenecek görünür kampüs yoksa kırılımın tamamı gizlenir', () => {
  const summary = boardCostSummary(
    consolidationOf([
      ATASEHIR,
      campus({
        campusId: 'bos',
        name: 'Boş kampüs',
        collectedCents: 0,
        studentCount: 0,
        accruedCents: 0,
        netCollectedCents: 0,
        budgetExpenseCents: 0,
      }),
    ]),
  )
  assert.ok(summary.campuses.every((row) => row.suppressed && row.accruedCents === null))
})

test('DOM-FIN-064 maliyet özeti: dönem öğrencisi olmayan ama hareketi olan satır küçük grup sayılır', () => {
  // Kampüse bağlı olmayan satırda dönemde sayılan öğrenci yok, ayrılan öğrencinin tahsilatı var.
  const summary = boardCostSummary(
    consolidationOf([
      campus({}),
      campus({ campusId: 'bey', name: 'Beylikdüzü', studentCount: 12 }),
      campus({
        campusId: null,
        name: 'Kampüse bağlı olmayan',
        studentCount: 0,
        accruedCents: 0,
        netCollectedCents: 150_000,
        collectedCents: 150_000,
        budgetExpenseCents: 0,
      }),
      campus({
        campusId: 'gid',
        name: 'Yalnız gider',
        studentCount: 0,
        accruedCents: 0,
        netCollectedCents: 0,
        budgetExpenseCents: 90_000,
        collectedCents: 0,
      }),
    ]),
  )
  assert.equal(summary.campuses[2]?.netCollectedCents, null)
  assert.equal(summary.campuses[0]?.suppressed, true, 'en küçük görünür kampüs (ikincil)')
  assert.equal(summary.campuses[1]?.suppressed, false)
  // Kişi hareketi olmayan, yalnız bütçe gideri olan satır gizlenmez.
  assert.equal(summary.campuses[3]?.budgetExpenseCents, 90_000)
})

// --- Tahmin ---------------------------------------------------------------------------------

test('DOM-FIN-064 tahmin: gelecek eğitim yılı bugünden bulunur, 12 aylık nakit akışı tahmindendir', () => {
  assert.equal(boardForecastYear('2026-11-20'), 2027)
  assert.equal(boardForecastYear('2027-03-01'), 2027)
  assert.equal(boardForecastYear('2027-09-01'), 2028)
  const revenue = revenueForecast({
    year: boardForecastYear(TODAY),
    enrollmentYear: 2026,
    institutionType: 'school',
    today: TODAY,
    invoices: [
      {
        id: 'n1',
        studentId: 's1',
        amount: 500_000,
        dueDate: '2027-09-15T09:00:00.000Z',
        paidAt: null,
        academicYear: 2027,
      },
    ],
    contracts: [],
    renewals: [{ studentId: 's1', year: 2027, status: 'Planlandı' }],
    prospects: null,
    tariff: null,
  })
  const cashFlow = cashFlowForecast({
    today: TODAY,
    months: BOARD_REPORT_CASH_FLOW_MONTHS,
    monthlyExpenseCents: null,
    invoices: [
      { id: 'c1', amount: 300_000, dueDate: '2026-12-15T09:00:00.000Z', paidAt: null },
      { id: 'c2', amount: 200_000, dueDate: '2026-10-15T09:00:00.000Z', paidAt: null },
    ],
    allocated: new Map(),
    pendingRefunds: [{ refundCents: 50_000, refundDueDate: '2027-01-10' }],
  })
  const summary = boardForecastSummary(revenue, cashFlow)
  assert.equal(summary.today, TODAY)
  assert.equal(summary.revenue.year, 2027)
  assert.equal(summary.revenue.committedCents, revenue.committed.totalCents)
  assert.equal(summary.revenue.renewalCents, 500_000)
  assert.equal(summary.revenue.expectedTotalCents, revenue.expectedTotalCents)
  assert.equal(summary.revenue.pipelineNetCents, null)
  assert.equal(summary.revenue.pipelineStatus, 'crm_disabled')
  assert.equal(summary.cashFlow.months.length, 12)
  assert.equal(summary.cashFlow.from, cashFlow.from)
  const sum = (pick: (item: (typeof summary.cashFlow.months)[number]) => number) =>
    summary.cashFlow.months.reduce((total, item) => total + pick(item), 0)
  assert.equal(
    sum((item) => item.expectedInCents),
    summary.cashFlow.totals.expectedInCents,
  )
  assert.equal(
    summary.cashFlow.totals.expectedInCents,
    cashFlow.totals.expectedCollectionCents + cashFlow.totals.overdueRecoveryCents,
  )
  assert.equal(summary.cashFlow.totals.refundCents, 50_000)
  assert.equal(summary.cashFlow.totals.netCents, cashFlow.totals.netCents)
  assert.equal(summary.cashFlow.months.at(-1)?.cumulativeNetCents, cashFlow.totals.netCents)
  assert.equal(summary.cashFlow.totals.expenseCents, null)
  assert.equal(summary.cashFlow.expenseSource, 'none')
  assert.equal(summary.cashFlow.overdueOpenCents, 200_000)
})
