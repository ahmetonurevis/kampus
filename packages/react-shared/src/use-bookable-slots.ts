import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import type { ApiError } from '@kampus/api-client/errors.ts'

import {
  bookableSlotsQueryOptions,
  type BookableSlot,
  type BookableSlotsRange,
} from './appointment-slots.ts'
import { useKampusClient } from './kampus-context.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'

/**
 * Öğrencinin (velide seçili çocuğun) randevu alınabilecek saatleri (DOM-ILT-105). `studentId`
 * boşken istek atılmaz. Randevu talebi ve durum değişikliği bu sorguyu geçersiz kılar
 * (`use-appointment-commands.ts`).
 */
export function useBookableSlots(
  studentId: string | null | undefined,
  range: BookableSlotsRange = {},
  options: { enabled?: boolean } = {},
): UseQueryResult<BookableSlot[], ApiError> {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery(
    bookableSlotsQueryOptions(client, institutionId, studentId, range, options.enabled),
  )
}
