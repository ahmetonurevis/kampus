import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { decodeText } from '../packages/school-core/src/lib/text-decoding.ts'
import { isDomainError } from './support/domain-error.js'
import { runWorkflow } from '../packages/school-core/src/lib/school-workflows.ts'
import {
  createSnapshotWriter,
  restoreSnapshot,
} from '../packages/school-core/src/lib/demo-persistence.ts'
import { navigation as webNavigation } from '../apps/web/src/modules/navigation.js'
import { navigation, availablePages } from '../apps/mobile/src/model/school.ts'
import {
  accountPages,
  categoryPages,
  hubCategories,
  pageTitle,
} from '../apps/mobile/src/model/hub.ts'

const roles = ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli']
const session = (role) => ({ role, childId: 's1', theme: 'light' })

test('Mobil ve web aynı birleşik menüyü kullanır; iş akışı modülleri mobilde de bulunur', () => {
  assert.deepEqual(navigation, webNavigation)
  for (const role of ['yonetici', 'ogretmen', 'ogrenci', 'veli'])
    assert.ok(navigation[role].some((page) => page.path === 'hedef-plani'))
  for (const role of roles)
    assert.ok(navigation[role].some((page) => page.group === 'OKUL İŞ AKIŞLARI'))
})

test('Ana ekran kategorileri kart olarak sunar; her modül tek kategoride, hesap sayfaları ayrı menüdedir', () => {
  const state = createSeed()
  for (const role of roles) {
    const categories = hubCategories(state, role)
    assert.ok(categories.length > 0)
    assert.equal(new Set(categories.map((c) => c.key)).size, categories.length)
    for (const category of categories) {
      assert.ok(category.icon && category.label)
      assert.equal(category.count, categoryPages(state, role, category.key).length)
    }
    const cards = categories.flatMap((c) => categoryPages(state, role, c.key).map((p) => p.path))
    assert.equal(new Set(cards).size, cards.length, `${role} kartı birden fazla kategoride`)
    const account = accountPages(state, role).map((p) => p.path)
    assert.ok(!cards.includes('dashboard') && !cards.includes('ayarlar'))
    // Menüdeki her sayfa kart, hesap öğesi, ana ekran veya çocuk seçiciden biridir.
    assert.deepEqual(
      [...cards, ...account, 'dashboard', ...(role === 'veli' ? ['cocuk-secici'] : [])].sort(),
      availablePages(state, role)
        .map((p) => p.path)
        .sort(),
    )
  }
})

test('Ayarlar hesap menüsünde; öğrencide ödemeler telefonda yok, veli ödemeleri durur', () => {
  const state = createSeed()
  for (const role of ['yonetici', 'ogrenci', 'veli'])
    assert.ok(
      accountPages(state, role).some((p) => p.path === 'ayarlar'),
      `${role} ayarlar`,
    )
  assert.ok(!availablePages(state, 'ogrenci').some((p) => p.path === 'odemelerim'))
  assert.ok(
    navigation.ogrenci.some((p) => p.path === 'odemelerim'),
    'web menüsü değişmedi',
  )
  assert.ok(availablePages(state, 'veli').some((p) => p.path === 'finans'))
  assert.ok(!hubCategories(state, 'ogrenci').some((c) => c.key === 'HESABIM'))
})

test('Kapatılan modül kartı ve boşalan kategori ana ekrandan kaybolur', () => {
  const state = createSeed()
  state.modules.finance = false
  assert.ok(!categoryPages(state, 'yonetici', 'YÖNETİM').some((card) => card.path === 'finans'))
  for (const key of ['transport', 'meals', 'clubs', 'calendar']) state.modules[key] = false
  assert.ok(!hubCategories(state, 'yonetici').some((c) => c.key === 'OKUL YAŞAMI'))
  assert.equal(categoryPages(state, 'yonetici', 'OKUL YAŞAMI').length, 0)
  assert.equal(pageTitle('veli', { path: 'finans', title: 'Finans' }), 'Ödeme planı')
})

test('Windows-1254 ve UTF-8 çözücü Türkçe harfleri korur; geçersiz UTF-8 reddedilir', () => {
  const text = 'ĞÜŞİÖÇ ğüşıöç'
  const codes = { Ğ: 0xd0, Ü: 0xdc, Ş: 0xde, İ: 0xdd, Ö: 0xd6, Ç: 0xc7 }
  Object.assign(codes, { ğ: 0xf0, ü: 0xfc, ş: 0xfe, ı: 0xfd, ö: 0xf6, ç: 0xe7 })
  const win1254 = Uint8Array.from([...text].map((ch) => codes[ch] ?? ch.charCodeAt(0)))
  assert.equal(decodeText(win1254, 'windows-1254'), text)
  assert.equal(decodeText(new TextEncoder().encode(text), 'utf-8'), text)
  assert.throws(() => decodeText(win1254, 'utf-8'))
  assert.throws(() => decodeText(win1254, 'iso-8859-9'), /Desteklenmeyen/)
  for (let byte = 0; byte < 256; byte++)
    assert.equal(
      decodeText(Uint8Array.of(byte), 'windows-1254'),
      new TextDecoder('windows-1254').decode(Uint8Array.of(byte)),
    )
})

test('Mobil oturum bilgisiyle çalışan iş akışı kalıcı kayıttan kayıpsız döner', () => {
  const state = createSeed()
  const write = createSnapshotWriter(createSeed(new Date(state.createdAt)))
  let sequence = 0
  const goal = runWorkflow(
    state,
    session('ogrenci'),
    'goal',
    {
      studentId: 's1',
      subjectId: 'science',
      title: 'Fen netini yükseltmek',
      targetNet: 18,
      deadline: '2099-01-01',
      motivation: '',
    },
    (prefix) => `${prefix}-mobile-${++sequence}`,
  )
  assert.equal(goal.status, 'Onay bekliyor')
  const restored = restoreSnapshot(write(state))
  assert.deepEqual(restored.studentGoals, state.studentGoals)
  assert.equal(restored.modules.goals, true)
})

test('Desteklenmeyen karakter kodlaması DomainError ile reddedilir', () => {
  assert.throws(
    () => decodeText(new Uint8Array(), 'iso-8859-9'),
    isDomainError('unsupported_encoding'),
  )
})
