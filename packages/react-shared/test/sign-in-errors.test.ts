import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  retryAfterSeconds,
  SIGN_IN_MESSAGES,
  signInFailure,
  signInNetworkFailure,
} from '../src/sign-in-errors.ts'

const NOW = Date.parse('2026-10-30T09:00:00Z')

describe('giriş hata eşlemesi', () => {
  test('401 ve INVALID_EMAIL_OR_PASSWORD parola alanına tek mesaj verir', () => {
    assert.deepEqual(signInFailure({ status: 401 }), {
      ok: false,
      field: 'password',
      message: SIGN_IN_MESSAGES.invalid,
    })
    assert.deepEqual(signInFailure({ status: 403, code: 'INVALID_EMAIL_OR_PASSWORD' }), {
      ok: false,
      field: 'password',
      message: SIGN_IN_MESSAGES.invalid,
    })
  })

  test('400 biçim hatası da hesabın varlığını belli etmeden aynı mesajı alır', () => {
    assert.deepEqual(signInFailure({ status: 400, code: 'INVALID_EMAIL' }), {
      ok: false,
      field: 'password',
      message: SIGN_IN_MESSAGES.invalid,
    })
  })

  test('kilitli, askıda veya doğrulanmamış hesap yöneticiye yönlendirir', () => {
    for (const code of ['BANNED_USER', 'USER_BANNED', 'ACCOUNT_LOCKED', 'EMAIL_NOT_VERIFIED']) {
      assert.deepEqual(signInFailure({ status: 403, code }), {
        ok: false,
        message: SIGN_IN_MESSAGES.locked,
      })
    }
  })

  test('429 bekleme süresini saniye veya dakika olarak söyler', () => {
    assert.equal(
      signInFailure({ status: 429 }, 30).message,
      'Çok fazla giriş denemesi yapıldı. Lütfen 30 saniye sonra tekrar deneyin.',
    )
    assert.equal(
      signInFailure({ status: 429 }, 61).message,
      'Çok fazla giriş denemesi yapıldı. Lütfen 2 dakika sonra tekrar deneyin.',
    )
    assert.equal(signInFailure({ status: 429 }).message, SIGN_IN_MESSAGES.rateLimited)
    assert.equal(signInFailure({ status: 429 }, 0).message, SIGN_IN_MESSAGES.rateLimited)
  })

  test('status 0 ve fırlatılan istek ağ mesajı verir', () => {
    assert.deepEqual(signInFailure({ status: 0 }), {
      ok: false,
      message: SIGN_IN_MESSAGES.network,
    })
    assert.deepEqual(signInNetworkFailure(), { ok: false, message: SIGN_IN_MESSAGES.network })
  })

  test('beklenmeyen durum teknik ayrıntı göstermeden genel mesaj verir', () => {
    assert.deepEqual(signInFailure({ status: 500, code: 'INTERNAL_SERVER_ERROR' }), {
      ok: false,
      message: SIGN_IN_MESSAGES.unavailable,
    })
  })

  test('mesajlar Türkçe ve alan adı ya da kod içermez', () => {
    for (const message of Object.values(SIGN_IN_MESSAGES)) {
      assert.doesNotMatch(message, /[A-Z_]{4,}|\bstatus\b|\berror\b/)
    }
  })
})

describe('Retry-After ayrıştırması', () => {
  test('saniye değeri olduğu gibi döner', () => {
    assert.equal(retryAfterSeconds('45', NOW), 45)
    assert.equal(retryAfterSeconds(' 7 ', NOW), 7)
  })

  test('HTTP tarihi şimdiye göre yukarı yuvarlanır, geçmiş tarih 0 olur', () => {
    assert.equal(retryAfterSeconds(new Date(NOW + 90_500).toUTCString(), NOW), 90)
    assert.equal(retryAfterSeconds('Thu, 29 Oct 2026 09:00:00 GMT', NOW), 0)
  })

  test('boş veya geçersiz başlık null döner', () => {
    assert.equal(retryAfterSeconds(null, NOW), null)
    assert.equal(retryAfterSeconds(undefined, NOW), null)
    assert.equal(retryAfterSeconds('', NOW), null)
    assert.equal(retryAfterSeconds('yakında', NOW), null)
  })
})
