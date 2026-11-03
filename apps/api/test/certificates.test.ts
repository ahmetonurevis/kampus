import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { asc, eq } from 'drizzle-orm'

import { CORE_SKILLS } from '@kampus/school-core/cefr/suggestion.ts'

import type { App } from '../src/app.ts'
import { findProgressionDecision, saveProgressionReview } from '../src/db/cefr.ts'
import { findCertificate, insertCertificate } from '../src/db/certificates.ts'
import type { Database } from '../src/db/client.ts'
import { databaseErrorInfo } from '../src/errors.ts'
import { insertLessonHourAttendances } from '../src/db/progression.ts'
import { progressionDecisions } from '../src/db/schema/cefr.ts'
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
 * Kurum başarı belgesi ve MEBBİS belge izi uçları (OG-088; IST-081; DOM-DIL-080, 081, 082). Kural
 * core `cefr/certificates.ts`'tedir; burada modül ve kurum türü, rol, başka kurum, gövde,
 * `Idempotency-Key`, `If-Match`, numara sırası, kimliksiz doğrulama ve hız sınırı, kursiyer/veli
 * görünümü ve MEBBİS listesi denetlenir. Ders saati yoklamasının yazma ucu yoktur (OG-269):
 * satırlar doğrudan depoya yazılır. Kurulum `progression.test.ts` kalıbıdır.
 */

type Json = ReturnType<typeof JSON.parse>
type Method = 'GET' | 'POST' | 'PATCH'
type Outcome = 'passed' | 'repeat' | 'incomplete_attendance'

