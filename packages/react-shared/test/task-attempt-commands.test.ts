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
import {
  saveTaskAttemptAnswersCommand,
  saveTaskAttemptAnswersRequest,
  startTaskAttemptCommand,
  startTaskAttemptRequest,
  submitTaskAttemptCommand,
  submitTaskAttemptRequest,
  TASK_ATTEMPT_ANSWER_INVALIDATES,
  TASK_ATTEMPT_CHANGED_MESSAGE,
  TASK_ATTEMPT_INVALIDATES,
  TASK_ATTEMPTS_KEY,
} from '../src/use-task-attempts.ts'
import { TASK_ASSIGNMENTS_KEY } from '../src/use-task-assignments.ts'
import {
  saveTaskDraftCommand,
  saveTaskDraftRequest,
  submitTaskSubmissionCommand,
  submitTaskSubmissionRequest,
  TASK_DRAFT_CHANGED_MESSAGE,
  TASK_DRAFT_INVALIDATES,
  TASK_DRAFT_SAVED_ELSEWHERE_MESSAGE,
  TASK_DRAFT_KEY,
  TASK_SUBMISSION_INVALIDATES,
  TASK_SUBMISSIONS_KEY,
} from '../src/use-task-submissions.ts'

// Görev denemesi ve yazma teslimi komutları (DOM-BEC-010, 040, 042…046; IST-047, IST-051):
// başlıklar, gövdeler, Türkçe hata metni ve kurum anahtarlı geçersiz kılma.

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
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { client, sent }
}

const isMissing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === IF_MATCH_MISSING_CODE

const answers = { 'qv-1': { questionType: 'multiple_choice', optionId: 'b' } } as const

describe('görev denemesi komutları', () => {
  test('DOM-BEC-042: başlatma atamanın altında POST eder, gövde {}, Idempotency-Key taşır, If-Match taşımaz', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() =>
      startTaskAttemptRequest(client, { assignmentId: 'as 1' }, commandHeaders('key-12345', 3)),
    )
    assert.equal(
      `${sent[0]?.method} ${sent[0]?.path}`,
      'POST /api/v1/task-assignments/as%201/attempts',
    )
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.deepEqual(sent[0]?.body, {})
  })

  test('DOM-BEC-043: cevap kaydı PATCH, teslim POST /submit; ikisi de okunan sürümü If-Match taşır', async () => {
    const { client, sent } = fakeClient()
    const input = { attemptId: 'at-1', version: 4, answers }
    await runRequest(() =>
      saveTaskAttemptAnswersRequest(client, input, commandHeaders('key-12345', 4)),
    )
    await runRequest(() =>
      submitTaskAttemptRequest(
        client,
        { attemptId: 'at-1', version: 5 },
        commandHeaders('key-67890', 5),
      ),
    )
    assert.deepEqual(
      sent.map((s) => [s.method, s.path, s.headers.get('if-match'), s.body]),
      [
        ['PATCH', '/api/v1/task-attempts/at-1', '"4"', { answers }],
        ['POST', '/api/v1/task-attempts/at-1/submit', '"5"', {}],
      ],
    )
    assert.equal(sent[1]?.headers.get('idempotency-key'), 'key-67890')
    assert.equal(saveTaskAttemptAnswersCommand.version(input), 4)
    assert.equal(submitTaskAttemptCommand.version(input), 4)
  })

  test('DOM-BEC-043: okunan sürüm yoksa cevap kaydı ve teslim isteği atılmaz', async () => {
    const { client, sent } = fakeClient()
    const input = { attemptId: 'at-1', version: 1 }
    await assert.rejects(
      runRequest(() => saveTaskAttemptAnswersRequest(client, input, commandHeaders('key-12345'))),
      isMissing,
    )
    await assert.rejects(
      runRequest(() => submitTaskAttemptRequest(client, input, commandHeaders('key-12345'))),
      isMissing,
    )
    assert.equal(sent.length, 0)
  })

  test('DOM-BEC-042, DOM-BEC-043: hata kodları Türkçe metne çevrilir; bilinmeyen kodda sunucunun mesajı', () => {
    const feedback = (code: string, status = 422) =>
      commandFeedback(
        new ApiError({ status, code, message: 'Sunucu mesajı.' }),
        startTaskAttemptCommand.messages,
      ).message
    assert.equal(feedback('attempt_limit_reached'), 'Bu görev için deneme hakkınız doldu.')
    assert.equal(feedback('attempt_in_progress', 409), 'Süren bir denemeniz var; ona devam edin.')
    assert.equal(feedback('version_conflict', 409), TASK_ATTEMPT_CHANGED_MESSAGE)
    assert.equal(feedback('submission_closed'), 'Bu görevin teslim süresi doldu.')
    assert.equal(feedback('answer_invalid'), 'Sunucu mesajı.')
    for (const command of [
      startTaskAttemptCommand,
      saveTaskAttemptAnswersCommand,
      submitTaskAttemptCommand,
    ])
      assert.equal(command.exclusive, true)
  })
})

