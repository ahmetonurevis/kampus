// Pano finans kartlarının saf gösterim hesapları (IST-116). Tutarlar sunucunun finans özetinden
// (`GET /finance/overview`) gelir; burada yalnız etiket ve mini grafik noktası türetilir.
import { number } from '@kampus/school-core/lib/format.ts'
import { monthLabel, type TrendPoint } from '../dashboard/dashboard-model.ts'

/**
 * Vade ayına göre gecikmiş tutar serisi (kuruş). Hiç gecikme yoksa boştur: kayıt olmadan grafik
 * çizilmez.
 */
export function overdueTrendPoints(
  months: readonly { month: string; overdueCents: number }[],
): TrendPoint[] {
  if (!months.some((month) => month.overdueCents > 0)) return []
  return months.map((month) => ({ label: monthLabel(month.month), value: month.overdueCents }))
}

/** Gecikmiş kartının notu: borçlu öğrenci sayısı. */
export function overdueStudentsNote(students: number): string {
  return students > 0 ? `${number(students)} öğrencide gecikmiş borç` : 'Gecikmiş borç bulunmuyor'
}
