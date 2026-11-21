import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  transportAssignments,
  transportRoutes,
  transportVehicles,
} from '../src/db/schema/finance-transport.ts'
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
 * Servis güzergâhı uçları (DOM-FIN-142; ON-098; IST-099; K-481, K-482). Her test kendi kurumunu
 * kurar. FIXED_NOW 2026-10-06T09:00Z.
 */

const BASE = '/api/v1/finance/transport'
const VEHICLES = `${BASE}/vehicles`
const ROUTES = `${BASE}/routes`
const MY = `${BASE}/my`

const SEED = createSeed(FIXED_NOW)

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-142: servis güzergâhı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.98.0.1'

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
  const post = (url: string, cookie: string | null, body: unknown, key = randomUUID()) =>
    call('POST', url, cookie, body, { 'idempotency-key': key })
  const patch = (url: string, cookie: string, body: unknown, version: unknown) =>
    call('PATCH', url, cookie, body, { 'if-match': `"${String(version)}"` })
  const remove = (url: string, cookie: string, version: unknown) =>
    call('DELETE', url, cookie, undefined, { 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.98.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const students = SEED.students.filter((row) => ['s1', 's2', 's3'].includes(row.id))
    await insertMissingRecords(
      db,
      created.id,
      [
        ...students.map((student) => ({
          collection: 'students' as const,
          id: student.id,
          data: { ...student },
        })),
        {
          collection: 'students' as const,
          id: 'test-s-left',
          data: { ...students[0], id: 'test-s-left', name: 'Ayrılan Öğrenci', isActive: false },
        },
      ],
      FIXED_NOW,
    )
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  const member = async (
    institutionId: string,
    role: Parameters<typeof createMember>[2],
    links: Parameters<typeof createMember>[3] = [],
  ) => signInAs(app, await createMember(app, institutionId, role, links))

  const vehicleBody = (extra: Json = {}) => ({
    plate: '34 KMP 101',
    capacity: 2,
    driverName: 'Ali Sürücü',
    driverPhone: '0532 123 45 67',
    ...extra,
  })
  const routeBody = (vehicleId: unknown, extra: Json = {}) => ({
    name: 'Moda hattı',
    direction: 'morning',
    vehicleId,
    stops: [
      { name: 'Moda', time: '07:10' },
      { name: 'Bahariye', time: '07:25' },
    ],
    ...extra,
  })
  async function setup(t: Tenant, vehicle: Json = {}) {
    const createdVehicle = ok(await post(VEHICLES, t.admin, vehicleBody(vehicle)), 201)
    const route = ok(await post(ROUTES, t.admin, routeBody(createdVehicle.id)), 201)
    const stops = route.stops as { id: string; name: string }[]
    return { vehicle: createdVehicle, route, stops }
  }
  const assignUrl = (routeId: unknown) => `${ROUTES}/${String(routeId)}/assignments`
  const assignmentRows = (institutionId: string) =>
    db
      .select()
      .from(transportAssignments)
      .where(eq(transportAssignments.institutionId, institutionId))

  test('kimliksiz istek 401', async () => {
    assertError(await get(VEHICLES, null), 401)
    assertError(await post(VEHICLES, null, {}), 401)
    assertError(await get(ROUTES, null), 401)
    assertError(await post(ROUTES, null, {}), 401)
    assertError(await get(MY, null), 401)
  })

  test('DOM-FIN-142: öğretmen ve veli yönetim uçlarında 403; ön büro yazar; modül kapalı 403 (K-482)', async () => {
    const t = await institution()
    const teacher = await member(t.id, 'ogretmen')
    const parent = await member(t.id, 'veli', [{ kind: 'child', recordId: 's1' }])
    assertError(await get(VEHICLES, teacher), 403)
    assertError(await post(VEHICLES, teacher, vehicleBody()), 403)
    assertError(await get(ROUTES, parent), 403)
    assertError(await get(MY, teacher), 403)
    assertError(await get(MY, t.admin), 403)
    const desk = await member(t.id, 'onburo')
    const vehicle = ok(await post(VEHICLES, desk, vehicleBody()), 201)
    ok(await post(ROUTES, desk, routeBody(vehicle.id)), 201)
    assert.equal((await get(ROUTES, desk)).json().meta.total, 1)
    const closed = await institution({ enabledModules: { transport: false } })
    assertError(await get(VEHICLES, closed.admin), 403, 'module_disabled')
    assertError(await post(VEHICLES, closed.admin, vehicleBody()), 403, 'module_disabled')
  })

  test('DOM-FIN-142: araç kaydı, maskeli telefon, mükerrer istek ve plaka tekilliği (K-481)', async () => {
    const t = await institution()
    const desk = await createMember(app, t.id, 'onburo')
    const parent = await createMember(app, t.id, 'veli')
    assertError(await post(VEHICLES, t.admin, vehicleBody({ plate: '99 X 1' })), 400)
    assertError(await post(VEHICLES, t.admin, vehicleBody({ address: 'Moda Cad. 5' })), 400)
    assertError(
      await call('POST', VEHICLES, t.admin, vehicleBody()),
      400,
      'idempotency_key_required',
    )
    assertError(
      await post(VEHICLES, t.admin, vehicleBody({ guideMembershipId: parent.membershipId })),
      422,
      'transport_guide_not_staff',
    )
    assertError(
      await post(VEHICLES, t.admin, vehicleBody({ guideMembershipId: 'test-yok' })),
      422,
      'transport_guide_not_found',
    )
    const rows = () =>
      db.select().from(transportVehicles).where(eq(transportVehicles.institutionId, t.id))
    assert.equal((await rows()).length, 0)

    const key = randomUUID()
    const body = vehicleBody({ guideMembershipId: desk.membershipId })
    const created = ok(await post(VEHICLES, t.admin, body, key), 201)
    assert.equal(created.plate, '34KMP101')
    assert.equal(created.driverPhoneMasked, '0532 *** ** 67')
    assert.equal('driverPhone' in created, false)
    assert.equal(typeof created.guideName, 'string')
    const replay = await post(VEHICLES, t.admin, body, key)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await rows()).length, 1)
    assertError(
      await post(VEHICLES, t.admin, vehicleBody({ plate: '34kmp101' })),
      409,
      'transport_plate_taken',
    )
    const list = (await get(VEHICLES, t.admin)).json()
    assert.equal(list.meta.total, 1)
    assert.equal(list.data[0].driverPhoneMasked, '0532 *** ** 67')
    assert.ok(!JSON.stringify(list).includes('05321234567'))

    const url = `${VEHICLES}/${String(created.id)}`
    assertError(await patch(url, t.admin, { capacity: 3 }, 99), 409)
    const changed = ok(
      await patch(url, t.admin, { capacity: 3, driverPhone: '05559998877' }, created.version),
    )
    assert.equal(changed.capacity, 3)
    assert.equal(changed.driverPhoneMasked, '0555 *** ** 77')
    assertError(
      await patch(url, t.admin, { capacity: 3 }, changed.version),
      422,
      'transport_vehicle_unchanged',
    )
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.entityType, 'transport_vehicles')))
    assert.deepEqual(audits.map((row) => row.action).sort(), [
      'finance.transport.vehicle_create',
      'finance.transport.vehicle_update',
    ])
    assert.ok(!JSON.stringify(audits).includes('0555'))
    ok(await remove(url, t.admin, changed.version))
    assert.equal((await get(VEHICLES, t.admin)).json().meta.total, 0)
  })

  test('DOM-FIN-142: güzergâh, sıralı duraklar ve durak düzenleme (K-481)', async () => {
    const t = await institution()
    const { vehicle, route, stops } = await setup(t)
    assert.equal(route.direction, 'morning')
    assert.deepEqual(
      stops.map((stop) => stop.name),
      ['Moda', 'Bahariye'],
    )
    assertError(
      await post(ROUTES, t.admin, routeBody(vehicle.id)),
      409,
      'transport_route_name_taken',
    )
    ok(await post(ROUTES, t.admin, routeBody(vehicle.id, { direction: 'evening' })), 201)
    assertError(
      await post(ROUTES, t.admin, routeBody(randomUUID(), { name: 'Başka hat' })),
      422,
      'transport_vehicle_not_found',
    )
    assertError(
      await post(
        ROUTES,
        t.admin,
        routeBody(vehicle.id, {
          name: 'Ters hat',
          stops: [
            { name: 'A durağı', time: '08:00' },
            { name: 'B durağı', time: '07:00' },
          ],
        }),
      ),
      400,
    )
    const listed = (await get(`${ROUTES}?direction=morning`, t.admin)).json()
    assert.equal(listed.meta.total, 1)
    assert.equal(listed.data[0].firstStopTime, '07:10')
    assertError(await get(`${ROUTES}?unknown=1`, t.admin), 400)

    const url = `${ROUTES}/${String(route.id)}`
    assertError(await patch(url, t.admin, { direction: 'evening' }, route.version), 400)
    const [moda, bahariye] = stops
    assert.ok(moda && bahariye)
    const updated = ok(
      await patch(
        url,
        t.admin,
        {
          stops: [
            { id: moda.id, name: 'Moda İskele', time: '07:05' },
            { name: 'Altıyol', time: '07:15' },
          ],
        },
        route.version,
      ),
    )
    const after = updated.stops as { id: string; name: string; position: number }[]
    assert.deepEqual(
      after.map((stop) => [stop.name, stop.position]),
      [
        ['Moda İskele', 1],
        ['Altıyol', 2],
      ],
    )
    assert.equal(after[0]?.id, moda.id)
    assertError(
      await patch(
        url,
        t.admin,
        { stops: [{ id: bahariye.id, name: 'Bahariye', time: '07:25' }] },
        updated.version,
      ),
      422,
      'transport_stop_not_found',
    )
  })

  test('DOM-FIN-142: öğrenci–durak ataması; kapasite ve aynı yön 409, kaldırma ve arşiv kuralları (K-482)', async () => {
    const t = await institution()
    const { vehicle, route, stops } = await setup(t)
    const [moda, bahariye] = stops
    assert.ok(moda && bahariye)
    const url = assignUrl(route.id)
    assertError(
      await post(url, t.admin, { studentId: 'test-yok', stopId: moda.id }),
      422,
      'transport_student_not_found',
    )
    assertError(
      await post(url, t.admin, { studentId: 'test-s-left', stopId: moda.id }),
      422,
      'transport_student_inactive',
    )
    assertError(
      await post(url, t.admin, { studentId: 's1', stopId: randomUUID() }),
      422,
      'transport_stop_not_on_route',
    )
    assert.equal((await assignmentRows(t.id)).length, 0)

    const key = randomUUID()
    const first = ok(await post(url, t.admin, { studentId: 's1', stopId: moda.id }, key), 201)
    assert.equal(first.studentName, 'Deniz Yılmaz')
    assert.equal(first.stopName, 'Moda')
    const replay = await post(url, t.admin, { studentId: 's1', stopId: moda.id }, key)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(
      await post(url, t.admin, { studentId: 's1', stopId: bahariye.id }),
      409,
      'transport_student_already_assigned',
    )
    ok(await post(url, t.admin, { studentId: 's2', stopId: bahariye.id }), 201)
    assertError(
      await post(url, t.admin, { studentId: 's3', stopId: bahariye.id }),
      409,
      'transport_capacity_full',
    )
    assert.equal((await assignmentRows(t.id)).length, 2)

    const other = ok(
      await post(VEHICLES, t.admin, vehicleBody({ plate: '34 KMP 202', capacity: 10 })),
      201,
    )
    const second = ok(
      await post(ROUTES, t.admin, routeBody(other.id, { name: 'Kadıköy hattı' })),
      201,
    )
    const secondStop = (second.stops as { id: string }[])[0]
    assert.ok(secondStop)
    assertError(
      await post(assignUrl(second.id), t.admin, { studentId: 's1', stopId: secondStop.id }),
      409,
      'transport_student_direction_taken',
    )
    const evening = ok(
      await post(ROUTES, t.admin, routeBody(other.id, { direction: 'evening' })),
      201,
    )
    const eveningStop = (evening.stops as { id: string }[])[0]
    assert.ok(eveningStop)
    ok(await post(assignUrl(evening.id), t.admin, { studentId: 's1', stopId: eveningStop.id }), 201)

    const vehicleUrl = `${VEHICLES}/${String(vehicle.id)}`
    assertError(
      await patch(vehicleUrl, t.admin, { capacity: 1 }, vehicle.version),
      422,
      'transport_capacity_below_load',
    )
    assertError(await remove(vehicleUrl, t.admin, vehicle.version), 422, 'transport_vehicle_in_use')
    const routeUrl = `${ROUTES}/${String(route.id)}`
    const detail = ok(await get(routeUrl, t.admin))
    assertError(
      await patch(
        routeUrl,
        t.admin,
        { stops: [{ id: bahariye.id, name: 'Bahariye', time: '07:25' }] },
        detail.version,
      ),
      422,
      'transport_stop_has_students',
    )
    const small = ok(
      await post(VEHICLES, t.admin, vehicleBody({ plate: '34 KMP 303', capacity: 1 })),
      201,
    )
    assertError(
      await patch(routeUrl, t.admin, { vehicleId: small.id }, detail.version),
      422,
      'transport_capacity_below_load',
    )
    assertError(
      await remove(routeUrl, t.admin, detail.version),
      422,
      'transport_route_has_students',
    )

    for (const row of detail.assignments as { id: string; version: number }[])
      ok(await remove(`${BASE}/assignments/${row.id}`, t.admin, row.version))
    assertError(await remove(`${BASE}/assignments/${first.id as string}`, t.admin, 1), 404)
    ok(await remove(routeUrl, t.admin, detail.version))
    assertError(await get(routeUrl, t.admin), 404)
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'finance.transport.assign')))
    assert.equal(audits.length, 3)
    assert.ok(!JSON.stringify(audits).includes('"s1"'))
  })

  test('DOM-FIN-142: veli yalnız kendi çocuğunun, öğrenci yalnız kendi servisini görür (K-482)', async () => {
    const t = await institution()
    const { route, stops } = await setup(t)
    const [moda, bahariye] = stops
    assert.ok(moda && bahariye)
    ok(await post(assignUrl(route.id), t.admin, { studentId: 's1', stopId: moda.id }), 201)
    ok(await post(assignUrl(route.id), t.admin, { studentId: 's2', stopId: bahariye.id }), 201)
    const parent = await member(t.id, 'veli', [{ kind: 'child', recordId: 's1' }])
    const mine = ok(await get(MY, parent)) as unknown as Json[]
    assert.equal(mine.length, 1)
    assert.equal(mine[0]?.studentId, 's1')
    assert.equal(mine[0]?.stopName, 'Moda')
    assert.equal(mine[0]?.stopTime, '07:10')
    assert.equal(mine[0]?.direction, 'morning')
    assert.equal(mine[0]?.driverPhoneMasked, '0532 *** ** 67')
    const student = await member(t.id, 'ogrenci', [{ kind: 'student', recordId: 's2' }])
    const own = ok(await get(MY, student)) as unknown as Json[]
    assert.deepEqual(
      own.map((row) => row.studentId),
      ['s2'],
    )
    const stranger = await member(t.id, 'veli')
    assert.deepEqual(ok(await get(MY, stranger)), [])
  })

  test('DOM-FIN-142: başka kurumun aracı, güzergâhı ve ataması 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bSetup = await setup(b)
    const bStop = bSetup.stops[0]
    assert.ok(bStop)
    const bAssignment = ok(
      await post(assignUrl(bSetup.route.id), b.admin, { studentId: 's1', stopId: bStop.id }),
      201,
    )
    const bVehicleUrl = `${VEHICLES}/${String(bSetup.vehicle.id)}`
    const bRouteUrl = `${ROUTES}/${String(bSetup.route.id)}`
    assertError(await patch(bVehicleUrl, a.admin, { capacity: 5 }, bSetup.vehicle.version), 404)
    assertError(await remove(bVehicleUrl, a.admin, bSetup.vehicle.version), 404)
    assertError(await get(bRouteUrl, a.admin), 404)
    assertError(await patch(bRouteUrl, a.admin, { name: 'Ele geçen' }, bSetup.route.version), 404)
    assertError(await remove(bRouteUrl, a.admin, bSetup.route.version), 404)
    assertError(
      await post(assignUrl(bSetup.route.id), a.admin, { studentId: 's2', stopId: bStop.id }),
      404,
    )
    assertError(
      await remove(`${BASE}/assignments/${String(bAssignment.id)}`, a.admin, bAssignment.version),
      404,
    )
    assert.equal((await get(VEHICLES, a.admin)).json().meta.total, 0)
    // Aynı öğrenci kimliği (s1) B'de atanmış; A'nın velisi B'nin atamasını görmez.
    const aParent = await member(a.id, 'veli', [{ kind: 'child', recordId: 's1' }])
    assert.deepEqual(ok(await get(MY, aParent)), [])
    assert.equal((await get(ROUTES, a.admin)).json().meta.total, 0)
    assertError(await post(VEHICLES, a.admin, vehicleBody({ institutionId: b.id })), 400)
    // A'da B aracının plakası serbesttir; B'nin aracına güzergâh açılamaz.
    const aVehicle = ok(await post(VEHICLES, a.admin, vehicleBody()), 201)
    assertError(
      await post(ROUTES, a.admin, routeBody(bSetup.vehicle.id)),
      422,
      'transport_vehicle_not_found',
    )
    const aRoute = ok(await post(ROUTES, a.admin, routeBody(aVehicle.id)), 201)
    assertError(
      await post(assignUrl(aRoute.id), a.admin, { studentId: 's1', stopId: bStop.id }),
      422,
      'transport_stop_not_on_route',
    )
    const [bVehicle] = await db
      .select()
      .from(transportVehicles)
      .where(eq(transportVehicles.institutionId, b.id))
    assert.equal(bVehicle?.capacity, 2)
    assert.equal(bVehicle?.version, bSetup.vehicle.version)
    const [bRoute] = await db
      .select()
      .from(transportRoutes)
      .where(eq(transportRoutes.institutionId, b.id))
    assert.equal(bRoute?.name, 'Moda hattı')
    assert.equal(bRoute?.archivedAt, null)
    const bRows = await assignmentRows(b.id)
    assert.equal(bRows.length, 1)
    assert.equal(bRows[0]?.archivedAt, null)
  })
})
