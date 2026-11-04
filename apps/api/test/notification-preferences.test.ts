import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { notificationPreferences } from '../src/db/schema/notification-preferences.ts'
import { studentGuardians } from '../src/db/schema/student-guardians.ts'
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
      membershipId: parentUser.membershipId,
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

  test('eksik konulu ve bozuk jsonb satırı varsayılanla okunur ve güncellenir', async () => {
    const { parent, institution, parentUserId } = await tenant()
    const defaults = (await call('GET', parent)).json().data.preferences as Json
    const missing = Object.fromEntries(
      Object.entries(defaults.topics).filter(([topic]) => topic !== 'grade'),
    )
    await db.insert(notificationPreferences).values({
      institutionId: institution.id,
      userId: parentUserId,
      preferences: { ...defaults, topics: missing },
      version: 4,
    })
    const read = (await call('GET', parent)).json() as Json
    assert.equal(read.data.version, 4)
    assert.deepEqual(read.data.preferences.topics.grade, ['in_app', 'push'])
    const patched = await call('PATCH', parent, { version: 4, topics: { payment: ['in_app'] } })
    assert.equal(patched.statusCode, 200, patched.body)
    assert.deepEqual(patched.json().data.preferences.topics.grade, ['in_app', 'push'])

    await db
      .update(notificationPreferences)
      .set({ preferences: { topics: 'bozuk', quietHours: 7 } as never, version: 9 })
      .where(eq(notificationPreferences.institutionId, institution.id))
    const broken = (await call('GET', parent)).json() as Json
    assert.equal(broken.data.version, 9)
    assert.deepEqual(broken.data.preferences, defaults)
    const fixed = await call('PATCH', parent, { version: 9, topics: { grade: ['in_app', 'sms'] } })
    assert.equal(fixed.statusCode, 200, fixed.body)
    assert.equal(fixed.json().data.version, 10)
  })

  test('DOM-ILT-020: bağlı olmayan çocuk 404 ve kayıt değişmez; bağı kalkan anahtar görünmez', async () => {
    const { parent, institution, membershipId } = await tenant()
    const denied = await call('PATCH', parent, {
      version: 1,
      children: { 's-1': { grade: ['in_app', 'sms'] }, 'baskasinin-cocugu': {} },
    })
    assert.equal(denied.statusCode, 404)
    assert.equal(denied.json().code, 'not_found')
    assert.deepEqual(await rows(institution.id), [])
    const ok = await call('PATCH', parent, {
      version: 1,
      children: { 's-1': { grade: ['in_app', 'sms'] } },
    })
    assert.equal(ok.statusCode, 200, ok.body)
    await db
      .delete(studentGuardians)
      .where(
        and(
          eq(studentGuardians.institutionId, institution.id),
          eq(studentGuardians.membershipId, membershipId),
        ),
      )
    const after = (await call('GET', parent)).json() as Json
    assert.deepEqual(after.data.preferences.children, {})
  })

  test('409: aynı sürümle iki eşzamanlı güncellemeden yalnız biri yazılır', async () => {
    for (const startVersion of [1, 2]) {
      const { parent, institution } = await tenant()
      if (startVersion === 2)
        await call('PATCH', parent, { version: 1, topics: { grade: ['in_app', 'sms'] } })
      const [a, b] = await Promise.all([
        call('PATCH', parent, { version: startVersion, topics: { bulletin: ['in_app', 'sms'] } }),
        call('PATCH', parent, { version: startVersion, topics: { bulletin: ['in_app', 'email'] } }),
      ])
      assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409])
      assert.equal((await rows(institution.id))[0]?.version, startVersion + 1)
    }
  })

  test('aynı kurumdaki ikinci veli birincinin tercihini okuyamaz ya da yazamaz', async () => {
    const { institution, parent } = await tenant()
    const otherUser = await createMember(app, institution.id, 'veli', [
      { kind: 'child', recordId: 's-2' } as never,
    ])
    const other = await signInAs(app, otherUser)
    await call('PATCH', parent, { version: 1, topics: { grade: ['in_app', 'sms'] } })
    const view = (await call('GET', other)).json() as Json
    assert.equal(view.data.version, 1)
    assert.deepEqual(view.data.preferences.topics.grade, ['in_app', 'push'])
    const written = await call('PATCH', other, {
      version: 1,
      topics: { grade: ['in_app', 'email'] },
    })
    assert.equal(written.statusCode, 200, written.body)
    const mine = (await call('GET', parent)).json() as Json
    assert.deepEqual(mine.data.preferences.topics.grade, ['in_app', 'sms'])
    assert.equal(mine.data.version, 2)
    assert.equal((await rows(institution.id)).length, 2)
  })

  test('DOM-ILT-020: 21 çocuk anahtarı 422 notification_children_limit', async () => {
    const institution = await createInstitution(app)
    const ids = Array.from({ length: 21 }, (_, index) => `c-${index}`)
    const user = await createMember(
      app,
      institution.id,
      'veli',
      ids.map((recordId) => ({ kind: 'child', recordId }) as never),
    )
    const cookie = await signInAs(app, user)
    const response = await call('PATCH', cookie, {
      version: 1,
      children: Object.fromEntries(ids.map((id) => [id, {}])),
    })
    assert.equal(response.statusCode, 422, response.body)
    assert.equal(response.json().code, 'notification_children_limit')
    assert.deepEqual(await rows(institution.id), [])
  })
})
