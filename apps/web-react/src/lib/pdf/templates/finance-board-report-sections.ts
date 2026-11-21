// Yönetim kurulu raporunun bütçe, maliyet ve tahmin bölümleri (DOM-FIN-064, ON-329). Rakamlar API
// raporundan gelir, burada yeniden hesaplanmaz; kişi adı yoktur. Yönetici bölümleri PDF'e tek tek
// ekleyip çıkarabilir.
import type { FinanceBoardReport } from '@kampus/react-shared/use-finance-board-report.ts'
import { academicYearName } from '@kampus/school-core/lib/academic-years.ts'
import {
  BUDGET_ITEM_KIND_LABELS,
  BUDGET_PERIOD_STATUS_LABELS,
} from '@kampus/school-core/lib/finance-budget.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import type { DocumentLayout } from '../layout.ts'

/** PDF'e girebilecek isteğe bağlı bölümler. */
export const BOARD_REPORT_SECTIONS = [
  { key: 'budget', label: 'Bütçe–gerçekleşen' },
  { key: 'costs', label: 'Kampüs ve öğrenci başı maliyet' },
  { key: 'forecast', label: 'Gelir ve nakit akışı tahmini' },
] as const
export type BoardReportSectionKey = (typeof BOARD_REPORT_SECTIONS)[number]['key']
export type BoardReportSections = Record<BoardReportSectionKey, boolean>
export const ALL_BOARD_REPORT_SECTIONS: BoardReportSections = {
  budget: true,
  costs: true,
  forecast: true,
}

export const NO_BUDGET_PERIOD = 'Rapor dönemine uyan bütçe dönemi yok.'
export const NO_EXPENSE_DATA = 'Veri yok'
export const NO_EXPENSE_DATA_NOTE =
  'Gider gerçekleşeni verisi yok (gider kaydı tutulmuyor); gider ve net gerçekleşen boş kalır.'

/** Bölümlerin okuduğu yanıt alanları. */
export type BoardReportSectionData = Pick<
  FinanceBoardReport,
  'budgetPeriod' | 'budget' | 'costs' | 'forecast'
>

const dayLabel = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const monthFormatter = new Intl.DateTimeFormat('tr-TR', {
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/Istanbul',
})
/** `2026-09` → `Eyl 2026`. */
export const boardMonthLabel = (month: string) =>
  monthFormatter.format(new Date(`${month}-15T09:00:00.000Z`))

/** On binde bir oranın yüzde gösterimi (`10333` → `%103,33`); yoksa tire. */
export const basisPointsLabel = (points: number | null) =>
  points === null ? '—' : `%${(points / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`

/** Bütçe döneminin adı, durumu ve günleri; rapor dönemine göre bulunduysa belirtilir. */
export function budgetPeriodLabel(period: NonNullable<FinanceBoardReport['budgetPeriod']>): string {
  const how = period.selection === 'matched' ? ' · rapor dönemine göre seçildi' : ''
  return `${period.name} (${BUDGET_PERIOD_STATUS_LABELS[period.status]}) · ${dayLabel(period.startDate)} – ${dayLabel(period.endDate)}${how}`
}

const optional = (cents: number | null, empty = '—') => (cents === null ? empty : money(cents))

const BUDGET_COLUMNS = [
  { header: 'Tür', width: 34 },
  { header: 'Dönem planı', width: 36 },
  { header: 'Bugüne kadar plan', width: 36 },
  { header: 'Gerçekleşen', width: 36 },
  { header: 'Gerçekleşme', width: 32 },
] as const
const VARIANCE_COLUMNS = [
  { header: 'Kalem', width: 60 },
  { header: 'Karşılaştırılan plan', width: 36 },
  { header: 'Gerçekleşen', width: 30 },
  { header: 'Sapma', width: 28 },
  { header: 'Oran', width: 20 },
] as const
const CAMPUS_COLUMNS = [
  { header: 'Kampüs', width: 40 },
  { header: 'Kişi', width: 16 },
  { header: 'Tahakkuk', width: 30 },
  { header: 'Net tahsilat', width: 30 },
  { header: 'Bütçe gideri', width: 30 },
  { header: 'Kişi başı maliyet', width: 28 },
] as const
const CASH_COLUMNS = [
  { header: 'Ay', width: 30 },
  { header: 'Beklenen tahsilat', width: 36 },
  { header: 'İade', width: 30 },
  { header: 'Net', width: 38 },
  { header: 'Birikimli net', width: 40 },
] as const

