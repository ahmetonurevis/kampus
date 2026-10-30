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
