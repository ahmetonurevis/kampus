import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

import { isApiError } from '@kampus/api-client/errors.ts'

import { isInstitutionKey, SESSION_KEY_ROOT } from './query-keys.ts'

/** Taze sayılma süresi; liste ekranları arasında gezinirken gereksiz yeniden istek atılmaz. */
export const DEFAULT_STALE_TIME_MS = 30_000

const MAX_RETRIES = 2

/**
 * Yeniden deneme: istemci hatalarında (401 dahil her 4xx; 429 hız sınırı da) yok, çünkü tekrar
 * aynı sonucu verir ya da yükü artırır. Yalnız ağ hatası ve 5xx en fazla iki kez denenir.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (!isApiError(error)) return false
  if (error.status >= 400 && error.status < 500) return false
  return failureCount < MAX_RETRIES
}

export interface KampusQueryClientOptions {
  /** Herhangi bir sorgu/mutasyon 401 aldığında çağrılır (ör. girişe yönlendirme). */
  onUnauthenticated?: () => void
  staleTimeMs?: number
}

export function createKampusQueryClient(options: KampusQueryClientOptions = {}): QueryClient {
  const handleError = (error: unknown) => {
    if (isApiError(error) && error.status === 401) options.onUnauthenticated?.()
  }
  return new QueryClient({
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({ onError: handleError }),
    defaultOptions: {
      queries: {
        staleTime: options.staleTimeMs ?? DEFAULT_STALE_TIME_MS,
        retry: shouldRetry,
      },
      // Mutasyon yinelemesi çift kayda yol açabilir; kullanıcı kendi başlatır.
      mutations: { retry: false },
    },
  })
}

/**
 * Kurum değişince eski kurumun sorgularını iptal edip önbellekten siler. Oturum verisi (`/me`)
 * korunur; çağıran onu ayrıca yeniler.
 */
export async function clearInstitutionCache(queryClient: QueryClient): Promise<void> {
  const predicate = (query: { queryKey: readonly unknown[] }) => isInstitutionKey(query.queryKey)
  await queryClient.cancelQueries({ predicate })
  queryClient.removeQueries({ predicate })
}

export type CacheAction = 'none' | 'clear-institution' | 'clear-all'

export interface CacheSnapshot {
  authenticated: boolean
  /** Better Auth oturumunun kullanıcısı; oturum yokken `null`. */
  userId: string | null
  institutionId: string | null
}

/**
 * Oturum, kullanıcı veya etkin kurum değişince önbelleğe ne yapılacağı. Oturum kapanırsa ya da
 * kullanıcı kimliği değişirse (A→B, arada `unauthenticated` görülmese de) her şey silinir
 * (sonraki kullanıcı öncekinin verisini görmesin); kurum değişirse yalnız kuruma bağlı sorgular.
 */
export function cacheActionFor(previous: CacheSnapshot, next: CacheSnapshot): CacheAction {
  if (previous.authenticated && !next.authenticated) return 'clear-all'
  if (previous.userId !== null && previous.userId !== next.userId) return 'clear-all'
  if (previous.institutionId !== null && previous.institutionId !== next.institutionId) {
    return 'clear-institution'
  }
  return 'none'
}

/**
 * Oturum kullanıcı çıkış yapmadan kapandığında (ör. `/me` 401) kuruma bağlı verinin tamamını
 * siler; Better Auth durumu henüz `authenticated` kalsa bile sonraki girişe sızmaz. Oturum
 * sorgusu (`/me`) kalır: yeniden istek atmadan 401 durumu korunur.
 */
export async function clearSessionData(queryClient: QueryClient): Promise<void> {
  const predicate = (query: { queryKey: readonly unknown[] }) =>
    query.queryKey[0] !== SESSION_KEY_ROOT
  await queryClient.cancelQueries({ predicate })
  queryClient.removeQueries({ predicate })
}
