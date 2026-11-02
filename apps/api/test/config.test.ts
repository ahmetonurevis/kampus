import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  DEFAULT_STORAGE_DIR,
  DISK_STORAGE_IN_PRODUCTION_MESSAGE,
  fileScannerDriver,
  isDevelopmentLike,
  loadConfig,
  parseConfig,
  storageDir,
  useSecureCookies,
} from '../src/config.ts'
import { mailDriver } from '../src/services/mailer.ts'

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

  test('OG-262: ffmpeg ve ffprobe yolu ortamdan gelir; boş ya da verilmemişse PATH adı', () => {
    const fallback = parseConfig({ ...base, FFMPEG_PATH: '' })
    assert.equal(fallback.FFMPEG_PATH, 'ffmpeg')
    assert.equal(fallback.FFPROBE_PATH, 'ffprobe')
    const given = parseConfig({
      ...base,
      FFMPEG_PATH: '/opt/homebrew/bin/ffmpeg',
      FFPROBE_PATH: '/opt/homebrew/bin/ffprobe',
    })
    assert.equal(given.FFMPEG_PATH, '/opt/homebrew/bin/ffmpeg')
    assert.equal(given.FFPROBE_PATH, '/opt/homebrew/bin/ffprobe')
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
    assert.equal(parseConfig(production).BETTER_AUTH_SECRET, production.BETTER_AUTH_SECRET)
    for (const secret of [
      'CHANGE_ME-openssl-rand-base64-32-ile-uretin',
      'change_me_ama_kucuk_harfle_yazilmis_deger',
      'degistir-en-az-32-karakter-rastgele-deger',
      'test-secret-test-secret-test-secret-0123',
    ]) {
      assert.throws(
        () => parseConfig({ ...production, BETTER_AUTH_SECRET: secret }),
        (error: Error) =>
          error.message.includes('BETTER_AUTH_SECRET') && !error.message.includes(secret),
        secret,
      )
      // Geliştirmede örnek dosyadaki değer çalışır.
      assert.equal(loadConfig({ ...base, BETTER_AUTH_SECRET: secret }).BETTER_AUTH_SECRET, secret)
    }
  })

  test('Secure çerez üretimde ve https dış adreste her zaman açıktır', () => {
    assert.equal(useSecureCookies(parseConfig(production)), true)
    assert.equal(
      useSecureCookies(parseConfig({ ...production, BETTER_AUTH_URL: 'http://api.ic' })),
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
    assert.equal(isDevelopmentLike(parseConfig(production)), false)
  })

  test('MAIL_DRIVER ortama göre varsayılanlanır; üretimde log ve memory reddedilir', () => {
    assert.equal(mailDriver(loadConfig(base)), 'log')
    assert.equal(mailDriver(loadConfig({ ...base, NODE_ENV: 'test' })), 'memory')
    assert.equal(mailDriver(parseConfig(production)), 'none')
    assert.equal(mailDriver(loadConfig({ ...base, MAIL_DRIVER: 'none' })), 'none')
    assert.equal(mailDriver(parseConfig({ ...production, MAIL_DRIVER: 'none' })), 'none')
    for (const driver of ['log', 'memory'])
      assert.throws(
        () => parseConfig({ ...production, MAIL_DRIVER: driver }),
        /MAIL_DRIVER/,
        driver,
      )
    assert.throws(() => parseConfig({ ...base, MAIL_DRIVER: 'smtp' }), /MAIL_DRIVER/)
  })

  test('OG-092, ADR 0003 karar 8: FILE_SCANNER üretimde clamav, başka ortamda off varsayılır; üretimde clamav dışı reddedilir', () => {
    assert.equal(fileScannerDriver(loadConfig(base)), 'off')
    assert.equal(fileScannerDriver(loadConfig({ ...base, NODE_ENV: 'test' })), 'off')
    assert.equal(fileScannerDriver(parseConfig(production)), 'clamav')
    assert.equal(fileScannerDriver(loadConfig({ ...base, FILE_SCANNER: 'clamav' })), 'clamav')
    assert.equal(
      fileScannerDriver(parseConfig({ ...production, FILE_SCANNER: 'clamav' })),
      'clamav',
    )
    assert.throws(() => parseConfig({ ...production, FILE_SCANNER: 'off' }), /FILE_SCANNER/)
    for (const driver of ['fake', 'none', 'clamdscan'])
      assert.throws(() => parseConfig({ ...base, FILE_SCANNER: driver }), /FILE_SCANNER/, driver)
    const defaults = loadConfig(base)
    assert.equal(defaults.CLAMAV_HOST, '127.0.0.1')
    assert.equal(defaults.CLAMAV_PORT, 3310)
    assert.equal(defaults.CLAMAV_TIMEOUT_MS, 120_000)
    // `.env.example`'taki boş değer varsayılana düşer.
    const blank = loadConfig({ ...base, FILE_SCANNER: '', CLAMAV_PORT: '', CLAMAV_TIMEOUT_MS: '' })
    assert.deepEqual(
      [fileScannerDriver(blank), blank.CLAMAV_PORT, blank.CLAMAV_TIMEOUT_MS],
      ['off', 3310, 120_000],
    )
    const custom = loadConfig({
      ...base,
      CLAMAV_HOST: 'clamav',
      CLAMAV_PORT: '3311',
      CLAMAV_TIMEOUT_MS: '30000',
    })
    assert.deepEqual(
      [custom.CLAMAV_HOST, custom.CLAMAV_PORT, custom.CLAMAV_TIMEOUT_MS],
      ['clamav', 3311, 30_000],
    )
    assert.throws(() => loadConfig({ ...base, CLAMAV_PORT: '0' }), /CLAMAV_PORT/)
    assert.throws(() => loadConfig({ ...base, CLAMAV_TIMEOUT_MS: '10' }), /CLAMAV_TIMEOUT_MS/)
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

  test('ADR 0003 karar 1: disk sürücüsü üretimde açık bir hatayla başlangıçta reddedilir; STORAGE_DIR üretimde zorunlu değil', () => {
    // Şema üretimde STORAGE_DIR istemez; disk sürücüsü üretimde hiç kullanılmaz.
    assert.equal(parseConfig(production).STORAGE_DRIVER, 'disk')
    assert.equal(parseConfig(production).STORAGE_DIR, undefined)
    for (const env of [production, { ...production, STORAGE_DIR: '/srv/kampus/storage' }])
      assert.throws(
        () => loadConfig(env),
        (error: Error) =>
          error.message === DISK_STORAGE_IN_PRODUCTION_MESSAGE &&
          error.message.includes('STORAGE_DRIVER=disk') &&
          error.message.includes('ADR 0003'),
      )
    assert.throws(() => parseConfig({ ...production, STORAGE_DRIVER: 's3' }), /STORAGE_DRIVER/)
  })

  test('ADR 0003: geliştirme ve testte disk sürücüsü varsayılan klasörle çalışır', () => {
    const development = loadConfig(base)
    assert.equal(development.STORAGE_DRIVER, 'disk')
    assert.equal(storageDir(development), DEFAULT_STORAGE_DIR)
    const testing = loadConfig({ ...base, NODE_ENV: 'test', STORAGE_DIR: '/tmp/kampus-depo' })
    assert.equal(storageDir(testing), '/tmp/kampus-depo')
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
