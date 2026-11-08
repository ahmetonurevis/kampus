// Yönetim kurulu raporu ekranının saf yardımcıları (DOM-FIN-064, ON-251, ON-329): dönem ve bütçe
// dönemi seçenekleri ve sorgu. Sayılar sunucudan gelir; burada değer türetilip saklanmaz.
import type { FinanceBoardReportQuery } from '@kampus/react-shared/use-finance-board-report.ts'
import { academicYearName } from '@kampus/school-core/lib/academic-years.ts'
import { BUDGET_PERIOD_STATUS_LABELS } from '@kampus/school-core/lib/finance-budget.ts'

/** Finans sayfası içindeki görünüm parametresi değeri (`FinancePage` `VIEWS`). */
export const BOARD_REPORT_VIEW = 'kurul-raporu'

/** Dönem seçimi: eğitim yılının tamamı, yılın bir dönemi ya da elle tarih aralığı. */
export const WHOLE_YEAR = 'yil'
export const CUSTOM_RANGE = 'aralik'
const TERM_PREFIX = 'donem:'

export const YEARS_BACK = 5

/** Etkin yıldan geriye beş eğitim yılı, yeniden eskiye. */
export function boardYearOptions(activeYear: number): { value: number; label: string }[] {
  return Array.from({ length: YEARS_BACK }, (_, index) => activeYear - index).map((year) => ({
    value: year,
    label: academicYearName(year),
  }))
}

export function periodOptions(
  terms: readonly { id: string; name: string }[],
): { value: string; label: string }[] {
  return [
    { value: WHOLE_YEAR, label: 'Eğitim yılının tamamı' },
    ...terms.map((term) => ({ value: `${TERM_PREFIX}${term.id}`, label: `Dönem: ${term.name}` })),
    { value: CUSTOM_RANGE, label: 'Tarih aralığı' },
  ]
}

/** Bütçe dönemi seçimi: boş değer rapor dönemine uyan dönemdir (K-113). */
export const MATCHED_BUDGET_PERIOD = ''

/**
 * Seçimden API sorgusu; elle aralıkta iki gün de girilmeden `null` (istek atılmaz). Ters ya da uzun
 * aralığı sunucu reddeder (422), ekran mesajı gösterir.
 */
export function boardReportQuery(
  year: number,
  selection: string,
  range: { from: string; to: string },
  budgetPeriodId: string = MATCHED_BUDGET_PERIOD,
): FinanceBoardReportQuery | null {
  const budget = budgetPeriodId === MATCHED_BUDGET_PERIOD ? {} : { budgetPeriodId }
  if (selection === CUSTOM_RANGE)
    return range.from !== '' && range.to !== ''
      ? { year, from: range.from, to: range.to, ...budget }
      : null
  if (selection.startsWith(TERM_PREFIX))
    return { year, termId: selection.slice(TERM_PREFIX.length), ...budget }
  return { year, ...budget }
}

export function budgetPeriodOptions(
  periods: readonly {
    id: string
    name: string
    status: keyof typeof BUDGET_PERIOD_STATUS_LABELS
  }[],
): { value: string; label: string }[] {
  return [
    { value: MATCHED_BUDGET_PERIOD, label: 'Otomatik (döneme göre)' },
    ...periods.map((period) => ({
      value: period.id,
      label: `${period.name} (${BUDGET_PERIOD_STATUS_LABELS[period.status]})`,
    })),
  ]
}
