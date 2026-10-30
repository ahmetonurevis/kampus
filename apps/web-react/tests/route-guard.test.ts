import assert from 'node:assert/strict'
import { test } from 'node:test'
import { moduleKeys } from '../src/lib/navigation.ts'
import { resolveShell, showsClosedNotice } from '../src/lib/route-guard.ts'

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
  const decision = resolveShell(closed, 'veli', 'finans')
  assert.equal(decision.kind, 'module-closed')
  assert.equal(decision.kind === 'module-closed' && decision.to, '/veli/dashboard')
  assert.equal(decision.kind === 'module-closed' && decision.page.path, 'finans')
})

test('bilinmeyen sayfa kabuk içinde 404, bilinen sayfa açılır', () => {
  assert.deepEqual(resolveShell(veli, 'veli', 'olmayan'), { kind: 'not-found' })
  const decision = resolveShell(veli, 'veli', 'finans')
  assert.equal(decision.kind, 'page')
  assert.equal(decision.kind === 'page' && decision.page.path, 'finans')
})

test('kapalı iş akışı sayfası kabukta bildirim gösterir, diğer sayfalar yönlenir', () => {
  assert.equal(showsClosedNotice({ path: 'hedef-plani' }), true)
  assert.equal(showsClosedNotice({ path: 'yemek-menusu' }), true)
  assert.equal(showsClosedNotice({ path: 'finans' }), false)
})