describe('yazma taslağı ve teslim komutları', () => {
  test('IST-047: ilk taslak kaydı If-Match taşımaz; taslak varken okunan revizyonu taşır', async () => {
    const { client, sent } = fakeClient()
    const first = { assignmentId: 'as-1', revision: null, body: 'Taslak' }
    const next = { assignmentId: 'as-1', revision: 2, body: 'Taslak 2' }
    await runRequest(() =>
      saveTaskDraftRequest(
        client,
        first,
        commandHeaders('key-12345', saveTaskDraftCommand.version(first)),
      ),
    )
    await runRequest(() =>
      saveTaskDraftRequest(
        client,
        next,
        commandHeaders('key-67890', saveTaskDraftCommand.version(next)),
      ),
    )
    assert.deepEqual(
      sent.map((s) => [s.method, s.path, s.headers.get('if-match'), s.body]),
      [
        ['PATCH', '/api/v1/task-assignments/as-1/draft', null, { body: 'Taslak' }],
        ['PATCH', '/api/v1/task-assignments/as-1/draft', '"2"', { body: 'Taslak 2' }],
      ],
    )
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
  })

  test('DOM-BEC-040: teslim atamanın altında POST eder, Idempotency-Key taşır, If-Match taşımaz', async () => {
    const { client, sent } = fakeClient()
    const submission = { submissionKind: 'text' as const, body: 'My weekend.' }
    await runRequest(() =>
      submitTaskSubmissionRequest(
        client,
        { assignmentId: 'as-1', submission },
        commandHeaders('key-12345', 7),
      ),
    )
    assert.equal(
      `${sent[0]?.method} ${sent[0]?.path}`,
      'POST /api/v1/task-assignments/as-1/submissions',
    )
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.deepEqual(sent[0]?.body, submission)
    assert.equal('version' in submitTaskSubmissionCommand, false)
  })

  test('DOM-BEC-040, DOM-BEC-044: hata kodları Türkçe metne çevrilir; sürüm sınırı sunucunun mesajıyla', () => {
    const feedback = (code: string, status = 422, message = 'Sunucu mesajı.') =>
      commandFeedback(new ApiError({ status, code, message }), submitTaskSubmissionCommand.messages)
        .message
    assert.equal(feedback('draft_conflict', 409), TASK_DRAFT_CHANGED_MESSAGE)
    assert.equal(feedback('submission_closed'), 'Bu görevin teslim süresi doldu.')
    // OG-048 sesli ve dosyalı teslimi açtı: eski "henüz açık değil" iletisi kalktı.
    assert.equal('submission_kind_unavailable' in submitTaskSubmissionCommand.messages, false)
    assert.equal(
      feedback('version_limit_reached', 422, 'En fazla 3 sürüm gönderebilirsiniz.'),
      'En fazla 3 sürüm gönderebilirsiniz.',
    )
    assert.equal(
      feedback('submission_locked', 409),
      'Bu teslim için şu an yeni sürüm gönderilemez.',
    )
    for (const [code, message] of Object.entries(submitTaskSubmissionCommand.messages))
      assert.equal(
        saveTaskDraftCommand.messages[code as keyof typeof saveTaskDraftCommand.messages],
        message,
      )
    assert.equal(saveTaskDraftCommand.exclusive, true)
  })

  test('IST-051, DOM-BEC-050, DOM-BEC-054: sesli teslimin rıza ve kayıt hataları teknik ayrıntısız Türkçe', () => {
    const feedback = (code: string, status = 422, message = 'Sunucu mesajı.') =>
      commandFeedback(new ApiError({ status, code, message }), submitTaskSubmissionCommand.messages)
        .message
    assert.match(feedback('consent_required', 403) ?? '', /yüz yüze değerlendirilecek/)
    assert.match(feedback('file_not_ready') ?? '', /işleniyor/)
    assert.match(feedback('file_unavailable') ?? '', /yeniden kaydedin/)
    assert.match(feedback('file_already_attached', 409) ?? '', /zaten gönderildi/)
    // Kayıt ölçüm hataları core'un iletisiyle gelir (süre sınırı sayısı sunucudadır).
    assert.equal(
      feedback('recording_too_long', 422, 'Kayıt en fazla 60 saniye olabilir.'),
      'Kayıt en fazla 60 saniye olabilir.',
    )
    for (const message of Object.values(submitTaskSubmissionCommand.messages))
      assert.doesNotMatch(message, /[a-z]+_[a-z]+|HTTP/)
  })

  test('IST-051: sesli teslim gövdesi yalnız kayıt kimliğini taşır', async () => {
    const { client, sent } = fakeClient()
    const submission = { submissionKind: 'audio' as const, recordingFileId: 'file-9' }
    await runRequest(() =>
      submitTaskSubmissionRequest(
        client,
        { assignmentId: 'as-2', submission },
        commandHeaders('key-67890', null),
      ),
    )
    assert.equal(
      `${sent[0]?.method} ${sent[0]?.path}`,
      'POST /api/v1/task-assignments/as-2/submissions',
    )
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.deepEqual(sent[0]?.body, submission)
  })
})

