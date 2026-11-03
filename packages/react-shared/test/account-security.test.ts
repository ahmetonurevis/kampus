import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { isApiError } from '@kampus/api-client/errors.ts'

import {
  ACCOUNT_SECURITY_MESSAGES,
  accountSecurityError,
  accountSecurityFailure,
  changePasswordSchema,
  forgotPasswordSchema,
  parseSessionList,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  resetPasswordSchema,
  sessionDeviceLabel,
} from '../src/account-security.ts'
import { isReauthenticationRequired } from '../src/reauthentication.ts'
import { runAuthCall } from '../src/use-account-security.ts'

const GOOD = 'Guclu-Bir-Parola-2026'

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues.map((issue) => issue.message) ?? []
}

describe('hesap güvenliği doğrulaması (IST-003)', () => {
  test('IST-003: parola uzunluğu API ile aynıdır (12–128)', () => {
    assert.equal(PASSWORD_MIN_LENGTH, 12)
    assert.equal(PASSWORD_MAX_LENGTH, 128)
    const short = resetPasswordSchema.safeParse({
      newPassword: 'a'.repeat(11),
      confirmPassword: 'a'.repeat(11),
    })
    assert.deepEqual(messages(short), ['Parola en az 12 karakter olmalı.'])
    const long = resetPasswordSchema.safeParse({
      newPassword: 'a'.repeat(129),
      confirmPassword: 'a'.repeat(129),
    })
    assert.deepEqual(messages(long), ['Parola en fazla 128 karakter olabilir.'])
    assert.equal(
      resetPasswordSchema.safeParse({
        newPassword: 'a'.repeat(12),
        confirmPassword: 'a'.repeat(12),
      }).success,
      true,
    )
  })

  test('IST-003: tekrar eşleşmezse hata tekrar alanındadır', () => {
    const result = resetPasswordSchema.safeParse({ newPassword: GOOD, confirmPassword: `${GOOD}x` })
    assert.equal(result.success, false)
    assert.deepEqual(result.error?.issues[0]?.path, ['confirmPassword'])
    assert.equal(result.error?.issues[0]?.message, 'Parolalar eşleşmiyor.')
  })

  test('IST-003: parola değişiminde yeni parola mevcut paroladan farklı olmalı', () => {
    const same = changePasswordSchema.safeParse({
      currentPassword: GOOD,
      newPassword: GOOD,
      confirmPassword: GOOD,
      revokeOtherSessions: true,
    })
    assert.equal(same.success, false)
    assert.deepEqual(same.error?.issues[0]?.path, ['newPassword'])
    const ok = changePasswordSchema.safeParse({
      currentPassword: 'eski-parola',
      newPassword: GOOD,
      confirmPassword: GOOD,
      revokeOtherSessions: false,
    })
    assert.equal(ok.success, true)
  })

  test('IST-003: unuttum formu e-postayı kırpar ve doğrular', () => {
    assert.deepEqual(forgotPasswordSchema.parse({ email: '  kisi@kampus.example ' }), {
      email: 'kisi@kampus.example',
    })
    assert.deepEqual(messages(forgotPasswordSchema.safeParse({ email: 'gecersiz' })), [
      'Geçerli bir e-posta adresi girin.',
    ])
  })
})

function validRow() {
  return {
    id: 's9',
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-02T08:00:00.000Z',
    expiresAt: '2026-11-15T08:00:00.000Z',
    device: null,
    current: false,
  }
}

describe('oturum listesi (IST-003)', () => {
  test('IST-003: daraltılmış satırlar ayrıştırılır, tarihler ISO olur, bozuk satır düşer', () => {
    const list = parseSessionList([
      {
        id: 's1',
        createdAt: new Date('2026-11-01T08:00:00.000Z'),
        updatedAt: '2026-11-02T08:00:00.000Z',
        expiresAt: '2026-11-15T08:00:00.000Z',
        device: 'Chrome · macOS',
        current: true,
      },
      { id: 's2', token: 't2' },
    ])
    assert.equal(list.length, 1)
    assert.equal(list[0]?.createdAt, '2026-11-01T08:00:00.000Z')
    // IST-025: eski API'nin gönderdiği belirteç satıra taşınmaz.
    assert.equal('token' in (parseSessionList([{ ...validRow(), token: 'gizli' }])[0] ?? {}), false)
    assert.equal(parseSessionList(null).length, 0)
  })

  test('IST-003: cihaz özeti yoksa "Bilinmeyen cihaz"', () => {
    assert.equal(sessionDeviceLabel({ device: null }), 'Bilinmeyen cihaz')
    assert.equal(sessionDeviceLabel({ device: 'Safari · iOS' }), 'Safari · iOS')
  })
})

describe('hata mesajları (IST-003)', () => {
  test('IST-003: sıfırlamada geçersiz belirteç, değişimde yanlış parola alana düşer', () => {
    assert.deepEqual(accountSecurityFailure('reset', { status: 400, code: 'INVALID_TOKEN' }), {
      message: ACCOUNT_SECURITY_MESSAGES.invalidToken,
    })
    assert.deepEqual(accountSecurityFailure('change', { status: 400, code: 'INVALID_PASSWORD' }), {
      field: 'currentPassword',
      message: 'Mevcut parola hatalı.',
    })
    assert.equal(
      accountSecurityFailure('change', { status: 400, code: 'PASSWORD_TOO_COMMON' }).field,
      'newPassword',
    )
    assert.equal(
      accountSecurityFailure('reset', { status: 400, code: 'PASSWORD_TOO_SHORT' }).field,
      'newPassword',
    )
  })

  test('IST-003: ağ, hız sınırı ve bilinmeyen hata sunucu metni göstermez', () => {
    assert.equal(
      accountSecurityFailure('request-reset', { status: 0 }).message,
      ACCOUNT_SECURITY_MESSAGES.network,
    )
    assert.equal(
      accountSecurityFailure('request-reset', { status: 429 }).message,
      ACCOUNT_SECURITY_MESSAGES.rateLimited,
    )
    assert.equal(
      accountSecurityFailure('sessions', { status: 500, code: 'X' }).message,
      ACCOUNT_SECURITY_MESSAGES.unavailable,
    )
  })

  test('IST-003: eski oturum ortak taze oturum koduna çevrilir', () => {
    const error = accountSecurityError('sessions', { status: 403, code: 'SESSION_NOT_FRESH' })
    assert.equal(isReauthenticationRequired(error), true)
    assert.equal(error.message, ACCOUNT_SECURITY_MESSAGES.reauth)
  })

  test('IST-003: istemci çağrısı hata sonucunda ve fırlatmada ApiError verir', async () => {
    assert.deepEqual(
      await runAuthCall('sessions', () => Promise.resolve({ data: [1], error: null })),
      [1],
    )
    await assert.rejects(
      runAuthCall('change', () =>
        Promise.resolve({ data: null, error: { status: 400, code: 'INVALID_PASSWORD' } }),
      ),
      (error: unknown) => isApiError(error) && error.code === 'INVALID_PASSWORD',
    )
    await assert.rejects(
      runAuthCall('reset', () => Promise.reject(new Error('ağ'))),
      (error: unknown) => isApiError(error) && error.status === 0,
    )
  })
})
