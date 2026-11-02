import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import { commandFeedback, commandHeaders } from '../src/commands.ts'
import {
  archivePermissionFormRequest,
  closePermissionFormRequest,
  createPermissionFormRequest,
  decidePermissionBody,
  decidePermissionCommand,
  decidePermissionRequest,
  decisionBlockedReason,
  fetchAllPermissionForms,
  fetchPermissionFormPage,
  hasDecisions,
  isPermissionVersionConflict,
  PERMISSION_DECISION_MESSAGES,
  PERMISSION_FORM_CHANGED_MESSAGE,
  PERMISSION_FORM_MESSAGES,
  PERMISSION_FORMS_INVALIDATES,
  permissionErrorField,
  permissionFormListKey,
  permissionFormListParams,
  permissionStale,
  updatePermissionFormRequest,
} from '../src/permission-forms.ts'

// IST-067 (DOM-ILT-030, -031, -036…039): izin formu istekleri, If-Match / Idempotency-Key,
// süzgeçler, karar gövdesi, hata metinleri ve alanları.

interface Sent {
  method: string
  path: string
  search: URLSearchParams
  headers: Headers
  body: unknown
}

function fakeClient(reply: (sent: Sent) => Response) {
  const sent: Sent[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      const text = await request.text()
      const url = new URL(request.url)
      const item = {
        method: request.method,
        path: url.pathname,
        search: url.searchParams,
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      }
      sent.push(item)
      return reply(item)
    },
  })
  return { client, sent }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const FORM = 'pf-test-1'
const form = (overrides: Record<string, unknown> = {}) => ({
  id: FORM,
  version: 3,
  topic: 'trip',
  title: 'Müze gezisi',
  description: 'Servisle gidilir.',
  deadline: '2026-12-01',
  deadlineEndsAt: '2026-12-01T21:00:00.000Z',
  classIds: ['c1'],
  studentIds: ['s1'],
  teacherId: null,
  status: 'open',
  closedAt: null,
  acceptingDecisions: true,
  createdAt: '2026-11-01T06:00:00.000Z',
  updatedAt: '2026-11-01T06:00:00.000Z',
  ...overrides,
})
const error = (status: number, code: string, path?: (string | number)[]) =>
  new ApiError({
    status,
    code,
    message: 'Sunucu mesajı.',
    ...(path ? { issues: [{ path: path.map(String), code, message: 'x' }] } : {}),
  })

