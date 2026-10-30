import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { components } from '@kampus/api-client/schema.d.ts'
import { ApiError, toApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from './api-result.ts'
import { useAuthClient, useKampusClient } from './kampus-context.ts'
import { clearInstitutionCache } from './query-client.ts'
import { ME_QUERY_KEY } from './query-keys.ts'
import { useSession } from './use-session.ts'

export type Me = components['schemas']['Me']

const SWITCH_FAILED_MESSAGE = 'Kurum değiştirilemedi. Lütfen tekrar deneyin.'

/**
 * `GET /api/v1/me` sorgusu: oturumun kullanıcısı, etkin kurumu/üyeliği ve bütün üyelikleri.
 * Oturum açık değilken istek atılmaz. Aynı anahtar olduğundan her çağrı tek isteği paylaşır.
 */
export function useMe() {
  const client = useKampusClient()
  const { status } = useSession()
  return useQuery<Me, ApiError>({
    queryKey: ME_QUERY_KEY,
    queryFn: ({ signal }) =>
      runRequest(() => client.GET('/api/v1/me', { signal })).then((r) => r.data),
    enabled: status === 'authenticated',
  })
}

/** Etkin kurum kimliği; `/me` gelene kadar veya üyelik yoksa `null`. */
export function useActiveInstitutionId(): string | null {
  return useMe().data?.activeInstitution?.id ?? null
}

/**
 * Etkin kurum, üyelik/rol ve kurum değiştirme. `switchInstitution` Better Auth
 * `organization.setActive` çağırır, eski kurumun sorgularını siler ve `/me`'yi yeniler.
 */
export function useActiveInstitution() {
  const queryClient = useQueryClient()
  const auth = useAuthClient()
  const me = useMe()

  const switchInstitution = useMutation<void, ApiError, string>({
    mutationFn: async (institutionId) => {
      try {
        const { error } = await auth.organization.setActive({ organizationId: institutionId })
        if (error) {
          throw new ApiError({
            status: error.status ?? 0,
            code: error.code ?? 'institution_switch_failed',
            message: SWITCH_FAILED_MESSAGE,
          })
        }
      } catch (cause) {
        throw toApiError(cause)
      }
      await clearInstitutionCache(queryClient)
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
    },
  })

  return {
    institution: me.data?.activeInstitution ?? null,
    membership: me.data?.activeMembership ?? null,
    role: me.data?.activeMembership?.role ?? null,
    memberships: me.data?.memberships ?? [],
    // Oturum kapalıyken sorgu hiç başlamaz; o durumda yükleniyor sayılmaz.
    isPending: me.isLoading,
    error: me.error,
    switchInstitution,
  }
}
