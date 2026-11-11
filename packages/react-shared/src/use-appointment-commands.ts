import type { KampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { appointmentSlotsPrefix } from './appointment-slots.ts'
import { collectionKeyPrefix } from './collections.ts'
import type { CommandHeaders, CommandMessages } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'

// Öğretmen randevusu yazma komutları (`POST /appointments`, `PATCH /appointments/:id`; core
// `appointment.book` `appointment.update`, DOM-ILT-100…104). Randevu okuması genel koleksiyon
// kancalarında, alınabilir saatler `useBookableSlots`'tadır (DOM-ILT-105).
// İki komut da `exclusive`: yollu `issues` (dolu saat `slotId`, eksik gerekçe `reason`, yanlış geçiş
// `status`) yalnız form alanında görünür, toast çıkmaz; yolsuz hata tek toast olur.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type BookAppointmentBody = JsonBody<'bookAppointment'>
export type UpdateAppointmentBody = JsonBody<'updateAppointment'>

/**
 * Randevu durum değişikliği: okunan sürüm `If-Match` olarak zorunludur. Sürüm bilinmiyorsa
 * (`null`) istek atılmaz; boş `If-Match` sunucuda kilitsiz yazma sanılmasın diye gönderilmez.
 */
export interface UpdateAppointmentInput {
  appointmentId: string
  version: number | null
  body: UpdateAppointmentBody
}

/** Başka kullanıcı randevuyu değiştirdi (`If-Match` tutmadı): panel güncel kayıtla yeniden açılır. */
export const APPOINTMENT_CHANGED_MESSAGE =
  'Randevu başka biri tarafından güncellendi. Güncel hâlini yükleyip yeniden deneyin.'
/** Sürümü bilinmeyen randevu için istek atılmadan gösterilen mesaj. */
export const APPOINTMENT_VERSION_MISSING_MESSAGE =
  'Randevunun güncel bilgisi yüklenemedi. Sayfayı yenileyip yeniden deneyin.'

export const APPOINTMENT_MESSAGES = {
  version_conflict: APPOINTMENT_CHANGED_MESSAGE,
  if_match_required: APPOINTMENT_VERSION_MISSING_MESSAGE,
} as const satisfies CommandMessages

const idempotencyOnly = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
})

export function bookAppointmentRequest(
  client: KampusClient,
  body: BookAppointmentBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/appointments', {
    params: { header: idempotencyOnly(headers) },
    body,
  })
}

export async function updateAppointmentRequest(
  client: KampusClient,
  { appointmentId, body }: UpdateAppointmentInput,
  headers: CommandHeaders,
) {
  const ifMatch = headers['if-match']
  // Sunucu da 400 `if_match_required` verir; istemci isteği hiç atmaz.
  if (ifMatch === undefined || ifMatch === '')
    throw new ApiError({
      status: 400,
      code: 'if_match_required',
      message: APPOINTMENT_VERSION_MISSING_MESSAGE,
    })
  return client.PATCH('/api/v1/appointments/{appointmentId}', {
    params: {
      path: { appointmentId },
      header: { ...idempotencyOnly(headers), 'if-match': ifMatch },
    },
    body,
  })
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}

/**
 * Randevu yazıldıktan sonra randevular ve alınabilir saat listeleri tazelenir: talep, onay, red,
 * geri çekme ve iptal saatin doluluğunu değiştirir (DOM-ILT-104, DOM-ILT-105).
 */
export const APPOINTMENT_INVALIDATES = [
  collectionKeyPrefix('appointments'),
  appointmentSlotsPrefix(),
] as const

/** Veli bağlı çocuğu, öğrenci kendisi için randevu talep eder (201); randevular tazelenir. */
export function useBookAppointment(options: CommandOptions = {}) {
  return useApiCommand({
    request: bookAppointmentRequest,
    invalidates: APPOINTMENT_INVALIDATES,
    messages: APPOINTMENT_MESSAGES,
    exclusive: true,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}

/** Randevuyu onaylar, reddeder, iptal eder veya geri çeker; `If-Match` okunan sürümdür. */
export function useUpdateAppointment(options: CommandOptions = {}) {
  return useApiCommand({
    request: updateAppointmentRequest,
    version: (input: UpdateAppointmentInput) => input.version,
    invalidates: APPOINTMENT_INVALIDATES,
    messages: APPOINTMENT_MESSAGES,
    exclusive: true,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}
