import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import { ROLES, type Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { isGuidanceEntry } from '../src/services/audit-events.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  signInAs,
  TEST_ORIGIN,
  type TestInstitution,
} from './support/app.ts'

interface EventRow {
  id: string
  createdAt: string
  action: string
  entityType: string | null
  entityId: string | null
  actor: { userId: string; name: string | null; role: Role | null } | null
  fields: string[]
  reason: string | null
}
interface EventList {
  data: EventRow[]
  meta: { page: number; pageSize: number; total: number }
}

/** Ayarlar → İşlem Geçmişi (DOM-YTK-053, DOM-YTK-020): yalnız yönetici, yalnız kendi kurumu. */
describe('GET /api/v1/audit-events (DOM-YTK-053)', () => {
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

  const get = (url: string, cookie?: string) =>
    app.inject({
      method: 'GET',
      url,
      headers: { origin: TEST_ORIGIN, ...(cookie ? { cookie } : {}) },
    })

  async function kurum() {
    const institution = await createInstitution(app)
    const cookie = await signInAs(app, institution.admin)
    // Giriş kendi `auth.login_succeeded` kaydını yazar; testler yalnız kendi kayıtlarını sayar.
    await db.delete(auditLog).where(eq(auditLog.institutionId, institution.id))
    return { institution, cookie }
  }

  async function write(
    institution: TestInstitution,
    row: Partial<typeof auditLog.$inferInsert> & { action: string },
  ) {
    const [created] = await db
      .insert(auditLog)
      .values({
        institutionId: institution.id,
        actorUserId: institution.admin.id,
        actorRole: 'yonetici',
        ...row,
      })
      .returning({ id: auditLog.id })
    assert.ok(created)
    return created.id
  }

  test('kimliksiz istek 401', async () => {
    assert.equal((await get('/api/v1/audit-events')).statusCode, 401)
  })

  test('yönetici dışındaki roller 403 alır ve kayıt dönmez', async () => {
    const { institution } = await kurum()
    await write(institution, { action: 'module.set', entityType: 'module', entityId: 'sirket-x' })
    for (const role of ROLES.filter((item) => item !== 'yonetici')) {
      const user = await createMember(app, institution.id, role)
      const response = await get('/api/v1/audit-events', await signInAs(app, user))
      assert.equal(response.statusCode, 403, role)
      assert.ok(!response.body.includes('sirket-x'), role)
    }
  })

  test('kayıtlar en yeniden eskiye; zaman, işlem, varlık, yapan kişi, alan adı ve gerekçe döner', async () => {
    const { institution, cookie } = await kurum()
    await write(institution, {
      action: 'invoices.pay',
      entityType: 'invoices',
      entityId: 'inv-1',
      changes: { fields: ['paidAt', 'status'] },
      createdAt: new Date('2026-10-01T10:00:00.000Z'),
    })
    await write(institution, {
      action: 'conversation.access',
      entityType: 'conversations',
      entityId: 'conv-1',
      reason: 'Veli şikayeti inceleniyor',
      createdAt: new Date('2026-10-02T10:00:00.000Z'),
    })
    const response = await get('/api/v1/audit-events', cookie)
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json<EventList>()
    assert.equal(body.meta.total, 2)
    assert.deepEqual(
      body.data.map((row) => row.action),
      ['conversation.access', 'invoices.pay'],
    )
    const pay = body.data[1]
    assert.deepEqual(pay?.fields, ['paidAt', 'status'])
    assert.equal(pay?.entityType, 'invoices')
    assert.equal(pay?.entityId, 'inv-1')
    assert.equal(pay?.createdAt, '2026-10-01T10:00:00.000Z')
    assert.deepEqual(pay?.actor, {
      userId: institution.admin.id,
      name: 'Test Yönetici',
      role: 'yonetici',
    })
    assert.equal(pay?.reason, null)
    assert.equal(body.data[0]?.reason, 'Veli şikayeti inceleniyor')
    assert.deepEqual(body.data[0]?.fields, [])
  })

  test('rol işlem anındaki kayıttan, yoksa üyelikten gelir; sistem olayında yapan kişi boştur', async () => {
    const { institution, cookie } = await kurum()
    const teacher = await createMember(app, institution.id, 'ogretmen')
    await write(institution, {
      action: 'auth.login_succeeded',
      actorUserId: teacher.id,
      actorRole: null,
    })
    await write(institution, { action: 'job.cleanup', actorUserId: null, actorRole: null })
    const { data } = (await get('/api/v1/audit-events', cookie)).json<EventList>()
    assert.equal(data.find((row) => row.action === 'auth.login_succeeded')?.actor?.role, 'ogretmen')
    assert.equal(data.find((row) => row.action === 'job.cleanup')?.actor, null)
  })

  test('değer, mesaj, IP, istek kimliği ve teknik hata kodu yanıtta yoktur', async () => {
    const { institution, cookie } = await kurum()
    await write(institution, {
      action: 'workflow.goal',
      entityType: 'studentGoals',
      entityId: 'goal-1',
      requestId: 'istek-gizli-123',
      ipHash: 'ip-ozeti-gizli-456',
      changes: { fields: ['status'], reason: 'teknik-kod-gizli' },
    })
    const response = await get('/api/v1/audit-events', cookie)
    for (const secret of ['istek-gizli-123', 'ip-ozeti-gizli-456', 'teknik-kod-gizli'])
      assert.ok(!response.body.includes(secret), secret)
    const [row] = response.json<EventList>().data
    assert.deepEqual(Object.keys(row ?? {}).sort(), [
      'action',
      'actor',
      'createdAt',
      'entityId',
      'entityType',
      'fields',
      'id',
      'reason',
    ])
    for (const forbidden of ['ip', 'userAgent', 'message', 'oldValue', 'newValue', 'restored'])
      assert.ok(!(forbidden in (row ?? {})), forbidden)
  })

  test('rehberlik kayıtlarında alan adı, kimlik ve gerekçe dönmez (DOM-YTK-020)', async () => {
    const { institution, cookie } = await kurum()
    await write(institution, {
      action: 'workflow.guidance-note',
      entityType: 'guidanceCases',
      entityId: 'guid-gizli-1',
      changes: { fields: ['notes', 'saglikNotu'] },
      reason: 'gizli-gerekce',
    })
    await write(institution, {
      action: 'workflow.guidance',
      entityType: 'workflow',
      entityId: 'guidance',
      changes: { fields: ['ogrenciKonusu'] },
    })
    await write(institution, {
      action: 'guidanceCases.archive',
      entityType: 'guidanceCases',
      entityId: 'guid-gizli-2',
      changes: { fields: ['deletedAt'] },
    })
    const response = await get('/api/v1/audit-events', cookie)
    for (const secret of [
      'guid-gizli',
      'notes',
      'saglikNotu',
      'ogrenciKonusu',
      'gizli-gerekce',
      'deletedAt',
    ])
      assert.ok(!response.body.includes(secret), secret)
    const { data, meta } = response.json<EventList>()
    assert.equal(meta.total, 3)
    for (const row of data) {
      assert.equal(row.action, 'workflow.guidance')
      assert.equal(row.entityType, 'guidanceCases')
      assert.equal(row.entityId, null)
      assert.deepEqual(row.fields, [])
      assert.equal(row.reason, null)
    }
  })

  test('isGuidanceEntry yalnız rehberlik varlıklarını yakalar', () => {
    const entry = (action: string, entityType: string | null, entityId: string | null = null) => ({
      action,
      entityType,
      entityId,
    })
    assert.equal(isGuidanceEntry(entry('workflow.guidance', 'workflow', 'guidance')), true)
    assert.equal(
      isGuidanceEntry(entry('workflow.guidance-note', 'workflow', 'guidance-note')),
      true,
    )
    assert.equal(isGuidanceEntry(entry('guidanceCases.restore', 'guidanceCases', 'g1')), true)
    assert.equal(isGuidanceEntry(entry('workflow.goal', 'studentGoals', 'g1')), false)
    assert.equal(isGuidanceEntry(entry('workflow.exam', 'workflow', 'exam')), false)
    assert.equal(isGuidanceEntry(entry('auth.logout', null)), false)
  })

  test('başka kurumun kayıtları listede yok; sorgudaki kurum kimliği 400 ve etkisizdir', async () => {
    const a = await kurum()
    const b = await kurum()
    await write(a.institution, { action: 'a.islem', entityType: 'invoices', entityId: 'a-1' })
    await write(b.institution, { action: 'b.islem', entityType: 'invoices', entityId: 'b-gizli' })
    const response = await get('/api/v1/audit-events?pageSize=100', a.cookie)
    const actions = response.json<EventList>().data.map((row) => row.action)
    assert.deepEqual(actions, ['a.islem'])
    assert.ok(!response.body.includes('b-gizli'))
    const spoofed = await get(`/api/v1/audit-events?institutionId=${b.institution.id}`, a.cookie)
    assert.equal(spoofed.statusCode, 400)
    assert.ok(!spoofed.body.includes('b-gizli'))
    // Kurumu olmayan kimlik olayı (başarısız giriş) hiçbir kurumun listesinde yer almaz.
    await db.insert(auditLog).values({ action: 'auth.login_failed', institutionId: null })
    const again = await get('/api/v1/audit-events?pageSize=100', a.cookie)
    assert.deepEqual(
      again.json<EventList>().data.map((row) => row.action),
      ['a.islem'],
    )
  })

  test('varlık türü ve yapan kişi süzgeçleri', async () => {
    const { institution, cookie } = await kurum()
    const teacher = await createMember(app, institution.id, 'ogretmen')
    await write(institution, { action: 'x.1', entityType: 'invoices', entityId: 'i1' })
    await write(institution, {
      action: 'x.2',
      entityType: 'grades',
      entityId: 'g1',
      actorUserId: teacher.id,
      actorRole: 'ogretmen',
    })
    const byType = (await get('/api/v1/audit-events?entityType=grades', cookie)).json<EventList>()
    assert.deepEqual(
      byType.data.map((row) => row.action),
      ['x.2'],
    )
    assert.equal(byType.meta.total, 1)
    const byActor = (
      await get(`/api/v1/audit-events?actorUserId=${teacher.id}`, cookie)
    ).json<EventList>()
    assert.deepEqual(
      byActor.data.map((row) => row.actor?.userId),
      [teacher.id],
    )
    assert.equal((await get("/api/v1/audit-events?entityType=a'b", cookie)).statusCode, 400)
  })

  test('tarih aralığı Europe/Istanbul gününe uygulanır ve iki uç dahildir', async () => {
    const { institution, cookie } = await kurum()
    // 2026-10-01 İstanbul günü: 2026-09-30T21:00Z ile 2026-10-01T21:00Z (dışlayan) arasındadır.
    const moments = {
      before: '2026-09-30T20:59:59.000Z',
      start: '2026-09-30T21:00:00.000Z',
      end: '2026-10-01T20:59:59.000Z',
      after: '2026-10-01T21:00:00.000Z',
    }
    for (const [name, at] of Object.entries(moments))
      await write(institution, { action: `t.${name}`, createdAt: new Date(at) })
    const day = (
      await get('/api/v1/audit-events?dateFrom=2026-10-01&dateTo=2026-10-01', cookie)
    ).json<EventList>()
    assert.deepEqual(day.data.map((row) => row.action).sort(), ['t.end', 't.start'])
    const from = (await get('/api/v1/audit-events?dateFrom=2026-10-02', cookie)).json<EventList>()
    assert.deepEqual(
      from.data.map((row) => row.action),
      ['t.after'],
    )
    const to = (await get('/api/v1/audit-events?dateTo=2026-09-30', cookie)).json<EventList>()
    assert.deepEqual(
      to.data.map((row) => row.action),
      ['t.before'],
    )
    for (const bad of [
      'dateFrom=2026-13-01',
      'dateFrom=dun',
      'dateFrom=2026-10-05&dateTo=2026-10-01',
    ])
      assert.equal((await get(`/api/v1/audit-events?${bad}`, cookie)).statusCode, 400, bad)
  })

  test('sayfalama toplamı korur ve sınır dışı değerler 400 verir', async () => {
    const { institution, cookie } = await kurum()
    for (let index = 0; index < 5; index += 1)
      await write(institution, {
        action: `p.${index}`,
        createdAt: new Date(Date.UTC(2026, 9, 1, 10, index)),
      })
    const first = (await get('/api/v1/audit-events?pageSize=2', cookie)).json<EventList>()
    const last = (await get('/api/v1/audit-events?pageSize=2&page=3', cookie)).json<EventList>()
    assert.equal(first.meta.total, 5)
    assert.deepEqual(
      first.data.map((row) => row.action),
      ['p.4', 'p.3'],
    )
    assert.deepEqual(
      last.data.map((row) => row.action),
      ['p.0'],
    )
    for (const bad of ['pageSize=101', 'pageSize=0', 'page=0', 'bilinmeyen=1'])
      assert.equal((await get(`/api/v1/audit-events?${bad}`, cookie)).statusCode, 400, bad)
  })

  test('gerçek işlem (modül kapatma) işlem geçmişinde yapan kişiyle görünür; okuma kayıt üretmez', async () => {
    const { institution, cookie } = await kurum()
    const settings = (await get('/api/v1/modules', cookie)).json<{ data: { version: number } }>()
    const toggled = await app.inject({
      method: 'PATCH',
      url: '/api/v1/modules/tutoring',
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': 'application/json',
        'if-match': `"${settings.data.version}"`,
        'idempotency-key': randomUUID(),
      },
      payload: JSON.stringify({ enabled: false }),
    })
    assert.equal(toggled.statusCode, 200, toggled.body)
    const count = async () =>
      (await db.select().from(auditLog).where(eq(auditLog.institutionId, institution.id))).length
    const before = await count()
    const response = await get('/api/v1/audit-events', cookie)
    const row = response.json<EventList>().data.find((item) => item.action === 'module.set')
    assert.equal(row?.entityType, 'module')
    assert.equal(row?.entityId, 'tutoring')
    assert.deepEqual(row?.fields, ['enabledModules'])
    assert.equal(row?.actor?.name, 'Test Yönetici')
    assert.equal(await count(), before)
  })
})
