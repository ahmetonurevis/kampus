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
  transportTripMarkCorrections,
  transportTripMarks,
  transportTrips,
} from '../src/db/schema/finance-transport-trips.ts'
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
 * Servis seferi ve biniş-iniş uçları (DOM-FIN-149; ON-145; IST-144; K-502…K-504). Her test kendi
 * kurumunu kurar. FIXED_NOW 2026-10-06T09:00Z (İstanbul 12:00); seferin günü 2026-10-06.
 */

const BASE = '/api/v1/finance/transport'
const TRIPS = `${BASE}/trips`
const MY = `${TRIPS}/my`
const DAY = '2026-10-06'

const SEED = createSeed(FIXED_NOW)

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>
type Roster = { studentId: string; status: string; stopName: string; [key: string]: unknown }[]

describe('DOM-FIN-149: servis seferi ve biniş-iniş uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.145.0.1'

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
  const post = (url: string, cookie: string | null, body: unknown, key = randomUUID()) =>
    call('POST', url, cookie, body, { 'idempotency-key': key })
  const closeTripAs = (cookie: string | null, tripId: unknown, version: unknown) =>
    call(
      'POST',
      `${TRIPS}/${String(tripId)}/close`,
      cookie,
      {},
      { 'if-match': `"${String(version)}"` },
    )
  const startUrl = (routeId: unknown) => `${BASE}/routes/${String(routeId)}/trips`
  const markUrl = (tripId: unknown) => `${TRIPS}/${String(tripId)}/marks`
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const roster = (trip: Json) => trip.roster as Roster
  const statusOf = (trip: Json, studentId: string) =>
    roster(trip).find((row) => row.studentId === studentId)?.status

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.145.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const students = SEED.students.filter((row) => ['s1', 's2', 's3'].includes(row.id))
    await insertMissingRecords(
      db,
      created.id,
      students.map((student) => ({
        collection: 'students' as const,
        id: student.id,
        data: { ...student },
      })),
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

  /**
   * Araç (rehber verilirse rehberli), sabah güzergâhı (Moda 07:10, Bahariye 07:25) ve iki atama:
   * s1 Bahariye, s2 Moda. s3 atanmaz.
   */
  async function setup(t: Tenant, guideRole: 'onburo' | 'ogretmen' | null = 'onburo') {
    const guideUser = guideRole === null ? null : await createMember(app, t.id, guideRole)
    const vehicle = ok(
      await post(`${BASE}/vehicles`, t.admin, {
        plate: `34 KMP ${String(100 + tenantCount)}`,
        capacity: 10,
        driverName: 'Ali Sürücü',
        driverPhone: '05321234567',
        guideMembershipId: guideUser?.membershipId ?? null,
      }),
      201,
    )
    const route = ok(
      await post(`${BASE}/routes`, t.admin, {
        name: 'Moda hattı',
        direction: 'morning',
        vehicleId: vehicle.id,
        stops: [
          { name: 'Moda', time: '07:10' },
          { name: 'Bahariye', time: '07:25' },
        ],
      }),
      201,
    )
    const [moda, bahariye] = route.stops as { id: string }[]
    const assign = (studentId: string, stopId: string | undefined) =>
      post(`${BASE}/routes/${String(route.id)}/assignments`, t.admin, { studentId, stopId })
    ok(await assign('s1', bahariye?.id), 201)
    ok(await assign('s2', moda?.id), 201)
    const guide = guideUser === null ? null : await signInAs(app, guideUser)
    return { vehicle, route, guide }
  }
  const tripRows = (institutionId: string) =>
    db.select().from(transportTrips).where(eq(transportTrips.institutionId, institutionId))
  const markRows = (institutionId: string) =>
    db.select().from(transportTripMarks).where(eq(transportTripMarks.institutionId, institutionId))
  const audits = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    assertError(await get(TRIPS, null), 401)
    assertError(await get(`${TRIPS}/${id}`, null), 401)
    assertError(await get(MY, null), 401)
    assertError(await post(startUrl(id), null, {}), 401)
    assertError(await post(markUrl(id), null, { studentId: 's1', status: 'absent' }), 401)
    assertError(await closeTripAs(null, id, 1), 401)
  })

  test('DOM-FIN-149: veli yönetim uçlarında, personel veli ucunda 403; modül kapalı 403 (K-502)', async () => {
    const t = await institution()
    const parent = await member(t.id, 'veli', [{ kind: 'child', recordId: 's1' }])
    assertError(await get(TRIPS, parent), 403)
    assertError(await post(startUrl(randomUUID()), parent, {}), 403)
    assertError(await get(MY, t.admin), 403)
    const closed = await institution({ enabledModules: { transport: false } })
    assertError(await get(TRIPS, closed.admin), 403, 'module_disabled')
    assertError(await post(startUrl(randomUUID()), closed.admin, {}), 403, 'module_disabled')
  })

  test('DOM-FIN-149: sefer günde bir kez başlar; mükerrer istek aynı seferi döner (K-502)', async () => {
    const t = await institution()
    const { route, vehicle } = await setup(t)
    assertError(
      await call('POST', startUrl(route.id), t.admin, {}),
      400,
      'idempotency_key_required',
    )
    assertError(await post(startUrl(route.id), t.admin, { tripDate: '2026-10-07' }), 400)
    assert.equal((await tripRows(t.id)).length, 0)
    const key = randomUUID()
    const first = await post(startUrl(route.id), t.admin, {}, key)
    const trip = ok(first, 201)
    assert.equal(first.headers.location, `${TRIPS}/${String(trip.id)}`)
    assert.equal(trip.tripDate, DAY)
    assert.equal(trip.direction, 'morning')
    assert.equal(trip.status, 'open')
    assert.equal(trip.vehiclePlate, String(vehicle.plate))
    assert.equal(trip.canOperate, true)
    assert.deepEqual(
      roster(trip).map((row) => [row.studentId, row.stopName, row.status]),
      [
        ['s2', 'Moda', 'pending'],
        ['s1', 'Bahariye', 'pending'],
      ],
      'liste durak sırasına göre',
    )
    const replay = await post(startUrl(route.id), t.admin, {}, key)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(ok(replay, 201).id, trip.id)
    assertError(await post(startUrl(route.id), t.admin, {}), 409, 'transport_trip_exists')
    assert.equal((await tripRows(t.id)).length, 1)
    assert.equal((await audits(t.id, 'finance.transport.trip_start')).length, 1)
    assertError(await post(startUrl(randomUUID()), t.admin, {}), 404)
  })

  test('DOM-FIN-149: rehber yalnız kendi güzergâhını yürütür; ön büro okur, öğretmen görmez (K-502)', async () => {
    const t = await institution()
    const { route, guide } = await setup(t, 'ogretmen')
    assert.ok(guide)
    const desk = await member(t.id, 'onburo')
    const teacher = await member(t.id, 'ogretmen')
    // Rehber olmayan öğretmen güzergâhı görmez; ön büro görür ama yürütmez.
    assert.equal((await get(TRIPS, teacher)).json().meta.total, 0)
    assertError(await post(startUrl(route.id), teacher, {}), 404)
    const deskList = await get(TRIPS, desk)
    assert.equal(deskList.json().meta.total, 1)
    assert.equal(deskList.json().data[0].canOperate, false)
    assertError(await post(startUrl(route.id), desk, {}), 403, 'transport_trip_not_guide')
    assert.equal((await tripRows(t.id)).length, 0)

    const trip = ok(await post(startUrl(route.id), guide, {}), 201)
    assertError(await get(`${TRIPS}/${String(trip.id)}`, teacher), 404)
    assertError(await post(markUrl(trip.id), teacher, { studentId: 's1', status: 'absent' }), 404)
    const deskView = ok(await get(`${TRIPS}/${String(trip.id)}`, desk))
    assert.equal(deskView.canOperate, false)
    assertError(
      await post(markUrl(trip.id), desk, { studentId: 's1', status: 'absent' }),
      403,
      'transport_trip_not_guide',
    )
    assert.equal((await markRows(t.id)).length, 0)
    const marked = ok(await post(markUrl(trip.id), guide, { studentId: 's1', status: 'boarded' }))
    assert.equal(statusOf(marked, 's1'), 'boarded')
    const guideList = (await get(TRIPS, guide)).json()
    assert.equal(guideList.meta.total, 1)
    assert.equal(guideList.data[0].canOperate, true)
  })

  test('DOM-FIN-149: bindi, indi, gelmedi işaretleri; kural ihlalinde kayıt değişmez (K-502)', async () => {
    const t = await institution()
    const { route, guide } = await setup(t)
    assert.ok(guide)
    const trip = ok(await post(startUrl(route.id), guide, {}), 201)
    const url = markUrl(trip.id)
    assertError(await call('POST', url, guide, { studentId: 's1', status: 'boarded' }), 400)
    assertError(await post(url, guide, { studentId: 's1', status: 'boarded', latitude: 41 }), 400)
    assertError(
      await post(url, guide, { studentId: 's1', status: 'alighted' }),
      422,
      'transport_mark_not_boarded',
    )
    assertError(
      await post(url, guide, { studentId: 's3', status: 'absent' }),
      422,
      'transport_trip_student_not_on_route',
    )
    assertError(
      await post(url, guide, {
        studentId: 's1',
        status: 'boarded',
        boardedAt: '2026-10-06T10:00:00Z',
      }),
      422,
      'transport_mark_future',
    )
    assertError(
      await post(url, guide, {
        studentId: 's1',
        status: 'boarded',
        boardedAt: '2026-10-05T07:10:00+03:00',
      }),
      422,
      'transport_mark_other_day',
    )
    assert.equal((await markRows(t.id)).length, 0)

    // Çevrimdışı işaret: cihazın biniş anı saklanır; aynı anahtarla yeniden deneme tekrarlanır.
    const key = randomUUID()
    const offline = { studentId: 's1', status: 'boarded', boardedAt: '2026-10-06T07:24:00+03:00' }
    const boarded = ok(await post(url, guide, offline, key))
    const s1 = roster(boarded).find((row) => row.studentId === 's1')
    assert.equal(s1?.boardedAt, '2026-10-06T04:24:00.000Z')
    const replay = await post(url, guide, offline, key)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    // Aynı işaret yeni anahtarla da değişiklik yazmaz (çift dokunma).
    ok(await post(url, guide, { studentId: 's1', status: 'boarded' }))
    assert.equal((await audits(t.id, 'finance.transport.trip_mark')).length, 1)
    assertError(
      await post(url, guide, {
        studentId: 's1',
        status: 'alighted',
        alightedAt: '2026-10-06T07:00:00+03:00',
      }),
      422,
      'transport_mark_alight_before_board',
    )
    ok(await post(url, guide, { studentId: 's2', status: 'absent' }))
    const alighted = ok(await post(url, guide, { studentId: 's1', status: 'alighted' }))
    assert.equal(statusOf(alighted, 's1'), 'alighted')
    assert.equal(
      roster(alighted).find((row) => row.studentId === 's1')?.alightedAt,
      FIXED_NOW.toISOString(),
    )
    assert.deepEqual(alighted.counts, {
      total: 2,
      pending: 0,
      boarded: 1,
      alighted: 1,
      absent: 1,
      onBoard: 0,
    })
    const [audit] = await audits(t.id, 'finance.transport.trip_mark')
    assert.deepEqual(audit?.changes, { fields: ['status', 'boardedAt'] })
    assert.doesNotMatch(JSON.stringify(audit), /s1|2026-10-06T04/)
  })

  test('DOM-FIN-149: araçta ya da işaretsiz öğrenci varken sefer kapanmaz (K-504)', async () => {
    const t = await institution()
    const { route, guide } = await setup(t)
    assert.ok(guide)
    const trip = ok(await post(startUrl(route.id), guide, {}), 201)
    ok(await post(markUrl(trip.id), guide, { studentId: 's1', status: 'boarded' }))
    const closeUrl = `${TRIPS}/${String(trip.id)}/close`
    assertError(await call('POST', closeUrl, guide, {}), 400, 'if_match_required')
    assertError(await closeTripAs(guide, trip.id, 1), 422, 'transport_trip_students_on_board')
    const summary = (await get(TRIPS, guide)).json().data[0]
    assert.equal(summary.trip.counts.onBoard, 1, 'özet araçtaki öğrenciyi uyarı olarak gösterir')
    ok(await post(markUrl(trip.id), guide, { studentId: 's1', status: 'alighted' }))
    assertError(await closeTripAs(guide, trip.id, 1), 422, 'transport_trip_unmarked')
    assert.equal((await tripRows(t.id))[0]?.status, 'open')
    ok(await post(markUrl(trip.id), guide, { studentId: 's2', status: 'absent' }))
    assertError(await closeTripAs(guide, trip.id, 9), 409, 'version_conflict')
    const closed = ok(await closeTripAs(guide, trip.id, 1))
    assert.equal(closed.status, 'closed')
    assert.equal(closed.closedAt, FIXED_NOW.toISOString())
    assert.equal(closed.canOperate, false)
    assertError(await closeTripAs(guide, trip.id, 2), 409, 'transport_trip_already_closed')
    assert.equal((await audits(t.id, 'finance.transport.trip_close')).length, 1)
  })

  test('DOM-FIN-149: kapanmış seferi yalnız yönetici gerekçeyle düzeltir (K-503)', async () => {
    const t = await institution()
    const { route, guide } = await setup(t)
    assert.ok(guide)
    const trip = ok(await post(startUrl(route.id), guide, {}), 201)
    ok(await post(markUrl(trip.id), guide, { studentId: 's1', status: 'absent' }))
    ok(await post(markUrl(trip.id), guide, { studentId: 's2', status: 'absent' }))
    ok(await closeTripAs(guide, trip.id, 1))
    const url = markUrl(trip.id)
    const before = await markRows(t.id)
    assertError(
      await post(url, guide, { studentId: 's1', status: 'alighted', reason: 'Rehber unuttu' }),
      422,
      'transport_trip_closed',
    )
    assertError(
      await post(url, t.admin, { studentId: 's1', status: 'absent' }),
      422,
      'transport_mark_reason_required',
    )
    assertError(
      await post(url, t.admin, { studentId: 's1', status: 'boarded', reason: 'Rehber unuttu' }),
      422,
      'transport_trip_closed_on_board',
    )
    assertError(
      await post(url, t.admin, { studentId: 's1', status: 'absent', reason: 'Rehber unuttu' }),
      422,
      'transport_mark_unchanged',
    )
    assertError(
      await post(url, t.admin, { studentId: 's3', status: 'absent', reason: 'Rehber unuttu' }),
      422,
      'transport_trip_student_not_on_route',
    )
    assert.deepEqual(await markRows(t.id), before)
    const fixed = ok(
      await post(url, t.admin, {
        studentId: 's1',
        status: 'alighted',
        boardedAt: '2026-10-06T07:24:00+03:00',
        alightedAt: '2026-10-06T07:50:00+03:00',
        reason: 'Rehber binişi işaretlemeyi unuttu',
      }),
    )
    const row = roster(fixed).find((entry) => entry.studentId === 's1')
    assert.equal(row?.status, 'alighted')
    assert.equal(row?.correctedAt, FIXED_NOW.toISOString())
    assert.equal(row?.correctionReason, 'Rehber binişi işaretlemeyi unuttu')
    assert.equal(fixed.canCorrect, true)
    const corrections = await db
      .select()
      .from(transportTripMarkCorrections)
      .where(eq(transportTripMarkCorrections.institutionId, t.id))
    assert.equal(corrections.length, 1)
    assert.equal(corrections[0]?.previousStatus, 'absent')
    assert.equal(corrections[0]?.status, 'alighted')
    // Gerekçe rehbere dönmez; denetim yalnız alan adlarını tutar.
    const guideView = ok(await get(`${TRIPS}/${String(trip.id)}`, guide))
    assert.equal(
      roster(guideView).find((entry) => entry.studentId === 's1')?.correctionReason,
      null,
    )
    const [audit] = await audits(t.id, 'finance.transport.trip_mark_correct')
    assert.deepEqual(audit?.changes, { fields: ['status', 'boardedAt', 'alightedAt', 'reason'] })
    assert.doesNotMatch(JSON.stringify(audit), /unuttu/)
  })

  test('DOM-FIN-149: günlük özet güzergâh başına seferi ve sayıları verir', async () => {
    const t = await institution()
    const { route, guide } = await setup(t)
    assert.ok(guide)
    const empty = (await get(TRIPS, t.admin)).json()
    assert.equal(empty.meta.total, 1)
    assert.equal(empty.data[0].trip, null)
    assert.equal(empty.data[0].assigned, 2)
    const trip = ok(await post(startUrl(route.id), guide, {}), 201)
    ok(await post(markUrl(trip.id), guide, { studentId: 's2', status: 'absent' }))
    const list = (await get(`${TRIPS}?date=${DAY}`, t.admin)).json()
    assert.equal(list.data[0].trip.id, trip.id)
    assert.deepEqual(list.data[0].trip.counts, {
      total: 2,
      pending: 1,
      boarded: 0,
      alighted: 0,
      absent: 1,
      onBoard: 0,
    })
    assert.equal((await get(`${TRIPS}?date=2026-10-05`, t.admin)).json().data[0].trip, null)
    assert.equal((await get(`${TRIPS}?direction=evening`, t.admin)).json().meta.total, 0)
    assertError(await get(`${TRIPS}?date=06.10.2026`, t.admin), 400)
    assertError(await get(`${TRIPS}?unknown=1`, t.admin), 400)
  })

  test('DOM-FIN-149: veli yalnız çocuğunun bugünkü biniş-inişini okur (K-502)', async () => {
    const t = await institution()
    const { route, guide } = await setup(t)
    assert.ok(guide)
    const parent = await member(t.id, 'veli', [{ kind: 'child', recordId: 's1' }])
    const student = await member(t.id, 'ogrenci', [{ kind: 'student', recordId: 's2' }])
    const before = ok(await get(MY, parent)) as unknown as Json[]
    assert.deepEqual(
      before.map((row) => [row.studentId, row.tripStatus, row.status, row.stopName]),
      [['s1', 'not_started', 'pending', 'Bahariye']],
    )
    const trip = ok(await post(startUrl(route.id), guide, {}), 201)
    ok(await post(markUrl(trip.id), guide, { studentId: 's1', status: 'boarded' }))
    ok(await post(markUrl(trip.id), guide, { studentId: 's2', status: 'absent' }))
    const rows = ok(await get(MY, parent)) as unknown as Json[]
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.tripStatus, 'open')
    assert.equal(rows[0]?.status, 'boarded')
    assert.equal(rows[0]?.boardedAt, FIXED_NOW.toISOString())
    assert.equal(rows[0]?.tripDate, DAY)
    const own = ok(await get(MY, student)) as unknown as Json[]
    assert.deepEqual(
      own.map((row) => [row.studentId, row.status]),
      [['s2', 'absent']],
    )
  })

  test('DOM-FIN-149: başka kurumun seferi ve işareti 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bSetup = await setup(b)
    assert.ok(bSetup.guide)
    const bTrip = ok(await post(startUrl(bSetup.route.id), b.admin, {}), 201)
    const bTripUrl = `${TRIPS}/${String(bTrip.id)}`
    const aParent = await member(a.id, 'veli', [{ kind: 'child', recordId: 's1' }])
    const bBefore = { trips: await tripRows(b.id), marks: await markRows(b.id) }

    assertError(await get(bTripUrl, a.admin), 404)
    assertError(await post(startUrl(bSetup.route.id), a.admin, {}), 404)
    assertError(await post(markUrl(bTrip.id), a.admin, { studentId: 's1', status: 'absent' }), 404)
    assertError(await closeTripAs(a.admin, bTrip.id, 1), 404)
    assert.equal((await get(TRIPS, a.admin)).json().meta.total, 0)
    assert.deepEqual(ok(await get(MY, aParent)), [])
    assertError(await post(startUrl(bSetup.route.id), b.admin, { institutionId: a.id }), 400)
    assert.deepEqual({ trips: await tripRows(b.id), marks: await markRows(b.id) }, bBefore)
    assert.equal((await tripRows(a.id)).length, 0)
  })
})
