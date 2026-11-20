import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships } from '../src/db/schema/auth.ts'
import { orgAssignments, orgPositions, orgUnits } from '../src/db/schema/finance-org-chart.ts'
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
 * Organizasyon şeması uçları (DOM-FIN-129; ON-187; K-442…K-444). Her test kendi kurumunu kurar.
 * Saat `FIXED_NOW` (2026-10-06, İstanbul günü de aynı).
 */

const BASE = '/api/v1/finance'
const CHART = `${BASE}/org-chart`
const VACANCIES = `${BASE}/org-vacancies`
const UNITS = `${BASE}/org-units`
const POSITIONS = `${BASE}/org-positions`
const ASSIGNMENTS = `${BASE}/org-assignments`
const TODAY = '2026-10-06'

type Json = Record<string, unknown>
type Unit = Json & { id: string; version: number; isActive: boolean; parentId: string | null }
type Holder = { assignmentId: string; staffName: string }
type Position = Json & {
  id: string
  version: number
  filled: number
  vacant: number
  holders: Holder[]
}
type Assignment = Json & { id: string; version: number; state: string; endDate: string | null }
type Chart = {
  date: string
  units: Unit[]
  positions: Position[]
  totals: Record<string, number>
}
type Response = Awaited<ReturnType<App['inject']>>
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

