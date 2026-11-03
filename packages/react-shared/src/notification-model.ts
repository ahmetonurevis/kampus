// Bildirim merkezi saf modeli (IST-065, DOM-ILT-020): rozet metni, erişilebilir ad, bildirim alan
// roller ve konudan rolün sayfasına yol. Web zili ve mobil bildirim ekranı ortak kullanır; liste,
// sayı ve okundu sunucudadır (`use-notifications.ts`). Sayfanın menüde açık olup olmadığı
// istemcinin işidir (web `lib/navigation.ts`, mobil `api/pages.ts`).
import type { NotificationView } from './use-notifications.ts'

type Topic = NotificationView['topic']

/** Rozet bu sayıdan büyükse "99+" yazar. */
export const BADGE_MAX = 99

/** Bildirim merkezi modülü (API ucu ve menü ile aynı anahtar). */
export const NOTIFICATION_MODULE = 'communication'

/**
 * Bildirim alan roller: alıcı kitlesi öğrenci ve veli (core `NOTIFICATION_AUDIENCES`); personelin
 * listesi boştur. Personel rolleri eklenince bu liste genişler.
 */
export const NOTIFICATION_RECIPIENT_ROLES: readonly string[] = ['ogrenci', 'veli']

/** Rozet metni: 0 ve bilinmeyen sayıda rozet yok (`null`), 99'un üstünde "99+". */
export function unreadBadgeText(count: number | undefined): string | null {
  if (!count || count < 1) return null
  return count > BADGE_MAX ? `${BADGE_MAX}+` : String(count)
}

/** Zilin erişilebilir adı: "Bildirimler, 3 okunmamış"; okunmamış yoksa yalnız "Bildirimler". */
export function bellLabel(count: number | undefined): string {
  if (!count || count < 1) return 'Bildirimler'
  return count > BADGE_MAX
    ? `Bildirimler, ${BADGE_MAX}'dan fazla okunmamış`
    : `Bildirimler, ${count} okunmamış`
}

/**
 * Konu ve role göre hedef sayfanın ortak menü yolu. Kayıtta serbest hedef yoktur (yalnız konu
 * kaydının kimliği), bu yüzden bildirim ilgili listenin sayfasına gider; bağlanamayan konu
 * (ör. kayıt) için yol yoktur.
 */
const TOPIC_PAGES: Readonly<Record<string, Readonly<Partial<Record<Topic, string>>>>> = {
  ogrenci: {
    homework: 'odevler',
    grade: 'notlarim',
    attendance: 'devamsizlik',
    message: 'mesajlar',
    announcement: 'duyurular',
    appointment: 'randevu-talep',
  },
  veli: {
    homework: 'akademik-takip',
    grade: 'akademik-takip',
    attendance: 'akademik-takip',
    message: 'randevu-mesaj',
    announcement: 'duyurular',
    appointment: 'randevu-mesaj',
  },
}

export function notificationTopicPath(role: string, topic: Topic): string | null {
  return TOPIC_PAGES[role]?.[topic] ?? null
}