function budgetSection(doc: DocumentLayout, report: BoardReportSectionData) {
  doc.section('Bütçe–gerçekleşen')
  const { budget, budgetPeriod } = report
  if (budgetPeriod === null || budget === null) {
    doc.paragraph(NO_BUDGET_PERIOD)
    return
  }
  doc.paragraph(budgetPeriodLabel(budgetPeriod), 9)
  if (budget.asOfDate === null) {
    doc.paragraph('Bütçe dönemi henüz başlamadı; gerçekleşen yok.')
    return
  }
  doc.paragraph(
    `Tahakkuk esası; hareketler ${dayLabel(budget.asOfDate)} gününe kadar sayıldı. Gerçekleşme oranı dönem planına göredir.`,
    9,
  )
  const expenseActual = (cents: number | null) =>
    budget.expenseData === 'none' ? NO_EXPENSE_DATA : optional(cents)
  doc.table(
    BUDGET_COLUMNS,
    [
      [
        'Gelir',
        money(budget.income.plannedCents),
        optional(budget.income.plannedToDateCents),
        optional(budget.income.actualCents),
        basisPointsLabel(budget.income.realizationBasisPoints),
      ],
      [
        'Gider',
        money(budget.expense.plannedCents),
        optional(budget.expense.plannedToDateCents),
        expenseActual(budget.expense.actualCents),
        basisPointsLabel(budget.expense.realizationBasisPoints),
      ],
      [
        'Net (gelir − gider)',
        money(budget.net.plannedCents),
        '',
        budget.expenseData === 'none' ? NO_EXPENSE_DATA : optional(budget.net.actualCents),
        '',
      ],
    ],
    true,
  )
  if (budget.expenseData === 'none') doc.paragraph(NO_EXPENSE_DATA_NOTE, 9)
  if (budget.income.unmatchedCents !== null && budget.income.unmatchedCents !== 0)
    doc.paragraph(`Bütçe kalemine eşlenmemiş gelir: ${money(budget.income.unmatchedCents)}.`, 9)
  if (budget.topVariances.length === 0) {
    doc.paragraph('Plandan sapan kalem yok.', 9)
    return
  }
  doc.paragraph('En çok sapan kalemler (merkezler toplanmıştır):', 9)
  doc.table(
    VARIANCE_COLUMNS,
    budget.topVariances.map((item) => [
      `${item.itemCode} ${item.itemName} (${BUDGET_ITEM_KIND_LABELS[item.itemKind]})`,
      `${money(item.comparedTo === 'to_date' ? (item.plannedToDateCents ?? 0) : item.plannedCents)} ${item.comparedTo === 'to_date' ? '(bugüne kadar)' : '(dönem)'}`,
      money(item.actualCents),
      money(item.varianceCents),
      basisPointsLabel(item.realizationBasisPoints),
    ]),
    true,
  )
}

