import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { moduleAvailableFor } from '@kampus/school-core/modules/collection-modules.ts'

import type { App } from '../src/app.ts'
import { ROLES } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships, sessions } from '../src/db/schema/auth.ts'
import { contextOf } from '../src/plugins/authenticate.ts'
import { ensureMember } from '../src/services/identity.ts'
import { MODULE_KEYS } from '../src/services/modules.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  createUser,
  FIXED_NOW,
  nextIp,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'

/** Teste özgü değiştiren uç: gövdedeki kurum kimliğinin etkisini ve CSRF korumasını sınar. */
function registerEchoRoute(app: App) {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/api/v1/test-echoes',
    {
      preHandler: app.requireRole(ROLES),
      schema: {
        hide: true,
        body: z.object({ institutionId: z.string().optional() }),
        response: { 200: z.object({ data: z.object({ institutionId: z.string() }) }) },
      },
    },
    async (request) => ({ data: { institutionId: contextOf(request).institutionId } }),
  )
}

describe('kimlik ve kurum kapsamı', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { extend: registerEchoRoute })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function get(url: string, cookie?: string) {
    return app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} })
  }

  test('oturumsuz /me ve /memberships 401 unauthenticated döner', async () => {
    for (const url of ['/api/v1/me', '/api/v1/memberships']) {
      const response = await get(url)
      assert.equal(response.statusCode, 401, url)
      const body = response.json()
      assert.equal(body.code, 'unauthenticated')
      assert.equal(body.message, 'Oturum açmanız gerekiyor.')
      assert.equal(body.requestId, response.headers['x-request-id'])
    }
  })

  test('/me etkin modül haritasını core modül kaydından, akademik yılı kurum ayarından verir', async () => {
    const institution = await createInstitution(app, {
      enabledModules: { guidance: false, finance: false, bilinmeyen: false },
      academicYear: null,
    })
    const cookie = await signInAs(app, institution.admin)

    const { data } = (await get('/api/v1/me', cookie)).json()

    assert.deepEqual(Object.keys(data.activeInstitution.enabledModules), [...MODULE_KEYS])
    assert.equal(data.activeInstitution.enabledModules.guidance, false)
    assert.equal(data.activeInstitution.enabledModules.finance, false)
    assert.equal(data.activeInstitution.enabledModules.goals, true)
    assert.equal('bilinmeyen' in data.activeInstitution.enabledModules, false)
    assert.equal(data.activeInstitution.academicYear, null)
  })

  test('DOM-YTK-012: dil okulunda /me okul türü modülleri açık saklansa da false verir', async () => {
    const institution = await createInstitution(app, {
      type: 'language_school',
      enabledModules: { goals: true, guidance: true, meals: false },
    })
    const cookie = await signInAs(app, institution.admin)

    const { data } = (await get('/api/v1/me', cookie)).json()

    const modules = data.activeInstitution.enabledModules
    assert.deepEqual(Object.keys(modules), [...MODULE_KEYS])
    for (const key of MODULE_KEYS)
      if (!moduleAvailableFor(key, 'language_school')) assert.equal(modules[key], false, key)
    assert.equal(modules.meals, false)
    assert.equal(modules.finance, true)
    assert.equal(modules.clubs, true)
  })

  test('bozuk veya bilinmeyen oturum çerezi 401 döner', async () => {
    const response = await get('/api/v1/me', 'kampus.session_token=bozuk.imza')
    assert.equal(response.statusCode, 401)
  })

  test('/me etkin kurumu, rolü ve school-core bağlantılarını döndürür', async () => {
    const institution = await createInstitution(app, { type: 'language_school' })
    const parent = await createMember(app, institution.id, 'veli', [
      { kind: 'child', recordId: 's1' },
      { kind: 'child', recordId: 's2' },
    ])
    const cookie = await signInAs(app, parent)

    const response = await get('/api/v1/me', cookie)

    assert.equal(response.statusCode, 200)
    const { data } = response.json()
    assert.equal(data.user.email, parent.email)
    assert.equal(data.activeInstitution.id, institution.id)
    assert.equal(data.activeInstitution.type, 'language_school')
    assert.equal(data.activeInstitution.academicYear, FIXED_NOW.getUTCFullYear())
    assert.deepEqual(data.activeMembership, {
      id: parent.membershipId,
      role: 'veli',
      links: [
        { kind: 'child', recordId: 's1' },
        { kind: 'child', recordId: 's2' },
      ],
    })
    assert.equal(data.memberships.length, 1)
    assert.equal('password' in data.user, false)
  })

  test('A oturumu B kurumunun üyelerini görmez; sorgudaki institutionId 400 alır', async () => {
    const a = await createInstitution(app)
    const b = await createInstitution(app)
    const aTeacher = await createMember(app, a.id, 'ogretmen')
    const bTeacher = await createMember(app, b.id, 'ogretmen')
    const cookie = await signInAs(app, a.admin)

    const list = await get('/api/v1/memberships', cookie)
    assert.equal(list.statusCode, 200)
    const body = list.json()
    const userIds = body.data.map((item: { userId: string }) => item.userId)
    assert.deepEqual(userIds.toSorted(), [a.admin.id, aTeacher.id].toSorted())
    assert.equal(userIds.includes(bTeacher.id), false)
    assert.deepEqual(body.meta, { page: 1, pageSize: 25, total: 2 })

    const forged = await get(`/api/v1/memberships?institutionId=${b.id}`, cookie)
    assert.equal(forged.statusCode, 400)
    assert.equal(forged.json().code, 'validation_failed')
    assert.ok(Array.isArray(forged.json().issues))
  })

  test('liste rol süzgeci, sayfalama ve sınır dışı değerleri doğrular', async () => {
    const institution = await createInstitution(app)
    await createMember(app, institution.id, 'ogrenci')
    await createMember(app, institution.id, 'ogrenci')
    await createMember(app, institution.id, 'veli')
    const cookie = await signInAs(app, institution.admin)

    const students = await get('/api/v1/memberships?role=ogrenci&pageSize=1&page=2', cookie)
    assert.equal(students.statusCode, 200)
    assert.equal(students.json().data.length, 1)
    assert.deepEqual(students.json().meta, { page: 2, pageSize: 1, total: 2 })

    const tooLarge = await get('/api/v1/memberships?pageSize=101', cookie)
    assert.equal(tooLarge.statusCode, 400)
    const issue = tooLarge.json().issues[0]
    assert.deepEqual(issue.path, ['pageSize'])
    assert.match(issue.message, /[çğıöşüÇĞİÖŞÜ]|en fazla|büyük/i)
  })

  test('gövdedeki institutionId etkisizdir; kurum oturumdan gelir', async () => {
    const a = await createInstitution(app)
    const b = await createInstitution(app)
    const cookie = await signInAs(app, a.admin)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/test-echoes',
      headers: { cookie, origin: TEST_ORIGIN },
      payload: { institutionId: b.id },
    })

    assert.equal(response.statusCode, 200)
    assert.equal(response.json().data.institutionId, a.id)
  })

  test('rol kapsamı: öğretmen, öğrenci ve veli üye listesini göremez', async () => {
    const institution = await createInstitution(app)
    for (const role of ['ogretmen', 'ogrenci', 'veli'] as const) {
      const member = await createMember(app, institution.id, role)
      const response = await get('/api/v1/memberships', await signInAs(app, member))
      assert.equal(response.statusCode, 403, role)
      assert.equal(response.json().code, 'forbidden')
    }
    const frontDesk = await createMember(app, institution.id, 'onburo')
    const allowed = await get('/api/v1/memberships', await signInAs(app, frontDesk))
    assert.equal(allowed.statusCode, 200)
  })

  test('üyesi olmadığı kuruma geçiş reddedilir ve B kurumuna erişim açılmaz', async () => {
    const a = await createInstitution(app)
    const b = await createInstitution(app)
    const cookie = await signInAs(app, a.admin)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/organization/set-active',
      headers: { cookie, origin: TEST_ORIGIN },
      payload: { organizationId: b.id },
    })

    assert.equal(response.statusCode, 403)
    assert.equal(response.json().message, 'Bu kurumda üyeliğiniz bulunmuyor.')
    // Better Auth başarısız geçişte etkin kurumu temizler (güvenli varsayılan); B'ye geçilmez.
    const [session] = await db.select().from(sessions).where(eq(sessions.userId, a.admin.id))
    assert.equal(session?.activeInstitutionId, null)
    const list = await get('/api/v1/memberships', cookie)
    assert.equal(list.statusCode, 403)
    assert.equal(list.json().code, 'no_active_institution')
  })

  test('iki kurumda üye kullanıcı kurum değiştirince yalnız yeni kurumu görür', async () => {
    const a = await createInstitution(app)
    const b = await createInstitution(app)
    const bTeacher = await createMember(app, b.id, 'ogretmen')
    await ensureMember(app.auth, db, { institutionId: b.id, userId: a.admin.id, role: 'onburo' })
    const cookie = await signInAs(app, a.admin)

    const switched = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/organization/set-active',
      headers: { cookie, origin: TEST_ORIGIN },
      payload: { organizationId: b.id },
    })
    assert.equal(switched.statusCode, 200)

    const me = (await get('/api/v1/me', cookie)).json().data
    assert.equal(me.activeInstitution.id, b.id)
    assert.equal(me.activeMembership.role, 'onburo')
    assert.equal(me.memberships.length, 2)
    const list = (await get('/api/v1/memberships', cookie)).json()
    assert.equal(
      list.data.some((item: { userId: string }) => item.userId === bTeacher.id),
      true,
    )
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.actorUserId, a.admin.id), eq(auditLog.action, 'auth.institution_switched')),
      )
    assert.equal(audit?.institutionId, b.id)
  })

  test('etkin kurumu olmayan oturum 403 no_active_institution alır, /me açık kalır', async () => {
    const loner = await createUser(app)
    const cookie = await signInAs(app, loner)

    const list = await get('/api/v1/memberships', cookie)
    assert.equal(list.statusCode, 403)
    assert.equal(list.json().code, 'no_active_institution')

    const me = await get('/api/v1/me', cookie)
    assert.equal(me.statusCode, 200)
    assert.equal(me.json().data.activeInstitution, null)
    assert.deepEqual(me.json().data.memberships, [])
  })

  test('üyeliği kaldırılan kullanıcının oturumu kurum uçlarında 403 alır', async () => {
    const institution = await createInstitution(app)
    const frontDesk = await createMember(app, institution.id, 'onburo')
    const cookie = await signInAs(app, frontDesk)
    assert.equal((await get('/api/v1/memberships', cookie)).statusCode, 200)

    // Kurum yöneticisinin üyeliği kaldırmasının etkisi; HTTP yönetim ucu henüz yok.
    await db
      .delete(memberships)
      .where(
        and(eq(memberships.institutionId, institution.id), eq(memberships.userId, frontDesk.id)),
      )

    const response = await get('/api/v1/memberships', cookie)
    assert.equal(response.statusCode, 403)
    assert.equal(response.json().code, 'no_active_institution')
  })

  test('çıkıştan sonra aynı çerez 401 alır', async () => {
    const institution = await createInstitution(app)
    const cookie = await signInAs(app, institution.admin)

    const signOut = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-out',
      headers: { cookie, origin: TEST_ORIGIN, 'content-type': 'application/json' },
    })

    assert.equal(signOut.statusCode, 200)
    assert.equal((await get('/api/v1/me', cookie)).statusCode, 401)
  })

  test('izinsiz Origin veya cross-site istek 403 csrf_rejected alır', async () => {
    const institution = await createInstitution(app)
    const cookie = await signInAs(app, institution.admin)
    for (const headers of [
      { origin: 'https://kotu.example' },
      { 'sec-fetch-site': 'cross-site', origin: TEST_ORIGIN },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/test-echoes',
        headers: { cookie, ...headers },
        payload: {},
      })
      assert.equal(response.statusCode, 403)
      assert.equal(response.json().code, 'csrf_rejected')
    }
  })

  test('uygulama uçlarında dakikada 300 istekten sonra 429 ve Retry-After döner', async () => {
    const ip = nextIp()
    let last
    for (let index = 0; index < 301; index += 1)
      last = await app.inject({ method: 'GET', url: '/api/v1/me', remoteAddress: ip })
    assert.equal(last?.statusCode, 429)
    assert.equal(last?.json().code, 'rate_limited')
    assert.ok(Number(last?.headers['retry-after']) > 0)
  })

  test('açık uçlar dışındaki her belgelenmiş rota kimliksiz 401 döner', async () => {
    const open = new Set(['GET /api/v1/health'])
    const document = app.swagger() as { paths?: Record<string, Record<string, unknown>> }
    const routes = Object.entries(document.paths ?? {}).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
    )
    assert.ok(routes.length >= 3)
    for (const route of routes) {
      if (open.has(route)) continue
      const [method, path] = route.split(' ') as ['GET' | 'POST' | 'PATCH' | 'DELETE', string]
      const response = await app.inject({
        method,
        url: path.replace(/\{[^}]+\}/g, 'test-id'),
        headers: { origin: TEST_ORIGIN },
        ...(method === 'GET' ? {} : { payload: {} }),
      })
      assert.equal(response.statusCode, 401, route)
    }
  })
})
