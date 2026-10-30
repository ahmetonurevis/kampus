import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  accountPages,
  findPage,
  groupLabel,
  isGroupExpanded,
  isRoleKey,
  moduleKeys,
  pageHref,
  ROLE_KEYS,
  setGroupExpanded,
  sidebarGroups,
  visiblePages,
  type ModuleState,
} from '../src/lib/navigation.ts'

const allOpen: ModuleState = Object.fromEntries(moduleKeys().map((key) => [key, true]))

test('rol anahtarı yalnız beş rolü kabul eder', () => {
  assert.deepEqual([...ROLE_KEYS], ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'])
  assert.equal(isRoleKey('veli'), true)
  assert.equal(isRoleKey('admin'), false)
  assert.equal(isRoleKey(undefined), false)
})

test('kapalı modülün sayfası menüden ve doğrudan erişimden düşer', () => {
  const closed = { ...allOpen, finance: false }
  assert.ok(visiblePages('yonetici', allOpen).some((page) => page.path === 'finans'))
  assert.ok(!visiblePages('yonetici', closed).some((page) => page.path === 'finans'))
  // Modülsüz sayfalar (dashboard, ayarlar) her zaman açıktır.
  assert.ok(visiblePages('yonetici', {}).some((page) => page.path === 'dashboard'))
  assert.ok(visiblePages('yonetici', {}).some((page) => page.path === 'ayarlar'))
})

test('modül durumu tanımsızsa sayfa kapalı sayılır', () => {
  assert.ok(!visiblePages('yonetici', {}).some((page) => page.path === 'finans'))
})

test('boş kategori gizlenir ve kayıt sırası korunur', () => {
  const groups = sidebarGroups('yonetici', allOpen)
  assert.equal(groups[0]?.key, 'GENEL')
  const onlyCore = sidebarGroups('yonetici', {})
  assert.deepEqual(
    onlyCore.map((group) => group.key),
    ['GENEL', 'SİSTEM'],
  )
  for (const group of groups) assert.ok(group.pages.length > 0)
})

test('hesap sayfaları sidebar yerine avatar menüsündedir', () => {
  const groups = sidebarGroups('ogrenci', allOpen)
  assert.ok(!groups.some((group) => group.key === 'HESABIM'))
  assert.deepEqual(
    accountPages('ogrenci', allOpen).map((page) => page.path),
    ['odemelerim', 'ayarlar'],
  )
  assert.deepEqual(
    accountPages('ogrenci', { ...allOpen, finance: false }).map((page) => page.path),
    ['ayarlar'],
  )
  // Yöneticinin SİSTEM > Ayarlar sayfası sidebar'da kalır.
  assert.deepEqual(accountPages('yonetici', allOpen), [])
})

test('grup etiketi Türkçe büyük/küçük harfle yazılır', () => {
  assert.equal(groupLabel('OKUL İŞ AKIŞLARI'), 'Okul iş akışları')
  assert.equal(groupLabel('GELİŞİMİM'), 'Gelişimim')
})

test('sayfa bulma ve bağlantı rol önekli çalışır', () => {
  const page = findPage('veli', 'finans')
  assert.ok(page)
  assert.equal(pageHref('veli', page), '/veli/finans')
  assert.equal(findPage('veli', 'olmayan'), undefined)
})

test('varsayılan olarak yalnız GENEL grubu açıktır ve tercih rol bazındadır', () => {
  assert.equal(isGroupExpanded({}, 'yonetici', 'GENEL'), true)
  assert.equal(isGroupExpanded({}, 'yonetici', 'YÖNETİM'), false)
  const expanded = setGroupExpanded({}, 'yonetici', 'YÖNETİM', true)
  assert.equal(isGroupExpanded(expanded, 'yonetici', 'YÖNETİM'), true)
  assert.equal(isGroupExpanded(expanded, 'veli', 'YÖNETİM'), false)
  assert.equal(setGroupExpanded(expanded, 'yonetici', 'YÖNETİM', true), expanded)
})

test('etkin sayfanın grubu tercih yoksa açık, kapatma tercihi ise önceliklidir', () => {
  assert.equal(isGroupExpanded({}, 'yonetici', 'FİNANS', true), true)
  const closed = setGroupExpanded({}, 'yonetici', 'FİNANS', false)
  assert.equal(isGroupExpanded(closed, 'yonetici', 'FİNANS', true), false)
})

test('web iletişim sayfaları yönetici, ön büro ve öğretmen menüsüne eklenir', () => {
  const paths = (role: Parameters<typeof visiblePages>[0]) =>
    visiblePages(role, allOpen).map((page) => page.path)
  assert.ok(paths('yonetici').includes('duyurular') && paths('yonetici').includes('mesajlar'))
  assert.ok(paths('ogretmen').includes('duyurular') && paths('ogretmen').includes('mesajlar'))
  assert.ok(paths('onburo').includes('duyurular'))
  // Ön büro yazışmaya taraf değildir: Mesajlar menüsü yoktur.
  assert.ok(!paths('onburo').includes('mesajlar'))
  // Öğrenci ve veli iletişim sayfalarını çekirdek menüden alır; çift kayıt oluşmaz.
  assert.equal(paths('ogrenci').filter((path) => path === 'duyurular').length, 1)
  assert.equal(paths('veli').filter((path) => path === 'duyurular').length, 1)
  assert.ok(paths('veli').includes('randevu-mesaj'))
})

test('iletişim sayfaları hesap grubundan önce, iletişim kategorisinde durur', () => {
  const groups = sidebarGroups('yonetici', allOpen)
  const labels = groups.map((group) => group.label)
  const communication = groups.find((group) => group.pages.some((page) => page.path === 'mesajlar'))
  assert.ok(communication)
  assert.ok(communication.pages.some((page) => page.path === 'duyurular'))
  assert.ok(!labels.includes('Hesap'))
})
