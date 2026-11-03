import type { KampusClient } from '@kampus/api-client/client.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch, type CommandHeaders, type CommandMessages } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'

// Veli talebi ve izin/mazeret bildirimi yazma komutları (`POST /requests`,
// `PATCH /requests/:id`, `POST /absences`; core `request.open` `request.update`
// `absence.notify`, DOM-ILT-053, DOM-ILT-080). Okuma genel koleksiyon kancalarındadır.
// Mazeret onayı (OG-044): veli belge ekler (`POST /absences/:id/documents`), yönetici onaylar ya da
// gerekçeyle reddeder (`/approve`, `/reject`); üçü de `If-Match` taşır. Gerekçe yalnız denetim
// kaydına yazılır, kayıtta ve velide görünmez (Sabah kararı 72).
// Üç komut da `exclusive`: yollu `issues` (geç mazeret `endDate`, örtüşme `startDate`, çözülmüş talep
// `status`) yalnız form alanında görünür, toast çıkmaz; yolsuz hata tek toast olur.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type OpenRequestBody = JsonBody<'openRequest'>
export type UpdateRequestBody = JsonBody<'updateRequest'>
export type NotifyAbsenceBody = JsonBody<'notifyAbsence'>
export type AttachAbsenceDocumentsBody = JsonBody<'attachAbsenceDocuments'>
export type RejectAbsenceBody = JsonBody<'rejectAbsence'>

/** Talep güncellemesi: okunan sürüm `If-Match` olarak zorunludur. */
export interface UpdateRequestInput {
  requestId: string
  version: number
  body: UpdateRequestBody
}

/** Başka kullanıcı talebi değiştirdi (`If-Match` tutmadı): panel güncel kayıtla yeniden açılır. */
export const REQUEST_CHANGED_MESSAGE =
  'Talep başka biri tarafından güncellendi. Güncel hâlini yükleyip yeniden deneyin.'

/** Mazeret kararı ve belge uçlarının hata kodlarının Türkçe iletisi (DOM-ILT-053). */
export const ABSENCE_MESSAGES = {
  absence_already_decided: 'Bu bildirim için karar zaten verildi. Güncel durum yüklendi.',
  absence_not_found: 'Bildirim bulunamadı.',
  absence_document_limit: 'Bir bildirime en fazla 3 belge eklenebilir.',
  absence_document_unavailable: 'Seçilen belge kullanılamıyor. Belgeyi yeniden yükleyin.',
  absence_document_purpose: 'Bu dosya özür belgesi olarak yüklenmemiş. Yeniden yükleyin.',
  absence_document_late:
    'Özür belgesi ekleme süresi doldu. Belgeyi okula doğrudan iletebilirsiniz.',
  absence_document_duplicate: 'Bu belge bildirime zaten eklendi.',
  file_not_ready: 'Belge henüz hazır değil. Taramanın bitmesini bekleyip yeniden deneyin.',
  file_already_attached: 'Bu belge başka bir kayda eklenmiş. Yeniden yükleyin.',
  version_conflict:
    'Bildirim başka biri tarafından güncellendi. Güncel hâlini yükleyip yeniden deneyin.',
} as const satisfies CommandMessages

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
      header: { ...idempotencyOnly(headers), 'if-match': requireIfMatch(headers) },
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

/** Veli bildirimine sonradan özür belgesi ekler; okunan sürüm `If-Match` olur. */
export interface AttachAbsenceDocumentsInput {
  absenceId: string
  version: number
  body: AttachAbsenceDocumentsBody
}

/** Yönetici kararı: onayın gövdesi boştur, redde gerekçe girer; okunan sürüm `If-Match` olur. */
export interface ApproveAbsenceInput {
  absenceId: string
  version: number
}

export interface RejectAbsenceInput {
  absenceId: string
  version: number
  body: RejectAbsenceBody
}

export function attachAbsenceDocumentsRequest(
  client: KampusClient,
  { absenceId, body }: AttachAbsenceDocumentsInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/absences/{absenceId}/documents', {
    params: {
      path: { absenceId },
      header: { ...idempotencyOnly(headers), 'if-match': requireIfMatch(headers) },
    },
    body,
  })
}

export function approveAbsenceRequest(
  client: KampusClient,
  { absenceId }: ApproveAbsenceInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/absences/{absenceId}/approve', {
    params: {
      path: { absenceId },
      header: { ...idempotencyOnly(headers), 'if-match': requireIfMatch(headers) },
    },
    body: {},
  })
}

export function rejectAbsenceRequest(
  client: KampusClient,
  { absenceId, body }: RejectAbsenceInput,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/absences/{absenceId}/reject', {
    params: {
      path: { absenceId },
      header: { ...idempotencyOnly(headers), 'if-match': requireIfMatch(headers) },
    },
    body,
  })
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
    exclusive: true,
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
    exclusive: true,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/** Veli izin veya mazeret bildirir (201); bildirim geçmişi tazelenir. */
export function useNotifyAbsence(options: CommandOptions = {}) {
  return useApiCommand({
    request: notifyAbsenceRequest,
    invalidates: absences,
    messages: ABSENCE_MESSAGES,
    exclusive: true,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/** Veli bildirime belge ekler (DOM-ILT-053); bildirim ve geçmiş tazelenir. */
export function useAttachAbsenceDocuments(options: CommandOptions = {}) {
  return useApiCommand({
    request: attachAbsenceDocumentsRequest,
    version: (input: AttachAbsenceDocumentsInput) => input.version,
    invalidates: absences,
    messages: ABSENCE_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/** Yönetici bildirimi onaylar; ikinci karar 409 `absence_already_decided`. */
export function useApproveAbsence(options: CommandOptions = {}) {
  return useApiCommand({
    request: approveAbsenceRequest,
    version: (input: ApproveAbsenceInput) => input.version,
    invalidates: absences,
    messages: ABSENCE_MESSAGES,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/** Yönetici bildirimi gerekçeyle reddeder; gerekçe hatası alanda görünür (`reason`). */
export function useRejectAbsence(options: CommandOptions = {}) {
  return useApiCommand({
    request: rejectAbsenceRequest,
    version: (input: RejectAbsenceInput) => input.version,
    invalidates: absences,
    messages: ABSENCE_MESSAGES,
    exclusive: true,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}
