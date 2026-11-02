import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// ON-033: ödeme ve banka ayarı Onur bloğunda kendi sekmesidir (DOM-FIN-032). Kayıt dosyası bileşen
// içe aktardığı için birim testinde çalıştırılmaz; süzme mantığı `settings-sections.test.ts`'tedir.

const registry = readFileSync(
  new URL('../src/pages/settings/settings-sections.tsx', import.meta.url),
  'utf8',
)
const block = registry.slice(
  registry.indexOf('// Onur: kayıt ve finans\n'),
  registry.indexOf('// Onur: kayıt ve finans sonu'),
)

test('DOM-FIN-032: ödeme ayarı yönetici sekmesidir, finans modülüne bağlıdır', () => {
  assert.match(block, /kind: 'tab'/)
  assert.match(block, /id: 'payments'/)
  assert.match(block, /label: 'Ödeme & Banka'/)
  assert.match(block, /param: 'odeme'/)
  assert.match(block, /roles: \['yonetici'\]/)
  assert.match(block, /module: 'finance'/)
  assert.match(block, /component: PaymentSettingsSection/)
})

test('DOM-FIN-032: eski "Kurum & Modüller" bölüm girdisi kalkmıştır', () => {
  assert.doesNotMatch(block, /kind: 'section'/)
  assert.doesNotMatch(block, /tab: 'general'/)
})
