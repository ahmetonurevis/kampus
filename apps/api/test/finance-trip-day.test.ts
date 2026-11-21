import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { healthAccessReasons } from '../src/db/schema/finance-health-access.ts'
import {
  paidActivities,
  paidActivityParticipants,
} from '../src/db/schema/finance-paid-activities.ts'
import {
  tripDayCheckMarks,
  tripDayChecks,
  tripDayGroups,
  tripDayMembers,
} from '../src/db/schema/finance-trip-day.ts'
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
 * Gezi günü yoklaması ve acil kart uçları (DOM-FIN-154; ON-157; K-517…K-519). Her test kendi
 * kurumunu kurar. Plan FIXED_NOW'da (2026-10-06) 2026-10-20 için açılıp onaylanır; tur testleri
 * saati gezi gününe (10:00 İstanbul) alır.
 */

const PLANS = '/api/v1/finance/trip-plans'
const MY = '/api/v1/finance/trip-days/my'
const TRIP_DAY = '2026-10-20'
const ON_TRIP = new Date(`${TRIP_DAY}T07:00:00.000Z`)

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>
type Group = {
  id: string
  name: string
  version: number
  students: { studentId: string }[]
  checks: Check[]
  [key: string]: unknown
}
type Check = {
  id: string
  status: string
  version: number
  counts: Json
  missingReason: string | null
  roster: { studentId: string; status: string }[]
}

