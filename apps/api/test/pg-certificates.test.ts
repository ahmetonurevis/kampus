import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq, sql } from 'drizzle-orm'

import {
  CERTIFICATE_TITLE,
  certificateLevelStatement,
} from '@kampus/school-core/cefr/certificates.ts'
import { CORE_SKILLS } from '@kampus/school-core/cefr/suggestion.ts'

import type { App } from '../src/app.ts'
import { insertCertificate } from '../src/db/certificates.ts'
import type { Database } from '../src/db/client.ts'
import { insertLessonHourAttendances } from '../src/db/progression.ts'
import { certificateCounters, courseCertificates } from '../src/db/schema/certificates.ts'
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
 * Kurum başarı belgesi numarası gerçek PostgreSQL 16'da (OG-088; DOM-DIL-082): eşzamanlı
 * düzenlemeler kurum sayacını kilitli artırır; iki kursiyerin belgesi çakışmadan 1 ve 2 numarayı
 * alır, aynı karara eşzamanlı iki düzenlemeden biri 201, öteki 409 olur ve sayaç geri alınır.
 * Kayıt başına tek geçerli belge (Sabah kararı 86) kurum kilidi dışındaki eşzamanlı yazmaya karşı
 * kısmi tekil indeksle de korunur. PGlite tek bağlantılı olduğundan bu yarış yalnız burada sınanır.
 */
