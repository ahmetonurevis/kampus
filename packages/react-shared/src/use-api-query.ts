import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest, type ApiResult, type DataOf } from './api-result.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey, sessionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'

export interface ApiQueryOptions<TResult extends ApiResult> {
  /** Anahtar parçaları (kaynak adı, filtre…); etkin kurum başa kendiliğinden eklenir. */
  key: readonly unknown[]
  /** `client.GET(...)` çağrısı; `signal` iptal için isteğe verilmelidir. */
  request: (client: KampusClient, signal: AbortSignal) => Promise<TResult>
  /** `institution` (varsayılan): etkin kurum yokken çalışmaz. `session`: kuruma bağlı olmayan veri. */
  scope?: 'institution' | 'session'
  enabled?: boolean
  staleTime?: number
}

/**
 * `openapi-fetch` çağrısını TanStack Query ile çalıştıran ince sarmalayıcı. Veri tipi
 * çağrının başarı yanıtından gelir; hata her zaman `ApiError`'dır.
 *
 * ```ts
 * const me = useApiQuery({
 *   key: ['students', { page }],
 *   request: (client, signal) => client.GET('/api/v1/students', { params: { query: { page } }, signal }),
 * })
 * ```
 */
export function useApiQuery<TResult extends ApiResult>(
  options: ApiQueryOptions<TResult>,
): UseQueryResult<DataOf<TResult>, ApiError> {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  const scope = options.scope ?? 'institution'
  const scopeReady = scope === 'session' || institutionId !== null
  return useQuery<DataOf<TResult>, ApiError>({
    queryKey:
      scope === 'session'
        ? sessionKey(...options.key)
        : institutionKey(institutionId, ...options.key),
    queryFn: ({ signal }) => runRequest(() => options.request(client, signal)),
    enabled: scopeReady && (options.enabled ?? true),
    ...(options.staleTime !== undefined ? { staleTime: options.staleTime } : {}),
  })
}
