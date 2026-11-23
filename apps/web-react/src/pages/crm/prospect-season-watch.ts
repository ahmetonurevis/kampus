// Kayıt sezonu nöbeti ekranının saf yardımcıları (DOM-KAY-037, ON-077): pencere seçenekleri,
// takip nedeni etiketleri ve satır notları. Sayılar ve nedenler sunucudan gelir; burada yalnız
// gösterilecek metin türetilir.
import { dateLabel, number } from '@kampus/school-core/lib/format.ts'
import {
  SEASON_FOLLOW_UP_LABELS,
  SEASON_WATCH_DAYS,
  type SeasonFollowUpReason,
} from '@kampus/school-core/lib/prospect-season-watch.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

/** Tanışma Görüşmeleri sayfasındaki görünüm değeri (`?gorunum=nobet`). */
export const SEASON_WATCH_VIEW = 'nobet'
/** Pencere uzunluğu parametresi (`?gun=`). */
export const SEASON_DAYS_PARAM = 'gun'

/** Pencere seçenekleri: bugün, 3 gün, bir hafta (varsayılan), iki hafta (K-175). */
export const SEASON_DAY_OPTIONS = [
  { value: 1, label: 'Yalnız bugün' },
  { value: 3, label: '3 gün' },
  { value: SEASON_WATCH_DAYS.default, label: '7 gün' },
  { value: SEASON_WATCH_DAYS.max, label: '14 gün' },
] as const

/** Adresteki gün sayısı; seçeneklerde olmayan değer varsayılandır (`undefined`). */
export function seasonDays(value: string | null): number | undefined {
  const parsed = Number(value)
  return SEASON_DAY_OPTIONS.some((option) => option.value === parsed) &&
    parsed !== SEASON_WATCH_DAYS.default
    ? parsed
    : undefined
}

export const followUpLabel = (reason: SeasonFollowUpReason) => SEASON_FOLLOW_UP_LABELS[reason]

/** Neden rozetinin tonu: ilk temas ve sonuç bekleyenler kırmızı, soğuyan aday sarı. */
export function followUpTone(reason: SeasonFollowUpReason): BadgeTone {
  switch (reason) {
    case 'first_contact':
    case 'meeting_outcome':
    case 'trial_outcome':
      return 'red'
    case 'stale':
      return 'amber'
    default:
      return reason satisfies never
  }
}

const DAY = { year: 'numeric' } as const

/** "Açılış: 3 Ekim 2026 · 3 gün önce"; dayanağın adı nedene göredir. */
export function followUpSince(row: {
  reason: SeasonFollowUpReason
  sinceDate: string
  days: number
}): string {
  const label = (() => {
    switch (row.reason) {
      case 'first_contact':
        return 'Açılış'
      case 'meeting_outcome':
        return 'Görüşme'
      case 'trial_outcome':
        return 'Deneme dersi'
      case 'stale':
        return 'Son işlem'
      default:
        return row.reason satisfies never
    }
  })()
  const ago = row.days === 0 ? 'bugün' : `${number(row.days)} gün önce`
  return `${label}: ${dateLabel(`${row.sinceDate}T12:00:00.000Z`, DAY)} · ${ago}`
}

/** Deneme sonrası takipte öğretmen sonucunu yazmadıysa uyarı; diğerlerinde not yok. */
export const trialResultNote = (recorded: boolean | null) =>
  recorded === false ? 'Öğretmen sonucu bekleniyor' : null

/** Görüşmenin adı: dil okulunda seviye tespiti görüşmesidir (DOM-KAY-040). */
export const meetingTitle = (type: InstitutionType) =>
  type === 'language_school' ? 'Seviye tespiti görüşmeleri' : 'Tanışma görüşmeleri'

/** Pencerenin açıklaması: "6 Ekim 2026 · bugün" ya da "6 Ekim – 12 Ekim 2026". */
export function windowText(window: { from: string; to: string; days: number }): string {
  const from = dateLabel(`${window.from}T12:00:00.000Z`, DAY)
  if (window.days === 1) return `${from} · yalnız bugün`
  return `${from} – ${dateLabel(`${window.to}T12:00:00.000Z`, DAY)} · ${number(window.days)} gün`
}
