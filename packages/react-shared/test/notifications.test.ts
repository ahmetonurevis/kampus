import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'

import { runRequest } from '../src/api-result.ts'
import { commandHeaders } from '../src/commands.ts'
import { createKampusQueryClient, DEFAULT_STALE_TIME_MS } from '../src/query-client.ts'
import {
  institutionKey,
  notificationListKey,
  notificationsPrefix,
  unreadNotificationsKey,
} from '../src/query-keys.ts'
import {
  flattenNotificationPages,
  listNotificationsRequest,
  NOTIFICATION_PAGE_SIZE,
  readAllNotificationsRequest,
  readNotificationRequest,
  UNREAD_NOTIFICATIONS_REFRESH_MS,
  unreadNotificationCountRequest,
  type NotificationView,
} from '../src/use-notifications.ts'

interface Sent {
  method: string
  url: URL
  headers: Headers
  body: unknown
}

/** Gerçek istemci + sahte fetch: giden istek kaydedilir, yanıt sabittir. */
function fakeClient(payload: unknown = { data: [], meta: { nextCursor: null } }) {
  const sent: Sent[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      const text = await request.text()
      sent.push({
        method: request.method,
        url: new URL(request.url),
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      })
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { client, sent }
}

describe('bildirim merkezi kancaları', () => {
  test('DOM-ILT-073: liste varsayılan boyutla, imleçsiz ve okunmamış süzgeci kapalı ister; imleç ve süzgeç taşınır', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() => listNotificationsRequest(client, {}))
    await runRequest(() =>
      listNotificationsRequest(client, { cursor: 'nt-9', limit: 10, unreadOnly: true }),
    )
    assert.deepEqual(
      sent.map((item) => [item.method, item.url.pathname, item.url.search]),
      [
        ['GET', '/api/v1/notifications', `?limit=${NOTIFICATION_PAGE_SIZE}&unread=false`],
        ['GET', '/api/v1/notifications', '?limit=10&unread=true&cursor=nt-9'],
      ],
    )
  })

  test('sayfalar en yeni önce tek akışa dizilir; sayfalar arasında kayan bildirim bir kez görünür', () => {
    const view = (id: string) => ({ id }) as NotificationView
    assert.deepEqual(
      flattenNotificationPages([
        { data: [view('n5'), view('n4')] },
        { data: [view('n4'), view('n3')] },
      ]).map((item) => item.id),
      ['n5', 'n4', 'n3'],
    )
    assert.deepEqual(flattenNotificationPages(undefined), [])
  })

  test('okunmamış sayısı kendi yolundan okunur ve yanıt gövdesi döner', async () => {
    const { client, sent } = fakeClient({ data: { unread: 4 } })
    const body = await runRequest(() => unreadNotificationCountRequest(client))
    assert.equal(sent[0]?.url.pathname, '/api/v1/notifications/unread-count')
    assert.deepEqual(body, { data: { unread: 4 } })
  })

  test('DOM-ILT-073: tekil okundu gövdesiz komuttur, kimlik yola kodlanır; If-Match yok', async () => {
    const { client, sent } = fakeClient({ data: {} })
    await runRequest(() => readNotificationRequest(client, 'nt 1'))
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.url.pathname, '/api/v1/notifications/nt%201/read')
    assert.deepEqual(sent[0]?.body, {})
    assert.equal(sent[0]?.headers.get('if-match'), null)
  })

  test('toplu okundu istek anahtarı taşır, okunan sürüm verilse de If-Match göndermez', async () => {
    const { client, sent } = fakeClient({ data: {} })
    await runRequest(() =>
      readAllNotificationsRequest(client, undefined, commandHeaders('key-12345', 7)),
    )
    assert.equal(sent[0]?.url.pathname, '/api/v1/notifications/read-all')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.deepEqual(sent[0]?.body, {})
  })

  test('sorgu anahtarları liste süzgecini ve sayıyı ayırır; ortak önekle birlikte tazelenir', () => {
    const list = notificationListKey({ unread: false })
    const unread = notificationListKey({ unread: true })
    const count = unreadNotificationsKey()
    assert.notDeepEqual(list, unread)
    assert.notDeepEqual(list, count)
    for (const key of [list, unread, count])
      assert.deepEqual(key.slice(0, notificationsPrefix().length), notificationsPrefix())
    // Kurum başa eklenir; başka kurumun önbelleğiyle karışmaz.
    assert.notDeepEqual(institutionKey('a', ...count), institutionKey('b', ...count))
  })

  test('okunmamış sayısı dakikada bir sorgulanmaz: yedek aralık en az 5 dk, odak dönüşü bayat sayıyı tazeler', () => {
    // Sayım indekssiz tarar (TODO(F6-bildirim-indeksi)); sık aralık büyük kurumda yük olur.
    assert.ok(UNREAD_NOTIFICATIONS_REFRESH_MS >= 5 * 60_000)
    assert.ok(UNREAD_NOTIFICATIONS_REFRESH_MS > DEFAULT_STALE_TIME_MS)
    const queries = createKampusQueryClient().getDefaultOptions().queries
    assert.notEqual(queries?.refetchOnWindowFocus, false)
  })
})
