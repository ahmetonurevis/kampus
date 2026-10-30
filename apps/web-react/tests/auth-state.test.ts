import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sessionExpired } from '../src/auth/auth-state.ts'

test('oturum yalnız kullanıcı çıkış yapmadan kapanınca süre doldu sayılır', () => {
  assert.equal(sessionExpired('signed-in', 'signed-out', false), true)
  assert.equal(sessionExpired('signed-in', 'signed-out', true), false)
  assert.equal(sessionExpired(null, 'signed-out', false), false)
  assert.equal(sessionExpired('signed-out', 'signed-out', false), false)
  assert.equal(sessionExpired('signed-in', 'loading', false), false)
  assert.equal(sessionExpired('signed-in', 'signed-in', false), false)
})
