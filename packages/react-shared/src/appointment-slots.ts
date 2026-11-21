import { queryOptions } from '@tanstack/react-query'

import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { components } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import { institutionKey } from './query-keys.ts'

/**
 * Veli ve öğrencinin randevu alabileceği saatler (`GET /api/v1/appointments/slots`, core
 * `bookableSlots`, DOM-ILT-105). `available: false` saat ekranda "Dolu" gösterilir; neden yanıtta
 * yoktur ve tahmin edilmez (DOM-ILT-073).
 */
export type BookableSlot = components['schemas']['BookableSlot']

/** İsteğe bağlı aralık (ISO 8601). Yoksa sunucu şimdiden itibaren 14 gün okur; en çok 28 gün. */
export interface BookableSlotsRange {
  from?: string | undefined
  /** Yalnız `from` ile verilir. */
  to?: string | undefined
}

export const APPOINTMENT_SLOTS_KEY_ROOT = 'appointment-slots'

/** Bütün saat listelerinin öneki; randevu yazıldıktan sonra bununla geçersiz kılınır. */
export function appointmentSlotsPrefix(): readonly unknown[] {
  return [APPOINTMENT_SLOTS_KEY_ROOT]
}

/** Sorgu anahtarı: etkin kurum, öğrenci (velide seçili çocuk) ve aralık. */
export function appointmentSlotsKey(
  institutionId: string | null,
  studentId: string,
  range: BookableSlotsRange = {},
) {
  return institutionKey(institutionId, APPOINTMENT_SLOTS_KEY_ROOT, studentId, {
    from: range.from || null,
    to: range.to || null,
  })
}

export async function fetchBookableSlots(
  client: KampusClient,
  studentId: string,
  range: BookableSlotsRange = {},
  signal?: AbortSignal,
): Promise<BookableSlot[]> {
  const body = await runRequest(() =>
    client.GET('/api/v1/appointments/slots', {
      params: {
        query: {
          studentId,
          ...(range.from ? { from: range.from } : {}),
          ...(range.to ? { to: range.to } : {}),
        },
      },
      ...(signal ? { signal } : {}),
    }),
  )
  return body.data
}

/**
 * Saat listesi her açılışta tazelenir (`staleTime: 0`): saatleri başka aileler ve öğretmen de
 * değiştirir; eski "boş" saat talepte çakışma alırdı. Öğrenci seçilmeden veya etkin kurum
 * bilinmeden istek atılmaz.
 */
export function bookableSlotsQueryOptions(
  client: KampusClient,
  institutionId: string | null,
  studentId: string | null | undefined,
  range: BookableSlotsRange = {},
  enabled = true,
) {
  const student = studentId ?? ''
  return queryOptions<BookableSlot[], ApiError>({
    queryKey: appointmentSlotsKey(institutionId, student, range),
    queryFn: ({ signal }) => fetchBookableSlots(client, student, range, signal),
    enabled: institutionId !== null && student !== '' && enabled,
    staleTime: 0,
  })
}
