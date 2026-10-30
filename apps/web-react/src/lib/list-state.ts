// Liste görünüm durumu: arama, filtre, sıralama, sayfa ve kaydırma konumu liste bazında korunur.
// Vue `use-list.js` + DataTable davranışı: filtre/arama/sayfa boyutu/sıralama değişince sayfa 1'e
// ve kaydırma başa döner; veri azalınca geçersiz sayfada kalınmaz.
import type { FilterValue, FilterValues, SortDirection } from './list-query.ts'

export type ScrollPosition = { top: number; left: number }
export type ListState = {
  query: string
  filters: FilterValues
  page: number
  pageSize: number
  sortKey: string
  sortDirection: SortDirection
  /** Kart listelerinde hazır sıralama seçeneği (CollectionList). */
  ordering: string
  /** Filtre paneli açık mı. */
  expanded: boolean
  scroll: ScrollPosition
}

export type ListAction =
  | { type: 'query'; query: string }
  | { type: 'filter'; key: string; value: FilterValue }
  | { type: 'filters'; filters: FilterValues }
  | { type: 'page'; page: number }
  | { type: 'pageSize'; pageSize: number }
  | { type: 'sort'; key: string }
  | { type: 'setSort'; key: string; direction: SortDirection }
  | { type: 'clearSort' }
  | { type: 'ordering'; ordering: string }
  | { type: 'expanded'; expanded: boolean }
  | { type: 'scroll'; scroll: ScrollPosition }
  | { type: 'clear' }
  /** Dış filtre (ör. sekme veya çocuk seçimi) değişti. */
  | { type: 'external' }
  /** Veri değişti; sayfa geçerli aralığa çekilir. */
  | { type: 'clamp'; pageCount: number }

export const MAX_PAGE_SIZE = 100
const TOP: ScrollPosition = { top: 0, left: 0 }

export function initialListState(pageSize = 8): ListState {
  return {
    query: '',
    filters: {},
    page: 1,
    pageSize,
    sortKey: '',
    sortDirection: 1,
    ordering: '',
    expanded: false,
    scroll: TOP,
  }
}

const validPageSize = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_PAGE_SIZE
const validPage = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 1
const finite = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0

/** Saklanmış (güvenilmeyen) durumu doğrular; bozuk alanlar varsayılana döner. */
export function restoreListState(stored: unknown, pageSize = 8): ListState {
  const base = initialListState(pageSize)
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return base
  const value = stored as Partial<Record<keyof ListState, unknown>>
  const scroll =
    value.scroll && typeof value.scroll === 'object'
      ? (value.scroll as Partial<ScrollPosition>)
      : undefined
  return {
    query: typeof value.query === 'string' ? value.query : base.query,
    filters:
      value.filters && typeof value.filters === 'object' && !Array.isArray(value.filters)
        ? (value.filters as FilterValues)
        : base.filters,
    page: validPage(value.page) ? value.page : base.page,
    pageSize: validPageSize(value.pageSize) ? value.pageSize : base.pageSize,
    sortKey: typeof value.sortKey === 'string' ? value.sortKey : base.sortKey,
    sortDirection: value.sortDirection === -1 ? -1 : 1,
    ordering: typeof value.ordering === 'string' ? value.ordering : base.ordering,
    expanded: value.expanded === true,
    scroll: { top: finite(scroll?.top), left: finite(scroll?.left) },
  }
}

// Sorgu değiştiğinde ilk sayfaya ve başa dönülür; yatay konum korunur.
const reset = (state: ListState, patch: Partial<ListState>): ListState => ({
  ...state,
  ...patch,
  page: 1,
  scroll: { top: 0, left: state.scroll.left },
})

export function listReducer(state: ListState, action: ListAction): ListState {
  switch (action.type) {
    case 'query':
      return action.query === state.query ? state : reset(state, { query: action.query })
    case 'filter':
      return reset(state, { filters: { ...state.filters, [action.key]: action.value } })
    case 'filters':
      return reset(state, { filters: { ...action.filters } })
    case 'page': {
      if (!validPage(action.page) || action.page === state.page) return state
      return { ...state, page: action.page, scroll: { top: 0, left: state.scroll.left } }
    }
    case 'pageSize':
      return validPageSize(action.pageSize) ? reset(state, { pageSize: action.pageSize }) : state
    case 'sort': {
      // Artan → azalan → sıralamasız döngüsü.
      if (state.sortKey === action.key && state.sortDirection === -1)
        return reset(state, { sortKey: '', sortDirection: 1 })
      if (state.sortKey === action.key) return reset(state, { sortDirection: -1 })
      return reset(state, { sortKey: action.key, sortDirection: 1 })
    }
    case 'setSort':
      return reset(state, { sortKey: action.key, sortDirection: action.direction })
    case 'clearSort':
      return reset(state, { sortKey: '', sortDirection: 1 })
    case 'ordering':
      return reset(state, { ordering: action.ordering })
    case 'expanded':
      return action.expanded === state.expanded ? state : { ...state, expanded: action.expanded }
    case 'scroll':
      return {
        ...state,
        scroll: { top: finite(action.scroll.top), left: finite(action.scroll.left) },
      }
    case 'clear':
      return reset(state, { query: '', filters: {} })
    case 'external':
      return reset(state, {})
    case 'clamp': {
      const page = Math.min(state.page, Math.max(1, action.pageCount))
      return page === state.page ? state : { ...state, page }
    }
  }
}
