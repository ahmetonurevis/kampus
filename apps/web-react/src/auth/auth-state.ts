// Better Auth oturum durumu + `/me` sorgusundan tek arayüz durumu. Saf işlev; testte doğrudan çağrılır.
import { isApiError } from '@kampus/api-client/errors.ts'
import type { SessionStatus } from '@kampus/react-shared/session-status.ts'
import type { AuthState } from './auth-port.ts'
import { toSession, type Me } from './session-mapping.ts'

export interface MeQueryState {
  data: Me | undefined
  error: unknown
}

export function authStateFrom(sessionStatus: SessionStatus, me: MeQueryState): AuthState {
  if (sessionStatus === 'loading') return { status: 'loading', session: null }
  if (sessionStatus === 'unauthenticated') return { status: 'signed-out', session: null }
  // `/me` 401 verdiyse oturum sunucuda bitmiştir; Better Auth durumu yenilenene kadar beklenmez.
  if (isApiError(me.error) && me.error.status === 401)
    return { status: 'signed-out', session: null }
  if (me.data) {
    const session = toSession(me.data)
    return session ? { status: 'signed-in', session } : { status: 'no-membership', session: null }
  }
  if (me.error) return { status: 'error', session: null }
  return { status: 'loading', session: null }
}

export type SettledStatus = Exclude<AuthState['status'], 'loading'>

/**
 * Açık oturum kullanıcı çıkış yapmadan kapandıysa (süre doldu, başka cihazdan sonlandırıldı,
 * herhangi bir istek 401 aldı) kullanıcıya bildirilir. `loading` ara durumu yok sayılır.
 */
export function sessionExpired(
  previous: SettledStatus | null,
  next: AuthState['status'],
  intentionalSignOut: boolean,
): boolean {
  return previous === 'signed-in' && next === 'signed-out' && !intentionalSignOut
}

/**
 * Bilinçli çıkış bayrağı oturum kapalı kaldıkça korunur; yeni bir oturum açılınca düşer.
 * Kabuk çıkıştan sonra yönlendirme bitmeden yeniden çizilebilir; bayrak erken düşerse giriş
 * adresine dönüş adresi (`?donus=`) eklenirdi.
 */
export function keepsIntentionalSignOut(current: boolean, status: AuthState['status']): boolean {
  return current && (status === 'signed-out' || status === 'loading')
}