describe('PostgreSQL 16: kurum başarı belgesi numarası', { skip: PG_SKIP }, () => {
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

  /** B1 grubunda `learners` kursiyerin her biri için onaylı `passed` kararı. */
  async function passedLearners(learners: readonly string[]) {
    const institution = await createInstitution(app, { type: 'language_school' })
    const teacher = await createMember(app, institution.id, 'ogretmen')
    const coordinator = await createMember(app, institution.id, 'ogretmen')
    await db.insert(coordinatorDuties).values({
      institutionId: institution.id,
      id: randomUUID(),
      membershipId: coordinator.membershipId,
      kind: 'academic_coordinator',
      scopeId: 'B1',
      assignedByUserId: institution.admin.id,
    })
    for (const [index, id] of learners.entries())
      await db.insert(records).values({
        institutionId: institution.id,
        collection: 'students',
        id,
        data: { id, name: `Test Kursiyer ${index + 1}` },
        position: index + 1,
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
    const teacherCookie = await signInAs(app, teacher)
    const coordinatorCookie = await signInAs(app, coordinator)
    const decisionIds: string[] = []
    const enrollments: { id: string; studentId: string }[] = []
    for (const studentId of learners) {
      const enrollmentId = randomUUID()
      await db.insert(languageGroupMembers).values({
        institutionId: institution.id,
        id: enrollmentId,
        groupId: group.id,
        studentId,
        status: 'active',
        joinedAt: FIXED_NOW,
      })
      enrollments.push({ id: enrollmentId, studentId })
      // Ders saati yoklamasının yazma ucu yok (OG-269): satırlar depoya doğrudan yazılır.
      await insertLessonHourAttendances(
        db,
        institution.id,
        { id: enrollmentId, groupId: group.id, studentId },
        Array.from({ length: 12 }, (_, index) => ({
          lessonHourId: `ders-${index + 1}`,
          status: 'present' as const,
        })),
        { userId: teacher.id, at: FIXED_NOW },
      )
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
      const proposed = await data(
        await post(
          teacherCookie,
          '/progression-decisions',
          { enrollmentId, outcome: 'passed', rationale: 'Kur hedeflerine ulaştı.' },
          key(),
        ),
        201,
      )
      const approved = await data(
        await post(
          coordinatorCookie,
          `/progression-decisions/${proposed.id}/approve`,
          {},
          { ...key(), 'if-match': `"${proposed.rowVersion}"` },
        ),
        200,
      )
      decisionIds.push(approved.id)
    }
    const rows = () =>
      db
        .select()
        .from(courseCertificates)
        .where(eq(courseCertificates.institutionId, institution.id))
    const counter = async () => {
      const [row] = await db
        .select()
        .from(certificateCounters)
        .where(eq(certificateCounters.institutionId, institution.id))
      return row?.lastSerial ?? 0
    }
    return {
      institution,
      admin,
      teacherCookie,
      coordinatorCookie,
      course,
      group,
      enrollments,
      decisionIds,
      rows,
      counter,
    }
  }

  test('DOM-DIL-082: iki kursiyerin eşzamanlı düzenlemesi çakışmadan 1 ve 2 numarayı alır', async () => {
    const t = await passedLearners(['s-pg-1', 's-pg-2'])
    const responses = await Promise.all(
      t.decisionIds.map((decisionId, index) =>
        post(
          index === 0 ? t.admin : t.coordinatorCookie,
          '/course-certificates',
          { decisionId },
          key(),
        ),
      ),
    )
    for (const response of responses) assert.equal(response.statusCode, 201, response.body)
    const rows = await t.rows()
    assert.deepEqual(rows.map((row) => row.serial).toSorted(), [1, 2])
    assert.deepEqual(rows.map((row) => row.number).toSorted(), ['KB-2026-000001', 'KB-2026-000002'])
    assert.equal(await t.counter(), 2)
  })

  test('DOM-DIL-082: aynı karara eşzamanlı iki düzenlemeden biri 201, öteki 409; tek belge, numara boşa gitmez', async () => {
    const t = await passedLearners(['s-pg-3'])
    const [decisionId] = t.decisionIds
    const responses = await Promise.all(
      [t.admin, t.coordinatorCookie].map((cookie) =>
        post(cookie, '/course-certificates', { decisionId }, key()),
      ),
    )
    assert.deepEqual(
      responses.map((response) => response.statusCode).toSorted(),
      [201, 409],
      responses.map((response) => response.body).join('\n'),
    )
    const conflict = responses.find((response) => response.statusCode === 409)
    assert.equal(conflict?.json().code, 'certificate_already_issued')
    const rows = await t.rows()
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.number, 'KB-2026-000001')
    assert.equal(await t.counter(), 1)
  })

  test('DOM-DIL-082 Sabah kararı 86: aynı kayda iki karardan eşzamanlı düzenlemede kilit dışındaki yazma kazanır, istek 409; tek geçerli belge, sayaç geri alınır', async () => {
    const t = await passedLearners(['s-pg-4'])
    const [d1] = t.decisionIds
    const [enrollment] = t.enrollments
    assert.ok(d1 && enrollment)
    // D2: D1'in onaylı düzeltmesi (belge yokken onaylanır); kaydın geçerli kararı D2'dir.
    const proposed = await data(
      await post(
        t.teacherCookie,
        '/progression-decisions',
        {
          enrollmentId: enrollment.id,
          outcome: 'passed',
          rationale: 'Kur sonu puanı yeniden incelendi.',
          correctsDecisionId: d1,
        },
        key(),
      ),
      201,
    )
    const d2 = await data(
      await post(
        t.coordinatorCookie,
        `/progression-decisions/${proposed.id}/approve`,
        {},
        { ...key(), 'if-match': `"${proposed.rowVersion}"` },
      ),
      200,
    )

    // Kurum kilidini almayan yazma D1'den geçerli belgeyi açık transaction'da tutar; uçtan gelen
    // D2 düzenlemesi core denetiminden geçer (belge henüz görünmez) ve kayıt başına tekil indekste
    // bekler. Yazma onaylanınca istek 23505 → 409 `certificate_already_issued` alır.
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    let inserted = () => {}
    const holding = new Promise<void>((resolve) => (inserted = resolve))
    const writer = db.transaction(async (tx) => {
      await insertCertificate(tx, t.institution.id, {
        enrollmentId: enrollment.id,
        learnerId: enrollment.studentId,
        courseId: t.course.id,
        groupId: t.group.id,
        decisionId: d1,
        status: 'valid',
        serial: 99,
        number: 'KB-2026-000099',
        verificationCode: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ',
        content: {
          schemaVersion: 1,
          title: CERTIFICATE_TITLE,
          institutionName: 'Test Dil Okulu',
          learnerName: 'Test Kursiyer 1',
          courseId: t.course.id,
          courseName: 'Genel İngilizce B1.1',
          level: 'B1',
          levelStatement: certificateLevelStatement('B1'),
          totalHours: 12,
          attendance: { attendedHours: 12, totalHours: 12, permille: 1000 },
          finalScore: 80,
          skills: CORE_SKILLS.map((skill) => ({ skill, score: 80 })),
          decisionId: d1,
          approvedAt: FIXED_NOW.toISOString(),
        },
        replacesCertificateId: null,
        issuedByUserId: t.institution.admin.id,
        issuedAt: FIXED_NOW.toISOString(),
        cancelledByUserId: null,
        cancelledAt: null,
        cancellationReason: null,
      })
      inserted()
      await gate
    })
    await holding
    const request = post(t.admin, '/course-certificates', { decisionId: d2.id }, key())
    // İstek tekil indeksin satır kilidinde (`transactionid`) bekleyene dek sürer.
    let waited = false
    for (let attempt = 0; attempt < 200 && !waited; attempt += 1) {
      const result = await db.execute(
        sql`select count(*)::int as waiting from pg_stat_activity
            where datname = current_database() and wait_event = 'transactionid'`,
      )
      const [row] = (result as unknown as { rows: { waiting: number }[] }).rows
      waited = (row?.waiting ?? 0) > 0
      if (!waited) await new Promise((resolve) => setTimeout(resolve, 25))
    }
    release()
    await writer
    const response = await request
    assert.equal(waited, true, 'istek tekil indekste beklemedi')
    assert.equal(response.statusCode, 409, response.body)
    assert.equal(response.json().code, 'certificate_already_issued')
    const rows = await t.rows()
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.decisionId, d1)
    assert.equal(rows[0]!.status, 'valid')
    // Reddedilen isteğin sıra artırımı transaction'la geri alındı.
    assert.equal(await t.counter(), 0)
  })
})
