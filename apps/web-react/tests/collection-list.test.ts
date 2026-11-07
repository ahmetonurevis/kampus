import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  collectionQueryFromList,
  exportQueryFromList,
  isSearchActive,
  sortableColumns,
  type CollectionListConfig,
} from '../src/lib/collection-list.ts'
import { initialListState } from '../src/lib/list-state.ts'

const config = {
  sortFields: { name: 'name', grade: 'grade' },
  filterFields: { branchId: 'branchId', level: 'grade' },
  defaultSort: ['grade', 'name'],
} satisfies CollectionListConfig

test('liste durumu sayfa, arama, filtre ve sıralamayla sunucu sorgusuna çevrilir', () => {
  const state = {
    ...initialListState(16),
    query: ' 7-A ',
    page: 2,
    sortKey: 'name',
    sortDirection: -1 as const,
    filters: { branchId: 'b1', level: 7, occupancy: { min: 10 } },
  }
  assert.deepEqual(collectionQueryFromList(state, config), {
    q: '7-A',
    sort: ['-name', 'grade'],
    filters: { branchId: 'b1', grade: '7' },
    page: 2,
    pageSize: 16,
  })
})

test('sunucunun sıralayamadığı sütun ve tanımsız filtre gönderilmez; kısa arama yok sayılır', () => {
  const state = {
    ...initialListState(),
    query: '7',
    sortKey: 'branch',
    filters: { branchId: '', unknown: 'x' },
  }
  assert.deepEqual(exportQueryFromList(state, config), { sort: ['grade', 'name'] })
  assert.deepEqual(exportQueryFromList(state, {}), {})
  assert.equal(isSearchActive(' 7 '), false)
  assert.equal(isSearchActive('7-'), true)
})

test('gecikmeli arama verilirse durumdaki arama yerine kullanılır; arşiv modu geçer', () => {
  const state = { ...initialListState(), query: 'Selin Ka' }
  assert.deepEqual(exportQueryFromList(state, { archived: 'only' }, 'Selin'), {
    q: 'Selin',
    archived: 'only',
  })
})

test('CSV sorgusu sayfa içermez; sıralanabilir sütunlar yapılandırmadan gelir', () => {
  const query = exportQueryFromList({ ...initialListState(), page: 5 }, config)
  assert.equal('page' in query, false)
  assert.deepEqual(sortableColumns(config), ['name', 'grade'])
  assert.deepEqual(sortableColumns({}), [])
})
