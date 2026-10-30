import assert from 'node:assert/strict'
import { test } from 'node:test'
import { moduleKeys } from '../src/lib/navigation.ts'
import { resolveShell } from '../src/lib/route-guard.ts'

const modules = Object.fromEntries(moduleKeys().map((key) => [key, true]))
const veli = { role: 'veli' as const, modules }

test('rol olmayan ilk bölüm kabuk dışı 404 verir', () => {
  assert.deepEqual(resolveShell(veli, 'olmayan', 'yol'), { kind: 'not-found-outside' })
})

test('oturum yoksa girişe yönlendirilir', () => {
  assert.deepEqual(resolveShell(null, 'veli', 'finans'), { kind: 'login' })
})

test('başka rolün adresi ve rol kökü kendi dashboard’una gider', () => {
  assert.deepEqual(resolveShell(veli, 'yonetici', 'finans'), {
    kind: 'redirect',
    to: '/veli/dashboard',
  })
  assert.deepEqual(resolveShell(veli, 'veli', undefined), {
    kind: 'redirect',
    to: '/veli/dashboard',
  })
})

test('kapalı modülün doğrudan adresi uyarıyla dashboard’a döner', () => {
  const closed = { ...veli, modules: { ...modules, finance: false } }
  assert.deepEqual(resolveShell(closed, 'veli', 'finans'), {
    kind: 'module-closed',
    to: '/veli/dashboard',
  })
})

test('bilinmeyen sayfa kabuk içinde 404, bilinen sayfa açılır', () => {
  assert.deepEqual(resolveShell(veli, 'veli', 'olmayan'), { kind: 'not-found' })
  const decision = resolveShell(veli, 'veli', 'finans')
  assert.equal(decision.kind, 'page')
  assert.equal(decision.kind === 'page' && decision.page.path, 'finans')
})
