import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import { commandFeedback, commandHeaders } from '../src/commands.ts'
import {
  GUARDIAN_INVITATION_COMMAND_MESSAGES,
  GUARDIAN_INVITATION_INVALIDATES,
  GUARDIAN_INVITATIONS_KEY,
  inviteGuardianRequest,
  STUDENT_GUARDIANS_KEY_ROOT,
  studentGuardiansKey,
} from '../src/guardian-invitations.ts'
import { INSTITUTION_MEMBERS_KEY_ROOT, memberListKey } from '../src/institution-lists.ts'
import { STAFF_INVITATIONS_KEY } from '../src/staff-accounts.ts'

// DOM-YTK-071: veli hesabı daveti isteği, Türkçe hata metinleri ve tazelenen sorgular.

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

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const invitation = {
  data: {
    id: 'inv-1',
    name: 'Ayşe Yılmaz',
    email: 'ayse@kampus.example',
    role: 'veli',
    status: 'pending',
    studentIds: ['s-1', 's-2'],
    parentId: 'p-1',
    createdAt: '2026-11-03T08:00:00.000Z',
    expiresAt: '2026-11-10T08:00:00.000Z',
  },
}

describe('veli hesabı daveti isteği (DOM-YTK-071)', () => {
  test('DOM-YTK-071: davet Idempotency-Key taşır; gövde e-posta, ad, öğrenciler ve veli kaydıdır', async () => {
    const { client, sent } = fakeClient(() => json(201, invitation))
    const body = {
      email: 'ayse@kampus.example',
      name: 'Ayşe Yılmaz',
      studentIds: ['s-1', 's-2'],
      parentId: 'p-1',
    }
    const data = await runRequest(() =>
      inviteGuardianRequest(client, body, commandHeaders('key-veli-1', undefined)),
    )
    assert.deepEqual(data, invitation)
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.path, '/api/v1/institution-members/guardian-invitations')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-veli-1')
    assert.deepEqual(sent[0]?.body, body)
  })

  test('DOM-YTK-071: sunucu hatası ApiError olur; kodu ve durumu korunur', async () => {
    const { client } = fakeClient(() =>
      json(422, { code: 'guardian_record_not_linked', message: 'x', requestId: 'r-1' }),
    )
    await assert.rejects(
      runRequest(() =>
        inviteGuardianRequest(
          client,
          { email: 'a@kampus.example', name: 'Ayşe', studentIds: ['s-1'] },
          commandHeaders('key-veli-2', undefined),
        ),
      ),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 422 &&
        error.code === 'guardian_record_not_linked',
    )
  })

  test('DOM-YTK-071: kural hataları Türkçe sözlükten, bilinmeyen kod sunucudan gelir', () => {
    const cases = [
      ['member_exists', 'veli bağından'],
      ['invitation_exists', 'bekleyen bir davet'],
      ['guardian_record_not_linked', 'velisi değil'],
      ['guardian_link_exists', 'zaten bir veli hesabına'],
      ['guardian_identity_mismatch', 'başka bir veli hesabıyla'],
      ['not_found', 'bulunamadı'],
    ] as const
    for (const [code, expected] of cases) {
      const feedback = commandFeedback(
        new ApiError({ status: 409, code, message: 'technical' }),
        GUARDIAN_INVITATION_COMMAND_MESSAGES,
      )
      assert.ok(feedback.message?.includes(expected), code)
    }
    const unknown = commandFeedback(
      new ApiError({ status: 422, code: 'other_rule', message: 'Sunucu mesajı.' }),
      GUARDIAN_INVITATION_COMMAND_MESSAGES,
    )
    assert.equal(unknown.message, 'Sunucu mesajı.')
  })

  test('DOM-YTK-071: başarı üye, davet ve veli bağı sorgularını geçersiz kılar', () => {
    const prefixes = GUARDIAN_INVITATION_INVALIDATES.map((prefix) => prefix[0])
    assert.deepEqual(prefixes, [INSTITUTION_MEMBERS_KEY_ROOT, STUDENT_GUARDIANS_KEY_ROOT])
    assert.equal(memberListKey('u-1', { page: 1, pageSize: 25 })[0], INSTITUTION_MEMBERS_KEY_ROOT)
    assert.equal(STAFF_INVITATIONS_KEY[0], INSTITUTION_MEMBERS_KEY_ROOT)
    assert.equal(GUARDIAN_INVITATIONS_KEY[0], INSTITUTION_MEMBERS_KEY_ROOT)
    assert.deepEqual(studentGuardiansKey('s-1'), [STUDENT_GUARDIANS_KEY_ROOT, 's-1'])
  })
})
