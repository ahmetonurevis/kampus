import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  resolveSettingsTab,
  settingsRegistryErrors,
  settingsSectionsOf,
  settingsTabSearch,
  settingsTabs,
  visibleSettingsEntries,
  type SettingsEntry,
} from '../src/pages/settings/settings-tabs.ts'

// OG-026: ayar sekme yuvası. Süzme, sıra, Onur bloğu, adres anahtarı (DOM-YTK-040: yalnız yönetici).
const general = 'GENEL'
const entries: SettingsEntry<string>[] = [
  {
    kind: 'tab',
    id: 'users',
    label: 'K',
    param: 'kullanicilar',
    roles: ['yonetici'],
    order: 20,
    component: 'users',
  },
  {
    kind: 'tab',
    id: 'general',
    label: 'G',
    param: '',
    roles: ['yonetici'],
    order: 10,
    component: general,
  },
  {
    kind: 'tab',
    id: 'staff',
    label: 'S',
    param: 'kadro',
    roles: ['yonetici', 'onburo'],
    module: 'staff',
    order: 30,
    component: 'staff',
  },
  {
    kind: 'section',
    id: 'payment',
    tab: 'general',
    roles: ['yonetici'],
    module: 'finance',
    order: 100,
    component: 'payment',
  },
  {
    kind: 'section',
    id: 'note',
    tab: 'general',
    roles: ['yonetici'],
    order: 100,
    component: 'note',
  },
]
const open = { finance: true, staff: true }

test('sekmeler sıraya göre dizilir, kayıt sırası eşitlikte korunur', () => {
  const visible = visibleSettingsEntries(entries, 'yonetici', open)
  assert.deepEqual(
    settingsTabs(visible).map((tab) => tab.id),
    ['general', 'users', 'staff'],
  )
  assert.deepEqual(
    settingsSectionsOf(visible, 'general').map((s) => s.id),
    ['payment', 'note'],
  )
})

test('rol süzmesi: kaydı olmayan rol sekme görmez', () => {
  assert.deepEqual(visibleSettingsEntries(entries, 'veli', open), [])
  const front = visibleSettingsEntries(entries, 'onburo', open)
  assert.deepEqual(
    front.map((entry) => entry.id),
    ['staff'],
  )
})

test('kapalı ya da bilinmeyen modül girdiyi gizler (DOM-YTK-042)', () => {
  const closed = visibleSettingsEntries(entries, 'yonetici', { finance: false, staff: undefined })
  assert.deepEqual(
    closed.map((entry) => entry.id),
    ['general', 'users', 'note'],
  )
})

test('sekme gizlenince bölümü de çizilmez', () => {
  const visible = visibleSettingsEntries(entries, 'onburo', open)
  assert.deepEqual(settingsSectionsOf(visible, 'general'), [])
})

test('adres anahtarı sekmeye çözülür; bilinmeyen ve boş değer ilk sekmeye düşer', () => {
  const tabs = settingsTabs(visibleSettingsEntries(entries, 'yonetici', open))
  assert.equal(resolveSettingsTab(tabs, null)?.id, 'general')
  assert.equal(resolveSettingsTab(tabs, '')?.id, 'general')
  assert.equal(resolveSettingsTab(tabs, 'kullanicilar')?.id, 'users')
  assert.equal(resolveSettingsTab(tabs, 'kadro')?.id, 'staff')
  assert.equal(resolveSettingsTab(tabs, 'yok')?.id, 'general')
  assert.equal(resolveSettingsTab([], 'kadro'), undefined)
})

test('modülü kapalı sekmenin adresi ilk sekmeye düşer', () => {
  const tabs = settingsTabs(visibleSettingsEntries(entries, 'yonetici', { staff: false }))
  assert.equal(resolveSettingsTab(tabs, 'kadro')?.id, 'general')
})

test('ilk sekme adreste parametresizdir, ötekiler sekme anahtarı taşır', () => {
  const tabs = settingsTabs(visibleSettingsEntries(entries, 'yonetici', open))
  const [first, second] = tabs
  assert.ok(first && second)
  assert.deepEqual(settingsTabSearch(tabs, first), {})
  assert.deepEqual(settingsTabSearch(tabs, second), { sekme: 'kullanicilar' })
})

test('kayıt hataları: yinelenen kimlik, yinelenen adres anahtarı, var olmayan sekme', () => {
  assert.deepEqual(settingsRegistryErrors(entries), [])
  const bad: SettingsEntry<string>[] = [
    ...entries,
    {
      kind: 'tab',
      id: 'users',
      label: 'Y',
      param: 'kadro',
      roles: ['yonetici'],
      order: 1,
      component: 'x',
    },
    { kind: 'section', id: 'orphan', tab: 'yok', roles: ['yonetici'], order: 1, component: 'x' },
  ]
  assert.deepEqual(settingsRegistryErrors(bad), [
    'Yinelenen kimlik: users',
    'Yinelenen adres anahtarı: "kadro"',
    'Bölüm orphan: sekme yok (yok)',
  ])
})

test('gerçek kayıt: Onur bloğu ödeme bölümünü taşır, Oğuzhan dosyalarında Onur referansı yok', () => {
  const read = (file: string) =>
    readFileSync(new URL(`../src/pages/settings/${file}`, import.meta.url), 'utf8')
  const sections = read('settings-sections.tsx')
  const block = sections.slice(
    sections.indexOf('// Onur: kayıt ve finans\n'),
    sections.indexOf('// Onur: kayıt ve finans sonu'),
  )
  assert.match(block, /PaymentSettingsSection/)
  assert.match(block, /module: 'finance'/)
  const outside = sections.replace(block, '')
  assert.doesNotMatch(outside, /Payment/)
  for (const file of ['SettingsPage.tsx', 'settings-tabs.ts'])
    assert.doesNotMatch(read(file), /Payment/)
})
