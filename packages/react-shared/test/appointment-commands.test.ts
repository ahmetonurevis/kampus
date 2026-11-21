import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'

import { runRequest } from '../src/api-result.ts'
import { commandHeaders, createCommandSession, runCommand } from '../src/commands.ts'
import {
  APPOINTMENT_CHANGED_MESSAGE,
  APPOINTMENT_MESSAGES,
  APPOINTMENT_VERSION_MISSING_MESSAGE,
  bookAppointmentRequest,
  updateAppointmentRequest,
  type UpdateAppointmentInput,
} from '../src/use-appointment-commands.ts'

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
            entity: { collection: 'appointments', id: 'apt-1' },
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

const booking = {
  studentId: 's1',
  slotId: 'slot-t1-0',
  note: 'Denklem problemlerini konuşmak istiyoruz.',
}

describe('randevu komutları', () => {
  test('DOM-ILT-100: talep POST gönderir, If-Match taşımaz', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() => bookAppointmentRequest(client, booking, commandHeaders('key-12345', 3)))
    assert.equal(sent.length, 1)
    assert.equal(`${sent[0]?.method} ${sent[0]?.path}`, 'POST /api/v1/appointments')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.deepEqual(sent[0]?.body, booking)
  })

  test('DOM-ILT-102: durum değişikliği PATCH ile okunan sürümü If-Match olarak taşır', async () => {
    const { client, sent } = fakeClient()
    const body = { status: 'Reddedildi' as const, reason: 'O saatte toplantım var.' }
    await runRequest(() =>
      updateAppointmentRequest(
        client,
        { appointmentId: 'apt 1', version: 4, body },
        commandHeaders('key-12345', 4),
      ),
    )
    assert.equal(sent[0]?.method, 'PATCH')
    assert.equal(sent[0]?.path, '/api/v1/appointments/apt%201')
    assert.equal(sent[0]?.headers.get('if-match'), '"4"')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.deepEqual(sent[0]?.body, body)
  })

  test('DOM-ILT-102: sürüm yoksa istek atılmaz, boş If-Match gönderilmez; kullanıcıya Türkçe mesaj', async () => {
    const { client, sent } = fakeClient()
    const body = { status: 'Onaylandı' as const }
    for (const headers of [{ 'idempotency-key': 'key-12345' }, commandHeaders('key-12345')])
      await assert.rejects(
        updateAppointmentRequest(client, { appointmentId: 'apt-1', version: null, body }, headers),
        (error: unknown) =>
          error instanceof Error &&
          (error as { code?: string }).code === 'if_match_required' &&
          error.message === APPOINTMENT_VERSION_MISSING_MESSAGE,
      )
    await assert.rejects(
      updateAppointmentRequest(
        client,
        { appointmentId: 'apt-1', version: null, body },
        { 'idempotency-key': 'key-12345', 'if-match': '' },
      ),
    )
    // Kancanın yolu: `version` null → başlık yok → istek atılmaz, sonuç `failed`.
    const notified: string[] = []
    const outcome = await runCommand(
      createCommandSession(() => 'key-67890'),
      {
        execute: (input: UpdateAppointmentInput, headers) =>
          runRequest(() => updateAppointmentRequest(client, input, headers)),
        version: (input) => input.version,
        refresh: async () => {},
        messages: APPOINTMENT_MESSAGES,
      },
      { appointmentId: 'apt-1', version: null, body },
      { notifyError: (message) => notified.push(message) },
    )
    assert.equal(outcome.status, 'failed')
    assert.equal(sent.length, 0)
    assert.deepEqual(notified, [APPOINTMENT_VERSION_MISSING_MESSAGE])
  })

  test('sürüm çakışması kullanıcıya güncel kaydı yükleme mesajı verir', () => {
    assert.equal(APPOINTMENT_MESSAGES.version_conflict, APPOINTMENT_CHANGED_MESSAGE)
  })
})
