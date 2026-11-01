import type { KampusClient } from '@kampus/api-client/client.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import type { CommandHeaders } from './commands.ts'
import { notificationListKey, notificationsPrefix, unreadNotificationsKey } from './query-keys.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiMutation } from './use-api-mutation.ts'
import { useApiQuery } from './use-api-query.ts'

/**
 * Uygulama içi bildirim merkezi kancaları (F6a): sayfalı liste, okunmamış sayısı, tekil ve toplu
 * okundu (`/notifications`; core `lib/notifications.ts`, docs/domain/iletisim-ve-veli.md
 * DOM-ILT-020, -023, -073). Alıcı kapsamı ve okundu bilgisi sunucudadır; okundu kullanıcıya
 * özeldir. Bildirim başlığı sunucuda şablondan üretilir, burada metin kurulmaz.
 */

type ListResponse = operations['listNotifications']['responses'][200]['content']['application/json']

export type NotificationPage = ListResponse
export type NotificationView = ListResponse['data'][number]
export type NotificationKind = NotificationView['kind']

/** Liste sayfa boyutu varsayılanı (API `pageSize` ≤ 100). */
export const NOTIFICATION_PAGE_SIZE = 25
/** Okunmamış sayısının açık ekranda tazelenme aralığı; anlık bildirim (push) kapsam dışıdır. */
export const UNREAD_NOTIFICATIONS_REFRESH_MS = 60_000

export interface NotificationQuery {
  page?: number
  pageSize?: number
  /** `true`: yalnız okunmamış bildirimler. */
  unreadOnly?: boolean
}

function normalized(query: NotificationQuery) {
  return {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? NOTIFICATION_PAGE_SIZE,
    unread: query.unreadOnly ?? false,
  }
}

export function listNotificationsRequest(
  client: KampusClient,
  query: NotificationQuery,
  signal?: AbortSignal,
) {
  const { page, pageSize, unread } = normalized(query)
  return client.GET('/api/v1/notifications', {
    params: { query: { page, pageSize, unread: unread ? 'true' : 'false' } },
    ...(signal ? { signal } : {}),
  })
}

export function unreadNotificationCountRequest(client: KampusClient, signal?: AbortSignal) {
  return client.GET('/api/v1/notifications/unread-count', { ...(signal ? { signal } : {}) })
}

/** Okundu işareti gövdesiz komuttur; `If-Match` kabul edilmez, tekrar çağrı ilk anı korur. */
export function readNotificationRequest(client: KampusClient, notificationId: string) {
  return client.POST('/api/v1/notifications/{notificationId}/read', {
    params: { path: { notificationId } },
    body: {},
  })
}

/** Toplu okundu: kullanıcı eylemidir, istek anahtarı taşır; `If-Match` yoktur. */
export function readAllNotificationsRequest(
  client: KampusClient,
  _input: void,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/notifications/read-all', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body: {},
  })
}

/** Oturum sahibinin bildirimleri, en yeni önce; yanıt `data` ve sayfa bilgisi (`meta`) taşır. */
export function useNotifications(
  query: NotificationQuery = {},
  options: { enabled?: boolean } = {},
) {
  const normal = normalized(query)
  return useApiQuery({
    key: notificationListKey(normal),
    request: (client, signal) => listNotificationsRequest(client, query, signal),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  })
}

/** Okunmamış bildirim sayısı (rozet); açık ekranda dakikada bir tazelenir. */
export function useUnreadNotificationCount(options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: unreadNotificationsKey(),
    request: unreadNotificationCountRequest,
    refetchInterval: UNREAD_NOTIFICATIONS_REFRESH_MS,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  })
}

/**
 * Bildirim açılınca okundu yazar. Arka plan işlemidir; hata toast göstermez (kullanıcı eylemi
 * değildir). Liste ve sayı birlikte tazelenir.
 */
export function useReadNotification() {
  return useApiMutation({
    request: readNotificationRequest,
    invalidates: [notificationsPrefix()],
  })
}

/** "Tümünü okundu işaretle": görülen bütün okunmamışlar; liste ve sayı tazelenir. */
export function useReadAllNotifications(options: { onSuccess?: () => void | Promise<void> } = {}) {
  return useApiCommand({
    request: readAllNotificationsRequest,
    invalidates: [notificationsPrefix()],
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}
