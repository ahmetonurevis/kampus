export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated'

/** Better Auth `useSession` durumundan oturum durumu: bekleyen, açık ya da kapalı. */
export function sessionStatus(state: { data: unknown; isPending: boolean }): SessionStatus {
  if (state.isPending) return 'loading'
  return state.data ? 'authenticated' : 'unauthenticated'
}
