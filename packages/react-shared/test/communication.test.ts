import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import { commandFeedback, commandHeaders } from '../src/commands.ts'
import {
  conversationListKey,
  conversationMessagesKey,
  conversationsPrefix,
  parentAccountsKey,
} from '../src/query-keys.ts'
import {
  accessRemainingMs,
  ACCESS_MESSAGES,
  CONVERSATION_PAGE_SIZE,
  conversationListQueryOptions,
  mergeConversationPages,
  nextConversationPage,
  type ConversationPage,
  type ConversationSummary,
  ANNOUNCEMENT_CHANGED_MESSAGE,
  ANNOUNCEMENT_MESSAGES,
  flattenMessagePages,
  MESSAGE_MESSAGES,
  MESSAGE_RATE_LIMITED_MESSAGE,
  openAccessRequest,
  publishAnnouncementRequest,
  readAnnouncementRequest,
  readConversationRequest,
  reviseAnnouncementRequest,
  sendMessageRequest,
  startConversationRequest,
  withdrawAnnouncementRequest,
  type ConversationMessage,
} from '../src/use-communication.ts'

interface Sent {
  method: string
  path: string
  search: string
  headers: Headers
  body: unknown
}

/** Gerçek istemci + sahte fetch: giden istek kaydedilir; yanıt isteğe göre `reply` ile verilir. */
function fakeClient(reply: (request: Sent) => Response) {
  const sent: Sent[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      const text = await request.text()
      const url = new URL(request.url)
      const entry: Sent = {
        method: request.method,
        path: url.pathname,
        search: url.search,
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      }
      sent.push(entry)
      return reply(entry)
    },
  })
  return { client, sent }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
const commandResult = (collection: string, id: string) => ({
  data: {
    entity: { collection, id },
    changes: { inserted: 1, updated: 0, archived: 0, restored: 0 },
    records: [{ collection, id, version: 2, change: 'insert' }],
  },
})
const message = (id: string): ConversationMessage => ({
  id,
  text: `metin ${id}`,
  sender: 'teacher',
  sentAt: '2026-10-30T08:00:00.000Z',
  readAt: null,
  fromMe: true,
})

describe('duyuru komutları', () => {
  test('yayın hedef kitleyi gövdede, Idempotency-Key başlığında gönderir; If-Match yok', async () => {
    const { client, sent } = fakeClient(() => json(201, commandResult('announcements', 'ann-1')))
    const body = {
      title: 'Veli toplantısı',
      text: 'Cuma 18.00',
      category: 'Etkinlik' as const,
      target: { classIds: ['c1'], roles: ['veli' as const] },
    }
    const data = await runRequest(() =>
      publishAnnouncementRequest(client, body, commandHeaders('key-12345', 3)),
    )
    assert.equal(data.data.entity?.id, 'ann-1')
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.path, '/api/v1/announcements')
    assert.deepEqual(sent[0]?.body, body)
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
  })

  test('düzeltme PATCH ile yalnız değişen alanı ve If-Match sürümünü gönderir', async () => {
    const { client, sent } = fakeClient(() => json(200, commandResult('announcements', 'ann-1')))
    await runRequest(() =>
      reviseAnnouncementRequest(
        client,
        { announcementId: 'ann-1', version: 4, changes: { title: 'Yeni başlık' } },
        commandHeaders('key-12345', 4),
      ),
    )
    assert.equal(sent[0]?.method, 'PATCH')
    assert.equal(sent[0]?.path, '/api/v1/announcements/ann-1')
    assert.deepEqual(sent[0]?.body, { title: 'Yeni başlık' })
    assert.equal(sent[0]?.headers.get('if-match'), '"4"')
  })

  test('geri çekme gerekçeyi gönderir', async () => {
    const { client, sent } = fakeClient(() => json(200, commandResult('announcements', 'ann-1')))
    await runRequest(() =>
      withdrawAnnouncementRequest(
        client,
        { announcementId: 'ann-1', version: 2, reason: 'Tarih yanlış yazılmış.' },
        commandHeaders('key-12345', 2),
      ),
    )
    assert.equal(sent[0]?.path, '/api/v1/announcements/ann-1/withdraw')
    assert.deepEqual(sent[0]?.body, { reason: 'Tarih yanlış yazılmış.' })
  })

  test('okundu işareti gövdesiz komuttur', async () => {
    const { client, sent } = fakeClient(() => json(200, commandResult('announcements', 'ann-1')))
    await runRequest(() => readAnnouncementRequest(client, 'ann-1'))
    assert.equal(sent[0]?.path, '/api/v1/announcements/ann-1/read')
    assert.deepEqual(sent[0]?.body, {})
  })

  test('409 sürüm çakışması başkası değiştirdi uyarısıyla tazelenir', () => {
    const error = new ApiError({
      status: 409,
      code: 'version_conflict',
      message: 'Kayıt başka biri tarafından değiştirildi.',
    })
    const feedback = commandFeedback(error, ANNOUNCEMENT_MESSAGES)
    assert.equal(feedback.message, ANNOUNCEMENT_CHANGED_MESSAGE)
    assert.equal(feedback.refresh, true)
    assert.match(feedback.message ?? '', /başkası/)
    assert.match(feedback.message ?? '', /yenile/)
  })

  test('geri çekilmiş duyuru düzeltmesi Türkçe reddedilir', () => {
    const error = new ApiError({ status: 409, code: 'announcement_withdrawn', message: 'x' })
    assert.match(commandFeedback(error, ANNOUNCEMENT_MESSAGES).message ?? '', /geri çekilmiş/)
  })
})

