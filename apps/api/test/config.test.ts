import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { isDevelopmentLike, loadConfig, useSecureCookies } from '../src/config.ts'

const base = {
  NODE_ENV: 'development',
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
    assert.equal(config.TRUST_PROXY, false)
  })

  test('NODE_ENV verilmezse süreç başlamaz', () => {
    const withoutEnv: Record<string, string> = { ...base }
    delete withoutEnv.NODE_ENV
    assert.throws(() => loadConfig(withoutEnv), /NODE_ENV/)
    assert.throws(() => loadConfig({ ...base, NODE_ENV: 'staging' }), /NODE_ENV/)
  })

  const production = {
    ...base,
    NODE_ENV: 'production',
    BETTER_AUTH_URL: 'https://api.kampus.example',
    BETTER_AUTH_SECRET: 'b4Jx9-uretim-icin-uretilmis-rastgele-deger-Qm2',
  }

  test('üretimde örnek veya bilinen gizli anahtar reddedilir', () => {
    assert.equal(loadConfig(production).BETTER_AUTH_SECRET, production.BETTER_AUTH_SECRET)
    for (const secret of [
      'CHANGE_ME-openssl-rand-base64-32-ile-uretin',
      'change_me_ama_kucuk_harfle_yazilmis_deger',
      'degistir-en-az-32-karakter-rastgele-deger',
      'test-secret-test-secret-test-secret-0123',
    ]) {
      assert.throws(
        () => loadConfig({ ...production, BETTER_AUTH_SECRET: secret }),
        (error: Error) =>
          error.message.includes('BETTER_AUTH_SECRET') && !error.message.includes(secret),
        secret,
      )
      // Geliştirmede örnek dosyadaki değer çalışır.
      assert.equal(loadConfig({ ...base, BETTER_AUTH_SECRET: secret }).BETTER_AUTH_SECRET, secret)
    }
  })

  test('Secure çerez üretimde ve https dış adreste her zaman açıktır', () => {
    assert.equal(useSecureCookies(loadConfig(production)), true)
    assert.equal(
      useSecureCookies(loadConfig({ ...production, BETTER_AUTH_URL: 'http://api.ic' })),
      true,
    )
    assert.equal(
      useSecureCookies(loadConfig({ ...base, BETTER_AUTH_URL: 'https://hazirlik.kampus.example' })),
      true,
    )
    assert.equal(useSecureCookies(loadConfig({ ...base, NODE_ENV: 'test' })), false)
    assert.equal(useSecureCookies(loadConfig(base)), false)
  })

  test('geliştirme kolaylıkları yalnız development ve test ortamında açılır', () => {
    assert.equal(isDevelopmentLike(loadConfig(base)), true)
    assert.equal(isDevelopmentLike(loadConfig({ ...base, NODE_ENV: 'test' })), true)
    assert.equal(isDevelopmentLike(loadConfig(production)), false)
  })

  test('TRUST_PROXY hop sayısı veya vekil IP/CIDR listesi kabul eder, true reddedilir', () => {
    const trust = (value: string) => loadConfig({ ...base, TRUST_PROXY: value }).TRUST_PROXY
    assert.equal(trust(''), false)
    assert.equal(trust('false'), false)
    assert.equal(trust('0'), false)
    assert.equal(trust('1'), 1)
    assert.equal(trust('2'), 2)
    assert.deepEqual(trust('10.0.0.0/8, 127.0.0.1'), ['10.0.0.0/8', '127.0.0.1'])
    assert.deepEqual(trust('loopback,fd00::/8'), ['loopback', 'fd00::/8'])
    for (const invalid of ['true', '*', '10.0.0.0/33', '10.0.0.0/8/1', 'vekil.example', '::1/129'])
      assert.throws(() => trust(invalid), /TRUST_PROXY/, invalid)
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
