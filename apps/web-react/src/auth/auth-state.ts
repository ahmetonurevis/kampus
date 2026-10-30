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
