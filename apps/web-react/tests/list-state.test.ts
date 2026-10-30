import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  initialListState,
  listReducer,
  MAX_PAGE_SIZE,
  restoreListState,
  type ListState,
} from '../src/lib/list-state.ts'

const scrolled = (state: ListState): ListState => ({
  ...state,
  page: 3,
  scroll: { top: 420, left: 60 },
})

test('arama, filtre ve sayfa boyutu sayfayı 1e, dikey kaydırmayı başa çeker', () => {
  const start = scrolled(initialListState())
  for (const action of [
    { type: 'query', query: 'deniz' },
    { type: 'filter', key: 'status', value: 'Ödendi' },
    { type: 'filters', filters: { status: 'Gecikmiş' } },
    { type: 'pageSize', pageSize: 20 },
    { type: 'external' },
    { type: 'clear' },
  ] as const) {
    const next = listReducer(start, action)
    assert.equal(next.page, 1, action.type)
    assert.deepEqual(next.scroll, { top: 0, left: 60 }, action.type)
  }
})

test('aynı arama metni durumu değiştirmez', () => {
  const state = listReducer(initialListState(), { type: 'query', query: 'ece' })
  assert.equal(listReducer(state, { type: 'query', query: 'ece' }), state)
})

test('sıralama artan, azalan ve kapalı arasında döner', () => {
  let state = listReducer(initialListState(), { type: 'sort', key: 'name' })
  assert.deepEqual([state.sortKey, state.sortDirection], ['name', 1])
  state = listReducer(state, { type: 'sort', key: 'name' })
  assert.deepEqual([state.sortKey, state.sortDirection], ['name', -1])
  state = listReducer(state, { type: 'sort', key: 'name' })
  assert.deepEqual([state.sortKey, state.sortDirection], ['', 1])
  state = listReducer(state, { type: 'sort', key: 'amount' })
  assert.deepEqual([state.sortKey, state.sortDirection], ['amount', 1])
})

test('veri azalınca geçersiz sayfada kalınmaz', () => {
  const state = { ...initialListState(), page: 5 }
  assert.equal(listReducer(state, { type: 'clamp', pageCount: 2 }).page, 2)
  assert.equal(listReducer(state, { type: 'clamp', pageCount: 0 }).page, 1)
  assert.equal(listReducer(state, { type: 'clamp', pageCount: 9 }), state)
})

test('geçersiz sayfa ve sayfa boyutu yok sayılır', () => {
  const state = initialListState()
  assert.equal(listReducer(state, { type: 'page', page: 0 }), state)
  assert.equal(listReducer(state, { type: 'page', page: 1.5 }), state)
  assert.equal(listReducer(state, { type: 'pageSize', pageSize: MAX_PAGE_SIZE + 1 }), state)
  assert.equal(listReducer(state, { type: 'page', page: 2 }).page, 2)
})

test('kaydırma konumu negatif veya sayı olmayan değerde sıfırlanır', () => {
  const state = listReducer(initialListState(), {
    type: 'scroll',
    scroll: { top: -10, left: Number.NaN },
  })
  assert.deepEqual(state.scroll, { top: 0, left: 0 })
})

test('saklanmış durum doğrulanır, bozuk alanlar varsayılana döner', () => {
  assert.deepEqual(restoreListState(null, 10), initialListState(10))
  assert.deepEqual(restoreListState([1, 2], 10), initialListState(10))
  const restored = restoreListState(
    { query: 'ali', page: -2, pageSize: 500, sortKey: 7, sortDirection: -1, filters: [] },
    10,
  )
  assert.equal(restored.query, 'ali')
  assert.equal(restored.page, 1)
  assert.equal(restored.pageSize, 10)
  assert.equal(restored.sortKey, '')
  assert.equal(restored.sortDirection, -1)
  assert.deepEqual(restored.filters, {})
})
