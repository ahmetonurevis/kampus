import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { asc, eq } from 'drizzle-orm'

import { CORE_SKILLS } from '@kampus/school-core/cefr/suggestion.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertLessonHourAttendances } from '../src/db/progression.ts'
import { courseAssessments, progressionDecisions } from '../src/db/schema/cefr.ts'
import { coordinatorDuties } from '../src/db/schema/coordinator-duties.ts'
import { languageGroupMembers } from '../src/db/schema/language-groups.ts'
import { records } from '../src/db/schema/records.ts'
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
 * Kur sonu değerlendirme ve geçiş kararı uçları (OG-086; IST-062; DOM-DIL-013, DOM-DIL-060,
 * DOM-DIL-070). Kural core `cefr/progression.ts`'tedir; burada modül ve kurum türü, rol, başka
 * kurum, gövde doğrulaması, `If-Match`, mükerrer işlem, kalıcılık ve kursiyer/veli görünümü
 * denetlenir. Ders saati yoklamasının yazma ucu yoktur (OG-269): başarı yolu satırları doğrudan
 * depoya yazar; satır yokken karar 409 `attendance_pending` olur.
 */

type Json = ReturnType<typeof JSON.parse>
type Method = 'GET' | 'POST'

describe('kur sonu değerlendirme ve geçiş kararı uçları', () => {
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
  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function fails(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code, response.body)
  }

  /**
   * Dil okulu: Deniz (`s-deniz`) öğretmenin B1 grubundadır (12 ders saati). `coordinator` B1
   * akademik koordinatörüdür, `other` grubu olmayan öğretmendir.
   */
  async function tenant(
    type: 'school' | 'language_school' = 'language_school',
    enabledModules?: Record<string, boolean>,
  ) {
    clientIp = `10.86.${(tenantCount += 1)}.1`
    const institution = await createInstitution(app, {
      type,
      ...(enabledModules ? { enabledModules } : {}),
    })
    const users = {
      frontDesk: await createMember(app, institution.id, 'onburo'),
      teacher: await createMember(app, institution.id, 'ogretmen'),
      coordinator: await createMember(app, institution.id, 'ogretmen'),
      other: await createMember(app, institution.id, 'ogretmen'),
      student: await createMember(app, institution.id, 'ogrenci', [
        { kind: 'student', recordId: 's-deniz' },
      ]),
      parent: await createMember(app, institution.id, 'veli', [
        { kind: 'child', recordId: 's-deniz' },
      ]),
    }
    const cookies = {
      admin: await signInAs(app, institution.admin),
      frontDesk: await signInAs(app, users.frontDesk),
      teacher: await signInAs(app, users.teacher),
      coordinator: await signInAs(app, users.coordinator),
      other: await signInAs(app, users.other),
      student: await signInAs(app, users.student),
      parent: await signInAs(app, users.parent),
    }
    await db
      .insert(records)
      .values({
        institutionId: institution.id,
        collection: 'students',
        id: 's-deniz',
        data: { id: 's-deniz' },
        position: 1,
      })
      .onConflictDoNothing()
    const base = { institution, users, cookies, groupId: '', enrollmentId: '' }
    if (type !== 'language_school' || enabledModules?.academic === false) return base
    await db.insert(coordinatorDuties).values({
      institutionId: institution.id,
      id: randomUUID(),
      membershipId: users.coordinator.membershipId,
      kind: 'academic_coordinator',
      scopeId: 'B1',
      assignedByUserId: institution.admin.id,
    })
    const course = await ok(
      await call(
        'POST',
        '/courses',
        cookies.admin,
        {
          name: 'Genel İngilizce B1.1',
          level: 'B1',
          totalHours: 12,
          weeklyHours: 4,
          minLearners: 2,
          maxLearners: 12,
        },
        key(),
      ),
      201,
    )
    await ok(
      await call(
        'POST',
        `/courses/${course.id}/activate`,
        cookies.admin,
        {},
        { 'if-match': '"1"' },
      ),
    )
    const group = await ok(
      await call(
        'POST',
        '/groups',
        cookies.admin,
        {
          courseId: course.id,
          name: 'B1 Akşam',
          ageBand: 'adult',
          teacherMembershipId: users.teacher.membershipId,
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
      studentId: 's-deniz',
      status: 'active',
      joinedAt: FIXED_NOW,
    })
    return { ...base, groupId: group.id as string, enrollmentId }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  const skills = (score: number) =>
    CORE_SKILLS.map((skill) => ({ skill, score, feedback: `${skill} geri bildirimi` }))
  const assessmentBody = (t: Tenant, point: string, score = 80) => ({
    enrollmentId: t.enrollmentId,
    point,
    score,
    skills: skills(score),
  })
  const assess = (t: Tenant, point: string, cookie = t.cookies.teacher, score = 80) =>
    call('POST', '/course-assessments', cookie, assessmentBody(t, point, score), key())
  const proposeBody = (t: Tenant, outcome = 'passed') => ({
    enrollmentId: t.enrollmentId,
    outcome,
    rationale: 'Dört beceride kur sonu hedefine ulaştı.',
  })
  const propose = (t: Tenant, cookie = t.cookies.teacher, outcome = 'passed') =>
    call('POST', '/progression-decisions', cookie, proposeBody(t, outcome), key())
  const review = (
    cookie: string,
    decisionId: string,
    verb: 'approve' | 'reject',
    version: number | null,
    body: unknown = {},
    headers: Record<string, string> = key(),
  ) =>
    call('POST', `/progression-decisions/${decisionId}/${verb}`, cookie, body, {
      ...headers,
      ...(version === null ? {} : { 'if-match': `"${version}"` }),
    })

  /** Kurun 12 ders saatinin yoklaması (yazma ucu yok, OG-269): `absent` kadarı gelmedi. */
  async function attend(t: Tenant, absent = 0) {
    await insertLessonHourAttendances(
      db,
      t.institution.id,
      { id: t.enrollmentId, groupId: t.groupId, studentId: 's-deniz' },
      Array.from({ length: 12 }, (_, index) => ({
        lessonHourId: `ders-${index + 1}`,
        status: index < absent ? ('absent' as const) : ('present' as const),
      })),
      { userId: t.users.teacher.id, at: FIXED_NOW },
    )
  }
  async function assessAll(t: Tenant, score = 80) {
    for (const point of ['baseline', 'midterm', 'final'])
      await ok(await assess(t, point, t.cookies.teacher, score), 201)
  }

  const snapshot = async (institutionId: string) => ({
    assessments: await db
      .select()
      .from(courseAssessments)
      .where(eq(courseAssessments.institutionId, institutionId))
      .orderBy(asc(courseAssessments.id)),
    decisions: await db
      .select()
      .from(progressionDecisions)
      .where(eq(progressionDecisions.institutionId, institutionId))
      .orderBy(asc(progressionDecisions.id)),
  })

  test('IST-062 oturumsuz 401', async () => {
    const t = await tenant()
    const id = randomUUID()
    for (const response of [
      await call('POST', '/course-assessments', undefined, assessmentBody(t, 'baseline')),
      await call('POST', '/progression-decisions', undefined, proposeBody(t)),
      await review('', id, 'approve', 1),
      await review('', id, 'reject', 1, { reason: 'Eksik.' }),
      await call('GET', `/groups/${t.groupId}/progression`),
      await call('GET', '/students/s-deniz/progression-decisions'),
    ])
      fails(response, 401, 'unauthenticated')
  })

  test('DOM-DIL-070 DOM-YTK-012 rol 403, modül kapalı 403, okulda 404; kayıt değişmez', async () => {
    const t = await tenant()
    const before = await snapshot(t.institution.id)
    const id = randomUUID()
    for (const cookie of [
      t.cookies.admin,
      t.cookies.frontDesk,
      t.cookies.student,
      t.cookies.parent,
    ])
      for (const response of [
        await assess(t, 'baseline', cookie),
        await propose(t, cookie),
        await review(cookie, id, 'approve', 1),
        await review(cookie, id, 'reject', 1, { reason: 'Eksik.' }),
      ])
        fails(response, 403, 'forbidden')
    for (const cookie of [t.cookies.frontDesk, t.cookies.student, t.cookies.parent])
      fails(await call('GET', `/groups/${t.groupId}/progression`, cookie), 403, 'forbidden')
    fails(
      await call('GET', '/students/s-deniz/progression-decisions', t.cookies.frontDesk),
      403,
      'forbidden',
    )
    assert.deepEqual(await snapshot(t.institution.id), before)

    const closed = await tenant('language_school', { academic: false })
    const school = await tenant('school')
    for (const [other, status, code] of [
      [closed, 403, 'module_disabled'],
      [school, 404, 'not_found'],
    ] as const) {
      for (const response of [
        await call('POST', '/course-assessments', other.cookies.teacher, {}, key()),
        await call('POST', '/progression-decisions', other.cookies.teacher, {}, key()),
        await review(other.cookies.teacher, id, 'approve', 1),
        await call('GET', `/groups/${id}/progression`, other.cookies.admin),
        await call('GET', '/students/s-deniz/progression-decisions', other.cookies.student),
      ])
        fails(response, status, code)
    }
  })

  test('IST-062 başka kurumun kaydı, kararı, grubu ve öğrencisi 404, B değişmez; gövdedeki institutionId etkisiz', async () => {
    const a = await tenant()
    const b = await tenant()
    await attend(b)
    await assessAll(b)
    const decision = await ok(await propose(b), 201)
    const before = await snapshot(b.institution.id)
    const foreign = { ...assessmentBody(b, 'baseline'), enrollmentId: b.enrollmentId }
    fails(
      await call('POST', '/course-assessments', a.cookies.teacher, foreign, key()),
      404,
      'not_found',
    )
    fails(
      await call('POST', '/progression-decisions', a.cookies.teacher, proposeBody(b), key()),
      404,
      'not_found',
    )
    fails(
      await review(a.cookies.coordinator, decision.id, 'approve', decision.rowVersion),
      404,
      'not_found',
    )
    fails(
      await review(a.cookies.coordinator, decision.id, 'reject', decision.rowVersion, {
        reason: 'Başka kurum.',
      }),
      404,
      'not_found',
    )
    fails(await call('GET', `/groups/${b.groupId}/progression`, a.cookies.admin), 404, 'not_found')
    // A'nın Deniz'i B'nin kararını görmez: A'da karar yok.
    assert.deepEqual(
      (await ok(await call('GET', '/students/s-deniz/progression-decisions', a.cookies.admin)))
        .decisions,
      [],
    )
    // Gövdede kurum kimliği şemada yoktur (katı gövde 400): kurum yalnız oturumdan gelir.
    fails(
      await call(
        'POST',
        '/course-assessments',
        a.cookies.teacher,
        { ...assessmentBody(a, 'baseline'), institutionId: b.institution.id },
        key(),
      ),
      400,
      'validation_failed',
    )
    assert.deepEqual(await snapshot(b.institution.id), before)
    assert.deepEqual((await snapshot(a.institution.id)).assessments, [])
  })

  test('DOM-DIL-013 geçersiz gövde 400 ve kayıt değişmez; ölçmeyi yalnız grubun öğretmeni girer; nokta bir kez 409', async () => {
    const t = await tenant()
    const invalid = [
      { ...assessmentBody(t, 'baseline'), skills: skills(80).slice(1) },
      { ...assessmentBody(t, 'baseline'), point: 'quiz' },
      {
        ...assessmentBody(t, 'baseline'),
        skills: skills(80).map((s) => ({ ...s, feedback: ' ' })),
      },
      { ...assessmentBody(t, 'baseline'), score: 101 },
    ]
    for (const body of invalid)
      fails(
        await call('POST', '/course-assessments', t.cookies.teacher, body, key()),
        400,
        'validation_failed',
      )
    fails(
      await call(
        'POST',
        '/progression-decisions',
        t.cookies.teacher,
        { ...proposeBody(t), rationale: '' },
        key(),
      ),
      400,
      'validation_failed',
    )
    assert.deepEqual(await snapshot(t.institution.id), { assessments: [], decisions: [] })

    // Koordinatör grubu okur ama ölçme girmez; grubu olmayan öğretmen için kayıt yoktur.
    fails(await assess(t, 'baseline', t.cookies.coordinator), 403, 'permission_denied')
    fails(await assess(t, 'baseline', t.cookies.other), 404, 'not_found')
    fails(
      await call(
        'POST',
        '/course-assessments',
        t.cookies.teacher,
        { ...assessmentBody(t, 'baseline'), enrollmentId: randomUUID() },
        key(),
      ),
      404,
      'not_found',
    )

    const created = await ok(await assess(t, 'baseline'), 201)
    assert.equal(created.point, 'baseline')
    assert.equal(created.assessedByUserId, t.users.teacher.id)
    assert.deepEqual(
      created.skills.map((s: { skill: string }) => s.skill),
      [...CORE_SKILLS],
    )
    fails(await assess(t, 'baseline'), 409, 'assessment_already_recorded')
    const { assessments } = await snapshot(t.institution.id)
    assert.equal(assessments.length, 1)
    assert.equal(assessments[0]!.id, created.id)
  })

  test('DOM-DIL-060 DOM-DIL-070 OG-269 ders saati yoklaması yokken karar 409 attendance_pending, kayıt yazılmaz', async () => {
    const t = await tenant()
    await assessAll(t)
    fails(await propose(t), 409, 'attendance_pending')
    assert.deepEqual((await snapshot(t.institution.id)).decisions, [])
    const table = await ok(await call('GET', `/groups/${t.groupId}/progression`, t.cookies.teacher))
    const [learner] = table.learners
    assert.equal(learner.blocker, 'attendance_pending')
    assert.equal(learner.attendance.status, 'pending')
    assert.deepEqual(learner.allowedOutcomes, [])
  })

  test('DOM-DIL-060 DOM-DIL-070 devam şartı sağlanmazsa yalnız devamsızlıktan tamamlamadı; koşulsuz geçti 422', async () => {
    const t = await tenant()
    await attend(t, 3)
    fails(await propose(t), 422, 'attendance_not_met')
    const decision = await ok(await propose(t, t.cookies.teacher, 'incomplete_attendance'), 201)
    assert.equal(decision.outcome, 'incomplete_attendance')
    assert.equal(decision.basis.attendance.met, false)
  })

  test('DOM-DIL-070 IST-062 başarı: öğretmen önerir, koordinatör onaylar; kalıcı, next üst kur; If-Match, mükerrer ve dört göz', async () => {
    const t = await tenant()
    await attend(t)
    await assessAll(t)
    const decision = await ok(await propose(t), 201)
    assert.equal(decision.status, 'pending')
    assert.equal(decision.decidedByUserId, t.users.teacher.id)
    assert.equal(decision.groupId, t.groupId)
    assert.equal(decision.next, null)
    fails(await propose(t), 409, 'progression_pending')

    // Onay: yalnız koordinatör; If-Match zorunlu ve satır sürümüyle.
    fails(
      await review(t.cookies.teacher, decision.id, 'approve', decision.rowVersion),
      403,
      'permission_denied',
    )
    fails(
      await review(t.cookies.coordinator, decision.id, 'approve', null),
      400,
      'if_match_required',
    )
    fails(
      await review(t.cookies.coordinator, decision.id, 'approve', decision.rowVersion + 1),
      409,
      'version_conflict',
    )
    fails(
      await review(t.cookies.coordinator, decision.id, 'reject', decision.rowVersion, {}),
      400,
      'validation_failed',
    )
    assert.equal((await snapshot(t.institution.id)).decisions[0]!.status, 'pending')

    const headers = key()
    const approve = () =>
      review(t.cookies.coordinator, decision.id, 'approve', decision.rowVersion, {}, headers)
    const approved = await ok(await approve())
    assert.equal(approved.status, 'approved')
    assert.equal(approved.reviewedByUserId, t.users.coordinator.id)
    assert.equal(approved.rowVersion, decision.rowVersion + 1)
    assert.equal(approved.next.decisionId, decision.id)
    assert.equal(approved.next.fromLevel, 'B1')
    assert.equal(approved.next.nextCourseId, null)
    // Aynı anahtar aynı yanıtı verir; yeni anahtarla ikinci onay 409.
    const replay = await approve()
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json().data, approved)
    fails(
      await review(t.cookies.coordinator, decision.id, 'approve', approved.rowVersion),
      409,
      'progression_already_reviewed',
    )
    fails(await propose(t), 409, 'progression_already_decided')

    const [row] = (await snapshot(t.institution.id)).decisions
    assert.equal(row!.status, 'approved')
    assert.equal(row!.reviewedByUserId, t.users.coordinator.id)
    const table = await ok(
      await call('GET', `/groups/${t.groupId}/progression`, t.cookies.coordinator),
    )
    assert.equal(table.canReview, true)
    assert.equal(table.canDecide, false)
    assert.equal(table.learners[0].next.decisionId, decision.id)
    assert.equal(table.learners[0].decisions[0].status, 'approved')
  })

  test('DOM-DIL-070 kararı veren kendi kararını onaylayamaz; ret gerekçeyle kalıcı, yeniden önerilebilir', async () => {
    const t = await tenant()
    // Grubun öğretmeni aynı zamanda B1 koordinatörüdür.
    await db.insert(coordinatorDuties).values({
      institutionId: t.institution.id,
      id: randomUUID(),
      membershipId: t.users.teacher.membershipId,
      kind: 'academic_coordinator',
      scopeId: 'B1',
      assignedByUserId: t.institution.admin.id,
    })
    await attend(t)
    await assessAll(t, 55)
    fails(await propose(t), 422, 'pass_conditions_not_met')
    const decision = await ok(await propose(t, t.cookies.teacher, 'repeat'), 201)
    fails(
      await review(t.cookies.teacher, decision.id, 'approve', decision.rowVersion),
      403,
      'progression_self_review',
    )
    const rejected = await ok(
      await review(t.cookies.coordinator, decision.id, 'reject', decision.rowVersion, {
        reason: 'Ara ölçme geri bildirimi yeniden okunmalı.',
      }),
    )
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.rejectionReason, 'Ara ölçme geri bildirimi yeniden okunmalı.')
    assert.equal(rejected.next, null)
    const again = await ok(await propose(t, t.cookies.teacher, 'repeat'), 201)
    assert.notEqual(again.id, decision.id)
    const { decisions } = await snapshot(t.institution.id)
    assert.deepEqual(decisions.map((d) => d.status).toSorted(), ['pending', 'rejected'])
  })

  test('IST-062 kursiyer ve veli yalnız onaylı kararı gerekçesiz görür; onaysız öneri görünmez; yetişkin kursiyerin velisi 404', async () => {
    const t = await tenant()
    await attend(t)
    await assessAll(t)
    const decision = await ok(await propose(t), 201)
    const read = (cookie: string) => call('GET', '/students/s-deniz/progression-decisions', cookie)
    for (const cookie of [t.cookies.student, t.cookies.parent])
      assert.deepEqual((await ok(await read(cookie))).decisions, [])
    const staff = await ok(await read(t.cookies.admin))
    assert.equal(staff.decisions[0].rationale, decision.rationale)
    fails(await read(t.cookies.other), 404, 'not_found')

    await ok(await review(t.cookies.coordinator, decision.id, 'approve', decision.rowVersion))
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const [own] = (await ok(await read(cookie))).decisions
      assert.equal(own.id, decision.id)
      assert.equal(own.outcome, 'passed')
      assert.equal(own.next.decisionId, decision.id)
      for (const hidden of ['rationale', 'decidedByUserId', 'reviewedByUserId', 'status'])
        assert.equal(hidden in own, false, hidden)
    }
    // Grubun öğretmeni kararı gerekçesiyle görür.
    assert.equal(
      (await ok(await read(t.cookies.teacher))).decisions[0].rationale,
      decision.rationale,
    )

    // Kesin kayıtta 18 yaş üstü seçilen kursiyerin velisi karar görmez.
    await db.insert(records).values({
      institutionId: t.institution.id,
      collection: 'prospects',
      id: 'p-deniz',
      data: { id: 'p-deniz', studentId: 's-deniz', minor: false },
      position: 1,
    })
    fails(await read(t.cookies.parent), 404, 'not_found')
    assert.equal((await ok(await read(t.cookies.student))).decisions.length, 1)
  })
})
