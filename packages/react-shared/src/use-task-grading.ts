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
import { CONTENT_RESULTS_PREFIX } from './use-content-assignments.ts'
import { TASK_ASSIGNMENTS_KEY } from './use-task-assignments.ts'
import { TASK_SUBMISSIONS_KEY } from './use-task-submissions.ts'

/**
 * Yazma tesliminin öğretmen puanlaması kancaları (F4b3b1; ADR 0004 karar 6; DOM-BEC-020…023,
 * 040, 045): puanlama kuyruğu, rubrik puanı ve yeniden teslim isteği. Toplam, rubrik sürümü ve
 * geri bildirimin açılması sunucudadır; burada çağrı, önbellek tazeleme ve Türkçe hata metni
 * vardır. Puan ve istek teslimin okunan `rowVersion`'ını `If-Match` olarak ister, yoksa istek
 * atılmaz (`requireIfMatch`); `Idempotency-Key` her ikisinde zorunludur. Kuyruk ve teslimler aynı
 * önekle (`task-submissions`) tutulur: puan verilince teslim ayrıntısı, liste ve kuyruk birlikte
 * tazelenir.
 *
 * F4b3b2a (DOM-BEC-024, 025): ikinci puanlama örneklemi (atamanın `rowVersion`'ı), elle istem,
 * kör ikinci puan, itiraz (kursiyer veya velisi; `If-Match` yok) ve itiraz kararı. Örneklem
 * atamayı da değiştirir; atama sorguları da tazelenir.
 *
 * F4b3b2b (DOM-YTK-027, DOM-BEC-024): uyuşmazlıkta koordinatörün son puanı (`final-scores`);
 * kuyrukta `awaiting: 'resolution'` süzgeci. Kapsam ve puanlayıcı bağımsızlığı sunucudadır.
 */

/**
 * Puan ve istek teslimi, listeyi ve kuyruğu değiştirir; içeriğe bağlı sonuç özeti de (puan
 * ortalaması) puana bağlıdır.
 */
export const TASK_GRADING_INVALIDATES = [[TASK_SUBMISSIONS_KEY], CONTENT_RESULTS_PREFIX] as const

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type GradingQueueQuery = NonNullable<operations['listGradingQueue']['parameters']['query']>
export type TaskScore = components['schemas']['TaskScore']
export type TaskScoreBrief = components['schemas']['TaskScoreBrief']
export type TaskScoreBody = JsonBody<'scoreTaskSubmission'>
export type TaskResubmissionBody = JsonBody<'requestTaskResubmission'>
export type GradingQueueItem = components['schemas']['GradingQueueItem']
export type TaskVersionGrading = components['schemas']['TaskVersionGrading']
export type TaskAppeal = components['schemas']['TaskAppeal']
export type SecondRatingSample = components['schemas']['SecondRatingSample']
export type SecondRatingRequestBody = JsonBody<'requestSecondRating'>
export type TaskAppealBody = JsonBody<'fileTaskAppeal'>
export type TaskAppealDecisionBody = JsonBody<'decideTaskAppeal'>

/** Örneklem atamayı ve teslimleri değiştirir. */
export const SECOND_RATING_SAMPLE_INVALIDATES = [
  [TASK_SUBMISSIONS_KEY],
  [TASK_ASSIGNMENTS_KEY],
] as const

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
  second_rating_sample_pending:
    'Önce ikinci puanlama örneklemi seçilmeli; örneklem teslim süresi bitince seçilir.',
  second_rating_window_open:
    'İkinci puanlama, öğrenci yeni sürüm gönderemez olunca (teslim süresi bitince veya sürüm hakkı dolunca) istenir.',
  second_rating_exists: 'Bu teslim için ikinci puanlama zaten istendi.',
  second_rating_too_late: 'Puanı kesinleşen sürüm için ikinci puanlama istenemez.',
  second_rating_not_requested: 'Bu teslim için ikinci puanlama istenmedi.',
  second_rating_not_configured: 'Bu görevde ikinci puanlama örneklemi yok.',
  second_rating_sample_drawn: 'Bu görevin ikinci puanlama örneklemi zaten seçildi.',
  second_rating_sample_unavailable:
    'Son tarihi olmayan görevde örneklem seçilmez; ikinci puanı teslim bazında isteyin.',
  rater_not_independent: 'Bu teslimi daha önce puanladınız; bağımsız bir öğretmen puanlamalı.',
  appeal_decided: 'Bu itiraz zaten sonuçlandı.',
  final_score_not_needed:
    'Son puan yalnız iki puanlayıcı arasında uyuşmazlık varsa verilir; sonuç zaten kesinleşmiş olabilir.',
  coordinator_required:
    'Uyuşmazlıkta son puanı dersin zümre başkanı veya seviyenin akademik koordinatörü verir.',
  // Sesli geri bildirim (DOM-BEC-056): puanla birlikte bağlanamadıysa puan da yazılmaz.
  file_unavailable: 'Sesli geri bildirim bulunamadı; yeniden kaydedin.',
  file_not_ready: 'Sesli geri bildirim hâlâ işleniyor; birazdan yeniden kaydedin.',
  file_purpose_mismatch: 'Bu dosya sesli geri bildirim olarak eklenemez; yeniden kaydedin.',
} as const satisfies CommandMessages

