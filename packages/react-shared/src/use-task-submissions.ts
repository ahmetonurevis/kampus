import { keepPreviousData, useQuery } from '@tanstack/react-query'

import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { components, operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import type { CommandHeaders, CommandMessages } from './commands.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { LEARNER_CONTENT_MESSAGES, TASK_ASSIGNMENTS_KEY } from './use-task-assignments.ts'

/**
 * Yazma ve konuşma görevinin taslak ve teslim kancaları (`/api/v1/task-submissions`, taslak ve
 * teslim atamanın altında; ADR 0004 karar 6; DOM-BEC-023, 040, 044, 046, 054; IST-047, IST-051).
 * Konuşmada gövde `{ submissionKind: 'audio', recordingFileId }`'dir; kayıt önce `POST /files`
 * (amaç `speaking_recording`) ile yüklenir ve `ready` olunca gönderilir. Sürüm sınırı,
 * pencere ve sözcük sayısı sunucudadır; burada çağrı, önbellek tazeleme ve Türkçe hata metni
 * vardır. Taslak kaydı `If-Match` olarak taslağın okunan `revision`'ını taşır; yalnız henüz taslak
 * yokken (`revision: null`) başlıksız gider, sunucu taslak varken başlıksız isteği 400 ile reddeder;
 * bu durumda taslak başka pencerede kaydedilmiştir: taslak yeniden çekilir (revizyon tazelenir).
 * Teslim `If-Match` kabul etmez ve `Idempotency-Key` zorunludur. Yazma otomatik puanlanmaz.
 */

export const TASK_SUBMISSIONS_KEY = 'task-submissions'
export const TASK_DRAFT_KEY = 'task-drafts'
/** Teslim teslimleri ve kursiyerin atama görünümünü değiştirebilir. */
export const TASK_SUBMISSION_INVALIDATES = [[TASK_SUBMISSIONS_KEY], [TASK_ASSIGNMENTS_KEY]] as const
/** Otomatik taslak kaydı yalnız taslağı tazeler. */
export const TASK_DRAFT_INVALIDATES = [[TASK_DRAFT_KEY]] as const

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type TaskSubmissionListQuery = NonNullable<
  operations['listTaskSubmissions']['parameters']['query']
>
export type TaskSubmission = components['schemas']['TaskSubmission']
export type TaskSubmissionDetail = components['schemas']['TaskSubmissionDetail']
export type TaskDraft = components['schemas']['TaskDraft']
export type TaskSubmissionBody = JsonBody<'submitTaskSubmission'>

/** Taslak başka pencerede değişti (409 `draft_conflict`): güncel taslak yüklenir. */
export const TASK_DRAFT_CHANGED_MESSAGE =
  'Taslak başka bir pencerede değişti. Güncel hâli yüklendi; yeniden deneyin.'

/**
 * Taslak yokken açılan ekranda başka pencere taslağı kaydetti (400 `if_match_required`): taslak
 * yeniden çekilir, sonraki kayıt güncel revizyonu taşır.
 */
export const TASK_DRAFT_SAVED_ELSEWHERE_MESSAGE =
  'Taslak başka bir pencerede kaydedildi, son hâli yüklendi.'

/**
 * `version_limit_reached` sunucunun mesajıyla gelir (sınır sayısını, konuşmada deneme hakkını
 * içerir). Sesli teslimin kayıt hataları (`recording_empty`, `recording_too_long`,
 * `recording_not_measured`) core'un Türkçe iletisiyle gelir; rıza ve dosya iletileri burada
 * teknik ayrıntısız yazılır (DOM-BEC-050, 054).
 */
export const TASK_SUBMISSION_MESSAGES = {
  ...LEARNER_CONTENT_MESSAGES,
  not_found: 'Görev bulunamadı.',
  draft_conflict: TASK_DRAFT_CHANGED_MESSAGE,
  submission_closed: 'Bu görevin teslim süresi doldu.',
  submission_not_expected: 'Bu görev teslim beklemiyor; deneme olarak çözülür.',
  submission_kind_mismatch: 'Bu görev başka türde teslim bekliyor; sayfayı yenileyin.',
  consent_required:
    'Ses kaydı için gerekli onay bulunmuyor; bu görev öğretmeninizle yüz yüze değerlendirilecek.',
  file_not_ready: 'Kaydınız henüz işleniyor; biraz sonra yeniden deneyin.',
  file_unavailable: 'Bu kayıt artık kullanılamıyor; yeniden kaydedin.',
  file_already_attached: 'Bu kayıt zaten gönderildi; sayfayı yenileyin.',
  draft_not_supported: 'Taslak yalnız yazma görevinde tutulur.',
  resubmission_not_requested:
    'Teslim puanlandı; yeni sürüm için öğretmenin yeniden teslim istemesi gerekir.',
  submission_locked: 'Bu teslim için şu an yeni sürüm gönderilemez.',
} as const satisfies CommandMessages

/** Taslak kaydının mesajları: teslim mesajları ve başka pencerede ilk kayıt. */
export const TASK_DRAFT_MESSAGES = {
  ...TASK_SUBMISSION_MESSAGES,
  if_match_required: TASK_DRAFT_SAVED_ELSEWHERE_MESSAGE,
} as const satisfies CommandMessages

/** Taslak başka pencerede ilk kez kaydedildi: ekrandaki "taslak yok" bilgisi eskidi. */
export const draftSavedElsewhere = (error: ApiError) =>
  error.status === 400 && error.code === 'if_match_required'

/** Atamanın teslimleri (rol kapsamlı, sayfalı); sorgu değişirken önceki sayfa ekranda kalır. */
export function useTaskSubmissions(query: TaskSubmissionListQuery) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, TASK_SUBMISSIONS_KEY, 'list', query),
    queryFn: ({ signal }) =>
      runRequest(() => client.GET('/api/v1/task-submissions', { params: { query }, signal })),
    enabled: institutionId !== null && query.assignmentId !== '',
    placeholderData: keepPreviousData,
  })
}

