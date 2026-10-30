import { use, useSyncExternalStore } from 'react'
import { AuthContext } from './auth-context.ts'

export function useAuth() {
  const auth = use(AuthContext)
  if (!auth) throw new Error('useAuth, AuthProvider içinde kullanılmalı.')
  const session = useSyncExternalStore(auth.subscribe, auth.getSession, auth.getSession)
  return { session, signIn: auth.signIn, signOut: auth.signOut }
}
