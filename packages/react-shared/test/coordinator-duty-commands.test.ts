import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import {
  commandFeedback,
  commandHeaders,
  IF_MATCH_MISSING_CODE,
  invalidateInstitutionQueries,
} from '../src/commands.ts'
import { institutionKey } from '../src/query-keys.ts'
import {
  assignCoordinatorDutyCommand,
  assignCoordinatorDutyRequest,
  COORDINATOR_DUTIES_KEY,
  COORDINATOR_DUTY_INVALIDATES,
  fetchAllCoordinatorDuties,
  removeCoordinatorDutyCommand,
  removeCoordinatorDutyRequest,
} from '../src/use-coordinator-duties.ts'
import { TASK_ASSIGNMENTS_KEY } from '../src/use-task-assignments.ts'
import { TASK_SUBMISSIONS_KEY } from '../src/use-task-submissions.ts'

// Zümre başkanı / akademik koordinatör görevi komutları (DOM-YTK-027): yol, başlık, gövde, Türkçe
// hata metni, eskimiş görevin tazelenmesi ve kurum anahtarlı geçersiz kılma.

interface Sent {
  method: string
  url: URL
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
        url: new URL(request.url),
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      })
      return new Response(JSON.stringify({ data: {} }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { client, sent }
}

describe('koordinatör görevi komutları', () => {
  test('DOM-YTK-027: atama POST /coordinator-duties; Idempotency-Key taşır, If-Match taşımaz; gövde yalnız üyelik ve kapsam', async () => {
    const { client, sent } = fakeClient()
    const body = { membershipId: 'mem-selin', scopeId: 'english' }
    await runRequest(() => assignCoordinatorDutyRequest(client, body, commandHeaders('key-duty')))
    assert.equal(sent.length, 1)
    const [request] = sent
    assert.equal(request?.method, 'POST')
    assert.equal(request?.url.pathname, '/api/v1/coordinator-duties')
    assert.equal(request?.headers.get('idempotency-key'), 'key-duty')
    assert.equal(request?.headers.get('if-match'), null)
    assert.deepEqual(request?.body, body)
  })

  test('DOM-YTK-027: kaldırma DELETE /coordinator-duties/:id; okunan sürümü If-Match yapar', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() =>
      removeCoordinatorDutyRequest(
        client,
        { dutyId: 'duty 1', version: 3 },
        commandHeaders('key-remove', 3),
      ),
    )
    assert.deepEqual(
      sent.map((s) => [
        s.method,
        s.url.pathname,
        s.headers.get('if-match'),
        s.headers.get('idempotency-key'),
      ]),
      [['DELETE', '/api/v1/coordinator-duties/duty%201', '"3"', 'key-remove']],
    )
    assert.equal(removeCoordinatorDutyCommand.version({ dutyId: 'x', version: 3 }), 3)
  })

  test('DOM-YTK-027: okunan sürüm yoksa kaldırma isteği atılmaz', async () => {
    const { client, sent } = fakeClient()
    await assert.rejects(
      () =>
        runRequest(() =>
          removeCoordinatorDutyRequest(
            client,
            { dutyId: 'duty-1', version: 3 },
            commandHeaders('key-remove'),
          ),
        ),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === IF_MATCH_MISSING_CODE,
    )
    assert.equal(sent.length, 0)
  })

  test('DOM-YTK-027: atama hataları Türkçe metne çevrilir; bilinmeyen kod sunucunun mesajıyla', () => {
    const feedback = (code: string, status = 422) =>
      commandFeedback(
        new ApiError({ status, code, message: 'Sunucu mesajı.' }),
        assignCoordinatorDutyCommand.messages,
      ).message
    assert.equal(feedback('duty_requires_teacher'), 'Bu görev yalnız öğretmene verilir.')
    assert.match(feedback('duty_outside_branch') ?? '', /kendi branşında/)
    assert.match(feedback('teacher_record_required') ?? '', /kadro kaydı/)
    assert.equal(feedback('invalid_cefr_level'), 'Geçerli bir CEFR seviyesi seçin.')
    assert.equal(feedback('coordinator_duty_exists', 409), 'Bu görev öğretmene zaten verilmiş.')
    assert.equal(feedback('unknown_code', 500), 'Sunucu mesajı.')
  })

  test('DOM-YTK-027: kaldırmada sürüm çakışması ve kaldırılmış görev listeyi tazeler; 403 tazelemez', () => {
    const refresh = removeCoordinatorDutyCommand.refreshOn
    assert.equal(
      refresh(new ApiError({ status: 409, code: 'version_conflict', message: 'x' })),
      true,
    )
    assert.equal(refresh(new ApiError({ status: 404, code: 'not_found', message: 'x' })), true)
    assert.equal(refresh(new ApiError({ status: 403, code: 'forbidden', message: 'x' })), false)
    assert.equal(assignCoordinatorDutyCommand.exclusive, true)
    assert.equal(removeCoordinatorDutyCommand.exclusive, true)
  })

  test('DOM-YTK-027, DOM-BEC-024: atama ve kaldırma görev listesini ve puanlama kuyruğunu tazeler; atama ve başka kurum dokunulmaz', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const keys = {
      duties: institutionKey('inst-a', COORDINATOR_DUTIES_KEY, 'list', { page: 1 }),
      queue: institutionKey('inst-a', TASK_SUBMISSIONS_KEY, 'grading-queue', { page: 1 }),
      assignments: institutionKey('inst-a', TASK_ASSIGNMENTS_KEY, 'list', { page: 1 }),
      otherDuties: institutionKey('inst-b', COORDINATOR_DUTIES_KEY, 'list', { page: 1 }),
    }
    for (const command of [assignCoordinatorDutyCommand, removeCoordinatorDutyCommand]) {
      for (const key of Object.values(keys))
        await queryClient.fetchQuery({ queryKey: key, queryFn: () => 'x', staleTime: Infinity })
      await invalidateInstitutionQueries(queryClient, 'inst-a', command.invalidates)
      assert.deepEqual(
        Object.entries(keys)
          .filter(([, key]) => queryClient.getQueryState(key)?.isInvalidated)
          .map(([name]) => name),
        ['duties', 'queue'],
      )
      assert.equal(command.invalidates, COORDINATOR_DUTY_INVALIDATES)
      queryClient.clear()
    }
  })
})

describe('koordinatör görevi listesi', () => {
  test('DOM-YTK-027: bütün etkin görevler 100lük sayfalarla toplanır', async () => {
    const urls: string[] = []
    const duty = (index: number) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      membershipId: `m${index}`,
      kind: 'subject_head',
      scopeId: 'math',
      createdAt: '2026-11-02T08:00:00.000Z',
      archivedAt: null,
      rowVersion: 1,
    })
    const client = createKampusClient({
      baseUrl: 'https://api.kampus.test',
      credentials: 'include',
      requestId: () => undefined,
      fetch: async (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        urls.push(url.search)
        const page = Number(url.searchParams.get('page'))
        const start = (page - 1) * 100
        const data = Array.from({ length: Math.max(0, Math.min(100, 130 - start)) }, (_, i) =>
          duty(start + i + 1),
        )
        return new Response(JSON.stringify({ data, meta: { page, pageSize: 100, total: 130 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })
    const duties = await fetchAllCoordinatorDuties(client)
    assert.equal(duties.length, 130)
    assert.equal(duties[129]?.membershipId, 'm130')
    assert.deepEqual(urls, ['?page=1&pageSize=100', '?page=2&pageSize=100'])
  })
})