/** İtiraz hata metinleri (kursiyer ve veli; DOM-BEC-025). */
export const TASK_APPEAL_MESSAGES = {
  not_found: 'Teslim bulunamadı.',
  submission_version_not_found: 'Sürüm bulunamadı; teslimin güncel hâli yüklendi.',
  appeal_not_open: 'Sonuç duyurulmadan itiraz edilemez.',
  appeal_window_closed:
    'İtiraz süresi doldu; itiraz sonuç duyurusundan sonra 5 iş günü içinde yapılır.',
  appeal_not_available: 'Alıştırma sonucuna itiraz edilmez.',
  appeal_exists: 'Bu sonuca zaten itiraz edildi.',
  appeal_not_latest: 'Yalnız son teslim sürümünün sonucuna itiraz edilebilir.',
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

// --- İkinci puanlama ve itiraz (F4b3b2a) ---------------------------------------------------

/** İkinci puanın girdisi; `version` teslimin okunan `rowVersion`'ıdır. Gövde ilk puanınkiyle aynı. */
export type SecondScoreTaskSubmissionInput = ScoreTaskSubmissionInput

export function secondScoreTaskSubmissionRequest(
  client: KampusClient,
  { submissionId, score }: SecondScoreTaskSubmissionInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/task-submissions/{submissionId}/second-scores', {
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

/** Son puanın girdisi; `version` teslimin okunan `rowVersion`'ıdır. Gövde ilk puanınkiyle aynı. */
export type FinalScoreTaskSubmissionInput = ScoreTaskSubmissionInput

export function finalScoreTaskSubmissionRequest(
  client: KampusClient,
  { submissionId, score }: FinalScoreTaskSubmissionInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/task-submissions/{submissionId}/final-scores', {
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

/** Elle ikinci puanlama isteminin girdisi; `version` teslimin okunan `rowVersion`'ıdır. */
export interface RequestSecondRatingInput {
  submissionId: string
  version: number
  request: SecondRatingRequestBody
}

export function requestSecondRatingRequest(
  client: KampusClient,
  { submissionId, request }: RequestSecondRatingInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/task-submissions/{submissionId}/second-rating-requests', {
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

/** Örneklemin girdisi; `version` atamanın okunan `rowVersion`'ıdır. */
export interface DrawSecondRatingSampleInput {
  assignmentId: string
  version: number
}

export function drawSecondRatingSampleRequest(
  client: KampusClient,
  { assignmentId }: DrawSecondRatingSampleInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/task-assignments/{assignmentId}/second-rating-sample', {
    params: {
      path: { assignmentId },
      header: {
        'idempotency-key': headers['idempotency-key'],
        'if-match': requireIfMatch(headers),
      },
    },
    body: {},
  })
}

/** İtirazın girdisi (kursiyer veya velisi); sürüm kilidi yoktur, tekrar `Idempotency-Key` ile. */
export interface FileTaskAppealInput {
  submissionId: string
  appeal: TaskAppealBody
}

export function fileTaskAppealRequest(
  client: KampusClient,
  { submissionId, appeal }: FileTaskAppealInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/task-submissions/{submissionId}/appeals', {
    params: {
      path: { submissionId },
      header: { 'idempotency-key': headers['idempotency-key'] },
    },
    body: appeal,
  })
}

