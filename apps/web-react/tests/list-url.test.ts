import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initialListState } from '../src/lib/list-state.ts'
import {
  applyListParams,
  listStateFromParams,
  listStateToParams,
  listSync,
  shouldReadParams,
  urlBelongsToScope,
} from '../src/lib/list-url.ts'

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

test('geri/ileri ile gelen URL durumu yeniden kurar; eksik parametre varsayılana döner', () => {
  const state = {
    ...initialListState(),
    query: 'deniz',
    page: 3,
    sortKey: 'amount',
    sortDirection: -1 as const,
    filters: { status: 'Ödendi' },
    scroll: { top: 300, left: 40 },
  }
  const back = applyListParams(state, new URLSearchParams('sayfa=2'), '')
  assert.deepEqual([back.query, back.page, back.sortKey, back.sortDirection], ['', 2, '', 1])
  assert.deepEqual(back.filters, { status: 'Ödendi' }, 'filtreler URL dışında korunur')
  assert.deepEqual(back.scroll, { top: 0, left: 40 })
})

test('URL durumla aynıysa aynı nesne döner (gereksiz çizim yok)', () => {
  const state = { ...initialListState(), query: 'ece', page: 2 }
  const params = listStateToParams(state, 'odeme-', new URLSearchParams('q=baska'))
  assert.equal(applyListParams(state, params, 'odeme-'), state)
  assert.notEqual(applyListParams(state, new URLSearchParams('odeme-q=ec'), 'odeme-'), state)
})

test('yalnız kendi replace yazımlarımız dışındaki gezinmeler URL’den okunur', () => {
  assert.equal(shouldReadParams('POP'), true)
  assert.equal(shouldReadParams('PUSH'), true)
  assert.equal(shouldReadParams('REPLACE'), false)
})

test('liste anahtarı (ör. çocuk) değişince o anahtarın durumu kurulur, URL’ye bakılmaz', () => {
  const seen = { memoryKey: 'list:/veli/finans:s1:odemeler', locationKey: 'a' }
  const child = { memoryKey: 'list:/veli/finans:s2:odemeler', locationKey: 'b' }
  assert.equal(listSync(seen, child, 'REPLACE'), 'restore')
  assert.equal(listSync(seen, child, 'POP'), 'restore')
  assert.equal(listSync(seen, seen, 'POP'), 'none')
  const moved = { ...seen, locationKey: 'c' }
  assert.equal(listSync(seen, moved, 'POP'), 'read-url')
  assert.equal(listSync(seen, moved, 'PUSH'), 'read-url')
  assert.equal(listSync(seen, moved, 'REPLACE'), 'track')
})

test('URL yalnız onu yazan kapsamda (çocukta) okunur; kayıt yoksa okunur', () => {
  assert.equal(urlBelongsToScope(undefined, 's2'), true)
  assert.equal(urlBelongsToScope('s1', 's1'), true)
  assert.equal(urlBelongsToScope('s1', 's2'), false)
  assert.equal(urlBelongsToScope('', ''), true)
})