describe('DOM-FIN-129: organizasyon şeması uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.187.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  const key = () => ({ 'idempotency-key': randomUUID() })
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  function call(
    method: Method,
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
  function ok<T = Json>(response: Response, status = 200): T {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as T
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.187.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  async function person(t: Tenant, role: Role, name: string) {
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

  const createUnit = (cookie: string, body: Json, headers: Record<string, string> = key()) =>
    call('POST', UNITS, cookie, body, headers)
  const unitOf = async (
    t: Tenant,
    name: string,
    parentId: string | null = null,
    kind = 'management',
  ) => ok<Unit>(await createUnit(t.admin, { name, parentId, kind }), 201)
  const patchUnit = (cookie: string, unit: { id: string; version: number }, body: Json) =>
    call('PATCH', `${UNITS}/${unit.id}`, cookie, body, ifMatch(unit.version))
  const createPosition = (cookie: string, body: Json, headers: Record<string, string> = key()) =>
    call('POST', POSITIONS, cookie, body, headers)
  const positionOf = async (
    t: Tenant,
    unit: { id: string },
    title: string,
    headcount = 1,
    reportsToPositionId: string | null = null,
  ) =>
    ok<Position>(
      await createPosition(t.admin, { unitId: unit.id, title, headcount, reportsToPositionId }),
      201,
    )
  const patchPosition = (cookie: string, position: { id: string; version: number }, body: Json) =>
    call('PATCH', `${POSITIONS}/${position.id}`, cookie, body, ifMatch(position.version))
  const removePosition = (cookie: string, position: { id: string; version: number }) =>
    call('DELETE', `${POSITIONS}/${position.id}`, cookie, undefined, ifMatch(position.version))
  const assign = (cookie: string, body: Json, headers: Record<string, string> = key()) =>
    call('POST', ASSIGNMENTS, cookie, body, headers)
  const patchAssignment = (cookie: string, item: { id: string; version: number }, body: Json) =>
    call('PATCH', `${ASSIGNMENTS}/${item.id}`, cookie, body, ifMatch(item.version))
  const removeAssignment = (cookie: string, item: { id: string; version: number }) =>
    call('DELETE', `${ASSIGNMENTS}/${item.id}`, cookie, undefined, ifMatch(item.version))
  const chartOf = async (cookie: string, date?: string) =>
    ok<Chart>(await get(date === undefined ? CHART : `${CHART}?date=${date}`, cookie))
  const listOf = async (cookie: string, url: string) => {
    const response = await get(url, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number; date?: string } }
  }
  const unitRows = (institutionId: string) =>
    db.select().from(orgUnits).where(eq(orgUnits.institutionId, institutionId))
  const positionRows = (institutionId: string) =>
    db.select().from(orgPositions).where(eq(orgPositions.institutionId, institutionId))
  const assignmentRows = (institutionId: string) =>
    db.select().from(orgAssignments).where(eq(orgAssignments.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    assertError(await get(CHART, null), 401)
    assertError(await get(VACANCIES, null), 401)
    assertError(await get(ASSIGNMENTS, null), 401)
    assertError(await createUnit('', { name: 'Yönetim', kind: 'management' }), 401)
    assertError(await call('PATCH', `${UNITS}/${id}`, null, { name: 'Yeni' }, ifMatch(1)), 401)
    assertError(await createPosition('', { unitId: id, title: 'Müdür', headcount: 1 }), 401)
    assertError(await call('PATCH', `${POSITIONS}/${id}`, null, { headcount: 2 }, ifMatch(1)), 401)
    assertError(await call('DELETE', `${POSITIONS}/${id}`, null, undefined, ifMatch(1)), 401)
    assertError(await assign('', { positionId: id, membershipId: 'x', startDate: TODAY }), 401)
    assertError(
      await call('PATCH', `${ASSIGNMENTS}/${id}`, null, { endDate: TODAY }, ifMatch(1)),
      401,
    )
    assertError(await call('DELETE', `${ASSIGNMENTS}/${id}`, null, undefined, ifMatch(1)), 401)
  })

  test('DOM-FIN-129: K-444 yalnız yönetici; ön büro, öğretmen, veli, öğrenci 403', async () => {
    const t = await institution()
    const root = await unitOf(t, 'Okul müdürlüğü')
    const position = await positionOf(t, root, 'Okul müdürü')
    const teacher = await person(t, 'ogretmen', 'Selin Kaya')
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(CHART, cookie), 403)
      assertError(await get(VACANCIES, cookie), 403)
      assertError(await get(ASSIGNMENTS, cookie), 403)
      assertError(await createUnit(cookie, { name: 'İdari işler', kind: 'administrative' }), 403)
      assertError(await patchUnit(cookie, root, { name: 'Müdürlük' }), 403)
      assertError(
        await createPosition(cookie, { unitId: root.id, title: 'Müdür yardımcısı', headcount: 1 }),
        403,
      )
      assertError(await removePosition(cookie, position), 403)
      assertError(
        await assign(cookie, { positionId: position.id, membershipId: teacher, startDate: TODAY }),
        403,
      )
    }
    assert.equal((await unitRows(t.id)).length, 1)
    assert.equal((await positionRows(t.id)).length, 1)
    assert.equal((await assignmentRows(t.id)).length, 0)
  })

  test('DOM-FIN-129: finance modülü kapalıyken uçlar 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(CHART, closed.admin), 403, 'module_disabled')
    assertError(
      await createUnit(closed.admin, { name: 'Yönetim', kind: 'management' }),
      403,
      'module_disabled',
    )
  })

  test('DOM-FIN-129: K-442 birim ağacı, döngü engeli, ad tekilliği, pasife alma; Idempotency-Key', async () => {
    const t = await institution()
    assertError(await createUnit(t.admin, { name: 'Yönetim', kind: 'management' }, {}), 400)
    assertError(await createUnit(t.admin, { name: 'Y', kind: 'management' }), 400)
    assertError(
      await createUnit(t.admin, { name: 'Yönetim', kind: 'management', parentId: randomUUID() }),
      422,
      'org_unit_parent_not_found',
    )
    assert.equal((await unitRows(t.id)).length, 0)

    const headers = key()
    const root = ok<Unit>(
      await createUnit(t.admin, { name: 'Okul müdürlüğü', kind: 'management' }, headers),
      201,
    )
    const replay = await createUnit(
      t.admin,
      { name: 'Okul müdürlüğü', kind: 'management' },
      headers,
    )
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await unitRows(t.id)).length, 1)
    assert.equal(root.isActive, true)
    assert.equal(root.parentId, null)

    const academic = await unitOf(t, 'Akademik birimler', root.id, 'management')
    const math = await unitOf(t, 'Matematik zümresi', academic.id, 'academic_department')
    assertError(
      await createUnit(t.admin, {
        name: 'matematik ZÜMRESİ',
        kind: 'academic_department',
        parentId: academic.id,
      }),
      409,
      'org_unit_name_taken',
    )
    // Aynı ad başka üst birimde serbest.
    ok(
      await createUnit(t.admin, {
        name: 'Matematik zümresi',
        kind: 'academic_department',
        parentId: root.id,
      }),
      201,
    )

    // Döngü: kök kendi torununun altına taşınamaz; kayıt değişmez.
    const before = await unitRows(t.id)
    assertError(await patchUnit(t.admin, root, { parentId: math.id }), 422, 'org_unit_cycle')
    assertError(
      await patchUnit(t.admin, academic, { parentId: academic.id }),
      422,
      'org_unit_cycle',
    )
    assert.deepEqual(await unitRows(t.id), before)
    assertError(
      await patchUnit(t.admin, root, { name: 'Okul müdürlüğü' }),
      422,
      'org_unit_unchanged',
    )

    // Etkin alt birimi olan birim pasife alınamaz; alt birim önce.
    assertError(
      await patchUnit(t.admin, academic, { isActive: false }),
      422,
      'org_unit_has_active_children',
    )
    const mathOff = ok<Unit>(await patchUnit(t.admin, math, { isActive: false }))
    assert.equal(mathOff.isActive, false)
    const academicOff = ok<Unit>(await patchUnit(t.admin, academic, { isActive: false }))
    assertError(await patchUnit(t.admin, academic, { isActive: true }), 409)
    assertError(
      await patchUnit(t.admin, mathOff, { isActive: true }),
      422,
      'org_unit_parent_inactive',
    )
    assertError(
      await createUnit(t.admin, {
        name: 'Fen zümresi',
        kind: 'academic_department',
        parentId: academic.id,
      }),
      422,
      'org_unit_parent_inactive',
    )
    // Kök birime taşınan birim yeniden etkinleşir.
    const moved = ok<Unit>(
      await patchUnit(t.admin, mathOff, { parentId: root.id, name: 'Matematik', isActive: true }),
    )
    assert.equal(moved.parentId, root.id)
    assert.equal(moved.isActive, true)
    assert.equal(academicOff.isActive, false)

    const [created] = await auditOf(t.id, 'finance.org_unit.create')
    assert.deepEqual(created?.changes, { fields: ['name', 'kind', 'isActive'] })
    const updates = await auditOf(t.id, 'finance.org_unit.update')
    assert.deepEqual(updates.at(-1)?.changes, { fields: ['name', 'parentId', 'isActive'] })
    assert.equal(JSON.stringify(updates).includes('Matematik'), false)

    const chart = await chartOf(t.admin)
    assert.equal(chart.date, TODAY)
    assert.equal(chart.totals.units, 4)
    assert.equal(chart.totals.activeUnits, 3)
  })

  test('DOM-FIN-129: K-443 pozisyon, raporlama hattı döngüsü, unvan tekilliği, kaldırma', async () => {
    const t = await institution()
    const root = await unitOf(t, 'Okul müdürlüğü')
    const math = await unitOf(t, 'Matematik zümresi', root.id, 'academic_department')
    const passive = await unitOf(t, 'Eski birim', root.id, 'support')
    ok(await patchUnit(t.admin, passive, { isActive: false }))

    assertError(
      await createPosition(t.admin, { unitId: root.id, title: 'Müdür', headcount: 1 }, {}),
      400,
    )
    assertError(
      await createPosition(t.admin, { unitId: root.id, title: 'Müdür', headcount: 0 }),
      400,
    )
    assertError(
      await createPosition(t.admin, { unitId: randomUUID(), title: 'Müdür', headcount: 1 }),
      422,
      'org_position_unit_not_found',
    )
    assertError(
      await createPosition(t.admin, { unitId: passive.id, title: 'Müdür', headcount: 1 }),
      422,
      'org_unit_inactive',
    )
    assertError(
      await createPosition(t.admin, {
        unitId: root.id,
        title: 'Müdür',
        headcount: 1,
        reportsToPositionId: randomUUID(),
      }),
      422,
      'org_position_reports_to_not_found',
    )
    assert.equal((await positionRows(t.id)).length, 0)

    const headers = key()
    const principal = ok<Position>(
      await createPosition(
        t.admin,
        { unitId: root.id, title: 'Okul müdürü', headcount: 1 },
        headers,
      ),
      201,
    )
    const replay = await createPosition(
      t.admin,
      { unitId: root.id, title: 'Okul müdürü', headcount: 1 },
      headers,
    )
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await positionRows(t.id)).length, 1)
    assert.deepEqual([principal.filled, principal.vacant], [0, 1])

    const head = await positionOf(t, math, 'Zümre başkanı', 1, principal.id)
    const teacherPosition = await positionOf(t, math, 'Matematik öğretmeni', 4, head.id)
    assertError(
      await createPosition(t.admin, { unitId: math.id, title: 'ZÜMRE BAŞKANI', headcount: 1 }),
      409,
      'org_position_title_taken',
    )

    const before = await positionRows(t.id)
    assertError(
      await patchPosition(t.admin, principal, { reportsToPositionId: teacherPosition.id }),
      422,
      'org_position_cycle',
    )
    assertError(
      await patchPosition(t.admin, head, { reportsToPositionId: head.id }),
      422,
      'org_position_cycle',
    )
    assertError(
      await patchPosition(t.admin, head, { unitId: passive.id }),
      422,
      'org_unit_inactive',
    )
    assertError(await patchPosition(t.admin, head, { headcount: 1 }), 422, 'org_position_unchanged')
    assert.deepEqual(await positionRows(t.id), before)

    const moved = ok<Position>(
      await patchPosition(t.admin, teacherPosition, { headcount: 6, reportsToPositionId: null }),
    )
    assert.equal(moved.headcount, 6)
    assert.equal(moved.reportsToPositionId, null)
    assert.deepEqual(
      (await auditOf(t.id, 'finance.org_position.update')).map((row) => row.changes),
      [{ fields: ['headcount', 'reportsToPositionId'] }],
    )

    // Kendisine raporlayan pozisyon varken kaldırılmaz; önce alt pozisyon.
    assertError(await removePosition(t.admin, principal), 422, 'org_position_has_reports')
    const removed = ok<{ id: string; archivedAt: string }>(await removePosition(t.admin, head))
    assert.equal(removed.archivedAt, FIXED_NOW.toISOString())
    assertError(await patchPosition(t.admin, head, { headcount: 2 }), 404)
    ok(await removePosition(t.admin, principal))
    const chart = await chartOf(t.admin)
    assert.deepEqual(
      chart.positions.map((position) => position.title),
      ['Matematik öğretmeni'],
    )
    assert.deepEqual(chart.totals, {
      units: 3,
      activeUnits: 2,
      positions: 1,
      headcount: 6,
      filled: 0,
      vacant: 6,
    })
    assert.equal((await auditOf(t.id, 'finance.org_position.archive')).length, 2)
  })

  test('DOM-FIN-129: K-444 atama, kadro sınırı, çakışma, bitiş, boş pozisyon listesi', async () => {
    const t = await institution()
    const root = await unitOf(t, 'Okul müdürlüğü')
    const math = await unitOf(t, 'Matematik zümresi', root.id, 'academic_department')
    const principal = await positionOf(t, root, 'Okul müdürü', 1)
    const teachers = await positionOf(t, math, 'Matematik öğretmeni', 2, principal.id)
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const ali = await person(t, 'ogretmen', 'Ali Demir')
    const zeynep = await person(t, 'yonetici', 'Zeynep Ak')
    const parent = await person(t, 'veli', 'Ayşe Yılmaz')
    const left = await person(t, 'ogretmen', 'Ayrılan Öğretmen')
    await db.update(memberships).set({ deactivatedAt: FIXED_NOW }).where(eq(memberships.id, left))

    const body = (
      membershipId: string,
      startDate = '2026-09-01',
      endDate: string | null = null,
    ) => ({
      positionId: teachers.id,
      membershipId,
      startDate,
      endDate,
    })
    assertError(await assign(t.admin, body(selin), {}), 400)
    assertError(await assign(t.admin, body(selin, '2026-09-01', '2026-08-01')), 400)
    assertError(
      await assign(t.admin, { ...body(selin), positionId: randomUUID() }),
      422,
      'org_assignment_position_not_found',
    )
    assertError(await assign(t.admin, body('yok')), 422, 'org_assignment_staff_not_found')
    assertError(await assign(t.admin, body(parent)), 422, 'org_assignment_not_staff')
    assertError(await assign(t.admin, body(left)), 422, 'org_assignment_staff_inactive')
    assert.equal((await assignmentRows(t.id)).length, 0)

    const headers = key()
    const first = ok<Assignment>(await assign(t.admin, body(selin), headers), 201)
    const replay = await assign(t.admin, body(selin), headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(first.state, 'current')
    assert.equal(first.staffName, 'Selin Kaya')
    assertError(await assign(t.admin, body(selin, '2027-01-01')), 409, 'org_assignment_overlap')
    const second = ok<Assignment>(await assign(t.admin, body(ali, '2026-09-15', '2026-12-31')), 201)
    // İkinci kadro aralıkta dolu; Ali'nin bitişinden sonrası boş.
    assertError(await assign(t.admin, body(zeynep, '2026-12-01')), 422, 'org_position_full')
    const upcoming = ok<Assignment>(await assign(t.admin, body(zeynep, '2027-01-01')), 201)
    assert.equal(upcoming.state, 'upcoming')
    assert.equal((await assignmentRows(t.id)).length, 3)

    // Bitişi uzatmak sonraki atamayla kadroyu aşar; kayıt değişmez.
    const rowsBefore = await assignmentRows(t.id)
    assertError(
      await patchAssignment(t.admin, second, { endDate: '2027-02-01' }),
      422,
      'org_position_full',
    )
    assertError(
      await patchAssignment(t.admin, second, { endDate: '2026-09-01' }),
      422,
      'org_assignment_end_before_start',
    )
    assertError(
      await patchAssignment(t.admin, second, { endDate: '2026-12-31' }),
      422,
      'org_assignment_unchanged',
    )
    assert.deepEqual(await assignmentRows(t.id), rowsBefore)
    // Kadro sayısı başlayacak atamaların altına inmez.
    const current = ok<Chart>(await get(CHART, t.admin)).positions.find(
      (position) => position.id === teachers.id,
    )
    assert.ok(current)
    assertError(
      await patchPosition(t.admin, current, { headcount: 1 }),
      422,
      'org_position_headcount_below_assigned',
    )

    const ended = ok<Assignment>(await patchAssignment(t.admin, first, { endDate: '2026-10-05' }))
    assert.equal(ended.state, 'past')
    assert.deepEqual(
      (await auditOf(t.id, 'finance.org_assignment.update')).map((row) => row.changes),
      [{ fields: ['endDate'] }],
    )

    const chart = await chartOf(t.admin)
    const row = chart.positions.find((position) => position.id === teachers.id)
    assert.deepEqual(
      row?.holders.map((holder) => holder.staffName),
      ['Ali Demir'],
    )
    assert.deepEqual([row?.filled, row?.vacant], [1, 1])
    const earlier = await chartOf(t.admin, '2026-09-20')
    assert.equal(earlier.positions.find((position) => position.id === teachers.id)?.filled, 2)

    const vacancies = await listOf(t.admin, VACANCIES)
    assert.equal(vacancies.meta.date, TODAY)
    assert.deepEqual(
      vacancies.data.map((item) => [item.title, item.unitName, item.vacant]),
      [
        ['Matematik öğretmeni', 'Matematik zümresi', 1],
        ['Okul müdürü', 'Okul müdürlüğü', 1],
      ],
    )
    assert.equal((await listOf(t.admin, `${VACANCIES}?unitId=${math.id}`)).meta.total, 1)
    // Unvanda ya da birim adında arama.
    assert.deepEqual(
      (await listOf(t.admin, `${VACANCIES}?q=zümre`)).data.map((item) => item.title),
      ['Matematik öğretmeni'],
    )
    assert.equal((await listOf(t.admin, `${VACANCIES}?q=müdür`)).meta.total, 1)
    assert.equal((await listOf(t.admin, `${VACANCIES}?date=2026-09-20`)).meta.total, 1)
    assert.equal(
      ok<Position>(await assign(t.admin, { ...body(zeynep, TODAY), positionId: principal.id }), 201)
        .positionId,
      principal.id,
    )
    assert.equal((await listOf(t.admin, VACANCIES)).meta.total, 1)

    const history = await listOf(t.admin, `${ASSIGNMENTS}?positionId=${teachers.id}`)
    assert.deepEqual(
      history.data.map((item) => item.staffName),
      ['Zeynep Ak', 'Ali Demir', 'Selin Kaya'],
    )
    assert.equal((await listOf(t.admin, `${ASSIGNMENTS}?state=past`)).meta.total, 1)
    assert.equal((await listOf(t.admin, `${ASSIGNMENTS}?membershipId=${zeynep}`)).meta.total, 2)

    // Biriminde süren atama olan birim pasife alınamaz; pozisyon da kaldırılamaz.
    const mathNow = ok<Chart>(await get(CHART, t.admin)).units.find((unit) => unit.id === math.id)
    assert.ok(mathNow)
    assertError(
      await patchUnit(t.admin, mathNow, { isActive: false }),
      422,
      'org_unit_has_assignments',
    )
    const teachersNow = ok<Chart>(await get(CHART, t.admin)).positions.find(
      (position) => position.id === teachers.id,
    )
    assert.ok(teachersNow)
    assertError(await removePosition(t.admin, teachersNow), 422, 'org_position_has_assignments')

    // Yanlış atama kaldırılır; listeye ve kadroya sayılmaz.
    const archived = ok<{ id: string }>(await removeAssignment(t.admin, upcoming))
    assert.equal(archived.id, upcoming.id)
    assertError(await patchAssignment(t.admin, upcoming, { endDate: null }), 404)
    assert.equal((await listOf(t.admin, `${ASSIGNMENTS}?positionId=${teachers.id}`)).meta.total, 2)
    assert.deepEqual((await auditOf(t.id, 'finance.org_assignment.create'))[0]?.changes, {
      fields: ['positionId', 'membershipId', 'startDate'],
    })
  })

  test('DOM-FIN-129: başka kurumun birimi, pozisyonu, ataması ve personeli 404/422, B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bUnit = await unitOf(b, 'B müdürlüğü')
    const bPosition = await positionOf(b, bUnit, 'B müdürü', 2)
    const bTeacher = await person(b, 'ogretmen', 'B Öğretmeni')
    const bAssignment = ok<Assignment>(
      await assign(b.admin, { positionId: bPosition.id, membershipId: bTeacher, startDate: TODAY }),
      201,
    )
    const aUnit = await unitOf(a, 'A müdürlüğü')
    const aPosition = await positionOf(a, aUnit, 'A müdürü')
    const bUnits = await unitRows(b.id)
    const bPositions = await positionRows(b.id)
    const bAssignments = await assignmentRows(b.id)

    const aChart = await chartOf(a.admin)
    assert.deepEqual(
      aChart.units.map((unit) => unit.id),
      [aUnit.id],
    )
    assert.deepEqual(
      aChart.positions.map((position) => position.id),
      [aPosition.id],
    )
    const aVacancies = await listOf(a.admin, VACANCIES)
    assert.deepEqual(
      aVacancies.data.map((item) => item.positionId),
      [aPosition.id],
    )
    assert.equal((await listOf(a.admin, `${VACANCIES}?unitId=${bUnit.id}`)).meta.total, 0)
    assert.equal((await listOf(a.admin, ASSIGNMENTS)).meta.total, 0)
    assert.equal((await listOf(a.admin, `${ASSIGNMENTS}?positionId=${bPosition.id}`)).meta.total, 0)

    assertError(await patchUnit(a.admin, bUnit, { name: 'Ele geçirilen' }), 404)
    assertError(await patchPosition(a.admin, bPosition, { headcount: 5 }), 404)
    assertError(await removePosition(a.admin, bPosition), 404)
    assertError(await patchAssignment(a.admin, bAssignment, { endDate: TODAY }), 404)
    assertError(await removeAssignment(a.admin, bAssignment), 404)

    assertError(
      await createUnit(a.admin, { name: 'Alt birim', kind: 'support', parentId: bUnit.id }),
      422,
      'org_unit_parent_not_found',
    )
    assertError(
      await patchUnit(a.admin, aUnit, { parentId: bUnit.id }),
      422,
      'org_unit_parent_not_found',
    )
    assertError(
      await createPosition(a.admin, { unitId: bUnit.id, title: 'Sızan', headcount: 1 }),
      422,
      'org_position_unit_not_found',
    )
    assertError(
      await createPosition(a.admin, {
        unitId: aUnit.id,
        title: 'Yardımcı',
        headcount: 1,
        reportsToPositionId: bPosition.id,
      }),
      422,
      'org_position_reports_to_not_found',
    )
    assertError(
      await assign(a.admin, { positionId: bPosition.id, membershipId: bTeacher, startDate: TODAY }),
      422,
      'org_assignment_position_not_found',
    )
    assertError(
      await assign(a.admin, { positionId: aPosition.id, membershipId: bTeacher, startDate: TODAY }),
      422,
      'org_assignment_staff_not_found',
    )
    assertError(
      await createUnit(a.admin, { name: 'Gövde kurumu', kind: 'support', institutionId: b.id }),
      400,
    )

    assert.deepEqual(await unitRows(b.id), bUnits)
    assert.deepEqual(await positionRows(b.id), bPositions)
    assert.deepEqual(await assignmentRows(b.id), bAssignments)
    assert.equal((await unitRows(a.id)).length, 1)
  })
})
