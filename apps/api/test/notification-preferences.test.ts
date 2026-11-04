import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { notificationPreferences } from '../src/db/schema/notification-preferences.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * Bildirim tercihi ve sessiz saat uçları (OG-107; docs/domain/iletisim-ve-veli.md DOM-ILT-020,
 * -021). Kimlik oturumdandır; kayıt kullanıcı ve kurum çiftine bağlıdır.
 */

type Json = ReturnType<typeof JSON.parse>
const URL_ = '/api/v1/notification-preferences'

describe('bildirim tercihi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function tenant(overrides: Partial<InstitutionOverrides> = {}) {
    const institution = await createInstitution(app, overrides)
    const parentUser = await createMember(app, institution.id, 'veli', [
      { kind: 'child', recordId: 's-1' } as never,
    ])
    return {
      institution,
      admin: await signInAs(app, institution.admin),
      parent: await signInAs(app, parentUser),
      parentUserId: parentUser.id,
    }
  }

  function call(method: 'GET' | 'PATCH', cookie?: string, payload?: unknown) {
    return app.inject({
      method,
      url: URL_,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie ? { cookie } : {}),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const rows = (institutionId: string) =>
    db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.institutionId, institutionId))

  test('kimliksiz istek 401', async () => {
    assert.equal((await call('GET')).statusCode, 401)
    assert.equal((await call('PATCH', undefined, { version: 1 })).statusCode, 401)
  })

  test('DOM-YTK-040: iletişim modülü kapalıyken uçlar 403 module_disabled', async () => {
    const { institution, parent } = await tenant({ enabledModules: { communication: false } })
    for (const response of [
      await call('GET', parent),
      await call('PATCH', parent, { version: 1 }),
    ]) {
      assert.equal(response.statusCode, 403)
      assert.equal(response.json().code, 'module_disabled')
    }
    assert.deepEqual(await rows(institution.id), [])
  })

  test('DOM-ILT-021: kayıt yoksa varsayılan ve sürüm 1 döner', async () => {
    const { parent, institution } = await tenant()
    const body = (await call('GET', parent)).json() as Json
    assert.equal(body.data.version, 1)
    assert.deepEqual(body.data.preferences.quietHours, {
      enabled: true,
      start: '21:00',
      end: '08:00',
    })
    assert.deepEqual(body.data.preferences.topics.attendance, ['in_app', 'push'])
    assert.deepEqual(await rows(institution.id), [])
  })

  test('DOM-ILT-020: güncelleme kalıcıdır, sürüm artar, konular birleştirilir', async () => {
    const { parent, institution } = await tenant()
    const response = await call('PATCH', parent, {
      version: 1,
      topics: { grade: ['in_app', 'email'], attendance: ['in_app', 'push', 'sms'] },
      quietHours: { enabled: true, start: '22:30', end: '07:00' },
    })
    assert.equal(response.statusCode, 200, response.body)
    const saved = response.json() as Json
    assert.equal(saved.data.version, 2)
    assert.deepEqual(saved.data.preferences.topics.grade, ['in_app', 'email'])
    assert.deepEqual(saved.data.preferences.topics.payment, ['in_app', 'push'])
    const again = (await call('GET', parent)).json() as Json
    assert.deepEqual(again.data, saved.data)
    assert.equal((await rows(institution.id)).length, 1)
    // İkinci güncelleme önceki alanları korur.
    const second = (
      await call('PATCH', parent, { version: 2, topics: { bulletin: ['in_app', 'sms'] } })
    ).json() as Json
    assert.equal(second.data.version, 3)
    assert.deepEqual(second.data.preferences.topics.grade, ['in_app', 'email'])
    assert.equal(second.data.preferences.quietHours.start, '22:30')
  })

  test('DOM-ILT-020: veli çocuğa göre tercih ayırır; veli dışı rol çocuk kırılımı veremez', async () => {
    const { parent, admin } = await tenant()
    const ok = await call('PATCH', parent, {
      version: 1,
      children: { 's-1': { grade: ['in_app', 'sms'] } },
    })
    assert.equal(ok.statusCode, 200, ok.body)
    assert.deepEqual(ok.json().data.preferences.children, { 's-1': { grade: ['in_app', 'sms'] } })
    const denied = await call('PATCH', admin, { version: 1, children: { 's-1': {} } })
    assert.equal(denied.statusCode, 422)
    assert.equal(denied.json().code, 'notification_children_parent_only')
  })

  test('400: geçersiz gövde kaydı değiştirmez', async () => {
    const { parent, institution } = await tenant()
    for (const payload of [
      {},
      { version: 0 },
      { version: 1, topics: { yok: ['in_app'] } },
      { version: 1, topics: { grade: ['fax'] } },
      { version: 1, quietHours: { enabled: true, start: '25:00', end: '08:00' } },
      { version: 1, bilinmeyen: true },
    ]) {
      const response = await call('PATCH', parent, payload)
      assert.equal(response.statusCode, 400, JSON.stringify(payload))
    }
    assert.deepEqual(await rows(institution.id), [])
  })

  test('DOM-ILT-020: zorunlu konuda anlık bildirim kapatılamaz, 422 ve kayıt değişmez', async () => {
    const { parent, institution } = await tenant()
    const response = await call('PATCH', parent, { version: 1, topics: { attendance: ['in_app'] } })
    assert.equal(response.statusCode, 422)
    assert.equal(response.json().code, 'notification_channel_required')
    const noInApp = await call('PATCH', parent, { version: 1, topics: { grade: ['push'] } })
    assert.equal(noInApp.statusCode, 422)
    assert.deepEqual(await rows(institution.id), [])
  })

  test('DOM-ILT-021: başlangıç ve bitişi aynı sessiz saat 422', async () => {
    const { parent, institution } = await tenant()
    const response = await call('PATCH', parent, {
      version: 1,
      quietHours: { enabled: true, start: '10:00', end: '10:00' },
    })
    assert.equal(response.statusCode, 422)
    assert.equal(response.json().code, 'quiet_hours_invalid')
    assert.deepEqual(await rows(institution.id), [])
  })

  test('409: eski sürüm reddedilir ve kayıt değişmez', async () => {
    const { parent, institution } = await tenant()
    await call('PATCH', parent, { version: 1, topics: { grade: ['in_app', 'sms'] } })
    const before = await rows(institution.id)
    const stale = await call('PATCH', parent, { version: 1, topics: { grade: ['in_app'] } })
    assert.equal(stale.statusCode, 409)
    assert.equal(stale.json().code, 'version_conflict')
    assert.deepEqual(await rows(institution.id), before)
    const future = await call('PATCH', parent, { version: 7, topics: { grade: ['in_app'] } })
    assert.equal(future.statusCode, 409)
  })

  test('başka kurum ve başka kullanıcı: tercih kullanıcı ve kurum çiftine bağlıdır', async () => {
    const a = await tenant()
    const b = await tenant()
    await call('PATCH', a.parent, { version: 1, topics: { grade: ['in_app', 'sms'] } })
    // Aynı kurumda başka kullanıcı (yönetici) varsayılanı görür.
    const adminView = (await call('GET', a.admin)).json() as Json
    assert.deepEqual(adminView.data.preferences.topics.grade, ['in_app', 'push'])
    assert.equal(adminView.data.version, 1)
    // Başka kurum etkilenmez.
    const otherView = (await call('GET', b.parent)).json() as Json
    assert.equal(otherView.data.version, 1)
    assert.deepEqual(await rows(b.institution.id), [])
    // Gövdedeki kurum/kullanıcı kimliği etkisizdir (şema bilinmeyen alanı reddeder).
    const spoof = await call('PATCH', b.parent, {
      version: 1,
      institutionId: a.institution.id,
      userId: a.parentUserId,
    })
    assert.equal(spoof.statusCode, 400)
    const stored = await rows(a.institution.id)
    assert.equal(stored.length, 1)
    assert.equal(stored[0]?.userId, a.parentUserId)
  })
})
