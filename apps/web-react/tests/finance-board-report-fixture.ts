import type { FinanceBoardReport } from '@kampus/react-shared/use-finance-board-report.ts'

// Yönetim kurulu raporunun bütçe, maliyet ve tahmin bölümleri için örnek yanıt parçası (ON-329).
// Test dosyası değildir; şablon ve ekran testleri içe aktarır.

type Sections = Pick<
  FinanceBoardReport,
  'budgetPeriods' | 'budgetPeriod' | 'budget' | 'costs' | 'forecast'
>

const MONTHS = Array.from({ length: 12 }, (_, index) =>
  new Date(Date.UTC(2026, 9 + index, 1)).toISOString().slice(0, 7),
)

export const BOARD_FORECAST: FinanceBoardReport['forecast'] = {
  today: '2026-10-06',
  revenue: {
    year: 2027,
    committedCents: 8_000_000,
    newEnrollmentCents: 2_000_000,
    renewalCents: 6_000_000,
    pipelineNetCents: 1_500_000,
    pipelineStatus: 'included',
    expectedTotalCents: 9_500_000,
    discountCents: 300_000,
    scholarshipCents: 200_000,
    tariffYear: 2027,
  },
  cashFlow: {
    from: '2026-10-06',
    to: '2027-09-30',
    months: MONTHS.map((month, index) => ({
      month,
      expectedInCents: 100_000,
      refundCents: index === 0 ? 20_000 : 0,
      expenseCents: null,
      netCents: index === 0 ? 80_000 : 100_000,
      cumulativeNetCents: 80_000 + index * 100_000,
    })),
    totals: {
      scheduledCents: 1_300_000,
      expectedInCents: 1_200_000,
      atRiskCents: 100_000,
      refundCents: 20_000,
      expenseCents: null,
      netCents: 1_180_000,
    },
    overdueOpenCents: 400_000,
    pendingRefundCents: 20_000,
    onTimeRateBasisPoints: 9_000,
    expenseSource: 'none',
  },
}

/** Bütçe dönemi yok: bütçe ve maliyet bölümleri boş, tahmin var. */
export const NO_BUDGET_SECTIONS: Sections = {
  budgetPeriods: [],
  budgetPeriod: null,
  budget: null,
  costs: null,
  forecast: BOARD_FORECAST,
}

const PERIOD = {
  id: '6b0b1e2c-1c35-4c6a-9d77-0f4f1d8a0001',
  name: '2026–2027 bütçesi',
  status: 'open' as const,
  startDate: '2026-09-01',
  endDate: '2027-08-31',
}

export const BUDGET_SECTIONS: Sections = {
  budgetPeriods: [PERIOD],
  budgetPeriod: { ...PERIOD, selection: 'matched' },
  budget: {
    basis: 'accrual',
    asOfDate: '2026-10-06',
    expenseData: 'none',
    income: {
      plannedCents: 12_000_000,
      plannedToDateCents: 2_000_000,
      actualCents: 1_400_000,
      varianceCents: -10_600_000,
      realizationBasisPoints: 1_167,
      unmatchedCents: 50_000,
    },
    expense: {
      plannedCents: 2_000_000,
      plannedToDateCents: null,
      actualCents: null,
      varianceCents: null,
      realizationBasisPoints: null,
    },
    net: { plannedCents: 10_000_000, actualCents: null },
    topVariances: [
      {
        itemCode: 'G-100',
        itemName: 'Öğrenim geliri',
        itemKind: 'income',
        plannedCents: 12_000_000,
        plannedToDateCents: 2_000_000,
        actualCents: 1_400_000,
        varianceCents: -600_000,
        realizationBasisPoints: 7_000,
        comparedTo: 'to_date',
      },
    ],
  },
  costs: {
    from: '2026-09-01',
    to: '2027-08-31',
    minGroupSize: 5,
    campuses: [
      {
        campusId: 'kad',
        name: 'Kadıköy Kampüsü',
        studentCount: 6,
        accruedCents: 1_000_000,
        netCollectedCents: 600_000,
        budgetExpenseCents: 1_400_000,
        accruedPerStudentCents: 166_667,
        budgetExpensePerStudentCents: 233_333,
        suppressed: false,
      },
      {
        campusId: 'ata',
        name: 'Ataşehir Kampüsü',
        studentCount: 3,
        accruedCents: 400_000,
        netCollectedCents: 0,
        budgetExpenseCents: 600_000,
        accruedPerStudentCents: null,
        budgetExpensePerStudentCents: null,
        suppressed: true,
      },
    ],
    totals: {
      studentCount: 9,
      accruedCents: 1_400_000,
      netCollectedCents: 600_000,
      budgetExpenseCents: 2_000_000,
      accruedPerStudentCents: 155_556,
      budgetExpensePerStudentCents: 222_222,
      suppressed: false,
    },
  },
  forecast: BOARD_FORECAST,
}
