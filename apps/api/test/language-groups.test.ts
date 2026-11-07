import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import { insertProgressionDecision, listProgressionDecisions } from '../src/db/cefr.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { progressionDecisions } from '../src/db/schema/cefr.ts'
import { coordinatorDuties } from '../src/db/schema/coordinator-duties.ts'
import { records } from '../src/db/schema/records.ts'
import {
  languageGroupMembers,
  languageGroups,
  languageGroupWaitlist,
} from '../src/db/schema/language-groups.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'

/**
 * Dil okulu grup uçları (IST-077; DOM-DIL-003, -008, -040…043). Kural core
 * `lib/language-groups.ts`'tedir; burada kurum türü (okulda 404, rol reddinden önce), rol ve
 * koordinatör kapsamı, başka kurum, sürüm (`If-Match`), mükerrer işlem (`Idempotency-Key`),
 * çakışma, kapasite, açılış, birleştirme, bekleme sırası, kur arşivi ve öğrenci/veli yanıtının
 * daralması denetlenir. Saat 6 Ekim 2026; gruplar 12 Ekim Pazartesi başlar.
 */

type Json = ReturnType<typeof JSON.parse>
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

const COURSE = {
  name: 'Genel İngilizce B1.1',
  level: 'B1',
  totalHours: 12,
  weeklyHours: 4,
  minLearners: 2,
  maxLearners: 12,
}
const SCHEDULE = [
  { weekday: 1, startTime: '18:00' },
  { weekday: 1, startTime: '18:45' },
  { weekday: 3, startTime: '18:00' },
  { weekday: 3, startTime: '18:45' },
]
const MORNING = SCHEDULE.map((slot) => ({ ...slot, startTime: slot.startTime.replace('18', '10') }))

