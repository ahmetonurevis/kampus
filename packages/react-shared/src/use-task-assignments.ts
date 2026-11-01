import { keepPreviousData, useQuery } from '@tanstack/react-query'

import type { KampusClient } from '@kampus/api-client/client.ts'
import type { components, operations } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import { requireIfMatch, type CommandHeaders, type CommandMessages } from './commands.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { RUBRICS_KEY } from './use-rubrics.ts'

/**
 * Görev atama kancaları (`/api/v1/task-assignments`; ADR 0004 karar 4, DOM-KYN-032, DOM-BEC-041,
 * 042, 044, IST-034): liste, ayrıntı, oluşturma ve son teslim değişikliği. Hedef kapsamı, sabitleme
 * ve geçici sınırlar sunucudadır; burada çağrı, önbellek tazeleme ve Türkçe hata metni vardır.
 * Oluşturma `If-Match` kabul etmez; değişiklik okunan `rowVersion`'ı ister, yoksa istek atılmaz
 * (`requireIfMatch`). Her yazma kullanıcı eylemi başına `Idempotency-Key` taşır (oluşturmada
 * sunucu zorunlu tutar).
 */

export const TASK_ASSIGNMENTS_KEY = 'task-assignments'
/** Atama rubrik sürümünün kullanım sayısını değiştirir; rubrik sorguları da tazelenir. */
export const TASK_ASSIGNMENT_INVALIDATES = [[TASK_ASSIGNMENTS_KEY], [RUBRICS_KEY]] as const

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type TaskAssignmentListQuery = NonNullable<
  operations['listTaskAssignments']['parameters']['query']
>
export type TaskAssignmentBody = JsonBody<'createTaskAssignment'>
export type TaskAssignmentPatch = JsonBody<'updateTaskAssignment'>
export type TaskAssignment = components['schemas']['TaskAssignment']
export type TaskAssignmentStaff = components['schemas']['TaskAssignmentStaff']
export type TaskAssignmentLearner = components['schemas']['TaskAssignmentLearner']
/** Ayrıntı: kursiyer görünümünde durum özetine ek olarak sabitlenen sürümün kursiyer içeriği. */
export type TaskAssignmentDetail = components['schemas']['TaskAssignmentDetail']
export type TaskAssignmentLearnerDetail = components['schemas']['TaskAssignmentLearnerDetail']

/** Atama bu arada değiştirildi (`If-Match` tutmadı): güncel hâli yüklenir. */
export const TASK_ASSIGNMENT_CHANGED_MESSAGE =
  'Görev siz bakarken başkası tarafından değiştirildi. Güncel hâli yüklendi; yeniden deneyin.'

/** Lisansı dolmuş içerik (409 `resource_license_expired`); yenilemek sonucu değiştirmez. */
export const TASK_ASSIGNMENT_LICENSE_EXPIRED_MESSAGE =
  'Bu içeriğin lisans süresi dolduğu için atanamaz; başka bir içerik seçin.'

/**
 * Oluşturma ve değişikliğin ortak metinleri. `not_found` burada yoktur: oluşturmada 404 olmayan
 * hedef, içerik veya rubrik sürümüdür; sunucunun mesajı ve `issues` yolu kullanılır.
 */
export const TASK_ASSIGNMENT_MESSAGES = {
  version_conflict: TASK_ASSIGNMENT_CHANGED_MESSAGE,
  assignment_setting_frozen:
    'Atanmış görevde yalnız son teslim tarihi uzatılabilir; diğer ayarlar için yeni görev atayın.',
  resource_version_not_assignable:
    'Bu içeriğin yalnız güncel yayındaki sürümü atanabilir; sayfayı yenileyin.',
  resource_license_expired: TASK_ASSIGNMENT_LICENSE_EXPIRED_MESSAGE,
  rubric_version_not_assignable: 'Yalnız yayındaki rubrik sürümü atanabilir.',
} as const satisfies CommandMessages

