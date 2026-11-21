import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import type { KampusClient } from '@kampus/api-client/client.ts'

import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiQuery } from './use-api-query.ts'

/**
 * Öğrencinin kimlik özeti (ON-063; `GET /students/{id}/identity`): tür, maskeli numara, doğum
 * tarihi ve kayıt yılı. Yalnız yönetici ve ön büro okur; her okuma sunucuda denetim kaydına yazılır
 * (`student_identity.read`, DOM-YTK-052). Bu yüzden sağlık bilgisi gibi açılışta okunmaz:
 * kullanıcı "göster" deyince okur, "gizle" deyince ya da öğrenci değişince bellekten atılır
 * (`gcTime: 0`); pencere odağı ve yeniden bağlanma yeni okuma (yeni denetim satırı) başlatmaz.
 */

const STUDENT_IDENTITY_KEY_ROOT = 'student-identity'

export const studentIdentityKey = (studentId: string) =>
  [STUDENT_IDENTITY_KEY_ROOT, studentId] as const

export function studentIdentityRequest(
  client: KampusClient,
  studentId: string,
  signal?: AbortSignal,
) {
  return client.GET('/api/v1/students/{studentId}/identity', {
    params: { path: { studentId } },
    ...(signal ? { signal } : {}),
  })
}

export const STUDENT_IDENTITY_QUERY_POLICY = {
  gcTime: 0,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const

export function useStudentIdentity(studentId: string, options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: studentIdentityKey(studentId),
    request: (client, signal) => studentIdentityRequest(client, studentId, signal),
    ...STUDENT_IDENTITY_QUERY_POLICY,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  })
}

/**
 * İsteğe bağlı kimlik özeti: kapalı başlar, `show` ile okur, `hide` ile veriyi atar. Seçili öğrenci
 * değişince yeniden kapanır (önceki öğrencinin verisi izleyicisiz kalır ve atılır).
 */
export function useStudentIdentityReveal(studentId: string) {
  const queryClient = useQueryClient()
  const institutionId = useActiveInstitutionId()
  const [revealedFor, setRevealedFor] = useState<string | null>(null)
  if (revealedFor !== null && revealedFor !== studentId) setRevealedFor(null)
  const revealed = revealedFor === studentId
  const query = useStudentIdentity(studentId, { enabled: revealed })
  return {
    revealed,
    query,
    show: () => setRevealedFor(studentId),
    hide: () => {
      setRevealedFor(null)
      queryClient.removeQueries({
        queryKey: institutionKey(institutionId, ...studentIdentityKey(studentId)),
      })
    },
  }
}
