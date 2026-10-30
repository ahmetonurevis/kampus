import type { KampusClient } from '@kampus/api-client/client.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import type { CommandHeaders, CommandMessages } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'

// Veli talebi ve izin/mazeret bildirimi yazma komutları (`POST /requests`,
// `PATCH /requests/:id`, `POST /absences`; core `request.open` `request.update`
// `absence.notify`, DOM-ILT-053, DOM-ILT-080). Okuma genel koleksiyon kancalarındadır.

type JsonBody<TOperation extends keyof operations> = NonNullable<
  operations[TOperation]['requestBody']
>['content']['application/json']

export type OpenRequestBody = JsonBody<'openRequest'>
export type UpdateRequestBody = JsonBody<'updateRequest'>
export type NotifyAbsenceBody = JsonBody<'notifyAbsence'>

/** Talep güncellemesi: okunan sürüm `If-Match` olarak zorunludur. */
export interface UpdateRequestInput {
  requestId: string
  version: number
  body: UpdateRequestBody
}

/** Başka kullanıcı talebi değiştirdi (`If-Match` tutmadı): panel güncel kayıtla yeniden açılır. */
export const REQUEST_CHANGED_MESSAGE =
  'Talep başka biri tarafından güncellendi. Güncel hâlini yükleyip yeniden deneyin.'

export const REQUEST_MESSAGES = {
  version_conflict: REQUEST_CHANGED_MESSAGE,
} as const satisfies CommandMessages

const idempotencyOnly = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
})

export function openRequestRequest(
  client: KampusClient,
  body: OpenRequestBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/requests', { params: { header: idempotencyOnly(headers) }, body })
}

export function updateRequestRequest(
  client: KampusClient,
  { requestId, body }: UpdateRequestInput,
  headers: CommandHeaders,
) {
  return client.PATCH('/api/v1/requests/{requestId}', {
    params: {
      path: { requestId },
      header: { ...idempotencyOnly(headers), 'if-match': headers['if-match'] ?? '' },
    },
    body,
  })
}

export function notifyAbsenceRequest(
  client: KampusClient,
  body: NotifyAbsenceBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/absences', { params: { header: idempotencyOnly(headers) }, body })
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}

const requests = [collectionKeyPrefix('requests')]
const absences = [collectionKeyPrefix('absences')]

/** Veli talep, şikayet veya öneri açar (201); talepler listesi tazelenir. */
export function useOpenRequest(options: CommandOptions = {}) {
  return useApiCommand({
    request: openRequestRequest,
    invalidates: requests,
    messages: REQUEST_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/** Ön büro/yönetici durum, ilgili birim ve yanıtı yazar; `If-Match` okunan sürümdür. */
export function useUpdateRequest(options: CommandOptions = {}) {
  return useApiCommand({
    request: updateRequestRequest,
    version: (input: UpdateRequestInput) => input.version,
    invalidates: requests,
    messages: REQUEST_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/** Veli izin veya mazeret bildirir (201); bildirim geçmişi tazelenir. */
export function useNotifyAbsence(options: CommandOptions = {}) {
  return useApiCommand({
    request: notifyAbsenceRequest,
    invalidates: absences,
    messages: REQUEST_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}
