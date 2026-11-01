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
  requestTaskResubmissionCommand,
  requestTaskResubmissionRequest,
  scoreTaskSubmissionCommand,
  scoreTaskSubmissionRequest,
  submissionStale,
  TASK_GRADING_INVALIDATES,
  TASK_SUBMISSION_CHANGED_MESSAGE,
} from '../src/use-task-grading.ts'
import { TASK_DRAFT_KEY, TASK_SUBMISSIONS_KEY } from '../src/use-task-submissions.ts'

// Öğretmen puanlaması komutları (F4b3b1; DOM-BEC-021, 040, 045): başlıklar, gövdeler, Türkçe hata
// metni, eskimiş teslimin tazelenmesi ve kurum anahtarlı geçersiz kılma.

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

const score = {
  versionNumber: 1,
  criteria: [
    { criterionId: 'task', band: 4, comment: null },
    { criterionId: 'grammar', band: 2, comment: 'Zaman uyumuna dikkat.' },
  ],
  overallComment: 'Paragraf düzeni iyi.',
}
const request = { versionNumber: 1, dueAt: '2026-10-10T20:59:00.000Z' }

describe('öğretmen puanlaması komutları', () => {
  test('DOM-BEC-021: puan teslimin altında POST eder; okunan sürümü If-Match, Idempotency-Key taşır; gövde toplam taşımaz', async () => {
    const { client, sent } = fakeClient()
    const input = { submissionId: 'ts 1', version: 3, score }
    await runRequest(() =>
      scoreTaskSubmissionRequest(client, input, commandHeaders('key-12345', 3)),
    )
    assert.equal(
      `${sent[0]?.method} ${sent[0]?.path}`,
      'POST /api/v1/task-submissions/ts%201/scores',
    )
    assert.equal(sent[0]?.headers.get('if-match'), '"3"')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.deepEqual(sent[0]?.body, score)
    assert.equal(scoreTaskSubmissionCommand.version(input), 3)
  })

  test('DOM-BEC-040: yeniden teslim isteği POST …/resubmission-requests; okunan sürümü If-Match taşır', async () => {
    const { client, sent } = fakeClient()
    const input = { submissionId: 'ts-1', version: 4, request }
    await runRequest(() =>
      requestTaskResubmissionRequest(client, input, commandHeaders('key-67890', 4)),
    )
    assert.deepEqual(
      sent.map((s) => [s.method, s.path, s.headers.get('if-match'), s.body]),
      [['POST', '/api/v1/task-submissions/ts-1/resubmission-requests', '"4"', request]],
    )
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-67890')
    assert.equal(requestTaskResubmissionCommand.version(input), 4)
  })

  test('DOM-BEC-021: okunan sürüm yoksa puan ve yeniden teslim isteği atılmaz', async () => {
    const { client, sent } = fakeClient()
    await assert.rejects(
      runRequest(() =>
        scoreTaskSubmissionRequest(
          client,
          { submissionId: 'ts-1', version: 1, score },
          commandHeaders('key-12345'),
        ),
      ),
      isMissing,
    )
    await assert.rejects(
      runRequest(() =>
        requestTaskResubmissionRequest(
          client,
          { submissionId: 'ts-1', version: 1, request },
          commandHeaders('key-12345'),
        ),
      ),
      isMissing,
    )
    assert.equal(sent.length, 0)
  })

  test('DOM-BEC-021, DOM-BEC-040: hata kodları Türkçe metne çevrilir; bilinmeyen kod sunucunun mesajıyla', () => {
    const feedback = (code: string, status = 409, message = 'Sunucu mesajı.') =>
      commandFeedback(new ApiError({ status, code, message }), scoreTaskSubmissionCommand.messages)
        .message
    assert.equal(feedback('version_conflict'), TASK_SUBMISSION_CHANGED_MESSAGE)
    assert.equal(feedback('rubric_score_exists'), 'Bu sürüm zaten puanlandı.')
    assert.match(feedback('version_not_latest') ?? '', /son sürümü puanlayın/)
    assert.equal(
      feedback('criterion_comment_required', 422),
      'Hedefin altında bant verilen kritere kısa yorum yazın.',
    )
    assert.equal(
      feedback('resubmission_not_graded'),
      'Yeniden teslim, puanı kesinleşen sürüm için istenir.',
    )
    assert.equal(
      feedback('band_unknown', 422, 'Bant 0–5 arasında olmalıdır.'),
      'Bant 0–5 arasında olmalıdır.',
    )
    assert.equal(scoreTaskSubmissionCommand.messages, requestTaskResubmissionCommand.messages)
    assert.equal(scoreTaskSubmissionCommand.exclusive, true)
  })
})