function costSection(doc: DocumentLayout, report: BoardReportSectionData, learnerNoun: string) {
  doc.section('Kampüs ve öğrenci başı maliyet')
  const { costs, budgetPeriod } = report
  if (budgetPeriod === null || costs === null) {
    doc.paragraph(NO_BUDGET_PERIOD)
    return
  }
  doc.paragraph(
    `${dayLabel(costs.from)} – ${dayLabel(costs.to)} bütçe dönemi; maliyet bütçe gideridir (ortak gider payı dahil).`,
    9,
  )
  const hidden = `Gizli (<${String(costs.minGroupSize)})`
  const amount = (cents: number | null) => (cents === null ? hidden : money(cents))
  const perStudent = (row: { budgetExpensePerStudentCents: number | null; suppressed: boolean }) =>
    row.suppressed ? hidden : optional(row.budgetExpensePerStudentCents)
  doc.table(
    CAMPUS_COLUMNS,
    [
      ...costs.campuses.map((row) => [
        row.name,
        row.studentCount === null ? hidden : String(row.studentCount),
        amount(row.accruedCents),
        amount(row.netCollectedCents),
        amount(row.budgetExpenseCents),
        perStudent(row),
      ]),
      [
        'Toplam',
        String(costs.totals.studentCount),
        money(costs.totals.accruedCents),
        money(costs.totals.netCollectedCents),
        money(costs.totals.budgetExpenseCents),
        perStudent(costs.totals),
      ],
    ],
    true,
  )
  doc.paragraph(
    `${String(costs.minGroupSize)} ${learnerNoun}den az olan kampüsün sayısı ve tutarları gizlenir; gizli kampüs toplamdan bulunabileceği için en küçük ikinci kampüs de, gerekirse bütün kampüsler gizlenir. Toplam kurum genelidir.`,
    9,
  )
  if (costs.campuses.length > 0 && costs.campuses.every((row) => row.suppressed))
    doc.paragraph(
      `Bu dönemde kampüs kırılımı ${String(costs.minGroupSize)} kişiden az kişi içerdiği için tamamen gizlidir.`,
      9,
    )
}

const PIPELINE_NOTES = {
  included: null,
  crm_disabled: 'Kayıt modülü kapalı; aday beklentisi tahmine girmedi.',
  past_year: 'Tahmin yılı için aday beklentisi hesaplanmadı.',
} as const

function forecastSection(doc: DocumentLayout, report: BoardReportSectionData) {
  const { revenue, cashFlow, today } = report.forecast
  doc.section('Gelir ve nakit akışı tahmini')
  doc.paragraph(
    `${dayLabel(today)} itibarıyla tahmindir; rapor döneminden bağımsızdır, gerçekleşen değildir.`,
    9,
  )
  doc.fields([
    [`${academicYearName(revenue.year)} kesin gelir`, money(revenue.committedCents)],
    [
      'Yeni kayıt / yenileme',
      `${money(revenue.newEnrollmentCents)} / ${money(revenue.renewalCents)}`,
    ],
    ['Aday beklentisi (net)', optional(revenue.pipelineNetCents)],
    ['Beklenen toplam gelir', money(revenue.expectedTotalCents)],
  ])
  const note = PIPELINE_NOTES[revenue.pipelineStatus]
  if (note !== null) doc.paragraph(note, 9)
  doc.paragraph(
    `Nakit akışı ${boardMonthLabel(cashFlow.from.slice(0, 7))} – ${boardMonthLabel(cashFlow.to.slice(0, 7))}; vadesinde tahsil oranı ${basisPointsLabel(cashFlow.onTimeRateBasisPoints)}. Gider ${cashFlow.expenseSource === 'none' ? 'verisi yok, nete girmedi' : 'elle girildi'}.`,
    9,
  )
  doc.table(
    CASH_COLUMNS,
    [
      ...cashFlow.months.map((month) => [
        boardMonthLabel(month.month),
        money(month.expectedInCents),
        money(month.refundCents),
        money(month.netCents),
        money(month.cumulativeNetCents),
      ]),
      [
        'Toplam',
        money(cashFlow.totals.expectedInCents),
        money(cashFlow.totals.refundCents),
        money(cashFlow.totals.netCents),
        '',
      ],
    ],
    true,
  )
  doc.paragraph(
    `Planlanan tahsilat ${money(cashFlow.totals.scheduledCents)}, gecikme riski ${money(cashFlow.totals.atRiskCents)}; bugün gecikmiş açık tutar ${money(cashFlow.overdueOpenCents)}, ödenmemiş iade ${money(cashFlow.pendingRefundCents)}.`,
    9,
  )
}

/** Seçilen bölümleri sırayla yazar: bütçe–gerçekleşen, maliyet, tahmin. */
export function writeBoardReportSections(
  doc: DocumentLayout,
  report: BoardReportSectionData,
  sections: BoardReportSections,
  learnerNoun: string,
) {
  if (sections.budget) budgetSection(doc, report)
  if (sections.costs) costSection(doc, report, learnerNoun)
  if (sections.forecast) forecastSection(doc, report)
}
