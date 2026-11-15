import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import { addMonthsToDay } from '@kampus/school-core/lib/finance-maintenance-plans.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  maintenanceInspections,
  maintenancePlans,
} from '../src/db/schema/finance-maintenance-plans.ts'
import {
  maintenanceRequestEvents,
  maintenanceRequests,
} from '../src/db/schema/finance-maintenance-requests.ts'
import { ensureMember } from '../src/services/identity.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  createUser,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * Periyodik bakım planı uçları (DOM-FIN-092; ON-240). Her test kendi kurumunu kurar; kurumda seed
 * kampüsleri vardır. FIXED_NOW 2026-10-06 (Europe/Istanbul günü de 2026-10-06).
 */

const SEED = createSeed(FIXED_NOW)
const CAMPUS = SEED.branches[0]?.id ?? ''
const CAMPUS_NAME = SEED.branches[0]?.name ?? ''
const FINANCE = '/api/v1/finance'
const PLANS = `${FINANCE}/maintenance-plans`
const REQUESTS = `${FINANCE}/maintenance-requests`
const ASSETS = `${FINANCE}/fixed-assets`
const TODAY = '2026-10-06'
const PLAN = { name: 'A blok asansörü', type: 'elevator', location: 'A blok giriş' }
const PASS = { doneDate: TODAY, performedBy: 'Beta Muayene A.Ş.', result: 'pass' }
const FAIL = {
  doneDate: TODAY,
  performedBy: 'Beta Muayene A.Ş.',
  result: 'fail',
  documentNumber: 'PK-2026-117',
  note: 'Kabin kapı kilidi arızalı.',
}
const GENERATOR = {
  name: 'Jeneratör',
  category: 'appliance',
  location: 'Bodrum kat',
  acquisitionValueCents: 9_000_000,
  acquisitionDate: '2026-01-10',
}

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-092: periyodik bakım planı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.92.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string | null,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const get = (url: string, cookie: string | null) => call('GET', url, cookie)
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.92.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      created.id,
      SEED.branches.map((data) => ({ collection: 'branches' as const, id: data.id, data })),
      FIXED_NOW,
    )
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  async function staff(t: Tenant, role: Role, name: string) {
    const user = await createUser(app, { name })
    const membership = await ensureMember(app.auth, db, {
      institutionId: t.id,
      userId: user.id,
      role,
    })
    return membership.id
  }
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  const supplier = async (t: Tenant, name = 'Beta Asansör Ltd.') =>
    ok(
      await call('POST', `${FINANCE}/suppliers`, t.admin, {
        name,
        type: 'company',
        taxNumber: '1111111114',
        taxOffice: 'Kadıköy',
        categories: ['maintenance'],
      }),
      201,
    )
  const createAsset = async (t: Tenant) => ok(await call('POST', ASSETS, t.admin, GENERATOR), 201)
  const create = (cookie: string, body: Json = PLAN, headers: Record<string, string> = {}) =>
    call('POST', PLANS, cookie, body, headers)
  const urlOf = (plan: Json) => `${PLANS}/${String(plan.id)}`
  const inspect = (cookie: string, plan: Json, body: Json = PASS, headers = {}) =>
    call('POST', `${urlOf(plan)}/inspections`, cookie, body, headers)
  const inspectionOf = (plan: Json, index = 0) => (plan.inspections as Json[])[index] ?? {}
  const openRequest = (cookie: string, plan: Json, inspection: Json, headers = {}) =>
    call(
      'POST',
      `${urlOf(plan)}/inspections/${String(inspection.id)}/maintenance-request`,
      cookie,
      undefined,
      { ...ifMatch(inspection.version), ...headers },
    )
  const cancel = (cookie: string, plan: Json, inspection: Json, reason = 'Yanlış gün girildi') =>
    call(
      'POST',
      `${urlOf(plan)}/inspections/${String(inspection.id)}/cancel`,
      cookie,
      { reason },
      ifMatch(inspection.version),
    )
  const plansOf = (institutionId: string) =>
    db.select().from(maintenancePlans).where(eq(maintenancePlans.institutionId, institutionId))
  const inspectionsOf = (institutionId: string) =>
    db
      .select()
      .from(maintenanceInspections)
      .where(eq(maintenanceInspections.institutionId, institutionId))
  const requestsOf = (institutionId: string) =>
    db
      .select()
      .from(maintenanceRequests)
      .where(eq(maintenanceRequests.institutionId, institutionId))
  const listOf = async (cookie: string, query = '') => {
    const response = await get(`${PLANS}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }

  test('kimliksiz istek 401', async () => {
    const plan = `${PLANS}/${randomUUID()}`
    const inspection = `${plan}/inspections/${randomUUID()}`
    assertError(await get(PLANS, null), 401)
    assertError(await get(plan, null), 401)
    assertError(await create('' as string, PLAN), 401)
    assertError(await call('PATCH', plan, null, { name: 'Yeni ad' }, ifMatch(1)), 401)
    assertError(await call('DELETE', plan, null, undefined, ifMatch(1)), 401)
    assertError(await call('POST', `${plan}/inspections`, null, PASS), 401)
    assertError(await call('POST', `${inspection}/cancel`, null, { reason: 'x' }, ifMatch(1)), 401)
    assertError(
      await call('POST', `${inspection}/maintenance-request`, null, undefined, ifMatch(1)),
      401,
    )
  })

  test('DOM-FIN-092: öğretmen, veli ve öğrenci 403; ön büro okur ama yazamaz; plan değişmez (K-255)', async () => {
    const t = await institution()
    const created = ok(await create(t.admin), 201)
    const failed = ok(await inspect(t.admin, created, FAIL), 201)
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(PLANS, cookie), 403)
      assertError(await get(urlOf(created), cookie), 403)
      assertError(await create(cookie), 403)
    }
    const desk = await member(t.id, 'onburo')
    assert.equal((await listOf(desk)).meta.total, 1)
    assert.equal(ok(await get(urlOf(created), desk)).name, PLAN.name)
    assertError(await create(desk), 403)
    assertError(await call('PATCH', urlOf(created), desk, { name: 'Yeni ad' }, ifMatch(1)), 403)
    assertError(await call('DELETE', urlOf(created), desk, undefined, ifMatch(1)), 403)
    assertError(await inspect(desk, created, { ...PASS, doneDate: '2026-10-01' }), 403)
    assertError(await cancel(desk, created, inspectionOf(failed)), 403)
    assertError(await openRequest(desk, created, inspectionOf(failed)), 403)
    const [row] = await plansOf(t.id)
    assert.equal(row?.version, 1)
    assert.equal(row?.name, PLAN.name)
    assert.equal((await inspectionsOf(t.id)).length, 1)
    assert.equal((await requestsOf(t.id)).length, 0)
  })

  test('DOM-FIN-092: finance modülü kapalıyken bakım planı uçları 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(PLANS, closed.admin), 403, 'module_disabled')
    assertError(await create(closed.admin), 403, 'module_disabled')
    assertError(
      await call('POST', `${PLANS}/${randomUUID()}/inspections`, closed.admin, PASS),
      403,
      'module_disabled',
    )
    assert.equal((await plansOf(closed.id)).length, 0)
  })

  test('DOM-FIN-092: plan türün önerisiyle açılır; demirbaş, kampüs, sorumlu ve takvim; denetimde alan adları (K-252, K-253)', async () => {
    const t = await institution()
    const asset = await createAsset(t)
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const response = await create(t.admin, {
      name: 'Jeneratör yıllık kontrol',
      type: 'generator',
      location: 'Bodrum kat',
      campusId: CAMPUS,
      assetTagNumber: ` ${String(asset.tagNumber).toLowerCase()} `,
      lastDoneDate: '2025-10-20',
      responsible: { type: 'staff', membershipId: selin },
    })
    const created = ok(response, 201)
    assert.equal(response.headers.location, urlOf(created))
    assert.equal(created.periodMonths, 12)
    assert.equal(created.isLegal, true)
    assert.equal(created.campusName, CAMPUS_NAME)
    assert.deepEqual(created.asset, { id: asset.id, tagNumber: asset.tagNumber, name: 'Jeneratör' })
    assert.deepEqual(created.responsible, { type: 'staff', id: selin, name: 'Selin Kaya' })
    assert.equal(created.previousDoneDate, '2025-10-20')
    assert.equal(created.lastDoneDate, '2025-10-20')
    assert.equal(created.nextDueDate, '2026-10-20')
    assert.equal(created.dueStatus, 'due_soon')
    assert.equal(created.daysLeft, 14)
    assert.deepEqual(created.inspections, [])

    const extinguisher = ok(
      await create(t.admin, {
        name: 'Söndürücüler',
        type: 'fire_extinguisher',
        location: 'Koridor',
      }),
      201,
    )
    assert.equal(extinguisher.periodMonths, 6)
    assert.equal(extinguisher.dueStatus, 'never')
    assert.equal(extinguisher.nextDueDate, null)
    const custom = ok(
      await create(t.admin, { ...PLAN, periodMonths: 1, isLegal: false, lastDoneDate: TODAY }),
      201,
    )
    assert.deepEqual(
      [custom.periodMonths, custom.isLegal, custom.nextDueDate, custom.dueStatus],
      [1, false, '2026-11-06', 'ok'],
    )
    const audits = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'maintenance_plan.create')))
    assert.equal(audits.length, 3)
    assert.equal(JSON.stringify(audits).includes('Jeneratör'), false)
    assert.equal(JSON.stringify(audits).includes('assetId'), true)
  })

  test('DOM-FIN-092: bağlantı ve gün hataları 422, şema hataları 400; plan yazılmaz', async () => {
    const t = await institution()
    const asset = await createAsset(t)
    const vendor = await supplier(t)
    const parent = await staff(t, 'veli', 'Ayşe Yılmaz')
    assertError(
      await create(t.admin, { ...PLAN, assetTagNumber: 'DB-1999-0001' }),
      422,
      'maintenance_plan_asset_not_found',
    )
    assertError(
      await create(t.admin, { ...PLAN, campusId: 'yok-kampus' }),
      422,
      'maintenance_plan_campus_not_found',
    )
    assertError(
      await create(t.admin, { ...PLAN, lastDoneDate: '2026-10-07' }),
      422,
      'maintenance_plan_date_in_future',
    )
    assertError(
      await create(t.admin, { ...PLAN, responsible: { type: 'staff', membershipId: 'yok' } }),
      422,
      'maintenance_plan_responsible_not_found',
    )
    assertError(
      await create(t.admin, { ...PLAN, responsible: { type: 'staff', membershipId: parent } }),
      422,
      'maintenance_plan_responsible_not_staff',
    )
    assertError(
      await create(t.admin, {
        ...PLAN,
        responsible: { type: 'supplier', supplierId: randomUUID() },
      }),
      422,
      'maintenance_plan_supplier_not_found',
    )
    for (const body of [
      { ...PLAN, name: 'x' },
      { ...PLAN, type: 'pool' },
      { ...PLAN, periodMonths: 0 },
      { ...PLAN, periodMonths: 61 },
      { ...PLAN, location: '' },
      { ...PLAN, extra: true },
    ])
      assertError(await create(t.admin, body), 400)
    ok(
      await call(
        'POST',
        `${ASSETS}/${String(asset.id)}/scrap`,
        t.admin,
        { reason: 'Onarılamaz durumda', scrapDate: TODAY },
        ifMatch(asset.version),
      ),
    )
    assertError(
      await create(t.admin, { ...PLAN, assetTagNumber: asset.tagNumber }),
      422,
      'maintenance_plan_asset_scrapped',
    )
    ok(
      await call(
        'PATCH',
        `${FINANCE}/suppliers/${String(vendor.id)}`,
        t.admin,
        { isActive: false },
        ifMatch(vendor.version),
      ),
    )
    assertError(
      await create(t.admin, { ...PLAN, responsible: { type: 'supplier', supplierId: vendor.id } }),
      422,
      'maintenance_plan_supplier_inactive',
    )
    assert.equal((await plansOf(t.id)).length, 0)
  })

  test('DOM-FIN-092: düzeltme If-Match ile; değişiklik yoksa 422, eski sürüm 409; arşivlenen plan listeden düşer', async () => {
    const t = await institution()
    const vendor = await supplier(t)
    const created = ok(await create(t.admin), 201)
    assertError(
      await call('PATCH', urlOf(created), t.admin, { name: 'Yeni ad' }),
      400,
      'if_match_required',
    )
    assertError(
      await call('PATCH', urlOf(created), t.admin, { name: PLAN.name }, ifMatch(1)),
      422,
      'maintenance_plan_unchanged',
    )
    assertError(await call('PATCH', urlOf(created), t.admin, {}, ifMatch(1)), 400)
    const changed = ok(
      await call(
        'PATCH',
        urlOf(created),
        t.admin,
        {
          type: 'boiler',
          periodMonths: 6,
          lastDoneDate: '2026-03-01',
          responsible: { type: 'supplier', supplierId: vendor.id },
        },
        ifMatch(1),
      ),
    )
    assert.deepEqual(
      [changed.type, changed.periodMonths, changed.nextDueDate, changed.dueStatus, changed.version],
      ['boiler', 6, '2026-09-01', 'overdue', 2],
    )
    assert.deepEqual(changed.responsible, {
      type: 'supplier',
      id: vendor.id,
      name: 'Beta Asansör Ltd.',
    })
    assertError(
      await call('PATCH', urlOf(created), t.admin, { name: 'Eski sürüm' }, ifMatch(1)),
      409,
    )
    const cleared = ok(
      await call('PATCH', urlOf(created), t.admin, { responsible: null }, ifMatch(2)),
    )
    assert.equal(cleared.responsible, null)
    assertError(await call('DELETE', urlOf(created), t.admin, undefined, ifMatch(2)), 409)
    const archived = ok(await call('DELETE', urlOf(created), t.admin, undefined, ifMatch(3)))
    assert.equal(archived.id, created.id)
    assertError(await get(urlOf(created), t.admin), 404)
    assert.equal((await listOf(t.admin)).meta.total, 0)
    const [row] = await plansOf(t.id)
    assert.notEqual(row?.archivedAt, null)
  })

  test('DOM-FIN-092: denetim kaydı takvimi yeniler; aynı gün mükerrer 409, gelecek gün 422, not zorunlu 400; iptal takvimden düşer (K-253, K-254)', async () => {
    const t = await institution()
    const created = ok(await create(t.admin, { ...PLAN, lastDoneDate: '2025-09-01' }), 201)
    assert.equal(created.dueStatus, 'overdue')
    const key = { 'idempotency-key': 'denetim-kaydi-0001' }
    const first = await inspect(t.admin, created, { ...PASS, doneDate: '2026-10-01' }, key)
    const recorded = ok(first, 201)
    assert.deepEqual(
      [recorded.lastDoneDate, recorded.nextDueDate, recorded.dueStatus],
      ['2026-10-01', '2027-10-01', 'ok'],
    )
    const replay = await inspect(t.admin, created, { ...PASS, doneDate: '2026-10-01' }, key)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(
      await inspect(t.admin, created, { ...PASS, doneDate: '2026-10-01' }),
      409,
      'maintenance_inspection_exists',
    )
    assertError(
      await inspect(t.admin, created, { ...PASS, doneDate: '2026-10-07' }),
      422,
      'maintenance_inspection_date_in_future',
    )
    assertError(await inspect(t.admin, created, { ...PASS, result: 'fail' }), 400)
    assertError(await inspect(t.admin, created, { ...PASS, result: 'unknown' }), 400)
    assert.equal((await inspectionsOf(t.id)).length, 1)

    // Eski tarihli denetim takvimi geri çekmez; en geç gün geçerlidir.
    const older = ok(await inspect(t.admin, created, { ...PASS, doneDate: '2026-06-01' }), 201)
    assert.equal(older.lastDoneDate, '2026-10-01')
    const latest = (older.inspections as Json[]).find((item) => item.doneDate === '2026-10-01')
    assert.ok(latest)
    assert.equal(latest.recordedByName !== null, true)
    const afterCancel = ok(await cancel(t.admin, created, latest))
    assert.equal(afterCancel.lastDoneDate, '2026-06-01')
    assert.equal(afterCancel.nextDueDate, addMonthsToDay('2026-06-01', 12))
    const cancelled = (afterCancel.inspections as Json[]).find((item) => item.id === latest.id)
    assert.equal(cancelled?.cancelReason, 'Yanlış gün girildi')
    assertError(await cancel(t.admin, created, latest), 409)
    assertError(
      await cancel(t.admin, created, cancelled ?? {}),
      422,
      'maintenance_inspection_cancelled',
    )
    // İptal edilen günün yerine yeniden kayıt yazılabilir.
    ok(await inspect(t.admin, created, { ...PASS, doneDate: '2026-10-01' }), 201)
    assert.equal((await inspectionsOf(t.id)).length, 3)
  })

  test('DOM-FIN-092: uygunsuz denetimden tek adımda arıza talebi; uygun 422, ikinci kez 409 (K-254)', async () => {
    const t = await institution()
    const asset = await createAsset(t)
    const created = ok(
      await create(t.admin, { ...PLAN, campusId: CAMPUS, assetTagNumber: asset.tagNumber }),
      201,
    )
    const passed = ok(await inspect(t.admin, created, { ...PASS, doneDate: '2026-10-01' }), 201)
    assertError(
      await openRequest(t.admin, created, inspectionOf(passed)),
      422,
      'maintenance_inspection_passed',
    )
    const failed = ok(await inspect(t.admin, created, FAIL), 201)
    const inspection = inspectionOf(failed)
    assert.equal(inspection.doneDate, TODAY)
    const response = await openRequest(t.admin, created, inspection)
    const opened = ok(response, 201)
    const linked = inspectionOf(opened)
    assert.deepEqual(linked.maintenanceRequest, {
      id: (linked.maintenanceRequest as Json).id,
      number: 'AT-0001',
      status: 'open',
    })
    const requestId = String((linked.maintenanceRequest as Json).id)
    assert.equal(response.headers.location, `${REQUESTS}/${requestId}`)
    const request = ok(await get(`${REQUESTS}/${requestId}`, t.admin))
    assert.equal(request.title, 'Denetim uygunsuzluğu: A blok asansörü')
    assert.equal(request.priority, 'urgent')
    assert.equal(request.location, PLAN.location)
    assert.equal(request.campusId, CAMPUS)
    assert.equal((request.asset as Json).id, asset.id)
    assert.match(String(request.description), /belge no PK-2026-117.*Kabin kapı kilidi arızalı/)
    const events = await db
      .select()
      .from(maintenanceRequestEvents)
      .where(eq(maintenanceRequestEvents.institutionId, t.id))
    assert.equal(events.length, 1)
    assert.equal(events[0]?.note, 'Periyodik bakım denetiminden açıldı.')

    assertError(
      await openRequest(t.admin, created, linked),
      409,
      'maintenance_inspection_request_exists',
    )
    assertError(await openRequest(t.admin, created, inspection), 409)
    const partial = ok(
      await inspect(t.admin, created, {
        ...FAIL,
        doneDate: '2026-10-02',
        result: 'partial',
        documentNumber: null,
      }),
      201,
    )
    const partialInspection = (partial.inspections as Json[]).find(
      (item) => item.doneDate === '2026-10-02',
    )
    const second = ok(await openRequest(t.admin, created, partialInspection ?? {}), 201)
    const secondRequest = (second.inspections as Json[]).find(
      (item) => item.doneDate === '2026-10-02',
    )?.maintenanceRequest as Json
    assert.equal(secondRequest.number, 'AT-0002')
    const [secondRow] = (await requestsOf(t.id)).filter((row) => row.sequence === 2)
    assert.equal(secondRow?.priority, 'normal')
    assert.equal((await requestsOf(t.id)).length, 2)
  })

  test('DOM-FIN-092: yaklaşan ve geciken süzgeci, sıra, arama ve sayfalama (K-253)', async () => {
    const t = await institution()
    const add = (name: string, lastDoneDate: string | null, periodMonths = 12) =>
      create(t.admin, { ...PLAN, name, lastDoneDate, periodMonths })
    ok(await add('Zamanında kazan', '2026-09-01'), 201)
    ok(await add('Geciken söndürücü', '2026-03-01', 6), 201)
    ok(await add('Yaklaşan jeneratör', '2025-10-31'), 201)
    ok(await add('Hiç denetlenmeyen oyun alanı', null), 201)
    // 5 Ekim + 1 ay = 5 Kasım, bugünden 30 gün sonradır: sınırda yaklaşan sayılır.
    ok(await add('Sınırda elektrik', '2026-10-05', 1), 201)
    const names = (listed: { data: Json[] }) => listed.data.map((item) => item.name)
    assert.deepEqual(names(await listOf(t.admin)), [
      'Hiç denetlenmeyen oyun alanı',
      'Geciken söndürücü',
      'Yaklaşan jeneratör',
      'Sınırda elektrik',
      'Zamanında kazan',
    ])
    const attention = await listOf(t.admin, '?due=attention')
    assert.equal(attention.meta.total, 4)
    assert.deepEqual(names(await listOf(t.admin, '?due=overdue')), ['Geciken söndürücü'])
    assert.deepEqual(names(await listOf(t.admin, '?due=due_soon')), [
      'Yaklaşan jeneratör',
      'Sınırda elektrik',
    ])
    assert.deepEqual(names(await listOf(t.admin, '?due=ok')), ['Zamanında kazan'])
    assert.deepEqual(names(await listOf(t.admin, '?due=never')), ['Hiç denetlenmeyen oyun alanı'])
    // SQL süzgeci ile core takvimi aynı durumu verir.
    for (const item of (await listOf(t.admin)).data)
      if (item.dueStatus === 'due_soon') assert.ok(Number(item.daysLeft) <= 30)
    assert.deepEqual(names(await listOf(t.admin, '?q=sondurucu')), ['Geciken söndürücü'])
    const page = await listOf(t.admin, '?pageSize=2&page=2')
    assert.equal(page.meta.total, 5)
    assert.deepEqual(names(page), ['Yaklaşan jeneratör', 'Sınırda elektrik'])
    assert.equal((await listOf(t.admin, '?type=boiler')).meta.total, 0)
    assertError(await get(`${PLANS}?due=soon`, t.admin), 400)
    assertError(await get(`${PLANS}?sort=name`, t.admin), 400)
  })

  test('DOM-FIN-092: CSV süzgeçle eşleşen bütün planları verir ve denetime düşer (K-255)', async () => {
    const t = await institution()
    const vendor = await supplier(t)
    ok(
      await create(t.admin, {
        ...PLAN,
        name: '=Kazan',
        type: 'boiler',
        lastDoneDate: '2025-10-01',
        responsible: { type: 'supplier', supplierId: vendor.id },
      }),
      201,
    )
    ok(await create(t.admin, { ...PLAN, name: 'Zamanında', lastDoneDate: TODAY }), 201)
    const response = await app.inject({
      method: 'GET',
      url: `${PLANS}?due=attention&pageSize=1`,
      remoteAddress: clientIp,
      headers: { origin: TEST_ORIGIN, cookie: t.admin, accept: 'text/csv' },
    })
    assert.equal(response.statusCode, 200, response.body)
    assert.match(String(response.headers['content-type']), /text\/csv/)
    assert.match(String(response.headers['content-disposition']), /bakim-plani-2026-10-06\.csv/)
    const lines = response.body.replace('\uFEFF', '').trimEnd().split('\r\n')
    assert.equal(lines.length, 2)
    assert.equal(
      lines[1],
      `"'=Kazan";"Kazan ve kalorifer";"Evet";"";"A blok giriş";"";12;"Beta Asansör Ltd.";"2025-10-01";"2026-10-01";"Gecikti";-5`,
    )
    const audit = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          eq(auditLog.action, 'finance.maintenance_plan_export'),
        ),
      )
    assert.equal(audit.length, 1)
  })

  test('DOM-FIN-092: başka kurumun planı 404 ve B değişmez; listede yok; B etiketi, sorumlusu ve institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bAsset = await createAsset(b)
    const bStaff = await staff(b, 'ogretmen', 'Beta Öğretmen')
    const bVendor = await supplier(b)
    const bPlan = ok(await create(b.admin, { ...PLAN, assetTagNumber: bAsset.tagNumber }), 201)
    const bFailed = ok(await inspect(b.admin, bPlan, FAIL), 201)
    const bInspection = inspectionOf(bFailed)
    const bUrl = urlOf(bPlan)

    assertError(await get(bUrl, a.admin), 404)
    assertError(await call('PATCH', bUrl, a.admin, { name: 'Başka kurum' }, ifMatch(1)), 404)
    assertError(await call('DELETE', bUrl, a.admin, undefined, ifMatch(1)), 404)
    assertError(await inspect(a.admin, bPlan, { ...PASS, doneDate: '2026-10-01' }), 404)
    assertError(await cancel(a.admin, bPlan, bInspection, 'Başka kurum'), 404)
    assertError(await openRequest(a.admin, bPlan, bInspection), 404)
    const aPlan = ok(await create(a.admin), 201)
    // A'nın planı altında B'nin denetimi de bulunmaz.
    assertError(await openRequest(a.admin, aPlan, bInspection), 404)
    assert.equal((await listOf(a.admin)).meta.total, 1)
    assert.equal((await listOf(a.admin, `?assetId=${String(bAsset.id)}`)).meta.total, 0)
    assertError(
      await create(a.admin, { ...PLAN, assetTagNumber: bAsset.tagNumber }),
      422,
      'maintenance_plan_asset_not_found',
    )
    assertError(
      await create(a.admin, { ...PLAN, responsible: { type: 'staff', membershipId: bStaff } }),
      422,
      'maintenance_plan_responsible_not_found',
    )
    assertError(
      await create(a.admin, {
        ...PLAN,
        responsible: { type: 'supplier', supplierId: bVendor.id },
      }),
      422,
      'maintenance_plan_supplier_not_found',
    )
    assertError(await create(a.admin, { ...PLAN, institutionId: b.id }), 400)
    const [bRow] = await plansOf(b.id)
    assert.equal(bRow?.version, 1)
    assert.equal(bRow?.archivedAt, null)
    const [bInspectionRow] = await inspectionsOf(b.id)
    assert.equal(bInspectionRow?.maintenanceRequestId, null)
    assert.equal(bInspectionRow?.cancelledAt, null)
    assert.equal((await inspectionsOf(b.id)).length, 1)
    assert.equal((await requestsOf(a.id)).length, 0)
  })
})