describe('eskimiş ekran verisinin tazelenmesi', () => {
  /**
   * `useApiCommand`'in yürüttüğü adımlar (React'siz): istek verilen hatayla düşer; tazeleme komutun
   * önekleriyle etkin kurumun sorgularını geçersiz kılar, mesaj toast'a gider.
   */
  async function failWith(
    command: {
      invalidates: readonly (readonly unknown[])[]
      refreshOn?: (error: ApiError) => boolean
      messages: Readonly<Partial<Record<string, string>>>
      exclusive: boolean
    },
    error: ApiError,
  ) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const keys = [
      institutionKey('inst-a', TASK_DRAFT_KEY, 'as-1'),
      institutionKey('inst-a', TASK_ATTEMPTS_KEY, 'detail', 'at-1'),
    ]
    for (const queryKey of keys)
      await queryClient.fetchQuery({ queryKey, queryFn: () => 'x', staleTime: Infinity })
    const toasts: string[] = []
    const outcome = await runCommand(
      createCommandSession(),
      {
        execute: () => Promise.reject(error),
        refresh: () => invalidateInstitutionQueries(queryClient, 'inst-a', command.invalidates),
        refreshOn: command.refreshOn,
        messages: command.messages,
        exclusive: command.exclusive,
      },
      {},
      { notifyError: (message) => toasts.push(message) },
    )
    const [draft, attempt] = keys.map((key) => queryClient.getQueryState(key)?.isInvalidated)
    return { status: outcome.status, toasts, draft, attempt }
  }

  test('IST-047: taslak başka pencerede ilk kez kaydedildiyse (400 if_match_required) taslak yeniden çekilir ve Türkçe mesaj gösterilir', async () => {
    const result = await failWith(
      saveTaskDraftCommand,
      new ApiError({ status: 400, code: 'if_match_required', message: 'If-Match gerekli.' }),
    )
    assert.deepEqual(result, {
      status: 'failed',
      toasts: [TASK_DRAFT_SAVED_ELSEWHERE_MESSAGE],
      draft: true,
      attempt: false,
    })
    assert.equal(
      TASK_DRAFT_SAVED_ELSEWHERE_MESSAGE,
      'Taslak başka bir pencerede kaydedildi, son hâli yüklendi.',
    )
    // Başka 400 (doğrulama) ekranı eskitmez.
    const invalid = await failWith(
      saveTaskDraftCommand,
      new ApiError({ status: 400, code: 'validation_failed', message: 'Metin çok uzun.' }),
    )
    assert.equal(invalid.draft, false)
  })

  test('DOM-BEC-043: süre dolunca (422 attempt_time_over) mesaj sunucuyla uyumlu ve deneme tazelenir; cevap kaydında da teslimde de', async () => {
    const timeOver = new ApiError({
      status: 422,
      code: 'attempt_time_over',
      message: 'Süre doldu; cevaplar kaydedilmedi.',
    })
    for (const command of [saveTaskAttemptAnswersCommand, submitTaskAttemptCommand]) {
      const result = await failWith(command, timeOver)
      assert.equal(result.attempt, true)
      assert.equal(result.draft, false)
      assert.deepEqual(result.toasts, ['Süre doldu; son cevaplarınız kaydedilmedi.'])
    }
    // Başlatmanın 422'si (hak doldu) ekrandaki denemeyi eskitmez.
    const limit = await failWith(
      startTaskAttemptCommand,
      new ApiError({ status: 422, code: 'attempt_limit_reached', message: 'Hak doldu.' }),
    )
    assert.equal(limit.attempt, false)
  })
})

