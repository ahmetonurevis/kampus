import type { BudgetActuals, BudgetActualTotals } from './finance-budget-actuals.ts'
import type { BudgetItemKind, BudgetPeriodStatus } from './finance-budget.ts'
import type { CampusConsolidation, CampusConsolidationRow } from './finance-campus-consolidation.ts'
import { DomainError } from './errors.ts'
import {
  CASH_FLOW_DEFAULT_MONTHS,
  schoolYearOfDay,
  type CashFlowForecast,
  type PipelineStatus,
  type RevenueForecast,
} from './finance-forecast.ts'

/**
 * Yönetim kurulu raporunun bütçe, maliyet ve tahmin bölümleri (docs/domain/finans.md DOM-FIN-064;
 * ON-329, K-81'in öngördüğü genişleme). Bölümler yeni hesap yazmaz: bütçe–gerçekleşen `budgetActuals`
 * (DOM-FIN-066), kampüs konsolide ve öğrenci başı maliyet `campusConsolidation` (DOM-FIN-065), gelir
 * ve nakit tahmini `revenueForecast`/`cashFlowForecast` (DOM-FIN-063) sonucundan kurul özeti çıkarır.
 * Kişi adı ve kimliği taşımaz; küçük grup kuralı kaynak hesabındır (öğrenci başı değer 5 kişiden az
 * kampüste gizli, K-102).
 *
 * Bütçe dönemi (K-113): yönetici dönemi seçebilir; seçmezse rapor dönemiyle en çok gün örtüşen açık
 * ya da kapalı dönem alınır, öyle dönem yoksa taslak dönemlerden aynı kuralla. Hiçbiri örtüşmüyorsa
 * bütçe ve maliyet bölümleri "bütçe dönemi yok" der.
 */

/** Kurul özetinde gösterilen en çok sapan kalem sayısı (K-114). */
export const BOARD_REPORT_TOP_VARIANCES = 5

export interface BoardBudgetPeriodOption {
  id: string
  name: string
  status: BudgetPeriodStatus
  startDate: string
  endDate: string
}

export type BoardBudgetPeriodSelection = 'chosen' | 'matched'

export interface BoardBudgetPeriod extends BoardBudgetPeriodOption {
  /** `chosen`: yönetici seçti; `matched`: rapor dönemine göre bulundu. */
  selection: BoardBudgetPeriodSelection
}

