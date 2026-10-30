// school-core koleksiyonlarının tipli okuma kancaları: koleksiyon adı State anahtarıdır, kayıt
// tipi core örnek veri üreticisinden türetilen State'ten gelir (elle ikinci tip yazılmaz).
import type { State } from '@kampus/school-core/data/seed.ts'
import type { CollectionQuery, CollectionRow } from '@kampus/react-shared/collections.ts'
import {
  useCollectionAll,
  useCollectionFetchAll,
  useCollectionItem,
  useCollectionList,
} from '@kampus/react-shared/use-collection.ts'

/** Kimlikli kayıt dizisi olan State anahtarları (API koleksiyon adları). */
export type CoreCollection = {
  [K in keyof State]: State[K] extends readonly { id: string }[] ? K : never
}[keyof State]
export type CoreRecord<K extends CoreCollection> = State[K] extends readonly (infer T)[] ? T : never
export type CoreRow<K extends CoreCollection> = CollectionRow<CoreRecord<K>>

type AllQuery = Omit<CollectionQuery, 'page' | 'pageSize'>

/** Sunucu sayfalı liste (tablo sayfası); `enabled: false` iken istek atılmaz. */
export function useCoreList<K extends CoreCollection>(
  collection: K,
  query: CollectionQuery,
  options: { enabled?: boolean } = {},
) {
  return useCollectionList<CoreRecord<K>>(collection, query, options)
}

/** Küçük başvuru koleksiyonunun bütün kayıtları (ad eşlemeleri, sayımlar). */
export function useCoreAll<K extends CoreCollection>(
  collection: K,
  query: AllQuery = {},
  options: { enabled?: boolean } = {},
) {
  return useCollectionAll<CoreRecord<K>>(collection, query, options)
}

/** Tek kayıt (detay paneli). */
export function useCoreItem<K extends CoreCollection>(collection: K, id: string | null) {
  return useCollectionItem<CoreRecord<K>>(collection, id)
}

/** CSV için filtrelenmiş/sıralanmış bütün sonucu çeken işlev. */
export function useCoreFetchAll<K extends CoreCollection>(collection: K) {
  return useCollectionFetchAll<CoreRecord<K>>(collection)
}
