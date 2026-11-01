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

test('urlFilters verilen tekli filtreler URL’ye yazılır ve geri okunur; aralıklar yazılmaz', () => {
  const urlFilters = { branchId: 'kampus', grade: 'duzey', amount: 'tutar' }
  const state = {
    ...initialListState(),
    filters: { branchId: 'b2', grade: 7, amount: { min: 1, max: 5 }, status: 'Ödendi' },
  }
  const params = listStateToParams(state, 'sinif-', new URLSearchParams(), urlFilters)
  assert.equal(params.toString(), 'sinif-kampus=b2&sinif-duzey=7')
  const restored = listStateFromParams(params, 'sinif-', initialListState(), urlFilters)
  assert.deepEqual(restored.filters, { branchId: 'b2', grade: '7' })
  assert.equal(
    listStateToParams(initialListState(), '', params, urlFilters).toString(),
    'sinif-kampus=b2&sinif-duzey=7',
    'başka önekin parametreleri korunur',
  )
})

test('urlFilters geri/ileri ile döner; URL’de olmayan URL filtresi kaldırılır, diğerleri kalır', () => {
  const urlFilters = { branchId: 'kampus' }
  const state = { ...initialListState(), filters: { branchId: 'b2', status: 'Ödendi' }, page: 3 }
  const back = applyListParams(state, new URLSearchParams('kampus=b1'), '', urlFilters)
  assert.deepEqual(back.filters, { branchId: 'b1', status: 'Ödendi' })
  assert.equal(back.page, 1)
  const cleared = applyListParams(state, new URLSearchParams('sayfa=3'), '', urlFilters)
  assert.deepEqual(cleared.filters, { status: 'Ödendi' })
  const same = applyListParams(state, new URLSearchParams('kampus=b2&sayfa=3'), '', urlFilters)
  assert.equal(same, state, 'aynı URL aynı nesneyi döndürür')
})

test('KVKK: searchInUrl=false iken arama metni URL’ye yazılmaz ve URL’den okunmaz; sayfa ve sıralama kalır', () => {
  const state = {
    ...initialListState(),
    query: '0532 111 22 33',
    page: 2,
    sortKey: 'name',
  }
  const params = listStateToParams(state, '', new URLSearchParams('q=eski'), {}, false)
  assert.equal(params.has('q'), false, 'eski bağlantıdaki arama da temizlenir')
  assert.equal(params.toString(), 'sayfa=2&sirala=name')
  const restored = listStateFromParams(
    new URLSearchParams('q=Ay%C5%9Fe&sayfa=2'),
    '',
    { ...initialListState(), query: 'bellek' },
    {},
    false,
  )
  assert.equal(restored.query, 'bellek', 'URL’deki q yok sayılır, bellek korunur')
  assert.equal(restored.page, 2)
  const back = applyListParams(state, new URLSearchParams('sayfa=2&sirala=name'), '', {}, false)
  assert.equal(back, state, 'URL’de q olmaması yazılan aramayı silmez')
})
