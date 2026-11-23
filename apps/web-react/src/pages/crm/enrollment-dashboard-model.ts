// Genel Bakış ön büro aday kartlarının saf hesapları (Vue `Dashboard.vue` ön büro kartları:
// "Bugünkü tanışma görüşmesi", "Görüşme bekleyen aday", "Toplam kesin kayıt"). Sayılar sunucu
// sayımından gelir; burada yalnız sorgu ve oran türetilir, değer saklanmaz.
import { OPEN_PROSPECT_STAGES } from '@kampus/school-core/lib/prospects.ts'
import type { CollectionCountsQuery } from '@kampus/react-shared/collections.ts'

export const ENROLLED_STAGE = 'Kayıt oldu'
export const NEW_STAGE = 'Yeni aday'

type StageCount = { stage: string | null; count: number }

/** Aşamanın aday sayısı; aşama yoksa 0. */
export const stageCount = (stages: readonly StageCount[], name: string) =>
  stages.find((item) => item.stage === name)?.count ?? 0

/**
 * Bugünkü tanışma görüşmeleri: görüşme anı (`trialAt`) bugüne (Europe/Istanbul) düşen açık
 * adaylar. Kapalı (kayıt olmuş ya da vazgeçmiş) adayın görüşmesi Tanışma Görüşmeleri listesinde
 * olmadığı için burada da sayılmaz (DOM-KAY-033). Deneme dersi (`trialLesson`) ayrı olaydır,
 * sayılmaz (Vue kartı da yalnız görüşmeyi sayar).
 */
export function todayMeetingsQuery(today: string): CollectionCountsQuery {
  return {
    groupBy: 'stage',
    filters: {
      stage: [...OPEN_PROSPECT_STAGES],
      dateField: 'trialAt',
      dateFrom: today,
      dateTo: today,
    },
  }
}

/**
 * Kesin kayıt dönüşüm oranı: kesin kayıt olan aday / bütün adaylar, yüzde, tam sayıya yuvarlanır;
 * aday yoksa `null` (oran yazılmaz).
 */
export function enrollmentRate(stages: readonly StageCount[], total: number): number | null {
  if (total <= 0) return null
  return Math.round((stageCount(stages, ENROLLED_STAGE) / total) * 100)
}
