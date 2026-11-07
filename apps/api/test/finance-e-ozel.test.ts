import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, asc, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertProgressionDecision, saveProgressionReview } from '../src/db/cefr.ts'
import { insertLessonHourAttendances } from '../src/db/progression.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { lessonHourAttendances } from '../src/db/schema/cefr.ts'
import { eOzelRecords } from '../src/db/schema/finance-e-ozel.ts'
import { languageGroupMembers } from '../src/db/schema/language-groups.ts'
import { payments } from '../src/db/schema/payments.ts'
import { records } from '../src/db/schema/records.ts'
import { studentIdentities } from '../src/db/schema/student-identities.ts'
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
 * e-Özel işlem listesi (IST-085, DOM-KAY-015). Her test kendi dil okulunu kurar: iki kursiyer,
 * kimlik satırı, tahsilat, gün bazlı devamsızlık. Kur sonu kuran testler grubu API'den açar.
 * Devamsızlık ve kur sonu satırları Oğuzhan'ın tablolarından yalnız okunur.
 */

const ITEMS = '/api/v1/finance/e-ozel/items'
const EXPORT = '/api/v1/finance/e-ozel/export'
const FULL_IDENTITY = (studentId: string) => `/api/v1/finance/e-ozel/learners/${studentId}/identity`
const IDENTITY = '10000000146'

