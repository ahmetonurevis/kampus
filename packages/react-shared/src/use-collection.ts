import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useCallback } from 'react'

import type { ApiError } from '@kampus/api-client/errors.ts'

import {
  collectionItemKey,
  collectionQueryKey,
  fetchAllCollectionPages,
  fetchCollectionItem,
  fetchCollectionPage,
  type CollectionPage,
  type CollectionQuery,
  type CollectionRow,
} from './collections.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'

interface CollectionOptions {
  enabled?: boolean
}

/**
 * Sunucu sayfalı koleksiyon listesi. Anahtar etkin kurumla başlar; sorgu (sayfa, arama, filtre,
 * sıralama) değişirken önceki sayfa ekranda kalır (`isPlaceholderData`), liste boşalıp zıplamaz.
 */
export function useCollectionList<TRecord>(
  collection: string,
  query: CollectionQuery,
  options: CollectionOptions = {},
): UseQueryResult<CollectionPage<TRecord>, ApiError> {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery<CollectionPage<TRecord>, ApiError>({
    queryKey: institutionKey(institutionId, ...collectionQueryKey(collection, query)),
    queryFn: ({ signal }) => fetchCollectionPage<TRecord>(client, collection, query, signal),
    enabled: institutionId !== null && (options.enabled ?? true),
    placeholderData: keepPreviousData,
  })
}

/**
 * Koleksiyonun filtreye uyan bütün kayıtları (100'lük sayfalarla). Yalnız küçük başvuru verisi
 * (kampüs, sınıf, öğretmen adları) veya tek kaydın bağlı kayıtları için; büyük listeler
 * `useCollectionList` ile sayfalı okunur.
 */
export function useCollectionAll<TRecord>(
  collection: string,
  query: Omit<CollectionQuery, 'page' | 'pageSize'> = {},
  options: CollectionOptions = {},
): UseQueryResult<CollectionRow<TRecord>[], ApiError> {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery<CollectionRow<TRecord>[], ApiError>({
    queryKey: institutionKey(institutionId, ...collectionQueryKey(collection, query), 'all'),
    queryFn: ({ signal }) => fetchAllCollectionPages<TRecord>(client, collection, query, signal),
    enabled: institutionId !== null && (options.enabled ?? true),
  })
}

/** Tek kayıt (detay paneli); `id` boşken istek atılmaz. */
export function useCollectionItem<TRecord>(
  collection: string,
  id: string | null | undefined,
): UseQueryResult<CollectionRow<TRecord>, ApiError> {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery<CollectionRow<TRecord>, ApiError>({
    queryKey: institutionKey(institutionId, ...collectionItemKey(collection, id ?? '')),
    queryFn: ({ signal }) => fetchCollectionItem<TRecord>(client, collection, id ?? '', signal),
    enabled: institutionId !== null && Boolean(id),
  })
}

/**
 * Listenin filtrelenmiş ve sıralanmış bütün sonucunu çeken işlev (CSV). Önbelleğe yazmaz;
 * her çağrı güncel veriyi okur.
 */
export function useCollectionFetchAll<TRecord>(collection: string) {
  const client = useKampusClient()
  return useCallback(
    (query: Omit<CollectionQuery, 'page' | 'pageSize'>) =>
      fetchAllCollectionPages<TRecord>(client, collection, query),
    [client, collection],
  )
}
