import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { isCardVisible, type CardView } from '../src/pages/dashboard/dashboard-cards-model.ts'
import { dashboardHref } from '../src/pages/dashboard/dashboard-model.ts'
import { requestCardModel } from '../src/pages/dashboard/dashboard-front-desk-model.ts'

// OG-099 (IST-116): ön büro "Yeni talep" kartı sunucu sayımından gelir ve Şikayet & Talepler'i
// aynı süzgeçle açar; iletişim modülü kapalıyken kart çizilmez (DOM-YTK-040).

const read = (path: string) =>
  readFileSync(new URL(`../src/pages/${path}`, import.meta.url), 'utf8')

test('IST-116: "Yeni talep" sayısı özetin yeni talep sayısıdır, bağlantı ?durum=Yeni süzgecidir', () => {
  const model = requestCardModel({ total: 5, new: 2, inReview: 1, resolved: 2 })
  assert.equal(model.value, 2)
  assert.equal(model.note, '1 talep inceleniyor')
  assert.equal(
    dashboardHref('onburo', 'talepler', model.filter),
    `/onburo/talepler?durum=${encodeURIComponent('Yeni')}`,
  )
})

test('IST-116: incelenen talep yoksa not ayrı metindir; yanıt yokken sayı boştur', () => {
  assert.equal(
    requestCardModel({ total: 0, new: 0, inReview: 0, resolved: 0 }).note,
    'İncelenen talep yok',
  )
  assert.equal(requestCardModel(null).value, undefined)
})

test('DOM-YTK-040: iletişim kapalıyken "Yeni talep" kartı gizlenir', () => {
  // Kart kaydının görünürlük alanları (bileşen çizilmez): modül ve bölüm seçicisi.
  const source = read('dashboard/FrontDeskCards.tsx')
  assert.match(source, /id: 'onburo\.yeni-talep'/)
  assert.match(source, /module: 'communication'/)
  assert.match(source, /section: \(data\) => data\.requests/)
  const card = {
    id: 'onburo.yeni-talep',
    roles: ['onburo'] as const,
    module: 'communication',
    section: (data: unknown) => (data as { requests: unknown }).requests,
    area: 'stat' as const,
    order: 60,
    component: () => null,
  }
  const view = (partial: Partial<CardView>): CardView => ({
    role: 'onburo',
    modules: { communication: true },
    data: null,
    ...partial,
  })
  const data = (requests: unknown) => ({ requests }) as unknown as CardView['data']
  assert.equal(isCardVisible(card, view({})), true)
  assert.equal(isCardVisible(card, view({ modules: { communication: false } })), false)
  assert.equal(isCardVisible(card, view({ data: data(null) })), false)
  assert.equal(isCardVisible(card, view({ role: 'yonetici' })), false)
  assert.match(read('dashboard/dashboard-cards.tsx'), /\.\.\.FRONT_DESK_CARDS,/)
})
