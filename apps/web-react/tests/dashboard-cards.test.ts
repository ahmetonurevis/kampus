import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildDashboardCards,
  isCardVisible,
  layoutCards,
  visibleCards,
  type CardView,
  type DashboardCard,
} from '../src/pages/dashboard/dashboard-cards-model.ts'

// Pano kart yuvası (OG-025, IST-116): rol ve kapalı modül süzmesi tek yerde, sıra, yerleşim ve
// Onur bloğundan eklenen kartın görünmesi. Bileşenler çizilmez; sahte kayıt kullanılır.

const NONE = () => null

function card(partial: Partial<DashboardCard> & Pick<DashboardCard, 'id'>): DashboardCard {
  return { roles: ['yonetici'], area: 'main', order: 0, component: NONE, ...partial }
}

const view = (partial: Partial<CardView> = {}): CardView => ({
  role: 'yonetici',
  modules: {},
  data: null,
  ...partial,
})

// Yanıt şekli kart tarafından okunmaz; süzme yalnız `section` seçicisini çağırır.
const response = (sections: Record<string, unknown>) => sections as unknown as CardView['data']

test('IST-116: kart yalnız kayıtlı rollerinde görünür', () => {
  const kayit = card({ id: 'a', roles: ['yonetici', 'onburo'] })
  assert.equal(isCardVisible(kayit, view({ role: 'yonetici' })), true)
  assert.equal(isCardVisible(kayit, view({ role: 'onburo' })), true)
  assert.equal(isCardVisible(kayit, view({ role: 'ogretmen' })), false)
  assert.equal(isCardVisible(kayit, view({ role: 'veli' })), false)
})

test('IST-116: modülü kapalı kart yanıt gelmeden oturum bayrağına göre süzülür', () => {
  const kayit = card({ id: 'a', module: 'finance', section: (data) => (data as never)['finance'] })
  assert.equal(isCardVisible(kayit, view({ modules: { finance: true } })), true)
  assert.equal(isCardVisible(kayit, view({ modules: { finance: false } })), false)
  assert.equal(isCardVisible(kayit, view({ modules: {} })), false)
})

test('IST-116: yanıt geldiyse bölümün sunucudaki durumu bayrağın önündedir', () => {
  const kayit = card({ id: 'a', module: 'finance', section: (data) => (data as never)['finance'] })
  const kapali = view({ modules: { finance: true }, data: response({ finance: null }) })
  const acik = view({ modules: { finance: false }, data: response({ finance: { total: 0 } }) })
  assert.equal(isCardVisible(kayit, kapali), false)
  assert.equal(isCardVisible(kayit, acik), true)
})

test('IST-116: bölüm seçicisi olmayan modül kartı yalnız bayrağa bakar', () => {
  const kayit = card({ id: 'a', module: 'crm' })
  assert.equal(isCardVisible(kayit, view({ modules: { crm: true } })), true)
  assert.equal(isCardVisible(kayit, view({ modules: { crm: false }, data: response({}) })), false)
})

test('IST-116: modülsüz kart modül kapalıyken de görünür', () => {
  assert.equal(isCardVisible(card({ id: 'a' }), view({ modules: { finance: false } })), true)
})

test('IST-116: ek koşul rol ve modülden sonra uygulanır', () => {
  const kayit = card({ id: 'a', when: (v) => v.modules.finance === true })
  assert.equal(isCardVisible(kayit, view({ modules: { finance: true } })), true)
  assert.equal(isCardVisible(kayit, view({ modules: { finance: false } })), false)
  const baskaRol = card({ id: 'b', roles: ['veli'], when: () => true })
  assert.equal(isCardVisible(baskaRol, view()), false)
})

test('IST-116: görünen kartlar order ile sıralanır, eşitlikte kayıt sırası korunur', () => {
  const cards = [
    card({ id: 'c', order: 30 }),
    card({ id: 'a1', order: 10 }),
    card({ id: 'b', order: 20 }),
    card({ id: 'a2', order: 10 }),
    card({ id: 'gizli', order: 1, roles: ['veli'] }),
  ]
  assert.deepEqual(
    visibleCards(cards, view()).map((item) => item.id),
    ['a1', 'a2', 'b', 'c'],
  )
})

test('IST-116: Onur bloğundan eklenen kart Oğuzhan kartlarıyla birleşip görünür', () => {
  const oguzhan = [card({ id: 'yonetici.aktif-ogrenci', area: 'stat', order: 10 })]
  const onur = [
    card({
      id: 'yonetici.tahsilat-ozeti',
      area: 'stat',
      order: 40,
      module: 'finance',
      section: (data) => (data as never)['finance'],
    }),
  ]
  const hepsi = buildDashboardCards(oguzhan, [], onur)
  assert.deepEqual(
    visibleCards(hepsi, view({ modules: { finance: true } })).map((item) => item.id),
    ['yonetici.aktif-ogrenci', 'yonetici.tahsilat-ozeti'],
  )
  assert.deepEqual(
    visibleCards(hepsi, view({ modules: { finance: false } })).map((item) => item.id),
    ['yonetici.aktif-ogrenci'],
  )
})

test('IST-116: yinelenen kart kimliği kayıtta hata verir', () => {
  assert.throws(
    () => buildDashboardCards([card({ id: 'a' })], [card({ id: 'a' })]),
    /Pano kartı kimliği yinelendi: a/,
  )
})

const ids = (rows: readonly (readonly DashboardCard[])[]) =>
  rows.map((row) => row.map((item) => item.id))

test('IST-116: yerleşim sayaçları ayırır, ana kartla ardından gelen yan kartı tek satıra koyar', () => {
  const layout = layoutCards([
    card({ id: 's1', area: 'stat' }),
    card({ id: 'm1', area: 'main' }),
    card({ id: 'k1', area: 'side' }),
    card({ id: 's2', area: 'stat' }),
    card({ id: 'm2', area: 'main' }),
    card({ id: 'm3', area: 'main' }),
    card({ id: 'k2', area: 'side' }),
  ])
  assert.deepEqual(
    layout.stats.map((item) => item.id),
    ['s1', 's2'],
  )
  assert.deepEqual(ids(layout.rows), [['m1', 'k1'], ['m2'], ['m3', 'k2']])
})

test('IST-116: ana kart gizlenince yan kart tek başına satır açar, komşu satırlar kaymaz', () => {
  const layout = layoutCards([
    card({ id: 'k1', area: 'side' }),
    card({ id: 'm2', area: 'main' }),
    card({ id: 'k2', area: 'side' }),
    card({ id: 'k3', area: 'side' }),
  ])
  assert.deepEqual(ids(layout.rows), [['k1'], ['m2', 'k2'], ['k3']])
})

test('IST-116: kart yoksa yerleşim boştur', () => {
  assert.deepEqual(layoutCards([]), { stats: [], rows: [] })
})
