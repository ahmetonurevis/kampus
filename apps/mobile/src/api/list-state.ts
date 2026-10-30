// Sunucu sayfalı listelerin saf durum yardımcıları (arama + sayfa). Sayfa 0 tabanlıdır;
// API'ye `index + 1` gider.

export const API_PAGE_SIZE = 10

export type ListState = { search: string; index: number }
export const EMPTY_LIST_STATE: ListState = { search: '', index: 0 }

/** Arama değişince sayfa başa döner; aynı aramada sayfa korunur. */
export function withSearch(state: ListState, search: string): ListState {
  return state.search === search ? state : { search, index: 0 }
}

/**
 * Veri azalınca geçersiz sayfada kalınmaz: toplam bilinmiyorsa (yükleniyor) sayfa korunur,
 * biliniyorsa son sayfaya çekilir.
 */
export function clampPageIndex(
  index: number,
  total: number | undefined,
  pageSize = API_PAGE_SIZE,
): number {
  if (total === undefined) return Math.max(0, index)
  const last = Math.max(0, Math.ceil(total / pageSize) - 1)
  return Math.min(Math.max(0, index), last)
}
