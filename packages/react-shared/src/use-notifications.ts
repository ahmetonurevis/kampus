import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'

import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import type { CommandHeaders } from './commands.ts'
import { useKampusClient } from './kampus-context.ts'
import {
  institutionKey,
  notificationListKey,
  notificationsPrefix,
  unreadNotificationsKey,
} from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiMutation } from './use-api-mutation.ts'
import { useApiQuery } from './use-api-query.ts'

/**
 * Uygulama içi bildirim merkezi kancaları (F6a): imleçli liste, okunmamış sayısı, tekil ve toplu
 * okundu (`/notifications`; core `lib/notifications.ts`, docs/domain/iletisim-ve-veli.md
 * DOM-ILT-020, -023, -073). Alıcı kapsamı ve okundu bilgisi sunucudadır; okundu kullanıcıya
 * özeldir. Bildirim başlığı sunucuda şablondan üretilir, burada metin kurulmaz.
 */

type ListResponse = operations['listNotifications']['responses'][200]['content']['application/json']

export type NotificationPage = ListResponse
export type NotificationView = ListResponse['data'][number]
export type NotificationKind = NotificationView['kind']

/** Bir sayfadaki bildirim sayısı (API `limit` ≤ 100); daha eskiler istek üzerine gelir. */
export const NOTIFICATION_PAGE_SIZE = 25
/**
 * Okunmamış sayısının açık ekrandaki yedek tazeleme aralığı (5 dk). Sayım ve liste
 * `records_notifications_idx` indeksinden gelir, yine de yüzlerce açık
 * ekranın dakikada bir sorgusu yerine sayı, sekme odağa döndüğünde bayatsa
 * (`DEFAULT_STALE_TIME_MS`) TanStack'in odak tazelemesiyle ve okundu işaretinde yenilenir. Anlık
 * bildirim (push) kapsam dışıdır.
 */
export const UNREAD_NOTIFICATIONS_REFRESH_MS = 5 * 60_000

export interface NotificationQuery {
  /** Önceki sayfanın `meta.nextCursor` değeri; yoksa en yeni bildirimler. */
  cursor?: string | undefined
  limit?: number
  /** `true`: yalnız okunmamış bildirimler. */
  unreadOnly?: boolean
}

export function listNotificationsRequest(
  client: KampusClient,
  query: NotificationQuery,
  signal?: AbortSignal,
) {
  return client.GET('/api/v1/notifications', {
    params: {
      query: {
        limit: query.limit ?? NOTIFICATION_PAGE_SIZE,
        unread: query.unreadOnly === true ? 'true' : 'false',
        ...(query.cursor ? { cursor: query.cursor } : {}),
      },
    },
    ...(signal ? { signal } : {}),
  })
}

/** Sayfalar en yeniden geriye gelir ve her sayfa kendi içinde en yeni öncedir: tek akışa dizilir. */
export function flattenNotificationPages(
  pages: readonly { data: readonly NotificationView[] }[] | undefined,
): NotificationView[] {
  if (!pages) return []
  const seen = new Set<string>()
  // Sayfalar arasında yeni bildirim gelirse aynı kayıt iki sayfada görünmesin.
  return pages
    .flatMap((page) => page.data)
    .filter((item) => !seen.has(item.id) && seen.add(item.id))
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

/**
 * Oturum sahibinin bildirimleri (`GET /notifications`), en yeni önce ve eskiye doğru imleçli;
 * `fetchNextPage` "Daha eski bildirimler"dir. Okunmamış süzgeci ayrı önbellek kolundadır.
 */
export function useNotifications(
  filters: { unreadOnly?: boolean } = {},
  options: { enabled?: boolean } = {},
) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const unreadOnly = filters.unreadOnly ?? false
  const query = useInfiniteQuery<
    NotificationPage,
    ApiError,
    InfiniteData<NotificationPage, string | undefined>,
    readonly unknown[],
    string | undefined
  >({
    queryKey: institutionKey(institutionId, ...notificationListKey({ unread: unreadOnly })),
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      runRequest(() => listNotificationsRequest(client, { cursor: pageParam, unreadOnly }, signal)),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    enabled: institutionId !== null && (options.enabled ?? true),
  })
  return { ...query, notifications: flattenNotificationPages(query.data?.pages) }
}

/** Okunmamış bildirim sayısı (rozet); odak dönüşünde ve açık ekranda beş dakikada bir tazelenir. */
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
