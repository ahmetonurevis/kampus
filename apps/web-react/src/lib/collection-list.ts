// Sunucu sayfalı liste: tablo görünüm durumu (`ListState`) → koleksiyon ucu sorgusu. Arama,
// filtre, sıralama ve sayfa sunucuda uygulanır; tablo yalnız gelen sayfayı çizer.
import type {
  CollectionFilterField,
  CollectionFilters,
  CollectionQuery,
  CollectionSort,
  CollectionSortField,
} from '@kampus/react-shared/collections.ts'
import { MIN_SEARCH_LENGTH } from '@kampus/react-shared/collections.ts'
import type { ListState } from './list-state.ts'

export type CollectionListConfig = {
  /** Tablo sütun anahtarı → sunucu sıralama alanı. Burada olmayan sütun sıralanamaz. */
  sortFields?: Readonly<Record<string, CollectionSortField>>
  /** Liste filtre anahtarı → sunucu eşitlik filtresi. Burada olmayan filtre gönderilmez. */
  filterFields?: Readonly<Record<string, CollectionFilterField>>
  /** Kullanıcı sıralama seçmemişse (ve eşitlikte) uygulanan sıra; sayfalar arasında kararlılık. */
  defaultSort?: readonly CollectionSort[]
  archived?: CollectionQuery['archived']
}

/** Sıralanabilir sütun anahtarları (başlık düğmesi ve dar ekran sıralama seçenekleri). */
export function sortableColumns(config: CollectionListConfig): string[] {
  return Object.keys(config.sortFields ?? {})
}

/** Arama sunucuya gidecek kadar uzun mu (kısa aramada liste süzülmez). */
export function isSearchActive(query: string): boolean {
  return query.trim().length >= MIN_SEARCH_LENGTH
}

/**
 * Sayfa dahil sorgu. `query` verilirse durumdaki arama yerine kullanılır (gecikmeli arama).
 * Varsayılan sıra kullanıcı sıralamasından sonra eşitlik bozucu olarak eklenir; aynı alan iki
 * kez gönderilmez.
 */
export function collectionQueryFromList(
  state: ListState,
  config: CollectionListConfig,
  query: string = state.query,
): CollectionQuery {
  return {
    ...exportQueryFromList(state, config, query),
    page: state.page,
    pageSize: state.pageSize,
  }
}

/** Sayfasız sorgu: CSV bütün filtrelenmiş/sıralanmış sonucu bununla çeker. */
export function exportQueryFromList(
  state: ListState,
  config: CollectionListConfig,
  query: string = state.query,
): Omit<CollectionQuery, 'page' | 'pageSize'> {
  const filters: CollectionFilters = {}
  for (const [key, field] of Object.entries(config.filterFields ?? {})) {
    const value = state.filters[key]
    if (typeof value === 'string' && value !== '') filters[field] = value
    else if (typeof value === 'number') filters[field] = String(value)
  }
  const sort: CollectionSort[] = []
  const field = config.sortFields?.[state.sortKey]
  if (field) sort.push(state.sortDirection === -1 ? `-${field}` : field)
  for (const fallback of config.defaultSort ?? []) {
    const name = fallback.replace(/^-/, '')
    if (!sort.some((item) => item.replace(/^-/, '') === name)) sort.push(fallback)
  }
  const trimmed = query.trim()
  return {
    ...(isSearchActive(trimmed) ? { q: trimmed } : {}),
    ...(sort.length ? { sort: sort.slice(0, 3) } : {}),
    ...(Object.keys(filters).length ? { filters } : {}),
    ...(config.archived ? { archived: config.archived } : {}),
  }
}