describe('yazışma komutları', () => {
  test('öğretmen veli yazışması başlatır: öğrenci, hedef kitle, veli hesabı ve ilk mesaj', async () => {
    const { client, sent } = fakeClient(() => json(201, commandResult('conversations', 'conv-1')))
    const body = {
      studentId: 's1',
      audience: 'parent' as const,
      parentUserId: 'user-9',
      text: 'Merhaba',
    }
    await runRequest(() => startConversationRequest(client, body, commandHeaders('key-12345')))
    assert.equal(sent[0]?.path, '/api/v1/conversations')
    assert.deepEqual(sent[0]?.body, body)
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
  })

  test('mesaj gönderme yazışma yoluna yalnız metni ve istek anahtarını gönderir', async () => {
    const { client, sent } = fakeClient(() => json(201, commandResult('conversations', 'conv-1')))
    await runRequest(() =>
      sendMessageRequest(
        client,
        { conversationId: 'conv-1', text: 'Selam' },
        commandHeaders('key-12345'),
      ),
    )
    assert.equal(sent[0]?.path, '/api/v1/conversations/conv-1/messages')
    assert.deepEqual(sent[0]?.body, { text: 'Selam' })
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
  })

  test('okundu işareti ve gerekçeli erişim doğru yola gider', async () => {
    const { client, sent } = fakeClient(() =>
      json(200, { data: { conversationId: 'conv-1', expiresAt: '2026-10-30T09:00:00.000Z' } }),
    )
    await runRequest(() => readConversationRequest(client, 'conv-1'))
    const access = await runRequest(() =>
      openAccessRequest(client, { conversationId: 'conv-1', reason: 'Şikayet incelemesi' }),
    )
    assert.equal(sent[0]?.path, '/api/v1/conversations/conv-1/read')
    assert.equal(sent[1]?.path, '/api/v1/conversations/conv-1/access')
    assert.deepEqual(sent[1]?.body, { reason: 'Şikayet incelemesi' })
    assert.equal(access.data.expiresAt, '2026-10-30T09:00:00.000Z')
  })

  test('hız sınırı ve gerekçe hataları Türkçe metne çevrilir', () => {
    const limited = new ApiError({ status: 429, code: 'rate_limited', message: 'x' })
    assert.equal(commandFeedback(limited, MESSAGE_MESSAGES).message, MESSAGE_RATE_LIMITED_MESSAGE)
    const reason = new ApiError({ status: 422, code: 'access_reason_required', message: 'x' })
    assert.match(commandFeedback(reason, ACCESS_MESSAGES).message ?? '', /en az 10/)
    const forbidden = new ApiError({ status: 403, code: 'forbidden', message: 'x' })
    assert.match(commandFeedback(forbidden, ACCESS_MESSAGES).message ?? '', /Veli yazışmaları/)
    const ended = new ApiError({
      status: 403,
      code: 'conversation_relationship_ended',
      message: 'x',
    })
    assert.match(commandFeedback(ended, MESSAGE_MESSAGES).message ?? '', /ders ilişkiniz/)
  })
})

