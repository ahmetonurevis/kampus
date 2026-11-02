import { keepPreviousData, useQuery } from '@tanstack/react-query'

import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { components, operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import { requireIfMatch, type CommandHeaders, type CommandMessages } from './commands.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { LEARNER_CONTENT_MESSAGES, TASK_ASSIGNMENTS_KEY } from './use-task-assignments.ts'

/**
 * Otomatik puanlı görev denemesi kancaları (`/api/v1/task-attempts`; ADR 0004 karar 5, 6;
 * DOM-BEC-010, 042…045): liste, ayrıntı, başlatma, cevap kaydı ve teslim. Puan, süre ve anahtarın
 * açılması sunucudadır; burada çağrı, önbellek tazeleme ve Türkçe hata metni vardır. Başlatma
 * `If-Match` kabul etmez; cevap kaydı ve teslim denemenin okunan `rowVersion`'ını ister, yoksa
 * istek atılmaz (`requireIfMatch`). Her yazma kullanıcı eylemi başına `Idempotency-Key` taşır
 * (başlatma ve teslimde sunucu zorunlu tutar).
 */

export const TASK_ATTEMPTS_KEY = 'task-attempts'
/** Deneme yazmaları denemeleri ve kursiyerin atama görünümünü değiştirebilir. */
export const TASK_ATTEMPT_INVALIDATES = [[TASK_ATTEMPTS_KEY], [TASK_ASSIGNMENTS_KEY]] as const
/** Otomatik cevap kaydı yalnız denemeleri tazeler (atama listesi her kayıtta yeniden çekilmez). */
export const TASK_ATTEMPT_ANSWER_INVALIDATES = [[TASK_ATTEMPTS_KEY]] as const

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type TaskAttemptListQuery = NonNullable<
  operations['listTaskAttempts']['parameters']['query']
>
export type TaskAttempt = components['schemas']['TaskAttempt']
export type TaskAttemptDetail = components['schemas']['TaskAttemptDetail']
/** Okuma-anlama etkinliğinin metni (IST-042): seviye, kelime sayısı, sözlükçe; bağ yoksa `null`. */
export type TaskAttemptPassage = NonNullable<TaskAttemptDetail['passage']>
/** Alt beceri dökümünün satırı (DOM-BEC-006); madde sonuçlarıyla aynı anda açılır. */
export type TaskAttemptSubskillScore = components['schemas']['TaskAttemptSubskillScore']
export type TaskAttemptAnswers = JsonBody<'saveTaskAttemptAnswers'>['answers']

/** Deneme bu arada başka pencerede değişti (`If-Match` tutmadı): güncel hâli yüklenir. */
export const TASK_ATTEMPT_CHANGED_MESSAGE =
  'Deneme başka bir pencerede değişti. Güncel hâli yüklendi; yeniden deneyin.'

export const TASK_ATTEMPT_MESSAGES = {
  ...LEARNER_CONTENT_MESSAGES,
  not_found: 'Görev bulunamadı.',
  version_conflict: TASK_ATTEMPT_CHANGED_MESSAGE,
  attempt_limit_reached: 'Bu görev için deneme hakkınız doldu.',
  attempt_in_progress: 'Süren bir denemeniz var; ona devam edin.',
  attempt_already_submitted: 'Bu deneme zaten teslim edildi.',
  attempt_time_over: 'Süre doldu; son cevaplarınız kaydedilmedi.',
  submission_closed: 'Bu görevin teslim süresi doldu.',
  not_auto_scored: 'Bu görev deneme olarak çözülmez; teslim ekranını kullanın.',
} as const satisfies CommandMessages

/**
 * Kural hatası (422: süre doldu, teslim kapandı, geçersiz cevap) denemenin ekrandaki durumunu
 * eskitir: süre dolan deneme sunucuda kaydedilmiş cevaplarla teslim sayılır. Deneme tazelenir.
 */
export const attemptStale = (error: ApiError) => error.status === 422

/** Atamanın denemeleri (rol kapsamlı, sayfalı); sorgu değişirken önceki sayfa ekranda kalır. */
export function useTaskAttempts(query: TaskAttemptListQuery) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, TASK_ATTEMPTS_KEY, 'list', query),
    queryFn: ({ signal }) =>
      runRequest(() => client.GET('/api/v1/task-attempts', { params: { query }, signal })),
    enabled: institutionId !== null && query.assignmentId !== '',
    placeholderData: keepPreviousData,
  })
}

