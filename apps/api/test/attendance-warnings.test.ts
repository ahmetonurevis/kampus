import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertLessonHourAttendances } from '../src/db/progression.ts'
import { loadRecords } from '../src/db/records.ts'
import { lessonHourAttendances } from '../src/db/schema/cefr.ts'
import { languageGroupMembers, languageGroups } from '../src/db/schema/language-groups.ts'
import { records } from '../src/db/schema/records.ts'
import { studentIdentities } from '../src/db/schema/student-identities.ts'
import { attendanceWarningsJob } from '../src/jobs/attendance-warnings.ts'
import type { JobDeps } from '../src/jobs/types.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { tempStorage } from './support/files-sample.ts'

/**
 * Devam şartı izleme uyarısı işi (OG-087; IST-080; DOM-DIL-060). Kur 12 ders saatidir: gereken 10,
 * devamsızlık hakkı 2; uyarı hakkın %80'inde (2. saat), aşıldı 3. saatte. Ders saati yoklamasının
 * yazma ucu yoktur (OG-269): satırlar depoya doğrudan yazılır. Kursiyer yetişkin (doğum 2000) ya da
 * 18 yaş altıdır (doğum 2012); alıcı kitle yaşa göre seçilir (DOM-ILT-037).
 */
const ADULT_BIRTH = '2000-01-01'
const MINOR_BIRTH = '2012-01-01'
const WARN = 'attendance_threshold_warning'
const EXCEEDED = 'attendance_threshold_exceeded'

