import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { SESSION_FRESH_AGE_SECONDS } from '../src/auth.ts'
import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { buildTestApp, createInstitution, createTestDatabase, signInAs } from './support/app.ts'

/**
 * Taze oturum (guvenlik-kvkk.md §3): `preHandler: [app.authenticate, app.requireFreshSession]`
 * taşıyan uç oturum `freshAge`'den eskiyse 403 `reauthentication_required` döndürür. Bu dosya
 * kayıt/finans uçlarından bağımsız, teste özgü bir yoklama ucuyla ön işleyiciyi doğrular.
 */

const PROBE = '/api/v1/test/taze-oturum'
const SECOND = 1000

describe('taze oturum', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  /** Saat, oturumun açıldığı andan bu kadar ileridedir (Better Auth oturum zamanı gerçek saattir). */
  let offsetSeconds = 0

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, {
      clock: () => new Date(Date.now() + offsetSeconds * SECOND),
      extend: (instance) => {
        instance.get(
          PROBE,
          { preHandler: [instance.authenticate, instance.requireFreshSession] },
          async () => ({ ok: true }),
        )
      },
    })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function adminCookie() {
    const created = await createInstitution(app)
    return signInAs(app, created.admin)
  }
  const probe = (cookie?: string) =>
    app.inject({ method: 'GET', url: PROBE, ...(cookie ? { headers: { cookie } } : {}) })

  test('guvenlik-kvkk: taze oturum uca geçer', async () => {
    const cookie = await adminCookie()
    offsetSeconds = 0
    const response = await probe(cookie)
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(response.json(), { ok: true })
  })

  test('guvenlik-kvkk: sınırın içindeki oturum geçer, sınırı aşan 403 reauthentication_required', async () => {
    const cookie = await adminCookie()
    offsetSeconds = SESSION_FRESH_AGE_SECONDS - 60
    assert.equal((await probe(cookie)).statusCode, 200)

    offsetSeconds = SESSION_FRESH_AGE_SECONDS + 60
    const stale = await probe(cookie)
    assert.equal(stale.statusCode, 403, stale.body)
    assert.equal(stale.json().code, 'reauthentication_required')
    offsetSeconds = 0
  })

  test('guvenlik-kvkk: yeniden giriş yeni oturum açar ve uç yeniden geçer', async () => {
    const created = await createInstitution(app)
    const oldCookie = await signInAs(app, created.admin)
    offsetSeconds = SESSION_FRESH_AGE_SECONDS + 60
    assert.equal((await probe(oldCookie)).statusCode, 403)

    // Yeniden giriş gerçek saatle yeni oturum açar; sahte saat ilerideyken de taze sayılması için
    // saat yeni oturumdan itibaren ölçülür.
    offsetSeconds = 0
    const freshCookie = await signInAs(app, created.admin)
    assert.equal((await probe(freshCookie)).statusCode, 200)
  })

  test('guvenlik-kvkk: oturumsuz istek 401', async () => {
    offsetSeconds = 0
    assert.equal((await probe()).statusCode, 401)
  })
})
