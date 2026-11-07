import type { operations } from '@kampus/api-client/schema.d.ts'
import type {
  FreezeStatus,
  RequestFreezeInput,
} from '@kampus/school-core/lib/enrollment-freezes.ts'

import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch } from './commands.ts'
import { LANGUAGE_GROUPS_KEY } from './language-groups.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Kayıt dondurma kancaları (`/finance/enrollment-freezes`; DOM-DIL-052, DOM-KAY-024, -026, IST-084).
// Onay ve dönüş grup doluluğunu ve öğrencinin kayıt durumunu değiştirir: ikisi de tazelenir.

export type EnrollmentFreeze =
  operations['listEnrollmentFreezes']['responses'][200]['content']['application/json']['data'][number]

const FREEZES_KEY = ['enrollment-freezes'] as const
const FREEZE_CHANGED_MESSAGE = 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.'
const AFFECTED = [FREEZES_KEY, LANGUAGE_GROUPS_KEY, collectionKeyPrefix('students')]

export function useEnrollmentFreezes(query: {
  page: number
  pageSize: number
  status?: FreezeStatus
  /** Kursiyer adında arama (en az 2 karakter). */
  q?: string
}) {
  return useApiQuery({
    key: [...FREEZES_KEY, query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/enrollment-freezes', { params: { query }, signal }),
  })
}

export function useRequestEnrollmentFreeze() {
  return useApiCommand({
    request: (client, body: RequestFreezeInput, headers) =>
      client.POST('/api/v1/finance/enrollment-freezes', { params: { header: headers }, body }),
    invalidates: [FREEZES_KEY],
    exclusive: true,
  })
}

export function useApproveEnrollmentFreeze() {
  return useApiCommand({
    request: (client, input: { freezeId: string; version: number }, headers) =>
      client.POST('/api/v1/finance/enrollment-freezes/{freezeId}/approve', {
        params: {
          path: { freezeId: input.freezeId },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
      }),
    invalidates: AFFECTED,
    version: (input) => input.version,
    messages: { version_conflict: FREEZE_CHANGED_MESSAGE },
    exclusive: true,
  })
}

export function useRejectEnrollmentFreeze() {
  return useApiCommand({
    request: (client, input: { freezeId: string; version: number }, headers) =>
      client.POST('/api/v1/finance/enrollment-freezes/{freezeId}/reject', {
        params: {
          path: { freezeId: input.freezeId },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
      }),
    invalidates: [FREEZES_KEY],
    version: (input) => input.version,
    messages: { version_conflict: FREEZE_CHANGED_MESSAGE },
    exclusive: true,
  })
}

export function useReturnEnrollmentFreeze() {
  return useApiCommand({
    request: (client, input: { freezeId: string; version: number }, headers) =>
      client.POST('/api/v1/finance/enrollment-freezes/{freezeId}/return', {
        params: {
          path: { freezeId: input.freezeId },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
      }),
    invalidates: AFFECTED,
    version: (input) => input.version,
    messages: { version_conflict: FREEZE_CHANGED_MESSAGE },
    exclusive: true,
  })
}
