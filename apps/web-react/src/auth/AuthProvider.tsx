import type { ReactNode } from 'react'
import { AuthContext } from './auth-context.ts'
import type { AuthPort } from './auth-port.ts'
import { createDevAuth, createUnavailableAuth } from './dev-auth.ts'

// TODO(D2): Better Auth istemcisi gelince geliştirme sahtesi yerine gerçek uygulama bağlanır.
const defaultAuth: AuthPort = import.meta.env.DEV ? createDevAuth() : createUnavailableAuth()

export function AuthProvider({
  auth = defaultAuth,
  children,
}: {
  auth?: AuthPort
  children: ReactNode
}) {
  return <AuthContext value={auth}>{children}</AuthContext>
}
