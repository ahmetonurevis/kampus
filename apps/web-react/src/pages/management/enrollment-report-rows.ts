// Kayıt Raporları saf hesapları (Vue `Management.vue` `kayit-raporlari`): aday hunisi ve kanal
// bazlı dönüşüm. Girdi sunucunun aşama ve kanal sayımlarıdır (satır çekilmez); oran ve toplam
// saklanmaz, sayımlardan hesaplanır.
import type { CollectionCounts } from '@kampus/react-shared/collections.ts'

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
 * Kanal bazlı dönüşüm: kanal başına aday sayısı, kesin kayıt ve oran. Girdiler sunucunun kanala
 * göre sayımlarıdır: tüm adaylar ve yalnız `Kayıt oldu` aşamasındakiler. Kanalı boş ya da yok olan
 * adaylar tek "Belirtilmemiş" satırında toplanır. Aday sayısı çoktan aza, eşitlikte kanal adıyla
 * sıralanır.
 */
export function sourceRows(
  all: CollectionCounts | undefined,
  enrolled: CollectionCounts | undefined,
): SourceRow[] {
  const nameOf = (value: unknown) =>
    (typeof value === 'string' ? value.trim() : '') || UNKNOWN_SOURCE
  const tally = (counts: CollectionCounts | undefined) => {
    const bySource = new Map<string, number>()
    for (const group of counts?.groups ?? [])
      bySource.set(nameOf(group.value), (bySource.get(nameOf(group.value)) ?? 0) + group.count)
    return bySource
  }
  const total = tally(all)
  const converted = tally(enrolled)
  return [...total]
    .map(([source, count]) => ({
      id: source,
      source,
      count,
      enrolled: converted.get(source) ?? 0,
      ratio: percent(converted.get(source) ?? 0, count),
    }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source, 'tr'))
}

/** Dönem hunisi (ON-052; `GET /prospects/funnel`, DOM-KAY-040): sunucu satırının ekran hâli. */
type FunnelRow = {
  prospects: number
  steps: readonly { step: FunnelStepKey; count: number; rate: number | null }[]
  conversionRate: number | null
}
type FunnelStepKey = 'prospect' | 'meeting' | 'trial' | 'enrolled'

/** Oran metni: sunucu bir ondalıklı yüzde verir; oran yoksa (önceki adım 0) tire. */
export const rateLabel = (rate: number | null) =>
  rate === null ? '—' : `%${rate.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`

export type CounselorRow = {
  id: string
  counselor: string
  prospects: number
  enrolled: number
  conversion: string
}

/** Kesin kayıt adımına ulaşan aday sayısı (son adım `enrolled`). */
const enrolledOf = (row: FunnelRow) =>
  row.steps.find((step) => step.step === 'enrolled')?.count ?? 0

/**
 * Danışman bazlı dönüşüm (DOM-KAY-040): danışman adayı açan personeldir; adı bilinmeyen ya da
 * kurumdan ayrılmış danışman "Belirtilmemiş" satırındadır. Sıra sunucununkidir (aday sayısına
 * göre çoktan aza, bilinmeyen en sonda).
 */
export function counselorRows(
  rows: readonly (FunnelRow & { counselorId: string | null; counselorName: string | null })[],
): CounselorRow[] {
  return rows.map((row, index) => ({
    id: row.counselorId ?? `bilinmeyen-${String(index)}`,
    counselor: row.counselorName ?? UNKNOWN_SOURCE,
    prospects: row.prospects,
    enrolled: enrolledOf(row),
    conversion: rateLabel(row.conversionRate),
  }))
}
