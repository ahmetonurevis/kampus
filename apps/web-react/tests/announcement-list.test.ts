import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ANNOUNCEMENT_STATUSES } from '@kampus/school-core/lib/communication.ts'
import {
  ANNOUNCEMENT_FILTERS,
  ANNOUNCEMENT_LIST,
  ANNOUNCEMENT_SORTABLE,
  ANNOUNCEMENT_UNREAD_QUERY,
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
