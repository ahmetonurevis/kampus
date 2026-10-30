// Liste durumunun paylaşılabilir kısmı (arama, sayfa, sıralama) URL arama parametresinde tutulur;
// böylece yenileme ve geri/ileri durumu korur. Filtre değerleri ve kaydırma yalnız bellektedir.
import type { ListState } from './list-state.ts'

const keys = (prefix: string) => ({
  query: `${prefix}q`,
  page: `${prefix}sayfa`,
  sort: `${prefix}sirala`,
  direction: `${prefix}yon`,
})

/** URL'deki değerler varsa temel duruma uygular; bozuk değerler yok sayılır. */
export function listStateFromParams(
  params: URLSearchParams,
  prefix: string,
  base: ListState,
): ListState {
  const key = keys(prefix)
  const query = params.get(key.query)
  const page = Number(params.get(key.page))
  const sort = params.get(key.sort)
  return {
    ...base,
    query: query ?? base.query,
    page: Number.isInteger(page) && page >= 1 ? page : params.has(key.page) ? 1 : base.page,
    sortKey: sort ?? base.sortKey,
    sortDirection: sort ? (params.get(key.direction) === 'azalan' ? -1 : 1) : base.sortDirection,
  }
}

/** Mevcut parametreleri koruyarak liste durumunu yazar; varsayılan değerler URL'den silinir. */
export function listStateToParams(
  state: ListState,
  prefix: string,
  current: URLSearchParams,
): URLSearchParams {
  const key = keys(prefix)
  const next = new URLSearchParams(current)
  const set = (name: string, value: string | null) =>
    value === null ? next.delete(name) : next.set(name, value)
  set(key.query, state.query.trim() ? state.query : null)
  set(key.page, state.page > 1 ? String(state.page) : null)
  set(key.sort, state.sortKey || null)
  set(key.direction, state.sortKey && state.sortDirection === -1 ? 'azalan' : null)
  return next
}

export type NavigationKind = 'POP' | 'PUSH' | 'REPLACE'

/** URL'yi kendi yazdığı (`REPLACE`) değişiklikler dışında liste durumu URL'den yeniden okunur. */
export function shouldReadParams(navigationType: NavigationKind): boolean {
  return navigationType !== 'REPLACE'
}

export type ListSyncSeen = { memoryKey: string; locationKey: string }
export type ListSync = 'none' | 'track' | 'restore' | 'read-url'

/**
 * Çizimde ne yapılacağı: liste anahtarı (yol, çocuk, sekme) değiştiyse o anahtarın belleği
 * kurulur (A'nın durumu B'ye taşınmaz); yalnız adres değiştiyse ve gezinme bizim `replace`
 * yazımımız değilse URL okunur; aksi halde yalnız görülen adres güncellenir.
 */
export function listSync(
  seen: ListSyncSeen,
  current: ListSyncSeen,
  navigationType: NavigationKind,
): ListSync {
  if (seen.memoryKey !== current.memoryKey) return 'restore'
  if (seen.locationKey === current.locationKey) return 'none'
  return shouldReadParams(navigationType) ? 'read-url' : 'track'
}

const sameUrlState = (left: ListState, right: ListState) =>
  left.query === right.query &&
  left.page === right.page &&
  left.sortKey === right.sortKey &&
  (left.sortKey === '' || left.sortDirection === right.sortDirection)

/**
 * Geri/ileri veya bağlantıyla gelen URL'yi duruma uygular. URL'de olmayan değer varsayılandır
 * (ilk yüklemedeki bellek yedeği burada kullanılmaz). Değişiklik yoksa aynı nesne döner; varsa
 * dikey kaydırma başa alınır. Filtreler URL'de tutulmadığı için korunur.
 */
export function applyListParams(
  state: ListState,
  params: URLSearchParams,
  prefix: string,
): ListState {
  const next = listStateFromParams(params, prefix, {
    ...state,
    query: '',
    page: 1,
    sortKey: '',
    sortDirection: 1,
  })
  if (sameUrlState(state, next)) return state
  return { ...next, scroll: { top: 0, left: state.scroll.left } }
}
