// Duyuru listesinin sunucu sorgusu yapılandırması (OG-218): durum süzgeci okuyucuya göre
// türetilir (core `announcementStatusOf`, DOM-ILT-003/-004) ve sunucuda uygulanır; sütun
// sıralaması ve süzgeç adları burada tanımlıdır.
import {
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENT_STATUS,
} from '@kampus/school-core/lib/communication.ts'
import { isApiError } from '@kampus/api-client/errors.ts'
import type { CollectionListConfig } from '@/lib/collection-list.ts'

export const ANNOUNCEMENT_LIST = {
  sortFields: { title: 'title', date: 'date' },
  filterFields: { status: 'status' },
  defaultSort: ['-date'],
} satisfies CollectionListConfig

export const ANNOUNCEMENT_SORTABLE = Object.keys(ANNOUNCEMENT_LIST.sortFields)

/** Durum süzgeci adreste `durum` olarak tutulur. */
export const ANNOUNCEMENT_URL_FILTERS = { status: 'durum' }

export const ANNOUNCEMENT_FILTERS = [
  {
    key: 'status',
    label: 'Durum',
    options: ANNOUNCEMENT_STATUSES.map((value) => ({ value, label: value })),
  },
]

/** Okunmamış sayısı: aynı süzgeç, tek durum (başlıktaki özet). */
export const ANNOUNCEMENT_UNREAD_QUERY = {
  groupBy: 'category',
  filters: { status: ANNOUNCEMENT_STATUS.unread },
} as const

/**
 * Liste başlığındaki özet. `total` süzülmüş sayıdır, okunmamış sayısı ise süzgeçsizdir; ikisi
 * aynı cümlede olunca tutarsız görünür. Bu yüzden süzgeç ya da arama varken yalnız sonuç sayısı,
 * yokken duyuru sayısı ve okunmamış sayısı yazılır.
 */
export function announcementSummary({
  total,
  unread,
  filtered,
}: {
  total: number
  unread: number
  filtered: boolean
}): string {
  if (filtered) return `${total} sonuç`
  return `${total} duyuru${unread > 0 ? ` · ${unread} okunmamış` : ''}`
}

export type DetailPanelState = 'row' | 'loading' | 'notFound' | 'error'

/**
 * Ayrıntı panelinin durumu: satır (listeden gelen başlangıç verisi dahil) varsa gösterilir;
 * 404 "bulunamadı veya yetkiniz yok"tur; ağ ve sunucu hatası yetki hatası gibi söylenmez.
 */
export function detailPanelState({
  hasRow,
  error,
  pending,
}: {
  hasRow: boolean
  error: unknown
  pending: boolean
}): DetailPanelState {
  if (hasRow) return 'row'
  if (error) return isApiError(error) && error.status === 404 ? 'notFound' : 'error'
  return pending ? 'loading' : 'notFound'
}