describe('eskimiş teslimin tazelenmesi', () => {
  async function failWith(error: ApiError) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const key = institutionKey('inst-a', TASK_SUBMISSIONS_KEY, 'detail', 'ts-1')
    await queryClient.fetchQuery({ queryKey: key, queryFn: () => 'x', staleTime: Infinity })
    const toasts: string[] = []
    const outcome = await runCommand(
      createCommandSession(),
      {
        execute: () => Promise.reject(error),
        refresh: () =>
          invalidateInstitutionQueries(
            queryClient,
            'inst-a',
            scoreTaskSubmissionCommand.invalidates,
          ),
        refreshOn: scoreTaskSubmissionCommand.refreshOn,
        messages: scoreTaskSubmissionCommand.messages,
        exclusive: scoreTaskSubmissionCommand.exclusive,
      },
      {},
      { notifyError: (message) => toasts.push(message) },
    )
    return {
      status: outcome.status,
      toasts,
      refreshed: queryClient.getQueryState(key)?.isInvalidated,
    }
  }

  test('DOM-BEC-021: 409 (sürüm çakıştı, yeni sürüm geldi, zaten puanlandı) teslimi tazeler; 422 kriter hatası tazelemez', async () => {
    assert.deepEqual(
      await failWith(
        new ApiError({ status: 409, code: 'version_conflict', message: 'Kayıt değişti.' }),
      ),
      { status: 'failed', toasts: [TASK_SUBMISSION_CHANGED_MESSAGE], refreshed: true },
    )
    const invalid = await failWith(
      new ApiError({ status: 422, code: 'rubric_criterion_missing', message: 'Eksik.' }),
    )
    assert.equal(invalid.refreshed, false)
    assert.deepEqual(invalid.toasts, ['Her kritere bant verin.'])
    assert.equal(
      submissionStale(new ApiError({ status: 404, code: 'not_found', message: 'Yok.' })),
      true,
    )
    assert.equal(
      submissionStale(new ApiError({ status: 403, code: 'forbidden', message: 'Yetki yok.' })),
      false,
    )
  })
})

describe('kurum anahtarlı geçersiz kılma', () => {
  test('DOM-BEC-021, DOM-BEC-045: puan ve istek yalnız etkin kurumun teslim, liste ve kuyruk sorgularını tazeler', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const keys = {
      detail: institutionKey('inst-a', TASK_SUBMISSIONS_KEY, 'detail', 'ts-1'),
      queue: institutionKey('inst-a', TASK_SUBMISSIONS_KEY, 'grading-queue', { page: 1 }),
      assignments: institutionKey('inst-a', TASK_ASSIGNMENTS_KEY, 'list', { page: 1 }),
      draft: institutionKey('inst-a', TASK_DRAFT_KEY, 'as-1'),
      otherInstitution: institutionKey('inst-b', TASK_SUBMISSIONS_KEY, 'detail', 'ts-1'),
    }
    for (const key of Object.values(keys))
      await queryClient.fetchQuery({ queryKey: key, queryFn: () => 'x', staleTime: Infinity })
    await invalidateInstitutionQueries(queryClient, 'inst-a', TASK_GRADING_INVALIDATES)
    assert.deepEqual(
      Object.entries(keys)
        .filter(([, key]) => queryClient.getQueryState(key)?.isInvalidated)
        .map(([name]) => name),
      ['detail', 'queue'],
    )
  })
})
