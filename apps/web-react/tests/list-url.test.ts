import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initialListState } from '../src/lib/list-state.ts'
import {
  applyListParams,
  hasLegacySearch,
  keepsSearchInUrl,
  listStateFromParams,
  listStateToParams,
  listSync,
  shouldReadParams,
  urlBelongsToScope,
} from '../src/lib/list-url.ts'

test('IST-028: sayfa ve sıralama URL’ye yazılıp geri okunur; arama metni URL’ye yazılmaz', () => {
  const state = {
    ...initialListState(),
    page: 3,
    sortKey: 'amount',
    sortDirection: -1 as const,
  }
  const params = listStateToParams(
    { ...state, query: 'Deniz Yılmaz' },
    '',
    new URLSearchParams('cocuk=ece&sayfa=3'),
  )
  assert.equal(params.toString(), 'cocuk=ece&sirala=amount&yon=azalan', 'arama varken sayfa da yok')
  assert.equal(hasLegacySearch(params, ''), false)
  const plain = listStateToParams(state, '', new URLSearchParams('cocuk=ece'))
  assert.equal(plain.toString(), 'cocuk=ece&sayfa=3&sirala=amount&yon=azalan')
  const restored = listStateFromParams(plain, '', { ...initialListState(), query: 'bellek' })
  assert.deepEqual(
    [restored.query, restored.page, restored.sortKey, restored.sortDirection],
    ['bellek', 3, 'amount', -1],
    'URL’de arama yoksa bellekteki arama kalır',
  )
})

test('IST-028: eski bağlantıdaki q bir kez okunur, ilk yazım onu adresten siler', () => {
  const legacy = new URLSearchParams('q=0532+111+22+33&sayfa=2&cocuk=ece')
  assert.equal(hasLegacySearch(legacy, ''), true)
  const read = listStateFromParams(legacy, '', initialListState())
  assert.equal(read.query, '0532 111 22 33', 'eski bağlantının araması kutuya gelir')
  assert.equal(read.page, 2)
  const written = listStateToParams(read, '', legacy)
  assert.equal(
    written.toString(),
    'cocuk=ece',
    'arama ve arama içi sayfa silinir, diğer parametreler kalır',
  )
  assert.equal(hasLegacySearch(written, ''), false)
  const prefixed = new URLSearchParams('odeme-q=Ay%C5%9Fe&q=diger')
  assert.equal(hasLegacySearch(prefixed, 'odeme-'), true)
  assert.equal(
    listStateToParams(initialListState(), 'odeme-', prefixed).toString(),
    'q=diger',
    'her liste yalnız kendi önekli aramasını siler',
  )
})

test('IST-028: filtre değişince eski q yine yazılmaz; URL filtresi adreste kalır', () => {
  const urlFilters = { branchId: 'kampus' }
  const state = { ...initialListState(), query: 'Ece', filters: { branchId: 'b2' } }
  const params = listStateToParams(state, '', new URLSearchParams('q=Ece'), urlFilters)
  assert.equal(params.toString(), 'kampus=b2')
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

test('IST-028: geri/ileri URL’yi yeniden kurar; eksik parametre varsayılana döner, arama bellekten kalır', () => {
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
  assert.deepEqual([back.query, back.page, back.sortKey, back.sortDirection], ['deniz', 2, '', 1])
  assert.deepEqual(back.filters, { status: 'Ödendi' }, 'filtreler URL dışında korunur')
  assert.deepEqual(back.scroll, { top: 0, left: 40 })
})

test('URL durumla aynıysa aynı nesne döner (gereksiz çizim yok)', () => {
  const state = { ...initialListState(), query: 'ece', page: 2 }
  const params = listStateToParams(state, 'odeme-', new URLSearchParams('q=baska'))
  assert.equal(applyListParams(state, params, 'odeme-'), state)
  const legacy = applyListParams(state, new URLSearchParams('odeme-q=ec&odeme-sayfa=2'), 'odeme-')
  assert.notEqual(legacy, state, 'eski bağlantıdaki arama bellektekinin yerine geçer')
  assert.equal(legacy.query, 'ec')
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

test('IST-028: kişisel veri içeren arama hiçbir listede URL’ye yazılmaz; geri/ileri aramayı silmez', () => {
  const state = {
    ...initialListState(),
    query: '0532 111 22 33',
    page: 2,
    sortKey: 'name',
  }
  const params = listStateToParams(state, '', new URLSearchParams('q=eski'), {})
  assert.equal(params.has('q'), false, 'eski bağlantıdaki arama da temizlenir')
  assert.equal(params.toString(), 'sirala=name')
  const back = applyListParams(state, new URLSearchParams('sirala=name'), '', {})
  assert.equal(back, state, 'URL’de q ve sayfa olmaması yazılan aramayı ve sayfasını silmez')
  const earlier = applyListParams(state, new URLSearchParams(''), '', {})
  assert.equal(earlier.query, '0532 111 22 33', 'önceki girdiye dönüşte arama bellekten gelir')
  assert.equal(earlier.page, 2, 'arama içi sayfa da bellekten gelir')
  assert.equal(earlier.sortKey, '')
})

test('IST-028: arama varken sayfa adrese yazılmaz; yenilemede aramasız listenin N. sayfasına düşülmez', () => {
  const searching = { ...initialListState(), query: 'Ece', page: 3 }
  const params = listStateToParams(
    searching,
    'odeme-',
    new URLSearchParams('odeme-sayfa=3&sayfa=4'),
  )
  assert.equal(params.toString(), 'sayfa=4', 'yalnız kendi önekli sayfası silinir')
  const reloaded = listStateFromParams(params, 'odeme-', initialListState())
  assert.deepEqual([reloaded.query, reloaded.page], ['', 1])
  const cleared = listStateToParams({ ...searching, query: '' }, 'odeme-', params)
  assert.equal(cleared.toString(), 'sayfa=4&odeme-sayfa=3', 'arama silinince sayfa yeniden yazılır')
})

test('IST-028: geçici finans istisnasında arama URL’ye yazılır ve URL’den kurulur; diğer yollarda yazılmaz', () => {
  assert.equal(keepsSearchInUrl('/yonetici/finans'), true)
  assert.equal(keepsSearchInUrl('/yonetici/finans/'), true)
  for (const path of [
    '/onburo/tahsilat-takip',
    '/veli/finans',
    '/yonetici/subeler',
    '/yonetici/finans-x',
  ])
    assert.equal(keepsSearchInUrl(path), false, path)

  const state = { ...initialListState(), query: 'Deniz Yılmaz', page: 2 }
  const kept = listStateToParams(
    state,
    '',
    new URLSearchParams(),
    {},
    keepsSearchInUrl('/yonetici/finans'),
  )
  assert.equal(kept.toString(), 'q=Deniz+Y%C4%B1lmaz&sayfa=2')
  const other = listStateToParams(
    state,
    '',
    new URLSearchParams(),
    {},
    keepsSearchInUrl('/yonetici/subeler'),
  )
  assert.equal(other.toString(), '', 'istisna dışında arama ve arama içi sayfa yazılmaz')

  assert.equal(applyListParams(state, kept, '', {}, true), state, 'aynı URL aynı nesne')
  const back = applyListParams(state, new URLSearchParams('sayfa=2'), '', {}, true)
  assert.equal(back.query, '', 'istisnada URL’de olmayan arama boştur (eski davranış)')
})