describe('devam şartı izleme uyarısı işi', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let deps: JobDeps
  let store: Awaited<ReturnType<typeof tempStorage>>
  let tenantCount = 0

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
    store = await tempStorage()
    deps = { db, storage: store.storage, log: app.log }
  })
  after(async () => {
    await app.close()
    await close()
    await store.remove()
  })

  async function post(cookie: string, url: string, body: unknown, headers = {}) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1${url}`,
      remoteAddress: `10.87.${tenantCount}.1`,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        ...headers,
      },
      payload: JSON.stringify(body),
    })
    assert.ok(response.statusCode < 300, response.body)
    return (response.json() as { data: { id: string } }).data
  }

  /** Dil okulu kurumu: aktif kur, açık grup ve tek kursiyer (`s-deniz`). */
  async function tenant(
    options: {
      type?: 'school' | 'language_school'
      enabledModules?: Record<string, boolean>
      birthDate?: string
    } = {},
  ) {
    tenantCount += 1
    const type = options.type ?? 'language_school'
    const institution = await createInstitution(app, {
      type,
      ...(options.enabledModules ? { enabledModules: options.enabledModules } : {}),
    })
    await db.insert(records).values({
      institutionId: institution.id,
      collection: 'students',
      id: 's-deniz',
      data: { id: 's-deniz' },
      position: 1,
    })
    await db.insert(studentIdentities).values({
      institutionId: institution.id,
      studentId: 's-deniz',
      academicYear: 2026,
      identityKind: 'foreign',
      identityNumber: `YK-${institution.id}`,
      birthDate: options.birthDate ?? ADULT_BIRTH,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    const none = { institution, enrollmentId: '', groupId: '', teacherUserId: '' }
    if (type !== 'language_school' || options.enabledModules?.academic === false) return none
    const admin = await signInAs(app, institution.admin)
    const course = await post(admin, '/courses', {
      name: 'Genel İngilizce B1.1',
      level: 'B1',
      totalHours: 12,
      weeklyHours: 4,
      minLearners: 2,
      maxLearners: 12,
    })
    await post(admin, `/courses/${course.id}/activate`, {}, { 'if-match': '"1"' })
    const teacher = await createMember(app, institution.id, 'ogretmen')
    const group = await post(admin, '/groups', {
      courseId: course.id,
      name: 'B1 Akşam',
      ageBand: 'adult',
      teacherMembershipId: teacher.membershipId,
      delivery: 'in_person',
      room: 'Derslik 1',
      schedule: [
        { weekday: 1, startTime: '18:00' },
        { weekday: 1, startTime: '18:45' },
        { weekday: 3, startTime: '18:00' },
        { weekday: 3, startTime: '18:45' },
      ],
      startDate: '2026-10-12',
      capacity: 10,
    })
    const enrollmentId = randomUUID()
    await db.insert(languageGroupMembers).values({
      institutionId: institution.id,
      id: enrollmentId,
      groupId: group.id,
      studentId: 's-deniz',
      status: 'active',
      joinedAt: FIXED_NOW,
    })
    return { institution, enrollmentId, groupId: group.id, teacherUserId: teacher.id }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  /** Kurun 12 ders saatinin yoklaması: ilk `absent` saat gelmedi. */
  async function attend(t: Tenant, absent: number) {
    await insertLessonHourAttendances(
      db,
      t.institution.id,
      { id: t.enrollmentId, groupId: t.groupId, studentId: 's-deniz' },
      Array.from({ length: 12 }, (_, index) => ({
        lessonHourId: `ders-${index + 1}`,
        status: index < absent ? ('absent' as const) : ('present' as const),
      })),
      { userId: t.teacherUserId, at: FIXED_NOW },
    )
  }
  /** Aynı gruba ikinci kursiyer (yetişkin) ekler; kur kaydı kimliğini döner. */
  async function addLearner(t: Tenant, studentId: string) {
    await db.insert(records).values({
      institutionId: t.institution.id,
      collection: 'students',
      id: studentId,
      data: { id: studentId },
      position: 2,
    })
    await db.insert(studentIdentities).values({
      institutionId: t.institution.id,
      studentId,
      academicYear: 2026,
      identityKind: 'foreign',
      identityNumber: `YK2-${t.institution.id}`,
      birthDate: ADULT_BIRTH,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    const id = randomUUID()
    await db.insert(languageGroupMembers).values({
      institutionId: t.institution.id,
      id,
      groupId: t.groupId,
      studentId,
      status: 'active',
      joinedAt: FIXED_NOW,
    })
    return { id, groupId: t.groupId, studentId }
  }
  const sent = async (institutionId: string) =>
    (await loadRecords(db, institutionId, ['notifications']))
      .map((row) => row.data)
      .filter((data) => data.kind === WARN || data.kind === EXCEEDED)
      .map((data) => ({
        kind: data.kind as string,
        audience: data.audience as string,
        studentId: data.studentId as string,
        subject: data.subject as { type: string; id: string },
      }))
  const run = (institutionId: string, now = FIXED_NOW) =>
    attendanceWarningsJob.run(deps, { institutionId }, now)

  test('eşiğin altında bildirim yok', async () => {
    const t = await tenant()
    await attend(t, 1)
    const result = await run(t.institution.id)
    assert.equal(result.created, 0)
    assert.deepEqual(await sent(t.institution.id), [])
  })

  test('hakkın %80inde uyarı bir kez gider, ikinci koşuda gitmez; aşılınca ayrı bildirim gelir', async () => {
    const t = await tenant()
    await attend(t, 2)
    const first = await run(t.institution.id)
    assert.deepEqual(
      { warnings: first.warnings, exceeded: first.exceeded, created: first.created },
      { warnings: 1, exceeded: 0, created: 1 },
    )
    assert.deepEqual(await sent(t.institution.id), [
      {
        kind: WARN,
        audience: 'student',
        studentId: 's-deniz',
        subject: { type: 'course_enrollment', id: t.enrollmentId },
      },
    ])
    const again = await run(t.institution.id)
    assert.deepEqual(
      { created: again.created, deduplicated: again.deduplicated },
      {
        created: 0,
        deduplicated: 1,
      },
    )
    assert.equal((await sent(t.institution.id)).length, 1)

    // Üçüncü gelmedi: hak aşıldı, farklı bildirim; uyarı tekrar yazılmaz.
    await db
      .update(lessonHourAttendances)
      .set({ status: 'absent' })
      .where(
        and(
          eq(lessonHourAttendances.institutionId, t.institution.id),
          eq(lessonHourAttendances.lessonHourId, 'ders-3'),
        ),
      )
    const exceeded = await run(t.institution.id)
    assert.deepEqual(
      { exceeded: exceeded.exceeded, created: exceeded.created },
      {
        exceeded: 1,
        created: 1,
      },
    )
    assert.deepEqual(
      (await sent(t.institution.id)).map((item) => item.kind).sort(),
      [EXCEEDED, WARN].sort(),
    )
    assert.equal((await run(t.institution.id)).created, 0)
  })

  test('DOM-ILT-037: 18 yaş altında bildirim veliye gider', async () => {
    const t = await tenant({ birthDate: MINOR_BIRTH })
    await attend(t, 2)
    await run(t.institution.id)
    const found = await sent(t.institution.id)
    assert.deepEqual(
      found.map((item) => item.audience),
      ['parent'],
    )
  })

  test('okul türü kurumda iş bir şey yapmaz', async () => {
    const t = await tenant({ type: 'school' })
    const result = await run(t.institution.id)
    assert.equal(result.skipped, 'not_language_school')
    assert.deepEqual(await sent(t.institution.id), [])
  })

  test('academic modülü kapalıyken iş bir şey yapmaz', async () => {
    const t = await tenant({ enabledModules: { academic: false } })
    const result = await run(t.institution.id)
    assert.equal(result.skipped, 'module_disabled')
    assert.deepEqual(await sent(t.institution.id), [])
  })

  test('başka kurum karışmaz: yalnız çalışan kurumun kursiyeri bildirilir', async () => {
    const a = await tenant()
    const b = await tenant()
    await attend(a, 3)
    await attend(b, 3)
    await run(a.institution.id)
    assert.equal((await sent(a.institution.id)).length, 1)
    assert.deepEqual(await sent(b.institution.id), [])
  })

  test('sabah 07:00den önce (İstanbul) çalışmaz', async () => {
    const t = await tenant()
    await attend(t, 3)
    const result = await run(t.institution.id, new Date('2026-10-06T02:00:00.000Z'))
    assert.equal(result.skipped, 'before_morning')
    assert.deepEqual(await sent(t.institution.id), [])
  })

  test('yoklaması kısmen alınmış kursiyer uyarılmaz: alınmamış saat devamsızlık sayılmaz', async () => {
    const t = await tenant()
    await insertLessonHourAttendances(
      db,
      t.institution.id,
      { id: t.enrollmentId, groupId: t.groupId, studentId: 's-deniz' },
      [
        { lessonHourId: 'ders-1', status: 'absent' },
        { lessonHourId: 'ders-2', status: 'present' },
        { lessonHourId: 'ders-3', status: 'present' },
      ],
      { userId: t.teacherUserId, at: FIXED_NOW },
    )
    const result = await run(t.institution.id)
    assert.equal(result.created, 0)
    assert.deepEqual(await sent(t.institution.id), [])
  })

  test('iptal edilmiş (kapanmış) grup atlanır', async () => {
    const t = await tenant()
    await attend(t, 3)
    await db
      .update(languageGroups)
      .set({ state: 'cancelled', cancelledAt: FIXED_NOW, cancelReason: 'Yetersiz kayıt' })
      .where(eq(languageGroups.id, t.groupId))
    const result = await run(t.institution.id)
    assert.deepEqual(
      { enrollments: result.enrollments, created: result.created },
      {
        enrollments: 0,
        created: 0,
      },
    )
    assert.deepEqual(await sent(t.institution.id), [])
  })

  test('aktif olmayan kur kaydı atlanır', async () => {
    const t = await tenant()
    await attend(t, 3)
    await db
      .update(languageGroupMembers)
      .set({ status: 'frozen' })
      .where(eq(languageGroupMembers.id, t.enrollmentId))
    const result = await run(t.institution.id)
    assert.deepEqual(
      { enrollments: result.enrollments, created: result.created },
      {
        enrollments: 0,
        created: 0,
      },
    )
    assert.deepEqual(await sent(t.institution.id), [])
  })

  test('18 yaş altında hak aşılınca bildirim veliye gider', async () => {
    const t = await tenant({ birthDate: MINOR_BIRTH })
    await attend(t, 3)
    await run(t.institution.id)
    assert.deepEqual(
      (await sent(t.institution.id)).map((item) => [item.kind, item.audience]),
      [[EXCEEDED, 'parent']],
    )
  })

  test('bozuk yoklama satırlı kursiyer işi düşürmez, diğer kursiyer uyarısını alır', async () => {
    const t = await tenant()
    // Kur 12 saat; 13 satır bozuk veridir (attendance_exceeds_course).
    await insertLessonHourAttendances(
      db,
      t.institution.id,
      { id: t.enrollmentId, groupId: t.groupId, studentId: 's-deniz' },
      Array.from({ length: 13 }, (_, index) => ({
        lessonHourId: `ders-${index + 1}`,
        status: 'present' as const,
      })),
      { userId: t.teacherUserId, at: FIXED_NOW },
    )
    const other = await addLearner(t, 's-ece')
    await insertLessonHourAttendances(
      db,
      t.institution.id,
      other,
      Array.from({ length: 12 }, (_, index) => ({
        lessonHourId: `ders-${index + 1}`,
        status: index < 2 ? ('absent' as const) : ('present' as const),
      })),
      { userId: t.teacherUserId, at: FIXED_NOW },
    )
    const result = await run(t.institution.id)
    assert.deepEqual(
      { skipped: result.skippedEnrollments, warnings: result.warnings, created: result.created },
      { skipped: 1, warnings: 1, created: 1 },
    )
    assert.deepEqual(
      (await sent(t.institution.id)).map((item) => item.studentId),
      ['s-ece'],
    )
  })
})
