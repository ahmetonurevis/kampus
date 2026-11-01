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
  decideTaskAppealCommand,
  decideTaskAppealRequest,
  drawSecondRatingSampleCommand,
  drawSecondRatingSampleRequest,
  fileTaskAppealCommand,
  fileTaskAppealRequest,
  requestSecondRatingCommand,
  requestSecondRatingRequest,
  requestTaskResubmissionCommand,
  requestTaskResubmissionRequest,
  scoreTaskSubmissionCommand,
  scoreTaskSubmissionRequest,
  secondScoreTaskSubmissionCommand,
  secondScoreTaskSubmissionRequest,
  SECOND_RATING_SAMPLE_INVALIDATES,
  submissionStale,
  TASK_APPEAL_MESSAGES,
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
      feedback('submission_version_not_found', 404, 'Teslim sürümü bulunamadı.'),
      'Puanlanan sürüm bulunamadı; teslimin güncel hâli yüklendi.',
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

  test('DOM-BEC-021: 409 (sürüm çakıştı, yeni sürüm geldi, zaten puanlandı) ve 404 (teslim veya sürüm yok) teslimi tazeler; 422 kriter hatası tazelemez', async () => {
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
    assert.deepEqual(
      await failWith(
        new ApiError({
          status: 404,
          code: 'submission_version_not_found',
          message: 'Teslim sürümü bulunamadı.',
        }),
      ),
      {
        status: 'failed',
        toasts: ['Puanlanan sürüm bulunamadı; teslimin güncel hâli yüklendi.'],
        refreshed: true,
      },
    )
    assert.equal(
      submissionStale(new ApiError({ status: 404, code: 'resource_missing', message: 'Yok.' })),
      false,
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

// İkinci puanlama ve itiraz komutları (F4b3b2a; DOM-BEC-024, 025).

const decision = {
  outcome: 'upheld',
  reason: 'Kriterler yeniden okundu.',
  score: { criteria: score.criteria, overallComment: score.overallComment },
} as const
const appeal = { versionNumber: 1, reason: 'Dilbilgisi puanını yeniden inceleyin.' }

describe('ikinci puanlama ve itiraz komutları', () => {
  test('DOM-BEC-024: ikinci puan, elle istem ve örneklem doğru yola POST eder; okunan sürümü If-Match, Idempotency-Key taşır', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() =>
      secondScoreTaskSubmissionRequest(
        client,
        { submissionId: 'ts-1', version: 5, score },
        commandHeaders('key-second', 5),
      ),
    )
    await runRequest(() =>
      requestSecondRatingRequest(
        client,
        { submissionId: 'ts-1', version: 6, request: { versionNumber: 1 } },
        commandHeaders('key-istem1', 6),
      ),
    )
    await runRequest(() =>
      drawSecondRatingSampleRequest(
        client,
        { assignmentId: 'as 1', version: 7 },
        commandHeaders('key-sample', 7),
      ),
    )
    assert.deepEqual(
      sent.map((s) => [
        s.method,
        s.path,
        s.headers.get('if-match'),
        s.headers.get('idempotency-key'),
        s.body,
      ]),
      [
        ['POST', '/api/v1/task-submissions/ts-1/second-scores', '"5"', 'key-second', score],
        [
          'POST',
          '/api/v1/task-submissions/ts-1/second-rating-requests',
          '"6"',
          'key-istem1',
          { versionNumber: 1 },
        ],
        ['POST', '/api/v1/task-assignments/as%201/second-rating-sample', '"7"', 'key-sample', {}],
      ],
    )
    assert.equal(secondScoreTaskSubmissionCommand.version({ version: 5 }), 5)
    assert.equal(requestSecondRatingCommand.version({ version: 6 }), 6)
    assert.equal(drawSecondRatingSampleCommand.version({ version: 7 }), 7)
  })

  test('DOM-BEC-025: itiraz If-Match taşımaz, Idempotency-Key taşır; karar teslimin sürümünü If-Match yapar', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() =>
      fileTaskAppealRequest(client, { submissionId: 'ts-1', appeal }, commandHeaders('key-appeal')),
    )
    await runRequest(() =>
      decideTaskAppealRequest(
        client,
        { submissionId: 'ts-1', appealId: 'ap 1', version: 8, decision },
        commandHeaders('key-decide', 8),
      ),
    )
    assert.deepEqual(
      sent.map((s) => [
        s.method,
        s.path,
        s.headers.get('if-match'),
        s.headers.get('idempotency-key'),
        s.body,
      ]),
      [
        ['POST', '/api/v1/task-submissions/ts-1/appeals', null, 'key-appeal', appeal],
        [
          'POST',
          '/api/v1/task-submissions/ts-1/appeals/ap%201/decision',
          '"8"',
          'key-decide',
          decision,
        ],
      ],
    )
    assert.equal(decideTaskAppealCommand.version({ version: 8 }), 8)
    assert.equal('version' in fileTaskAppealCommand, false)
  })

  test('DOM-BEC-024, DOM-BEC-025: okunan sürüm yoksa ikinci puan, istem, örneklem ve karar atılmaz', async () => {
    const { client, sent } = fakeClient()
    const missing = commandHeaders('key-12345')
    await assert.rejects(
      runRequest(() =>
        secondScoreTaskSubmissionRequest(
          client,
          { submissionId: 'ts-1', version: 1, score },
          missing,
        ),
      ),
      isMissing,
    )
    await assert.rejects(
      runRequest(() =>
        requestSecondRatingRequest(
          client,
          { submissionId: 'ts-1', version: 1, request: { versionNumber: 1 } },
          missing,
        ),
      ),
      isMissing,
    )
    await assert.rejects(
      runRequest(() =>
        drawSecondRatingSampleRequest(client, { assignmentId: 'as-1', version: 1 }, missing),
      ),
      isMissing,
    )
    await assert.rejects(
      runRequest(() =>
        decideTaskAppealRequest(
          client,
          { submissionId: 'ts-1', appealId: 'ap-1', version: 1, decision },
          missing,
        ),
      ),
      isMissing,
    )
    assert.equal(sent.length, 0)
  })

  test('DOM-BEC-024, DOM-BEC-025: hata kodları Türkçe metne çevrilir; itirazda kursiyer metinleri', () => {
    const feedback = (
      messages: Parameters<typeof commandFeedback>[1],
      code: string,
      status = 409,
    ) =>
      commandFeedback(new ApiError({ status, code, message: 'Sunucu mesajı.' }), messages).message
    const grading = secondScoreTaskSubmissionCommand.messages
    assert.match(feedback(grading, 'second_rating_sample_pending') ?? '', /örneklem/)
    assert.match(feedback(grading, 'second_rating_window_open') ?? '', /yeni sürüm gönderemez/)
    assert.equal(
      feedback(grading, 'second_rating_exists'),
      'Bu teslim için ikinci puanlama zaten istendi.',
    )
    assert.equal(
      feedback(grading, 'second_rating_not_requested'),
      'Bu teslim için ikinci puanlama istenmedi.',
    )
    assert.equal(
      feedback(grading, 'second_rating_sample_drawn'),
      'Bu görevin ikinci puanlama örneklemi zaten seçildi.',
    )
    assert.equal(
      feedback(decideTaskAppealCommand.messages, 'rater_not_independent'),
      'Bu teslimi daha önce puanladınız; bağımsız bir öğretmen puanlamalı.',
    )
    assert.equal(
      feedback(decideTaskAppealCommand.messages, 'appeal_decided'),
      'Bu itiraz zaten sonuçlandı.',
    )
    assert.equal(fileTaskAppealCommand.messages, TASK_APPEAL_MESSAGES)
    assert.equal(
      feedback(fileTaskAppealCommand.messages, 'appeal_not_open'),
      'Sonuç duyurulmadan itiraz edilemez.',
    )
    assert.match(
      feedback(fileTaskAppealCommand.messages, 'appeal_window_closed', 422) ?? '',
      /5 iş günü/,
    )
    assert.equal(
      feedback(fileTaskAppealCommand.messages, 'appeal_not_available', 422),
      'Alıştırma sonucuna itiraz edilmez.',
    )
    assert.equal(
      feedback(fileTaskAppealCommand.messages, 'appeal_exists'),
      'Bu sonuca zaten itiraz edildi.',
    )
    assert.equal(
      feedback(fileTaskAppealCommand.messages, 'appeal_not_latest'),
      'Yalnız son teslim sürümünün sonucuna itiraz edilebilir.',
    )
    assert.match(
      feedback(drawSecondRatingSampleCommand.messages, 'second_rating_sample_unavailable') ?? '',
      /Son tarihi olmayan görevde örneklem seçilmez/,
    )
    assert.equal(feedback(fileTaskAppealCommand.messages, 'unknown_code', 500), 'Sunucu mesajı.')
  })

  test('DOM-BEC-024, DOM-BEC-025: eskimiş teslimde (409, 404) tazeleme; itirazda 422 süre hatası tazelemez', () => {
    const conflict = new ApiError({ status: 409, code: 'version_conflict', message: 'x' })
    const window = new ApiError({ status: 422, code: 'appeal_window_closed', message: 'x' })
    for (const command of [
      secondScoreTaskSubmissionCommand,
      requestSecondRatingCommand,
      fileTaskAppealCommand,
      decideTaskAppealCommand,
      drawSecondRatingSampleCommand,
    ]) {
      assert.equal(command.refreshOn(conflict), true)
      assert.equal(command.refreshOn(window), false)
      assert.equal(command.exclusive, true)
    }
  })

  test('DOM-BEC-024: örneklem teslim ve atama sorgularını, ikinci puan ve itiraz teslim sorgularını tazeler; başka kurum dokunulmaz', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const keys = {
      detail: institutionKey('inst-a', TASK_SUBMISSIONS_KEY, 'detail', 'ts-1'),
      queue: institutionKey('inst-a', TASK_SUBMISSIONS_KEY, 'grading-queue', { page: 1 }),
      assignments: institutionKey('inst-a', TASK_ASSIGNMENTS_KEY, 'list', { page: 1 }),
      draft: institutionKey('inst-a', TASK_DRAFT_KEY, 'as-1'),
      otherAssignments: institutionKey('inst-b', TASK_ASSIGNMENTS_KEY, 'list', { page: 1 }),
    }
    const touched = async (invalidates: Parameters<typeof invalidateInstitutionQueries>[2]) => {
      for (const key of Object.values(keys))
        await queryClient.fetchQuery({ queryKey: key, queryFn: () => 'x', staleTime: Infinity })
      await invalidateInstitutionQueries(queryClient, 'inst-a', invalidates)
      return Object.entries(keys)
        .filter(([, key]) => queryClient.getQueryState(key)?.isInvalidated)
        .map(([name]) => name)
    }
    assert.deepEqual(await touched(SECOND_RATING_SAMPLE_INVALIDATES), [
      'detail',
      'queue',
      'assignments',
    ])
    queryClient.clear()
    for (const command of [
      secondScoreTaskSubmissionCommand,
      requestSecondRatingCommand,
      fileTaskAppealCommand,
      decideTaskAppealCommand,
    ]) {
      assert.deepEqual(await touched(command.invalidates), ['detail', 'queue'])
      queryClient.clear()
    }
    assert.equal(drawSecondRatingSampleCommand.invalidates, SECOND_RATING_SAMPLE_INVALIDATES)
  })
})
