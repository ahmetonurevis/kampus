// Mobil uygulama (Better Auth Expo istemcisi) tarayıcı `Origin` başlığı göndermez; kökenini
// `expo-origin` başlığıyla bildirir ve sunucudaki `expo()` eklentisi bunu `Origin`e taşır.
// Uygulama şeması `kampus://` her ortamda, Expo Go'nun `exp://` kökeni yalnız geliştirme ve
// testte güvenilirdir.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import {
  buildTestApp,
  createInstitution,
  createTestDatabase,
  nextIp,
  testConfig,
} from './support/app.ts'

const PRODUCTION = {
  NODE_ENV: 'production',
  BETTER_AUTH_URL: 'https://api.kampus.example',
  BETTER_AUTH_SECRET: 'b4Jx9-uretim-icin-uretilmis-rastgele-deger-Qm2',
  FIELD_ENCRYPTION_KEY: 'x/Ze81RFCnuwFDAaKuVS9QlX60f17joBtM9H4nyNDso=',
  STORAGE_DIR: '/srv/kampus/storage',
}

describe('mobil uygulama kökeni', () => {
  let db: Database
  let close: () => Promise<void>

  before(async () => {
    ;({ db, close } = await createTestDatabase())
  })
  after(async () => {
    await close()
  })

  async function withApp(overrides: Record<string, string>, run: (app: App) => Promise<void>) {
    const app = await buildTestApp(db, { config: testConfig(overrides) })
    try {
      await run(app)
    } finally {
      await app.close()
    }
  }

  /** Expo istemcisinin girişi: `Origin` yok, köken `expo-origin` başlığında. */
  async function nativeSignIn(app: App, expoOrigin: string) {
    const institution = await createInstitution(app)
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in/email',
      headers: { 'expo-origin': expoOrigin, 'content-type': 'application/json' },
      remoteAddress: nextIp(),
      payload: { email: institution.admin.email, password: institution.admin.password },
    })
  }

  for (const [name, overrides] of [
    ['geliştirmede', { NODE_ENV: 'development' }],
    ['üretimde', PRODUCTION],
  ] as const) {
    test(`${name} kampus:// kökenli giriş kabul edilir ve oturum çerezi döner`, async () => {
      await withApp(overrides, async (app) => {
        const response = await nativeSignIn(app, 'kampus://')
        assert.equal(response.statusCode, 200)
        assert.ok(response.cookies.some((item) => item.name.endsWith('kampus.session_token')))
      })
    })
  }

  test('geliştirmede Expo Go exp:// kökeni kabul edilir', async () => {
    await withApp({ NODE_ENV: 'development' }, async (app) => {
      const response = await nativeSignIn(app, 'exp://192.168.1.20:8081')
      assert.equal(response.statusCode, 200)
    })
  })

  test('üretimde exp:// kökeni reddedilir, oturum açılmaz', async () => {
    await withApp(PRODUCTION, async (app) => {
      const response = await nativeSignIn(app, 'exp://192.168.1.20:8081')
      assert.equal(response.statusCode, 403)
      assert.equal(response.json().message, 'İstek güvenilmeyen bir kaynaktan geldi.')
      assert.equal(
        response.cookies.some((item) => item.name.endsWith('kampus.session_token')),
        false,
      )
    })
  })

  test('her ortamda bilinmeyen uygulama şeması reddedilir', async () => {
    await withApp({ NODE_ENV: 'development' }, async (app) => {
      const response = await nativeSignIn(app, 'baskauygulama://')
      assert.equal(response.statusCode, 403)
    })
  })
})
