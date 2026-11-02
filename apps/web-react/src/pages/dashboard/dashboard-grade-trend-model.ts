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
/** Sayaç kartı mini grafiğinde gösterilen en çok ay (Vue: son 6 ay). */
export const GRADE_SPARK_MONTHS = 6

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * Aylık not ortalamaları, eskiden yeniye. `YYYY-MM` olmayan grup (tarihsiz not) ve notu olmayan ay
 * girmez. Ortalama `scoreSum / count`, tam sayıya yuvarlanır (core `average` ile aynı).
 * Sayım ucunda `grades` için puanı olanı süzen alan yoktur (`graded` yalnız `submissions`'tadır);
 * `count` puansız notu da içerir ve ortalamayı düşürürdü. Core kayıt şeması puanı zorunlu tutar
 * (`gradeRecordSchema`: puan ya da quiz bağı, quiz notunda puan cevaptan hesaplanıp yazılır), bu
 * yüzden normal yazma yolunda puansız not oluşmaz; yalnız dışarıdan aktarılmış kayıt etkiler.
 * TODO(api-grade-score-count): sayım ucu `grades` için `graded` süzgeci kabul edince eğilim
 * sorgusu `graded=true` ile çağrılır.
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

/**
 * Sayaç kartı mini grafiği (Vue `gradeSpark`): son `SPARK_MONTHS` ayın not ortalaması; eğilim
 * için gereken en az ay yoksa boş (çizilmez).
 */
export function gradeSpark(groups: readonly CollectionCountGroup[]): TrendPoint[] {
  const points = monthlyGradePoints(groups, GRADE_SPARK_MONTHS)
  return hasGradeTrend(points) ? points : []
}