describe('DOM-FIN-154: gezi günü yoklaması ve acil kart uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let now = FIXED_NOW
  let tenantCount = 0
  let clientIp = '10.157.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => now })
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
  /** Acil kart sağlık verisi taşır: personel okuması erişim gerekçesi ister (DOM-FIN-156). */
  const card = (url: string, cookie: string | null, reason: string | null = 'emergency') =>
    call('GET', url, cookie, undefined, reason === null ? {} : { 'x-access-reason': reason })
  const post = (url: string, cookie: string | null, body: unknown, key = randomUUID()) =>
    call('POST', url, cookie, body, { 'idempotency-key': key })
  const versioned = (
    method: 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string | null,
    body: unknown,
    version: unknown,
  ) => call(method, url, cookie, body, { 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const dayUrl = (planId: unknown) => `${PLANS}/${String(planId)}/day`
  const groupsUrl = (planId: unknown) => `${dayUrl(planId)}/groups`
  const groupUrl = (planId: unknown, groupId: unknown) => `${groupsUrl(planId)}/${String(groupId)}`
  const assignUrl = (planId: unknown) => `${dayUrl(planId)}/assignments`
  const checksUrl = (planId: unknown, groupId: unknown) => `${groupUrl(planId, groupId)}/checks`
  const checkUrl = (planId: unknown, checkId: unknown) =>
    `${dayUrl(planId)}/checks/${String(checkId)}`
  const cardUrl = (planId: unknown, groupId: unknown, purpose = 'office') =>
    `${groupUrl(planId, groupId)}/emergency-card?purpose=${purpose}`
  const groupsOf = (day: Json) => day.groups as Group[]
  const groupOf = (day: Json, name: string) => {
    const found = groupsOf(day).find((group) => group.name === name)
    assert.ok(found, `grup yok: ${name}`)
    return found
  }
  const lastCheck = (group: Group) => {
    const check = group.checks.at(-1)
    assert.ok(check, 'tur yok')
    return check
  }
  const rows = (institutionId: string) => ({
    groups: () =>
      db.select().from(tripDayGroups).where(eq(tripDayGroups.institutionId, institutionId)),
    members: () =>
      db.select().from(tripDayMembers).where(eq(tripDayMembers.institutionId, institutionId)),
    checks: () =>
      db.select().from(tripDayChecks).where(eq(tripDayChecks.institutionId, institutionId)),
    marks: () =>
      db.select().from(tripDayCheckMarks).where(eq(tripDayCheckMarks.institutionId, institutionId)),
  })
  const audits = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  async function snapshot(institutionId: string) {
    const r = rows(institutionId)
    return JSON.stringify([await r.groups(), await r.members(), await r.checks(), await r.marks()])
  }

  /**
   * Kurum: Deniz (`s-1`, 9-A; velisi `mother`), Ece (`s-2`, 9-B; kayıttaki veli `p-1`), Ali (`s-3`,
   * 9-A). `homeroom` 9-A'nın sınıf öğretmeni ve 9-B'ye derse girer; `outsider` sınıf öğretmeni
   * değildir. İkisi de planın görevlisidir.
   */
  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.157.${String((tenantCount += 1))}.1`
    now = FIXED_NOW
    const created = await createInstitution(app, overrides)
    const record = (
      collection: 'teachers' | 'classes' | 'assignments' | 'students' | 'parents',
      data: Json,
    ) => ({
      collection,
      id: String(data.id),
      data,
    })
    await insertMissingRecords(
      db,
      created.id,
      [
        record('teachers', { id: 't-1', name: 'Selin Kaya', subjectId: 'mat', branchId: 'b-1' }),
        record('classes', {
          id: '9-A',
          name: '9-A',
          grade: 9,
          level: 'lise',
          branchId: 'b-1',
          teacherId: 't-1',
        }),
        record('classes', {
          id: '9-B',
          name: '9-B',
          grade: 9,
          level: 'lise',
          branchId: 'b-1',
          teacherId: 't-9',
        }),
        record('assignments', { id: 'as-1', classId: '9-B', teacherId: 't-1', subjectId: 'mat' }),
        record('parents', {
          id: 'p-1',
          name: 'Ayşe Yılmaz',
          phone: '05321234567',
          relationship: 'mother',
        }),
        record('students', {
          id: 's-1',
          name: 'Deniz Yılmaz',
          classId: '9-A',
          isActive: true,
        }),
        record('students', {
          id: 's-2',
          name: 'Ece Yılmaz',
          classId: '9-B',
          isActive: true,
          parentId: 'p-1',
        }),
        record('students', { id: 's-3', name: 'Ali Kurt', classId: '9-A', isActive: true }),
        record('students', { id: 's-4', name: 'Eski Öğrenci', classId: '9-A', isActive: false }),
      ],
      FIXED_NOW,
    )
    const homeroom = await createMember(app, created.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-1' },
    ])
    const outsider = await createMember(app, created.id, 'ogretmen')
    const stranger = await createMember(app, created.id, 'ogretmen')
    const desk = await createMember(app, created.id, 'onburo')
    const mother = await createMember(app, created.id, 'veli', [{ kind: 'child', recordId: 's-1' }])
    return {
      id: created.id,
      admin: await signInAs(app, created.admin),
      homeroom: { ...homeroom, cookie: await signInAs(app, homeroom) },
      outsider: { ...outsider, cookie: await signInAs(app, outsider) },
      stranger: await signInAs(app, stranger),
      desk: await signInAs(app, desk),
      mother: await signInAs(app, mother),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  /** Onaylı plan: 2026-10-20 08:00–20:00 İstanbul; görevliler `homeroom` (sorumlu) ve `outsider`. */
  async function approvedPlan(t: Tenant, extra: Json = {}) {
    const plan = ok(
      await post(PLANS, t.admin, {
        name: 'Anıtkabir gezisi',
        purpose: 'Cumhuriyet tarihi kazanımlarını yerinde gözlemlemek.',
        departureAt: `${TRIP_DAY}T05:00:00.000Z`,
        returnAt: `${TRIP_DAY}T17:00:00.000Z`,
        expectedStudentCount: 3,
        stops: [{ place: 'Anıtkabir' }],
        staff: [
          { membershipId: t.homeroom.membershipId, role: 'lead' },
          { membershipId: t.outsider.membershipId, role: 'assistant' },
        ],
        transport: {
          type: 'bus',
          company: 'Mavi Turizm',
          plate: '06 ABC 123',
          driverName: 'Ali Sürücü',
          driverPhone: '05321112233',
        },
        risks: [{ risk: 'Kalabalıkta kaybolma', measure: 'Grup sorumlusu ve yoklama' }],
        emergencyContacts: [{ name: 'Okul müdürü', phone: '05321234500', relation: 'Müdür' }],
        ...extra,
      }),
      201,
    )
    const submitted = ok(
      await versioned('POST', `${PLANS}/${String(plan.id)}/submit`, t.admin, {}, plan.version),
    )
    ok(
      await versioned(
        'POST',
        `${PLANS}/${String(plan.id)}/approve`,
        t.admin,
        {},
        submitted.version,
      ),
    )
    return String(plan.id)
  }

  /** İki grup: 1. otobüs (sorumlu `homeroom`; s-1, s-2) ve Mavi grup (sorumlu `outsider`; s-3). */
  async function setup(t: Tenant) {
    const planId = await approvedPlan(t)
    ok(
      await post(groupsUrl(planId), t.desk, {
        name: '1. otobüs',
        vehiclePlate: '06 abc 123',
        leaderMembershipId: t.homeroom.membershipId,
      }),
      201,
    )
    const day = ok(
      await post(groupsUrl(planId), t.desk, {
        name: 'Mavi grup',
        leaderMembershipId: t.outsider.membershipId,
      }),
      201,
    )
    const bus = groupOf(day, '1. otobüs')
    const blue = groupOf(day, 'Mavi grup')
    ok(await post(assignUrl(planId), t.desk, { groupId: bus.id, studentIds: ['s-1', 's-2'] }))
    ok(await post(assignUrl(planId), t.desk, { groupId: blue.id, studentIds: ['s-3'] }))
    return { planId, bus: bus.id, blue: blue.id }
  }

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    assertError(await get(MY, null), 401)
    assertError(await get(dayUrl(id), null), 401)
    assertError(await post(groupsUrl(id), null, {}), 401)
    assertError(await versioned('PATCH', groupUrl(id, id), null, { name: 'Yeni' }, 1), 401)
    assertError(await versioned('DELETE', groupUrl(id, id), null, undefined, 1), 401)
    assertError(await post(assignUrl(id), null, {}), 401)
    assertError(await post(checksUrl(id, id), null, {}), 401)
    assertError(await post(`${checkUrl(id, id)}/marks`, null, {}), 401)
    assertError(await versioned('POST', `${checkUrl(id, id)}/complete`, null, {}, 1), 401)
    assertError(await versioned('POST', `${checkUrl(id, id)}/proceed`, null, {}, 1), 401)
    assertError(await card(cardUrl(id, id), null), 401)
  })

  test('DOM-FIN-154: rol ve modül süzgeci 403 (K-517)', async () => {
    const t = await institution()
    const id = randomUUID()
    assertError(await get(dayUrl(id), t.mother), 403)
    assertError(await get(MY, t.admin), 403)
    assertError(await post(groupsUrl(id), t.homeroom.cookie, { name: 'X' }), 403)
    assertError(await post(assignUrl(id), t.homeroom.cookie, {}), 403)
    assertError(await post(checksUrl(id, id), t.desk, { checkpoint: 'Varış' }), 403)
    assertError(await card(cardUrl(id, id), t.desk), 403)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(dayUrl(id), closed.admin), 403, 'module_disabled')
    assertError(await post(groupsUrl(id), closed.admin, {}), 403, 'module_disabled')
    assertError(await get(MY, closed.mother), 403, 'module_disabled')
  })

  test('DOM-FIN-154: grup açma, sorumlu planın görevlisi, ad tekil, mükerrer istek (K-517)', async () => {
    const t = await institution()
    const planId = await approvedPlan(t)
    const key = randomUUID()
    const body = {
      name: '1. otobüs',
      vehiclePlate: '06 abc 123',
      leaderMembershipId: t.homeroom.membershipId,
    }
    const first = await post(groupsUrl(planId), t.desk, body, key)
    const day = ok(first, 201)
    const group = groupOf(day, '1. otobüs')
    assert.equal(group.vehiclePlate, '06ABC123')
    assert.equal(group.leaderName, 'Test Kullanıcı')
    const replay = await post(groupsUrl(planId), t.desk, body, key)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await rows(t.id).groups()).length, 1)
    assert.equal((await audits(t.id, 'finance.trip_day.group_create')).length, 1)

    const before = await snapshot(t.id)
    assertError(
      await post(groupsUrl(planId), t.desk, { ...body, name: '1. OTOBÜS' }),
      409,
      'trip_day_group_name_taken',
    )
    const stranger = await createMember(app, t.id, 'ogretmen')
    assertError(
      await post(groupsUrl(planId), t.desk, {
        name: 'Yedek',
        leaderMembershipId: stranger.membershipId,
      }),
      422,
      'trip_day_leader_not_staff',
    )
    assertError(await post(groupsUrl(planId), t.desk, { ...body, name: 'X' }), 400)
    assertError(
      await post(groupsUrl(planId), t.desk, { ...body, name: 'Diğer', institutionId: t.id }),
      400,
    )
    assertError(await call('POST', groupsUrl(planId), t.desk, body), 400)
    assertError(await post(groupsUrl(randomUUID()), t.desk, body), 404)
    assert.equal(await snapshot(t.id), before)

    const renamed = ok(
      await versioned(
        'PATCH',
        groupUrl(planId, group.id),
        t.admin,
        { name: 'Kırmızı otobüs', vehiclePlate: null },
        group.version,
      ),
    )
    const updated = groupOf(renamed, 'Kırmızı otobüs')
    assert.equal(updated.vehiclePlate, null)
    assert.deepEqual((await audits(t.id, 'finance.trip_day.group_update'))[0]?.changes, {
      fields: ['name', 'vehiclePlate'],
    })
    assertError(
      await versioned(
        'PATCH',
        groupUrl(planId, group.id),
        t.admin,
        { name: 'Eski sürüm' },
        group.version,
      ),
      409,
    )
    const archived = ok(
      await versioned('DELETE', groupUrl(planId, group.id), t.desk, undefined, updated.version),
    )
    assert.equal(groupsOf(archived).length, 0)
  })

  test('DOM-FIN-154: dağıtım yalnız katılımcıya; ekleme, taşıma, çıkarma (K-517)', async () => {
    const t = await institution()
    const { planId, bus, blue } = await setup(t)
    const day = ok(await get(dayUrl(planId), t.desk))
    assert.equal(day.participantSource, 'students')
    assert.equal(day.participantCount, 3) // s-4 etkin değil
    assert.deepEqual(
      groupOf(day, '1. otobüs')
        .students.map((row) => row.studentId)
        .sort(),
      ['s-1', 's-2'],
    )
    assert.deepEqual(day.unassigned, [])

    const before = await snapshot(t.id)
    assertError(
      await post(assignUrl(planId), t.desk, { groupId: bus, studentIds: ['s-4'] }),
      422,
      'trip_day_student_not_participant',
    )
    assertError(
      await post(assignUrl(planId), t.desk, { groupId: randomUUID(), studentIds: ['s-1'] }),
      422,
      'trip_day_group_not_found',
    )
    assert.equal(await snapshot(t.id), before)

    const moved = ok(await post(assignUrl(planId), t.desk, { groupId: blue, studentIds: ['s-2'] }))
    assert.deepEqual(
      groupOf(moved, 'Mavi grup')
        .students.map((row) => row.studentId)
        .sort(),
      ['s-2', 's-3'],
    )
    const removed = ok(
      await post(assignUrl(planId), t.desk, { groupId: null, studentIds: ['s-3'] }),
    )
    assert.deepEqual(
      (removed.unassigned as { studentId: string }[]).map((row) => row.studentId),
      ['s-3'],
    )
    assert.equal((await audits(t.id, 'finance.trip_day.assign')).length, 4)
    assert.deepEqual((await audits(t.id, 'finance.trip_day.assign'))[0]?.changes, {
      fields: ['groupId', 'studentIds'],
    })
  })

  test('DOM-FIN-154: bağlı ücretli etkinlikte yalnız asil katılımcı (K-517)', async () => {
    const t = await institution()
    const activityId = randomUUID()
    await db.insert(paidActivities).values({
      institutionId: t.id,
      id: activityId,
      kind: 'trip',
      name: 'Anıtkabir gezisi ücreti',
      activityDate: TRIP_DAY,
      feeCents: 50_000,
      joinDeadline: '2026-10-15',
      cancelDeadline: '2026-10-15',
      capacity: 40,
      lateRefundRule: 'percent',
      lateRefundPercent: 50,
      createdByUserId: 'u-test',
    })
    const participant = (studentId: string, status: string, invoiceId: string | null) => ({
      institutionId: t.id,
      id: randomUUID(),
      activityId,
      studentId,
      invoiceId,
      feeCents: 50_000,
      joinedDate: '2026-10-06',
      status,
      ...(status === 'waitlisted' ? { waitlistPosition: 1 } : {}),
      createdByUserId: 'u-test',
    })
    await db
      .insert(paidActivityParticipants)
      .values([participant('s-1', 'active', 'inv-1'), participant('s-2', 'waitlisted', null)])
    const planId = await approvedPlan(t, { paidActivityId: activityId })
    const day = ok(await get(dayUrl(planId), t.desk))
    assert.equal(day.participantSource, 'activity')
    assert.deepEqual(
      (day.unassigned as { studentId: string }[]).map((row) => row.studentId),
      ['s-1'],
    )
    const created = ok(
      await post(groupsUrl(planId), t.desk, {
        name: 'Tek grup',
        leaderMembershipId: t.homeroom.membershipId,
      }),
      201,
    )
    const groupId = groupsOf(created)[0]?.id
    assertError(
      await post(assignUrl(planId), t.desk, { groupId, studentIds: ['s-2'] }),
      422,
      'trip_day_student_not_participant',
    )
    ok(await post(assignUrl(planId), t.desk, { groupId, studentIds: ['s-1'] }))
  })

  test('DOM-FIN-154: öğretmen yalnız sorumlusu olduğu grubu görür; başkası 404 (K-517)', async () => {
    const t = await institution()
    const { planId, bus, blue } = await setup(t)
    const mine = ok(await get(dayUrl(planId), t.outsider.cookie))
    assert.deepEqual(
      groupsOf(mine).map((group) => group.id),
      [blue],
    )
    assert.deepEqual(mine.unassigned, [])
    assert.deepEqual(mine.staff, [])
    assert.equal(mine.canManage, false)
    assertError(await get(dayUrl(planId), t.stranger), 404)
    now = ON_TRIP
    assertError(await post(checksUrl(planId, bus), t.outsider.cookie, { checkpoint: 'Varış' }), 404)
    assertError(await card(cardUrl(planId, bus), t.outsider.cookie), 404)
  })

  test('DOM-FIN-154: tur gezi günü açılır; eksik varken tamam olmaz, gerekçeyle eksikle devam (K-517)', async () => {
    const t = await institution()
    const { planId, bus } = await setup(t)
    assertError(
      await post(checksUrl(planId, bus), t.homeroom.cookie, { checkpoint: 'Okuldan çıkış' }),
      422,
      'trip_day_not_today',
    )
    now = ON_TRIP
    const key = randomUUID()
    const started = ok(
      await post(checksUrl(planId, bus), t.homeroom.cookie, { checkpoint: 'Okuldan çıkış' }, key),
      201,
    )
    const replay = await post(
      checksUrl(planId, bus),
      t.homeroom.cookie,
      { checkpoint: 'Okuldan çıkış' },
      key,
    )
    assert.equal(replay.statusCode, 201)
    assert.equal((await rows(t.id).checks()).length, 1)
    assertError(
      await post(checksUrl(planId, bus), t.homeroom.cookie, { checkpoint: 'Varış' }),
      409,
      'trip_day_check_open',
    )
    // Süren turda dağıtım değişmez.
    assertError(
      await post(assignUrl(planId), t.desk, { groupId: null, studentIds: ['s-1'] }),
      422,
      'trip_day_check_open',
    )
    const check = lastCheck(groupOf(started, '1. otobüs'))
    assert.equal(check.status, 'open')
    assert.deepEqual(check.counts, { total: 2, present: 0, absent: 0, pending: 2 })

    const marksUrl = `${checkUrl(planId, check.id)}/marks`
    const markKey = randomUUID()
    const marked = ok(
      await post(
        marksUrl,
        t.homeroom.cookie,
        { marks: [{ studentId: 's-1', status: 'present' }] },
        markKey,
      ),
    )
    // Çevrimdışı yeniden deneme: aynı anahtar aynı yanıtı döner, ikinci satır yazılmaz.
    const again = await post(
      marksUrl,
      t.homeroom.cookie,
      { marks: [{ studentId: 's-1', status: 'present' }] },
      markKey,
    )
    assert.equal(again.headers['idempotent-replayed'], 'true')
    // Yeni anahtarla aynı işaret de yazmaz.
    ok(
      await post(marksUrl, t.homeroom.cookie, { marks: [{ studentId: 's-1', status: 'present' }] }),
    )
    assert.equal((await rows(t.id).marks()).length, 1)
    assert.equal((await audits(t.id, 'finance.trip_day.check_mark')).length, 1)
    assert.deepEqual(lastCheck(groupOf(marked, '1. otobüs')).counts, {
      total: 2,
      present: 1,
      absent: 0,
      pending: 1,
    })

    const before = await snapshot(t.id)
    assertError(
      await post(marksUrl, t.homeroom.cookie, { marks: [{ studentId: 's-3', status: 'present' }] }),
      422,
      'trip_day_student_not_in_group',
    )
    assertError(
      await post(marksUrl, t.homeroom.cookie, {
        marks: [{ studentId: 's-2', status: 'present', markedAt: '2026-10-20T08:00:00.000Z' }],
      }),
      422,
      'trip_day_mark_future',
    )
    assertError(
      await versioned(
        'POST',
        `${checkUrl(planId, check.id)}/complete`,
        t.homeroom.cookie,
        {},
        check.version,
      ),
      422,
      'trip_day_check_missing',
    )
    assertError(
      await versioned(
        'POST',
        `${checkUrl(planId, check.id)}/proceed`,
        t.homeroom.cookie,
        { reason: 'Ece gelmedi' },
        check.version,
      ),
      422,
      'trip_day_check_unmarked',
    )
    assertError(
      await versioned(
        'POST',
        `${checkUrl(planId, check.id)}/proceed`,
        t.homeroom.cookie,
        { reason: 'x' },
        check.version,
      ),
      400,
    )
    assertError(
      await versioned(
        'POST',
        `${checkUrl(planId, check.id)}/complete`,
        t.homeroom.cookie,
        {},
        check.version + 5,
      ),
      409,
    )
    assert.equal(await snapshot(t.id), before)

    ok(
      await post(marksUrl, t.homeroom.cookie, {
        marks: [{ studentId: 's-2', status: 'absent', markedAt: '2026-10-20T06:58:00.000Z' }],
      }),
    )
    assertError(
      await versioned(
        'POST',
        `${checkUrl(planId, check.id)}/complete`,
        t.homeroom.cookie,
        {},
        check.version,
      ),
      422,
      'trip_day_check_missing',
    )
    const proceeded = ok(
      await versioned(
        'POST',
        `${checkUrl(planId, check.id)}/proceed`,
        t.homeroom.cookie,
        { reason: 'Ece veliyle ayrıldı, müdür bilgilendirildi' },
        check.version,
      ),
    )
    const closed = lastCheck(groupOf(proceeded, '1. otobüs'))
    assert.equal(closed.status, 'incomplete')
    assert.equal(closed.missingReason, 'Ece veliyle ayrıldı, müdür bilgilendirildi')
    const [stored] = await rows(t.id).checks()
    assert.equal(stored?.missingCount, 1)
    const [audit] = await audits(t.id, 'finance.trip_day.check_proceed')
    assert.deepEqual(audit?.changes, {
      fields: ['status', 'closedAt', 'missingCount', 'missingReason'],
    })
    assert.equal(JSON.stringify(audit).includes('Ece veliyle'), false)
    // Ön büro turu görür, gerekçeyi görmez; biten turda işaret değişmez.
    const deskView = lastCheck(groupOf(ok(await get(dayUrl(planId), t.desk)), '1. otobüs'))
    assert.equal(deskView.missingReason, null)
    assertError(
      await post(marksUrl, t.homeroom.cookie, { marks: [{ studentId: 's-2', status: 'present' }] }),
      422,
      'trip_day_check_closed',
    )

    // İkinci tur: herkes var, tamam.
    const second = ok(await post(checksUrl(planId, bus), t.admin, { checkpoint: 'Varış' }), 201)
    const arrival = lastCheck(groupOf(second, '1. otobüs'))
    ok(
      await post(`${checkUrl(planId, arrival.id)}/marks`, t.admin, {
        marks: [
          { studentId: 's-1', status: 'present' },
          { studentId: 's-2', status: 'present' },
        ],
      }),
    )
    assertError(
      await versioned(
        'POST',
        `${checkUrl(planId, arrival.id)}/proceed`,
        t.admin,
        { reason: 'Herkes burada' },
        arrival.version,
      ),
      422,
      'trip_day_check_no_missing',
    )
    const done = ok(
      await versioned(
        'POST',
        `${checkUrl(planId, arrival.id)}/complete`,
        t.admin,
        {},
        arrival.version,
      ),
    )
    assert.equal(lastCheck(groupOf(done, '1. otobüs')).status, 'complete')
    assertError(
      await versioned(
        'POST',
        `${checkUrl(planId, arrival.id)}/complete`,
        t.admin,
        {},
        arrival.version + 1,
      ),
      409,
      'trip_day_check_already_closed',
    )
    // Turu açılmış grup kaldırılmaz.
    const group = groupOf(done, '1. otobüs')
    assertError(
      await versioned('DELETE', groupUrl(planId, bus), t.desk, undefined, group.version),
      422,
      'trip_day_group_has_checks',
    )
  })

  test('DOM-FIN-154: veli çocuğunun son kontrol noktasını görür, bildirim yok (K-519)', async () => {
    const t = await institution()
    const { planId, bus } = await setup(t)
    now = ON_TRIP
    assert.deepEqual(
      (ok(await get(MY, t.mother)) as unknown as Json[]).map((row) => [
        row.studentId,
        row.checkpoint,
      ]),
      [['s-1', null]],
    )
    const started = ok(
      await post(checksUrl(planId, bus), t.admin, { checkpoint: 'Okuldan çıkış' }),
      201,
    )
    const check = lastCheck(groupOf(started, '1. otobüs'))
    ok(
      await post(`${checkUrl(planId, check.id)}/marks`, t.admin, {
        marks: [
          { studentId: 's-1', status: 'present' },
          { studentId: 's-2', status: 'present' },
        ],
      }),
    )
    ok(
      await versioned('POST', `${checkUrl(planId, check.id)}/complete`, t.admin, {}, check.version),
    )
    const [row, ...rest] = ok(await get(MY, t.mother)) as unknown as Json[]
    assert.equal(rest.length, 0)
    assert.equal(row?.studentName, 'Deniz Yılmaz')
    assert.equal(row?.groupName, '1. otobüs')
    assert.equal(row?.leaderName, 'Test Kullanıcı')
    assert.equal(row?.checkpoint, 'Okuldan çıkış')
    assert.equal(row?.status, 'present')
    assert.equal(row?.checkedAt, ON_TRIP.toISOString())
    // Gezi bitince görünüm boşalır.
    now = new Date('2026-10-21T08:00:00.000Z')
    assert.deepEqual(ok(await get(MY, t.mother)), [])
  })

  test('DOM-FIN-154: acil kart maskeli telefon, en az bilgiyle sağlık uyarısı ve denetim (K-518)', async () => {
    const t = await institution()
    const { planId, bus, blue } = await setup(t)
    ok(
      await call('PATCH', '/api/v1/students/s-1/health-profile', t.admin, {
        allergies: [{ name: 'Yerfıstığı', severity: 'severe' }],
        medications: [{ name: 'Salbutamol' }],
        emergencyInstructions: 'Adrenalin oto-enjektörü çantada.',
        legalBasis: 'explicit_consent',
        version: 1,
      }),
    )
    // Gerekçesiz okuma 400; denetim yazılmaz (DOM-FIN-156).
    assertError(
      await card(cardUrl(planId, bus), t.homeroom.cookie, null),
      400,
      'health_access_reason_required',
    )
    assert.equal((await audits(t.id, 'finance.trip_day.emergency_card')).length, 0)
    // Gezi öncesi: sorumlu maskeli kartı açar, tam telefonlu kartı açamaz.
    const office = ok(await card(cardUrl(planId, bus), t.homeroom.cookie))
    assert.equal(office.phonesMasked, true)
    assert.equal(office.cardDay, TRIP_DAY)
    const students = office.students as {
      studentId: string
      contacts: { name: string | null; phone: string | null }[]
      health: Json
    }[]
    const deniz = students.find((row) => row.studentId === 's-1')
    // Hesaplı veli bağı (K-501): ad hesaptan, telefon veli kaydından (bağda veli kaydı yok).
    assert.deepEqual(deniz?.contacts, [
      { name: 'Test Kullanıcı', relationship: 'other', phone: null },
    ])
    // Bağı olmayan öğrencide kayıttaki veli; telefon maskeli.
    assert.deepEqual(students.find((row) => row.studentId === 's-2')?.contacts, [
      { name: 'Ayşe Yılmaz', relationship: 'mother', phone: '0532 *** ** 67' },
    ])
    // Sınıf öğretmeni tam profili okur; karta yalnız tür ve talimat girer.
    assert.deepEqual(deniz?.health, {
      alert: true,
      kinds: ['allergy', 'medication'],
      action: 'Adrenalin oto-enjektörü çantada.',
      medicationToday: false,
      source: 'profile',
    })
    assert.equal(JSON.stringify(office).includes('Yerfıstığı'), false)
    assert.equal(JSON.stringify(office).includes('Salbutamol'), false)
    assertError(
      await card(cardUrl(planId, bus, 'emergency'), t.homeroom.cookie),
      403,
      'trip_day_card_full_forbidden',
    )
    const full = ok(await card(cardUrl(planId, bus, 'emergency'), t.admin))
    assert.equal(full.phonesMasked, false)
    assert.equal(
      (full.students as { studentId: string; contacts: { phone: string }[] }[]).find(
        (row) => row.studentId === 's-2',
      )?.contacts[0]?.phone,
      '05321234567',
    )
    now = ON_TRIP
    ok(await card(cardUrl(planId, bus, 'emergency'), t.homeroom.cookie))

    // Sağlık profiline erişimi olmayan sorumlu: yalnız revirdeki onaylı ilaç işareti.
    const mother = t.mother
    const consent = ok(
      await post('/api/v1/finance/infirmary/medication-consents', mother, {
        studentId: 's-1',
        medicationName: 'Parol şurup',
        dose: '5 ml',
        times: ['12:30'],
        startDate: TRIP_DAY,
        endDate: TRIP_DAY,
      }),
      201,
    )
    ok(
      await versioned(
        'POST',
        `/api/v1/finance/infirmary/medication-consents/${String(consent.id)}/approve`,
        t.admin,
        {},
        consent.version,
      ),
    )
    ok(await post(assignUrl(planId), t.desk, { groupId: blue, studentIds: ['s-1'] }))
    const blind = ok(await card(cardUrl(planId, blue), t.outsider.cookie))
    const row = (blind.students as { studentId: string; health: Json }[]).find(
      (item) => item.studentId === 's-1',
    )
    assert.deepEqual(row?.health, {
      alert: true,
      kinds: [],
      action: null,
      medicationToday: true,
      source: 'unavailable',
    })
    assert.equal(JSON.stringify(blind).includes('Parol'), false)

    const office1 = await audits(t.id, 'finance.trip_day.emergency_card')
    const full1 = await audits(t.id, 'finance.trip_day.emergency_card_full')
    assert.equal(office1.length, 2)
    assert.equal(full1.length, 2)
    assert.deepEqual(office1[0]?.changes, {
      fields: ['studentName', 'className', 'contactName', 'contactPhone', 'healthAlert'],
    })
    // Her açılış gerekçesiyle sağlık erişim günlüğüne düşer (DOM-FIN-156).
    const reasons = await db
      .select()
      .from(healthAccessReasons)
      .where(eq(healthAccessReasons.institutionId, t.id))
    assert.equal(reasons.length, 4)
    assert.ok(reasons.every((row) => row.reasonCode === 'emergency' && row.studentId === null))
    assert.equal(JSON.stringify(full1).includes('0532'), false)
    // Sağlık profili okuması kendi denetimini bırakır (IST-020).
    assert.ok((await audits(t.id, 'health_profile.read')).length >= 1)
  })

  test('DOM-FIN-154: başka kurumun planı, grubu ve turu 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const b = await institution()
    const bSetup = await setup(b)
    now = ON_TRIP
    const bDay = ok(
      await post(checksUrl(bSetup.planId, bSetup.bus), b.admin, { checkpoint: 'Varış' }),
      201,
    )
    const bCheck = lastCheck(groupOf(bDay, '1. otobüs'))
    const a = await institution()
    const aSetup = await setup(a)
    now = ON_TRIP
    const before = await snapshot(b.id)
    assertError(await get(dayUrl(bSetup.planId), a.admin), 404)
    assertError(
      await post(groupsUrl(bSetup.planId), a.admin, {
        name: 'Sızma',
        leaderMembershipId: a.homeroom.membershipId,
      }),
      404,
    )
    assertError(
      await versioned('PATCH', groupUrl(bSetup.planId, bSetup.bus), a.admin, { name: 'Sızma' }, 1),
      404,
    )
    assertError(
      await versioned('PATCH', groupUrl(aSetup.planId, bSetup.bus), a.admin, { name: 'Sızma' }, 1),
      404,
    )
    assertError(
      await versioned('DELETE', groupUrl(bSetup.planId, bSetup.bus), a.admin, undefined, 1),
      404,
    )
    assertError(
      await post(assignUrl(bSetup.planId), a.admin, { groupId: bSetup.bus, studentIds: ['s-1'] }),
      404,
    )
    assertError(
      await post(assignUrl(aSetup.planId), a.admin, { groupId: bSetup.bus, studentIds: ['s-1'] }),
      422,
      'trip_day_group_not_found',
    )
    assertError(
      await post(checksUrl(bSetup.planId, bSetup.bus), a.admin, { checkpoint: 'Varış' }),
      404,
    )
    assertError(
      await post(checksUrl(aSetup.planId, bSetup.bus), a.admin, { checkpoint: 'Varış' }),
      404,
    )
    assertError(
      await post(`${checkUrl(bSetup.planId, bCheck.id)}/marks`, a.admin, {
        marks: [{ studentId: 's-1', status: 'present' }],
      }),
      404,
    )
    assertError(
      await post(`${checkUrl(aSetup.planId, bCheck.id)}/marks`, a.admin, {
        marks: [{ studentId: 's-1', status: 'present' }],
      }),
      404,
    )
    assertError(
      await versioned(
        'POST',
        `${checkUrl(bSetup.planId, bCheck.id)}/complete`,
        a.admin,
        {},
        bCheck.version,
      ),
      404,
    )
    assertError(
      await versioned(
        'POST',
        `${checkUrl(bSetup.planId, bCheck.id)}/proceed`,
        a.admin,
        { reason: 'Sızma denemesi' },
        bCheck.version,
      ),
      404,
    )
    assertError(await card(cardUrl(bSetup.planId, bSetup.bus), a.admin), 404)
    assertError(
      await post(groupsUrl(aSetup.planId), a.admin, {
        name: 'Gövdede kurum',
        leaderMembershipId: a.homeroom.membershipId,
        institutionId: b.id,
      }),
      400,
    )
    assert.equal(await snapshot(b.id), before)
    // A'nın velisi B'nin gezisini görmez.
    assert.equal(
      (ok(await get(MY, a.mother)) as unknown as Json[]).some(
        (row) => row.planId === bSetup.planId,
      ),
      false,
    )
  })
})
