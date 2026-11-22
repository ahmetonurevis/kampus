import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  teacherFeedbackParticipations,
  teacherFeedbackResponses,
  teacherFeedbackSurveys,
} from '../src/db/schema/finance-teacher-feedback.ts'
import { ensureGuardianLinks } from '../src/db/student-guardians.ts'
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
 * Öğretmen geri bildirim anketi uçları (DOM-FIN-159; ON-213; K-532…K-534). Her test kendi
 * kurumunu kurar; saat test içinde ilerletilir. FIXED_NOW 2026-10-06 (Europe/Istanbul aynı gün).
 *
 * Kurum: 9-A (sınıf öğretmeni t-1, derse giren t-2; öğrenciler s-1…s-6), 9-B (sınıf öğretmeni t-3,
 * derse giren t-2; öğrenci s-7). Veli kaydı p-1, s-1 ve s-7'nin velayetli velisidir.
 */

const SURVEYS = '/api/v1/finance/teacher-feedback-surveys'
const RESULTS = '/api/v1/finance/teacher-feedback-results'
const QUESTIONS = [
  { kind: 'likert', text: 'Dersi anlaşılır anlatıyor', required: true },
  { kind: 'open', text: 'Eklemek istedikleriniz', required: false },
]
const SECRET = 'Gizli-geri-bildirim'
const DAY = 86_400_000
const answers = (teacherId: string, value: number, text?: string) => ({
  teacherId,
  answers: [{ value }, text === undefined ? {} : { text }],
})

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-159: öğretmen geri bildirim anketi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let now = FIXED_NOW
  let tenantCount = 0
  let clientIp = '10.213.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
  })
  beforeEach(() => {
    now = FIXED_NOW
  })
  const advance = (days: number) => {
    now = new Date(FIXED_NOW.getTime() + days * DAY)
  }

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string | null,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const key = () => ({ 'idempotency-key': randomUUID() })
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.213.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const student = (id: string, classId: string) => ({
      collection: 'students' as const,
      id,
      data: { id, name: `Öğrenci ${id}`, classId, isActive: true, parentId: 'p-1' },
    })
    await insertMissingRecords(
      db,
      created.id,
      [
        ...[
          ['t-1', 'Selin Kaya', 'mat'],
          ['t-2', 'Can Demir', 'fen'],
          ['t-3', 'Ayla Er', 'tr'],
        ].map(([id, name, subjectId]) => ({
          collection: 'teachers' as const,
          id: String(id),
          data: { id, name, subjectId, branchId: 'b-1' },
        })),
        {
          collection: 'classes' as const,
          id: '9-A',
          data: {
            id: '9-A',
            name: '9-A',
            grade: 9,
            level: 'lise',
            branchId: 'b-1',
            teacherId: 't-1',
          },
        },
        {
          collection: 'classes' as const,
          id: '9-B',
          data: {
            id: '9-B',
            name: '9-B',
            grade: 9,
            level: 'lise',
            branchId: 'b-1',
            teacherId: 't-3',
          },
        },
        {
          collection: 'assignments' as const,
          id: 'as-1',
          data: { id: 'as-1', classId: '9-A', teacherId: 't-2', subjectId: 'fen' },
        },
        {
          collection: 'assignments' as const,
          id: 'as-2',
          data: { id: 'as-2', classId: '9-B', teacherId: 't-2', subjectId: 'fen' },
        },
        {
          collection: 'parents' as const,
          id: 'p-1',
          data: { id: 'p-1', name: 'Ayşe Yılmaz', phone: '0532 111 22 13' },
        },
        ...['s-1', 's-2', 's-3', 's-4', 's-5', 's-6'].map((id) => student(id, '9-A')),
        student('s-7', '9-B'),
      ],
      FIXED_NOW,
    )
    const admin = await signInAs(app, created.admin)
    return { id: created.id, admin }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  async function member(
    t: Tenant,
    role: Role,
    links: { kind: 'student' | 'child' | 'teacher'; recordId: string }[] = [],
  ) {
    const user = await createMember(app, t.id, role, links)
    return { membershipId: user.membershipId, cookie: await signInAs(app, user) }
  }
  const studentOf = (t: Tenant, recordId: string) =>
    member(t, 'ogrenci', [{ kind: 'student', recordId }])
  const teacherOf = (t: Tenant, recordId: string) =>
    member(t, 'ogretmen', [{ kind: 'teacher', recordId }])
  async function parentOf(t: Tenant) {
    const parent = await member(t, 'veli', [
      { kind: 'child', recordId: 's-1' },
      { kind: 'child', recordId: 's-7' },
    ])
    await ensureGuardianLinks(
      db,
      t.id,
      ['s-1', 's-7'].map((studentId) => ({
        id: randomUUID(),
        studentId,
        parentId: 'p-1',
        membershipId: parent.membershipId,
        relationship: 'mother' as const,
        custody: 'full' as const,
        contactRestricted: false,
        isPayer: true,
        canPickUp: true,
      })),
    )
    return parent
  }

  const surveyBody = (overrides: Json = {}) => ({
    title: 'Güz öğretmen geri bildirimi',
    term: '2026–2027 1. dönem',
    openDate: '2026-10-06',
    closeDate: '2026-10-10',
    audience: { respondents: ['ogrenci', 'veli'], classIds: [] },
    questions: QUESTIONS,
    ...overrides,
  })
  const create = (
    cookie: string | null,
    body: unknown = surveyBody(),
    headers: Record<string, string> = key(),
  ) => call('POST', SURVEYS, cookie, body, headers)
  const detail = (cookie: string | null, s: Json) =>
    call('GET', `${SURVEYS}/${String(s.id)}`, cookie)
  const list = (cookie: string | null, query = '') => call('GET', `${SURVEYS}${query}`, cookie)
  const patch = (cookie: string | null, s: Json, body: unknown) =>
    call('PATCH', `${SURVEYS}/${String(s.id)}`, cookie, body, ifMatch(s.version))
  const publish = (cookie: string | null, s: Json) =>
    call('POST', `${SURVEYS}/${String(s.id)}/publish`, cookie, undefined, ifMatch(s.version))
  const closeSurvey = (cookie: string | null, s: Json) =>
    call('POST', `${SURVEYS}/${String(s.id)}/close`, cookie, undefined, ifMatch(s.version))
  const archive = (cookie: string | null, s: Json) =>
    call('DELETE', `${SURVEYS}/${String(s.id)}`, cookie, undefined, ifMatch(s.version))
  const results = (cookie: string | null, s: Json) =>
    call('GET', `${SURVEYS}/${String(s.id)}/results`, cookie)
  const respond = (
    cookie: string | null,
    s: Json,
    body: unknown,
    headers: Record<string, string> = key(),
  ) => call('POST', `${SURVEYS}/${String(s.id)}/responses`, cookie, body, headers)
  const assigned = (cookie: string | null) => call('GET', `${SURVEYS}/assigned`, cookie)
  const mine = (cookie: string | null) => call('GET', `${RESULTS}/mine`, cookie)
  const trend = (cookie: string | null, teacherId: string) =>
    call('GET', `${RESULTS}/trend?teacherId=${teacherId}`, cookie)

  async function published(t: Tenant, body: Json = {}) {
    const draft = ok(await create(t.admin, surveyBody(body)), 201)
    return ok(await publish(t.admin, draft))
  }
  const surveyRow = async (id: unknown) =>
    (
      await db
        .select()
        .from(teacherFeedbackSurveys)
        .where(eq(teacherFeedbackSurveys.id, String(id)))
    )[0]
  const responseRows = (surveyId: unknown) =>
    db
      .select()
      .from(teacherFeedbackResponses)
      .where(eq(teacherFeedbackResponses.surveyId, String(surveyId)))

  test('DOM-FIN-159: kimliksiz 401; rol dışı 403 (yönetim, yanıt, kendi sonucu ve eğilim)', async () => {
    const t = await institution()
    const [student, teacher] = await Promise.all([studentOf(t, 's-1'), teacherOf(t, 't-1')])
    const s = await published(t)
    assertError(await list(null), 401)
    assertError(await assigned(null), 401)
    assertError(await respond(null, s, answers('t-1', 4)), 401)
    assertError(await mine(null), 401)
    assertError(await list(teacher.cookie), 403, 'forbidden')
    assertError(await create(student.cookie), 403, 'forbidden')
    assertError(await results(teacher.cookie, s), 403, 'forbidden')
    assertError(await closeSurvey(student.cookie, s), 403, 'forbidden')
    assertError(await trend(teacher.cookie, 't-1'), 403, 'forbidden')
    assertError(await assigned(teacher.cookie), 403, 'forbidden')
    assertError(await respond(t.admin, s, answers('t-1', 4)), 403, 'forbidden')
    assertError(await mine(student.cookie), 403, 'forbidden')
    assertError(await mine(t.admin), 403, 'forbidden')
  })

  test('DOM-FIN-159: finance modülü kapalıyken uçlar 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    const student = await studentOf(closed, 's-1')
    assertError(await list(closed.admin), 403, 'module_disabled')
    assertError(await create(closed.admin), 403, 'module_disabled')
    assertError(await assigned(student.cookie), 403, 'module_disabled')
  })

  test('DOM-FIN-159: taslak açılır, eşik verilmezse 5; Idempotency-Key tekrarı ikinci taslak açmaz (K-532)', async () => {
    const t = await institution()
    const headers = key()
    const draft = ok(await create(t.admin, surveyBody(), headers), 201)
    assert.equal(draft.status, 'draft')
    assert.equal(draft.phase, 'draft')
    assert.equal(draft.anonymityThreshold, 5)
    assert.equal(draft.participation, null)
    const replay = await create(t.admin, surveyBody(), headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    const rows = await db
      .select()
      .from(teacherFeedbackSurveys)
      .where(eq(teacherFeedbackSurveys.institutionId, t.id))
    assert.equal(rows.length, 1)
    assertError(await create(t.admin, surveyBody(), {}), 400, 'idempotency_key_required')
    const strict = ok(await create(t.admin, surveyBody({ anonymityThreshold: 8 })), 201)
    assert.equal(strict.anonymityThreshold, 8)
    const view = ok(
      await detail(
        t.admin,
        ok(
          await create(
            t.admin,
            surveyBody({ audience: { respondents: ['veli'], classIds: ['9-B'] } }),
          ),
          201,
        ),
      ),
    )
    assert.deepEqual(view.audienceClasses, [{ id: '9-B', name: '9-B' }])
    const audit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, 'finance.teacher_feedback.create'),
          eq(auditLog.entityId, String(draft.id)),
        ),
      )
    assert.equal(audit.length, 1)
  })

  test('DOM-FIN-159: geçersiz taslak 400/422 ve hiçbir satır yazılmaz; eşik 5 altına inmez (K-532)', async () => {
    const t = await institution()
    assertError(await create(t.admin, surveyBody({ anonymityThreshold: 4 })), 400)
    assertError(await create(t.admin, surveyBody({ closeDate: '2026-10-01' })), 400)
    assertError(
      await create(t.admin, surveyBody({ audience: { respondents: ['ogretmen'], classIds: [] } })),
      400,
    )
    assertError(await create(t.admin, surveyBody({ questions: [QUESTIONS[1]] })), 400)
    assertError(
      await create(t.admin, surveyBody({ audience: { respondents: ['veli'], classIds: ['9-Z'] } })),
      422,
      'teacher_feedback_class_not_found',
    )
    assertError(await create(t.admin, { ...surveyBody(), institutionId: 'x' }), 400)
    const rows = await db
      .select()
      .from(teacherFeedbackSurveys)
      .where(eq(teacherFeedbackSurveys.institutionId, t.id))
    assert.equal(rows.length, 0)
  })

  test('DOM-FIN-159: taslak düzeltilir; yayımdan sonra değişmez, erken kapatılır ve bir kez (K-532)', async () => {
    const t = await institution()
    const draft = ok(await create(t.admin), 201)
    assertError(
      await call('PATCH', `${SURVEYS}/${String(draft.id)}`, t.admin, { term: 'Bahar' }),
      400,
      'if_match_required',
    )
    const edited = ok(await patch(t.admin, draft, { term: 'Bahar dönemi' }))
    assert.equal(edited.term, 'Bahar dönemi')
    assertError(await patch(t.admin, draft, { term: 'Eski' }), 409)
    assertError(
      await patch(t.admin, edited, { closeDate: '2026-10-01' }),
      422,
      'teacher_feedback_dates_invalid',
    )
    assertError(await closeSurvey(t.admin, edited), 409, 'teacher_feedback_close_draft')

    const live = ok(await publish(t.admin, edited))
    assert.equal(live.phase, 'open')
    assert.deepEqual(live.participation, { responses: 0, respondents: 0 })
    assertError(await patch(t.admin, live, { term: 'Değişti' }), 409, 'teacher_feedback_not_draft')
    assertError(await archive(t.admin, live), 409, 'teacher_feedback_not_draft')
    await assert.rejects(
      db.execute(
        sql`update teacher_feedback_surveys set title = 'Elle' where id = ${String(live.id)}`,
      ),
    )
    const closed = ok(await closeSurvey(t.admin, live))
    assert.equal(closed.phase, 'closed')
    assert.ok(typeof closed.closedAt === 'string')
    assertError(await closeSurvey(t.admin, closed), 409, 'teacher_feedback_already_closed')
    // Kapatma da bir kez: veritabanı tetikleyicisi ikinciyi reddeder.
    await assert.rejects(
      db.execute(
        sql`update teacher_feedback_surveys set closed_at = now() where id = ${String(live.id)}`,
      ),
    )
    assert.equal((await surveyRow(live.id))?.term, 'Bahar dönemi')
    const removable = ok(await create(t.admin), 201)
    ok(await archive(t.admin, removable))
    assertError(await detail(t.admin, removable), 404)
    const rows = ok(await list(t.admin, '?phase=closed')) as unknown as Json[]
    assert.deepEqual(
      rows.map((row) => row.id),
      [live.id],
    )
    assertError(await list(t.admin, '?durum=x'), 400)
  })

  test('DOM-FIN-159: öğrenci kendi sınıfının, veli çocuklarının öğretmenlerini görür ve her birini bir kez değerlendirir (K-533)', async () => {
    const t = await institution()
    const [student, parent] = await Promise.all([studentOf(t, 's-1'), parentOf(t)])
    const s = await published(t)
    const forStudent = ok(await assigned(student.cookie)) as unknown as Json[]
    assert.equal(forStudent.length, 1)
    assert.deepEqual(
      (forStudent[0]?.teachers as Json[]).map((row) => [row.teacherId, row.responded]),
      [
        ['t-2', false],
        ['t-1', false],
      ],
    )
    const forParent = ok(await assigned(parent.cookie)) as unknown as Json[]
    assert.deepEqual((forParent[0]?.teachers as Json[]).map((row) => row.teacherId).sort(), [
      't-1',
      't-2',
      't-3',
    ])

    now = new Date(FIXED_NOW.getTime() + 3 * 3_600_000)
    const headers = key()
    const first = await respond(student.cookie, s, answers('t-1', 5, SECRET), headers)
    assert.deepEqual(ok(first, 201), { surveyId: s.id, teacherId: 't-1', responded: true })
    assert.ok(!first.body.includes(SECRET))
    const replay = await respond(student.cookie, s, answers('t-1', 1), headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(
      await respond(student.cookie, s, answers('t-2', 4), headers),
      422,
      'idempotency_key_reused',
    )
    assertError(
      await respond(student.cookie, s, answers('t-1', 2)),
      409,
      'teacher_feedback_already_responded',
    )
    assertError(
      await respond(student.cookie, s, answers('t-3', 4)),
      422,
      'teacher_feedback_teacher_not_eligible',
    )
    ok(await respond(student.cookie, s, answers('t-2', 4)), 201)
    // Velinin değerlendirmesi öğrencininkinden ayrıdır; 9-B öğretmeni yalnız velide.
    ok(await respond(parent.cookie, s, answers('t-3', 3)), 201)

    const rows = await responseRows(s.id)
    assert.equal(rows.length, 3)
    const survey = await surveyRow(s.id)
    for (const row of rows) {
      assert.ok(!('membershipId' in row) && !('role' in row))
      assert.ok(!JSON.stringify(row).includes(student.membershipId))
      assert.equal(row.createdAt.toISOString(), survey?.publishedAt?.toISOString())
    }
    assert.deepEqual(rows.map((row) => [row.teacherId, row.classId]).sort(), [
      ['t-1', '9-A'],
      ['t-2', '9-A'],
      ['t-3', '9-B'],
    ])
    const participations = await db
      .select()
      .from(teacherFeedbackParticipations)
      .where(eq(teacherFeedbackParticipations.surveyId, String(s.id)))
    assert.equal(participations.length, 3)
    assert.ok(
      participations.every(
        (row) => row.createdAt.toISOString() === survey?.publishedAt?.toISOString(),
      ),
    )
    await assert.rejects(
      db.execute(
        sql`update teacher_feedback_responses set class_id = '9-B' where survey_id = ${String(s.id)}`,
      ),
    )
    await assert.rejects(
      db.execute(
        sql`delete from teacher_feedback_participations where survey_id = ${String(s.id)}`,
      ),
    )
    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'finance.teacher_feedback.respond'))
    assert.ok(
      audit.every((entry) => JSON.stringify(entry.changes) === '{"fields":["participation"]}'),
    )
    assert.ok(!JSON.stringify(audit).includes(SECRET))
    const keys = await db.execute(
      sql`select response_body from idempotency_keys where key = ${headers['idempotency-key']}`,
    )
    assert.ok(!JSON.stringify(keys).includes(SECRET))
    const after = ok(await assigned(student.cookie)) as unknown as Json[]
    assert.ok((after[0]?.teachers as Json[]).every((row) => row.responded === true))
    assert.deepEqual(ok(await detail(t.admin, s)).participation, { responses: 3, respondents: 2 })
  })

  test('DOM-FIN-159: hedef kitle rol ve sınıf süzgeci; yanıt doğrulaması kaydı değiştirmez (K-533)', async () => {
    const t = await institution()
    const [student, parent] = await Promise.all([studentOf(t, 's-1'), parentOf(t)])
    const parentsOnly = await published(t, {
      title: 'Veli anketi',
      audience: { respondents: ['veli'], classIds: ['9-B'] },
    })
    assert.deepEqual(ok(await assigned(student.cookie)), [])
    assertError(await respond(student.cookie, parentsOnly, answers('t-1', 4)), 404)
    const forParent = ok(await assigned(parent.cookie)) as unknown as Json[]
    assert.deepEqual((forParent[0]?.teachers as Json[]).map((row) => row.teacherId).sort(), [
      't-2',
      't-3',
    ])
    assertError(
      await respond(parent.cookie, parentsOnly, answers('t-1', 4)),
      422,
      'teacher_feedback_teacher_not_eligible',
    )
    assertError(
      await respond(parent.cookie, parentsOnly, { teacherId: 't-3', answers: [{ value: 4 }] }),
      422,
      'teacher_feedback_answers_mismatch',
    )
    assertError(
      await respond(parent.cookie, parentsOnly, answers('t-3', 6)),
      422,
      'teacher_feedback_answer_range',
    )
    assertError(
      await respond(parent.cookie, parentsOnly, { teacherId: 't-3', answers: [{}, {}] }),
      422,
      'teacher_feedback_incomplete',
    )
    assertError(
      await respond(parent.cookie, parentsOnly, { ...answers('t-3', 4), membershipId: 'x' }),
      400,
    )
    assertError(
      await respond(parent.cookie, parentsOnly, answers('t-3', 4), {}),
      400,
      'idempotency_key_required',
    )
    assert.equal((await responseRows(parentsOnly.id)).length, 0)
    const none = await db
      .select()
      .from(teacherFeedbackParticipations)
      .where(eq(teacherFeedbackParticipations.surveyId, String(parentsOnly.id)))
    assert.equal(none.length, 0)
  })

  test('DOM-FIN-159: açılmadan, kapanış gününden sonra ve erken kapatınca yanıt alınmaz', async () => {
    const t = await institution()
    const student = await studentOf(t, 's-1')
    const later = await published(t, { openDate: '2026-10-08', closeDate: '2026-10-12' })
    assert.equal(later.phase, 'scheduled')
    assertError(
      await respond(student.cookie, later, answers('t-1', 4)),
      422,
      'teacher_feedback_not_open',
    )
    const s = await published(t)
    const closed = ok(await closeSurvey(t.admin, s))
    assertError(
      await respond(student.cookie, closed, answers('t-1', 4)),
      422,
      'teacher_feedback_closed',
    )
    const other = await published(t, { title: 'Üçüncü anket' })
    advance(5)
    assertError(
      await respond(student.cookie, other, answers('t-1', 4)),
      422,
      'teacher_feedback_closed',
    )
    const open = ok(await assigned(student.cookie)) as unknown as Json[]
    assert.deepEqual(
      open.map((row) => row.id),
      [later.id],
    )
  })

  test('DOM-FIN-159: sonuç öğretmen başına; kapanmadan ve 5 yanıt altında gizli, yorum eşik altında dönmez (K-532)', async () => {
    const t = await institution()
    const students = await Promise.all(
      ['s-1', 's-2', 's-3', 's-4', 's-5'].map((id) => studentOf(t, id)),
    )
    const [selin, can] = await Promise.all([teacherOf(t, 't-1'), teacherOf(t, 't-2')])
    const s = await published(t)
    for (const [index, student] of students.entries()) {
      ok(
        await respond(
          student.cookie,
          s,
          answers('t-1', 5 - (index % 2), `${SECRET}-${String(index)}`),
        ),
        201,
      )
      if (index < 2) ok(await respond(student.cookie, s, answers('t-2', 2, `${SECRET}-az`)), 201)
    }
    const open = ok(await results(t.admin, s))
    assert.equal(open.responses, 7)
    assert.equal(open.respondents, 5)
    const openTeachers = open.teachers as Json[]
    assert.ok(
      openTeachers.every((row) => row.visible === false && row.hiddenReason === 'not_closed'),
    )
    assert.ok(!JSON.stringify(open).includes(SECRET))

    advance(5)
    const result = ok(await results(t.admin, s))
    const [canResult, selinResult] = result.teachers as Json[]
    assert.equal(canResult?.teacherName, 'Can Demir')
    assert.equal(canResult?.responses, 2)
    assert.equal(canResult?.hiddenReason, 'below_threshold')
    assert.ok(!JSON.stringify(canResult).includes(SECRET))
    assert.equal(selinResult?.teacherName, 'Selin Kaya')
    assert.equal(selinResult?.visible, true)
    assert.equal(selinResult?.average, 4.6)
    const [scale, comments] = selinResult?.questions as Json[]
    assert.deepEqual(scale?.distribution, [0, 0, 0, 2, 3])
    assert.equal((comments?.texts as string[]).length, 5)
    assert.ok(!JSON.stringify(result).includes('At"'))
    const reads = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, 'finance.teacher_feedback_result.read'),
          eq(auditLog.entityId, String(s.id)),
        ),
      )
    assert.equal(reads.length, 2)
    assert.deepEqual(reads.map((entry) => JSON.stringify(entry.changes)).sort(), [
      '{"fields":["aggregate","openTexts"]}',
      '{"fields":[]}',
    ])

    // Öğretmen yalnız kendi sonucunu görür.
    const own = ok(await mine(selin.cookie))
    assert.equal(own.teacherId, 't-1')
    const [ownSurvey] = own.surveys as Json[]
    assert.equal(ownSurvey?.surveyId, s.id)
    assert.equal(ownSurvey?.visible, true)
    assert.ok(!JSON.stringify(own).includes('t-2'))
    assert.deepEqual(
      (own.trend as Json[]).map((point) => [point.surveyId, point.average]),
      [[s.id, 4.6]],
    )
    const canOwn = ok(await mine(can.cookie))
    assert.equal((canOwn.surveys as Json[])[0]?.hiddenReason, 'below_threshold')
    assert.ok(!JSON.stringify(canOwn).includes(SECRET))
    assert.deepEqual((canOwn.trend as Json[])[0]?.average, null)
    const unlinked = await member(t, 'ogretmen')
    assert.deepEqual(ok(await mine(unlinked.cookie)), { teacherId: null, surveys: [], trend: [] })

    const adminTrend = ok(await trend(t.admin, 't-1'))
    assert.equal(adminTrend.teacherName, 'Selin Kaya')
    assert.equal((adminTrend.trend as Json[]).length, 1)
    assertError(await trend(t.admin, 't-9'), 404)
    assertError(await call('GET', `${RESULTS}/trend`, t.admin), 400)
  })

  test('DOM-FIN-159: başka kurumun anketi 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const [aStudent, aTeacher] = await Promise.all([studentOf(a, 's-1'), teacherOf(a, 't-1')])
    const b = await institution()
    const bStudent = await studentOf(b, 's-1')
    const bDraft = ok(await create(b.admin), 201)
    const bLive = await published(b, { title: 'B kurumu anketi' })
    // B'de t-1 kapanmış ankette yanıt aldı; A'daki aynı kimlikli öğretmen kaydı onu görmez.
    const bClosed = await published(b, { title: 'B kapanan anket' })
    ok(await respond(bStudent.cookie, bClosed, answers('t-1', 5, SECRET)), 201)
    ok(await closeSurvey(b.admin, bClosed))
    const before = await surveyRow(bDraft.id)
    assertError(await detail(a.admin, bDraft), 404)
    assertError(await patch(a.admin, bDraft, { term: 'Ele geçirildi' }), 404)
    assertError(await publish(a.admin, bDraft), 404)
    assertError(await archive(a.admin, bDraft), 404)
    assertError(await closeSurvey(a.admin, bLive), 404)
    assertError(await results(a.admin, bLive), 404)
    assertError(await respond(aStudent.cookie, bLive, answers('t-1', 4)), 404)
    assert.deepEqual(await surveyRow(bDraft.id), before)
    assert.equal((await surveyRow(bLive.id))?.closedAt, null)
    assert.equal((await responseRows(bLive.id)).length, 0)
    assert.equal((ok(await list(a.admin)) as unknown as Json[]).length, 0)
    assert.deepEqual(ok(await assigned(aStudent.cookie)), [])
    assert.deepEqual(ok(await mine(aTeacher.cookie)), { teacherId: 't-1', surveys: [], trend: [] })
    assert.deepEqual((ok(await trend(a.admin, 't-1')) as Json).trend, [])
    assertError(await create(a.admin, { ...surveyBody(), institutionId: b.id }), 400)
    const bRows = await db
      .select()
      .from(teacherFeedbackSurveys)
      .where(eq(teacherFeedbackSurveys.institutionId, b.id))
    assert.equal(bRows.length, 3)
  })
})
