import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sessionExpired } from '../src/auth/auth-state.ts'
import { retryAfterSeconds, SIGN_IN_MESSAGES, signInFailure } from '../src/auth/sign-in-errors.ts'

test('yanlış parola ve bilinmeyen hesap aynı alan mesajını alır', () => {
  const expected = { ok: false, field: 'password', message: SIGN_IN_MESSAGES.invalid }
  assert.deepEqual(signInFailure({ status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' }), expected)
  assert.deepEqual(signInFailure({ status: 401 }), expected)
  assert.deepEqual(signInFailure({ status: 400, code: 'INVALID_EMAIL' }), expected)
})

test('kilitli veya doğrulanmamış hesap toast mesajı alır', () => {
  for (const code of ['BANNED_USER', 'EMAIL_NOT_VERIFIED'])
    assert.deepEqual(signInFailure({ status: 403, code }), {
      ok: false,
      message: SIGN_IN_MESSAGES.locked,
    })
})

test('hız sınırında bekleme süresi Türkçe yazılır', () => {
  assert.equal(
    signInFailure({ status: 429 }, 42).message,
    'Çok fazla giriş denemesi yapıldı. Lütfen 42 saniye sonra tekrar deneyin.',
  )
  assert.equal(
    signInFailure({ status: 429 }, 90).message,
    'Çok fazla giriş denemesi yapıldı. Lütfen 2 dakika sonra tekrar deneyin.',
  )
  assert.equal(signInFailure({ status: 429 }).message, SIGN_IN_MESSAGES.rateLimited)
  assert.equal(signInFailure({ status: 429 }).field, undefined)
})

test('CSRF, sunucu ve bilinmeyen hatalar teknik ayrıntısız genel mesaj alır', () => {
  for (const error of [{ status: 403, code: 'INVALID_ORIGIN' }, { status: 500 }, { status: 0 }])
    assert.deepEqual(signInFailure(error), { ok: false, message: SIGN_IN_MESSAGES.unavailable })
})

test('Retry-After saniye ve HTTP tarihi okunur', () => {
  const now = Date.parse('2026-10-30T10:00:00Z')
  assert.equal(retryAfterSeconds('30', now), 30)
  assert.equal(retryAfterSeconds(' 7 ', now), 7)
  assert.equal(retryAfterSeconds('Fri, 30 Oct 2026 10:01:00 GMT', now), 60)
  assert.equal(retryAfterSeconds('Fri, 30 Oct 2026 09:00:00 GMT', now), 0)
  assert.equal(retryAfterSeconds('yakında', now), null)
  assert.equal(retryAfterSeconds(null, now), null)
})

test('oturum yalnız kullanıcı çıkış yapmadan kapanınca süre doldu sayılır', () => {
  assert.equal(sessionExpired('signed-in', 'signed-out', false), true)
  assert.equal(sessionExpired('signed-in', 'signed-out', true), false)
  assert.equal(sessionExpired(null, 'signed-out', false), false)
  assert.equal(sessionExpired('signed-out', 'signed-out', false), false)
  assert.equal(sessionExpired('signed-in', 'loading', false), false)
  assert.equal(sessionExpired('signed-in', 'signed-in', false), false)
})