describe('izin formu istekleri (IST-067)', () => {
  test('form açma Idempotency-Key taşır, If-Match göndermez (DOM-ILT-036)', async () => {
    const { client, sent } = fakeClient(() => json(201, { data: form() }))
    const body = {
      topic: 'trip' as const,
      title: 'Müze gezisi',
      description: 'Servisle gidilir.',
      deadline: '2026-12-01',
      classIds: ['c1'],
    }
    await runRequest(() =>
      createPermissionFormRequest(client, body, commandHeaders('key-12345', 9)),
    )
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.path, '/api/v1/permission-forms')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.deepEqual(sent[0]?.body, body)
  })

  test('düzenleme, kapatma ve arşiv formun sürümünü If-Match ile gönderir (DOM-ILT-038)', async () => {
    const { client, sent } = fakeClient(() => json(200, { data: form() }))
    const headers = commandHeaders('key-12345', 3)
    const target = { formId: FORM, version: 3 }
    await runRequest(() =>
      updatePermissionFormRequest(client, { ...target, body: { title: 'Yeni' } }, headers),
    )
    await runRequest(() => closePermissionFormRequest(client, target, headers))
    await runRequest(() => archivePermissionFormRequest(client, target, headers))
    assert.deepEqual(
      sent.map((item) => `${item.method} ${item.path}`),
      [
        `PATCH /api/v1/permission-forms/${FORM}`,
        `POST /api/v1/permission-forms/${FORM}/close`,
        `DELETE /api/v1/permission-forms/${FORM}`,
      ],
    )
    assert.ok(sent.every((item) => item.headers.get('if-match') === '"3"'))
    assert.ok(sent.every((item) => item.headers.get('idempotency-key') === 'key-12345'))
    assert.deepEqual(sent[0]?.body, { title: 'Yeni' })
    assert.equal(sent[1]?.body, undefined)
  })

  test('karar sürümsüzdür: Idempotency-Key gider, If-Match gitmez (DOM-ILT-030)', async () => {
    const { client, sent } = fakeClient(() => json(201, { data: {} }))
    await runRequest(() =>
      decidePermissionRequest(
        client,
        { formId: FORM, body: { studentId: 's1', decision: 'approved' } },
        commandHeaders('key-7', 5),
      ),
    )
    assert.equal(sent[0]?.path, `/api/v1/permission-forms/${FORM}/decisions`)
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-7')
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.deepEqual(sent[0]?.body, { studentId: 's1', decision: 'approved' })
  })

  test('sürümsüz düzenleme, kapatma ve arşiv istek atmaz', async () => {
    const { client, sent } = fakeClient(() => json(200, { data: form() }))
    const missing = (caught: unknown) =>
      caught instanceof ApiError && caught.code === 'if_match_missing'
    const target = { formId: FORM, version: 3 }
    for (const send of [
      () =>
        updatePermissionFormRequest(
          client,
          { ...target, body: { title: 'Yeni' } },
          commandHeaders('k'),
        ),
      () => closePermissionFormRequest(client, target, commandHeaders('k')),
      () => archivePermissionFormRequest(client, target, commandHeaders('k')),
    ])
      await assert.rejects(() => runRequest(send), missing)
    assert.equal(sent.length, 0)
  })

  test('karar gövdesi boş notu göndermez, notu kırpar', () => {
    assert.deepEqual(decidePermissionBody({ studentId: 's1', decision: 'rejected', note: '  ' }), {
      studentId: 's1',
      decision: 'rejected',
    })
    assert.deepEqual(
      decidePermissionBody({ studentId: 's1', decision: 'approved', note: ' Kendim getiririm ' }),
      { studentId: 's1', decision: 'approved', note: 'Kendim getiririm' },
    )
  })

  test('boş süzgeç ve `all` durumu gönderilmez; anahtar süzgeç sırasından bağımsızdır', () => {
    assert.deepEqual(permissionFormListParams({ status: 'all', topic: undefined }), {})
    assert.deepEqual(permissionFormListParams({ status: 'open', topic: 'trip', page: 2 }), {
      status: 'open',
      topic: 'trip',
      page: 2,
    })
    assert.deepEqual(
      permissionFormListKey({ topic: 'trip', status: 'open' }),
      permissionFormListKey({ status: 'open', topic: 'trip' }),
    )
  })

  test('IST-067: başlık araması kırpılır; 2 karakterden kısa arama gönderilmez', () => {
    assert.deepEqual(permissionFormListParams({ q: '  müze ' }), { q: 'müze' })
    assert.deepEqual(permissionFormListParams({ q: 'm' }), {})
    assert.deepEqual(permissionFormListParams({ q: '   ' }), {})
  })

  test('liste sayfası süzgeçle okunur ve meta taşır', async () => {
    const { client, sent } = fakeClient(() =>
      json(200, {
        data: [{ ...form(), counts: { pending: 1, approved: 0, rejected: 0, total: 1 } }],
        meta: { page: 1, pageSize: 25, total: 1 },
      }),
    )
    const page = await fetchPermissionFormPage(client, { status: 'open', page: 1, pageSize: 25 })
    assert.equal(page.total, 1)
    assert.equal(page.rows[0]?.id, FORM)
    assert.equal(sent[0]?.search.get('status'), 'open')
  })

  test('bütün sayfalar okunur ve süzgeç her sayfada taşınır (veli ve öğrenci listesi)', async () => {
    const { client, sent } = fakeClient((request) => {
      const page = Number(request.search.get('page') ?? '1')
      const counts = { pending: 1, approved: 0, rejected: 0, total: 1 }
      const rows =
        page === 1
          ? Array.from({ length: 100 }, () => ({ ...form(), counts }))
          : [{ ...form(), counts }]
      return json(200, { data: rows, meta: { page, pageSize: 100, total: 101 } })
    })
    const rows = await fetchAllPermissionForms(client, { status: 'open' })
    assert.equal(rows.length, 101)
    assert.equal(sent.length, 2)
    assert.ok(sent.every((item) => item.search.get('status') === 'open'))
  })

  test('yazma yalnız izin formu sorgularını tazeler', () => {
    assert.deepEqual(
      PERMISSION_FORMS_INVALIDATES.map((key) => [...key]),
      [['permission-forms']],
    )
    assert.equal(decidePermissionCommand.invalidates, PERMISSION_FORMS_INVALIDATES)
  })
})

describe('karar verilebilirlik (DOM-ILT-038)', () => {
  test('sunucunun hakemliği: açık formda gerekçe yok', () => {
    assert.equal(decisionBlockedReason(form()), null)
  })

  test('elle kapatılmış form ile son günü geçmiş form ayrı söylenir', () => {
    const closed = decisionBlockedReason(
      form({ status: 'closed', closedAt: '2026-11-02T06:00:00.000Z', acceptingDecisions: false }),
    )
    const late = decisionBlockedReason(
      form({ status: 'closed', acceptingDecisions: false, deadline: '2026-10-01' }),
    )
    assert.ok(closed?.includes('kapatıldı'))
    assert.ok(late?.includes('Son gün geçti'))
  })

  test('DOM-ILT-038: karar kilidi sunucunun hasDecisions alanıdır, sayılardan çıkarılmaz', () => {
    // Velayeti kalkan velinin kararı sayılmaz ama kilitler: sayılar sıfırken alan doğrudur.
    assert.equal(hasDecisions({ hasDecisions: true }), true)
    assert.equal(hasDecisions({ hasDecisions: false }), false)
    // Alan yalnız formu yönetene döner; yoksa ekran kilit göstermez, sunucu yine reddeder.
    assert.equal(hasDecisions({}), false)
  })
})

