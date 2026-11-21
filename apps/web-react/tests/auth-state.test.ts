import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keepsIntentionalSignOut, sessionExpired } from '../src/auth/auth-state.ts'

test('oturum yalnız kullanıcı çıkış yapmadan kapanınca süre doldu sayılır', () => {
  assert.equal(sessionExpired('signed-in', 'signed-out', false), true)
  assert.equal(sessionExpired('signed-in', 'signed-out', true), false)
  assert.equal(sessionExpired(null, 'signed-out', false), false)
  assert.equal(sessionExpired('signed-out', 'signed-out', false), false)
  assert.equal(sessionExpired('signed-in', 'loading', false), false)
  assert.equal(sessionExpired('signed-in', 'signed-in', false), false)
})

test('bilinçli çıkış bayrağı oturum kapalıyken korunur, yalnız yeniden girişte düşer', () => {
  // Çıkıştan sonra kabuk yönlendirme bitmeden yeniden çizilebilir; bayrak düşerse adrese
  // `?donus=` eklenir (giris.spec.ts).
  assert.equal(keepsIntentionalSignOut(true, 'signed-out'), true)
  assert.equal(keepsIntentionalSignOut(true, 'loading'), true)
  assert.equal(keepsIntentionalSignOut(true, 'signed-in'), false)
  assert.equal(keepsIntentionalSignOut(false, 'signed-out'), false)
})