describe('kurum anahtarlı geçersiz kılma', () => {
  test('DOM-BEC-042, DOM-BEC-040, IST-047: yazmalar yalnız etkin kurumun ilgili sorgularını tazeler', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const keys = {
      attempts: institutionKey('inst-a', TASK_ATTEMPTS_KEY, 'detail', 'at-1'),
      assignments: institutionKey('inst-a', TASK_ASSIGNMENTS_KEY, 'list', { page: 1 }),
      submissions: institutionKey('inst-a', TASK_SUBMISSIONS_KEY, 'detail', 'ts-1'),
      draft: institutionKey('inst-a', TASK_DRAFT_KEY, 'as-1'),
      otherInstitution: institutionKey('inst-b', TASK_ATTEMPTS_KEY, 'detail', 'at-1'),
    }
    const invalidatedBy = async (prefixes: readonly (readonly unknown[])[]) => {
      for (const key of Object.values(keys))
        await queryClient.fetchQuery({ queryKey: key, queryFn: () => 'x', staleTime: Infinity })
      await invalidateInstitutionQueries(queryClient, 'inst-a', prefixes)
      const result = Object.entries(keys)
        .filter(([, key]) => queryClient.getQueryState(key)?.isInvalidated)
        .map(([name]) => name)
      queryClient.clear()
      return result
    }
    assert.deepEqual(await invalidatedBy(TASK_ATTEMPT_INVALIDATES), ['attempts', 'assignments'])
    assert.deepEqual(await invalidatedBy(TASK_ATTEMPT_ANSWER_INVALIDATES), ['attempts'])
    assert.deepEqual(await invalidatedBy(TASK_SUBMISSION_INVALIDATES), [
      'assignments',
      'submissions',
    ])
    assert.deepEqual(await invalidatedBy(TASK_DRAFT_INVALIDATES), ['draft'])
  })
})