/** İtiraz kararının girdisi; `version` teslimin okunan `rowVersion`'ıdır. */
export interface DecideTaskAppealInput {
  submissionId: string
  appealId: string
  version: number
  decision: TaskAppealDecisionBody
}

export function decideTaskAppealRequest(
  client: KampusClient,
  { submissionId, appealId, decision }: DecideTaskAppealInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/task-submissions/{submissionId}/appeals/{appealId}/decision', {
    params: {
      path: { submissionId, appealId },
      header: {
        'idempotency-key': headers['idempotency-key'],
        'if-match': requireIfMatch(headers),
      },
    },
    body: decision,
  })
}

export const secondScoreTaskSubmissionCommand = {
  ...scoreTaskSubmissionCommand,
  request: secondScoreTaskSubmissionRequest,
} as const
export const finalScoreTaskSubmissionCommand = {
  ...scoreTaskSubmissionCommand,
  request: finalScoreTaskSubmissionRequest,
} as const
export const requestSecondRatingCommand = {
  request: requestSecondRatingRequest,
  version: versionOf,
  invalidates: TASK_GRADING_INVALIDATES,
  refreshOn: submissionStale,
  messages: TASK_GRADING_MESSAGES,
  exclusive: true,
} as const
export const drawSecondRatingSampleCommand = {
  request: drawSecondRatingSampleRequest,
  version: versionOf,
  invalidates: SECOND_RATING_SAMPLE_INVALIDATES,
  refreshOn: (error: ApiError) => error.status === 409 || error.status === 404,
  messages: TASK_GRADING_MESSAGES,
  exclusive: true,
} as const
export const fileTaskAppealCommand = {
  request: fileTaskAppealRequest,
  invalidates: TASK_GRADING_INVALIDATES,
  refreshOn: submissionStale,
  messages: TASK_APPEAL_MESSAGES,
  exclusive: true,
} as const
export const decideTaskAppealCommand = {
  request: decideTaskAppealRequest,
  version: versionOf,
  invalidates: TASK_GRADING_INVALIDATES,
  refreshOn: submissionStale,
  messages: TASK_GRADING_MESSAGES,
  exclusive: true,
} as const

/** İkinci puanı verir (`POST /task-submissions/:id/second-scores`, 201; DOM-BEC-024). */
export function useSecondScoreTaskSubmission(options: CommandOptions = {}) {
  return useApiCommand({ ...secondScoreTaskSubmissionCommand, ...withSuccess(options) })
}

/**
 * Uyuşmazlıkta son puanı verir (`POST /task-submissions/:id/final-scores`, 201; DOM-YTK-027,
 * DOM-BEC-024). Yalnız kapsamındaki koordinatör; iki puanlayıcıdan biri olamaz.
 */
export function useFinalScoreTaskSubmission(options: CommandOptions = {}) {
  return useApiCommand({ ...finalScoreTaskSubmissionCommand, ...withSuccess(options) })
}

/** Elle ikinci puanlama ister (`POST /task-submissions/:id/second-rating-requests`, 201). */
export function useRequestSecondRating(options: CommandOptions = {}) {
  return useApiCommand({ ...requestSecondRatingCommand, ...withSuccess(options) })
}

/** Örneklemi seçer (`POST /task-assignments/:id/second-rating-sample`, 201; DOM-BEC-024). */
export function useDrawSecondRatingSample(options: CommandOptions = {}) {
  return useApiCommand({ ...drawSecondRatingSampleCommand, ...withSuccess(options) })
}

/** Sonuca itiraz eder (`POST /task-submissions/:id/appeals`, 201; DOM-BEC-025). */
export function useFileTaskAppeal(options: CommandOptions = {}) {
  return useApiCommand({ ...fileTaskAppealCommand, ...withSuccess(options) })
}

/** İtirazı karara bağlar (`POST /task-submissions/:id/appeals/:appealId/decision`, 200). */
export function useDecideTaskAppeal(options: CommandOptions = {}) {
  return useApiCommand({ ...decideTaskAppealCommand, ...withSuccess(options) })
}
