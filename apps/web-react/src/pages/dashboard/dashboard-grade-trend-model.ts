// Genel Bakış not ortalaması eğilim grafiğinin saf hesabı (Vue `academicSeries`). Girdi notlar
// listesinin aylık sayımıdır (`GET /collections/grades/counts?groupBy=date:month&sum=score`):
// ay başına not sayısı ve puan toplamı sunucuda, rolün not kapsamında hesaplanır; web not
// satırlarını çekmez. Ortalama kayıtlardan her okumada hesaplanır, saklanmaz.
import type { CollectionCountGroup } from '@kampus/react-shared/collections.ts'
import { monthLabel, type TrendPoint } from './dashboard-model.ts'

/** Grafikte gösterilen en çok ay (en son aylar). */
export const GRADE_TREND_MONTHS = 6
/** Eğilim için gereken en az ay sayısı; daha azında grafik yerine kısa metin gösterilir. */
export const MIN_TREND_MONTHS = 2

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * Aylık not ortalamaları, eskiden yeniye. `YYYY-MM` olmayan grup (tarihsiz not) ve notu olmayan ay
 * girmez. Ortalama `scoreSum / count`, tam sayıya yuvarlanır (core `average` ile aynı).
 */
export function monthlyGradePoints(
  groups: readonly CollectionCountGroup[],
  months = GRADE_TREND_MONTHS,
): TrendPoint[] {
  return groups
    .flatMap((group) =>
      typeof group.value === 'string' && MONTH.test(group.value) && group.count > 0
        ? [{ month: group.value, average: Math.round((group.sum ?? 0) / group.count) }]
        : [],
    )
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-months)
    .map((item) => ({ label: monthLabel(item.month), value: item.average }))
}

/**
 * Eğilim bölümü yükleniyor mu. Sayım sorgusu `keepPreviousData` kullanır: öğrenci (çocuk) süzgeci
 * değişince yeni sayım gelene kadar önceki öğrencinin sayımı `isPlaceholderData` ile döner. Başka
 * öğrencinin notları yeni öğrencinin başlığı altında gösterilmez (gizlilik); bu durumda bölüm
 * yükleniyor sayılır.
 */
export function gradeTrendPending(
  state: { isPending: boolean },
  counts: { isPending: boolean; isPlaceholderData: boolean },
): boolean {
  return state.isPending || counts.isPending || counts.isPlaceholderData
}

/** Eğilim çizilebilir mi: en az `MIN_TREND_MONTHS` ay. */
export const hasGradeTrend = (points: readonly TrendPoint[]) => points.length >= MIN_TREND_MONTHS

/** Grafiğin metin özeti: ilk ve son ay, değişim ve en yüksek ay. */
export function gradeTrendSummary(points: readonly TrendPoint[], subject: string): string {
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last) return ''
  const best = points.reduce((top, point) => (point.value > top.value ? point : top), first)
  const delta = last.value - first.value
  const change =
    delta === 0 ? 'değişmedi' : delta > 0 ? `${delta} puan arttı` : `${-delta} puan azaldı`
  return (
    `${subject} ${first.label} ayında ${first.value}, ${last.label} ayında ${last.value} ` +
    `(${change}). En yüksek ay: ${best.label} (${best.value}).`
  )
}
