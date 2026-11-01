import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import { commandFeedback } from '../src/commands.ts'
import {
  forgetContact,
  PARENT_CONTACT_MESSAGES,
  PARENT_CONTACT_RATE_LIMITED_MESSAGE,
  parentContactKey,
  rememberContact,
  revealParentContactRequest,
} from '../src/use-parent-contact.ts'

interface Sent {
  method: string
  path: string
  headers: Headers
  body: unknown
}

function fakeClient(reply: () => Response) {
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
        path: new URL(request.url).pathname,
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      })
      return reply()
    },
  })
  return { client, sent }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

const PHONE = { parentId: 'p1', studentId: 's1', field: 'phone' as const }

describe('veli iletişimi kancası (DOM-YTK-055)', () => {
  test('DOM-YTK-055: Göster isteği veli yolunu, öğrenci ve alanı gönderir; anahtar başlığı yok', async () => {
    const { client, sent } = fakeClient(() =>
      json(200, { data: { ...PHONE, value: '05321234512' } }, { 'cache-control': 'no-store' }),
    )
    const result = await runRequest(() => revealParentContactRequest(client, PHONE))
    assert.equal(result.data.value, '05321234512')
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.path, '/api/v1/parents/p1/reveal-contact')
    assert.deepEqual(sent[0]?.body, { studentId: 's1', field: 'phone' })
    // İşlem kayıt oluşturmaz; tekrar yeni bir denetim kaydıdır (Idempotency-Key yok).
    assert.equal(sent[0]?.headers.get('idempotency-key'), null)
  })

  test('DOM-YTK-055: açılan değer yalnız bellekteki haritada; öğrenci ve alan başına ayrı, gizlenir', () => {
    const empty: ReadonlyMap<string, string> = new Map()
    const phone = rememberContact(empty, { ...PHONE, value: '05321234512' })
    assert.equal(empty.size, 0)
    assert.equal(phone.get(parentContactKey(PHONE)), '05321234512')
    // Aynı veli başka öğrencinin velisi olarak ya da başka alanı ayrı açılır.
    assert.equal(phone.get(parentContactKey({ ...PHONE, studentId: 's2' })), undefined)
    assert.equal(phone.get(parentContactKey({ ...PHONE, field: 'email' })), undefined)
    const both = rememberContact(phone, { ...PHONE, field: 'email', value: 'a@b.com' })
    assert.equal(both.size, 2)
    const hidden = forgetContact(both, PHONE)
    assert.equal(hidden.get(parentContactKey(PHONE)), undefined)
    assert.equal(hidden.size, 1)
    assert.equal(both.size, 2)
    assert.equal(forgetContact(hidden, PHONE), hidden)
  })

  test('DOM-YTK-055: 429 ve kapsam dışı hatalar Türkçe mesajla gösterilir', async () => {
    const { client } = fakeClient(() =>
      json(
        429,
        { code: 'rate_limited', message: 'Çok fazla istek gönderildi.', requestId: 'r1' },
        { 'retry-after': '42' },
      ),
    )
    const error = await runRequest(() => revealParentContactRequest(client, PHONE)).then(
      () => assert.fail('429 beklenirdi'),
      (caught: unknown) => caught,
    )
    assert.ok(error instanceof ApiError)
    assert.equal(error.status, 429)
    assert.equal(
      commandFeedback(error, PARENT_CONTACT_MESSAGES).message,
      PARENT_CONTACT_RATE_LIMITED_MESSAGE,
    )
    const notFound = new ApiError({ status: 404, code: 'not_found', message: 'Bulunamadı.' })
    assert.match(commandFeedback(notFound, PARENT_CONTACT_MESSAGES).message ?? '', /yetkiniz yok/)
    const missing = new ApiError({ status: 422, code: 'parent_contact_missing', message: 'x' })
    assert.match(commandFeedback(missing, PARENT_CONTACT_MESSAGES).message ?? '', /kayıtlı değil/)
  })
})