describe('dil okulu grup uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '127.0.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: Method,
    url: string,
    cookie?: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie ? { cookie } : {}),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const key = () => ({ 'idempotency-key': randomUUID() })
  const match = (value: number) => ({ 'if-match': `"${value}"` })
  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function fails(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code, response.body)
  }

  async function tenant(type: 'school' | 'language_school' = 'language_school') {
    clientIp = `10.29.${(tenantCount += 1)}.1`
    const institution = await createInstitution(app, { type })
    const users = {
      frontDesk: await createMember(app, institution.id, 'onburo'),
      teacher: await createMember(app, institution.id, 'ogretmen'),
      other: await createMember(app, institution.id, 'ogretmen'),
      coordinator: await createMember(app, institution.id, 'ogretmen'),
      student: await createMember(app, institution.id, 'ogrenci', [
        { kind: 'student', recordId: 's-deniz' },
      ]),
      parent: await createMember(app, institution.id, 'veli', [
        { kind: 'child', recordId: 's-deniz' },
      ]),
    }
    await db.insert(coordinatorDuties).values({
      institutionId: institution.id,
      id: randomUUID(),
      membershipId: users.coordinator.membershipId,
      kind: 'academic_coordinator',
      scopeId: 'B1',
      assignedByUserId: institution.admin.id,
    })
    const cookies = {
      admin: await signInAs(app, institution.admin),
      frontDesk: await signInAs(app, users.frontDesk),
      teacher: await signInAs(app, users.teacher),
      other: await signInAs(app, users.other),
      coordinator: await signInAs(app, users.coordinator),
      student: await signInAs(app, users.student),
      parent: await signInAs(app, users.parent),
    }
    let courseId = randomUUID()
    if (type === 'language_school') {
      const course = await ok(await call('POST', '/courses', cookies.admin, COURSE, key()), 201)
      await ok(await call('POST', `/courses/${course.id}/activate`, cookies.admin, {}, match(1)))
      courseId = course.id
    }
    const body = (overrides: Record<string, unknown> = {}) => ({
      courseId,
      name: 'B1 Akşam',
      ageBand: 'adult',
      teacherMembershipId: users.teacher.membershipId,
      delivery: 'in_person',
      room: 'Derslik 1',
      schedule: SCHEDULE,
      startDate: '2026-10-12',
      capacity: 10,
      ...overrides,
    })
    return { institution, users, cookies, courseId, body }
  }

  const create = (cookie: string, body: unknown, headers: Record<string, string> = key()) =>
    call('POST', '/groups', cookie, body, headers)
  const patch = (cookie: string, id: string, body: unknown, version: number) =>
    call('PATCH', `/groups/${id}`, cookie, body, match(version))
  const command = (cookie: string, id: string, verb: string, version: number, body: unknown = {}) =>
    call('POST', `/groups/${id}/${verb}`, cookie, body, match(version))

  const groupRows = (institutionId: string) =>
    db.select().from(languageGroups).where(eq(languageGroups.institutionId, institutionId))
  const memberRows = (institutionId: string, groupId: string) =>
    db
      .select()
      .from(languageGroupMembers)
      .where(
        and(
          eq(languageGroupMembers.institutionId, institutionId),
          eq(languageGroupMembers.groupId, groupId),
        ),
      )
  // Kursiyer `students` kaydıdır (yabancı anahtar); kayıt yoksa en küçük haliyle yazılır.
  async function addMembers(institutionId: string, groupId: string, studentIds: string[]) {
    await db
      .insert(records)
      .values(
        studentIds.map((id) => ({
          institutionId,
          collection: 'students',
          id,
          data: { id },
          position: 1,
        })),
      )
      .onConflictDoNothing()
    await db.insert(languageGroupMembers).values(
      studentIds.map((studentId) => ({
        institutionId,
        id: randomUUID(),
        groupId,
        studentId,
        status: 'active' as const,
        joinedAt: FIXED_NOW,
      })),
    )
  }

  test('401: oturumsuz okuma ve yazma reddedilir', async () => {
    fails(await call('GET', '/groups'), 401, 'unauthenticated')
    fails(await call('GET', `/groups/${randomUUID()}`), 401, 'unauthenticated')
    fails(await call('GET', `/groups/${randomUUID()}/waitlist`), 401, 'unauthenticated')
    fails(await create('', {}), 401, 'unauthenticated')
  })

  test('DOM-DIL-008: okulda grup uçları her rol için 404, rol reddinden önce', async () => {
    const { cookies, body } = await tenant('school')
    for (const cookie of [cookies.admin, cookies.student, cookies.frontDesk]) {
      fails(await call('GET', '/groups', cookie), 404, 'not_found')
      fails(await create(cookie, body()), 404, 'not_found')
      fails(await call('GET', `/groups/${randomUUID()}/waitlist`, cookie), 404, 'not_found')
    }
  })

  test('403: yazma yalnız yönetici ve öğretmende, sıra yalnız yönetici ve ön büroda; rol reddi gövdeden önce', async () => {
    const { cookies } = await tenant()
    for (const cookie of [cookies.frontDesk, cookies.student, cookies.parent])
      fails(await create(cookie, { bozuk: true }), 403, 'forbidden')
    fails(await patch(cookies.frontDesk, randomUUID(), { name: 'X' }, 1), 403, 'forbidden')
    for (const cookie of [cookies.teacher, cookies.student, cookies.parent])
      fails(await call('GET', `/groups/${randomUUID()}/waitlist`, cookie), 403, 'forbidden')
  })

  test('IST-077: yönetici grup planlar; 201 + Location, bitiş hesaplanır, denetimde yalnız alan adları', async () => {
    const { institution, cookies, body } = await tenant()
    const response = await create(cookies.admin, body({ schedule: [...SCHEDULE].reverse() }))
    const group = await ok(response, 201)
    assert.equal(response.headers.location, `/api/v1/groups/${group.id}`)
    assert.equal(group.status, 'planned')
    assert.equal(group.endDate, '2026-10-28')
    assert.equal(group.level, 'B1')
    assert.equal(group.sessionMinutes, 45)
    assert.equal(group.freeSeats, 10)
    assert.equal(group.rowVersion, 1)
    assert.deepEqual(group.schedule, SCHEDULE)
    const [row] = await groupRows(institution.id)
    assert.equal(row?.nameKey, 'b1 akşam')
    assert.equal(row?.roomKey, 'derslik 1')
    assert.equal(row?.endDate, '2026-10-28')
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, institution.id),
          eq(auditLog.action, 'language_group.create'),
        ),
      )
    assert.equal(audits.length, 1)
    assert.ok(!JSON.stringify(audits[0]?.changes).includes('Derslik'))
    const read = await ok(await call('GET', `/groups/${group.id}`, cookies.frontDesk))
    assert.deepEqual(read.members, [])
  })

  test('mükerrer işlem: aynı Idempotency-Key ilk yanıtı tekrarlar; aynı ad 409; anahtarsız 400', async () => {
    const { institution, cookies, body } = await tenant()
    const headers = key()
    const first = await ok(await create(cookies.admin, body(), headers), 201)
    const replay = await create(cookies.admin, body(), headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(replay.json().data.id, first.id)
    fails(
      await create(cookies.admin, body({ name: 'b1 AKŞAM', schedule: MORNING })),
      409,
      'group_name_exists',
    )
    fails(await create(cookies.admin, body(), {}), 400, 'idempotency_key_required')
    assert.equal((await groupRows(institution.id)).length, 1)
  })

  test('400: geçersiz gövde, gövdede institutionId ve If-Match eksikliği grubu değiştirmez', async () => {
    const { institution, cookies, body } = await tenant()
    const group = await ok(await create(cookies.admin, body()), 201)
    const before = await groupRows(institution.id)
    for (const invalid of [
      body({ capacity: 19 }),
      body({ startDate: '2026-02-30' }),
      body({ institutionId: randomUUID() }),
      body({ schedule: [{ weekday: 9, startTime: '18:00' }] }),
    ])
      fails(await create(cookies.admin, invalid), 400, 'validation_failed')
    fails(await patch(cookies.admin, group.id, { capacity: 0 }, 1), 400, 'validation_failed')
    fails(
      await call('PATCH', `/groups/${group.id}`, cookies.admin, { name: 'X' }),
      400,
      'if_match_required',
    )
    assert.deepEqual(await groupRows(institution.id), before)
  })

  test('başka kurumun grubu 404, listede görünmez ve değişmez', async () => {
    const a = await tenant()
    const groupA = await ok(await create(a.cookies.admin, a.body()), 201)
    const b = await tenant()
    const before = await groupRows(a.institution.id)
    fails(await call('GET', `/groups/${groupA.id}`, b.cookies.admin), 404, 'not_found')
    fails(await call('GET', `/groups/${groupA.id}/waitlist`, b.cookies.admin), 404, 'not_found')
    fails(await patch(b.cookies.admin, groupA.id, { name: 'X' }, 1), 404, 'not_found')
    fails(await command(b.cookies.admin, groupA.id, 'cancel', 1, { reason: 'X' }), 404, 'not_found')
    const list = await call('GET', '/groups', b.cookies.admin)
    assert.equal(list.json().meta.total, 0)
    // Başka kurumun kuruna grup açılmaz.
    fails(
      await create(b.cookies.admin, b.body({ courseId: a.courseId })),
      422,
      'group_course_not_found',
    )
    assert.deepEqual(await groupRows(a.institution.id), before)
  })

  test('IST-002: başka kurumun grubu açılmaz ve birleştirilmez (404); B kaynağı A hedefine taşınmaz; okulda her grup ucu 404', async () => {
    const a = await tenant()
    const b = await tenant()
    const foreign = await ok(await create(b.cookies.admin, b.body()), 201)
    await addMembers(b.institution.id, foreign.id, ['s1', 's2', 's3'])
    const own = await ok(await create(a.cookies.admin, a.body()), 201)
    const before = { a: await groupRows(a.institution.id), b: await groupRows(b.institution.id) }
    const foreignMembers = await memberRows(b.institution.id, foreign.id)
    const merge = { sourceGroupId: foreign.id, sourceVersion: 1 }
    fails(await command(a.cookies.admin, foreign.id, 'open', 1), 404, 'not_found')
    fails(await command(a.cookies.admin, foreign.id, 'merge', 1, merge), 404, 'not_found')
    // A'nın hedefine B'nin kaynak grubu: olmayan kaynakla aynı 404, kursiyerler B'de kalır.
    const missing = await command(a.cookies.admin, own.id, 'merge', 1, {
      sourceGroupId: randomUUID(),
      sourceVersion: 1,
    })
    fails(missing, 404, 'not_found')
    const crossed = await command(a.cookies.admin, own.id, 'merge', 1, merge)
    fails(crossed, 404, 'not_found')
    assert.equal(crossed.json().message, missing.json().message)
    assert.deepEqual(await groupRows(a.institution.id), before.a)
    assert.deepEqual(await groupRows(b.institution.id), before.b)
    assert.deepEqual(await memberRows(b.institution.id, foreign.id), foreignMembers)
    assert.deepEqual(await memberRows(a.institution.id, own.id), [])

    // Okulda grup yoktur: kimlikli uçlar da rol ve gövdeden önce 404 (DOM-DIL-008).
    const school = await tenant('school')
    for (const cookie of [school.cookies.admin, school.cookies.student]) {
      fails(await call('GET', `/groups/${foreign.id}`, cookie), 404, 'not_found')
      fails(await patch(cookie, foreign.id, { name: 'X' }, 1), 404, 'not_found')
      for (const verb of ['open', 'cancel', 'merge'])
        fails(await command(cookie, foreign.id, verb, 1, merge), 404, 'not_found')
    }
    assert.deepEqual(await groupRows(b.institution.id), before.b)
  })

  test('409: bayat If-Match reddedilir ve grup değişmez; değişiklik sürümü artırır', async () => {
    const { institution, cookies, body } = await tenant()
    const group = await ok(await create(cookies.admin, body()), 201)
    const changed = await ok(await patch(cookies.admin, group.id, { name: 'B1 Akşam A' }, 1))
    assert.equal(changed.rowVersion, 2)
    const before = await groupRows(institution.id)
    fails(await patch(cookies.admin, group.id, { name: 'B1 Akşam B' }, 1), 409, 'version_conflict')
    fails(await patch(cookies.admin, randomUUID(), { name: 'X' }, 1), 404, 'not_found')
    assert.deepEqual(await groupRows(institution.id), before)
  })

  test('DOM-DIL-008: öğretmen yalnız koordinatörü olduğu seviyenin grubunu planlar', async () => {
    const { cookies, body } = await tenant()
    await ok(await create(cookies.coordinator, body()), 201)
    fails(
      await create(cookies.teacher, body({ name: 'B1 Sabah', schedule: MORNING })),
      403,
      'course_coordinator_required',
    )
  })

  test('IST-077: öğretmen ve derslik çakışması 422; kapasite ve yasal saat kuralları', async () => {
    const { institution, users, cookies, body } = await tenant()
    await ok(await create(cookies.admin, body()), 201)
    const before = await groupRows(institution.id)
    fails(
      await create(cookies.admin, body({ name: 'B1 İkinci', room: 'Derslik 2' })),
      422,
      'group_teacher_conflict',
    )
    fails(
      await create(
        cookies.admin,
        body({ name: 'B1 İkinci', teacherMembershipId: users.other.membershipId }),
      ),
      422,
      'group_room_conflict',
    )
    fails(
      await create(cookies.admin, body({ name: 'B1 İkinci', schedule: MORNING, capacity: 13 })),
      422,
      'group_capacity_exceeds_course',
    )
    fails(
      await create(
        cookies.admin,
        body({
          name: 'B1 Çift',
          room: 'D8',
          schedule: SCHEDULE.map((slot) => ({ ...slot, startTime: '20:30' })),
        }),
      ),
      422,
      'group_schedule_overlap',
    )
    fails(
      await create(
        cookies.admin,
        body({
          name: 'B1 Genç',
          ageBand: 'teen',
          room: 'D9',
          schedule: [...SCHEDULE.slice(0, 3), { weekday: 5, startTime: '20:30' }],
        }),
      ),
      422,
      'group_minor_late',
    )
    fails(
      await create(cookies.admin, body({ name: 'B1 Yabancı', teacherMembershipId: 'm-yok' })),
      422,
      'group_teacher_invalid',
    )
    assert.deepEqual(await groupRows(institution.id), before)
    // Çevrim içi ve başka öğretmenle aynı saatte grup açılabilir.
    await ok(
      await create(
        cookies.admin,
        body({
          name: 'B1 Çevrim içi',
          delivery: 'online',
          room: null,
          teacherMembershipId: users.other.membershipId,
        }),
      ),
      201,
    )
  })

  test('DOM-DIL-042: açılış sayısı, kursiyerli grubun saati kilitli, kapasite doluluktan az olamaz, iptal', async () => {
    const { institution, cookies, body } = await tenant()
    const group = await ok(await create(cookies.admin, body()), 201)
    await addMembers(institution.id, group.id, ['s1'])
    fails(await command(cookies.admin, group.id, 'open', 1), 422, 'group_below_minimum')
    await addMembers(institution.id, group.id, ['s2', 's3'])
    fails(
      await patch(cookies.admin, group.id, { schedule: MORNING }, 1),
      422,
      'group_schedule_locked',
    )
    fails(
      await patch(cookies.admin, group.id, { capacity: 2 }, 1),
      422,
      'group_capacity_below_members',
    )
    const opened = await ok(await command(cookies.admin, group.id, 'open', 1))
    assert.equal(opened.status, 'open')
    assert.equal(opened.activeLearners, 3)
    fails(await command(cookies.admin, group.id, 'open', 2), 409, 'group_not_planned')
    fails(await command(cookies.admin, group.id, 'cancel', 2, {}), 400, 'validation_failed')
    const cancelled = await ok(
      await command(cookies.admin, group.id, 'cancel', 2, { reason: 'Derslik kapandı.' }),
    )
    assert.equal(cancelled.status, 'cancelled')
    fails(
      await command(cookies.admin, group.id, 'cancel', 3, { reason: 'Yine' }),
      409,
      'group_closed',
    )
    const list = await call('GET', '/groups', cookies.admin)
    assert.equal(list.json().meta.total, 0)
    const all = await call('GET', '/groups?status=cancelled', cookies.admin)
    assert.equal(all.json().meta.total, 1)
    fails(await call('GET', '/groups?bilinmeyen=1', cookies.admin), 400, 'validation_failed')
  })

  test('DOM-DIL-042: birleştirme kaynağı kapatır, kursiyerleri ve bekleyenleri taşır; kapasite sınırı', async () => {
    const { institution, users, cookies, body, courseId } = await tenant()
    const target = await ok(await create(cookies.admin, body({ capacity: 4 })), 201)
    const source = await ok(
      await create(
        cookies.admin,
        body({ name: 'B1 Akşam 2', teacherMembershipId: users.other.membershipId, room: 'D2' }),
      ),
      201,
    )
    await addMembers(institution.id, target.id, ['s1', 's2'])
    await addMembers(institution.id, source.id, ['s3', 's4', 's5'])
    const beforeGroups = await groupRows(institution.id)
    const beforeTargetMembers = await memberRows(institution.id, target.id)
    fails(
      await command(cookies.admin, target.id, 'merge', 1, {
        sourceGroupId: source.id,
        sourceVersion: 1,
      }),
      422,
      'group_merge_capacity',
    )
    fails(
      await command(cookies.admin, target.id, 'merge', 1, {
        sourceGroupId: randomUUID(),
        sourceVersion: 1,
      }),
      404,
      'not_found',
    )
    assert.equal((await memberRows(institution.id, source.id)).length, 3)
    // 422 ve 404 sonrası iki grup da (sürümleri dahil) ve hedefin kursiyerleri değişmez.
    assert.deepEqual(await groupRows(institution.id), beforeGroups)
    assert.deepEqual(await memberRows(institution.id, target.id), beforeTargetMembers)
    await ok(await patch(cookies.admin, target.id, { capacity: 5 }, 1))
    await db.insert(languageGroupWaitlist).values({
      institutionId: institution.id,
      id: randomUUID(),
      courseId,
      groupId: source.id,
      studentId: 's9',
      requestedAt: FIXED_NOW,
      status: 'waiting',
    })
    const merged = await ok(
      await command(cookies.admin, target.id, 'merge', 2, {
        sourceGroupId: source.id,
        sourceVersion: 1,
      }),
    )
    assert.equal(merged.activeLearners, 5)
    assert.equal(merged.rowVersion, 3)
    const sourceRead = await ok(await call('GET', `/groups/${source.id}`, cookies.admin))
    assert.equal(sourceRead.status, 'cancelled')
    assert.equal(sourceRead.mergedIntoGroupId, target.id)
    assert.deepEqual(sourceRead.members, [])
    assert.equal(
      (await memberRows(institution.id, source.id)).filter((row) => row.archivedAt).length,
      3,
    )
    const [waiting] = await db
      .select()
      .from(languageGroupWaitlist)
      .where(eq(languageGroupWaitlist.institutionId, institution.id))
    assert.equal(waiting?.groupId, target.id)
  })

  test('IST-077 rol kapsamı: öğretmen kendi grubunu, öğrenci ve veli kendi grubunu daraltılmış görür', async () => {
    const { institution, users, cookies, body } = await tenant()
    const own = await ok(await create(cookies.admin, body()), 201)
    const other = await ok(
      await create(
        cookies.admin,
        body({
          name: 'B1 Sabah',
          schedule: MORNING,
          teacherMembershipId: users.other.membershipId,
        }),
      ),
      201,
    )
    await addMembers(institution.id, own.id, ['s-deniz', 's2'])
    const total = async (cookie: string) => (await call('GET', '/groups', cookie)).json().meta.total
    assert.equal(await total(cookies.frontDesk), 2)
    assert.equal(await total(cookies.coordinator), 2)
    assert.equal(await total(cookies.teacher), 1)
    fails(await call('GET', `/groups/${other.id}`, cookies.teacher), 404, 'not_found')
    for (const cookie of [cookies.student, cookies.parent]) {
      const list = await call('GET', '/groups', cookie)
      assert.equal(list.json().meta.total, 1)
      const [item] = list.json().data
      assert.equal(item.id, own.id)
      for (const field of ['teacherMembershipId', 'capacity', 'activeLearners', 'rowVersion'])
        assert.equal(field in item, false, field)
      const detail = await ok(await call('GET', `/groups/${own.id}`, cookie))
      assert.equal('members' in detail, false)
      fails(await call('GET', `/groups/${other.id}`, cookie), 404, 'not_found')
    }
    const teacherView = await ok(await call('GET', `/groups/${own.id}`, cookies.teacher))
    assert.equal(teacherView.members.length, 2)
    const filtered = await call(
      'GET',
      `/groups?teacherMembershipId=${users.other.membershipId}`,
      cookies.admin,
    )
    assert.equal(filtered.json().data[0].id, other.id)
  })

  test('DOM-DIL-043: bekleme sırası sırayla döner, boş yer kadar teklif önerilir', async () => {
    const { institution, cookies, body, courseId } = await tenant()
    const group = await ok(await create(cookies.admin, body({ capacity: 2 })), 201)
    await addMembers(institution.id, group.id, ['s1'])
    const row = (id: number, overrides: Partial<typeof languageGroupWaitlist.$inferInsert>) => ({
      institutionId: institution.id,
      id: `00000000-0000-4000-8000-0000000003${String(id).padStart(2, '0')}`,
      courseId,
      groupId: group.id,
      studentId: `s-w${id}`,
      requestedAt: new Date(`2026-10-0${id}T09:00:00.000Z`),
      status: 'waiting' as const,
      ...overrides,
    })
    await db
      .insert(languageGroupWaitlist)
      .values([
        row(2, {}),
        row(1, { groupId: null }),
        row(3, { studentId: null, prospectId: 'p-1' }),
      ])
    const waitlist = await ok(await call('GET', `/groups/${group.id}/waitlist`, cookies.frontDesk))
    assert.deepEqual(
      waitlist.entries.map((entry: Json) => [entry.studentId ?? entry.prospectId, entry.position]),
      [
        ['s-w1', 1],
        ['s-w2', 2],
        ['p-1', 3],
      ],
    )
    assert.deepEqual(waitlist.suggestion, {
      expire: [],
      offers: [{ entryId: row(1, {}).id, offerExpiresAt: '2026-10-08T09:00:00.000Z' }],
    })
  })

  test('DOM-DIL-008: kapanmamış grubu olan kur arşivlenmez; grup iptal edilince arşivlenir', async () => {
    const { cookies, body, courseId } = await tenant()
    const group = await ok(await create(cookies.admin, body()), 201)
    fails(
      await call('DELETE', `/courses/${courseId}`, cookies.admin, undefined, match(2)),
      422,
      'course_has_open_groups',
    )
    await ok(await command(cookies.admin, group.id, 'cancel', 1, { reason: 'Talep yok.' }))
    const archived = await ok(
      await call('DELETE', `/courses/${courseId}`, cookies.admin, undefined, match(2)),
    )
    assert.equal(archived.status, 'archived')
    // Arşivlenen kurdan grup planlanmaz.
    fails(await create(cookies.admin, body({ name: 'Yeni' })), 422, 'group_course_inactive')
  })

  test('inceleme: kur mevcudu grup kapasitesinin altına inmez, açılmış grubun öğretmeni boşaltılamaz, bayat kaynak 409', async () => {
    const { institution, users, cookies, body, courseId } = await tenant()
    const group = await ok(await create(cookies.admin, body()), 201)
    fails(
      await call('PATCH', `/courses/${courseId}`, cookies.admin, { maxLearners: 9 }, match(2)),
      422,
      'course_max_below_group_capacity',
    )
    await addMembers(institution.id, group.id, ['s1', 's2'])
    await ok(await command(cookies.admin, group.id, 'open', 1))
    const before = await groupRows(institution.id)
    fails(
      await patch(cookies.admin, group.id, { teacherMembershipId: null }, 2),
      422,
      'group_teacher_required',
    )
    fails(await patch(cookies.admin, group.id, { room: null }, 2), 422, 'group_room_required')
    assert.deepEqual(await groupRows(institution.id), before)
    const source = await ok(
      await create(
        cookies.admin,
        body({ name: 'B1 Akşam 2', teacherMembershipId: users.other.membershipId, room: 'D2' }),
      ),
      201,
    )
    await ok(await patch(cookies.admin, source.id, { capacity: 8 }, 1))
    fails(
      await command(cookies.admin, group.id, 'merge', 2, {
        sourceGroupId: source.id,
        sourceVersion: 1,
      }),
      409,
      'version_conflict',
    )
    const merged = await ok(
      await command(cookies.admin, group.id, 'merge', 2, {
        sourceGroupId: source.id,
        sourceVersion: 2,
      }),
    )
    assert.equal(merged.rowVersion, 3)
  })

  test('403 ve kursiyer onayı: reddedilen yazma satırı değiştirmez; farklı saate birleştirme onay ister', async () => {
    const { institution, users, cookies, body } = await tenant()
    const target = await ok(await create(cookies.admin, body()), 201)
    const source = await ok(
      await create(
        cookies.admin,
        body({
          name: 'B1 Sabah',
          schedule: MORNING,
          teacherMembershipId: users.other.membershipId,
        }),
      ),
      201,
    )
    await addMembers(institution.id, source.id, ['s1'])
    const before = await groupRows(institution.id)
    for (const [cookie, code] of [
      [cookies.teacher, 'course_coordinator_required'],
      [cookies.frontDesk, 'forbidden'],
    ] as const) {
      fails(await patch(cookie, target.id, { name: 'Ele geçirildi' }, 1), 403, code)
      fails(await command(cookie, target.id, 'cancel', 1, { reason: 'X' }), 403, code)
    }
    const merge = (learnersConsented?: boolean) =>
      command(cookies.admin, target.id, 'merge', 1, {
        sourceGroupId: source.id,
        sourceVersion: 1,
        ...(learnersConsented === undefined ? {} : { learnersConsented }),
      })
    fails(await merge(), 422, 'group_merge_consent_required')
    fails(await merge(false), 422, 'group_merge_consent_required')
    assert.deepEqual(await groupRows(institution.id), before)
    assert.equal((await memberRows(institution.id, source.id)).length, 1)
    const merged = await ok(await merge(true))
    assert.equal(merged.activeLearners, 1)
  })

  test('DOM-DIL-042, DOM-DIL-070: taşınan kursiyerin açık kur kararı birleştirmeyi 422 ile durdurur; sonuçlanmış karar eski kayıtta kalır', async () => {
    const { institution, users, cookies, body, courseId } = await tenant()
    const target = await ok(await create(cookies.admin, body()), 201)
    const source = await ok(
      await create(
        cookies.admin,
        body({ name: 'B1 Akşam 2', teacherMembershipId: users.other.membershipId, room: 'D2' }),
      ),
      201,
    )
    await addMembers(institution.id, source.id, ['s1', 's2'])
    const [enrollment] = (await memberRows(institution.id, source.id)).filter(
      (row) => row.studentId === 's2',
    )
    assert.ok(enrollment)
    const decisionId = randomUUID()
    await insertProgressionDecision(
      db,
      institution.id,
      {
        enrollmentId: enrollment.id,
        groupId: source.id,
        courseId,
        learnerId: 's2',
        outcome: 'passed',
        status: 'pending',
        rationale: 'Koşullar sağlandı.',
        correctsDecisionId: null,
        decidedByUserId: users.other.id,
        decidedAt: FIXED_NOW.toISOString(),
        reviewedByUserId: null,
        reviewedAt: null,
        rejectionReason: null,
        basis: {
          schemaVersion: 1,
          attendance: {
            totalHours: 12,
            attendedHours: 12,
            absentHours: 0,
            unrecordedHours: 0,
            requiredHours: 10,
            minAttendancePermille: 800,
            met: true,
          },
          finalPassScore: 60,
          assessments: [],
          conditions: { attendance: true, finalScore: true, skills: true },
        },
        evidenceSnapshot: {
          schemaVersion: 2,
          context: 'general',
          computedAt: FIXED_NOW.toISOString(),
          overall: { status: 'insufficient', missingSkills: ['reading'] },
          skills: [],
          evidence: [],
        },
      },
      decisionId,
    )
    const merge = () =>
      command(cookies.admin, target.id, 'merge', 1, {
        sourceGroupId: source.id,
        sourceVersion: 1,
      })
    const beforeGroups = await groupRows(institution.id)
    const beforeSource = await memberRows(institution.id, source.id)
    const beforeAudit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.institutionId, institution.id))
    fails(await merge(), 422, 'progression_pending')
    // Hiçbir kayıt değişmez: iki grup, kaynak satırları, hedef ve denetim.
    assert.deepEqual(await groupRows(institution.id), beforeGroups)
    assert.deepEqual(await memberRows(institution.id, source.id), beforeSource)
    assert.deepEqual(await memberRows(institution.id, target.id), [])
    assert.deepEqual(
      await db.select().from(auditLog).where(eq(auditLog.institutionId, institution.id)),
      beforeAudit,
    )

    // Koordinatör onaylayınca birleştirme geçer; onaylı karar arşivlenen eski kayıtta geçmiş kalır.
    await db
      .update(progressionDecisions)
      .set({ status: 'approved', reviewedByUserId: users.coordinator.id, reviewedAt: FIXED_NOW })
      .where(
        and(
          eq(progressionDecisions.institutionId, institution.id),
          eq(progressionDecisions.id, decisionId),
        ),
      )
    const merged = await ok(await merge())
    assert.equal(merged.activeLearners, 2)
    const history = await listProgressionDecisions(db, institution.id, { learnerId: 's2' })
    assert.deepEqual(
      history.map((decision) => [decision.id, decision.enrollmentId, decision.status]),
      [[decisionId, enrollment.id, 'approved']],
    )
    const [archived] = (await memberRows(institution.id, source.id)).filter(
      (row) => row.id === enrollment.id,
    )
    assert.ok(archived?.archivedAt)
    const moved = (await memberRows(institution.id, target.id)).find(
      (row) => row.studentId === 's2',
    )
    assert.ok(moved)
    assert.deepEqual(
      await listProgressionDecisions(db, institution.id, { enrollmentId: moved.id }),
      [],
    )
  })
})
