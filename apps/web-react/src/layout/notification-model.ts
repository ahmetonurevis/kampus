// Bildirim zili modeli (IST-065, DOM-ILT-020): zilin görünürlüğü ve bildirimin hedef sayfası.
// Rozet, erişilebilir ad ve konu → sayfa tablosu mobille ortaktır
// (`@kampus/react-shared/notification-model.ts`). Saf işlevlerdir; liste, sayı ve okundu sunucudadır
// (`@kampus/react-shared/use-notifications.ts`).
import {
  NOTIFICATION_MODULE,
  NOTIFICATION_RECIPIENT_ROLES,
  notificationTopicPath,
} from '@kampus/react-shared/notification-model.ts'
import type { NotificationView } from '@kampus/react-shared/use-notifications.ts'
import {
  findPage,
  isPageEnabled,
  pageHref,
  type ModuleState,
  type RoleKey,
} from '../lib/navigation.ts'

export {
  BADGE_MAX,
  NOTIFICATION_MODULE,
  NOTIFICATION_RECIPIENT_ROLES,
  bellLabel,
  unreadBadgeText,
} from '@kampus/react-shared/notification-model.ts'

/** Zil yalnız bildirim alan rolde ve bildirim merkezi modülü açıkken görünür. */
export function notificationBellVisible(role: RoleKey, modules: ModuleState): boolean {
  return NOTIFICATION_RECIPIENT_ROLES.includes(role) && modules[NOTIFICATION_MODULE] === true
}

/** Bildirimin gideceği sayfa; menüde yoksa ya da modülü kapalıysa `null` (yalnız okundu). */
export function notificationHref(
  role: RoleKey,
  topic: NotificationView['topic'],
  modules: ModuleState,
): string | null {
  const path = notificationTopicPath(role, topic)
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
