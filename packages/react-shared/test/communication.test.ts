import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

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

/** Gerçek istemci + sahte fetch: giden istek kaydedilir, yanıt sabittir. */
function fakeClient(reply: () => Response) {
  const sent: Sent[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      const text = await request.text()
      const url = new URL(request.url)
      sent.push({
        method: request.method,
        path: url.pathname,
        search: url.search,
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      })
      return reply()
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
