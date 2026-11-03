// Uygulamanın tek API istemcisi, Better Auth istemcisi ve sorgu önbelleği. API aynı kökenden
// (`/api`, Vite vekili veya ters vekil) sunulur; oturum çerezdedir, belirteç JS'e hiç gelmez.
import { createAuthClient } from 'better-auth/react'
import { kampusAuthClientOptions } from '@kampus/api-client/auth.ts'
import { createKampusClient } from '@kampus/api-client/client.ts'
import { createKampusQueryClient } from '@kampus/react-shared/query-client.ts'
import type { AccountSecurityClient } from '@kampus/react-shared/use-account-security.ts'

export const authClient = createAuthClient(kampusAuthClientOptions(window.location.origin))

/**
 * Hesap güvenliği kancalarının istemcisi (IST-003, IST-025). Better Auth istemcisinin
 * `revokeSession`'ı belirteç ister; API belirteci istemciye vermediği için tek oturum kimliğiyle
 * (`{ sessionId }`) kapatılır, belirteci sunucu kullanıcının kendi oturumlarından çözer.
 */
export const accountSecurityClient: AccountSecurityClient = {
  requestPasswordReset: (input) => authClient.requestPasswordReset(input),
  resetPassword: (input) => authClient.resetPassword(input),
  changePassword: (input) => authClient.changePassword(input),
  listSessions: () => authClient.listSessions(),
  revokeSession: (input) => authClient.$fetch('/revoke-session', { method: 'POST', body: input }),
  revokeOtherSessions: () => authClient.revokeOtherSessions(),
}

export const apiClient = createKampusClient({ baseUrl: '', credentials: 'same-origin' })

/**
 * Better Auth oturum durumunu sunucudan yeniden okur. Herhangi bir API isteği 401 alınca
 * çağrılır: oturum sunucuda bitmişse (süre doldu, başka cihazdan kapatıldı) durum `null` olur
 * ve korumalı kabuk girişe yönlendirir.
 */
export function refreshAuthSession(): Promise<void> {
  const state: unknown = authClient.$store.atoms.session?.get()
  const refetch =
    typeof state === 'object' && state !== null ? Reflect.get(state, 'refetch') : undefined
  if (typeof refetch === 'function') return Promise.resolve(refetch()).then(() => undefined)
  authClient.$store.notify('$sessionSignal')
  return Promise.resolve()
}

export const queryClient = createKampusQueryClient({
  onUnauthenticated: () => {
    refreshAuthSession().catch((error: unknown) =>
      console.error('[auth] oturum yenilenemedi', error),
    )
  },
})