const VERIFICATION_KEYS = [
  'courseName',
  'institutionName',
  'issuedDate',
  'learnerInitials',
  'status',
]

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
   * Dil okulu: Deniz Yılmaz (`s-deniz`) öğretmenin B1 grubundadır (12 ders saati). `coordinator`
   * B1 akademik koordinatörüdür, `other` grubu olmayan öğretmendir. Kur sonu kararı `outcome`
   * sonucuyla önerilir ve `approve` ise koordinatör onaylar.
   */
  async function tenant(
    setup: {
      type?: 'school' | 'language_school'
      enabledModules?: Record<string, boolean>
      outcome?: Outcome
      approve?: boolean
    } = {},
  ) {
    const { type = 'language_school', outcome = 'passed', approve = true } = setup
    clientIp = `10.88.${(tenantCount += 1)}.1`
    const institution = await createInstitution(app, {
      type,
      ...(setup.enabledModules ? { enabledModules: setup.enabledModules } : {}),
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
    await db.insert(records).values({
      institutionId: institution.id,
      collection: 'students',
      id: 's-deniz',
      data: { id: 's-deniz', name: 'Deniz Yılmaz' },
      position: 1,
    })
    const base = { institution, users, cookies, groupId: '', enrollmentId: '', decisionId: '' }
    if (type !== 'language_school' || setup.enabledModules?.academic === false) return base
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
    // Devamsızlık kararı için 12 saatin 3'ü gelmedi (binde 750 < 800).
    const absent = outcome === 'incomplete_attendance' ? 3 : 0
    await insertLessonHourAttendances(
      db,
      institution.id,
      { id: enrollmentId, groupId: group.id, studentId: 's-deniz' },
      Array.from({ length: 12 }, (_, index) => ({
        lessonHourId: `ders-${index + 1}`,
        status: index < absent ? ('absent' as const) : ('present' as const),
      })),
      { userId: users.teacher.id, at: FIXED_NOW },
    )
    // Tekrar kararı kur sonu eşiğinin (60) altındaki puanla verilir.
    const score = outcome === 'repeat' ? 55 : 80
    for (const point of ['baseline', 'midterm', 'final'])
      await ok(
        await call(
          'POST',
          '/course-assessments',
          cookies.teacher,
          {
            enrollmentId,
            point,
            score,
            skills: CORE_SKILLS.map((skill) => ({ skill, score, feedback: `${skill} notu` })),
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
        { enrollmentId, outcome, rationale: 'Kur sonu ölçmesine ve devama göre karar.' },
        key(),
      ),
      201,
    )
    const decision = approve
      ? await ok(
          await call(
            'POST',
            `/progression-decisions/${proposed.id}/approve`,
            cookies.coordinator,
            {},
            { ...key(), 'if-match': `"${proposed.rowVersion}"` },
          ),
        )
      : proposed
    return { ...base, groupId: group.id as string, enrollmentId, decisionId: decision.id as string }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  const issue = (
    t: Tenant,
    cookie = t.cookies.admin,
    body: Record<string, unknown> = { decisionId: t.decisionId },
    headers: Record<string, string> = key(),
  ) => call('POST', '/course-certificates', cookie, body, headers)
  const cancel = (
    certificate: { id: string; rowVersion: number },
    cookie: string,
    version: number | null = certificate.rowVersion,
    reason = 'Ad yanlış yazıldı.',
  ) =>
    call(
      'POST',
      `/course-certificates/${certificate.id}/cancel`,
      cookie,
      { reason },
      version === null ? {} : { 'if-match': `"${version}"` },
    )
  const mebbisRecord = (t: Tenant, cookie: string, issuedDate = '2026-10-05') =>
    call(
      'POST',
      `/progression-decisions/${t.decisionId}/mebbis-record`,
      cookie,
      { certificateNumber: 'MEB-2026-0042', issuedDate },
      key(),
    )
  const verify = (code: string) => call('GET', `/certificate-verifications/${code}`)
  /** Grubun öğretmeni kaydın geçerli kararını `outcome` ile düzeltir; düzeltme onay bekler. */
  const correct = async (t: Tenant, outcome: Outcome) =>
    ok(
      await call(
        'POST',
        '/progression-decisions',
        t.cookies.teacher,
        {
          enrollmentId: t.enrollmentId,
          outcome,
          rationale: 'Kur sonu puanı yeniden incelendi.',
          correctsDecisionId: t.decisionId,
        },
        key(),
      ),
      201,
    )
  const approve = (decision: { id: string; rowVersion: number }, cookie: string) =>
    call(
      'POST',
      `/progression-decisions/${decision.id}/approve`,
      cookie,
      {},
      { ...key(), 'if-match': `"${decision.rowVersion}"` },
    )
  const decisionStatus = async (id: string) => {
    const [row] = await db
      .select({ status: progressionDecisions.status, version: progressionDecisions.version })
      .from(progressionDecisions)
      .where(eq(progressionDecisions.id, id))
    return row
  }

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

  test('IST-081 oturumsuz 401', async () => {
    const t = await tenant()
    const id = randomUUID()
    for (const response of [
      await issue(t, ''),
      await cancel({ id, rowVersion: 1 }, ''),
      await call('GET', '/course-certificates'),
      await call('GET', `/course-certificates/${id}`),
      await call('GET', `/groups/${t.groupId}/mebbis-certificates`),
      await mebbisRecord(t, ''),
    ])
      fails(response, 401, 'unauthenticated')
  })

  test('DOM-DIL-082 DOM-YTK-012 rol 403, düz öğretmen permission_denied, modül kapalı 403, okulda 404; kayıt değişmez', async () => {
    const t = await tenant()
    const certificate = await ok(await issue(t), 201)
    const before = await snapshot(t.institution.id)
    for (const cookie of [t.cookies.frontDesk, t.cookies.student, t.cookies.parent])
      for (const response of [
        await issue(t, cookie),
        await cancel(certificate, cookie),
        await call('GET', `/groups/${t.groupId}/mebbis-certificates`, cookie),
        await mebbisRecord(t, cookie),
      ])
        fails(response, 403, 'forbidden')
    fails(await call('GET', '/course-certificates', t.cookies.frontDesk), 403, 'forbidden')
    fails(
      await call('GET', `/course-certificates/${certificate.id}`, t.cookies.frontDesk),
      403,
      'forbidden',
    )
    // Grubun öğretmeni belgeyi düzenleyemez, iptal edemez, MEBBİS'i işaretleyemez.
    for (const response of [
      await issue(t, t.cookies.teacher),
      await cancel(certificate, t.cookies.teacher),
      await mebbisRecord(t, t.cookies.teacher),
    ])
      fails(response, 403, 'permission_denied')
    // Grubu okuyamayan öğretmen için kayıt yoktur.
    fails(await issue(t, t.cookies.other), 404, 'not_found')
    assert.deepEqual(await snapshot(t.institution.id), before)

    const closed = await tenant({ enabledModules: { academic: false } })
    const school = await tenant({ type: 'school' })
    const id = randomUUID()
    for (const [other, status, code] of [
      [closed, 403, 'module_disabled'],
      [school, 404, 'not_found'],
    ] as const) {
      for (const response of [
        await issue(other, other.cookies.admin, { decisionId: id }),
        await cancel({ id, rowVersion: 1 }, other.cookies.admin),
        await call('GET', '/course-certificates', other.cookies.student),
        await call('GET', `/course-certificates/${id}`, other.cookies.admin),
        await call('GET', `/groups/${id}/mebbis-certificates`, other.cookies.admin),
        await call(
          'POST',
          `/progression-decisions/${id}/mebbis-record`,
          other.cookies.admin,
          { certificateNumber: 'MEB-1', issuedDate: '2026-10-01' },
          key(),
        ),
      ])
        fails(response, status, code)
    }
  })

  test('IST-081 başka kurumun belgesi, kararı ve grubu 404, listede yok, B değişmez; gövdedeki institutionId 400', async () => {
    const a = await tenant()
    const b = await tenant()
    const foreign = await ok(await issue(b), 201)
    const before = await snapshot(b.institution.id)
    clientIp = '10.88.251.1'
    for (const response of [
      await issue(a, a.cookies.admin, { decisionId: b.decisionId }),
      await cancel(foreign, a.cookies.admin, foreign.rowVersion, 'Başka kurumdan iptal denemesi.'),
      await call('GET', `/course-certificates/${foreign.id}`, a.cookies.admin),
      await call('GET', `/groups/${b.groupId}/mebbis-certificates`, a.cookies.admin),
      await mebbisRecord(b, a.cookies.admin),
    ])
      fails(response, 404, 'not_found')
    const list = await call('GET', '/course-certificates', a.cookies.admin)
    assert.equal(list.statusCode, 200, list.body)
    assert.deepEqual(list.json().data, [])
    assert.equal(list.json().meta.total, 0)
    fails(
      await issue(a, a.cookies.admin, {
        decisionId: a.decisionId,
        institutionId: b.institution.id,
      }),
      400,
      'validation_failed',
    )
    assert.deepEqual(await snapshot(b.institution.id), before)
    assert.deepEqual((await snapshot(a.institution.id)).certificates, [])
  })

  test('DOM-DIL-081 onay bekleyen, tekrar ve devamsızlık kararıyla belge düzenlenmez (422); kayıt yazılmaz', async () => {
    for (const [setup, code] of [
      [{ approve: false }, 'certificate_decision_pending'],
      [{ outcome: 'repeat' as const }, 'certificate_not_eligible'],
      [{ outcome: 'incomplete_attendance' as const }, 'certificate_not_eligible'],
    ] as const) {
      const t = await tenant(setup)
      fails(await issue(t), 422, code)
      assert.deepEqual((await snapshot(t.institution.id)).certificates, [], code)
    }
  })

  test('DOM-DIL-082 numara kurumda tekil ve sıralı; iptal sonrası yeni belge sıra 2, eski numara geri gelmez', async () => {
    const t = await tenant()
    const first = await ok(await issue(t), 201)
    assert.match(first.number, /^KB-2026-000001$/)
    assert.equal(first.status, 'valid')
    assert.equal(first.content.learnerName, 'Deniz Yılmaz')
    assert.equal(first.content.level, 'B1')
    assert.equal(first.issuedByUserId, t.institution.admin.id)

    const cancelled = await ok(await cancel(first, t.cookies.coordinator))
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.number, first.number)
    assert.equal(cancelled.verificationCode, first.verificationCode)
    assert.equal(cancelled.cancellationReason, 'Ad yanlış yazıldı.')
    fails(await cancel(cancelled, t.cookies.admin), 409, 'certificate_already_cancelled')

    const second = await ok(
      await issue(t, t.cookies.coordinator, {
        decisionId: t.decisionId,
        replacesCertificateId: first.id,
      }),
      201,
    )
    assert.equal(second.number, 'KB-2026-000002')
    assert.equal(second.replacesCertificateId, first.id)
    assert.notEqual(second.verificationCode, first.verificationCode)
    const rows = (await snapshot(t.institution.id)).certificates
    assert.deepEqual(rows.map((row) => row.serial).toSorted(), [1, 2])
    assert.equal(new Set(rows.map((row) => row.number)).size, 2)
    assert.equal(new Set(rows.map((row) => row.verificationCode)).size, 2)
    assert.equal((await ok(await verify(first.verificationCode))).status, 'cancelled')
    assert.equal((await ok(await verify(second.verificationCode))).status, 'valid')

    // Başka kurumun sırası kendi sayacındandır.
    const other = await tenant()
    assert.equal((await ok(await issue(other), 201)).number, 'KB-2026-000001')
  })

  test('DOM-DIL-082 ikinci geçerli belge 409; iptalin yerine tek belge; Idempotency-Key ve If-Match', async () => {
    const t = await tenant()
    fails(
      await issue(t, t.cookies.admin, { decisionId: t.decisionId }, {}),
      400,
      'idempotency_key_required',
    )
    const headers = key()
    const first = await issue(t, t.cookies.admin, { decisionId: t.decisionId }, headers)
    assert.equal(first.statusCode, 201, first.body)
    const replay = await issue(t, t.cookies.admin, { decisionId: t.decisionId }, headers)
    assert.equal(replay.statusCode, 201, replay.body)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), first.json())
    const certificate = first.json().data as Json
    assert.equal((await snapshot(t.institution.id)).certificates.length, 1)
    fails(await issue(t), 409, 'certificate_already_issued')

    const before = await snapshot(t.institution.id)
    fails(await cancel(certificate, t.cookies.admin, null), 400, 'if_match_required')
    fails(
      await cancel(certificate, t.cookies.admin, certificate.rowVersion + 1),
      409,
      'version_conflict',
    )
    fails(
      await cancel(certificate, t.cookies.admin, certificate.rowVersion, ' '),
      400,
      'validation_failed',
    )
    assert.deepEqual(await snapshot(t.institution.id), before)

    await ok(await cancel(certificate, t.cookies.admin))
    const replacing = { decisionId: t.decisionId, replacesCertificateId: certificate.id }
    const second = await ok(await issue(t, t.cookies.admin, replacing), 201)
    await ok(await cancel(second, t.cookies.admin))
    fails(await issue(t, t.cookies.admin, replacing), 409, 'certificate_already_replaced')
    fails(
      await issue(t, t.cookies.admin, {
        decisionId: t.decisionId,
        replacesCertificateId: randomUUID(),
      }),
      404,
      'not_found',
    )
    assert.equal((await snapshot(t.institution.id)).certificates.length, 2)
  })

  test('DOM-DIL-082 Sabah kararı 85: kimliksiz doğrulama yalnız beş alan döner, bozuk kod 404, modül kapansa da doğrular', async () => {
    const t = await tenant()
    const certificate = await ok(await issue(t), 201)
    for (const code of ['bozuk', 'ZZZZ', '0000-0000-0000-0000-0000-0000-0000', 'x'.repeat(90)])
      fails(await verify(code), 404, 'not_found')

    const response = await verify(certificate.verificationCode.toLowerCase().replaceAll('-', ''))
    assert.equal(response.statusCode, 200, response.body)
    const verification = response.json().data as Json
    assert.deepEqual(Object.keys(verification).toSorted(), VERIFICATION_KEYS)
    assert.deepEqual(verification, {
      status: 'valid',
      learnerInitials: 'D. Y.',
      courseName: 'Genel İngilizce B1.1',
      issuedDate: '2026-10-06',
      institutionName: certificate.content.institutionName,
    })
    for (const leaked of [
      's-deniz',
      'Deniz Yılmaz',
      'Yılmaz',
      certificate.number,
      certificate.learnerId,
      t.institution.admin.email,
      'birthDate',
      'email',
    ])
      assert.equal(response.body.includes(leaked), false, leaked)

    const settings = await ok(await call('GET', '/modules', t.cookies.admin))
    await ok(
      await call(
        'PATCH',
        '/modules/academic',
        t.cookies.admin,
        { enabled: false },
        { ...key(), 'if-match': `"${settings.version}"` },
      ),
    )
    fails(await call('GET', '/course-certificates', t.cookies.admin), 403, 'module_disabled')
    assert.equal((await ok(await verify(certificate.verificationCode))).status, 'valid')
  })

  test('DOM-DIL-082 doğrulama IP başına dakikada 30 istek; aşılınca 429 ve Retry-After', async () => {
    clientIp = '10.88.252.1'
    for (let index = 0; index < 30; index += 1)
      fails(await verify(`BOZUK-${index}`), 404, 'not_found')
    const limited = await verify('BOZUK-31')
    fails(limited, 429, 'rate_limited')
    assert.ok(Number(limited.headers['retry-after']) > 0)
    // Başka istemci etkilenmez.
    clientIp = '10.88.253.1'
    fails(await verify('BOZUK-32'), 404, 'not_found')
  })

  test('DOM-DIL-081 DOM-DIL-090 öğrenci ve veli yalnız geçerli belgeyi görür; yetişkin kursiyerin velisi görmez', async () => {
    const t = await tenant()
    const first = await ok(await issue(t), 201)
    const learnerKeys = [
      'content',
      'courseId',
      'id',
      'issuedAt',
      'number',
      'status',
      'verificationCode',
    ]
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const list = await call('GET', '/course-certificates', cookie)
      assert.equal(list.statusCode, 200, list.body)
      assert.equal(list.json().meta.total, 1)
      const [own] = list.json().data as Json[]
      assert.deepEqual(Object.keys(own).toSorted(), learnerKeys)
      assert.equal(own.id, first.id)
      const detail = await ok(await call('GET', `/course-certificates/${first.id}`, cookie))
      assert.deepEqual(Object.keys(detail).toSorted(), learnerKeys)
    }
    // Personel düzenleyeni ve iptal izini görür.
    const staff = await ok(await call('GET', `/course-certificates/${first.id}`, t.cookies.teacher))
    assert.equal(staff.issuedByUserId, t.institution.admin.id)

    await ok(await cancel(first, t.cookies.admin))
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const list = await call('GET', '/course-certificates?status=cancelled', cookie)
      assert.deepEqual(list.json().data, [])
      assert.equal((await call('GET', '/course-certificates', cookie)).json().meta.total, 0)
      fails(await call('GET', `/course-certificates/${first.id}`, cookie), 404, 'not_found')
    }
    const second = await ok(
      await issue(t, t.cookies.admin, {
        decisionId: t.decisionId,
        replacesCertificateId: first.id,
      }),
      201,
    )
    const staffList = await call('GET', '/course-certificates?status=cancelled', t.cookies.admin)
    assert.deepEqual(
      (staffList.json().data as Json[]).map((item) => item.id),
      [first.id],
    )

    // Kesin kayıtta 18 yaş üstü seçilen kursiyerin velisi belge görmez.
    await db.insert(records).values({
      institutionId: t.institution.id,
      collection: 'prospects',
      id: 'p-deniz',
      data: { id: 'p-deniz', studentId: 's-deniz', minor: false },
      position: 1,
    })
    assert.equal((await call('GET', '/course-certificates', t.cookies.parent)).json().meta.total, 0)
    fails(
      await call('GET', `/course-certificates/${second.id}`, t.cookies.parent),
      404,
      'not_found',
    )
    const own = await call('GET', '/course-certificates', t.cookies.student)
    assert.deepEqual(
      (own.json().data as Json[]).map((item) => item.id),
      [second.id],
    )
  })

  test('DOM-DIL-070 DOM-DIL-082 Sabah kararı 86 geçerli belge varken düzeltme onayı 422 ve karar bekler; iptalden sonra tekrar kararı onaylanır, belge iptal kalır', async () => {
    const t = await tenant()
    const certificate = await ok(await issue(t), 201)
    const correction = await correct(t, 'repeat')
    const before = await snapshot(t.institution.id)
    const blocked = await approve(correction, t.cookies.coordinator)
    fails(blocked, 422, 'certificate_cancel_first')
    assert.equal(blocked.json().message, 'Önce düzenlenmiş belge iptal edilmeli.')
    assert.deepEqual(await decisionStatus(correction.id), {
      status: 'pending',
      version: correction.rowVersion,
    })
    assert.deepEqual(await snapshot(t.institution.id), before)
    assert.equal((await ok(await verify(certificate.verificationCode))).status, 'valid')

    // Belge iptal edilince düzeltme onaylanır; eski belge doğrulamada iptal görünür.
    await ok(
      await cancel(certificate, t.cookies.admin, certificate.rowVersion, 'Karar düzeltilecek.'),
    )
    const approved = await ok(await approve(correction, t.cookies.coordinator))
    assert.equal(approved.status, 'approved')
    assert.equal(approved.outcome, 'repeat')
    assert.equal((await ok(await verify(certificate.verificationCode))).status, 'cancelled')
    // Tekrar kararıyla yeni belge yok; eski karar düzeltildi.
    fails(
      await issue(t, t.cookies.admin, {
        decisionId: correction.id,
        replacesCertificateId: certificate.id,
      }),
      422,
      'certificate_not_eligible',
    )
    fails(await issue(t), 422, 'certificate_not_eligible')
    assert.deepEqual(
      (await snapshot(t.institution.id)).certificates.map((row) => row.status),
      ['cancelled'],
    )
  })

  test('DOM-DIL-070 DOM-DIL-082 Sabah kararı 86 düzeltme geçti ise yeni belge replacesCertificateId ile düzeltmeden düzenlenir; eski karardan düzenlenmez', async () => {
    const t = await tenant()
    const certificate = await ok(await issue(t), 201)
    const correction = await correct(t, 'passed')
    fails(await approve(correction, t.cookies.coordinator), 422, 'certificate_cancel_first')
    await ok(await cancel(certificate, t.cookies.coordinator))
    await ok(await approve(correction, t.cookies.coordinator))

    const replacing = { decisionId: correction.id, replacesCertificateId: certificate.id }
    fails(
      await issue(t, t.cookies.admin, { ...replacing, decisionId: t.decisionId }),
      422,
      'certificate_decision_superseded',
    )
    const second = await ok(await issue(t, t.cookies.admin, replacing), 201)
    assert.equal(second.decisionId, correction.id)
    assert.equal(second.replacesCertificateId, certificate.id)
    assert.equal(second.number, 'KB-2026-000002')
    assert.equal((await ok(await verify(second.verificationCode))).status, 'valid')
    assert.equal((await ok(await verify(certificate.verificationCode))).status, 'cancelled')
  })

  test('DOM-DIL-082 Sabah kararı 86 aynı kayda önceki karardan geçerli belge varken ikinci geçerli belge 409; veritabanı da reddeder', async () => {
    const t = await tenant()
    const certificate = await ok(await issue(t), 201)
    const correction = await correct(t, 'passed')
    // Kural öncesi durum: düzeltme, belge iptal edilmeden depoya doğrudan onaylanmış olsun.
    const stored = await findProgressionDecision(db, t.institution.id, correction.id)
    assert.ok(stored)
    assert.ok(
      await saveProgressionReview(
        db,
        t.institution.id,
        correction.id,
        stored.rowVersion,
        {
          status: 'approved',
          reviewedByUserId: t.users.coordinator.id,
          reviewedAt: FIXED_NOW.toISOString(),
          rejectionReason: null,
        },
        FIXED_NOW,
      ),
    )
    const before = await snapshot(t.institution.id)
    fails(
      await issue(t, t.cookies.admin, { decisionId: correction.id }),
      409,
      'certificate_already_issued',
    )
    assert.deepEqual(await snapshot(t.institution.id), before)

    // Core denetimini atlayan yazma kayıt başına kısmi tekil indekse takılır.
    const existing = await findCertificate(db, t.institution.id, certificate.id)
    assert.ok(existing)
    await assert.rejects(
      insertCertificate(db, t.institution.id, {
        ...existing,
        decisionId: correction.id,
        content: { ...existing.content, decisionId: correction.id },
        serial: 99,
        number: 'KB-2026-000099',
        verificationCode: `ZZZZ${existing.verificationCode.slice(4)}`,
      }),
      (error: unknown) => {
        assert.deepEqual(databaseErrorInfo(error), {
          code: '23505',
          constraint: 'course_certificates_valid_enrollment_key',
        })
        return true
      },
    )
    assert.equal((await snapshot(t.institution.id)).certificates.length, 1)
  })

  test('DOM-DIL-080 MEBBİS listesi hak kazananı gösterir, işaret bir kez; ileri tarih 422, tekrar kararı listede yok', async () => {
    const t = await tenant()
    const list = await ok(
      await call('GET', `/groups/${t.groupId}/mebbis-certificates`, t.cookies.admin),
    )
    assert.equal(list.canRecord, true)
    assert.deepEqual(list.learners, [
      {
        enrollmentId: t.enrollmentId,
        studentId: 's-deniz',
        decisionId: t.decisionId,
        record: null,
      },
    ])
    const teacherView = await ok(
      await call('GET', `/groups/${t.groupId}/mebbis-certificates`, t.cookies.teacher),
    )
    assert.equal(teacherView.canRecord, false)
    fails(
      await call('GET', `/groups/${t.groupId}/mebbis-certificates`, t.cookies.other),
      404,
      'not_found',
    )

    fails(await mebbisRecord(t, t.cookies.admin, '2026-10-07'), 422, 'mebbis_date_in_future')
    assert.deepEqual((await snapshot(t.institution.id)).mebbis, [])
    const recorded = await ok(await mebbisRecord(t, t.cookies.coordinator), 201)
    assert.equal(recorded.certificateNumber, 'MEB-2026-0042')
    assert.equal(recorded.issuedDate, '2026-10-05')
    assert.equal(recorded.recordedByUserId, t.users.coordinator.id)
    fails(await mebbisRecord(t, t.cookies.admin), 409, 'mebbis_already_recorded')
    const after = await ok(
      await call('GET', `/groups/${t.groupId}/mebbis-certificates`, t.cookies.admin),
    )
    assert.equal(after.learners[0].record.id, recorded.id)
    assert.equal((await snapshot(t.institution.id)).mebbis.length, 1)

    const repeat = await tenant({ outcome: 'repeat' })
    const repeatList = await ok(
      await call('GET', `/groups/${repeat.groupId}/mebbis-certificates`, repeat.cookies.admin),
    )
    assert.deepEqual(repeatList.learners, [])
    fails(await mebbisRecord(repeat, repeat.cookies.admin), 422, 'certificate_not_eligible')
  })
})
