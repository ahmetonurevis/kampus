import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError } from '@kampus/api-client/errors.ts'
import { ANNOUNCEMENT_STATUSES } from '@kampus/school-core/lib/communication.ts'
import {
  ANNOUNCEMENT_FILTERS,
  ANNOUNCEMENT_LIST,
  ANNOUNCEMENT_SORTABLE,
  ANNOUNCEMENT_UNREAD_QUERY,
  announcementSummary,
  detailPanelState,
} from '../src/pages/communication/announcement-list.ts'
import { collectionQueryFromList } from '../src/lib/collection-list.ts'
import { initialListState } from '../src/lib/list-state.ts'

test('OG-218: durum süzgeci sunucuya gider, sayfa sunucu sayfalamasıdır, sıra yayın tarihi azalan', () => {
  const state = { ...initialListState(10), page: 3, filters: { status: 'Okunmadı' } }
  assert.deepEqual(collectionQueryFromList(state, ANNOUNCEMENT_LIST), {
    sort: ['-date'],
    filters: { status: 'Okunmadı' },
    page: 3,
    pageSize: 10,
  })
})

test('OG-218: boş durum süzgeci gönderilmez; arama en az 2 karakterde; başlık sıralanır', () => {
  const state = {
    ...initialListState(10),
    query: 'gezi',
    sortKey: 'title',
    filters: { status: '' },
  }
  assert.deepEqual(collectionQueryFromList(state, ANNOUNCEMENT_LIST), {
    q: 'gezi',
    sort: ['title', '-date'],
    page: 1,
    pageSize: 10,
  })
  assert.deepEqual(ANNOUNCEMENT_SORTABLE, ['title', 'date'])
})

test('OG-218: süzgeç seçenekleri core durumlarıdır; okunmamış sayısı tek durumla sayılır', () => {
  const [status] = ANNOUNCEMENT_FILTERS
  assert.deepEqual(
    status?.options.map((option) => option.value),
    [...ANNOUNCEMENT_STATUSES],
  )
  assert.deepEqual(ANNOUNCEMENT_UNREAD_QUERY.filters, { status: 'Okunmadı' })
})

test('OG-218: başlık özeti süzgeç ya da aramada yalnız sonuç sayısıdır, yoksa toplam ve okunmamış', () => {
  assert.equal(
    announcementSummary({ total: 12, unread: 3, filtered: false }),
    '12 duyuru · 3 okunmamış',
  )
  assert.equal(announcementSummary({ total: 12, unread: 0, filtered: false }), '12 duyuru')
  // Süzülmüş toplam ile süzgeçsiz okunmamış aynı cümlede yazılmaz.
  assert.equal(announcementSummary({ total: 2, unread: 3, filtered: true }), '2 sonuç')
  assert.equal(announcementSummary({ total: 0, unread: 3, filtered: true }), '0 sonuç')
})

test('OG-218: ayrıntı paneli satırı gösterir; hata yetki hatası gibi söylenmez', () => {
  const failure = (status: number) => new ApiError({ status, code: 'x', message: 'x' })
  // Listeden gelen satır (başlangıç verisi) hata olmadan da varsa gösterilir.
  assert.equal(detailPanelState({ hasRow: true, error: null, pending: true }), 'row')
  assert.equal(detailPanelState({ hasRow: false, error: null, pending: true }), 'loading')
  assert.equal(detailPanelState({ hasRow: false, error: failure(404), pending: false }), 'notFound')
  assert.equal(detailPanelState({ hasRow: false, error: null, pending: false }), 'notFound')
  for (const error of [failure(500), failure(503), failure(0), new TypeError('ağ')])
    assert.equal(detailPanelState({ hasRow: false, error, pending: false }), 'error')
})
