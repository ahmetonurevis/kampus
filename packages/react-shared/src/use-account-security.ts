// Hesap güvenliği kancaları (IST-003). Better Auth uçları istemcinin kendi yöntemleriyle çağrılır
// (`/api/v1/auth/*` OpenAPI'de yoktur); istemci platformdan verilir (web `authClient`, mobil
// `expoClient`'lı istemci). Hata `ApiError`'a çevrilir; eski oturum `reauthentication_required` olur.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, toApiError } from '@kampus/api-client/errors.ts'

import {
  accountSecurityError,
  parseSessionList,
  type AccountSecurityAction,
  type SessionListItem,
} from './account-security.ts'
import { sessionKey } from './query-keys.ts'
import type { AuthClientError } from './sign-in-errors.ts'

type AuthResult<T = unknown> = Promise<{ data?: T | null; error: AuthClientError | null }>

/** Better Auth istemcisinin (`better-auth/react`) hesap güvenliği yöntemleri. */
export interface AccountSecurityClient {
  requestPasswordReset(input: { email: string }): AuthResult
  resetPassword(input: { newPassword: string; token: string }): AuthResult
  changePassword(input: {
    currentPassword: string
    newPassword: string
    revokeOtherSessions?: boolean
  }): AuthResult
  listSessions(): AuthResult
  revokeSession(input: { token: string }): AuthResult
  revokeOtherSessions(): AuthResult
}

/** Oturum listesi kullanıcıya özgüdür, kuruma değil (`['session', 'devices']`). */
export const SESSION_LIST_QUERY_KEY = sessionKey('devices')

/** Better Auth çağrısı: hata sonucu ya da fırlatma `ApiError` olur. */
export async function runAuthCall<T>(
  action: AccountSecurityAction,
  call: () => AuthResult<T>,
): Promise<T | null | undefined> {
  let result: Awaited<AuthResult<T>>
  try {
    result = await call()
  } catch (cause) {
    throw toApiError(cause)
  }
  if (result.error) throw accountSecurityError(action, result.error)
  return result.data
}

/** Parola sıfırlama bağlantısı ister; yanıt hesap olsun olmasın aynıdır. */
export function useRequestPasswordReset(client: AccountSecurityClient) {
  return useMutation<void, ApiError, string>({
    mutationFn: async (email) => {
      await runAuthCall('request-reset', () => client.requestPasswordReset({ email }))
    },
  })
}

/** E-postadaki belirteçle yeni parola koyar; bütün oturumlar sunucuda kapanır. */
export function useResetPassword(client: AccountSecurityClient) {
  return useMutation<void, ApiError, { token: string; newPassword: string }>({
    mutationFn: async (input) => {
      await runAuthCall('reset', () => client.resetPassword(input))
    },
  })
}

export function useChangePassword(client: AccountSecurityClient) {
  const queryClient = useQueryClient()
  return useMutation<
    void,
    ApiError,
    { currentPassword: string; newPassword: string; revokeOtherSessions: boolean }
  >({
    mutationFn: async (input) => {
      await runAuthCall('change', () => client.changePassword(input))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSION_LIST_QUERY_KEY }),
  })
}

/**
 * Açık oturumlar (bu cihaz başta). Better Auth taze oturum ister: eskiyse sorgu
 * `reauthentication_required` hatasıyla biter, ekran parolayı sorup `refetch` eder.
 */
export function useSessionList(client: AccountSecurityClient, enabled = true) {
  return useQuery<SessionListItem[], ApiError>({
    queryKey: SESSION_LIST_QUERY_KEY,
    enabled,
    retry: false,
    queryFn: async () =>
      parseSessionList(await runAuthCall('sessions', () => client.listSessions())),
  })
}

export function useRevokeSession(client: AccountSecurityClient) {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string>({
    mutationFn: async (token) => {
      await runAuthCall('sessions', () => client.revokeSession({ token }))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: SESSION_LIST_QUERY_KEY }),
  })
}

export function useRevokeOtherSessions(client: AccountSecurityClient) {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, void>({
    mutationFn: async () => {
      await runAuthCall('sessions', () => client.revokeOtherSessions())
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: SESSION_LIST_QUERY_KEY }),
  })
}
