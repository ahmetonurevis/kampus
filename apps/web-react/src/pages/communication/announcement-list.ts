// Duyuru listesinin sunucu sorgusu yapılandırması (OG-218): durum süzgeci okuyucuya göre
// türetilir (core `announcementStatusOf`, DOM-ILT-003/-004) ve sunucuda uygulanır; sütun
// sıralaması ve süzgeç adları burada tanımlıdır.
import {
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENT_STATUS,
} from '@kampus/school-core/lib/communication.ts'
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
