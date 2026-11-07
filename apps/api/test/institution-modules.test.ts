import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { moduleAvailableFor, modulesFor } from '@kampus/school-core/modules/collection-modules.ts'

import type { App } from '../src/app.ts'
import { ROLES, type Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { institutions } from '../src/db/schema/auth.ts'
import { institutionSettings } from '../src/db/schema/institution-settings.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type TestInstitution,
} from './support/app.ts'

interface Session {
  institution: TestInstitution
  cookie: string
}

describe('Kurum modül ayarı (DOM-YTK-040, DOM-YTK-042)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function admin(overrides: Parameters<typeof createInstitution>[1] = {}): Promise<Session> {
    const institution = await createInstitution(app, overrides)
    return { institution, cookie: await signInAs(app, institution.admin) }
  }

  async function memberCookie(institutionId: string, role: Role): Promise<string> {
    return signInAs(app, await createMember(app, institutionId, role))
  }

  function call(
    method: 'GET' | 'PATCH',
    url: string,
    cookie: string | null,
    options: { body?: unknown; ifMatch?: number | string | null; key?: string | null } = {},
  ) {
    const headers: Record<string, string> = { origin: TEST_ORIGIN }
    if (cookie !== null) headers.cookie = cookie
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    if (options.ifMatch !== null && options.ifMatch !== undefined)
      headers['if-match'] = `"${options.ifMatch}"`
    if (options.key !== null && options.key !== undefined) headers['idempotency-key'] = options.key
    return app.inject({
      method,
      url,
      headers,
      ...(options.body === undefined ? {} : { payload: JSON.stringify(options.body) }),
    })
  }

  const key = () => randomUUID()

  async function settings(cookie: string) {
    const response = await call('GET', '/api/v1/modules', cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json<{
      data: { version: number; modules: { key: string; enabled: boolean }[] }
    }>().data
  }

  function toggle(
    session: Session,
    moduleKey: string,
    enabled: boolean,
    version: number,
    extra: { key?: string | null; body?: Record<string, unknown> } = {},
  ) {
    return call('PATCH', `/api/v1/modules/${moduleKey}`, session.cookie, {
      body: { enabled, ...extra.body },
      ifMatch: version,
      key: extra.key === undefined ? key() : extra.key,
    })
  }

  async function stored(institutionId: string) {
    const [row] = await db
      .select({ modules: institutions.enabledModules, version: institutionSettings.version })
      .from(institutions)
      .innerJoin(institutionSettings, eq(institutionSettings.institutionId, institutions.id))
      .where(eq(institutions.id, institutionId))
    assert.ok(row)
    return row
  }

  async function audits(institutionId: string) {
    return db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, 'module.set')))
  }

  describe('GET /modules', () => {
    test('kimliksiz istek 401 alır', async () => {
      assert.equal((await call('GET', '/api/v1/modules', null)).statusCode, 401)
    })

    test('yönetici olmayan her rol 403 alır', async () => {
      const { institution } = await admin()
      for (const role of ROLES.filter((item) => item !== 'yonetici')) {
        const response = await call(
          'GET',
          '/api/v1/modules',
          await memberCookie(institution.id, role),
        )
        assert.equal(response.statusCode, 403, role)
        assert.equal(response.json<{ code: string }>().code, 'forbidden')
      }
    })

    test('kurum türünde bulunan modülleri sürümle listeler', async () => {
      const school = await admin()
      const language = await admin({ type: 'language_school' })
      const schoolSettings = await settings(school.cookie)
      const languageSettings = await settings(language.cookie)
      assert.equal(schoolSettings.version, 1)
      assert.deepEqual(
        schoolSettings.modules.map((item) => item.key),
        modulesFor('school'),
      )
      assert.deepEqual(
        languageSettings.modules.map((item) => item.key),
        modulesFor('language_school'),
      )
      assert.ok(!languageSettings.modules.some((item) => item.key === 'goals'))
      assert.ok(schoolSettings.modules.every((item) => item.enabled))
    })

    test('ayar satırı olmayan kurum 404 alır', async () => {
      const { cookie } = await admin({ academicYear: null })
      assert.equal((await call('GET', '/api/v1/modules', cookie)).statusCode, 404)
    })
  })

  describe('PATCH /modules/:moduleKey', () => {
    test('kimliksiz istek 401 alır', async () => {
      const response = await call('PATCH', '/api/v1/modules/meals', null, {
        body: { enabled: false },
        ifMatch: 1,
        key: key(),
      })
      assert.equal(response.statusCode, 401)
    })

    test('yönetici olmayan her rol 403 alır ve kayıt değişmez', async () => {
      const { institution } = await admin()
      const before = await stored(institution.id)
      for (const role of ROLES.filter((item) => item !== 'yonetici')) {
        const cookie = await memberCookie(institution.id, role)
        const response = await call('PATCH', '/api/v1/modules/meals', cookie, {
          body: { enabled: false },
          ifMatch: 1,
          key: key(),
        })
        assert.equal(response.statusCode, 403, role)
        assert.equal(response.json<{ code: string }>().code, 'forbidden')
      }
      assert.deepEqual(await stored(institution.id), before)
      assert.equal((await audits(institution.id)).length, 0)
    })

    test('modülü kapatır; sürüm artar, kalıcıdır ve denetim kaydı alan adı yazar', async () => {
      const session = await admin()
      const response = await toggle(session, 'meals', false, 1)
      assert.equal(response.statusCode, 200, response.body)
      const { data } = response.json<{
        data: {
          moduleKey: string
          enabled: boolean
          enabledModules: Record<string, boolean>
          version: number
        }
      }>()
      assert.equal(data.moduleKey, 'meals')
      assert.equal(data.enabled, false)
      assert.equal(data.version, 2)
      assert.equal(data.enabledModules.meals, false)
      assert.equal(data.enabledModules.clubs, true)

      const row = await stored(session.institution.id)
      assert.equal(row.version, 2)
      assert.equal((row.modules as Record<string, boolean>).meals, false)

      const current = await settings(session.cookie)
      assert.equal(current.version, 2)
      assert.equal(current.modules.find((item) => item.key === 'meals')?.enabled, false)

      const me = await call('GET', '/api/v1/me', session.cookie)
      assert.equal(
        me.json<{ data: { activeInstitution: { enabledModules: Record<string, boolean> } } }>().data
          .activeInstitution.enabledModules.meals,
        false,
      )

      const [entry, ...rest] = await audits(session.institution.id)
      assert.equal(rest.length, 0)
      assert.ok(entry)
      assert.equal(entry.actorUserId, session.institution.admin.id)
      assert.equal(entry.actorRole, 'yonetici')
      assert.equal(entry.entityType, 'module')
      assert.equal(entry.entityId, 'meals')
      assert.deepEqual(entry.changes, { fields: ['enabledModules'] })
    })

    test('kapalı modülün koleksiyon ve komut uçları 403 module_disabled; açılınca geri gelir', async () => {
      const session = await admin()
      const { id } = session.institution
      const menu = { id: 'test-menu-1', date: '2026-10-07', items: ['Çorba'] }
      await insertMissingRecords(
        db,
        id,
        [{ collection: 'mealMenus', id: menu.id, data: menu }],
        FIXED_NOW,
      )
      const read = () => call('GET', '/api/v1/collections/mealMenus', session.cookie)
      const command = () =>
        app.inject({
          method: 'POST',
          url: '/api/v1/workflows/meal',
          headers: {
            origin: TEST_ORIGIN,
            cookie: session.cookie,
            'content-type': 'application/json',
            'idempotency-key': key(),
          },
          payload: JSON.stringify({}),
        })

      assert.equal((await read()).statusCode, 200)
      assert.notEqual((await command()).statusCode, 403)

      assert.equal((await toggle(session, 'meals', false, 1)).statusCode, 200)
      for (const response of [await read(), await command()]) {
        assert.equal(response.statusCode, 403)
        assert.equal(response.json<{ code: string }>().code, 'module_disabled')
      }
      // Veri silinmedi.
      assert.ok(await findRecord(db, id, 'mealMenus', menu.id))

      assert.equal((await toggle(session, 'meals', true, 2)).statusCode, 200)
      const reopened = await read()
      assert.equal(reopened.statusCode, 200)
      assert.deepEqual(
        reopened.json<{ data: { id: string }[] }>().data.map((item) => item.id),
        [menu.id],
      )
      assert.notEqual((await command()).statusCode, 403)
    })

    test('etüt modülü kapanınca gelecek rezervasyon kaybolmaz, açılınca görünür', async () => {
      const session = await admin()
      const { id } = session.institution
      const reservation = {
        id: 'test-tutor-1',
        teacherId: 't1',
        date: '2026-12-01T10:00',
        duration: 60,
        room: 'A-1',
        status: 'Planlandı',
        studentIds: [],
      }
      await insertMissingRecords(
        db,
        id,
        [{ collection: 'tutorSessions', id: reservation.id, data: reservation }],
        FIXED_NOW,
      )
      const read = () => call('GET', '/api/v1/collections/tutorSessions', session.cookie)
      assert.equal((await toggle(session, 'tutoring', false, 1)).statusCode, 200)
      const closed = await read()
      assert.equal(closed.statusCode, 403)
      assert.equal(closed.json<{ code: string }>().code, 'module_disabled')
      const rows = await loadRecords(db, id, ['tutorSessions'])
      assert.deepEqual(
        rows.map((row) => row.id),
        [reservation.id],
      )
      assert.equal(rows[0]?.archivedAt ?? null, null)

      assert.equal((await toggle(session, 'tutoring', true, 2)).statusCode, 200)
      const reopened = await read()
      assert.equal(reopened.statusCode, 200)
      assert.deepEqual(
        reopened.json<{ data: { id: string }[] }>().data.map((item) => item.id),
        [reservation.id],
      )
    })

    test('gövdedeki institutionId etkisizdir; başka kurum değişmez', async () => {
      const a = await admin()
      const b = await admin()
      const beforeB = await stored(b.institution.id)
      const response = await toggle(a, 'meals', false, 1, {
        body: { institutionId: b.institution.id },
      })
      assert.equal(response.statusCode, 200, response.body)
      assert.equal((await stored(a.institution.id)).version, 2)
      assert.deepEqual(await stored(b.institution.id), beforeB)
      assert.equal((await audits(b.institution.id)).length, 0)
      // B'nin yöneticisi A'nın kapattığı modülü kendi kurumunda açık görür.
      const seenByB = await settings(b.cookie)
      assert.equal(seenByB.modules.find((item) => item.key === 'meals')?.enabled, true)
    })

    test('If-Match yoksa 400, geçersizse 400, eskiyse 409; kayıt değişmez', async () => {
      const session = await admin()
      const { id } = session.institution
      const before = await stored(id)
      const missing = await call('PATCH', '/api/v1/modules/meals', session.cookie, {
        body: { enabled: false },
        key: key(),
      })
      assert.equal(missing.statusCode, 400)
      assert.equal(missing.json<{ code: string }>().code, 'if_match_required')
      const malformed = await call('PATCH', '/api/v1/modules/meals', session.cookie, {
        body: { enabled: false },
        ifMatch: 'abc',
        key: key(),
      })
      assert.equal(malformed.statusCode, 400)

      assert.equal((await toggle(session, 'meals', false, 1)).statusCode, 200)
      const stale = await toggle(session, 'clubs', false, 1)
      assert.equal(stale.statusCode, 409)
      assert.equal(stale.json<{ code: string }>().code, 'version_conflict')
      const row = await stored(id)
      assert.equal(row.version, 2)
      assert.equal((row.modules as Record<string, boolean>).clubs, undefined)
      assert.notDeepEqual(row, before)
    })

    test('Idempotency-Key zorunludur; aynı istek tekrarlanır, farklı istek 422', async () => {
      const session = await admin()
      const { id } = session.institution
      const missing = await toggle(session, 'meals', false, 1, { key: null })
      assert.equal(missing.statusCode, 400)
      assert.equal(missing.json<{ code: string }>().code, 'idempotency_key_required')
      assert.equal((await stored(id)).version, 1)

      const shared = key()
      const first = await toggle(session, 'meals', false, 1, { key: shared })
      const replay = await toggle(session, 'meals', false, 1, { key: shared })
      assert.equal(first.statusCode, 200)
      assert.equal(replay.statusCode, 200)
      assert.equal(replay.headers['idempotent-replayed'], 'true')
      assert.deepEqual(replay.json(), first.json())
      assert.equal((await stored(id)).version, 2)
      assert.equal((await audits(id)).length, 1)

      const reused = await toggle(session, 'clubs', false, 1, { key: shared })
      assert.equal(reused.statusCode, 422)
      assert.equal(reused.json<{ code: string }>().code, 'idempotency_key_reused')
      assert.equal((await stored(id)).version, 2)
    })

    test('kurum türünde olmayan modül 422; açık-kapalı fark etmez, kayıt değişmez', async () => {
      const session = await admin({ type: 'language_school' })
      assert.ok(!moduleAvailableFor('goals', 'language_school'))
      const before = await stored(session.institution.id)
      for (const enabled of [true, false]) {
        const response = await toggle(session, 'goals', enabled, 1)
        assert.equal(response.statusCode, 422, response.body)
        assert.equal(response.json<{ code: string }>().code, 'module_unavailable_for_type')
      }
      assert.deepEqual(await stored(session.institution.id), before)
      assert.equal((await audits(session.institution.id)).length, 0)
    })

    test('bilinmeyen modül 404, geçersiz gövde 400; kayıt değişmez', async () => {
      const session = await admin()
      const before = await stored(session.institution.id)
      assert.equal((await toggle(session, 'olmayan', false, 1)).statusCode, 404)
      const invalid = await call('PATCH', '/api/v1/modules/meals', session.cookie, {
        body: { enabled: 'evet' },
        ifMatch: 1,
        key: key(),
      })
      assert.equal(invalid.statusCode, 400)
      assert.equal(invalid.json<{ code: string }>().code, 'validation_failed')
      assert.deepEqual(await stored(session.institution.id), before)
    })

    test('durum değişmiyorsa 409 module_unchanged; sürüm ve denetim değişmez', async () => {
      const session = await admin()
      const open = await toggle(session, 'meals', true, 1)
      assert.equal(open.statusCode, 409)
      assert.equal(open.json<{ code: string }>().code, 'module_unchanged')

      assert.equal((await toggle(session, 'meals', false, 1)).statusCode, 200)
      const again = await toggle(session, 'meals', false, 2)
      assert.equal(again.statusCode, 409)
      assert.equal(again.json<{ code: string }>().code, 'module_unchanged')
      assert.equal((await stored(session.institution.id)).version, 2)
      assert.equal((await audits(session.institution.id)).length, 1)
    })

    test('ayar satırı olmayan kurumda 404 döner ve hiçbir şey yazılmaz', async () => {
      const session = await admin({ academicYear: null })
      const response = await toggle(session, 'meals', false, 1)
      assert.equal(response.statusCode, 404)
      assert.equal((await audits(session.institution.id)).length, 0)
    })
  })
})
