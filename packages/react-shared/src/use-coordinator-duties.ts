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
 * Zümre başkanı ve akademik koordinatör ek görevi kancaları (`/api/v1/coordinator-duties`;
 * DOM-YTK-027, DOM-BEC-024): liste, atama ve kaldırma. Görev türü kurum türünden sunucuda
 * belirlenir (`school` zümre başkanı, `language_school` akademik koordinatör); istemci yalnız
 * üyeliği ve kapsamı (ders kimliği veya CEFR seviyesi) gönderir. Atama ve kaldırma yalnız
 * yöneticinindir; yetki ve kapsam sunucudadır. Kaldırma görevin okunan `rowVersion`'ını `If-Match`
 * olarak ister, yoksa istek atılmaz (`requireIfMatch`). Görev koordinatörün puanlama kuyruğunu
 * değiştirdiği için teslim sorguları da tazelenir.
 */

export const COORDINATOR_DUTIES_KEY = 'coordinator-duties'

/** Görev, görev listesini ve koordinatörün göreceği uyuşmazlık kuyruğunu değiştirir. */
export const COORDINATOR_DUTY_INVALIDATES = [
  [COORDINATOR_DUTIES_KEY],
  [TASK_SUBMISSIONS_KEY],
] as const

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type CoordinatorDutyListQuery = NonNullable<
  operations['listCoordinatorDuties']['parameters']['query']
>
export type CoordinatorDuty = components['schemas']['CoordinatorDuty']
export type CoordinatorDutyBody = JsonBody<'assignCoordinatorDuty'>

/** Atama ve kaldırma hata metinleri; alan hataları (`issues`) alana yazılır. */
export const COORDINATOR_DUTY_MESSAGES = {
  not_found: 'Görev veya öğretmen bulunamadı.',
  version_conflict: 'Görev bu arada değişti. Güncel hâli yüklendi; yeniden deneyin.',
  duty_requires_teacher: 'Bu görev yalnız öğretmene verilir.',
  teacher_record_required: 'Öğretmenin kadro kaydı bağlı değil; önce öğretmen kaydını bağlayın.',
  duty_outside_branch: 'Zümre başkanlığı öğretmenin kendi branşında verilir.',
  invalid_cefr_level: 'Geçerli bir CEFR seviyesi seçin.',
  coordinator_duty_exists: 'Bu görev öğretmene zaten verilmiş.',
} as const satisfies CommandMessages

/** Görevin ekrandaki hâli eskidi (sürüm çakıştı, görev kaldırıldı): liste tazelenir. */
export const coordinatorDutyStale = (error: ApiError) =>
  error.status === 404 || (error.status === 409 && error.code === 'version_conflict')

/** Etkin görevler (sayfalı); öğretmende sunucu kendi üyeliğiyle sınırlar. */
export function useCoordinatorDuties(query: CoordinatorDutyListQuery) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, COORDINATOR_DUTIES_KEY, 'list', query),
    queryFn: ({ signal }) =>
      runRequest(() => client.GET('/api/v1/coordinator-duties', { params: { query }, signal })),
    enabled: institutionId !== null,
    placeholderData: keepPreviousData,
  })
}

export function assignCoordinatorDutyRequest(
  client: KampusClient,
  body: CoordinatorDutyBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/coordinator-duties', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}

/** Kaldırmanın girdisi; `version` görevin okunan `rowVersion`'ıdır. */
export interface RemoveCoordinatorDutyInput {
  dutyId: string
  version: number
}

export function removeCoordinatorDutyRequest(
  client: KampusClient,
  { dutyId }: RemoveCoordinatorDutyInput,
  headers: CommandHeaders,
) {
  return client.DELETE('/api/v1/coordinator-duties/{dutyId}', {
    params: {
      path: { dutyId },
      header: {
        'idempotency-key': headers['idempotency-key'],
        'if-match': requireIfMatch(headers),
      },
    },
  })
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}
const withSuccess = (options: CommandOptions) =>
  options.onSuccess ? { onSuccess: options.onSuccess } : {}

export const assignCoordinatorDutyCommand = {
  request: assignCoordinatorDutyRequest,
  invalidates: COORDINATOR_DUTY_INVALIDATES,
  messages: COORDINATOR_DUTY_MESSAGES,
  exclusive: true,
} as const
export const removeCoordinatorDutyCommand = {
  request: removeCoordinatorDutyRequest,
  version: (input: RemoveCoordinatorDutyInput) => input.version,
  invalidates: COORDINATOR_DUTY_INVALIDATES,
  refreshOn: coordinatorDutyStale,
  messages: COORDINATOR_DUTY_MESSAGES,
  exclusive: true,
} as const

/** Öğretmen üyeliğine ek görev verir (`POST /coordinator-duties`, 201; DOM-YTK-027). */
export function useAssignCoordinatorDuty(options: CommandOptions = {}) {
  return useApiCommand({ ...assignCoordinatorDutyCommand, ...withSuccess(options) })
}

/** Görevi kaldırır (`DELETE /coordinator-duties/:id`, `If-Match` zorunlu; DOM-YTK-027). */
export function useRemoveCoordinatorDuty(options: CommandOptions = {}) {
  return useApiCommand({ ...removeCoordinatorDutyCommand, ...withSuccess(options) })
}
