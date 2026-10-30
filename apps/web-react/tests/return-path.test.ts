import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loginHref, returnPathFor, safeRelativePath } from '../src/lib/return-path.ts'

test('uygulama içi göreli yol korunur', () => {
  assert.equal(safeRelativePath('/veli/finans'), '/veli/finans')
  assert.equal(safeRelativePath('/veli/finans?sayfa=2#ust'), '/veli/finans?sayfa=2#ust')
  assert.equal(safeRelativePath('/veli/./finans/../odevler'), '/veli/odevler')
})

test('açık yönlendirme denemeleri atılır', () => {
  for (const raw of [
    'https://evil.example/veli/finans',
    '//evil.example/veli/finans',
    '/\\evil.example',
    '\\\\evil.example',
    '/veli/\\finans',
    'javascript:alert(1)',
    'veli/finans',
    '/veli/finans\n',
    '/veli/\tfinans',
    '/a/..//evil.example',
    '',
    undefined,
    null,
    42,
    `/${'a'.repeat(3000)}`,
  ])
    assert.equal(safeRelativePath(raw), null, String(raw))
})

test('dönüş adresi yalnız aynı rolün kabuğundaysa kullanılır', () => {
  assert.equal(returnPathFor('/veli/finans?sayfa=2', 'veli'), '/veli/finans?sayfa=2')
  assert.equal(returnPathFor('/yonetici/finans', 'veli'), '/veli/dashboard')
  assert.equal(returnPathFor('/velix/finans', 'veli'), '/veli/dashboard')
  assert.equal(returnPathFor('//evil.example/veli/', 'veli'), '/veli/dashboard')
  assert.equal(returnPathFor(null, 'ogretmen'), '/ogretmen/dashboard')
})

test('giriş adresi dönüş yolunu sorgu parametresinde taşır', () => {
  assert.equal(loginHref('/veli/finans', '?sayfa=2'), '/giris?donus=%2Fveli%2Ffinans%3Fsayfa%3D2')
  assert.equal(
    new URL(loginHref('/veli/finans', '?sayfa=2'), 'http://x').searchParams.get('donus'),
    '/veli/finans?sayfa=2',
  )
  assert.equal(loginHref('/'), '/giris')
  assert.equal(loginHref('/giris'), '/giris')
  assert.equal(loginHref('//evil.example'), '/giris')
})