/**
 * Değişiklikte 404 atamanın kendisidir (kapsam dışı, silinmiş veya başka kurumun). İkinci puanlama
 * başladıysa (örneklem seçildi veya süre bitince ikinci puan istendi) teslim penceresi değişmez.
 */
export const UPDATE_TASK_ASSIGNMENT_MESSAGES = {
  ...TASK_ASSIGNMENT_MESSAGES,
  not_found: 'Görev bulunamadı.',
  second_rating_started: 'İkinci puanlama başladı; son teslim tarihi artık değiştirilemez.',
} as const satisfies CommandMessages

/** Sunucu sayfalı liste (rol kapsamlı); sorgu değişirken önceki sayfa ekranda kalır. */
export function useTaskAssignments(query: TaskAssignmentListQuery) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, TASK_ASSIGNMENTS_KEY, 'list', query),
    queryFn: ({ signal }) =>
      runRequest(() => client.GET('/api/v1/task-assignments', { params: { query }, signal })),
    enabled: institutionId !== null,
    placeholderData: keepPreviousData,
  })
}

/** Tek atama (personel veya kursiyer görünümü); `assignmentId` boşken istek atılmaz. */
export function useTaskAssignment(assignmentId: string) {
  return useApiQuery({
    key: [TASK_ASSIGNMENTS_KEY, 'detail', assignmentId],
    request: (client, signal) =>
      client.GET('/api/v1/task-assignments/{assignmentId}', {
        params: { path: { assignmentId } },
        signal,
      }),
    enabled: assignmentId !== '',
  })
}

/** Oluşturma `If-Match` kabul etmez (sunucu 400 `if_match_not_supported`). */
export function createTaskAssignmentRequest(
  client: KampusClient,
  body: TaskAssignmentBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/task-assignments', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}

/** Değişikliğin girdisi; `version` atamanın okunan `rowVersion`'ıdır. */
export interface UpdateTaskAssignmentInput {
  assignmentId: string
  version: number
  patch: TaskAssignmentPatch
}

export function updateTaskAssignmentRequest(
  client: KampusClient,
  { assignmentId, patch }: UpdateTaskAssignmentInput,
  headers: CommandHeaders,
) {
  return client.PATCH('/api/v1/task-assignments/{assignmentId}', {
    params: {
      path: { assignmentId },
      header: {
        'idempotency-key': headers['idempotency-key'],
        'if-match': requireIfMatch(headers),
      },
    },
    body: patch,
  })
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}
const withSuccess = (options: CommandOptions) =>
  options.onSuccess ? { onSuccess: options.onSuccess } : {}

/** Ortak ayar: yollu `issues` alana gider, çakışma tek toast (çift tıklamada yersiz 409 yok). */
export const createTaskAssignmentCommand = {
  request: createTaskAssignmentRequest,
  invalidates: TASK_ASSIGNMENT_INVALIDATES,
  messages: TASK_ASSIGNMENT_MESSAGES,
  exclusive: true,
} as const
export const updateTaskAssignmentCommand = {
  request: updateTaskAssignmentRequest,
  version: (input: UpdateTaskAssignmentInput) => input.version,
  invalidates: TASK_ASSIGNMENT_INVALIDATES,
  messages: UPDATE_TASK_ASSIGNMENT_MESSAGES,
  exclusive: true,
} as const

/** Görev atar (`POST /task-assignments`, 201); içerik ve rubrik sürümü sabitlenir. */
export function useCreateTaskAssignment(options: CommandOptions = {}) {
  return useApiCommand({ ...createTaskAssignmentCommand, ...withSuccess(options) })
}

/** Son teslimi uzatır (`PATCH /task-assignments/:id`, `If-Match` zorunlu); 409'da tazelenir. */
export function useUpdateTaskAssignment(options: CommandOptions = {}) {
  return useApiCommand({ ...updateTaskAssignmentCommand, ...withSuccess(options) })
}
