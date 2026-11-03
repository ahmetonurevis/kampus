// Liste durumunun paylaşılabilir kısmı (sayfa, sıralama) URL arama parametresinde tutulur; böylece
// yenileme ve geri/ileri durumu korur. Filtre değerleri ve kaydırma varsayılan olarak yalnız
// bellektedir; liste `urlFilters` verirse o tekli filtreler de URL'ye yazılır. Serbest arama metni
// hiçbir listede URL'ye yazılmaz (ADR 0009, IST-028): ad, telefon gibi kişisel veri tarayıcı
// geçmişine, paylaşılan bağlantıya ve erişim loguna girmesin. Eski bağlantıdaki `q` bir kez okunur;
// sonraki adres yazımı onu siler.
import type { FilterValues } from './list-query.ts'
import type { ListState } from './list-state.ts'

/** Filtre anahtarı → URL parametre adı (ör. `{ branchId: 'kampus' }`); önek ayrıca eklenir. */
export type UrlFilters = Readonly<Record<string, string>>
const NO_URL_FILTERS: UrlFilters = {}

const keys = (prefix: string) => ({
  query: `${prefix}q`,
  page: `${prefix}sayfa`,
  sort: `${prefix}sirala`,
  direction: `${prefix}yon`,
})

/** Adreste eski bağlantıdan kalan arama parametresi var mı (varsa bir sonraki yazım siler). */
export function hasLegacySearch(params: URLSearchParams, prefix: string): boolean {
  return params.has(keys(prefix).query)
}

/**
 * URL'deki değerler varsa temel duruma uygular; bozuk değerler yok sayılır. Arama metni URL'de
 * tutulmaz; yalnız eski bağlantıdan gelen `q` okunur, yoksa bellekteki (temel) arama kalır.
 */
export function listStateFromParams(
  params: URLSearchParams,
  prefix: string,
  base: ListState,
  urlFilters: UrlFilters = NO_URL_FILTERS,
): ListState {
  const key = keys(prefix)
  const query = params.get(key.query)
  const page = Number(params.get(key.page))
  const sort = params.get(key.sort)
  return {
    ...base,
    filters: filtersFromParams(params, prefix, base.filters, urlFilters),
    query: query ?? base.query,
    page: Number.isInteger(page) && page >= 1 ? page : params.has(key.page) ? 1 : base.page,
    sortKey: sort ?? base.sortKey,
    sortDirection: sort ? (params.get(key.direction) === 'azalan' ? -1 : 1) : base.sortDirection,
  }
}

/**
 * Mevcut parametreleri koruyarak liste durumunu yazar; varsayılan değerler URL'den silinir. Arama
 * metni hiç yazılmaz ve eski bağlantıdan kalan `q` silinir (ADR 0009).
 */
export function listStateToParams(
  state: ListState,
  prefix: string,
  current: URLSearchParams,
  urlFilters: UrlFilters = NO_URL_FILTERS,
): URLSearchParams {
  const key = keys(prefix)
  const next = new URLSearchParams(current)
  const set = (name: string, value: string | null) =>
    value === null ? next.delete(name) : next.set(name, value)
  next.delete(key.query)
  set(key.page, state.page > 1 ? String(state.page) : null)
  set(key.sort, state.sortKey || null)
  set(key.direction, state.sortKey && state.sortDirection === -1 ? 'azalan' : null)
  for (const [filter, name] of Object.entries(urlFilters))
    set(`${prefix}${name}`, scalarFilter(state.filters[filter]))
  return next
}

/** Yalnız tekli (metin/sayı) filtre URL'ye yazılır; aralık değerleri bellekte kalır. */
function scalarFilter(value: unknown): string | null {
  if (typeof value === 'number') return String(value)
  return typeof value === 'string' && value !== '' ? value : null
}

/** URL'deki filtre parametreleri bellekteki değerin üzerine yazılır; olmayan anahtar korunur. */
function filtersFromParams(
  params: URLSearchParams,
  prefix: string,
  base: FilterValues,
  urlFilters: UrlFilters,
): FilterValues {
  let next = base
  for (const [filter, name] of Object.entries(urlFilters)) {
    const value = params.get(`${prefix}${name}`)
    if (value !== null && value !== '' && next[filter] !== value)
      next = { ...next, [filter]: value }
  }
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

const sameUrlState = (left: ListState, right: ListState, urlFilters: UrlFilters) =>
  left.query === right.query &&
  left.page === right.page &&
  left.sortKey === right.sortKey &&
  (left.sortKey === '' || left.sortDirection === right.sortDirection) &&
  Object.keys(urlFilters).every(
    (filter) => scalarFilter(left.filters[filter]) === scalarFilter(right.filters[filter]),
  )

/**
 * Geri/ileri veya bağlantıyla gelen URL'yi duruma uygular. URL'de olmayan sayfa, sıralama ve URL
 * filtresi varsayılandır (ilk yüklemedeki bellek yedeği burada kullanılmaz). Arama URL'de
 * tutulmadığı için bellekteki değer kalır; yalnız eski bağlantıdaki `q` onu değiştirir. Değişiklik
 * yoksa aynı nesne döner; varsa dikey kaydırma başa alınır. URL'de tutulmayan filtreler korunur;
 * `urlFilters` anahtarları URL'de yoksa kaldırılır.
 */
export function applyListParams(
  state: ListState,
  params: URLSearchParams,
  prefix: string,
  urlFilters: UrlFilters = NO_URL_FILTERS,
): ListState {
  const filters = { ...state.filters }
  for (const filter of Object.keys(urlFilters)) delete filters[filter]
  const next = listStateFromParams(
    params,
    prefix,
    {
      ...state,
      filters,
      page: 1,
      sortKey: '',
      sortDirection: 1,
    },
    urlFilters,
  )
  if (sameUrlState(state, next, urlFilters)) return state
  return { ...next, scroll: { top: 0, left: state.scroll.left } }
}

/**
 * URL'deki liste parametreleri hangi kapsamın (veli için çocuk) yazdığını bilir. Kapsam değişip
 * sayfa yeniden kurulunca URL önceki çocuğa aittir ve okunmaz; kayıt yoksa (yenileme,
 * paylaşılan bağlantı) URL okunur.
 */
export function urlBelongsToScope(writer: unknown, scope: string): boolean {
  return typeof writer !== 'string' || writer === scope
}
