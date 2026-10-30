import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import { authClient, refreshAuthSession } from '@/lib/kampus-clients.ts'
import { notify } from '@/lib/notify.ts'
import { clearViewMemory } from '@/lib/view-memory.ts'
import { AuthContext } from './auth-context.ts'
import type { AuthPort } from './auth-port.ts'
import { sessionExpired, type SettledStatus } from './auth-state.ts'
import { createBetterAuthPort } from './better-auth-port.ts'
import { useAuth } from './use-auth.ts'

const defaultAuth: AuthPort = createBetterAuthPort({
  client: authClient,
  refreshSession: refreshAuthSession,
})

export const SESSION_EXPIRED_MESSAGE = 'Oturumunuzun süresi doldu. Yeniden giriş yapın.'

/**
 * Oturum kendiliğinden kapanınca uyarı gösterir ve görünüm belleğini siler. Korumalı kabuk
 * aynı anda dönüş adresiyle girişe yönlendirir.
 */
function SessionExpiryNotice({ intentionalRef }: { intentionalRef: RefObject<boolean> }) {
  const { status } = useAuth()
  const previous = useRef<SettledStatus | null>(null)
  useEffect(() => {
    if (status === 'loading') return
    if (sessionExpired(previous.current, status, intentionalRef.current)) {
      clearViewMemory()
      notify.warning(SESSION_EXPIRED_MESSAGE, 'session-expired')
    }
    if (status === 'signed-out') intentionalRef.current = false
    previous.current = status
  }, [status, intentionalRef])
  return null
}

/** `KampusProvider` içinde kullanılır: oturum durumu Better Auth ve `/me` sorgusundan okunur. */
export function AuthProvider({
  auth = defaultAuth,
  children,
}: {
  auth?: AuthPort
  children: ReactNode
}) {
  // Kullanıcının kendi çıkışı süre dolması sayılmaz.
  const intentionalRef = useRef(false)
  const value = useMemo<AuthPort>(
    () => ({
      signIn: auth.signIn,
      async signOut() {
        intentionalRef.current = true
        try {
          await auth.signOut()
        } catch (error) {
          intentionalRef.current = false
          throw error
        }
      },
    }),
    [auth],
  )
  return (
    <AuthContext value={value}>
      <SessionExpiryNotice intentionalRef={intentionalRef} />
      {children}
    </AuthContext>
  )
}
