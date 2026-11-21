// Durum rozetinin tonu metinden çıkarılır; Vue `Badge.vue` ile aynı eşleşmeler.
export const BADGE_TONES = ['green', 'red', 'amber', 'purple', 'gray'] as const
export type BadgeTone = (typeof BADGE_TONES)[number]

const GREEN =
  /Ödendi|Yanıtlandı|Onaylandı|Tamamlandı|Değerlendirildi|Kayıt oldu|Çözüldü|Geldi|Aktif|Ulaşıldı/
const RED = /Gecikmiş|Süre aşıldı|Yüksek|Gelmedi|Vazgeçti|Reddedildi/
const AMBER = /Bekliyor|Yaklaşan|Süre azalıyor|İnceleniyor|Teklif|Geç geldi/

export function badgeTone(text: string, tone?: BadgeTone): BadgeTone {
  if (tone) return tone
  if (GREEN.test(text)) return 'green'
  if (RED.test(text)) return 'red'
  if (AMBER.test(text)) return 'amber'
  return 'purple'
}
