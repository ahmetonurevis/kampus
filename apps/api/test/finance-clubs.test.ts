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
  schoolClubAttendance,
  schoolClubMembers,
  schoolClubs,
} from '../src/db/schema/finance-clubs.ts'
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
 * Kulüp uçları (DOM-FIN-142; ON-098; IST-099; K-483). Her test kendi kurumunu kurar. FIXED_NOW
 * 2026-10-06T09:00Z (Europe/Istanbul günü 2026-10-06).
 */

const BASE = '/api/v1/finance/clubs'
const MY = `${BASE}/my`

const SEED = createSeed(FIXED_NOW)

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>
type Member = { id: string; studentId: string; version: number }

describe('DOM-FIN-142: kulüp uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.99.0.1'

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
    clientIp = `10.99.${String((tenantCount += 1))}.1`
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
    const teacher = await createMember(app, created.id, 'ogretmen')
    return {
      id: created.id,
      admin: await signInAs(app, created.admin),
      teacherId: teacher.membershipId,
      teacher: await signInAs(app, teacher),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  const clubBody = (teacherMembershipId: string, extra: Json = {}) => ({
    name: 'Bilim ve Robotik',
    teacherMembershipId,
    capacity: 2,
    meetingDay: 3,
    startTime: '15:30',
    endTime: '16:30',
    ...extra,
  })
  const clubUrl = (id: unknown) => `${BASE}/${String(id)}`
  async function clubWithMembers(t: Tenant, studentIds: string[] = ['s1', 's2']) {
    const club = ok(await post(BASE, t.admin, clubBody(t.teacherId)), 201)
    const members: Member[] = []
    for (const studentId of studentIds)
      members.push(
        ok(await post(`${clubUrl(club.id)}/members`, t.admin, { studentId }), 201) as Member,
      )
    return { club, members }
  }
  const marksFor = (members: readonly Member[], status = 'present') =>
    members.map((member) => ({ memberId: member.id, status }))

  test('kimliksiz istek 401', async () => {
    assertError(await get(BASE, null), 401)
    assertError(await post(BASE, null, {}), 401)
    assertError(await get(MY, null), 401)
  })

  test('DOM-FIN-142: öğretmen yalnız kendi kulübünü okur ve yoklamasını alır; ön büro yoklama almaz; modül kapalı 403 (K-483)', async () => {
    const t = await institution()
    const { club, members } = await clubWithMembers(t)
    const otherTeacher = await signInAs(app, await createMember(app, t.id, 'ogretmen'))
    const desk = await signInAs(app, await createMember(app, t.id, 'onburo'))
    const parent = await signInAs(app, await createMember(app, t.id, 'veli'))
    assertError(await post(BASE, t.teacher, clubBody(t.teacherId, { name: 'Satranç' })), 403)
    assertError(await get(BASE, parent), 403)
    assert.equal((await get(BASE, t.teacher)).json().meta.total, 1)
    assert.equal((await get(BASE, otherTeacher)).json().meta.total, 0)
    assertError(await get(clubUrl(club.id), otherTeacher), 404)
    const body = { sessionDate: '2026-10-06', marks: marksFor(members) }
    assertError(await post(`${clubUrl(club.id)}/sessions`, otherTeacher, body), 404)
    assertError(await post(`${clubUrl(club.id)}/sessions`, desk, body), 403)
    ok(await post(`${clubUrl(club.id)}/sessions`, t.teacher, body), 201)
    ok(await post(BASE, desk, clubBody(t.teacherId, { name: 'Satranç' })), 201)
    const closed = await institution({ enabledModules: { clubs: false } })
    assertError(await get(BASE, closed.admin), 403, 'module_disabled')
  })

  test('DOM-FIN-142: kulüp açma, sorumlu öğretmen, ad tekilliği ve düzenleme (K-483)', async () => {
    const t = await institution()
    const desk = await createMember(app, t.id, 'onburo')
    assertError(await post(BASE, t.admin, clubBody(t.teacherId, { endTime: '15:00' })), 400)
    assertError(
      await post(BASE, t.admin, clubBody(desk.membershipId)),
      422,
      'club_teacher_not_teacher',
    )
    assertError(await post(BASE, t.admin, clubBody('test-yok')), 422, 'club_teacher_not_found')
    assertError(
      await call('POST', BASE, t.admin, clubBody(t.teacherId)),
      400,
      'idempotency_key_required',
    )
    assert.equal(
      (await db.select().from(schoolClubs).where(eq(schoolClubs.institutionId, t.id))).length,
      0,
    )
    const key = randomUUID()
    const club = ok(await post(BASE, t.admin, clubBody(t.teacherId), key), 201)
    assert.equal(club.memberCount, 0)
    assert.equal(typeof club.teacherName, 'string')
    const replay = await post(BASE, t.admin, clubBody(t.teacherId), key)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(await post(BASE, t.admin, clubBody(t.teacherId)), 409, 'club_name_taken')
    const url = clubUrl(club.id)
    const changed = ok(await patch(url, t.admin, { capacity: 5, meetingDay: 4 }, club.version))
    assert.equal(changed.capacity, 5)
    assertError(await patch(url, t.admin, { capacity: 6 }, club.version), 409)
    assertError(
      await patch(url, t.admin, { endTime: '15:00' }, changed.version),
      422,
      'club_time_order',
    )
    assertError(await patch(url, t.admin, { capacity: 5 }, changed.version), 422, 'club_unchanged')
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.entityType, 'school_clubs')))
    assert.deepEqual(audits.map((row) => row.action).sort(), [
      'finance.club.create',
      'finance.club.update',
    ])
    ok(await remove(url, t.admin, changed.version))
    assert.equal((await get(BASE, t.admin)).json().meta.total, 0)
  })

  test('DOM-FIN-142: üyelik tekil ve kontenjanlı; dolu kulüp 409, üyeli kulüp arşivlenmez (K-483)', async () => {
    const t = await institution()
    const club = ok(await post(BASE, t.admin, clubBody(t.teacherId)), 201)
    const url = `${clubUrl(club.id)}/members`
    assertError(await post(url, t.admin, { studentId: 'test-yok' }), 422, 'club_student_not_found')
    assertError(
      await post(url, t.admin, { studentId: 'test-s-left' }),
      422,
      'club_student_inactive',
    )
    const key = randomUUID()
    const first = ok(await post(url, t.admin, { studentId: 's1' }, key), 201) as Member
    const replay = await post(url, t.admin, { studentId: 's1' }, key)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(await post(url, t.admin, { studentId: 's1' }), 409, 'club_member_exists')
    ok(await post(url, t.admin, { studentId: 's2' }), 201)
    assertError(await post(url, t.admin, { studentId: 's3' }), 409, 'club_capacity_full')
    const rows = await db
      .select()
      .from(schoolClubMembers)
      .where(eq(schoolClubMembers.institutionId, t.id))
    assert.equal(rows.length, 2)
    const detail = ok(await get(clubUrl(club.id), t.admin))
    assert.equal(detail.memberCount, 2)
    assertError(
      await patch(clubUrl(club.id), t.admin, { capacity: 1 }, detail.version),
      422,
      'club_capacity_below_members',
    )
    assertError(await remove(clubUrl(club.id), t.admin, detail.version), 422, 'club_has_members')
    ok(await remove(`${url}/${first.id}`, t.admin, first.version))
    ok(await post(url, t.admin, { studentId: 's3' }), 201)
    assertError(await post(url, t.admin, { studentId: 's1' }), 409, 'club_capacity_full')
  })

  test('DOM-FIN-142: yoklama bütün üyeleri ister, aynı gün yinelenmez, yanlış oturum arşivlenir (K-483)', async () => {
    const t = await institution()
    const empty = ok(await post(BASE, t.admin, clubBody(t.teacherId, { name: 'Boş kulüp' })), 201)
    const { club, members } = await clubWithMembers(t)
    const url = `${clubUrl(club.id)}/sessions`
    assertError(
      await post(`${clubUrl(empty.id)}/sessions`, t.admin, {
        sessionDate: '2026-10-06',
        marks: [{ memberId: randomUUID(), status: 'present' }],
      }),
      422,
      'club_no_members',
    )
    assertError(
      await post(url, t.admin, { sessionDate: '2026-10-07', marks: marksFor(members) }),
      422,
      'club_session_future',
    )
    assertError(
      await post(url, t.admin, { sessionDate: '2026-10-06', marks: marksFor(members.slice(0, 1)) }),
      422,
      'club_attendance_incomplete',
    )
    assertError(
      await post(url, t.admin, {
        sessionDate: '2026-10-06',
        marks: [...marksFor(members.slice(0, 1)), { memberId: randomUUID(), status: 'absent' }],
      }),
      422,
      'club_attendance_unknown_member',
    )
    assertError(
      await post(url, t.admin, { sessionDate: '2026-10-06', marks: [{ memberId: 'x' }] }),
      400,
    )
    const marked = () =>
      db.select().from(schoolClubAttendance).where(eq(schoolClubAttendance.institutionId, t.id))
    assert.equal((await marked()).length, 0)

    const [m1, m2] = members
    assert.ok(m1 && m2)
    const body = {
      sessionDate: '2026-10-06',
      marks: [
        { memberId: m1.id, status: 'present' },
        { memberId: m2.id, status: 'excused' },
      ],
    }
    const key = randomUUID()
    const session = ok(await post(url, t.admin, body, key), 201)
    assert.deepEqual(session.counts, { present: 1, absent: 0, excused: 1 })
    const replay = await post(url, t.admin, body, key)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(await post(url, t.admin, body), 409, 'club_session_exists')
    assert.equal((await marked()).length, 2)

    const detail = ok(await get(clubUrl(club.id), t.admin))
    const deniz = (detail.members as Json[]).find((row) => row.studentId === 's1')
    assert.equal(deniz?.presentCount, 1)
    assert.equal((detail.sessions as Json[]).length, 1)
    const sessionUrl = `${url}/${String(session.id)}`
    const read = ok(await get(sessionUrl, t.teacher))
    assert.equal((read.marks as Json[]).length, 2)
    ok(await remove(sessionUrl, t.admin, session.version))
    assertError(await get(sessionUrl, t.admin), 404)
    ok(await post(url, t.admin, { ...body, marks: marksFor(members, 'absent') }), 201)
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'finance.club.attendance')))
    assert.equal(audits.length, 2)
    assert.ok(!JSON.stringify(audits).includes('excused'))
  })

  test('DOM-FIN-142: veli yalnız kendi çocuğunun kulübünü, öğrenci kendi kulübünü görür (K-483)', async () => {
    const t = await institution()
    const { club, members } = await clubWithMembers(t)
    ok(
      await post(`${clubUrl(club.id)}/sessions`, t.admin, {
        sessionDate: '2026-10-06',
        marks: marksFor(members),
      }),
      201,
    )
    const parent = await signInAs(
      app,
      await createMember(app, t.id, 'veli', [{ kind: 'child', recordId: 's1' }]),
    )
    const mine = ok(await get(MY, parent)) as unknown as Json[]
    assert.equal(mine.length, 1)
    assert.equal(mine[0]?.studentId, 's1')
    assert.equal(mine[0]?.clubName, 'Bilim ve Robotik')
    assert.equal(mine[0]?.meetingDay, 3)
    assert.equal(mine[0]?.presentCount, 1)
    const student = await signInAs(
      app,
      await createMember(app, t.id, 'ogrenci', [{ kind: 'student', recordId: 's3' }]),
    )
    assert.deepEqual(ok(await get(MY, student)), [])
    assertError(await get(MY, t.teacher), 403)
  })

  test('DOM-FIN-142: başka kurumun kulübü, üyeliği ve oturumu 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const { club: bClub, members: bMembers } = await clubWithMembers(b)
    const bSession = ok(
      await post(`${clubUrl(bClub.id)}/sessions`, b.admin, {
        sessionDate: '2026-10-06',
        marks: marksFor(bMembers),
      }),
      201,
    )
    const bUrl = clubUrl(bClub.id)
    const bMember = bMembers[0]
    assert.ok(bMember)
    assertError(await get(bUrl, a.admin), 404)
    assertError(await patch(bUrl, a.admin, { capacity: 9 }, bClub.version), 404)
    assertError(await remove(bUrl, a.admin, bClub.version), 404)
    assertError(await post(`${bUrl}/members`, a.admin, { studentId: 's3' }), 404)
    assertError(await remove(`${bUrl}/members/${bMember.id}`, a.admin, bMember.version), 404)
    assertError(
      await post(`${bUrl}/sessions`, a.admin, {
        sessionDate: '2026-10-05',
        marks: marksFor(bMembers),
      }),
      404,
    )
    assertError(await get(`${bUrl}/sessions/${String(bSession.id)}`, a.admin), 404)
    assertError(await remove(`${bUrl}/sessions/${String(bSession.id)}`, a.admin, 1), 404)
    assert.equal((await get(BASE, a.admin)).json().meta.total, 0)
    // Aynı öğrenci kimliği (s1) B'de üye; A'nın velisi B'nin üyeliğini görmez.
    const aParent = await signInAs(
      app,
      await createMember(app, a.id, 'veli', [{ kind: 'child', recordId: 's1' }]),
    )
    assert.deepEqual(ok(await get(MY, aParent)), [])
    assertError(await post(BASE, a.admin, clubBody(a.teacherId, { institutionId: b.id })), 400)
    assertError(await post(BASE, a.admin, clubBody(b.teacherId)), 422, 'club_teacher_not_found')
    const [bRow] = await db.select().from(schoolClubs).where(eq(schoolClubs.institutionId, b.id))
    assert.equal(bRow?.capacity, 2)
    assert.equal(bRow?.archivedAt, null)
    const bMemberRows = await db
      .select()
      .from(schoolClubMembers)
      .where(eq(schoolClubMembers.institutionId, b.id))
    assert.equal(bMemberRows.filter((row) => row.archivedAt === null).length, 2)
  })
})