describe('mesaj akışı ve erişim süresi', () => {
  test('sayfalar eskiden yeniye tek akışa dizilir (ilk sayfa en yeni)', () => {
    const newest = { data: [message('m5'), message('m6')] }
    const older = { data: [message('m3'), message('m4')] }
    const oldest = { data: [message('m1'), message('m2')] }
    const ids = flattenMessagePages([newest, older, oldest]).map((item) => item.id)
    assert.deepEqual(ids, ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'])
    assert.deepEqual(flattenMessagePages(undefined), [])
  })

  test('kalan erişim süresi bitişe kadar azalır, bitince sıfırdır', () => {
    const expires = '2026-10-30T09:00:00.000Z'
    const start = Date.parse('2026-10-30T08:30:00.000Z')
    assert.equal(accessRemainingMs(expires, start), 30 * 60_000)
    assert.equal(accessRemainingMs(expires, start + 29 * 60_000), 60_000)
    assert.equal(accessRemainingMs(expires, start + 31 * 60_000), 0)
    assert.equal(accessRemainingMs('geçersiz', start), 0)
  })

  test('sorgu anahtarları liste, mesaj ve veli hesaplarını ayırır; ortak önekle tazelenir', () => {
    assert.deepEqual(conversationsPrefix(), ['conversations'])
    for (const key of [
      conversationListKey({ studentId: 's1' }),
      conversationMessagesKey('conv-1'),
      parentAccountsKey('s1'),
    ])
      assert.equal(key[0], 'conversations')
    assert.notDeepEqual(conversationListKey({ studentId: 's1' }), conversationListKey())
    assert.notDeepEqual(conversationMessagesKey('a'), conversationMessagesKey('b'))
  })
})

const summary = (id: string): ConversationSummary => ({
  id,
  studentId: 's1',
  teacherId: 't1',
  audience: 'student',
  unreadCount: 0,
  awaitingReply: null,
  lastMessage: null,
  parentUserId: null,
  messageCount: 0,
})
const page = (ids: string[], total: number): ConversationPage => ({
  data: ids.map(summary),
  meta: { total },
})

describe('yazışma listesi sayfalaması', () => {
  test('sonraki sayfa yüklenen kayıt toplama ulaşana kadar sürer; boş sayfa listeyi bitirir', () => {
    assert.equal(nextConversationPage([]), undefined)
    assert.equal(nextConversationPage([page(['a', 'b'], 5)]), 2)
    assert.equal(nextConversationPage([page(['a', 'b'], 5), page(['c', 'd'], 5)]), 3)
    assert.equal(nextConversationPage([page(['a', 'b'], 5), page(['c', 'd'], 4)]), undefined)
    // Sunucuda kayıt azalmış: toplam eskide kalsa da boş sayfadan sonra istek atılmaz.
    assert.equal(nextConversationPage([page(['a'], 3), page([], 3)]), undefined)
  })

  test('sayfalar birleşir; sayfalar arasında kayan yazışma bir kez görünür', () => {
    const merged = mergeConversationPages([page(['a', 'b'], 4), page(['b', 'c'], 3)])
    assert.deepEqual(
      merged.items.map((item) => item.id),
      ['a', 'b', 'c'],
    )
    assert.equal(merged.total, 3)
    assert.deepEqual(mergeConversationPages(undefined), { items: [], total: 0 })
  })

  test('ikinci sayfa page/pageSize ile istenir, süzgeç taşınır ve son sayfada durulur', async () => {
    const all = Array.from({ length: CONVERSATION_PAGE_SIZE + 3 }, (_, index) => `c${index}`)
    const { client, sent } = fakeClient((request) => {
      const query = new URLSearchParams(request.search)
      const number = Number(query.get('page'))
      const size = Number(query.get('pageSize'))
      return json(200, {
        data: all.slice((number - 1) * size, number * size).map(summary),
        meta: { total: all.length, page: number, pageSize: size },
      })
    })
    const observer = new InfiniteQueryObserver(
      new QueryClient(),
      conversationListQueryOptions(client, 'inst-1', { studentId: 's9' }),
    )
    const first = await observer.refetch()
    assert.equal(first.data?.pages.length, 1)
    assert.equal(first.data?.pages[0]?.data.length, CONVERSATION_PAGE_SIZE)
    assert.equal(observer.getCurrentResult().hasNextPage, true)

    const second = await observer.fetchNextPage()
    assert.equal(second.data?.pages.length, 2)
    assert.equal(second.data?.pages[1]?.data.length, 3)
    assert.equal(second.hasNextPage, false, 'liste sonu algılanır')
    assert.deepEqual(
      mergeConversationPages(second.data?.pages).items.map((item) => item.id),
      all,
    )

    assert.deepEqual(
      sent.map((request) => new URLSearchParams(request.search).get('page')),
      ['1', '2'],
    )
    for (const request of sent) {
      assert.equal(request.path, '/api/v1/conversations')
      assert.equal(new URLSearchParams(request.search).get('studentId'), 's9')
      assert.equal(
        new URLSearchParams(request.search).get('pageSize'),
        String(CONVERSATION_PAGE_SIZE),
      )
    }
    observer.destroy()
  })

  test('tek sayfaya sığan liste ikinci istek atmaz', async () => {
    const { client, sent } = fakeClient(() =>
      json(200, { data: [summary('a'), summary('b')], meta: { total: 2, page: 1, pageSize: 50 } }),
    )
    const observer = new InfiniteQueryObserver(
      new QueryClient(),
      conversationListQueryOptions(client, 'inst-1'),
    )
    await observer.refetch()
    assert.equal(observer.getCurrentResult().hasNextPage, false)
    assert.equal(sent.length, 1)
    observer.destroy()
  })
})
