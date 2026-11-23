import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships } from '../src/db/schema/auth.ts'
import {
  maintenanceRequestEvents,
  maintenanceRequests,
} from '../src/db/schema/finance-maintenance-requests.ts'
import { suppliers } from '../src/db/schema/finance-suppliers.ts'
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
 * Arıza ve bakım talebi uçları (DOM-FIN-089; ON-239). Her test kendi kurumunu kurar; kurumda seed
 * kampüsleri vardır. FIXED_NOW 2026-10-06: bildirim ve çözüm günü aynı gündür.
 */

const SEED = createSeed(FIXED_NOW)
const CAMPUS = SEED.branches[0]?.id ?? ''
const CAMPUS_NAME = SEED.branches[0]?.name ?? ''
const FINANCE = '/api/v1/finance'
const REQUESTS = `${FINANCE}/maintenance-requests`
const ASSETS = `${FINANCE}/fixed-assets`
const TODAY = '2026-10-06'
const PROJECTOR = {
  name: 'Projektör',
  category: 'audiovisual',
  location: '2. kat 5-A sınıfı',
  acquisitionValueCents: 1_500_000,
  acquisitionDate: '2026-09-01',
}
const REPORT = {
  title: 'Projektör açılmıyor',
  description: 'Güç düğmesine basınca ışık yanmıyor.',
  location: '2. kat 5-A sınıfı',
}
const RESOLVE = { resolvedDate: TODAY, resolution: 'Lamba değiştirildi.' }

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-089: arıza ve bakım talebi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.89.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST',
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
    clientIp = `10.89.${String((tenantCount += 1))}.1`
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
  /** Adlı personel üyeliği (giriş yapmaz). */
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
  const supplier = async (t: Tenant, name = 'Beta Teknik Servis Ltd.') =>
    ok(
      await call('POST', `${FINANCE}/suppliers`, t.admin, {
        name,
        type: 'company',
        taxNumber: '1111111114',
        taxOffice: 'Kadıköy',
        categories: ['it'],
      }),
      201,
    )
  const createAsset = async (t: Tenant) => ok(await call('POST', ASSETS, t.admin, PROJECTOR), 201)
  const report = (cookie: string, body: Json = REPORT, headers: Record<string, string> = {}) =>
    call('POST', REQUESTS, cookie, body, headers)
  const step = (cookie: string, request: Json, verb: string, body: Json = {}) =>
    call(
      'POST',
      `${REQUESTS}/${String(request.id)}/${verb}`,
      cookie,
      body,
      ifMatch(request.version),
    )
  const rowsOf = (institutionId: string) =>
    db
      .select()
      .from(maintenanceRequests)
      .where(eq(maintenanceRequests.institutionId, institutionId))
  const eventsOf = (institutionId: string) =>
    db
      .select()
      .from(maintenanceRequestEvents)
      .where(eq(maintenanceRequestEvents.institutionId, institutionId))
  const listOf = async (cookie: string, query = '') => {
    const response = await get(`${REQUESTS}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }
  const toStaff = (membershipId: string) => ({ assigneeType: 'staff', membershipId })

  test('kimliksiz istek 401', async () => {
    const url = `${REQUESTS}/${randomUUID()}`
    assertError(await get(REQUESTS, null), 401)
    assertError(await get(url, null), 401)
    assertError(await report('', REPORT), 401)
    for (const verb of ['assign', 'start', 'resolve', 'close', 'cancel'])
      assertError(await call('POST', `${url}/${verb}`, null, {}, ifMatch(1)), 401)
  })

  test('DOM-FIN-089: veli ve öğrenci 403; ön büro ve öğretmen iş emrini yönetemez; talep değişmez (K-237)', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const created = ok(await report(t.admin), 201)
    for (const role of ['veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(REQUESTS, cookie), 403)
      assertError(await get(`${REQUESTS}/${String(created.id)}`, cookie), 403)
      assertError(await report(cookie), 403)
      assertError(await step(cookie, created, 'cancel', { reason: 'Yanlış bildirim' }), 403)
    }
    for (const role of ['onburo', 'ogretmen'] as const) {
      const cookie = await member(t.id, role)
      assertError(await step(cookie, created, 'assign', toStaff(selin)), 403)
      assertError(await step(cookie, created, 'start'), 403)
      assertError(await step(cookie, created, 'resolve', RESOLVE), 403)
      assertError(await step(cookie, created, 'close'), 403)
    }
    const [row] = await rowsOf(t.id)
    assert.equal(row?.status, 'open')
    assert.equal(row?.version, 1)
    assert.equal((await eventsOf(t.id)).length, 1)
  })

  test('DOM-FIN-089: finance modülü kapalıyken arıza uçları 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(REQUESTS, closed.admin), 403, 'module_disabled')
    assertError(await report(closed.admin), 403, 'module_disabled')
    assertError(
      await call('POST', `${REQUESTS}/${randomUUID()}/start`, closed.admin, {}, ifMatch(1)),
      403,
      'module_disabled',
    )
    assert.equal((await rowsOf(closed.id)).length, 0)
  })

  test('DOM-FIN-089: ön büro etiketli arıza bildirir; numara, geçmiş ve demirbaşta açık arıza işareti; denetimde yalnız alan adları (K-236, K-239)', async () => {
    const t = await institution()
    const asset = await createAsset(t)
    const desk = await member(t.id, 'onburo')
    const response = await report(desk, {
      ...REPORT,
      campusId: CAMPUS,
      assetTagNumber: ` ${String(asset.tagNumber).toLowerCase()} `,
      priority: 'urgent',
    })
    const created = ok(response, 201)
    assert.equal(response.headers.location, `${REQUESTS}/${String(created.id)}`)
    assert.equal(created.number, 'AT-0001')
    assert.equal(created.status, 'open')
    assert.equal(created.priority, 'urgent')
    assert.equal(created.campusName, CAMPUS_NAME)
    assert.deepEqual(created.asset, {
      id: asset.id,
      tagNumber: asset.tagNumber,
      name: 'Projektör',
      category: 'audiovisual',
    })
    assert.equal(created.reportedByMe, true)
    assert.equal(created.assignee, null)
    assert.equal('resolutionCostCents' in created, false)
    assert.deepEqual(created.actions, {
      assign: false,
      start: false,
      resolve: false,
      close: false,
      cancel: true,
    })
    const events = created.events as Json[]
    assert.equal(events.length, 1)
    assert.equal(events[0]?.event, 'reported')
    assert.equal(events[0]?.toStatus, 'open')
    assert.equal(events[0]?.fromStatus, null)

    const second = ok(await report(t.admin), 201)
    assert.equal(second.number, 'AT-0002')
    assert.equal((second.actions as Json).assign, true)

    const [listed] = (await get(ASSETS, t.admin)).json().data as Json[]
    assert.equal(listed?.openMaintenanceCount, 1)
    assert.equal(ok(await get(`${ASSETS}/${String(asset.id)}`, t.admin)).openMaintenanceCount, 1)
    const audits = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'maintenance.report')))
    assert.equal(audits.length, 2)
    assert.equal(JSON.stringify(audits).includes('Projektör'), false)
    assert.equal(JSON.stringify(audits).includes('assetId'), true)
  })

  test('DOM-FIN-089: bilinmeyen ya da hurdaya ayrılmış etiket, olmayan kampüs 422; 400 ve talep yazılmaz (K-236)', async () => {
    const t = await institution()
    const asset = await createAsset(t)
    assertError(
      await report(t.admin, { ...REPORT, assetTagNumber: 'DB-1999-0001' }),
      422,
      'maintenance_asset_not_found',
    )
    assertError(
      await report(t.admin, { ...REPORT, campusId: 'yok-kampus' }),
      422,
      'maintenance_campus_not_found',
    )
    assertError(await report(t.admin, { ...REPORT, title: 'x' }), 400)
    assertError(await report(t.admin, { ...REPORT, priority: 'critical' }), 400)
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
      await report(t.admin, { ...REPORT, assetTagNumber: asset.tagNumber }),
      422,
      'maintenance_asset_scrapped',
    )
    assert.equal((await rowsOf(t.id)).length, 0)
    assert.equal((await eventsOf(t.id)).length, 0)
  })

  test('DOM-FIN-089: iş emri atanır, başlatılır, maliyet ve tedarikçiyle çözülür, kapatılır; geçmiş satırları ve maliyet yalnız yöneticide (K-237, K-238)', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const vendor = await supplier(t)
    const asset = await createAsset(t)
    const teacher = await member(t.id, 'ogretmen')
    const desk = await member(t.id, 'onburo')
    let current = ok(await report(teacher, { ...REPORT, assetTagNumber: asset.tagNumber }), 201)

    current = ok(await step(t.admin, current, 'assign', { ...toStaff(selin), note: 'Bugün bakın' }))
    assert.equal(current.status, 'assigned')
    assert.deepEqual(current.assignee, { type: 'staff', id: selin, name: 'Selin Kaya' })
    current = ok(await step(t.admin, current, 'start'))
    assert.equal(current.status, 'in_progress')
    current = ok(
      await step(t.admin, current, 'assign', {
        assigneeType: 'supplier',
        supplierId: vendor.id,
      }),
    )
    assert.equal(current.status, 'in_progress')
    assert.deepEqual(current.assignee, {
      type: 'supplier',
      id: vendor.id,
      name: 'Beta Teknik Servis Ltd.',
    })
    current = ok(
      await step(t.admin, current, 'resolve', {
        ...RESOLVE,
        costCents: 125_000,
        supplierId: vendor.id,
      }),
    )
    assert.equal(current.status, 'resolved')
    assert.equal(current.resolutionCostCents, 125_000)
    assert.deepEqual(current.resolutionSupplier, { id: vendor.id, name: 'Beta Teknik Servis Ltd.' })
    assert.equal(ok(await get(`${ASSETS}/${String(asset.id)}`, t.admin)).openMaintenanceCount, 0)
    current = ok(await step(t.admin, current, 'close', { note: 'Kontrol edildi' }))
    assert.equal(current.status, 'closed')
    assert.equal(current.version, 6)
    const events = current.events as Json[]
    assert.deepEqual(
      events.map((event) => [event.event, event.fromStatus, event.toStatus]),
      [
        ['reported', null, 'open'],
        ['assigned', 'open', 'assigned'],
        ['started', 'assigned', 'in_progress'],
        ['assigned', 'in_progress', 'in_progress'],
        ['resolved', 'in_progress', 'resolved'],
        ['closed', 'resolved', 'closed'],
      ],
    )
    assert.equal(events[1]?.note, 'Bugün bakın')
    assert.deepEqual(events[1]?.assignee, { type: 'staff', id: selin, name: 'Selin Kaya' })
    assert.equal(events[4]?.note, 'Lamba değiştirildi.')
    assert.equal(typeof events[2]?.actorName, 'string')

    for (const cookie of [desk, teacher]) {
      const seen = ok(await get(`${REQUESTS}/${String(current.id)}`, cookie))
      assert.equal('resolutionCostCents' in seen, false)
      assert.equal(seen.resolution, 'Lamba değiştirildi.')
      const [listed] = (await listOf(cookie)).data
      assert.equal(listed !== undefined && 'resolutionCostCents' in listed, false)
    }
    const [row] = await rowsOf(t.id)
    assert.equal(row?.resolutionCostCents, 125_000)
    assert.equal(row?.resolvedDate, TODAY)
    assert.equal(row?.closedAt?.toISOString(), FIXED_NOW.toISOString())
    const audits = await db
      .select({ action: auditLog.action, changes: auditLog.changes })
      .from(auditLog)
      .where(eq(auditLog.institutionId, t.id))
    assert.equal(JSON.stringify(audits).includes('125000'), false)
    assert.equal(JSON.stringify(audits).includes('Lamba'), false)
    assert.equal(audits.filter((audit) => audit.action.startsWith('maintenance.')).length, 6)

    assertError(
      await step(t.admin, current, 'assign', toStaff(selin)),
      422,
      'maintenance_status_invalid',
    )
    assertError(
      await step(t.admin, current, 'cancel', { reason: 'Gerek kalmadı' }),
      422,
      'maintenance_status_invalid',
    )
  })

  test('DOM-FIN-089: atama personel ve tedarikçi kurallarına uyar; geçersiz geçiş 422, eski sürüm 409; talep değişmez (K-237)', async () => {
    const t = await institution()
    const parentMembership = await staff(t, 'veli', 'Ayşe Yılmaz')
    const ahmet = await staff(t, 'onburo', 'Ahmet Ak')
    await db.update(memberships).set({ deactivatedAt: FIXED_NOW }).where(eq(memberships.id, ahmet))
    const vendor = await supplier(t)
    await db
      .update(suppliers)
      .set({ isActive: false })
      .where(eq(suppliers.id, String(vendor.id)))
    const created = ok(await report(t.admin), 201)

    assertError(
      await step(t.admin, created, 'assign', toStaff(parentMembership)),
      422,
      'maintenance_assignee_not_staff',
    )
    assertError(
      await step(t.admin, created, 'assign', toStaff(ahmet)),
      422,
      'maintenance_assignee_inactive',
    )
    assertError(
      await step(t.admin, created, 'assign', toStaff('yok-uyelik')),
      422,
      'maintenance_assignee_not_found',
    )
    assertError(
      await step(t.admin, created, 'assign', { assigneeType: 'supplier', supplierId: vendor.id }),
      422,
      'maintenance_supplier_inactive',
    )
    assertError(
      await step(t.admin, created, 'assign', {
        assigneeType: 'supplier',
        supplierId: randomUUID(),
      }),
      422,
      'maintenance_supplier_not_found',
    )
    assertError(await step(t.admin, created, 'start'), 422, 'maintenance_status_invalid')
    assertError(await step(t.admin, created, 'resolve', RESOLVE), 422, 'maintenance_status_invalid')
    assertError(await step(t.admin, created, 'close'), 422, 'maintenance_status_invalid')
    assertError(await step(t.admin, created, 'assign', { assigneeType: 'staff' }), 400)
    assertError(
      await call('POST', `${REQUESTS}/${String(created.id)}/start`, t.admin, {}),
      400,
      'if_match_required',
    )
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const assigned = ok(await step(t.admin, created, 'assign', toStaff(selin)))
    assertError(await step(t.admin, created, 'start'), 409)
    assertError(
      await step(t.admin, assigned, 'assign', toStaff(selin)),
      422,
      'maintenance_same_assignee',
    )
    assertError(
      await step(t.admin, assigned, 'resolve', { ...RESOLVE, resolvedDate: '2026-10-07' }),
      422,
      'maintenance_date_in_future',
    )
    assertError(
      await step(t.admin, assigned, 'resolve', { ...RESOLVE, resolvedDate: '2026-10-05' }),
      422,
      'maintenance_resolved_before_report',
    )
    assertError(
      await step(t.admin, assigned, 'resolve', { ...RESOLVE, supplierId: randomUUID() }),
      422,
      'maintenance_supplier_not_found',
    )
    const resolved = ok(
      await step(t.admin, assigned, 'resolve', { ...RESOLVE, supplierId: vendor.id }),
    )
    assert.equal((resolved.resolutionSupplier as Json).id, vendor.id)
    const [row] = await rowsOf(t.id)
    assert.equal(row?.status, 'resolved')
    assert.equal(row?.version, 3)
    assert.equal((await eventsOf(t.id)).length, 3)
  })

  test('DOM-FIN-089: öğretmen yalnız kendi bildirimini görür ve atanmamışken iptal eder; ön büro başkasınınkini iptal edemez (K-237, K-238)', async () => {
    const t = await institution()
    const first = await member(t.id, 'ogretmen')
    const second = await member(t.id, 'ogretmen')
    const desk = await member(t.id, 'onburo')
    const own = ok(await report(first, { ...REPORT, title: 'Pencere kolu kırık' }), 201)
    const other = ok(await report(second, { ...REPORT, title: 'Musluk damlatıyor' }), 201)
    ok(await report(t.admin, { ...REPORT, title: 'Klima su akıtıyor' }), 201)

    const mine = await listOf(first)
    assert.equal(mine.meta.total, 1)
    assert.equal(mine.data[0]?.id, own.id)
    assertError(await get(`${REQUESTS}/${String(other.id)}`, first), 404)
    assertError(await step(first, other, 'cancel', { reason: 'Yanlış bildirim' }), 404)
    assert.equal((await listOf(desk)).meta.total, 3)
    assert.equal((await listOf(t.admin)).meta.total, 3)

    assertError(
      await step(desk, own, 'cancel', { reason: 'Yanlış bildirim' }),
      403,
      'maintenance_not_owner',
    )
    assertError(await step(first, own, 'cancel', { reason: 'yok' }), 400)
    const cancelled = ok(await step(first, own, 'cancel', { reason: 'Yanlış bildirim' }))
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.cancelReason, 'Yanlış bildirim')
    assert.equal((cancelled.actions as Json).cancel, false)

    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const assigned = ok(await step(t.admin, other, 'assign', toStaff(selin)))
    assertError(
      await step(second, assigned, 'cancel', { reason: 'Kendiliğinden düzeldi' }),
      422,
      'maintenance_not_cancellable',
    )
    const byManager = ok(
      await step(t.admin, assigned, 'cancel', { reason: 'Kendiliğinden düzeldi' }),
    )
    assert.equal(byManager.status, 'cancelled')
  })

  test('DOM-FIN-089: liste arama, durum, öncelik ve demirbaş süzgeçli, sayfalı; bilinmeyen parametre 400', async () => {
    const t = await institution()
    const asset = await createAsset(t)
    ok(await report(t.admin, { ...REPORT, title: 'Çatı akıtıyor', priority: 'low' }), 201)
    ok(
      await report(t.admin, {
        ...REPORT,
        title: 'Projektör ses vermiyor',
        priority: 'urgent',
        assetTagNumber: asset.tagNumber,
      }),
      201,
    )
    const third = ok(await report(t.admin, { ...REPORT, title: 'Kapı kolu gevşek' }), 201)
    ok(await step(t.admin, third, 'cancel', { reason: 'Tamir edildi' }))

    const all = await listOf(t.admin)
    assert.deepEqual(
      all.data.map((item) => item.title),
      ['Projektör ses vermiyor', 'Çatı akıtıyor', 'Kapı kolu gevşek'],
    )
    assert.equal((await listOf(t.admin, '?q=catı')).meta.total, 1)
    assert.equal((await listOf(t.admin, '?q=AT-0003')).data[0]?.title, 'Kapı kolu gevşek')
    assert.equal((await listOf(t.admin, `?q=${String(asset.tagNumber)}`)).meta.total, 1)
    assert.equal((await listOf(t.admin, '?state=active')).meta.total, 2)
    assert.equal((await listOf(t.admin, '?state=done')).meta.total, 1)
    assert.equal((await listOf(t.admin, '?status=cancelled')).meta.total, 1)
    assert.equal((await listOf(t.admin, '?priority=urgent')).meta.total, 1)
    assert.equal((await listOf(t.admin, `?assetId=${String(asset.id)}`)).meta.total, 1)
    const paged = await listOf(t.admin, '?page=2&pageSize=2')
    assert.equal(paged.meta.total, 3)
    assert.equal(paged.data.length, 1)
    assertError(await get(`${REQUESTS}?sort=title`, t.admin), 400)
  })

  test('DOM-FIN-089: başka kurumun talebi 404 ve B değişmez; listede yok; B etiketi, üyeliği, tedarikçisi ve institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bAsset = await createAsset(b)
    const bStaff = await staff(b, 'ogretmen', 'Beta Öğretmen')
    const bVendor = await supplier(b)
    const bRequest = ok(await report(b.admin, { ...REPORT, assetTagNumber: bAsset.tagNumber }), 201)
    const bUrl = `${REQUESTS}/${String(bRequest.id)}`

    assertError(await get(bUrl, a.admin), 404)
    for (const [verb, body] of [
      ['assign', toStaff(bStaff)],
      ['start', {}],
      ['resolve', RESOLVE],
      ['close', {}],
      ['cancel', { reason: 'Başka kurum' }],
    ] as const)
      assertError(await step(a.admin, bRequest, verb, body), 404)
    assert.equal((await listOf(a.admin)).meta.total, 0)
    assert.equal((await listOf(a.admin, `?assetId=${String(bAsset.id)}`)).meta.total, 0)
    assertError(
      await report(a.admin, { ...REPORT, assetTagNumber: bAsset.tagNumber }),
      422,
      'maintenance_asset_not_found',
    )
    assertError(await report(a.admin, { ...REPORT, institutionId: b.id }), 400)
    const aRequest = ok(await report(a.admin), 201)
    assertError(
      await step(a.admin, aRequest, 'assign', toStaff(bStaff)),
      422,
      'maintenance_assignee_not_found',
    )
    assertError(
      await step(a.admin, aRequest, 'assign', { assigneeType: 'supplier', supplierId: bVendor.id }),
      422,
      'maintenance_supplier_not_found',
    )
    const [bRow] = await rowsOf(b.id)
    assert.equal(bRow?.status, 'open')
    assert.equal(bRow?.version, 1)
    assert.equal((await eventsOf(b.id)).length, 1)
    assert.equal((await rowsOf(a.id)).length, 1)
  })

  test('DOM-FIN-089: Idempotency-Key ile yinelenen bildirim ve geçiş aynı yanıtı döner, tek satır yazılır', async () => {
    const t = await institution()
    const headers = { 'idempotency-key': randomUUID() }
    const first = await report(t.admin, REPORT, headers)
    const second = await report(t.admin, REPORT, headers)
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.id, first.json().data.id)
    assert.equal((await rowsOf(t.id)).length, 1)

    const created = first.json().data as Json
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const stepHeaders = { ...ifMatch(created.version), 'idempotency-key': randomUUID() }
    const url = `${REQUESTS}/${String(created.id)}/assign`
    const once = await call('POST', url, t.admin, toStaff(selin), stepHeaders)
    const twice = await call('POST', url, t.admin, toStaff(selin), stepHeaders)
    assert.equal(once.statusCode, 200, once.body)
    assert.equal(twice.statusCode, 200, twice.body)
    assert.equal(twice.headers['idempotent-replayed'], 'true')
    assert.equal((await eventsOf(t.id)).length, 2)
  })
})