/** Tek teslim ve değişmez sürümleri (taslak yok); `submissionId` boşken istek atılmaz. */
export function useTaskSubmission(submissionId: string) {
  return useApiQuery({
    key: [TASK_SUBMISSIONS_KEY, 'detail', submissionId],
    request: (client, signal) =>
      client.GET('/api/v1/task-submissions/{submissionId}', {
        params: { path: { submissionId } },
        signal,
      }),
    enabled: submissionId !== '',
  })
}

/** Öğrencinin kendi taslağı (`null`: henüz taslak yok); `assignmentId` boşken istek atılmaz. */
export function useTaskDraft(assignmentId: string) {
  return useApiQuery({
    key: [TASK_DRAFT_KEY, assignmentId],
    request: (client, signal) =>
      client.GET('/api/v1/task-assignments/{assignmentId}/draft', {
        params: { path: { assignmentId } },
        signal,
      }),
    enabled: assignmentId !== '',
  })
}

/** Taslak kaydının girdisi; `revision` okunan taslak sürümüdür, taslak yoksa `null`. */
export interface SaveTaskDraftInput {
  assignmentId: string
  revision: number | null
  body: string
}

/** `If-Match` yalnız taslak varken gider (ilk kayıt başlıksızdır; `commandHeaders`). */
export function saveTaskDraftRequest(
  client: KampusClient,
  { assignmentId, body }: SaveTaskDraftInput,
  headers: CommandHeaders,
) {
  const ifMatch = headers['if-match']
  return client.PATCH('/api/v1/task-assignments/{assignmentId}/draft', {
    params: {
      path: { assignmentId },
      header: {
        'idempotency-key': headers['idempotency-key'],
        ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }),
      },
    },
    body: { body },
  })
}

export interface SubmitTaskSubmissionInput {
  assignmentId: string
  submission: TaskSubmissionBody
}

/** Teslim `If-Match` kabul etmez (sunucu 400 `if_match_not_supported`). */
export function submitTaskSubmissionRequest(
  client: KampusClient,
  { assignmentId, submission }: SubmitTaskSubmissionInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/task-assignments/{assignmentId}/submissions', {
    params: {
      path: { assignmentId },
      header: { 'idempotency-key': headers['idempotency-key'] },
    },
    body: submission,
  })
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}
const withSuccess = (options: CommandOptions) =>
  options.onSuccess ? { onSuccess: options.onSuccess } : {}

export const saveTaskDraftCommand = {
  request: saveTaskDraftRequest,
  version: (input: SaveTaskDraftInput) => input.revision,
  invalidates: TASK_DRAFT_INVALIDATES,
  refreshOn: draftSavedElsewhere,
  messages: TASK_DRAFT_MESSAGES,
  exclusive: true,
} as const
export const submitTaskSubmissionCommand = {
  request: submitTaskSubmissionRequest,
  invalidates: TASK_SUBMISSION_INVALIDATES,
  messages: TASK_SUBMISSION_MESSAGES,
  exclusive: true,
} as const

/**
 * Taslağı kaydeder (`PATCH /task-assignments/:id/draft`); 409 `draft_conflict` ve 400
 * `if_match_required`'da güncel taslak yüklenir.
 */
export function useSaveTaskDraft(options: CommandOptions = {}) {
  return useApiCommand({ ...saveTaskDraftCommand, ...withSuccess(options) })
}

/** Yeni teslim sürümü gönderir (`POST /task-assignments/:id/submissions`, 201). */
export function useSubmitTaskSubmission(options: CommandOptions = {}) {
  return useApiCommand({ ...submitTaskSubmissionCommand, ...withSuccess(options) })
}
