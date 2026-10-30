import { createContext, useContext } from 'react'

import type { KampusClient } from '@kampus/api-client/client.ts'

/** Better Auth `useSession` çıktısının kullandığımız kısmı (gerçek istemci buna uyar). */
export interface SessionState {
  data: { user: { id: string; name?: string; email?: string } } | null
  isPending: boolean
}

/**
 * Better Auth istemcisinin (`better-auth/react`) kullandığımız kısmı. İstemciyi kuran kod
 * platforma özgüdür (web, mobil `expoClient`); burada yalnız arayüzü bilinir.
 */
export interface AuthClientLike {
  useSession: () => SessionState
  organization: {
    setActive: (input: {
      organizationId: string
    }) => Promise<{ error: { status?: number; code?: string } | null }>
  }
}

export interface KampusContextValue {
  client: KampusClient
  auth: AuthClientLike
}

export const KampusContext = createContext<KampusContextValue | null>(null)

function useKampusContext(): KampusContextValue {
  const value = useContext(KampusContext)
  if (!value) throw new Error('KampusProvider dışında kullanılamaz.')
  return value
}

export function useKampusClient(): KampusClient {
  return useKampusContext().client
}

export function useAuthClient(): AuthClientLike {
  return useKampusContext().auth
}
