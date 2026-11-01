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
import { TASK_SUBMISSIONS_KEY } from './use-task-submissions.ts'

/**
 * Yazma tesliminin öğretmen puanlaması kancaları (F4b3b1; ADR 0004 karar 6; DOM-BEC-020…023,
 * 040, 045): puanlama kuyruğu, rubrik puanı ve yeniden teslim isteği. Toplam, rubrik sürümü ve
 * geri bildirimin açılması sunucudadır; burada çağrı, önbellek tazeleme ve Türkçe hata metni
 * vardır. Puan ve istek teslimin okunan `rowVersion`'ını `If-Match` olarak ister, yoksa istek
 * atılmaz (`requireIfMatch`); `Idempotency-Key` her ikisinde zorunludur. Kuyruk ve teslimler aynı
 * önekle (`task-submissions`) tutulur: puan verilince teslim ayrıntısı, liste ve kuyruk birlikte
 * tazelenir.
 */

/** Puan ve istek teslimi, listeyi ve kuyruğu değiştirir. */
export const TASK_GRADING_INVALIDATES = [[TASK_SUBMISSIONS_KEY]] as const

type JsonBody<TOperation extends keyof operations> = NonNullable<
  operations[TOperation]['requestBody']
>['content']['application/json']

export type GradingQueueQuery = NonNullable<operations['listGradingQueue']['parameters']['query']>
export type TaskScore = components['schemas']['TaskScore']
export type TaskScoreBrief = components['schemas']['TaskScoreBrief']
export type TaskScoreBody = JsonBody<'scoreTaskSubmission'>
export type TaskResubmissionBody = JsonBody<'requestTaskResubmission'>

/** Teslim bu arada değişti (başka puan, yeni sürüm, başka pencere): güncel hâli yüklenir. */
export const TASK_SUBMISSION_CHANGED_MESSAGE =
  'Teslim bu arada değişti. Güncel hâli yüklendi; yeniden deneyin.'

/**
 * Puanlama ve yeniden teslim hata metinleri. Kriter hataları sunucunun mesajıyla gelir (alan
 * yolu `issues`'tadır); burada ekranın durumunu açıklayan kodlar vardır.
 */
export const TASK_GRADING_MESSAGES = {
  not_found: 'Teslim bulunamadı.',
  version_conflict: TASK_SUBMISSION_CHANGED_MESSAGE,
  version_not_latest: 'Öğrenci yeni bir sürüm gönderdi; son sürümü puanlayın.',
  submission_version_not_found: 'Puanlanan sürüm bulunamadı; teslimin güncel hâli yüklendi.',
  rubric_score_exists: 'Bu sürüm zaten puanlandı.',
  rubric_not_assigned: 'Bu görev rubrikle puanlanmaz.',
  rubric_criterion_missing: 'Her kritere bant verin.',
  rubric_criterion_invalid: 'Kriter bu rubrikte yok veya tekrar ediyor.',
  criterion_comment_required: 'Hedefin altında bant verilen kritere kısa yorum yazın.',
  resubmission_not_graded: 'Yeniden teslim, puanı kesinleşen sürüm için istenir.',
  resubmission_exists: 'Bu sürüm için yeniden teslim zaten istendi.',
  resubmission_due_invalid: 'Yeniden teslim tarihi önümüzdeki 14 gün içinde olmalı.',
} as const satisfies CommandMessages

/**
 * Teslimin ekrandaki durumu eskidi: sürüm çakıştı, yeni sürüm geldi, sürüm zaten puanlandı,
 * teslim veya ataması kaldırıldı ya da ekrandaki sürüm numarası artık yok. Teslim ve kuyruk
 * tazelenir.
 */
const STALE_NOT_FOUND = new Set(['not_found', 'submission_version_not_found'])
export const submissionStale = (error: ApiError) =>
  error.status === 409 || (error.status === 404 && STALE_NOT_FOUND.has(error.code))

/** Puanlanmayı bekleyen teslimler (sayfalı); sorgu değişirken önceki sayfa ekranda kalır. */
export function useGradingQueue(query: GradingQueueQuery) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, TASK_SUBMISSIONS_KEY, 'grading-queue', query),
    queryFn: ({ signal }) =>
      runRequest(() =>
        client.GET('/api/v1/task-submissions/grading-queue', { params: { query }, signal }),
      ),
    enabled: institutionId !== null,
    placeholderData: keepPreviousData,
  })
}

/** Puanın girdisi; `version` teslimin okunan `rowVersion`'ıdır. */
export interface ScoreTaskSubmissionInput {
  submissionId: string
  version: number
  score: TaskScoreBody
}

export function scoreTaskSubmissionRequest(
  client: KampusClient,
  { submissionId, score }: ScoreTaskSubmissionInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/task-submissions/{submissionId}/scores', {
    params: {
      path: { submissionId },
      header: {
        'idempotency-key': headers['idempotency-key'],
        'if-match': requireIfMatch(headers),
      },
    },
    body: score,
  })
}

/** Yeniden teslim isteğinin girdisi; `version` teslimin okunan `rowVersion`'ıdır. */
export interface RequestTaskResubmissionInput {
  submissionId: string
  version: number
  request: TaskResubmissionBody
}

export function requestTaskResubmissionRequest(
  client: KampusClient,
  { submissionId, request }: RequestTaskResubmissionInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/task-submissions/{submissionId}/resubmission-requests', {
    params: {
      path: { submissionId },
      header: {
        'idempotency-key': headers['idempotency-key'],
        'if-match': requireIfMatch(headers),
      },
    },
    body: request,
  })
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}
const withSuccess = (options: CommandOptions) =>
  options.onSuccess ? { onSuccess: options.onSuccess } : {}
const versionOf = (input: { version: number }) => input.version

export const scoreTaskSubmissionCommand = {
  request: scoreTaskSubmissionRequest,
  version: versionOf,
  invalidates: TASK_GRADING_INVALIDATES,
  refreshOn: submissionStale,
  messages: TASK_GRADING_MESSAGES,
  exclusive: true,
} as const
export const requestTaskResubmissionCommand = {
  request: requestTaskResubmissionRequest,
  version: versionOf,
  invalidates: TASK_GRADING_INVALIDATES,
  refreshOn: submissionStale,
  messages: TASK_GRADING_MESSAGES,
  exclusive: true,
} as const

/** Teslimin son sürümünü rubrikle puanlar (`POST /task-submissions/:id/scores`, 201). */
export function useScoreTaskSubmission(options: CommandOptions = {}) {
  return useApiCommand({ ...scoreTaskSubmissionCommand, ...withSuccess(options) })
}

/** Öğrenciden yeni sürüm ister (`POST /task-submissions/:id/resubmission-requests`, 201). */
export function useRequestTaskResubmission(options: CommandOptions = {}) {
  return useApiCommand({ ...requestTaskResubmissionCommand, ...withSuccess(options) })
}
