import { use, useMemo } from 'react'
import { useMe } from '@kampus/react-shared/use-active-institution.ts'
import { useSession } from '@kampus/react-shared/use-session.ts'
import { AuthContext } from './auth-context.ts'
import { authStateFrom } from './auth-state.ts'

/** Oturum durumu (Better Auth + `/me`) ve giriş/çıkış işlemleri. */
export function useAuth() {
  const auth = use(AuthContext)
  if (!auth) throw new Error('useAuth, AuthProvider içinde kullanılmalı.')
  const { status } = useSession()
  const me = useMe()
  const state = useMemo(
    () => authStateFrom(status, { data: me.data, error: me.error }),
    [status, me.data, me.error],
  )
  return {
    ...state,
    signIn: auth.signIn,
    signOut: auth.signOut,
    isSigningOut: auth.isSigningOut,
    retry: me.refetch,
  }
}
