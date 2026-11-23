import { useAuthClient, type SessionState } from './kampus-context.ts'
import { sessionStatus, type SessionStatus } from './session-status.ts'

export interface UseSessionResult {
  status: SessionStatus
  user: NonNullable<SessionState['data']>['user'] | null
}

/**
 * Better Auth oturumu. Oturum kapanınca önbelleğin temizlenmesi `KampusProvider`'dadır;
 * bileşenler yalnız durumu okur.
 */
export function useSession(): UseSessionResult {
  const state = useAuthClient().useSession()
  return { status: sessionStatus(state), user: state.data?.user ?? null }
}
