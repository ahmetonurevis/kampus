import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, like } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { records } from '../src/db/schema/records.ts'
import { ensureGuardianLinks } from '../src/db/student-guardians.ts'
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
 * Servis listesi ucu (DOM-FIN-148; ON-148; IST-028; K-499…K-501). Her test kendi kurumunu kurar.
 * FIXED_NOW 2026-10-06T09:00Z.
 */

const BASE = '/api/v1/finance/transport'
const VEHICLES = `${BASE}/vehicles`
const ROUTES = `${BASE}/routes`
const rosterUrl = (routeId: unknown, purpose?: string) =>
  `${ROUTES}/${String(routeId)}/roster${purpose === undefined ? '' : `?purpose=${purpose}`}`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>
type Roster = {
  route: Json
  purpose: string
  phonesMasked: boolean
  listDate: string
  total: number
  stops: {
    name: string
    position: number
    students: {
      studentName: string
      className: string | null
      contacts: { name: string | null; relationship: string | null; phone: string | null }[]
    }[]
  }[]
}

describe('DOM-FIN-148: servis listesi ucu', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.148.0.1'

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
    target: App = app,
  ) {
    return target.inject({
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
  const post = (url: string, cookie: string, body: unknown) =>
    call('POST', url, cookie, body, { 'idempotency-key': randomUUID() })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const rosterOf = (response: Response) => ok(response) as unknown as Roster

  const student = (id: string, name: string, classId: string, parentId: string) => ({
    collection: 'students' as const,
    id,
    data: { id, name, classId, parentId, isActive: true },
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.148.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      created.id,
      [
        { collection: 'classes', id: 'test-c-7a', data: { id: 'test-c-7a', name: '7-A' } },
        student('test-s-deniz', 'Deniz Yılmaz', 'test-c-7a', 'test-p-ayse'),
        student('test-s-ece', 'Ece Yılmaz', 'test-c-7a', 'test-p-ayse'),
        student('test-s-can', 'Can Demir', 'test-c-7a', 'test-p-fatma'),
        student('test-s-left', 'Ayrılacak Öğrenci', 'test-c-7a', 'test-p-fatma'),
        {
          collection: 'parents',
          id: 'test-p-ayse',
          data: {
            id: 'test-p-ayse',
            name: 'Ayşe Yılmaz',
            phone: '05321234512',
            relationship: 'mother',
            studentIds: ['test-s-deniz', 'test-s-ece'],
          },
        },
        {
          collection: 'parents',
          id: 'test-p-fatma',
          data: {
            id: 'test-p-fatma',
            name: 'Fatma Demir',
            phone: '05447654321',
            studentIds: ['test-s-can', 'test-s-left'],
          },
        },
        {
          collection: 'parents',
          id: 'test-p-kisitli',
          data: {
            id: 'test-p-kisitli',
            name: 'Kısıtlı Veli',
            phone: '05550001199',
            studentIds: ['test-s-ece'],
          },
        },
      ],
      FIXED_NOW,
    )
    // Ece'nin bağları: kısıtlı veli (listeye girmez) ve velayetli anne.
    await ensureGuardianLinks(db, created.id, [
      {
        id: randomUUID(),
        studentId: 'test-s-ece',
        parentId: 'test-p-kisitli',
        membershipId: null,
        relationship: 'father',
        custody: 'none',
        contactRestricted: true,
        isPayer: false,
        canPickUp: false,
      },
      {
        id: randomUUID(),
        studentId: 'test-s-ece',
        parentId: 'test-p-ayse',
        membershipId: null,
        relationship: 'mother',
        custody: 'full',
        contactRestricted: false,
        isPayer: true,
        canPickUp: true,
      },
    ])
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  async function setup(t: Tenant) {
    const guide = await createMember(app, t.id, 'onburo')
    const vehicle = ok(
      await post(VEHICLES, t.admin, {
        plate: '34 KMP 148',
        capacity: 10,
        driverName: 'Ali Sürücü',
        driverPhone: '0532 999 88 67',
        guideMembershipId: guide.membershipId,
      }),
      201,
    )
    const route = ok(
      await post(ROUTES, t.admin, {
        name: 'Moda hattı',
        direction: 'morning',
        vehicleId: vehicle.id,
        stops: [
          { name: 'Moda', time: '07:10' },
          { name: 'Bahariye', time: '07:25' },
          { name: 'Kadıköy', time: '07:40' },
        ],
      }),
      201,
    )
    const stops = route.stops as { id: string }[]
    const assign = async (studentId: string, stop: number) =>
      ok(
        await post(`${ROUTES}/${String(route.id)}/assignments`, t.admin, {
          studentId,
          stopId: stops[stop]?.id,
        }),
        201,
      )
    await assign('test-s-ece', 0)
    await assign('test-s-deniz', 0)
    await assign('test-s-can', 1)
    await assign('test-s-left', 1)
    // Atamadan sonra ayrılan öğrenci: kaydı pasif (DOM-KAY-026).
    await db
      .update(records)
      .set({
        data: {
          id: 'test-s-left',
          name: 'Ayrılacak Öğrenci',
          classId: 'test-c-7a',
          parentId: 'test-p-fatma',
          isActive: false,
        },
      })
      .where(and(eq(records.institutionId, t.id), eq(records.id, 'test-s-left')))
    return { route, vehicle }
  }
  const audits = (institutionId: string) =>
    db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, institutionId),
          like(auditLog.action, 'finance.transport.roster%'),
        ),
      )

  test('DOM-FIN-148: kimliksiz 401; öğretmen ve veli 403; modül kapalı 403', async () => {
    const t = await institution()
    const { route } = await setup(t)
    assertError(await get(rosterUrl(route.id), null), 401)
    const teacher = await signInAs(app, await createMember(app, t.id, 'ogretmen'))
    const parent = await signInAs(
      app,
      await createMember(app, t.id, 'veli', [{ kind: 'child', recordId: 'test-s-deniz' }]),
    )
    assertError(await get(rosterUrl(route.id), teacher), 403)
    assertError(await get(rosterUrl(route.id), parent), 403)
    const closed = await institution({ enabledModules: { transport: false } })
    assertError(await get(rosterUrl(randomUUID()), closed.admin), 403, 'module_disabled')
    assert.equal((await audits(t.id)).length, 0)
  })

  test('DOM-FIN-148: kurum içi liste durak sırasıyla, telefon maskeli; ayrılan öğrenci yok (K-499, K-501)', async () => {
    const t = await institution()
    const { route } = await setup(t)
    const roster = rosterOf(await get(rosterUrl(route.id), t.admin))
    assert.equal(roster.purpose, 'office')
    assert.equal(roster.phonesMasked, true)
    assert.equal(roster.listDate, '2026-10-06')
    assert.equal(roster.total, 3)
    assert.deepEqual(roster.route, {
      id: route.id,
      name: 'Moda hattı',
      direction: 'morning',
      vehiclePlate: '34KMP148',
      capacity: 10,
      driverName: 'Ali Sürücü',
      driverPhoneMasked: '0532 *** ** 67',
      guideName: roster.route.guideName,
    })
    assert.equal(typeof roster.route.guideName, 'string')
    assert.deepEqual(
      roster.stops.map((stop) => [stop.name, stop.students.map((row) => row.studentName)]),
      [
        ['Moda', ['Deniz Yılmaz', 'Ece Yılmaz']],
        ['Bahariye', ['Can Demir']],
        ['Kadıköy', []],
      ],
    )
    const [deniz, ece] = roster.stops[0]?.students ?? []
    assert.equal(deniz?.className, '7-A')
    // Bağı olmayan öğrenci: kayıttaki veli.
    assert.deepEqual(deniz?.contacts, [
      { name: 'Ayşe Yılmaz', relationship: 'mother', phone: '0532 *** ** 12' },
    ])
    // Bağı olan öğrenci: kısıtlı veli yok.
    assert.deepEqual(ece?.contacts, [
      { name: 'Ayşe Yılmaz', relationship: 'mother', phone: '0532 *** ** 12' },
    ])
    const body = JSON.stringify(roster)
    for (const secret of ['05321234512', '05447654321', '0532999', 'Kısıtlı', 'Ayrılacak'])
      assert.ok(!body.includes(secret), secret)
    const [audit] = await audits(t.id)
    assert.equal(audit?.action, 'finance.transport.roster_export')
    assert.equal(audit?.entityId, route.id)
    assert.deepEqual(audit?.changes, {
      fields: ['studentName', 'className', 'stop', 'contactName', 'contactPhone'],
      counts: { students: 3 },
    })
  })

  test('DOM-FIN-148: sürücü listesi tam telefon yalnız yönetici; ön büro 403; denetim ayrı (K-500)', async () => {
    const t = await institution()
    const { route } = await setup(t)
    const desk = await signInAs(app, await createMember(app, t.id, 'onburo'))
    assertError(
      await get(rosterUrl(route.id, 'driver'), desk),
      403,
      'transport_roster_driver_forbidden',
    )
    const office = rosterOf(await get(rosterUrl(route.id, 'office'), desk))
    assert.equal(office.stops[1]?.students[0]?.contacts[0]?.phone, '0544 *** ** 21')

    const driver = rosterOf(await get(rosterUrl(route.id, 'driver'), t.admin))
    assert.equal(driver.purpose, 'driver')
    assert.equal(driver.phonesMasked, false)
    assert.equal(driver.stops[1]?.students[0]?.contacts[0]?.phone, '05447654321')
    assert.equal(driver.route.driverPhoneMasked, '0532 *** ** 67')
    assert.ok(!JSON.stringify(driver).includes('05550001199'))
    const rows = await audits(t.id)
    assert.deepEqual(rows.map((row) => row.action).sort(), [
      'finance.transport.roster_driver_export',
      'finance.transport.roster_export',
    ])
    assert.ok(!JSON.stringify(rows).includes('0544'))
    assert.ok(!JSON.stringify(rows).includes('test-s-'))
  })

  test('DOM-FIN-148: bilinmeyen amaç ve parametre 400; geçersiz kimlik 400; denetim yazılmaz', async () => {
    const t = await institution()
    const { route } = await setup(t)
    assertError(await get(rosterUrl(route.id, 'parent'), t.admin), 400)
    assertError(await get(`${rosterUrl(route.id)}?health=1`, t.admin), 400)
    assertError(await get(rosterUrl('yok'), t.admin), 400)
    assert.equal((await audits(t.id)).length, 0)
  })

  test('DOM-FIN-148: başka kurumun ya da arşivli güzergâhı 404', async () => {
    const a = await institution()
    const b = await institution()
    const { route } = await setup(b)
    assertError(await get(rosterUrl(route.id), a.admin), 404)
    assertError(await get(rosterUrl(route.id, 'driver'), a.admin), 404)
    assertError(await get(rosterUrl(randomUUID()), b.admin), 404)
    const { vehicle } = await setup(a)
    const empty = ok(
      await post(ROUTES, a.admin, {
        name: 'Boş hat',
        direction: 'evening',
        vehicleId: vehicle.id,
        stops: [{ name: 'Moda', time: '16:10' }],
      }),
      201,
    )
    const archived = await app.inject({
      method: 'DELETE',
      url: `${ROUTES}/${String(empty.id)}`,
      remoteAddress: clientIp,
      headers: { origin: TEST_ORIGIN, cookie: a.admin, 'if-match': `"${String(empty.version)}"` },
    })
    assert.equal(archived.statusCode, 200, archived.body)
    assertError(await get(rosterUrl(empty.id), a.admin), 404)
    assert.equal((await audits(a.id)).length, 0)
    assert.equal((await audits(b.id)).length, 0)
  })

  test('DOM-FIN-148: eski oturum 403 reauthentication_required', async () => {
    const t = await institution()
    const { route } = await setup(t)
    const later = await buildTestApp(db, { clock: () => new Date(Date.now() + 16 * 60 * 1000) })
    try {
      assertError(
        await call('GET', rosterUrl(route.id), t.admin, undefined, {}, later),
        403,
        'reauthentication_required',
      )
    } finally {
      await later.close()
    }
    assert.equal((await audits(t.id)).length, 0)
  })
})
