import type { ReactNode } from 'react'
import { authClient, refreshAuthSession } from '@/lib/kampus-clients.ts'
import { AuthContext } from './auth-context.ts'
import type { AuthPort } from './auth-port.ts'
import { createBetterAuthPort } from './better-auth-port.ts'

const defaultAuth: AuthPort = createBetterAuthPort({
  client: authClient,
  refreshSession: refreshAuthSession,
})

/** `KampusProvider` içinde kullanılır: oturum durumu Better Auth ve `/me` sorgusundan okunur. */
export function AuthProvider({
  auth = defaultAuth,
  children,
}: {
  auth?: AuthPort
  children: ReactNode
}) {
  return <AuthContext value={auth}>{children}</AuthContext>
}
