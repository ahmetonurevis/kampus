// Bildirim zili modeli (IST-065, DOM-ILT-020): rozet biçimi, erişilebilir ad, zilin görünürlüğü
// ve bildirimin hedef sayfası. Saf işlevlerdir; liste, sayı ve okundu sunucudadır
// (`@kampus/react-shared/use-notifications.ts`).
import type { NotificationView } from '@kampus/react-shared/use-notifications.ts'
import {
  findPage,
  isPageEnabled,
  pageHref,
  type ModuleState,
  type RoleKey,
} from '../lib/navigation.ts'

/** Rozet bu sayıdan büyükse "99+" yazar. */
export const BADGE_MAX = 99

/** Bildirim merkezi modülü (API ucu ve menü ile aynı anahtar). */
export const NOTIFICATION_MODULE = 'communication'

/**
 * Bildirim alan roller: alıcı kitlesi öğrenci ve veli (core `NOTIFICATION_AUDIENCES`); personelin
 * listesi boştur. Personel rolleri eklenince bu liste genişler.
 */
export const NOTIFICATION_RECIPIENT_ROLES: readonly RoleKey[] = ['ogrenci', 'veli']

/** Zil yalnız bildirim alan rolde ve bildirim merkezi modülü açıkken görünür. */
export function notificationBellVisible(role: RoleKey, modules: ModuleState): boolean {
  return NOTIFICATION_RECIPIENT_ROLES.includes(role) && modules[NOTIFICATION_MODULE] === true
}

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
 * Konu ve role göre hedef sayfa yolu. Kayıtta serbest hedef yoktur (yalnız konu kaydının kimliği),
 * bu yüzden bildirim ilgili listenin sayfasına gider; bağlanamayan konu (ör. kayıt) `null`.
 */
const TOPIC_PAGES: Partial<Record<RoleKey, Partial<Record<NotificationView['topic'], string>>>> = {
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

/** Bildirimin gideceği sayfa; menüde yoksa ya da modülü kapalıysa `null` (yalnız okundu). */
export function notificationHref(
  role: RoleKey,
  topic: NotificationView['topic'],
  modules: ModuleState,
): string | null {
  const path = TOPIC_PAGES[role]?.[topic]
  if (!path) return null
  const page = findPage(role, path)
  return page && isPageEnabled(page, modules) ? pageHref(role, page) : null
}

export type NotificationAction = {
  /** Satıra basınca okundu yazılsın mı (zaten okunmuşsa yazılmaz). */
  markRead: boolean
  href: string | null
}

export function notificationAction(
  role: RoleKey,
  item: Pick<NotificationView, 'topic' | 'readAt'>,
  modules: ModuleState,
): NotificationAction {
  return { markRead: item.readAt === null, href: notificationHref(role, item.topic, modules) }
}

const STAMP = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const STAMP_WITH_YEAR = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const YEAR = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Istanbul', year: 'numeric' })

/** "2 Kas 14:05"; başka bir yıldan ise yıl da yazılır. Geçersiz değer "—". */
export function notificationTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const sameYear = YEAR.format(date) === YEAR.format(now)
  return (sameYear ? STAMP : STAMP_WITH_YEAR).format(date)
}