const DAY_MS = 86_400_000
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00.000Z`) / DAY_MS

/** İki gün aralığının ortak gün sayısı (uçlar dahil); örtüşme yoksa 0. */
export function overlapDays(
  left: { startDate: string; endDate: string },
  right: { startDate: string; endDate: string },
): number {
  const start = left.startDate > right.startDate ? left.startDate : right.startDate
  const end = left.endDate < right.endDate ? left.endDate : right.endDate
  return end < start ? 0 : dayNumber(end) - dayNumber(start) + 1
}

/**
 * Raporun bütçe dönemi (K-113). `budgetPeriodId` verilirse o dönem (kurumda yoksa 422
 * `board_report_budget_period_not_found`); verilmezse rapor dönemiyle (seçilen başlangıç – seçilen
 * bitiş) en çok gün örtüşen açık ya da kapalı dönem, yoksa taslak dönem. Eşitlikte geç başlayan, sonra
 * ada göre ilk. Örtüşen dönem yoksa `null`.
 */
export function boardBudgetPeriod(input: {
  periods: readonly BoardBudgetPeriodOption[]
  report: { from: string; endDate: string }
  budgetPeriodId: string | undefined
}): BoardBudgetPeriod | null {
  const { periods, budgetPeriodId } = input
  if (budgetPeriodId !== undefined) {
    const chosen = periods.find((item) => item.id === budgetPeriodId)
    if (chosen === undefined)
      throw new DomainError(
        'board_report_budget_period_not_found',
        'Seçilen bütçe dönemi bulunamadı.',
        { path: ['budgetPeriodId'] },
      )
    return { ...pick(chosen), selection: 'chosen' }
  }
  const range = { startDate: input.report.from, endDate: input.report.endDate }
  const best = (candidates: readonly BoardBudgetPeriodOption[]) =>
    candidates
      .map((item) => ({ item, days: overlapDays(item, range) }))
      .filter((entry) => entry.days > 0)
      .sort(
        (a, b) =>
          b.days - a.days ||
          b.item.startDate.localeCompare(a.item.startDate) ||
          a.item.name.localeCompare(b.item.name, 'tr'),
      )[0]?.item
  const matched =
    best(periods.filter((item) => item.status !== 'draft')) ??
    best(periods.filter((item) => item.status === 'draft'))
  return matched === undefined ? null : { ...pick(matched), selection: 'matched' }
}

const pick = (period: BoardBudgetPeriodOption): BoardBudgetPeriodOption => ({
  id: period.id,
  name: period.name,
  status: period.status,
  startDate: period.startDate,
  endDate: period.endDate,
})

// --- Bütçe–gerçekleşen özeti --------------------------------------------------------------------

export interface BoardBudgetTotals extends BudgetActualTotals {
  /** Bugüne kadarki ayların planı; dağılımsız satır varken dönem bitmediyse `null`. */
  plannedToDateCents: number | null
}

export interface BoardBudgetVariance {
  itemCode: string
  itemName: string
  itemKind: BudgetItemKind
  plannedCents: number
  plannedToDateCents: number | null
  actualCents: number
  /** Gerçekleşen − karşılaştırma planı (bugüne kadarki plan, yoksa dönem planı). */
  varianceCents: number
  /** Gerçekleşen ÷ karşılaştırma planı, on binde bir; plan sıfırsa `null`. */
  realizationBasisPoints: number | null
  /** Sapma hangi planla ölçüldü. */
  comparedTo: 'to_date' | 'period'
}

export interface BoardBudgetSummary {
  basis: BudgetActuals['basis']
  /** Hareketlerin sayıldığı son gün; dönem başlamadıysa `null`. */
  asOfDate: string | null
  /** `none`: gider gerçekleşeni kaynağı yok, gider gerçekleşeni "veri yok". */
  expenseData: BudgetActuals['expenseData']
  income: BoardBudgetTotals & { unmatchedCents: number | null }
  expense: BoardBudgetTotals
  net: BudgetActuals['totals']['net']
  /** En çok sapan kalemler (merkezler toplanır), mutlak sapmaya göre büyükten küçüğe. */
  topVariances: BoardBudgetVariance[]
}

const ratio = (actual: number, planned: number) =>
  planned === 0 ? null : Math.round((actual * 10_000) / planned)

/** Satırların bugüne kadarki planı; biri bilinmiyorsa `null`. */
function plannedToDate(rows: readonly { plannedToDateCents: number | null }[]): number | null {
  let total = 0
  for (const row of rows) {
    if (row.plannedToDateCents === null) return null
    total += row.plannedToDateCents
  }
  return total
}

/**
 * Bütçe–gerçekleşen raporundan kurul özeti (K-114): gelir ve gider toplamı aynı raporun
 * toplamlarıdır; kalem sapması merkezler toplanarak bulunur ve bugüne kadarki planla (bilinmiyorsa
 * dönem planıyla) ölçülür. Gerçekleşeni hesaplanmayan satır (gider verisi yok, eşlenmemiş kalem,
 * başlamamış dönem) sapma listesine girmez.
 */
export function boardBudgetSummary(
  actuals: BudgetActuals,
  limit: number = BOARD_REPORT_TOP_VARIANCES,
): BoardBudgetSummary {
  const ofKind = (kind: BudgetItemKind) => actuals.rows.filter((row) => row.itemKind === kind)
  const byItem = new Map<string, (typeof actuals.rows)[number][]>()
  for (const row of actuals.rows) {
    if (row.actualCents === null) continue
    const list = byItem.get(row.itemId)
    if (list) list.push(row)
    else byItem.set(row.itemId, [row])
  }
  const variances: BoardBudgetVariance[] = []
  for (const rows of byItem.values()) {
    const [first] = rows
    if (first === undefined) continue
    const plannedCents = rows.reduce((sum, row) => sum + row.plannedCents, 0)
    const toDate = plannedToDate(rows)
    const actualCents = rows.reduce((sum, row) => sum + (row.actualCents ?? 0), 0)
    const compared = toDate ?? plannedCents
    variances.push({
      itemCode: first.itemCode,
      itemName: first.itemName,
      itemKind: first.itemKind,
      plannedCents,
      plannedToDateCents: toDate,
      actualCents,
      varianceCents: actualCents - compared,
      realizationBasisPoints: ratio(actualCents, compared),
      comparedTo: toDate === null ? 'period' : 'to_date',
    })
  }
  variances.sort(
    (a, b) =>
      Math.abs(b.varianceCents) - Math.abs(a.varianceCents) || a.itemCode.localeCompare(b.itemCode),
  )
  return {
    basis: actuals.basis,
    asOfDate: actuals.asOfDate,
    expenseData: actuals.expenseData,
    income: { ...actuals.totals.income, plannedToDateCents: plannedToDate(ofKind('income')) },
    expense: { ...actuals.totals.expense, plannedToDateCents: plannedToDate(ofKind('expense')) },
    net: actuals.totals.net,
    topVariances: variances.filter((item) => item.varianceCents !== 0).slice(0, limit),
  }
}

// --- Kampüs konsolide ve öğrenci başı maliyet -----------------------------------------------------

export type BoardCampusRow = Pick<
  CampusConsolidationRow,
  | 'campusId'
  | 'name'
  | 'studentCount'
  | 'accruedCents'
  | 'netCollectedCents'
  | 'budgetExpenseCents'
  | 'accruedPerStudentCents'
  | 'budgetExpensePerStudentCents'
  | 'suppressed'
>

export interface BoardCostSummary {
  from: string
  to: string
  minGroupSize: number
  campuses: BoardCampusRow[]
  totals: Omit<BoardCampusRow, 'campusId' | 'name'>
}

/**
 * Konsolide rapordan kurul özeti: kampüs satırları ve kurum toplamı. Öğrenci başı maliyet kampüs
 * merkezinin bütçe gideridir (ortak gider payı dahil); 5 kişiden az kampüste öğrenci başı değer
 * kaynak hesapta gizlidir (K-102), burada yeniden hesaplanmaz.
 */
export function boardCostSummary(consolidation: CampusConsolidation): BoardCostSummary {
  const row = (item: CampusConsolidationRow): BoardCampusRow => ({
    campusId: item.campusId,
    name: item.name,
    studentCount: item.studentCount,
    accruedCents: item.accruedCents,
    netCollectedCents: item.netCollectedCents,
    budgetExpenseCents: item.budgetExpenseCents,
    accruedPerStudentCents: item.accruedPerStudentCents,
    budgetExpensePerStudentCents: item.budgetExpensePerStudentCents,
    suppressed: item.suppressed,
  })
  const { totals } = consolidation
  return {
    from: consolidation.from,
    to: consolidation.to,
    minGroupSize: consolidation.minGroupSize,
    campuses: consolidation.campuses.map(row),
    totals: {
      studentCount: totals.studentCount,
      accruedCents: totals.accruedCents,
      netCollectedCents: totals.netCollectedCents,
      budgetExpenseCents: totals.budgetExpenseCents,
      accruedPerStudentCents: totals.accruedPerStudentCents,
      budgetExpensePerStudentCents: totals.budgetExpensePerStudentCents,
      suppressed: totals.suppressed,
    },
  }
}

// --- Gelir ve nakit akışı tahmini ---------------------------------------------------------------

/** Kurul raporunun nakit akışı ufku (ay). */
export const BOARD_REPORT_CASH_FLOW_MONTHS = CASH_FLOW_DEFAULT_MONTHS

/**
 * Gelir tahmini yılı (K-115): bugünün eğitim yılından sonraki yıl. Tahmin rapor döneminden bağımsız,
 * bugün itibarıyladır.
 */
export const boardForecastYear = (today: string) => schoolYearOfDay(today) + 1

export interface BoardForecastMonth {
  month: string
  /** Vadesinde beklenen tahsilat artı gecikmişten geç tahsil beklentisi. */
  expectedInCents: number
  refundCents: number
  expenseCents: number | null
  netCents: number
  cumulativeNetCents: number
}

export interface BoardForecastSummary {
  today: string
  revenue: {
    year: number
    committedCents: number
    newEnrollmentCents: number
    renewalCents: number
    /** Huni beklentisinin neti; huni yoksa `null`. */
    pipelineNetCents: number | null
    pipelineStatus: PipelineStatus
    expectedTotalCents: number
    discountCents: number
    scholarshipCents: number
    tariffYear: number | null
  }
  cashFlow: {
    from: string
    to: string
    months: BoardForecastMonth[]
    totals: {
      scheduledCents: number
      expectedInCents: number
      atRiskCents: number
      refundCents: number
      expenseCents: number | null
      netCents: number
    }
    overdueOpenCents: number
    pendingRefundCents: number
    onTimeRateBasisPoints: number
    expenseSource: CashFlowForecast['assumptions']['expenseSource']
  }
}

/** Gelir ve nakit akışı tahmininden kurul özeti; rakamlar tahmin hesabınındır. */
export function boardForecastSummary(
  revenue: RevenueForecast,
  cashFlow: CashFlowForecast,
): BoardForecastSummary {
  const { totals } = cashFlow
  return {
    today: cashFlow.today,
    revenue: {
      year: revenue.year,
      committedCents: revenue.committed.totalCents,
      newEnrollmentCents: revenue.committed.newEnrollmentCents,
      renewalCents: revenue.committed.renewalCents,
      pipelineNetCents: revenue.pipeline?.netCents ?? null,
      pipelineStatus: revenue.assumptions.pipelineStatus,
      expectedTotalCents: revenue.expectedTotalCents,
      discountCents: revenue.contracts.discountCents,
      scholarshipCents: revenue.contracts.scholarshipCents,
      tariffYear: revenue.assumptions.tariffYear,
    },
    cashFlow: {
      from: cashFlow.from,
      to: cashFlow.to,
      months: cashFlow.months.map((month) => ({
        month: month.month,
        expectedInCents: month.expectedCollectionCents + month.overdueRecoveryCents,
        refundCents: month.refundCents,
        expenseCents: month.expenseCents,
        netCents: month.netCents,
        cumulativeNetCents: month.cumulativeNetCents,
      })),
      totals: {
        scheduledCents: totals.scheduledCents,
        expectedInCents: totals.expectedCollectionCents + totals.overdueRecoveryCents,
        atRiskCents: totals.atRiskCents,
        refundCents: totals.refundCents,
        expenseCents: totals.expenseCents,
        netCents: totals.netCents,
      },
      overdueOpenCents: cashFlow.overdueOpenCents,
      pendingRefundCents: cashFlow.pendingRefundCents,
      onTimeRateBasisPoints: cashFlow.assumptions.onTimeRateBasisPoints,
      expenseSource: cashFlow.assumptions.expenseSource,
    },
  }
}
