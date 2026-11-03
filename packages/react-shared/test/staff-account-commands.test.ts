import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import { commandFeedback, commandHeaders } from '../src/commands.ts'
import { INSTITUTION_MEMBERS_KEY_ROOT, memberListKey } from '../src/institution-lists.ts'
import { isReauthenticationRequired } from '../src/reauthentication.ts'
import {
  cancelStaffInvitationRequest,
  changeStaffRoleRequest,
  importStaffRequest,
  inviteStaffRequest,
  isStaffImportFileError,
  setStaffActiveRequest,
  STAFF_ACCOUNT_COMMAND_MESSAGES,
  STAFF_ACCOUNTS_INVALIDATES,
  STAFF_INVITATIONS_KEY,
  staffImportIssuesOf,
} from '../src/staff-accounts.ts'

// IST-007 (DOM-YTK-070): personel daveti, rol ve pasifleştirme istekleri; Türkçe hata metinleri.

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
const member = {
  data: {
    id: 'm-1',
    userId: 'u-1',
    name: 'Selin Kaya',
    email: 'selin@kampus.example',
    role: 'onburo',
    status: 'active',
    links: [],
    deactivatedAt: null,
    createdAt: '2026-11-02T08:00:00.000Z',
  },
}
const invitation = {
  data: {
    id: 'inv-1',
    name: 'Selin Kaya',
    email: 'selin@kampus.example',
    role: 'ogretmen',
    status: 'pending',
    createdAt: '2026-11-02T08:00:00.000Z',
    expiresAt: '2026-11-09T08:00:00.000Z',
  },
}

describe('personel hesabı istekleri (DOM-YTK-070)', () => {
  test('DOM-YTK-070: davet Idempotency-Key taşır, gövde e-posta, ad, rol ve öğretmen kaydıdır', async () => {
    const { client, sent } = fakeClient(() => json(201, invitation))
    const body = {
      email: 'selin@kampus.example',
      name: 'Selin Kaya',
      role: 'ogretmen' as const,
      teacherId: 't-1',
    }
    const data = await runRequest(() =>
      inviteStaffRequest(client, body, commandHeaders('key-12345', undefined)),
    )
    assert.equal(data.data.id, 'inv-1')
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.path, '/api/v1/institution-members/invitations')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.deepEqual(sent[0]?.body, body)
  })

  test('DOM-YTK-070: iptal, rol, pasifleştirme ve geri alma doğru yola gider', async () => {
    const { client, sent } = fakeClient(() => json(200, member))
    const headers = commandHeaders('key-67890', undefined)
    await runRequest(() => cancelStaffInvitationRequest(client, { invitationId: 'inv-1' }, headers))
    await runRequest(() =>
      changeStaffRoleRequest(client, { membershipId: 'm-1', role: 'onburo' }, headers),
    )
    await runRequest(() =>
      setStaffActiveRequest(client, { membershipId: 'm-1', active: false }, headers),
    )
    await runRequest(() =>
      setStaffActiveRequest(client, { membershipId: 'm-1', active: true }, headers),
    )
    assert.deepEqual(
      sent.map((request) => request.path),
      [
        '/api/v1/institution-members/invitations/inv-1/cancel',
        '/api/v1/institution-members/m-1/role',
        '/api/v1/institution-members/m-1/deactivate',
        '/api/v1/institution-members/m-1/reactivate',
      ],
    )
    assert.deepEqual(sent[1]?.body, { role: 'onburo' })
    assert.ok(sent.every((request) => request.headers.get('idempotency-key') === 'key-67890'))
  })

  test('DOM-YTK-070: kural hataları Türkçe sözlükten, bilinmeyen kod sunucudan gelir', () => {
    const cases = [
      ['last_admin', 'son etkin yönetici'],
      ['self_role_change', 'Kendi rolünüzü'],
      ['self_deactivate', 'Kendi hesabınızı'],
      ['self_reactivate', 'Kendi hesabınızı etkinleştiremezsiniz'],
      ['member_exists', 'zaten kayıtlı'],
      ['teacher_already_linked', 'başka bir hesaba'],
    ] as const
    for (const [code, expected] of cases) {
      const feedback = commandFeedback(
        new ApiError({ status: 422, code, message: 'technical' }),
        STAFF_ACCOUNT_COMMAND_MESSAGES,
      )
      assert.ok(feedback.message?.includes(expected), code)
    }
    const unknown = commandFeedback(
      new ApiError({ status: 422, code: 'other_rule', message: 'Sunucu mesajı.' }),
      STAFF_ACCOUNT_COMMAND_MESSAGES,
    )
    assert.equal(unknown.message, 'Sunucu mesajı.')
  })

  test('DOM-YTK-070: taze oturum hatası parola penceresine bırakılabilir', () => {
    assert.equal(
      isReauthenticationRequired(
        new ApiError({ status: 403, code: 'reauthentication_required', message: 'x' }),
      ),
      true,
    )
  })

  test('DOM-YTK-070: yazma üye listesini ve bekleyen davetleri birlikte tazeler', () => {
    const [prefix] = STAFF_ACCOUNTS_INVALIDATES
    assert.deepEqual(prefix, [INSTITUTION_MEMBERS_KEY_ROOT])
    assert.equal(memberListKey('u-1', { page: 1, pageSize: 25 })[0], prefix[0])
    assert.equal(STAFF_INVITATIONS_KEY[0], prefix[0])
  })

  test('IST-007: toplu aktarım Idempotency-Key ve CSV gövdesiyle gider; önizleme dryRun taşır', async () => {
    const result = { data: { dryRun: true, rowCount: 1, invitedCount: 1, issues: [] } }
    const { client, sent } = fakeClient(() => json(200, result))
    const body = { csv: 'ad;e-posta;rol\nAli Can;ali@kampus.example;onburo', dryRun: true }
    const data = await runRequest(() =>
      importStaffRequest(client, body, commandHeaders('key-import-1', undefined)),
    )
    assert.deepEqual(data, result)
    assert.equal(sent[0]?.path, '/api/v1/institution-members/imports')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-import-1')
    assert.deepEqual(sent[0]?.body, body)
  })

  test('IST-007: 422 staff_import_invalid satır hatalarına çevrilir; başka hata null', () => {
    const error = new ApiError({
      status: 422,
      code: 'staff_import_invalid',
      message: 'Dosyada düzeltilmesi gereken satırlar var.',
      issues: [
        { path: ['rows', 3, 'email'], code: 'member_exists', message: '3. satır: Zaten kayıtlı.' },
        { path: ['rows', 4], code: 'teacher_ambiguous', message: '4. satır: Birden çok kayıt.' },
        { path: ['csv'], code: 'other', message: 'Yok sayılır.' },
      ],
    })
    assert.deepEqual(staffImportIssuesOf(error), [
      { line: 3, field: 'email', code: 'member_exists', message: 'Zaten kayıtlı.' },
      { line: 4, field: null, code: 'teacher_ambiguous', message: 'Birden çok kayıt.' },
    ])
    const fileError = new ApiError({ status: 422, code: 'csv_too_many_rows', message: 'x' })
    assert.equal(staffImportIssuesOf(fileError), null)
    assert.equal(isStaffImportFileError(fileError), true)
    assert.equal(isStaffImportFileError(error), true)
    assert.equal(
      isStaffImportFileError(new ApiError({ status: 403, code: 'forbidden', message: 'x' })),
      false,
    )
  })
})
