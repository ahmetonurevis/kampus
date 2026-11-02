import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { moduleAvailableFor } from '@kampus/school-core/modules/collection-modules.ts'
import { navigation } from '@kampus/school-core/modules/full-navigation.ts'
import { schoolModules } from '@kampus/school-core/modules/school-workflows.ts'

import type { App } from '../src/app.ts'
import { ROLES } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { MESSAGES } from '../src/errors.ts'
import { effectiveModules, moduleAllowsRole, MODULE_KEYS } from '../src/services/modules.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  signInAs,
} from './support/app.ts'

/** Teste özgü uçlar: sabit modül ve istekten çözülen modül. */
function registerModuleRoutes(app: App) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const response = { 200: z.object({ data: z.object({ ok: z.boolean() }) }) }
  typed.get(
    '/api/v1/test-guidance',
    {
      preValidation: [app.requireRole(ROLES), app.requireModule('guidance')],
      schema: { hide: true, response },
    },
    async () => ({ data: { ok: true } }),
  )
  typed.get(
    '/api/v1/test-modules/:module',
    {
      preValidation: [
        app.requireRole(ROLES),
        app.requireModule((request) => {
          const { module } = z.object({ module: z.string() }).parse(request.params)
          return module === 'none' ? null : module
        }),
      ],
      schema: { hide: true, params: z.object({ module: z.string() }), response },
    },
    async () => ({ data: { ok: true } }),
  )
}

describe('modül kaydı ve requireModule (DOM-YTK-040)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { extend: registerModuleRoutes })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function get(url: string, cookie?: string) {
    return app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} })
  }

  test('modül anahtarları school-core menü ve iş akışı kaydından gelir', () => {
    for (const module of schoolModules) assert.ok(MODULE_KEYS.includes(module.key), module.key)
    for (const pages of Object.values(navigation))
      for (const page of pages)
        if (page.module !== null) assert.ok(MODULE_KEYS.includes(page.module), page.module)
    assert.deepEqual(
      ['academic', 'communication', 'crm', 'finance', 'learning'].filter(
        (key) => !MODULE_KEYS.includes(key),
      ),
      [],
    )
  })

  test('saklanmayan modül açık, yalnız false kapalı; bilinmeyen anahtar düşer', () => {
    const map = effectiveModules({ guidance: false, bilinmeyen: true }, 'school')
    assert.equal(map.guidance, false)
    assert.equal(map.finance, true)
    assert.equal(map.goals, true)
    assert.equal('bilinmeyen' in map, false)
  })

  test('DOM-YTK-012: kurum türünde olmayan modül saklanan değerden bağımsız kapalıdır', () => {
    const stored = Object.fromEntries(MODULE_KEYS.map((key) => [key, true]))
    const language = effectiveModules(stored, 'language_school')
    const school = effectiveModules(stored, 'school')
    for (const key of MODULE_KEYS) {
      assert.equal(language[key], moduleAvailableFor(key, 'language_school'), key)
      assert.equal(school[key], true, key)
    }
    for (const key of ['optical', 'tutoring', 'guidance', 'exams', 'goals', 'renewal'])
      assert.equal(effectiveModules({}, 'language_school')[key], false, key)
    assert.equal(effectiveModules({}, 'language_school').meals, true)
  })

  test('core rol listesi olan modülde rol denetlenir, temel modülde karar çağıranındır', () => {
    assert.equal(moduleAllowsRole('meals', 'ogretmen'), false)
    assert.equal(moduleAllowsRole('meals', 'veli'), true)
    assert.equal(moduleAllowsRole('finance', 'ogretmen'), true)
  })

  test('bilinmeyen sabit modül anahtarı uygulama kurulurken reddedilir', () => {
    assert.throws(() => app.requireModule('bilinmeyen-modul'))
  })

  test('oturumsuz istek modül denetiminden önce 401 döner', async () => {
    const response = await get('/api/v1/test-guidance')
    assert.equal(response.statusCode, 401)
  })

  test('açık modülde uç çalışır, kapalı modülde 403 module_disabled döner', async () => {
    const open = await createInstitution(app)
    const closed = await createInstitution(app, { enabledModules: { guidance: false } })
    const openCookie = await signInAs(app, open.admin)
    const closedCookie = await signInAs(app, closed.admin)

    assert.equal((await get('/api/v1/test-guidance', openCookie)).statusCode, 200)
    const denied = await get('/api/v1/test-guidance', closedCookie)
    assert.equal(denied.statusCode, 403)
    assert.equal(denied.json().code, 'module_disabled')
    assert.equal(denied.json().message, MESSAGES.module_disabled)
    assert.equal(denied.json().requestId, denied.headers['x-request-id'])
  })

  test('DOM-YTK-012: kurum türünde olmayan modül açık işaretli olsa da 404 döner', async () => {
    const language = await createInstitution(app, {
      type: 'language_school',
      enabledModules: { guidance: true },
    })
    const cookie = await signInAs(app, language.admin)

    const missing = await get('/api/v1/test-guidance', cookie)
    assert.equal(missing.statusCode, 404)
    assert.equal(missing.json().code, 'not_found')
    assert.equal((await get('/api/v1/test-modules/tutoring', cookie)).statusCode, 404)
    assert.equal((await get('/api/v1/test-modules/meals', cookie)).statusCode, 200)
  })

  test('kapalı modül bütün rollerde kapalıdır', async () => {
    const institution = await createInstitution(app, { enabledModules: { guidance: false } })
    const teacher = await createMember(app, institution.id, 'ogretmen')
    const response = await get('/api/v1/test-guidance', await signInAs(app, teacher))
    assert.equal(response.json().code, 'module_disabled')
  })

  test('çözücü modülü istekten bulur; null modülsüz uçtur, bilinmeyen anahtar 500', async () => {
    const institution = await createInstitution(app, { enabledModules: { finance: false } })
    const cookie = await signInAs(app, institution.admin)

    assert.equal((await get('/api/v1/test-modules/goals', cookie)).statusCode, 200)
    assert.equal((await get('/api/v1/test-modules/finance', cookie)).statusCode, 403)
    assert.equal((await get('/api/v1/test-modules/none', cookie)).statusCode, 200)
    const unknown = await get('/api/v1/test-modules/bilinmeyen', cookie)
    assert.equal(unknown.statusCode, 500)
    assert.equal(unknown.json().code, 'internal_error')
  })
})
