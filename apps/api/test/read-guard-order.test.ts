import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import Fastify from 'fastify'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { registerModuleGuard } from '../src/plugins/modules.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  signInAs,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * IST-009: okuma uçlarında sıra 401 → modül 403 → rol 403 → 400 → 404. Fastify şema doğrulaması
 * `preHandler`'dan önce koşar; modül ve rol denetimi `preValidation`'da olmazsa kapalı modül
 * geçersiz sorguda 400 alır ve sorgu şemasının `issues` ayrıntısı sızar.
 */
interface ReadCase {
  name: string
  module: string
  url: string
  /** Ucu okuyabilen rol; verilmezse yönetici. */
  role?: 'ogrenci'
}

const READS: readonly ReadCase[] = [
  { name: 'koleksiyon listesi', module: 'guidance', url: '/collections/guidanceCases?page=0' },
  {
    name: 'koleksiyon sayımı',
    module: 'guidance',
    url: '/collections/guidanceCases/counts?bilinmeyen=1',
  },
  {
    name: 'koleksiyon kaydı',
    module: 'guidance',
    url: '/collections/guidanceCases/kayit-1?archived=herhangi',
  },
  { name: 'yazışma listesi', module: 'communication', url: '/conversations?page=0' },
  { name: 'mesaj listesi', module: 'communication', url: '/conversations/c1/messages?limit=0' },
  { name: 'bildirim listesi', module: 'communication', url: '/notifications?limit=0' },
  {
    name: 'randevu saatleri (öğrenci)',
    module: 'communication',
    url: '/appointments/slots?bilinmeyen=1',
    role: 'ogrenci',
  },
  { name: 'kaynak listesi', module: 'learning', url: '/resources?page=0' },
  { name: 'ödev listesi', module: 'learning', url: '/task-assignments?page=0' },
]

describe('IST-009: okuma uçlarında doğrulama sırası', () => {
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

  async function tenant(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    return {
      id: created.id,
      admin: await signInAs(app, created.admin),
      student: await signInAs(app, await createMember(app, created.id, 'ogrenci')),
    }
  }

  const as = (t: { admin: string; student: string }, read: ReadCase) =>
    read.role === 'ogrenci' ? t.student : t.admin

  function get(url: string, cookie?: string) {
    return app.inject({ method: 'GET', url: `/api/v1${url}`, headers: cookie ? { cookie } : {} })
  }

  for (const read of READS) {
    test(`IST-009: ${read.name}: modül kapalı + geçersiz sorgu 403 module_disabled, issues yok`, async () => {
      const closed = await tenant({ enabledModules: { [read.module]: false } })
      const response = await get(read.url, as(closed, read))
      assert.equal(response.statusCode, 403, response.body)
      const body = response.json()
      assert.equal(body.code, 'module_disabled')
      assert.deepEqual(Object.keys(body).sort(), ['code', 'message', 'requestId'], response.body)
    })

    test(`IST-009: ${read.name}: modül açık + geçersiz sorgu 400, oturumsuz 401`, async () => {
      const open = await tenant()
      const response = await get(read.url, as(open, read))
      assert.equal(response.statusCode, 400, response.body)
      assert.equal(response.json().code, 'validation_failed')
      assert.ok(Array.isArray(response.json().issues))
      assert.equal((await get(read.url)).statusCode, 401)
      const closed = await tenant({ enabledModules: { [read.module]: false } })
      assert.equal((await get(read.url)).statusCode, 401)
      assert.equal((await get(read.url, as(closed, read))).statusCode, 403)
    })
  }

  test('IST-009: rol 403, doğrulama 400 ve kayıt 404 sırası: koleksiyon yok 404, geçersiz sorgu 400', async () => {
    const { admin, student } = await tenant()
    // Rol (yönetici/ön büro dışı) geçersiz sorguda da 403.
    for (const url of ['/memberships?page=0', '/memberships?bilinmeyen=1']) {
      assert.equal((await get(url, student)).statusCode, 403, url)
      assert.equal((await get(url, admin)).statusCode, 400, url)
      assert.equal((await get(url)).statusCode, 401, url)
    }
    // Bilinmeyen koleksiyon modüle bağlı değildir: geçersiz sorgu 400, geçerli sorgu 404.
    assert.equal((await get('/collections/yokBoyleBirSey?page=0', admin)).statusCode, 400)
    assert.equal((await get('/collections/yokBoyleBirSey', admin)).statusCode, 404)
  })

  test('IST-009: kapalı modül kuruma, açık modül başka kuruma dokunmaz', async () => {
    const closed = await tenant({ enabledModules: { communication: false } })
    const open = await tenant()
    assert.equal((await get('/conversations?page=0', closed.admin)).statusCode, 403)
    assert.equal((await get('/conversations?page=0', open.admin)).statusCode, 400)
    assert.equal((await get('/conversations?studentId=s1', open.admin)).statusCode, 200)
  })

  test('IST-009: yazma ucu davranışı aynı: kapalı modül geçersiz gövdede de 403', async () => {
    const closed = await tenant({ enabledModules: { communication: false } })
    const open = await tenant()
    const post = (cookie: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/announcements',
        headers: { cookie, origin: 'http://localhost:5173', 'idempotency-key': 'k-ist009-1' },
        payload: { bozuk: true },
      })
    const denied = await post(closed.admin)
    assert.equal(denied.statusCode, 403, denied.body)
    assert.equal(denied.json().code, 'module_disabled')
    assert.equal((await post(open.admin)).statusCode, 400)
  })

  test('IST-009: requireModule/requireRole preHandler listesinde olursa uygulama açılmaz', async () => {
    const bare = Fastify()
    registerModuleGuard(bare)
    assert.throws(
      () => bare.get('/yanlis', { preHandler: [bare.requireModule('learning')] }, async () => ({})),
      /preValidation/,
    )
    await bare.close()

    const fine = Fastify()
    registerModuleGuard(fine)
    fine.get('/dogru', { preValidation: [fine.requireModule('learning')] }, async () => ({}))
    await fine.ready()
    await fine.close()
  })
})
