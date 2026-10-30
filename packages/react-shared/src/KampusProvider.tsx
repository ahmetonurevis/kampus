import { QueryClientProvider, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'

import type { KampusClient } from '@kampus/api-client/client.ts'

import { KampusContext, type AuthClientLike, type NotifyError } from './kampus-context.ts'
import { cacheActionFor, clearInstitutionCache, type CacheSnapshot } from './query-client.ts'
import { useActiveInstitutionId, useMe } from './use-active-institution.ts'
import { useSession } from './use-session.ts'

/**
 * Oturum kapanınca bütün önbelleği, etkin kurum değişince kuruma bağlı sorguları siler.
 * Kurum başka sekmede/oturum yenilemesiyle de değişebildiği için `switchInstitution`'dan
 * bağımsız, durumu izleyerek çalışır.
 */
function CacheGuard() {
  const queryClient = useQueryClient()
  const { status } = useSession()
  const me = useMe()
  const institutionId = useActiveInstitutionId()
  const settled = !me.isLoading && status !== 'loading'
  const previous = useRef<CacheSnapshot>({ authenticated: false, institutionId: null })

  useEffect(() => {
    if (!settled) return
    const next: CacheSnapshot = { authenticated: status === 'authenticated', institutionId }
    const action = cacheActionFor(previous.current, next)
    previous.current = next
    if (action === 'clear-all') queryClient.clear()
    else if (action === 'clear-institution') void clearInstitutionCache(queryClient)
  }, [settled, status, institutionId, queryClient])

  return null
}

export interface KampusProviderProps {
  client: KampusClient
  auth: AuthClientLike
  queryClient: QueryClient
  /** Yazma komutlarının hata bildirimi (`useApiCommand`); web'de sonner toast. */
  notifyError?: NotifyError
  children: ReactNode
}

/** Web ve mobil kökünde bir kez: API istemcisi, Better Auth istemcisi ve sorgu önbelleği. */
export function KampusProvider({
  client,
  auth,
  queryClient,
  notifyError,
  children,
}: KampusProviderProps) {
  const value = useMemo(() => ({ client, auth, notifyError }), [client, auth, notifyError])
  return (
    <QueryClientProvider client={queryClient}>
      <KampusContext.Provider value={value}>
        <CacheGuard />
        {children}
      </KampusContext.Provider>
    </QueryClientProvider>
  )
}