describe('e-Özel işlem listesi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let receiptSerial = 0
  const key = () => ({ 'idempotency-key': randomUUID() })

  before(async () => {
    const database = await createTestDatabase()
    db = database.db
    close = database.close
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  const member = async (id: string, role: Role) =>
    signInAs(app, await createMember(app, id, role, []))

  const call = (
    method: 'GET' | 'POST',
    url: string,
    cookie: string | null,
    body?: unknown,
    headers: Record<string, string> = {},
    target: App = app,
  ) =>
    target.inject({
      method,
      url,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    })

  const mark = (
    cookie: string | null,
    kind: string,
    sourceId: string,
    version: number,
    recorded: unknown = true,
    extra: Record<string, unknown> = {},
  ) =>
    call(
      'POST',
      `${ITEMS}/${kind}/${encodeURIComponent(sourceId)}/record`,
      cookie,
      { recorded, ...extra },
      { 'if-match': `"${String(version)}"`, ...key() },
    )

  function fails(
    response: { statusCode: number; body: string; json: () => unknown },
    status: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal((response.json() as { code: string }).code, code)
  }

  type Item = {
    kind: string
    sourceId: string
    learnerId: string
    version: number
    recordStatus: string
    sourceRemoved: boolean
    recordedAt: string | null
    recordedByName: string | null
    date: string | null
    learner: { maskedIdentity: string | null; status: string } | null
    fee: { amountCents: number; receipt: string; reference: string | null } | null
    attendance: { excused: boolean; groupName: string | null } | null
    courseEnd: { outcome: string; certificateNumber: string | null } | null
  }
  const list = async (cookie: string, query = '') => {
    const response = await call('GET', `${ITEMS}${query === '' ? '' : `?${query}`}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Item[]; meta: { total: number; page: number } }
  }
  const markRows = (id: string) =>
    db
      .select()
      .from(eOzelRecords)
      .where(eq(eOzelRecords.institutionId, id))
      .orderBy(asc(eOzelRecords.sourceId))

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, { type: 'language_school', ...overrides })
    await insertMissingRecords(
      db,
      created.id,
      [
        { collection: 'classes', id: 'c1', data: { id: 'c1', name: 'TYT-1' } },
        {
          collection: 'students',
          id: 's1',
          data: { id: 's1', name: 'Deniz Yılmaz', classId: 'c1' },
        },
        {
          collection: 'students',
          id: 's2',
          data: { id: 's2', name: 'Ece Yılmaz', classId: 'c1', isActive: false },
        },
        {
          collection: 'attendance',
          id: 'att-absent',
          data: {
            id: 'att-absent',
            studentId: 's1',
            classId: 'c1',
            date: '2026-10-01T09:00:00.000Z',
            status: 'absent',
          },
        },
        {
          collection: 'attendance',
          id: 'att-present',
          data: {
            id: 'att-present',
            studentId: 's1',
            classId: 'c1',
            date: '2026-10-02T09:00:00.000Z',
            status: 'present',
          },
        },
      ],
      FIXED_NOW,
    )
    await db.insert(studentIdentities).values({
      institutionId: created.id,
      studentId: 's1',
      academicYear: 2026,
      identityKind: 'tc',
      identityNumber: IDENTITY,
      birthDate: '2010-03-04',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    const cookie = await signInAs(app, created.admin)
    return { ...created, cookie }
  }

  async function insertPayment(
    institutionId: string,
    overrides: Partial<typeof payments.$inferInsert> = {},
  ) {
    const id = randomUUID()
    await db.insert(payments).values({
      institutionId,
      id,
      studentId: 's1',
      amountCents: 150_000,
      method: 'bank_transfer',
      reference: 'TR-0001',
      paidAt: FIXED_NOW,
      receiptYear: 2026,
      receiptNumber: ++receiptSerial,
      recordedByUserId: 'test-user',
      ...overrides,
    })
    return id
  }

  /** Kur, grup, kayıt ve onaylı kur sonu kararı; yoklama satırları dahil. */
  async function withCourseEnd(a: Awaited<ReturnType<typeof institution>>) {
    const teacher = await createMember(app, a.id, 'ogretmen', [])
    const course = await call(
      'POST',
      '/api/v1/courses',
      a.cookie,
      {
        name: 'Genel İngilizce B1.1',
        level: 'B1',
        totalHours: 12,
        weeklyHours: 4,
        minLearners: 2,
        maxLearners: 12,
      },
      key(),
    )
    assert.equal(course.statusCode, 201, course.body)
    const courseId = course.json().data.id as string
    const activated = await call(
      'POST',
      `/api/v1/courses/${courseId}/activate`,
      a.cookie,
      {},
      {
        'if-match': '"1"',
      },
    )
    assert.equal(activated.statusCode, 200, activated.body)
    const group = await call(
      'POST',
      '/api/v1/groups',
      a.cookie,
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
    )
    assert.equal(group.statusCode, 201, group.body)
    const groupId = group.json().data.id as string
    const enrollmentId = randomUUID()
    await db.insert(languageGroupMembers).values({
      institutionId: a.id,
      id: enrollmentId,
      groupId,
      studentId: 's1',
      status: 'active',
      joinedAt: FIXED_NOW,
    })
    await insertLessonHourAttendances(
      db,
      a.id,
      { id: enrollmentId, groupId, studentId: 's1' },
      [
        { lessonHourId: 'ders-1', status: 'absent', excused: true },
        { lessonHourId: 'ders-2', status: 'late' },
        { lessonHourId: 'ders-3', status: 'present' },
      ],
      { userId: teacher.id, at: FIXED_NOW },
    )
    const draft = (overrides: {
      outcome: 'passed' | 'repeat'
      correctsDecisionId: string | null
      at: string
    }) => ({
      enrollmentId,
      groupId,
      courseId,
      learnerId: 's1',
      outcome: overrides.outcome,
      status: 'pending' as const,
      rationale: 'Gizli gerekçe metni.',
      correctsDecisionId: overrides.correctsDecisionId,
      decidedByUserId: teacher.id,
      decidedAt: overrides.at,
      reviewedByUserId: null,
      reviewedAt: null,
      rejectionReason: null,
      basis: {
        schemaVersion: 1 as const,
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
        schemaVersion: 2 as const,
        context: 'general' as const,
        computedAt: overrides.at,
        overall: { status: 'insufficient' as const, missingSkills: ['reading' as const] },
        skills: [],
        evidence: [],
      },
    })
    const decision = await insertProgressionDecision(
      db,
      a.id,
      draft({ outcome: 'repeat', correctsDecisionId: null, at: FIXED_NOW.toISOString() }),
    )
    return { teacher, enrollmentId, groupId, courseId, decision, draft }
  }

  test('IST-085 oturumsuz 401: liste, dosya ve işaret', async () => {
    fails(await call('GET', ITEMS, null), 401)
    fails(await call('GET', EXPORT, null), 401)
    fails(await mark(null, 'learner', 's1', 1), 401)
  })

  test('IST-085 yönetici ve ön büro dışı roller 403, işaret yazılmaz', async () => {
    const a = await institution()
    for (const role of ['ogretmen', 'ogrenci', 'veli'] as const) {
      const cookie = await member(a.id, role)
      fails(await call('GET', ITEMS, cookie), 403, 'forbidden')
      fails(await call('GET', EXPORT, cookie), 403, 'forbidden')
      fails(await mark(cookie, 'learner', 's1', 1), 403, 'forbidden')
    }
    assert.deepEqual(await markRows(a.id), [])
  })

  test('IST-085 ön büro listeyi okur ve işaretler', async () => {
    const a = await institution()
    const desk = await member(a.id, 'onburo')
    const { data } = await list(desk, 'kind=learner')
    const row = data.find((item) => item.learnerId === 's1')
    assert.ok(row)
    const marked = await mark(desk, 'learner', row.sourceId, row.version)
    assert.equal(marked.statusCode, 200, marked.body)
  })

  test('ADR 0008: okul kurumunda her rol için 404', async () => {
    const school = await createInstitution(app, { type: 'school' })
    const admin = await signInAs(app, school.admin)
    const teacher = await member(school.id, 'ogretmen')
    for (const cookie of [admin, teacher]) {
      fails(await call('GET', ITEMS, cookie), 404)
      fails(await call('GET', EXPORT, cookie), 404)
      fails(await mark(cookie, 'learner', 's1', 1), 404)
    }
  })

  test('DOM-YTK-040: finance modülü kapalı 403 module_disabled', async () => {
    const a = await institution({ enabledModules: { finance: false } })
    fails(await call('GET', ITEMS, a.cookie), 403, 'module_disabled')
    fails(await call('GET', EXPORT, a.cookie), 403, 'module_disabled')
    fails(await mark(a.cookie, 'learner', 's1', 1), 403, 'module_disabled')
    assert.deepEqual(await markRows(a.id), [])
  })

  test('DOM-YTK-040: academic kapalıyken devamsızlık ve kurs sonu üretilmez, doğrudan istek 403', async () => {
    const a = await institution({ enabledModules: { academic: false } })
    const { data } = await list(a.cookie, 'status=all')
    assert.deepEqual([...new Set(data.map((item) => item.kind))].sort(), ['learner'])
    fails(await call('GET', `${ITEMS}?kind=attendance`, a.cookie), 403, 'module_disabled')
    fails(await call('GET', `${ITEMS}?kind=course_end`, a.cookie), 403, 'module_disabled')
    fails(await mark(a.cookie, 'attendance', 'att-absent', 1), 403, 'module_disabled')
    assert.deepEqual(await markRows(a.id), [])
  })

  test('DOM-YTK-040: crm kapalıyken kimlik satırda boştur, okuma kaydı yazılmaz', async () => {
    const a = await institution({ enabledModules: { crm: false } })
    const { data } = await list(a.cookie, 'kind=learner')
    const row = data.find((item) => item.sourceId === 's1')
    assert.equal(row?.learner?.maskedIdentity, null)
    const reads = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'finance.e_ozel_read')))
    assert.deepEqual(reads, [])
  })

  test('IST-085 başka kurum: B kaydı listede yok, işaret 404 ve B değişmez, gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bPayment = await insertPayment(b.id, { reference: 'B-REF' })
    const bMark = await mark(b.cookie, 'learner', 's1', 1)
    assert.equal(bMark.statusCode, 200, bMark.body)
    const before = await markRows(b.id)

    const { data } = await list(a.cookie, 'status=all&kind=fee')
    assert.deepEqual(data, [])
    const file = await call('GET', `${EXPORT}?status=all&kind=fee`, a.cookie)
    assert.equal(file.statusCode, 200, file.body)
    assert.equal(file.body.includes('B-REF'), false, 'dosyada B kaydı yok')
    fails(await mark(a.cookie, 'fee', bPayment, 1), 404, 'not_found')
    fails(await mark(a.cookie, 'attendance', 'b-yok', 1), 404, 'not_found')
    const missing = await mark(a.cookie, 'fee', randomUUID(), 1)
    const foreign = await mark(a.cookie, 'fee', bPayment, 1)
    assert.equal(missing.json().message, foreign.json().message, 'varlık sızmaz')

    fails(await mark(a.cookie, 'learner', 's1', 1, true, { institutionId: b.id }), 400)
    assert.deepEqual(await markRows(a.id), [])
    assert.deepEqual(await markRows(b.id), before)
    const [paid] = await db.select().from(payments).where(eq(payments.id, bPayment))
    assert.equal(paid?.mebbisRecordedAt, null)
    assert.equal(paid?.version, 1)
  })

  test('IST-085 400: gövde, tür, sürüm ve sorgu hatası kaydı değiştirmez', async () => {
    const a = await institution()
    fails(await mark(a.cookie, 'learner', 's1', 1, 'evet'), 400)
    fails(await mark(a.cookie, 'bilinmeyen', 's1', 1), 400)
    fails(
      await call('POST', `${ITEMS}/learner/s1/record`, a.cookie, { recorded: true }, key()),
      400,
      'if_match_required',
    )
    fails(
      await call(
        'POST',
        `${ITEMS}/learner/s1/record`,
        a.cookie,
        { recorded: true },
        { 'if-match': '"1"' },
      ),
      400,
    )
    fails(await call('GET', `${ITEMS}?kind=bilinmeyen`, a.cookie), 400)
    fails(await call('GET', `${ITEMS}?institutionId=x`, a.cookie), 400)
    fails(await call('GET', `${ITEMS}?pageSize=101`, a.cookie), 400)
    fails(await call('GET', `${ITEMS}?dateFrom=2026-10-02&dateTo=2026-10-01`, a.cookie), 400)
    assert.deepEqual(await markRows(a.id), [])
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'finance.e_ozel_record')))
    assert.deepEqual(audits, [])
  })

  test('IST-085 DOM-KAY-015: varsayılan liste işlenmemişleri sayfalı verir, tam kimlik dönmez', async () => {
    const a = await institution()
    await insertPayment(a.id)
    const response = await list(a.cookie)
    assert.deepEqual(response.data.map((item) => item.kind).sort(), [
      'attendance',
      'fee',
      'learner',
      'learner',
    ])
    assert.equal(response.meta.total, 4)
    assert.equal(JSON.stringify(response).includes(IDENTITY), false)
    const learner = response.data.find((item) => item.sourceId === 's1')
    assert.equal(learner?.learner?.maskedIdentity, '*******0146')
    const cancelled = response.data.find((item) => item.sourceId === 's2')
    assert.equal(cancelled?.learner?.status, 'cancelled')
    assert.equal(cancelled?.recordStatus, 'pending')
    const absent = response.data.find((item) => item.kind === 'attendance')
    assert.equal(absent?.sourceId, 'att-absent', 'yalnız devamsız gün')
    assert.equal(absent?.attendance?.groupName, 'TYT-1')

    const first = await list(a.cookie, 'page=1&pageSize=1')
    assert.equal(first.data.length, 1)
    assert.equal(first.meta.total, 4)
    const second = await list(a.cookie, 'page=2&pageSize=1')
    assert.notEqual(second.data[0]?.sourceId, first.data[0]?.sourceId)
    assert.equal((await list(a.cookie, 'q=ece')).data[0]?.sourceId, 's2')
    assert.equal((await list(a.cookie, 'dateFrom=2026-10-01&dateTo=2026-10-01')).meta.total, 1)
  })

  test('IST-085: işaret kim/ne zaman tutar, geri alınır, mükerrer işaret 409, denetime yalnız alan adı', async () => {
    const a = await institution()
    const created = await mark(a.cookie, 'learner', 's1', 1)
    assert.equal(created.statusCode, 200, created.body)
    assert.deepEqual(created.json().data, {
      kind: 'learner',
      sourceId: 's1',
      version: 2,
      recordedAt: FIXED_NOW.toISOString(),
    })
    const [row] = await markRows(a.id)
    assert.equal(row?.recordedByUserId, a.admin.id)
    assert.equal(row?.recordedAt?.toISOString(), FIXED_NOW.toISOString())

    assert.equal(
      (await list(a.cookie, 'kind=learner')).data.some((i) => i.sourceId === 's1'),
      false,
    )
    const [recorded] = (await list(a.cookie, 'kind=learner&status=recorded')).data
    assert.equal(recorded?.recordedAt, FIXED_NOW.toISOString())
    assert.equal(recorded?.recordedByName, 'Test Yönetici')
    assert.equal(JSON.stringify(recorded).includes(a.admin.id), false)

    fails(await mark(a.cookie, 'learner', 's1', 2), 409, 'e_ozel_already_recorded')
    fails(await mark(a.cookie, 'learner', 's1', 1), 409, 'version_conflict')
    const firstBy = (await markRows(a.id))[0]
    assert.equal(firstBy?.version, 2, 'ret kaydı değiştirmez')

    const undone = await mark(a.cookie, 'learner', 's1', 2, false)
    assert.equal(undone.statusCode, 200, undone.body)
    assert.equal(undone.json().data.recordedAt, null)
    const [cleared] = await markRows(a.id)
    assert.equal(cleared?.recordedAt, null)
    assert.equal(cleared?.recordedByUserId, null)
    assert.equal(cleared?.version, 3)
    assert.equal(
      (await list(a.cookie, 'kind=learner')).data.find((i) => i.sourceId === 's1')?.version,
      3,
      'geri alınan satır yeniden işlenmemiş görünür',
    )
    fails(await mark(a.cookie, 'learner', 's1', 3, false), 409, 'e_ozel_not_recorded')
    fails(await mark(a.cookie, 'learner', 'yok', 1), 404, 'not_found')
    fails(await mark(a.cookie, 'attendance', 'att-present', 1), 404, 'not_found')

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'finance.e_ozel_record')))
    assert.equal(audits.length, 2)
    for (const audit of audits) {
      assert.deepEqual(audit.changes, { fields: ['recordedAt', 'recordedByUserId'] })
      assert.equal(audit.entityId, 'learner:s1')
    }
  })

  /** Kaydın `data` alanını yazar: yoklama ve kursiyer düzeltmesi başka alanın ucundan gelir. */
  async function patchRecord(
    institutionId: string,
    collection: 'attendance' | 'students',
    id: string,
    data: Record<string, unknown>,
  ) {
    const where = and(
      eq(records.institutionId, institutionId),
      eq(records.collection, collection),
      eq(records.id, id),
    )
    const [row] = await db.select({ data: records.data }).from(records).where(where)
    assert.ok(row)
    await db
      .update(records)
      .set({ data: { ...(row.data as object), ...data } })
      .where(where)
  }

  const statusOf = async (cookie: string, kind: string, sourceId: string, status = 'all') =>
    (await list(cookie, `kind=${kind}&status=${status}`)).data.find(
      (item) => item.sourceId === sourceId,
    )

  test('IST-085: işlenmiş kursiyer ayrılınca satır düşmez, düzeltilmeli olur; düzeltme işaretiyle kapanır', async () => {
    const a = await institution()
    const marked = await mark(a.cookie, 'learner', 's1', 1)
    assert.equal(marked.statusCode, 200, marked.body)
    assert.equal((await statusOf(a.cookie, 'learner', 's1'))?.recordStatus, 'recorded')

    await patchRecord(a.id, 'students', 's1', { isActive: false })
    const row = await statusOf(a.cookie, 'learner', 's1', 'needs_correction')
    assert.equal(row?.recordStatus, 'needs_correction')
    assert.equal(row?.learner?.status, 'cancelled')
    assert.equal(row?.sourceRemoved, false)
    assert.equal(
      (await list(a.cookie, 'kind=learner')).data.some((item) => item.sourceId === 's1'),
      true,
      'varsayılan liste düzeltilmeliyi de gösterir',
    )
    assert.equal(await statusOf(a.cookie, 'learner', 's1', 'recorded'), undefined)

    const corrected = await mark(a.cookie, 'learner', 's1', row.version)
    assert.equal(corrected.statusCode, 200, corrected.body)
    assert.equal((await statusOf(a.cookie, 'learner', 's1'))?.recordStatus, 'recorded')
    assert.equal(
      (await markRows(a.id))[0]?.version,
      3,
      'düzeltme aynı satırı günceller, ikinci satır açmaz',
    )
    assert.equal((await markRows(a.id)).length, 1)

    await patchRecord(a.id, 'students', 's1', { name: 'Deniz Kaya' })
    assert.equal(
      (await statusOf(a.cookie, 'learner', 's1'))?.recordStatus,
      'recorded',
      "ad e-Özel'e elle girilmez, düzeltme istemez",
    )
  })

  test('IST-085: arşivlenen işaretli kursiyer düşmez; işaretsiz arşivli kursiyer listeye girmez', async () => {
    const a = await institution()
    await mark(a.cookie, 'learner', 's1', 1)
    await db
      .update(records)
      .set({ archivedAt: FIXED_NOW })
      .where(and(eq(records.institutionId, a.id), eq(records.collection, 'students')))
    const { data } = await list(a.cookie, 'kind=learner&status=all')
    assert.deepEqual(
      data.map((item) => [item.sourceId, item.recordStatus, item.learner?.status]),
      [['s1', 'needs_correction', 'cancelled']],
    )
  })

  test('DOM-FIN-033 DOM-FIN-032: işaretli tahsilat iptal edilince düzeltilmeli kalır, düzeltme kapanır, işaret kaldırılamaz', async () => {
    const a = await institution()
    const paymentId = await insertPayment(a.id)
    const marked = await mark(a.cookie, 'fee', paymentId, 1)
    assert.equal(marked.statusCode, 200, marked.body)
    const [before] = await db.select().from(payments).where(eq(payments.id, paymentId))
    assert.match(before?.mebbisFingerprint ?? '', /^[0-9a-f]{32}$/)

    const reversal = await call(
      'POST',
      `/api/v1/payments/${paymentId}/reverse`,
      a.cookie,
      { reason: 'Yanlış öğrenciye girildi' },
      { 'if-match': '"2"', ...key() },
    )
    assert.equal(reversal.statusCode, 200, reversal.body)

    const row = await statusOf(a.cookie, 'fee', paymentId, 'needs_correction')
    assert.equal(row?.recordStatus, 'needs_correction')
    assert.equal(row?.sourceRemoved, true)
    assert.equal(row?.version, 3)
    assert.equal(JSON.stringify(row).includes('Yanlış öğrenciye'), false, 'iptal gerekçesi dönmez')
    assert.equal(JSON.stringify(row).includes('ingerprint'), false, 'özet istemciye dönmez')

    const file = await call('GET', `${EXPORT}?kind=fee&status=needs_correction`, a.cookie)
    assert.equal(file.statusCode, 200, file.body)
    assert.ok(file.body.includes(`"e-Özel'de düzeltilmeli"`))
    assert.ok(file.body.includes('"Tahsilat iptal edildi"'))

    fails(await mark(a.cookie, 'fee', paymentId, 3, false), 409, 'e_ozel_source_removed')
    const [unchanged] = await db.select().from(payments).where(eq(payments.id, paymentId))
    assert.equal(unchanged?.version, 3, 'ret kaydı değiştirmez')

    const corrected = await mark(a.cookie, 'fee', paymentId, 3)
    assert.equal(corrected.statusCode, 200, corrected.body)
    const closed = await statusOf(a.cookie, 'fee', paymentId)
    assert.equal(closed?.recordStatus, 'recorded')
    assert.equal(closed?.sourceRemoved, true)
    assert.equal((await list(a.cookie, 'kind=fee')).meta.total, 0, 'iş bekleyen kalmadı')
    fails(await mark(a.cookie, 'fee', paymentId, 4, false), 409, 'e_ozel_source_removed')
    fails(await mark(a.cookie, 'fee', paymentId, 4), 409, 'e_ozel_already_recorded')

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'payment.mebbis')))
    assert.equal(audits.length, 2, 'ilk işaret ve düzeltme')
    assert.deepEqual(audits[1]?.changes, { fields: ['mebbisRecordedAt'] })
  })

  test('DOM-FIN-032: MEBBİS ucundan işaretlenen tahsilatın iptali de düzeltilmeli olur', async () => {
    const a = await institution()
    const paymentId = await insertPayment(a.id)
    const marked = await call(
      'POST',
      `/api/v1/payments/${paymentId}/mebbis-record`,
      a.cookie,
      { recorded: true },
      { 'if-match': '"1"', ...key() },
    )
    assert.equal(marked.statusCode, 200, marked.body)
    assert.equal((await statusOf(a.cookie, 'fee', paymentId))?.recordStatus, 'recorded')
    const reversal = await call(
      'POST',
      `/api/v1/payments/${paymentId}/reverse`,
      a.cookie,
      { reason: 'Yanlış tutar girildi' },
      { 'if-match': '"2"', ...key() },
    )
    assert.equal(reversal.statusCode, 200, reversal.body)
    assert.equal((await statusOf(a.cookie, 'fee', paymentId))?.recordStatus, 'needs_correction')
  })

  test('DOM-DIL-060 DOM-DIL-061: yoklama düzeltilince işaretli satır düzeltilmeli kalır; işaretsiz satır düşer', async () => {
    const a = await institution()
    const dayMark = await mark(a.cookie, 'attendance', 'att-absent', 1)
    assert.equal(dayMark.statusCode, 200, dayMark.body)
    const [stored] = await markRows(a.id)
    assert.match(stored?.recordedFingerprint ?? '', /^[0-9a-f]{32}$/)

    await patchRecord(a.id, 'attendance', 'att-absent', { status: 'excused' })
    const excused = await statusOf(a.cookie, 'attendance', 'att-absent', 'needs_correction')
    assert.equal(excused?.sourceRemoved, false)
    assert.equal(excused?.attendance?.excused, true)

    await patchRecord(a.id, 'attendance', 'att-absent', { status: 'present' })
    const removed = await statusOf(a.cookie, 'attendance', 'att-absent', 'needs_correction')
    assert.equal(removed?.sourceRemoved, true)
    assert.equal(removed?.learnerId, 's1')

    const corrected = await mark(a.cookie, 'attendance', 'att-absent', removed?.version ?? 0)
    assert.equal(corrected.statusCode, 200, corrected.body)
    assert.equal((await statusOf(a.cookie, 'attendance', 'att-absent'))?.recordStatus, 'recorded')
    assert.equal(
      (await list(a.cookie, 'kind=attendance')).meta.total,
      0,
      'düzeltmesi yapılmış satır iş beklemez',
    )

    const b = await institution()
    await patchRecord(b.id, 'attendance', 'att-absent', { status: 'present' })
    assert.equal(
      await statusOf(b.cookie, 'attendance', 'att-absent'),
      undefined,
      'işaretsiz düzeltilen yoklama listeye girmez',
    )
  })

  test('DOM-DIL-061: arşivlenen ve durumu değişen ders saati işaretliyse düzeltilmeli kalır', async () => {
    const a = await institution()
    await withCourseEnd(a)
    const hour = (await list(a.cookie, 'kind=attendance')).data.find(
      (item) => item.attendance?.groupName === 'B1 Akşam',
    )
    assert.ok(hour)
    const marked = await mark(a.cookie, 'attendance', hour.sourceId, hour.version)
    assert.equal(marked.statusCode, 200, marked.body)
    assert.equal((await statusOf(a.cookie, 'attendance', hour.sourceId))?.recordStatus, 'recorded')
    await db
      .update(lessonHourAttendances)
      .set({ archivedAt: FIXED_NOW })
      .where(eq(lessonHourAttendances.id, hour.sourceId))
    const row = await statusOf(a.cookie, 'attendance', hour.sourceId, 'needs_correction')
    assert.equal(row?.sourceRemoved, true)
    assert.equal(row?.attendance?.groupName, 'B1 Akşam')
  })

  test('DOM-YTK-052: tam kimlik yönetici ve ön büroya döner; her görüntüleme denetime numarasız yazılır, önbelleğe alınmaz', async () => {
    const a = await institution()
    const desk = await member(a.id, 'onburo')
    const reads = () =>
      db
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'student_identity.read_full')),
        )
    for (const cookie of [a.cookie, desk]) {
      const response = await call('GET', FULL_IDENTITY('s1'), cookie)
      assert.equal(response.statusCode, 200, response.body)
      assert.deepEqual(response.json().data, { identityKind: 'tc', identityNumber: IDENTITY })
      assert.equal(response.headers['cache-control'], 'no-store')
    }
    const audits = await reads()
    assert.equal(audits.length, 2, 'her görüntüleme ayrı satır')
    for (const audit of audits) {
      assert.deepEqual(audit.changes, { fields: ['identityKind', 'identityNumber'] })
      assert.equal(audit.entityType, 'students')
      assert.equal(audit.entityId, 's1')
      assert.equal(JSON.stringify(audit).includes(IDENTITY), false)
    }
  })

  test('DOM-YTK-052: tam kimlik loga yazılmaz; liste ve dosya maskeli kalır', async () => {
    const logs: string[] = []
    const logged = await buildTestApp(db, { logs, clock: () => FIXED_NOW })
    try {
      const a = await institution()
      const response = await call('GET', FULL_IDENTITY('s1'), a.cookie, undefined, {}, logged)
      assert.equal(response.statusCode, 200, response.body)
      assert.equal(logs.join('').includes(IDENTITY), false)
      assert.equal(logs.join('').includes('0146'), false)
      const { data } = await list(a.cookie, 'kind=learner')
      assert.equal(JSON.stringify(data).includes(IDENTITY), false)
      const file = await call('GET', `${EXPORT}?kind=learner`, a.cookie)
      assert.equal(file.body.includes(IDENTITY), false)
    } finally {
      await logged.close()
    }
  })

  test('DOM-YTK-052 oturumsuz 401, diğer roller 403, denetim yazılmaz', async () => {
    const a = await institution()
    fails(await call('GET', FULL_IDENTITY('s1'), null), 401)
    for (const role of ['ogretmen', 'ogrenci', 'veli'] as const)
      fails(await call('GET', FULL_IDENTITY('s1'), await member(a.id, role)), 403, 'forbidden')
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'student_identity.read_full')),
      )
    assert.deepEqual(audits, [])
  })

  test('IST-085 başka kurum: tam kimlik 404, numara ve varlık sızmaz, denetim yazılmaz', async () => {
    const a = await institution()
    const b = await institution()
    await db
      .update(studentIdentities)
      .set({ studentId: 's-b', identityNumber: '20000000000' })
      .where(eq(studentIdentities.institutionId, b.id))
    const foreign = await call('GET', FULL_IDENTITY('s-b'), a.cookie)
    fails(foreign, 404, 'not_found')
    assert.equal(foreign.body.includes('20000000000'), false)
    const missing = await call('GET', FULL_IDENTITY('yok'), a.cookie)
    assert.equal(foreign.json().message, missing.json().message, 'varlık sızmaz')
    fails(await call('GET', FULL_IDENTITY('s2'), a.cookie), 404, 'not_found')
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'student_identity.read_full')),
      )
    assert.deepEqual(audits, [], 'kimliksiz ya da başka kurumun kursiyeri denetim üretmez')
  })

  test('DOM-KAY-011: arşivlenmiş kimlik listede olmadığı gibi tam okunamaz', async () => {
    const a = await institution()
    await db
      .update(studentIdentities)
      .set({ archivedAt: FIXED_NOW })
      .where(eq(studentIdentities.institutionId, a.id))
    fails(await call('GET', FULL_IDENTITY('s1'), a.cookie), 404, 'not_found')
  })

  test('DOM-YTK-040 ADR 0008: crm ya da finance kapalı 403, okulda 404', async () => {
    const noCrm = await institution({ enabledModules: { crm: false } })
    fails(await call('GET', FULL_IDENTITY('s1'), noCrm.cookie), 403, 'module_disabled')
    const noFinance = await institution({ enabledModules: { finance: false } })
    fails(await call('GET', FULL_IDENTITY('s1'), noFinance.cookie), 403, 'module_disabled')
    const school = await createInstitution(app, { type: 'school' })
    fails(await call('GET', FULL_IDENTITY('s1'), await signInAs(app, school.admin)), 404)
  })

  test('guvenlik-kvkk: eski oturumla tam kimlik 403 reauthentication_required, denetim yazılmaz', async () => {
    const a = await institution()
    const later = await buildTestApp(db, {
      clock: () => new Date(Date.now() + 16 * 60 * 1000),
    })
    try {
      fails(
        await call('GET', FULL_IDENTITY('s1'), a.cookie, undefined, {}, later),
        403,
        'reauthentication_required',
      )
      const audits = await db
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'student_identity.read_full')),
        )
      assert.deepEqual(audits, [])
    } finally {
      await later.close()
    }
  })

  test('IST-085: aynı Idempotency-Key aynı yanıtı döner, işaret bir kez yazılır', async () => {
    const a = await institution()
    const headers = { 'if-match': '"1"', ...key() }
    const url = `${ITEMS}/attendance/att-absent/record`
    const first = await call('POST', url, a.cookie, { recorded: true }, headers)
    assert.equal(first.statusCode, 200, first.body)
    const again = await call('POST', url, a.cookie, { recorded: true }, headers)
    assert.equal(again.statusCode, 200, again.body)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.deepEqual(again.json(), first.json())
    assert.equal((await markRows(a.id)).length, 1)
  })

  test('DOM-YTK-040: crm kapalıyken işlenen kursiyer kimlik gizli olsa da işlendi kalır', async () => {
    const a = await institution({ enabledModules: { crm: false } })
    const marked = await mark(a.cookie, 'learner', 's1', 1)
    assert.equal(marked.statusCode, 200, marked.body)
    const row = await statusOf(a.cookie, 'learner', 's1')
    assert.equal(row?.recordStatus, 'recorded')
    assert.equal(row?.learner?.maskedIdentity, null)
  })

  test('DOM-FIN-032: ücret işareti tahsilatın MEBBİS işaretidir, tek kayıt; tablo satırı açılmaz', async () => {
    const a = await institution()
    const paymentId = await insertPayment(a.id)
    const [row] = (await list(a.cookie, 'kind=fee')).data
    assert.equal(row?.sourceId, paymentId)
    assert.equal(row?.fee?.amountCents, 150_000)
    assert.equal(row?.fee?.reference, 'TR-0001')
    assert.equal(row?.version, 1)

    const marked = await mark(a.cookie, 'fee', paymentId, 1)
    assert.equal(marked.statusCode, 200, marked.body)
    assert.equal(marked.json().data.version, 2)
    assert.deepEqual(await markRows(a.id), [])
    const payment = await call('GET', `/api/v1/payments/${paymentId}`, a.cookie)
    assert.equal(payment.json().data.mebbisRecordedAt, FIXED_NOW.toISOString())
    assert.equal((await list(a.cookie, 'kind=fee')).meta.total, 0)
    const [recorded] = (await list(a.cookie, 'kind=fee&status=recorded')).data
    assert.equal(recorded?.recordedByName, 'Test Yönetici')

    const undone = await mark(a.cookie, 'fee', paymentId, 2, false)
    assert.equal(undone.statusCode, 200, undone.body)
    const after = await call('GET', `/api/v1/payments/${paymentId}`, a.cookie)
    assert.equal(after.json().data.mebbisRecordedAt, null)
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'payment.mebbis')))
    assert.equal(audits.length, 2)
    assert.deepEqual(audits[0]?.changes, { fields: ['mebbisRecordedAt'] })

    const reversedId = await insertPayment(a.id, {
      reference: 'TR-0002',
      reversedAt: FIXED_NOW,
      reversedByUserId: 'u',
      reversalReason: 'Yanlış öğrenciye girildi',
    })
    assert.equal(
      (await list(a.cookie, 'kind=fee&status=all')).data.some((i) => i.sourceId === reversedId),
      false,
      'iptal edilen tahsilat listeye girmez',
    )
    fails(await mark(a.cookie, 'fee', reversedId, 1), 404, 'not_found')
  })

  test('DOM-DIL-061 DOM-DIL-070: ders saati ve kur sonu Oğuzhan tablolarından okunur, işaretlenir; karar düzeltilince satır düzeltilmeli olur', async () => {
    const a = await institution()
    const { decision, enrollmentId, teacher, draft } = await withCourseEnd(a)
    // Bekleyen karar listeye girmez.
    assert.equal((await list(a.cookie, 'kind=course_end&status=all')).meta.total, 0)

    const hours = (await list(a.cookie, 'kind=attendance')).data
    const hour = hours.find((item) => item.attendance?.groupName === 'B1 Akşam')
    assert.ok(hour, 'gelmedi satırı')
    assert.equal(hour.attendance?.excused, true)
    assert.equal(
      hours.filter((item) => item.attendance?.groupName === 'B1 Akşam').length,
      1,
      'geç ve katıldı satır üretmez',
    )
    const hourMark = await mark(a.cookie, 'attendance', hour.sourceId, hour.version)
    assert.equal(hourMark.statusCode, 200, hourMark.body)

    const approved = await saveProgressionReview(
      db,
      a.id,
      decision.id,
      decision.rowVersion,
      {
        status: 'approved',
        reviewedByUserId: teacher.id,
        reviewedAt: FIXED_NOW.toISOString(),
        rejectionReason: null,
      },
      FIXED_NOW,
    )
    assert.ok(approved)
    const [row] = (await list(a.cookie, 'kind=course_end')).data
    assert.equal(row?.sourceId, enrollmentId)
    assert.equal(row?.courseEnd?.outcome, 'repeat')
    assert.equal(JSON.stringify(row).includes('Gizli gerekçe'), false, 'gerekçe dönmez')
    const endMark = await mark(a.cookie, 'course_end', enrollmentId, 1)
    assert.equal(endMark.statusCode, 200, endMark.body)

    // Düzeltme onaylanınca geçerli karar değişir: aynı satır düzeltilmeli olur, ikinci satır açılmaz.
    const later = new Date(FIXED_NOW.getTime() + 60_000).toISOString()
    const correction = await insertProgressionDecision(db, a.id, {
      ...draft({ outcome: 'passed', correctsDecisionId: decision.id, at: later }),
      status: 'approved',
      reviewedByUserId: teacher.id,
      reviewedAt: later,
    })
    const pending = (await list(a.cookie, 'kind=course_end')).data
    assert.ok(correction.id)
    assert.deepEqual(
      pending.map((item) => item.sourceId),
      [enrollmentId],
    )
    assert.equal(pending[0]?.courseEnd?.outcome, 'passed')
    assert.equal(pending[0]?.recordStatus, 'needs_correction')
    assert.equal(pending[0]?.sourceRemoved, false)
    fails(await mark(a.cookie, 'course_end', decision.id, 2, false), 404, 'not_found')
    const corrected = await mark(a.cookie, 'course_end', enrollmentId, 2)
    assert.equal(corrected.statusCode, 200, corrected.body)
    assert.equal(
      (await list(a.cookie, 'kind=course_end&status=recorded')).data[0]?.courseEnd?.outcome,
      'passed',
    )
  })

  test('DOM-YTK-052: kimlik içeren sayfa ve dosya denetime alan adıyla yazılır, numara ve arama metni yazılmaz', async () => {
    const a = await institution()
    await insertPayment(a.id)
    const reads = () =>
      db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'finance.e_ozel_read')))
    await list(a.cookie, 'kind=fee')
    assert.equal((await reads()).length, 0, 'kimliksiz sayfa okuma kaydı üretmez')
    await list(a.cookie, 'kind=learner&q=deniz')
    const [read] = await reads()
    assert.deepEqual(read?.changes, { fields: ['maskedIdentity', 'birthDate'] })
    assert.equal(read?.entityId, 'learner:pending')
    assert.equal(JSON.stringify(read).includes(IDENTITY), false)
    assert.equal(JSON.stringify(read).includes('deniz'), false)

    const file = await call('GET', `${EXPORT}?status=all`, a.cookie)
    assert.equal(file.statusCode, 200, file.body)
    assert.match(String(file.headers['content-type']), /text\/csv/)
    assert.ok(file.body.startsWith('﻿'))
    assert.equal(file.body.includes(IDENTITY), false)
    assert.ok(file.body.includes('*******0146'))
    const exports = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'finance.e_ozel_export')))
    assert.equal(exports.length, 1)
    assert.deepEqual(exports[0]?.changes, { fields: [] })
    assert.equal(exports[0]?.entityId, 'all:all')
  })

  test('IST-085: CSV formül kaçışlıdır ve süzgece uyar', async () => {
    const a = await institution()
    await insertMissingRecords(
      db,
      a.id,
      [{ collection: 'students', id: 's3', data: { id: 's3', name: '=KOMUT()', classId: 'c1' } }],
      FIXED_NOW,
    )
    const file = await call('GET', `${EXPORT}?kind=learner&q=komut`, a.cookie)
    assert.equal(file.statusCode, 200, file.body)
    assert.ok(file.body.includes(`"'=KOMUT()"`))
    assert.equal(file.body.trim().split('\r\n').length, 2, 'başlık ve tek satır')
    fails(await call('GET', `${EXPORT}?page=1`, a.cookie), 400)
  })

  test('guvenlik-kvkk: eski oturumla dosya 403 reauthentication_required; liste açık', async () => {
    const a = await institution()
    const later = await buildTestApp(db, {
      clock: () => new Date(Date.now() + 16 * 60 * 1000),
    })
    try {
      fails(
        await call('GET', EXPORT, a.cookie, undefined, {}, later),
        403,
        'reauthentication_required',
      )
      assert.equal((await call('GET', ITEMS, a.cookie, undefined, {}, later)).statusCode, 200)
    } finally {
      await later.close()
    }
  })
})
