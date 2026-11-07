import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { CORE_SKILLS } from '@kampus/school-core/cefr/suggestion.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertLessonHourAttendances } from '../src/db/progression.ts'
import { coordinatorDuties } from '../src/db/schema/coordinator-duties.ts'
import { languageGroupMembers } from '../src/db/schema/language-groups.ts'
import { records } from '../src/db/schema/records.ts'
import { renewalCourseOfferFor } from '../src/services/finance-renewals.ts'
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
 * Dil okulu yenileme teklifinin kur sonu kararı dayanağı (DOM-DIL-070, DOM-DIL-007; ON-295, #30).
 * Kur, grup ve karar OG-086'nın uçlarıyla kurulur; teklif servisin okuduğu son kurun geçerli
 * kararıdır. Yenileme uçları dil okulunda bugün kapalıdır (`renewal` modülü yalnız okulda,
 * DOM-YTK-012); teklif okuyucusu bu yüzden servis düzeyinde denetlenir.
 */

type Json = ReturnType<typeof JSON.parse>

describe('dil okulu yenileme teklifi kur sonu kararından başlar', () => {
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
    method: 'GET' | 'POST',
    url: string,
    cookie: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const key = () => ({ 'idempotency-key': randomUUID() })
  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }

  async function course(admin: string, body: Record<string, unknown>) {
    const made = await ok(
      await call(
        'POST',
        '/courses',
        admin,
        { totalHours: 12, weeklyHours: 4, minLearners: 2, maxLearners: 12, ...body },
        key(),
      ),
      201,
    )
    await ok(await call('POST', `/courses/${made.id}/activate`, admin, {}, { 'if-match': '"1"' }))
    return made.id as string
  }

  /**
   * Dil okulu: `s-ece` B1.1 grubundadır (12 ders saati); B1.1'in sonraki kuru B1.2'dir.
   * `coordinator` B1 akademik koordinatörüdür.
   */
  async function tenant(type: 'school' | 'language_school' = 'language_school') {
    clientIp = `10.95.${(tenantCount += 1)}.1`
    const institution = await createInstitution(app, { type })
    const teacher = await createMember(app, institution.id, 'ogretmen')
    const coordinator = await createMember(app, institution.id, 'ogretmen')
    const cookies = {
      admin: await signInAs(app, institution.admin),
      teacher: await signInAs(app, teacher),
      coordinator: await signInAs(app, coordinator),
    }
    await db
      .insert(records)
      .values({
        institutionId: institution.id,
        collection: 'students',
        id: 's-ece',
        data: { id: 's-ece' },
        position: 1,
      })
      .onConflictDoNothing()
    const base = { institution, cookies, groupId: '', enrollmentId: '', teacherUserId: teacher.id }
    if (type !== 'language_school') return { ...base, nextCourseId: '', courseId: '' }
    await db.insert(coordinatorDuties).values({
      institutionId: institution.id,
      id: randomUUID(),
      membershipId: coordinator.membershipId,
      kind: 'academic_coordinator',
      scopeId: 'B1',
      assignedByUserId: institution.admin.id,
    })
    const nextCourseId = await course(cookies.admin, { name: 'Genel İngilizce B1.2', level: 'B1' })
    const courseId = await course(cookies.admin, {
      name: 'Genel İngilizce B1.1',
      level: 'B1',
      nextCourseId,
    })
    const group = await ok(
      await call(
        'POST',
        '/groups',
        cookies.admin,
        {
          courseId,
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
        },
        key(),
      ),
      201,
    )
    const enrollmentId = randomUUID()
    await db.insert(languageGroupMembers).values({
      institutionId: institution.id,
      id: enrollmentId,
      groupId: group.id,
      studentId: 's-ece',
      status: 'active',
      joinedAt: FIXED_NOW,
    })
    return { ...base, groupId: group.id as string, enrollmentId, nextCourseId, courseId }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  /** Kurun 12 ders saatinin yoklaması (yazma ucu yok, OG-269): `absent` kadarı gelmedi. */
  async function attend(t: Tenant, absent = 0) {
    await insertLessonHourAttendances(
      db,
      t.institution.id,
      { id: t.enrollmentId, groupId: t.groupId, studentId: 's-ece' },
      Array.from({ length: 12 }, (_, index) => ({
        lessonHourId: `ders-${String(index + 1)}`,
        status: index < absent ? ('absent' as const) : ('present' as const),
      })),
      { userId: t.teacherUserId, at: FIXED_NOW },
    )
  }
  async function assessAll(t: Tenant) {
    const skills = CORE_SKILLS.map((skill) => ({ skill, score: 80, feedback: `${skill} notu` }))
    for (const point of ['baseline', 'midterm', 'final'])
      await ok(
        await call(
          'POST',
          '/course-assessments',
          t.cookies.teacher,
          { enrollmentId: t.enrollmentId, point, score: 80, skills },
          key(),
        ),
        201,
      )
  }
  async function propose(t: Tenant, outcome: string) {
    return ok(
      await call(
        'POST',
        '/progression-decisions',
        t.cookies.teacher,
        { enrollmentId: t.enrollmentId, outcome, rationale: 'Kur sonu değerlendirmesi.' },
        key(),
      ),
      201,
    )
  }
  async function approve(t: Tenant, decision: Json) {
    return ok(
      await call(
        'POST',
        `/progression-decisions/${decision.id as string}/approve`,
        t.cookies.coordinator,
        {},
        { ...key(), 'if-match': `"${String(decision.rowVersion)}"` },
      ),
    )
  }
  const offerOf = (t: Tenant) => renewalCourseOfferFor(db, t.institution.id, 's-ece')

  test('DOM-DIL-070, DOM-DIL-007: onaylı geçti kararında teklif sonraki kura açılır', async () => {
    const t = await tenant()
    await attend(t)
    await assessAll(t)
    const decision = await approve(t, await propose(t, 'passed'))
    assert.deepEqual(await offerOf(t), {
      status: 'ready',
      decisionId: decision.id,
      outcome: 'passed',
      fromCourseId: t.courseId,
      fromLevel: 'B1',
      courseId: t.nextCourseId,
      level: 'B1',
    })
  })

  test('DOM-DIL-070: tekrar kararında teklif aynı kur ve seviyede kalır', async () => {
    const t = await tenant()
    await attend(t)
    await assessAll(t)
    await approve(t, await propose(t, 'repeat'))
    const offer = await offerOf(t)
    assert.equal(offer?.status, 'ready')
    assert.equal(offer.outcome, 'repeat')
    assert.equal(offer.courseId, t.courseId)
    assert.equal(offer.level, 'B1')
  })

  test('DOM-DIL-070, DOM-DIL-060: devamsızlıktan tamamlamadı kararında teklif aynı kurda kalır', async () => {
    const t = await tenant()
    await attend(t, 4)
    await approve(t, await propose(t, 'incomplete_attendance'))
    const offer = await offerOf(t)
    assert.equal(offer?.status, 'ready')
    assert.equal(offer.outcome, 'incomplete_attendance')
    assert.equal(offer.courseId, t.courseId)
  })

  test('DOM-DIL-070: onay bekleyen kararda teklif bekletilir; karar yoksa karar yok', async () => {
    const t = await tenant()
    assert.equal((await offerOf(t))?.status, 'missing')
    await attend(t)
    await assessAll(t)
    const decision = await propose(t, 'passed')
    const offer = await offerOf(t)
    assert.equal(offer?.status, 'pending')
    assert.equal(offer.decisionId, decision.id)
    assert.equal(offer.level, null)
  })

  test('DOM-DIL-070: okul kurumunda teklif yok; başka kurumun kur kaydı ve kararı okunmaz', async () => {
    const school = await tenant('school')
    assert.equal(await offerOf(school), null)
    const a = await tenant()
    const b = await tenant()
    await attend(b)
    await assessAll(b)
    await approve(b, await propose(b, 'passed'))
    // A ve B'de aynı öğrenci kimliği var; A'nın kaydında karar yoktur.
    const offer = await offerOf(a)
    assert.equal(offer?.status, 'missing')
    assert.equal(offer.fromCourseId, a.courseId)
    assert.equal((await offerOf(b))?.status, 'ready')
  })
})
