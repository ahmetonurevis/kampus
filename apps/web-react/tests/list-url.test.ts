import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initialListState } from '../src/lib/list-state.ts'
import { listStateFromParams, listStateToParams } from '../src/lib/list-url.ts'

test('liste durumu URL parametresine yazılır ve geri okunur', () => {
  const state = {
    ...initialListState(),
    query: 'deniz',
    page: 3,
    sortKey: 'amount',
    sortDirection: -1 as const,
  }
  const params = listStateToParams(state, '', new URLSearchParams('cocuk=ece'))
  assert.equal(params.toString(), 'cocuk=ece&q=deniz&sayfa=3&sirala=amount&yon=azalan')
  const restored = listStateFromParams(params, '', initialListState())
  assert.deepEqual(
    [restored.query, restored.page, restored.sortKey, restored.sortDirection],
    ['deniz', 3, 'amount', -1],
  )
})

test('varsayılan değerler URL’den silinir ve önek listeleri ayırır', () => {
  const params = listStateToParams(
    initialListState(),
    'odeme-',
    new URLSearchParams('odeme-q=eski&odeme-sayfa=2&q=diger'),
  )
  assert.equal(params.toString(), 'q=diger')
})

test('bozuk sayfa değeri ilk sayfaya döner', () => {
  const base = { ...initialListState(), page: 4 }
  assert.equal(listStateFromParams(new URLSearchParams('sayfa=-1'), '', base).page, 1)
  assert.equal(listStateFromParams(new URLSearchParams('sayfa=abc'), '', base).page, 1)
  assert.equal(listStateFromParams(new URLSearchParams(''), '', base).page, 4)
})
