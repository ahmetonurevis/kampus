import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { languageGroups } from '../src/db/schema/language-groups.ts'
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
 * Dil okulu grupları gerçek PostgreSQL 16'da (IST-077): aynı öğretmen ve saatle eşzamanlı iki
 * grup oluşturma kurum kilidiyle sıraya girer; biri 201, öteki 422 `group_teacher_conflict` alır
 * ve tek grup kalır. PGlite tek bağlantılı olduğundan bu yarış yalnız burada sınanır.
 */
describe('PostgreSQL 16: dil okulu grupları', { skip: PG_SKIP }, () => {
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

  test('IST-077: aynı öğretmenle eşzamanlı iki oluşturmadan biri 201, öteki 422; tek grup kalır', async () => {
    const institution = await createInstitution(app, { type: 'language_school' })
    const teacher = await createMember(app, institution.id, 'ogretmen')
    const cookie = await signInAs(app, institution.admin)
    const course = await post(
      cookie,
      '/courses',
      {
        name: 'Genel İngilizce B1.1',
        level: 'B1',
        totalHours: 12,
        weeklyHours: 4,
        minLearners: 2,
        maxLearners: 12,
      },
      { 'idempotency-key': randomUUID() },
    )
    assert.equal(course.statusCode, 201, course.body)
    const courseId = course.json().data.id as string
    const activated = await post(cookie, `/courses/${courseId}/activate`, {}, { 'if-match': '"1"' })
    assert.equal(activated.statusCode, 200, activated.body)
    const group = (name: string, room: string) => ({
      courseId,
      name,
      ageBand: 'adult',
      teacherMembershipId: teacher.membershipId,
      delivery: 'in_person',
      room,
      schedule: [
        { weekday: 1, startTime: '18:00' },
        { weekday: 1, startTime: '18:45' },
        { weekday: 3, startTime: '18:00' },
        { weekday: 3, startTime: '18:45' },
      ],
      startDate: '2026-10-12',
      capacity: 10,
    })
    const results = await Promise.all([
      post(cookie, '/groups', group('B1 Akşam A', 'D1'), { 'idempotency-key': randomUUID() }),
      post(cookie, '/groups', group('B1 Akşam B', 'D2'), { 'idempotency-key': randomUUID() }),
    ])
    assert.deepEqual(results.map((item) => item.statusCode).sort(), [201, 422])
    const rejected = results.find((item) => item.statusCode === 422)
    assert.equal(rejected?.json().code, 'group_teacher_conflict')
    const rows = await db
      .select({ id: languageGroups.id })
      .from(languageGroups)
      .where(eq(languageGroups.institutionId, institution.id))
    assert.equal(rows.length, 1)
  })
})
