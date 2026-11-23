import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'

import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest, type ApiResult, type DataOf } from './api-result.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'

// Kayıt ve finans uçlarının sayfalı liste sorgusu (ON-319). Koleksiyon listeleriyle
// (`useCollectionList`) aynı davranış: sayfa, arama ya da süzgeç değişince yeni yanıt gelene kadar
// önceki sayfa ekranda kalır (`isPlaceholderData`); liste "yükleniyor"a düşüp zıplamaz. Ekran
// `fetching={isFetching && !isPending}` ile eski satırları soluk gösterir.

export interface FinanceListQuery<TResult extends ApiResult> {
  /** Anahtar parçaları; etkin kurum başa kendiliğinden eklenir (`useApiQuery` ile aynı anahtar). */
  key: readonly unknown[]
  /** `client.GET(...)` çağrısı; `signal` iptal için isteğe verilmelidir. */
  request: (client: KampusClient, signal: AbortSignal) => Promise<TResult>
}

export interface FinanceListQueryOptions {
  enabled?: boolean
  /**
   * `false`: anahtar değişince önceki yanıt gösterilmez. Liste değil seçenek ya da hesap kaynağı
   * olan çağrılar için (ör. başka yılın tarifesi, başka ailenin hakları yer tutucu olmamalı).
   */
  keepPreviousPage?: boolean
}

/** `useFinanceListQuery` sorgu seçenekleri; kancadan ayrı tutulur, `QueryObserver` ile sınanır. */
export function financeListQueryOptions<TResult extends ApiResult>(
  client: KampusClient,
  institutionId: string | null,
  query: FinanceListQuery<TResult>,
  options: FinanceListQueryOptions = {},
) {
  return {
    queryKey: institutionKey(institutionId, ...query.key),
    queryFn: ({ signal }: { signal: AbortSignal }): Promise<DataOf<TResult>> =>
      runRequest(() => query.request(client, signal)),
    enabled: institutionId !== null && (options.enabled ?? true),
    ...(options.keepPreviousPage === false ? {} : { placeholderData: keepPreviousData }),
  }
}

export function useFinanceListQuery<TResult extends ApiResult>(
  query: FinanceListQuery<TResult>,
  options: FinanceListQueryOptions = {},
): UseQueryResult<DataOf<TResult>, ApiError> {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery<DataOf<TResult>, ApiError>(
    financeListQueryOptions(client, institutionId, query, options),
  )
}
