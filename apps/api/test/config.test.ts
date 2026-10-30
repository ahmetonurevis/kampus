import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { loadConfig } from '../src/config.ts'

const base = {
  DATABASE_URL: 'postgres://test@localhost:5432/test',
  BETTER_AUTH_SECRET: 'yalniz-test-icin-otuz-iki-karakter-sir',
}

describe('ortam yapılandırması', () => {
  test('varsayılanları uygular, boş değerleri tanımsız sayar', () => {
    const config = loadConfig({
      ...base,
      DEMO_PASSWORD: '',
      CORS_ORIGINS: 'http://a.test, http://b.test',
    })
    assert.equal(config.NODE_ENV, 'development')
    assert.equal(config.PORT, 3000)
    assert.equal(config.DEMO_PASSWORD, undefined)
    assert.deepEqual(config.CORS_ORIGINS, ['http://a.test', 'http://b.test'])
    assert.deepEqual(config.TRUSTED_ORIGINS, ['kampus://'])
  })

  test('hata mesajı değişken adlarını verir, değerleri sızdırmaz', () => {
    const secret = 'kisa-sir'
    assert.throws(
      () => loadConfig({ ...base, BETTER_AUTH_SECRET: secret, NODE_ENV: 'production' }),
      (error: Error) =>
        error.message.includes('BETTER_AUTH_SECRET') &&
        error.message.includes('BETTER_AUTH_URL') &&
        !error.message.includes(secret),
    )
  })

  test('CORS listesinde geçersiz köken reddedilir', () => {
    assert.throws(() => loadConfig({ ...base, CORS_ORIGINS: '*' }), /CORS_ORIGINS/)
  })
})
