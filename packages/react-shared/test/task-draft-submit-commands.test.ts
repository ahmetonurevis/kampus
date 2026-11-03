import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import {
  commandFeedback,
  commandHeaders,
  createCommandSession,
  IF_MATCH_MISSING_CODE,
  invalidateInstitutionQueries,
  runCommand,
} from '../src/commands.ts'
import { institutionKey } from '../src/query-keys.ts'
import { TASK_ASSIGNMENTS_KEY } from '../src/use-task-assignments.ts'
import {
  submitTaskDraftCommand,
  submitTaskDraftRequest,
  submitTaskSubmissionCommand,
  TASK_DRAFT_ALREADY_SUBMITTED_MESSAGE,
  TASK_DRAFT_CHANGED_MESSAGE,
  TASK_DRAFT_KEY,
  TASK_DRAFT_SUBMIT_INVALIDATES,
  TASK_SUBMISSIONS_KEY,
} from '../src/use-task-submissions.ts'

// Yazma taslağından teslim komutu (IST-047; DOM-BEC-040, 044, 046): başlıklar, boş gövde,
// Türkçe hata metni, eskimiş taslağın tazelenmesi ve kurum anahtarlı geçersiz kılma.

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
      return new Response(JSON.stringify({ data: {} }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { client, sent }
}

const isMissing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === IF_MATCH_MISSING_CODE

const feedback = (code: string, status: number, message = 'Sunucu mesajı.') =>
  commandFeedback(new ApiError({ status, code, message }), submitTaskDraftCommand.messages)

describe('taslaktan teslim komutu', () => {
  test('IST-047: taslak teslimi POST …/draft/submit; okunan revizyonu If-Match, Idempotency-Key taşır, gövde boş', async () => {
    const { client, sent } = fakeClient()
    const input = { assignmentId: 'as 1', revision: 4 }
    await runRequest(() =>
      submitTaskDraftRequest(
        client,
        input,
        commandHeaders('key-12345', submitTaskDraftCommand.version(input)),
      ),
    )
    assert.deepEqual(
      sent.map((s) => [s.method, s.path, s.headers.get('if-match'), s.body]),
      [['POST', '/api/v1/task-assignments/as%201/draft/submit', '"4"', {}]],
    )
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
  })

  test('IST-047: kaydedilmiş taslak yoksa (revizyon null) teslim isteği atılmaz', async () => {
    const { client, sent } = fakeClient()
    const input = { assignmentId: 'as-1', revision: null }
    await assert.rejects(
      runRequest(() =>
        submitTaskDraftRequest(
          client,
          input,
          commandHeaders('key-12345', submitTaskDraftCommand.version(input)),
        ),
      ),
      isMissing,
    )
    assert.equal(sent.length, 0)
  })

  test('IST-047, DOM-BEC-040: zaten teslim edilen revizyon, boş taslak ve çakışma Türkçe ve anlaşılır', () => {
    const already = feedback('draft_already_submitted', 409)
    assert.equal(already.message, TASK_DRAFT_ALREADY_SUBMITTED_MESSAGE)
    assert.match(already.message ?? '', /zaten teslim edildi/)
    assert.equal(already.refresh, true)
    assert.equal(feedback('draft_conflict', 409).message, TASK_DRAFT_CHANGED_MESSAGE)
    assert.match(feedback('draft_empty', 422).message ?? '', /metninizi yazın/)
    assert.match(feedback('not_found', 404).message ?? '', /taslak bulunamadı/)
    // Sürüm sınırı sunucunun sayılı mesajıyla gelir.
    assert.equal(
      feedback('version_limit_reached', 422, 'En fazla 3 sürüm gönderebilirsiniz.').message,
      'En fazla 3 sürüm gönderebilirsiniz.',
    )
    // Metinle teslimin bütün iletileri taslak tesliminde de geçerlidir (not_found dışında).
    for (const [code, message] of Object.entries(submitTaskSubmissionCommand.messages))
      if (code !== 'not_found')
        assert.equal(
          submitTaskDraftCommand.messages[code as keyof typeof submitTaskDraftCommand.messages],
          message,
        )
    for (const message of Object.values(submitTaskDraftCommand.messages))
      assert.doesNotMatch(message, /[a-z]+_[a-z]+|HTTP/)
    assert.equal(submitTaskDraftCommand.exclusive, true)
  })
})

describe('taslaktan teslimde önbellek', () => {
  const keys = {
    submissions: institutionKey('inst-a', TASK_SUBMISSIONS_KEY, 'detail', 'ts-1'),
    assignments: institutionKey('inst-a', TASK_ASSIGNMENTS_KEY, 'list', { page: 1 }),
    draft: institutionKey('inst-a', TASK_DRAFT_KEY, 'as-1'),
    otherInstitution: institutionKey('inst-b', TASK_DRAFT_KEY, 'as-1'),
  }

  async function seeded() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    for (const queryKey of Object.values(keys))
      await queryClient.fetchQuery({ queryKey, queryFn: () => 'x', staleTime: Infinity })
    return queryClient
  }
  const invalidated = (queryClient: QueryClient) =>
    Object.entries(keys)
      .filter(([, key]) => queryClient.getQueryState(key)?.isInvalidated)
      .map(([name]) => name)

  async function failWith(error: ApiError) {
    const queryClient = await seeded()
    const toasts: string[] = []
    const outcome = await runCommand(
      createCommandSession(),
      {
        execute: () => Promise.reject(error),
        refresh: () =>
          invalidateInstitutionQueries(queryClient, 'inst-a', submitTaskDraftCommand.invalidates),
        refreshOn: submitTaskDraftCommand.refreshOn,
        messages: submitTaskDraftCommand.messages,
        exclusive: submitTaskDraftCommand.exclusive,
      },
      { assignmentId: 'as-1', revision: 2 },
      { notifyError: (message) => toasts.push(message) },
    )
    return { status: outcome.status, toasts, invalidated: invalidated(queryClient) }
  }

  test('IST-047: başarı yalnız etkin kurumun teslim, atama ve taslak sorgularını tazeler', async () => {
    const queryClient = await seeded()
    await invalidateInstitutionQueries(queryClient, 'inst-a', TASK_DRAFT_SUBMIT_INVALIDATES)
    assert.deepEqual(invalidated(queryClient), ['submissions', 'assignments', 'draft'])
  })

  test('IST-047: zaten teslim edilen revizyonda (409) taslak ve teslim tazelenir, tek Türkçe toast', async () => {
    const result = await failWith(
      new ApiError({ status: 409, code: 'draft_already_submitted', message: 'Sunucu.' }),
    )
    assert.deepEqual(result, {
      status: 'failed',
      toasts: [TASK_DRAFT_ALREADY_SUBMITTED_MESSAGE],
      invalidated: ['submissions', 'assignments', 'draft'],
    })
  })

  test('IST-047: boş ya da bulunamayan taslak ekrandaki taslağı eskitir; içerik engeli eskitmez', async () => {
    for (const error of [
      new ApiError({ status: 422, code: 'draft_empty', message: 'Boş.' }),
      new ApiError({ status: 404, code: 'not_found', message: 'Yok.' }),
    ])
      assert.deepEqual((await failWith(error)).invalidated, ['submissions', 'assignments', 'draft'])
    const closed = await failWith(
      new ApiError({ status: 422, code: 'submission_closed', message: 'Kapandı.' }),
    )
    assert.deepEqual(closed.invalidated, [])
    assert.deepEqual(closed.toasts, ['Bu görevin teslim süresi doldu.'])
  })
})