/** Tek deneme, soruları ve (açıldıysa) sonucu; `attemptId` boşken istek atılmaz. */
export function useTaskAttempt(attemptId: string) {
  return useApiQuery({
    key: [TASK_ATTEMPTS_KEY, 'detail', attemptId],
    request: (client, signal) =>
      client.GET('/api/v1/task-attempts/{attemptId}', {
        params: { path: { attemptId } },
        signal,
      }),
    enabled: attemptId !== '',
  })
}

/** Başlatma `If-Match` kabul etmez (sunucu 400 `if_match_not_supported`); gövde `{}`. */
export function startTaskAttemptRequest(
  client: KampusClient,
  { assignmentId }: { assignmentId: string },
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/task-assignments/{assignmentId}/attempts', {
    params: {
      path: { assignmentId },
      header: { 'idempotency-key': headers['idempotency-key'] },
    },
    body: {},
  })
}

/** Cevap kaydı ve teslimin girdisi; `version` denemenin okunan `rowVersion`'ıdır. */
export interface TaskAttemptWriteInput {
  attemptId: string
  version: number
  answers?: TaskAttemptAnswers
}

export function saveTaskAttemptAnswersRequest(
  client: KampusClient,
  { attemptId, answers }: TaskAttemptWriteInput,
  headers: CommandHeaders,
) {
  return client.PATCH('/api/v1/task-attempts/{attemptId}', {
    params: {
      path: { attemptId },
      header: {
        'idempotency-key': headers['idempotency-key'],
        'if-match': requireIfMatch(headers),
      },
    },
    body: { answers: answers ?? {} },
  })
}

export function submitTaskAttemptRequest(
  client: KampusClient,
  { attemptId, answers }: TaskAttemptWriteInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/task-attempts/{attemptId}/submit', {
    params: {
      path: { attemptId },
      header: {
        'idempotency-key': headers['idempotency-key'],
        'if-match': requireIfMatch(headers),
      },
    },
    body: answers === undefined ? {} : { answers },
  })
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}
const withSuccess = (options: CommandOptions) =>
  options.onSuccess ? { onSuccess: options.onSuccess } : {}
const versionOf = (input: TaskAttemptWriteInput) => input.version

export const startTaskAttemptCommand = {
  request: startTaskAttemptRequest,
  invalidates: TASK_ATTEMPT_INVALIDATES,
  messages: TASK_ATTEMPT_MESSAGES,
  exclusive: true,
} as const
export const saveTaskAttemptAnswersCommand = {
  request: saveTaskAttemptAnswersRequest,
  version: versionOf,
  invalidates: TASK_ATTEMPT_ANSWER_INVALIDATES,
  refreshOn: attemptStale,
  messages: TASK_ATTEMPT_MESSAGES,
  exclusive: true,
} as const
export const submitTaskAttemptCommand = {
  request: submitTaskAttemptRequest,
  version: versionOf,
  invalidates: TASK_ATTEMPT_INVALIDATES,
  refreshOn: attemptStale,
  messages: TASK_ATTEMPT_MESSAGES,
  exclusive: true,
} as const

/** Deneme başlatır (`POST /task-assignments/:id/attempts`, 201). */
export function useStartTaskAttempt(options: CommandOptions = {}) {
  return useApiCommand({ ...startTaskAttemptCommand, ...withSuccess(options) })
}

/** Süren denemeye cevap kaydeder (`PATCH /task-attempts/:id`, `If-Match` zorunlu). */
export function useSaveTaskAttemptAnswers(options: CommandOptions = {}) {
  return useApiCommand({ ...saveTaskAttemptAnswersCommand, ...withSuccess(options) })
}

/** Denemeyi teslim eder (`POST /task-attempts/:id/submit`, `If-Match` zorunlu); puan sunucuda. */
export function useSubmitTaskAttempt(options: CommandOptions = {}) {
  return useApiCommand({ ...submitTaskAttemptCommand, ...withSuccess(options) })
}
