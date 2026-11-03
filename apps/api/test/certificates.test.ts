import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { asc, eq } from 'drizzle-orm'

import { CORE_SKILLS } from '@kampus/school-core/cefr/suggestion.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertLessonHourAttendances } from '../src/db/progression.ts'
import { courseCertificates, mebbisCertificateRecords } from '../src/db/schema/certificates.ts'
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
 * Kurum başarı belgesi uçları (OG-088; IST-081; DOM-DIL-080, 081, 082). Kural core
 * `cefr/certificates.ts`'tedir. Bu dosya duman testidir: düzenleme yolu, kimliksiz doğrulama ve
 * iptal; ayrıntılı uç testleri sonraki adımdadır. Kurulum `progression.test.ts` kalıbıdır.
 */

type Json = ReturnType<typeof JSON.parse>
type Method = 'GET' | 'POST'

describe('kurum başarı belgesi uçları', () => {
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
   * Dil okulu: Deniz Yılmaz (`s-deniz`) öğretmenin B1 grubunda; kur sonu kararı `passed` ve B1
   * akademik koordinatörü onaylamış.
   */
  async function passedTenant() {
    clientIp = `10.88.${(tenantCount += 1)}.1`
    const institution = await createInstitution(app, { type: 'language_school' })
    const users = {
      teacher: await createMember(app, institution.id, 'ogretmen'),
      coordinator: await createMember(app, institution.id, 'ogretmen'),
    }
    const cookies = {
      admin: await signInAs(app, institution.admin),
      teacher: await signInAs(app, users.teacher),
      coordinator: await signInAs(app, users.coordinator),
    }
    await db.insert(records).values({
      institutionId: institution.id,
      collection: 'students',
      id: 's-deniz',
      data: { id: 's-deniz', name: 'Deniz Yılmaz' },
      position: 1,
    })
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
    await insertLessonHourAttendances(
      db,
      institution.id,
      { id: enrollmentId, groupId: group.id, studentId: 's-deniz' },
      Array.from({ length: 12 }, (_, index) => ({
        lessonHourId: `ders-${index + 1}`,
        status: 'present' as const,
      })),
      { userId: users.teacher.id, at: FIXED_NOW },
    )
    for (const point of ['baseline', 'midterm', 'final'])
      await ok(
        await call(
          'POST',
          '/course-assessments',
          cookies.teacher,
          {
            enrollmentId,
            point,
            score: 80,
            skills: CORE_SKILLS.map((skill) => ({ skill, score: 80, feedback: `${skill} iyi` })),
          },
          key(),
        ),
        201,
      )
    const proposed = await ok(
      await call(
        'POST',
        '/progression-decisions',
        cookies.teacher,
        { enrollmentId, outcome: 'passed', rationale: 'Dört beceride kur sonu hedefine ulaştı.' },
        key(),
      ),
      201,
    )
    const decision = await ok(
      await call(
        'POST',
        `/progression-decisions/${proposed.id}/approve`,
        cookies.coordinator,
        {},
        {
          ...key(),
          'if-match': `"${proposed.rowVersion}"`,
        },
      ),
    )
    return { institution, cookies, groupId: group.id as string, decisionId: decision.id as string }
  }

  test('DOM-DIL-082 kimliksiz doğrulama bozuk ve olmayan kodda 404, kişisel veri sızdırmaz', async () => {
    clientIp = '10.88.250.1'
    for (const code of ['bozuk', 'ZZZZ', '0000-0000-0000-0000-0000-0000-0000'])
      fails(await call('GET', `/certificate-verifications/${code}`), 404, 'not_found')
  })

  test('DOM-DIL-081 DOM-DIL-082 yönetici belgeyi düzenler, doğrulanır, iptal edilince cancelled döner', async () => {
    const t = await passedTenant()
    fails(
      await call(
        'POST',
        '/course-certificates',
        t.cookies.teacher,
        { decisionId: t.decisionId },
        key(),
      ),
      403,
      'permission_denied',
    )
    const certificate = await ok(
      await call(
        'POST',
        '/course-certificates',
        t.cookies.admin,
        { decisionId: t.decisionId },
        key(),
      ),
      201,
    )
    assert.match(certificate.number, /^KB-\d{4}-000001$/)
    assert.equal(certificate.status, 'valid')
    assert.equal(certificate.content.learnerName, 'Deniz Yılmaz')
    assert.equal(certificate.content.level, 'B1')

    const verification = await ok(
      await call('GET', `/certificate-verifications/${certificate.verificationCode.toLowerCase()}`),
    )
    assert.deepEqual(Object.keys(verification).sort(), [
      'courseName',
      'institutionName',
      'issuedDate',
      'learnerInitials',
      'status',
    ])
    assert.equal(verification.status, 'valid')
    assert.equal(verification.learnerInitials, 'D. Y.')
    assert.equal(verification.courseName, 'Genel İngilizce B1.1')

    await ok(
      await call(
        'POST',
        `/course-certificates/${certificate.id}/cancel`,
        t.cookies.coordinator,
        { reason: 'Ad yanlış yazıldı.' },
        { 'if-match': `"${certificate.rowVersion}"` },
      ),
    )
    const cancelled = await ok(
      await call('GET', `/certificate-verifications/${certificate.verificationCode}`),
    )
    assert.equal(cancelled.status, 'cancelled')
  })

  const snapshot = async (institutionId: string) => ({
    certificates: await db
      .select()
      .from(courseCertificates)
      .where(eq(courseCertificates.institutionId, institutionId))
      .orderBy(asc(courseCertificates.id)),
    mebbis: await db
      .select()
      .from(mebbisCertificateRecords)
      .where(eq(mebbisCertificateRecords.institutionId, institutionId))
      .orderBy(asc(mebbisCertificateRecords.id)),
  })

  test('IST-081 başka kurumun belgesi, kararı ve grubu 404, listede yok, B değişmez; gövdedeki institutionId 400', async () => {
    const a = await passedTenant()
    const b = await passedTenant()
    const foreign = await ok(
      await call(
        'POST',
        '/course-certificates',
        b.cookies.admin,
        { decisionId: b.decisionId },
        key(),
      ),
      201,
    )
    const before = await snapshot(b.institution.id)
    clientIp = '10.88.251.1'
    for (const response of [
      await call(
        'POST',
        '/course-certificates',
        a.cookies.admin,
        { decisionId: b.decisionId },
        key(),
      ),
      await call(
        'POST',
        `/course-certificates/${foreign.id}/cancel`,
        a.cookies.admin,
        { reason: 'Başka kurumdan iptal denemesi.' },
        { 'if-match': `"${foreign.rowVersion}"` },
      ),
      await call('GET', `/course-certificates/${foreign.id}`, a.cookies.admin),
      await call('GET', `/groups/${b.groupId}/mebbis-certificates`, a.cookies.admin),
      await call(
        'POST',
        `/progression-decisions/${b.decisionId}/mebbis-record`,
        a.cookies.admin,
        { certificateNumber: 'MEB-1', issuedDate: '2026-10-01' },
        key(),
      ),
    ])
      fails(response, 404, 'not_found')
    const list = await call('GET', '/course-certificates', a.cookies.admin)
    assert.equal(list.statusCode, 200, list.body)
    assert.deepEqual(list.json().data, [])
    assert.equal(list.json().meta.total, 0)
    fails(
      await call(
        'POST',
        '/course-certificates',
        a.cookies.admin,
        { decisionId: a.decisionId, institutionId: b.institution.id },
        key(),
      ),
      400,
      'validation_failed',
    )
    assert.deepEqual(await snapshot(b.institution.id), before)
  })
})