describe('izin formu hata metinleri ve alanları (DOM-ILT-030, -036…038)', () => {
  const formCases: [string, number, string][] = [
    ['permission_form_deadline_in_past', 422, 'geçmişte olamaz'],
    ['permission_form_scope_locked', 422, 'çıkarılamaz'],
    ['permission_form_has_decisions', 409, 'arşivlenemez'],
    ['permission_form_closed', 422, 'kapatılmış'],
    ['permission_form_not_owner', 403, 'açan öğretmen'],
    ['version_conflict', 409, PERMISSION_FORM_CHANGED_MESSAGE],
  ]
  for (const [code, status, expected] of formCases)
    test(`${code} Türkçe mesaja eşlenir`, () => {
      const feedback = commandFeedback(error(status, code), PERMISSION_FORM_MESSAGES)
      assert.ok(feedback.message?.includes(expected), feedback.message ?? 'mesaj yok')
    })

  test('karar hataları kendi metnini taşır', () => {
    const adult = commandFeedback(error(403, 'permission_adult_self'), PERMISSION_DECISION_MESSAGES)
    const guardian = commandFeedback(
      error(403, 'permission_guardian_required'),
      PERMISSION_DECISION_MESSAGES,
    )
    const late = commandFeedback(
      error(422, 'permission_form_deadline_passed'),
      PERMISSION_DECISION_MESSAGES,
    )
    assert.ok(adult.message?.includes('kendisi verir'))
    assert.ok(guardian.message?.includes('velayet sahibi'))
    assert.ok(late.message?.includes('karar verilemez'))
  })

  test('form hataları formdaki alana bağlanır', () => {
    assert.equal(
      permissionErrorField(error(422, 'permission_form_deadline_in_past'), 'form'),
      'deadline',
    )
    assert.equal(
      permissionErrorField(error(422, 'permission_form_no_students'), 'form'),
      'classIds',
    )
    assert.equal(permissionErrorField(error(422, 'student_inactive'), 'form'), 'studentIds')
    assert.equal(permissionErrorField(error(400, 'validation_failed', ['title']), 'form'), 'title')
    assert.equal(
      permissionErrorField(error(403, 'permission_form_scope_denied'), 'form'),
      undefined,
    )
    assert.equal(permissionErrorField(error(404, 'not_found'), 'form'), undefined)
  })

  test('kapalı ya da kilitli form hatası formun içine yazılır', () => {
    assert.equal(permissionErrorField(error(422, 'permission_form_closed'), 'form'), 'root.server')
    assert.equal(
      permissionErrorField(error(422, 'permission_form_scope_locked'), 'form'),
      'root.server',
    )
    assert.equal(
      permissionErrorField(error(403, 'permission_form_not_owner'), 'form'),
      'root.server',
    )
  })

  test('karar formunda son gün ve yaş hataları formun içine düşer, öğrenci pasifse de', () => {
    assert.equal(
      permissionErrorField(error(422, 'permission_form_deadline_passed'), 'decision'),
      'root.server',
    )
    assert.equal(
      permissionErrorField(error(403, 'permission_adult_self'), 'decision'),
      'root.server',
    )
    assert.equal(permissionErrorField(error(422, 'student_inactive'), 'decision'), 'root.server')
    assert.equal(
      permissionErrorField(error(400, 'validation_failed', ['note']), 'decision'),
      'note',
    )
  })

  test('404, sürüm çakışması, kapanış ve son gün ekranı tazeler', () => {
    assert.equal(permissionStale(error(404, 'not_found')), true)
    assert.equal(permissionStale(error(409, 'version_conflict')), true)
    assert.equal(permissionStale(error(409, 'permission_form_closed')), true)
    assert.equal(permissionStale(error(409, 'permission_form_has_decisions')), true)
    assert.equal(permissionStale(error(422, 'permission_form_closed')), true)
    assert.equal(permissionStale(error(422, 'permission_form_deadline_passed')), true)
    assert.equal(permissionStale(error(422, 'permission_form_deadline_in_past')), false)
    assert.equal(permissionStale(error(403, 'permission_adult_self')), false)
    assert.equal(isPermissionVersionConflict(error(409, 'version_conflict')), true)
    assert.equal(isPermissionVersionConflict(error(409, 'permission_form_closed')), false)
  })
})
