import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'

import { runRequest } from '../src/api-result.ts'
import { commandFeedback, commandHeaders } from '../src/commands.ts'
import {
  notifyAbsenceRequest,
  openRequestRequest,
  REQUEST_CHANGED_MESSAGE,
  REQUEST_MESSAGES,
  updateRequestRequest,
} from '../src/use-request-commands.ts'

interface Sent {
  method: string
  path: string
  headers: Headers
  body: unknown
}

/** Gerçek istemci + sahte fetch: giden istek kaydedilir, yanıt sabittir. */
function fakeClient() {
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
      return new Response(
        JSON.stringify({
          data: {
            entity: { collection: 'requests', id: 'req-1' },
            changes: { inserted: 1, updated: 0, archived: 0, restored: 0 },
            records: [],
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      )
    },
  })
  return { client, sent }
}

const request = {
  studentId: 's1',
  category: 'Talep' as const,
  title: 'Servis saati',
  text: 'Akşam servisinin erken kalkmasını rica ediyoruz.',
}
const absence = {
  studentId: 's1',
  startDate: '2026-10-08',
  endDate: '2026-10-09',
  category: 'Sağlık' as const,
  reason: 'Doktor kontrolü.',
}

describe('talep ve izin/mazeret komutları', () => {
  test('DOM-ILT-080: talep açma ve bildirim POST gönderir, If-Match taşımaz', async () => {
    const { client, sent } = fakeClient()
    const headers = commandHeaders('key-12345', 3)
    await runRequest(() => openRequestRequest(client, request, headers))
    await runRequest(() => notifyAbsenceRequest(client, absence, headers))
    assert.deepEqual(
      sent.map((item) => `${item.method} ${item.path}`),
      ['POST /api/v1/requests', 'POST /api/v1/absences'],
    )
    for (const item of sent) {
      assert.equal(item.headers.get('idempotency-key'), 'key-12345')
      assert.equal(item.headers.get('if-match'), null)
    }
    assert.deepEqual(sent[0]?.body, request)
    assert.deepEqual(sent[1]?.body, absence)
  })

  test('DOM-ILT-080: talep güncellemesi PATCH ile okunan sürümü If-Match olarak taşır', async () => {
    const { client, sent } = fakeClient()
    const body = { status: 'Çözüldü' as const, reply: 'Servis saati güncellendi.' }
    await runRequest(() =>
      updateRequestRequest(
        client,
        { requestId: 'req 1', version: 4, body },
        commandHeaders('key-12345', 4),
      ),
    )
    assert.equal(sent[0]?.method, 'PATCH')
    assert.equal(sent[0]?.path, '/api/v1/requests/req%201')
    assert.equal(sent[0]?.headers.get('if-match'), '"4"')
    assert.deepEqual(sent[0]?.body, body)
  })

  test('sürüm çakışması kullanıcıya güncel kaydı yükleme mesajı verir', () => {
    assert.equal(REQUEST_MESSAGES.version_conflict, REQUEST_CHANGED_MESSAGE)
    assert.equal(typeof commandFeedback, 'function')
  })
})
