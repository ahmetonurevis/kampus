import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import { CORE_SKILLS } from '@kampus/school-core/cefr/suggestion.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertLessonHourAttendances } from '../src/db/progression.ts'
import { progressionDecisions } from '../src/db/schema/cefr.ts'
import { coordinatorDuties } from '../src/db/schema/coordinator-duties.ts'
import { languageGroupMembers } from '../src/db/schema/language-groups.ts'
import { records } from '../src/db/schema/records.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { createPgDatabase, PG_SKIP } from './support/pg.ts'

/**
 * Kur sonu kararı onayı gerçek PostgreSQL 16'da (OG-086; DOM-DIL-070): aynı karara iki
 * koordinatörün eşzamanlı onayı kurum kilidi ve satır sürümüyle sıraya girer; biri 200, öteki 409
 * alır ve karar bir kez onaylanır. PGlite tek bağlantılı olduğundan bu yarış yalnız burada sınanır.
 */
describe('PostgreSQL 16: kur sonu kararı onayı', { skip: PG_SKIP }, () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createPgDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function post(cookie: string, url: string, payload: unknown, headers: Record<string, string>) {
    return app.inject({
      method: 'POST',
      url: `/api/v1${url}`,
      headers: { origin: TEST_ORIGIN, cookie, 'content-type': 'application/json', ...headers },
      payload: JSON.stringify(payload),
    })
  }
  const key = () => ({ 'idempotency-key': randomUUID() })
  async function data(response: Awaited<ReturnType<typeof post>>, status: number) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as { id: string; rowVersion: number }
  }

  test('DOM-DIL-070: aynı karara eşzamanlı iki onaydan biri 200, öteki 409; karar bir kez onaylanır', async () => {
    const institution = await createInstitution(app, { type: 'language_school' })
    const teacher = await createMember(app, institution.id, 'ogretmen')
    const coordinators = [
      await createMember(app, institution.id, 'ogretmen'),
      await createMember(app, institution.id, 'ogretmen'),
    ]
    for (const coordinator of coordinators)
      await db.insert(coordinatorDuties).values({
        institutionId: institution.id,
        id: randomUUID(),
        membershipId: coordinator.membershipId,
        kind: 'academic_coordinator',
        scopeId: 'B1',
        assignedByUserId: institution.admin.id,
      })
    await db.insert(records).values({
      institutionId: institution.id,
      collection: 'students',
      id: 's-deniz',
      data: { id: 's-deniz' },
      position: 1,
    })
    const admin = await signInAs(app, institution.admin)
    const course = await data(
      await post(
        admin,
        '/courses',
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
    await data(await post(admin, `/courses/${course.id}/activate`, {}, { 'if-match': '"1"' }), 200)
    const group = await data(
      await post(
        admin,
        '/groups',
        {
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
    // Ders saati yoklamasının yazma ucu yok (OG-269): satırlar depoya doğrudan yazılır.
    await insertLessonHourAttendances(
      db,
      institution.id,
      { id: enrollmentId, groupId: group.id, studentId: 's-deniz' },
      Array.from({ length: 12 }, (_, index) => ({
        lessonHourId: `ders-${index + 1}`,
        status: 'present' as const,
      })),
      { userId: teacher.id, at: FIXED_NOW },
    )
    const teacherCookie = await signInAs(app, teacher)
    for (const point of ['baseline', 'midterm', 'final'])
      await data(
        await post(
          teacherCookie,
          '/course-assessments',
          {
            enrollmentId,
            point,
            score: 80,
            skills: CORE_SKILLS.map((skill) => ({ skill, score: 80, feedback: 'İyi.' })),
          },
          key(),
        ),
        201,
      )
    const decision = await data(
      await post(
        teacherCookie,
        '/progression-decisions',
        { enrollmentId, outcome: 'passed', rationale: 'Kur hedeflerine ulaştı.' },
        key(),
      ),
      201,
    )

    const cookies = await Promise.all(coordinators.map((user) => signInAs(app, user)))
    const responses = await Promise.all(
      cookies.map((cookie) =>
        post(
          cookie,
          `/progression-decisions/${decision.id}/approve`,
          {},
          {
            ...key(),
            'if-match': `"${decision.rowVersion}"`,
          },
        ),
      ),
    )
    assert.deepEqual(
      responses.map((response) => response.statusCode).toSorted(),
      [200, 409],
      responses.map((response) => response.body).join('\n'),
    )
    const rows = await db
      .select()
      .from(progressionDecisions)
      .where(eq(progressionDecisions.institutionId, institution.id))
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.status, 'approved')
    assert.equal(rows[0]!.version, decision.rowVersion + 1)
  })
})
