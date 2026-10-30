// Kayıt Raporları saf hesapları (Vue `Management.vue` `kayit-raporlari`): aday hunisi ve kanal
// bazlı dönüşüm. Girdi sunucunun aşama sayımı ve kapsamlı aday kayıtlarıdır; oran ve toplam
// saklanmaz, kayıtlardan hesaplanır.
import type { CollectionCounts } from '@kampus/react-shared/collections.ts'
import type { CoreRow } from '@/hooks/use-core-collection.ts'

/** Aday aşamaları, huni sırasıyla (CRM akışı; `Kayıt oldu` kesin kayıttır). */
export const PROSPECT_STAGES = [
  'Yeni aday',
  'İletişime geçildi',
  'Görüşme planlandı',
  'Teklif verildi',
  'Kayıt oldu',
  'Vazgeçti',
] as const
export const ENROLLED_STAGE = 'Kayıt oldu'
/** Kanalı girilmemiş aday satırı. */
export const UNKNOWN_SOURCE = 'Belirtilmemiş'

export type FunnelStep = {
  stage: string
  count: number
  /** Toplam adaya oranı (0–100, yuvarlanmış); toplam 0 ise 0. */
  share: number
}

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

/**
 * Huni adımları: bilinen aşamalar sırasıyla (sayısı 0 olsa da), ardından kayıtta geçen bilinmeyen
 * aşamalar. Toplam sayımın toplamıdır.
 */
export function funnelSteps(counts: CollectionCounts | undefined): FunnelStep[] {
  const byStage = new Map<string, number>()
  for (const group of counts?.groups ?? [])
    if (typeof group.value === 'string') byStage.set(group.value, group.count)
  const total = counts?.total ?? 0
  const known: readonly string[] = PROSPECT_STAGES
  const extra = [...byStage.keys()].filter((stage) => !known.includes(stage)).sort()
  return [...PROSPECT_STAGES, ...extra].map((stage) => {
    const count = byStage.get(stage) ?? 0
    return { stage, count, share: percent(count, total) }
  })
}

export type SourceRow = {
  id: string
  source: string
  count: number
  enrolled: number
  /** Dönüşüm yüzdesi (kesin kayıt / aday). */
  ratio: number
}

/**
 * Kanal bazlı dönüşüm: kanal başına aday sayısı, kesin kayıt ve oran. Aday sayısı çoktan aza,
 * eşitlikte kanal adıyla sıralanır.
 */
export function sourceRows(prospects: readonly CoreRow<'prospects'>[]): SourceRow[] {
  const bySource = new Map<string, { count: number; enrolled: number }>()
  for (const { record } of prospects) {
    const source = record.source?.trim() || UNKNOWN_SOURCE
    const entry = bySource.get(source) ?? { count: 0, enrolled: 0 }
    entry.count += 1
    if (record.stage === ENROLLED_STAGE) entry.enrolled += 1
    bySource.set(source, entry)
  }
  return [...bySource]
    .map(([source, entry]) => ({
      id: source,
      source,
      count: entry.count,
      enrolled: entry.enrolled,
      ratio: percent(entry.enrolled, entry.count),
    }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source, 'tr'))
}
