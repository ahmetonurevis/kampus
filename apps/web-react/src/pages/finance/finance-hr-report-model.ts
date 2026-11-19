import type { HrReportQuery } from '@kampus/react-shared/use-finance-hr-reports.ts'
import {
  monthOf,
  staffCostMonthSchema,
  staffCostRangeIssue,
} from '@kampus/school-core/lib/finance-staff-costs.ts'

// İK raporları sekmesinin dönem seçimi (DOM-FIN-117; ON-192).

/** Ay alanları geçerliyse sorgu, değilse kullanıcı mesajı. */
export function hrReportQueryOf(
  from: string,
  to: string,
): { query: HrReportQuery } | { issue: string } {
  if (!staffCostMonthSchema.safeParse(from).success || !staffCostMonthSchema.safeParse(to).success)
    return { issue: 'Başlangıç ve bitiş ayını seçin.' }
  const issue = staffCostRangeIssue(from, to)
  if (issue !== null) return { issue }
  return { query: { from, to } }
}

/** Varsayılan dönem: yılın başından bu aya. */
export function defaultHrRange(today: string): { from: string; to: string } {
  const to = monthOf(today)
  return { from: `${to.slice(0, 4)}-01`, to }
}
