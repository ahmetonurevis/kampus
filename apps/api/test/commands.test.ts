import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, asc, eq } from 'drizzle-orm'

import { createSeed, type State } from '@kampus/school-core/data/seed.ts'
import { runAssessment } from '@kampus/school-core/lib/assessment-automation.ts'
import type { WorkflowCommand } from '@kampus/school-core/lib/school-workflows.ts'
import { MODULE_KEYS, moduleAvailableFor } from '@kampus/school-core/modules/collection-modules.ts'
import { WORKFLOW_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { records } from '../src/db/schema/records.ts'
import { ASSESSMENT_ROUTES } from '../src/routes/assessment.schemas.ts'
import { WORKFLOW_ROUTES } from '../src/routes/workflows.schemas.ts'
import type { MembershipLinkInput } from '../src/services/identity.ts'
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
 * Yazma uçları (api-tasarimi.md §1, §6, §7): iş akışı köprüsü, ödeme, sınıf yoklaması,
 * kampüs/sınıf/kadro arşivi ve etüt işlemleri. Her test kendi kurumunu örnek veri kesitiyle
 * kurar; başarısızlıkta kaydın değişmediği satır sürümüyle doğrulanır.
 */

const DAY = '2026-10-06'
/** Etüt planındaki ilk etüdün ertesi: yoklama artık geçmiş etüde alınır. */
const AFTER_TUTORING = new Date('2026-10-21T10:00:00.000Z')

/** Optik değerlendirmesi yapılmış örnek veri: etüt planı eksik kazanımlardan çıkar. */
function evaluatedSeed(): State {
  const state = createSeed(FIXED_NOW)
  let serial = 0
  runAssessment(
    state,
    { role: 'yonetici' },
    'evaluate',
    { profileId: 'optical-exam-7-1', text: 'student;booklet;answers\n2026001;A;BBBDABCDABCD' },
    (prefix) => `${prefix}-test-${++serial}`,
    '',
    FIXED_NOW.toISOString(),
  )
  return state
}

const SEED = evaluatedSeed()
const CLASS_IDS = ['c1', 'c2', 'c3']
const classStudents = (classId: string) =>
  SEED.students.filter((item) => item.classId === classId && item.isActive)
/** c3 ile aynı düzeydeki sınıf: arşivde öğrencilerin aktarıldığı hedef (öğrencileri kesitte yok). */
const SAME_LEVEL = SEED.classes.find(
  (item) => item.id !== 'c3' && item.level === SEED.classes.find((c) => c.id === 'c3')?.level,
)
if (!SAME_LEVEL) throw new Error('örnek veride c3 ile aynı düzeyde sınıf yok')
const SAMPLE_STUDENT_IDS = new Set(
  SEED.students.filter((item) => CLASS_IDS.includes(item.classId)).map((item) => item.id),
)

/** Kurumun örnek kesiti: üç sınıf ve öğrencileri, kadro, bağlı kayıtlar. */
const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  subjects: SEED.subjects,
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => [...CLASS_IDS, SAME_LEVEL.id].includes(item.id)),
  students: SEED.students.filter((item) => SAMPLE_STUDENT_IDS.has(item.id)),
  parents: SEED.parents.filter((item) => item.id === 'p1'),
  assignments: SEED.assignments.filter((item) => CLASS_IDS.includes(item.classId)),
  schedule: SEED.schedule.filter((item) => CLASS_IDS.includes(item.classId)),
  availability: SEED.availability,
  invoices: SEED.invoices.filter((item) => SAMPLE_STUDENT_IDS.has(item.studentId)),
  mockExams: SEED.mockExams,
  mockResults: SEED.mockResults,
  opticalProfiles: SEED.opticalProfiles,
  opticalEvaluations: SEED.opticalEvaluations,
  studentGoals: SEED.studentGoals,
  guidanceCases: SEED.guidanceCases,
  appointments: SEED.appointments,
  schoolEvents: SEED.schoolEvents,
  clubs: SEED.clubs,
  clubMemberships: SEED.clubMemberships,
}

function rows(sample: Partial<Record<CollectionName, readonly Record<string, unknown>[]>>) {
  return Object.entries(sample).flatMap(([collection, items]) =>
    (items ?? []).map((data) => {
      const name = collection as CollectionName
      const id = recordKey(name, data)
      if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
      return { collection: name, id, data }
    }),
  )
}

const UNPAID = SEED.invoices.find((item) => item.studentId === 's1' && !item.paidAt)
if (!UNPAID) throw new Error('örnek veride s1 taksitleri eksik')

/** c1'de sonucu girilmemiş öğrenci (sınav düzeyi c1'in düzeyidir). */
const RESULTLESS = classStudents('c1').find(
  (student) =>
    !SEED.mockResults.some((item) => item.studentId === student.id && item.examId === 'exam-7-1'),
)
if (!RESULTLESS) throw new Error('örnek veride sonucu olmayan c1 öğrencisi yok')

/** c1'de dersi, danışmanlığı ve kulübü olmayan öğretmen (kapsamı c1'i içermez). */
const OUTSIDE_TEACHER = SEED.teachers.find(
  (teacher) =>
    teacher.isActive &&
    !teacher.guidanceCounselor &&
    !SEED.classes.some((item) => item.id === 'c1' && item.teacherId === teacher.id) &&
    !SEED.assignments.some((item) => item.classId === 'c1' && item.teacherId === teacher.id) &&
    !SEED.clubs.some((item) => item.teacherId === teacher.id),
)
if (!OUTSIDE_TEACHER) throw new Error('örnek veride kapsam dışı öğretmen yok')

/** Yönetici yoklaması düzeltmedir ve gerekçe ister (DOM-AKD-035, core `attendance.record`). */
const REASON = 'Öğretmen raporlu'

const marksFor = (classId: string, status = 'present') =>
  Object.fromEntries(classStudents(classId).map((student) => [student.id, status]))

describe('yazma uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  /** Etüt yoklaması için saat ileri alınmış ikinci uygulama (aynı veritabanı). */
  let later: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
    later = await buildTestApp(db, { clock: () => AFTER_TUTORING })
  })
  after(async () => {
    await later.close()
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, rows(SAMPLE), FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }

  async function member(institutionId: string, role: Role, links: MembershipLinkInput[] = []) {
    return signInAs(app, await createMember(app, institutionId, role, links))
  }

  function send(
    method: 'POST' | 'DELETE',
    url: string,
    cookie: string | null,
    body?: unknown,
    headers: Record<string, string> = {},
    target: App = app,
  ) {
    return target.inject({
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
  }

  const post = (
    url: string,
    cookie: string | null,
    body: unknown = {},
    headers: Record<string, string> = {},
  ) => send('POST', url, cookie, body, headers)

  async function version(institutionId: string, collection: CollectionName, id: string) {
    return (await findRecord(db, institutionId, collection, id, { includeArchived: true }))?.version
  }

  async function count(institutionId: string, collection: CollectionName) {
    return (await loadRecords(db, institutionId, [collection])).length
  }

  function assertError(
    response: Awaited<ReturnType<typeof post>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  // --- İş akışı köprüsü -------------------------------------------------------------------

  describe('POST /workflows/:command (DOM hedef ve gelişim planı)', () => {
    const goal = {
      studentId: 's1',
      subjectId: 'science',
      title: 'Fen netini artır',
      targetNet: 15,
      deadline: '2026-12-15',
    }

    test('öğrenci hedefi onay bekliyor açar; kayıt ve denetim yazılır, gövdedeki institutionId etkisiz', async () => {
      const a = await institution()
      const other = await institution()
      const student = await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }])
      const response = await post('/api/v1/workflows/goal', student, {
        ...goal,
        institutionId: other.id,
      })
      assert.equal(response.statusCode, 200, response.body)
      const data = response.json().data
      assert.equal(data.entity.collection, 'studentGoals')
      assert.deepEqual(data.changes, { inserted: 1, updated: 0, archived: 0, restored: 0 })
      const stored = await findRecord(db, a.id, 'studentGoals', data.entity.id)
      assert.equal(stored?.data.status, 'Onay bekliyor')
      assert.equal(stored?.data.studentId, 's1')
      assert.equal(await findRecord(db, other.id, 'studentGoals', data.entity.id), null)
      const audits = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'workflow.goal')))
      assert.equal(audits.length, 1)
      assert.equal(audits[0]?.entityId, data.entity.id)
    })

    test('yönetici onay bekleyen hedefi onaylar; If-Match eski sürüm 409, doğru sürüm 200', async () => {
      const a = await institution()
      const url = '/api/v1/workflows/goal-review/goal-s2-total'
      const stale = await post(url, a.adminCookie, { status: 'Aktif' }, { 'if-match': '"7"' })
      assertError(stale, 409, 'version_conflict')
      assert.equal(await version(a.id, 'studentGoals', 'goal-s2-total'), 1)
      const response = await post(url, a.adminCookie, { status: 'Aktif' }, { 'if-match': '"1"' })
      assert.equal(response.statusCode, 200, response.body)
      assert.equal(response.json().data.records[0].version, 2)
      const stored = await findRecord(db, a.id, 'studentGoals', 'goal-s2-total')
      assert.equal(stored?.data.status, 'Aktif')
      // Onaylanmış hedef yeniden değerlendirilmez: 422 iş kuralı.
      assertError(await post(url, a.adminCookie, { status: 'Aktif' }), 422, 'goal_not_pending')
    })

    test('gerekçesiz ret 400 ve hedef değişmez; gerekçeli ret yazılır', async () => {
      const a = await institution()
      const url = '/api/v1/workflows/goal-review/goal-s2-total'
      const invalid = await post(url, a.adminCookie, { status: 'Reddedildi', feedback: '' })
      assertError(invalid, 400, 'validation_failed')
      assert.ok(Array.isArray(invalid.json().issues))
      assert.equal(await version(a.id, 'studentGoals', 'goal-s2-total'), 1)
      const response = await post(url, a.adminCookie, {
        status: 'Reddedildi',
        feedback: 'Hedef netini mevcut düzeye göre yeniden belirleyin.',
      })
      assert.equal(response.statusCode, 200, response.body)
      const stored = await findRecord(db, a.id, 'studentGoals', 'goal-s2-total')
      assert.equal(stored?.data.status, 'Reddedildi')
    })

    test('iş kuralı 422, aynı kapsamda açık hedef 409, olmayan kayıt 404', async () => {
      const a = await institution()
      assertError(
        await post('/api/v1/workflows/goal', a.adminCookie, { ...goal, deadline: '2026-01-01' }),
        422,
        'goal_due_date_past',
      )
      assertError(
        await post('/api/v1/workflows/goal', a.adminCookie, { ...goal, subjectId: 'math' }),
        409,
        'goal_already_open',
      )
      assertError(
        await post('/api/v1/workflows/goal-review/test-goal-yok', a.adminCookie, {
          status: 'Aktif',
        }),
        404,
        'not_found',
      )
      assert.equal(await count(a.id, 'studentGoals'), SEED.studentGoals.length)
    })

    test('rol yetkisi core kuralıdır: veli hedef onaylayamaz 403; veli yalnız bağlı çocuğuna yorum ekler', async () => {
      const a = await institution()
      const parent = await member(a.id, 'veli', [
        { kind: 'child', recordId: 's1' },
        { kind: 'child', recordId: 's2' },
      ])
      assertError(
        await post('/api/v1/workflows/goal-review/goal-s2-total?childId=s2', parent, {
          status: 'Aktif',
        }),
        403,
        'permission_denied',
      )
      const comment = { text: 'Hafta sonu birlikte çalışacağız.' }
      const foreign = await post(
        '/api/v1/workflows/goal-comment/goal-s2-total?childId=s3',
        parent,
        comment,
      )
      assert.equal(foreign.statusCode, 403, foreign.body)
      assert.equal(await version(a.id, 'studentGoals', 'goal-s2-total'), 1)
      const response = await post(
        '/api/v1/workflows/goal-comment/goal-s2-total?childId=s2',
        parent,
        comment,
      )
      assert.equal(response.statusCode, 200, response.body)
      assert.equal(await version(a.id, 'studentGoals', 'goal-s2-total'), 2)
    })

    test('bilinmeyen sorgu parametresi 400, bilinmeyen komut 404', async () => {
      const a = await institution()
      assertError(
        await post('/api/v1/workflows/goal?tur=x', a.adminCookie, goal),
        400,
        'validation_failed',
      )
      assertError(await post('/api/v1/workflows/toString', a.adminCookie, {}), 404)
    })

    test('başka kurumun kaydı 404 ve B değişmez', async () => {
      const a = await institution()
      const b = await institution()
      const created = await post('/api/v1/workflows/goal', b.adminCookie, {
        ...goal,
        studentId: 's2',
        subjectId: 'science',
      })
      assert.equal(created.statusCode, 200, created.body)
      const id: string = created.json().data.entity.id
      const before = await version(b.id, 'studentGoals', id)
      assertError(
        await post(`/api/v1/workflows/goal-close/${id}`, a.adminCookie, {}),
        404,
        'not_found',
      )
      assert.equal(await version(b.id, 'studentGoals', id), before)
    })

    test('kapalı modül 403 module_disabled; oturumsuz 401', async () => {
      const a = await institution({ enabledModules: { ...SEED.modules, goals: false } })
      assertError(await post('/api/v1/workflows/goal', a.adminCookie, goal), 403, 'module_disabled')
      assertError(await post('/api/v1/workflows/goal', null, goal), 401)
      assert.equal(await count(a.id, 'studentGoals'), SEED.studentGoals.length)
    })

    test('deneme sonucu girilir; aynı anahtarla tekrar ilk yanıtı döner, kayıt bir kez yazılır', async () => {
      const a = await institution()
      const body = {
        examId: 'exam-7-1',
        studentId: RESULTLESS.id,
        subjectId: 'math',
        correct: 8,
        wrong: 2,
        blank: 0,
        weakTopics: 'Kesirler, Oran',
      }
      const headers = { 'idempotency-key': 'test-exam-result-0001' }
      const first = await post('/api/v1/workflows/exam-result', a.adminCookie, body, headers)
      assert.equal(first.statusCode, 200, first.body)
      const replay = await post('/api/v1/workflows/exam-result', a.adminCookie, body, headers)
      assert.equal(replay.statusCode, 200)
      assert.equal(replay.headers['idempotent-replayed'], 'true')
      assert.deepEqual(replay.json(), first.json())
      const results = await loadRecords(db, a.id, ['mockResults'])
      const entered = results.filter(
        (row) => row.data.studentId === RESULTLESS.id && row.data.examId === 'exam-7-1',
      )
      assert.equal(entered.length, 1)
      // Core `list` dönüşümü bir kez uygulanır: metin diziye döner.
      assert.deepEqual(entered[0]?.data.weakTopics, ['Kesirler', 'Oran'])
    })

    test('OpenAPI: zorunlu Idempotency-Key uçlarında başlık required, diğerlerinde isteğe bağlı', () => {
      const document = app.swagger() as {
        paths: Record<string, Record<string, { parameters?: Record<string, unknown>[] }>>
      }
      const required: string[] = []
      for (const [path, methods] of Object.entries(document.paths))
        for (const [method, operation] of Object.entries(methods))
          for (const parameter of operation.parameters ?? [])
            if (parameter.in === 'header' && parameter.name === 'idempotency-key') {
              assert.equal('x-kampus-required-header' in (parameter.schema as object), false)
              if (parameter.required === true) required.push(`${method.toUpperCase()} ${path}`)
            }
      const expected = [
        ...Object.entries(WORKFLOW_ROUTES)
          .filter(([, route]) => route.idempotency === 'required')
          .map(([command]) => `POST /api/v1/workflows/${command}`),
        // Optik değerlendirme ve etüt köprüsü (routes/assessment.ts).
        ...Object.entries(ASSESSMENT_ROUTES)
          .filter(([, route]) => route.idempotency === 'required')
          .map(([command]) => `POST /api/v1/assessment/${command}`),
        'POST /api/v1/grades',
        // İletişim (routes/communication.ts): oluşturma ve mesaj gönderimi.
        'POST /api/v1/announcements',
        'POST /api/v1/conversations',
        'POST /api/v1/conversations/{conversationId}/messages',
        // Veli talebi ve izin/mazeret bildirimi (routes/requests.ts; DOM-ILT-053, DOM-ILT-080).
        'POST /api/v1/requests',
        'POST /api/v1/absences',
        // Randevu talebi (routes/appointments.ts; DOM-ILT-100, DOM-ILT-101).
        'POST /api/v1/appointments',
        // Öğretmenime Sor: soru gönderme (routes/questions.ts; DOM-ILT-090).
        'POST /api/v1/questions',
        // Kurum modül ayarı (routes/modules.ts).
        'PATCH /api/v1/modules/{moduleKey}',
        // Kampüs, öğretmen ve sınıf oluşturma (yeniden denemede ikinci kayıt açılmaz).
        'POST /api/v1/branches',
        'POST /api/v1/teachers',
        'POST /api/v1/classes',
        // Aday oluşturma (routes/prospects.ts; DOM-KAY-002).
        'POST /api/v1/prospects',
        // Kesin kayıt borç doğurur (routes/prospects.ts; DOM-KAY-035).
        'POST /api/v1/prospects/{prospectId}/enroll',
        // Tahsilat, iptal ve nakit ayarı (routes/payments.ts; DOM-FIN-031, DOM-FIN-033).
        'POST /api/v1/payments',
        'POST /api/v1/payments/{paymentId}/reverse',
        'PATCH /api/v1/payment-settings',
        // Ayrılış ve iade (routes/withdrawals.ts; DOM-FIN-041).
        'POST /api/v1/students/{studentId}/withdraw',
        'POST /api/v1/withdrawals/{withdrawalId}/pay-refund',
      ]
      assert.deepEqual(required.sort(), expected.sort())
    })

    test('toplu içe aktarma ve yenileme anahtarsız 400 idempotency_key_required', async () => {
      const a = await institution()
      assertError(
        await post('/api/v1/workflows/exam-import', a.adminCookie, {
          examId: 'exam-7-1',
          csv: 'studentId;subjectId;correct;wrong;blank\ns1;math;5;1;0',
        }),
        400,
        'idempotency_key_required',
      )
      assert.equal(await count(a.id, 'mockResults'), SEED.mockResults.length)
    })
  })

  // --- Kurum türü modül kısıtı (DOM-YTK-012) -----------------------------------------------

  describe('DOM-YTK-012: kurum türünde olmayan modülün yazma uçları bulunmaz (404)', () => {
    const commands = Object.keys(WORKFLOW_COMMANDS) as WorkflowCommand[]

    /** Kurumun bütün kayıtları ve denetim satırları: reddedilen istek hiçbirini değiştirmez. */
    async function snapshot(institutionId: string) {
      const stored = await db
        .select()
        .from(records)
        .where(eq(records.institutionId, institutionId))
        .orderBy(asc(records.collection), asc(records.id))
      const audit = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(eq(auditLog.institutionId, institutionId))
      return { stored, audit: audit.length }
    }

    test('rota tablosu core komut tablosunu izler: her komut core modülü kapanınca 403 module_disabled', async () => {
      assert.deepEqual(Object.keys(WORKFLOW_ROUTES).sort(), [...commands].sort())
      const modules = [...new Set(commands.map((command) => WORKFLOW_COMMANDS[command].module))]
      let serial = 0
      for (const module of modules) {
        const a = await institution({ enabledModules: { ...SEED.modules, [module]: false } })
        const before = await snapshot(a.id)
        for (const command of commands.filter((c) => WORKFLOW_COMMANDS[c].module === module)) {
          const route = WORKFLOW_ROUTES[command]
          const url = `/api/v1/workflows/${command}${route.record === 'required' ? '/goal-s1-math' : ''}`
          const headers = { 'idempotency-key': `test-mod-${String(++serial).padStart(4, '0')}` }
          assertError(await post(url, a.adminCookie, {}, headers), 403, 'module_disabled')
        }
        assert.deepEqual(await snapshot(a.id), before, module)
      }
    })

    test('dil okulunda okul türü modül komutları 404 not_found; kayıt ve denetim değişmez', async () => {
      const a = await institution({
        type: 'language_school',
        enabledModules: Object.fromEntries(MODULE_KEYS.map((key) => [key, true])),
      })
      const before = await snapshot(a.id)
      const unavailable = commands.filter(
        (command) => !moduleAvailableFor(WORKFLOW_COMMANDS[command].module, 'language_school'),
      )
      assert.ok(unavailable.includes('goal') && unavailable.includes('renewal'))
      let serial = 0
      for (const command of unavailable) {
        const route = WORKFLOW_ROUTES[command]
        const url = `/api/v1/workflows/${command}${route.record === 'required' ? '/goal-s1-math' : ''}`
        const headers = { 'idempotency-key': `test-lang-${String(++serial).padStart(4, '0')}` }
        assertError(await post(url, a.adminCookie, {}, headers), 404, 'not_found')
      }
      for (const url of [
        '/api/v1/tutor-sessions',
        '/api/v1/tutor-sessions/test-yok/cancel',
        '/api/v1/tutor-sessions/test-yok/attendance',
      ])
        assertError(await post(url, a.adminCookie, {}), 404, 'not_found')
      assert.deepEqual(await snapshot(a.id), before)
    })

    test('dil okulunda iki türde bulunan modülün komutu çalışır; modül kapalıysa 403', async () => {
      const a = await institution({ type: 'language_school' })
      const meal = { branchId: 'b1', date: DAY, title: 'Öğle menüsü', allergens: 'Gluten' }
      const open = await post('/api/v1/workflows/meal', a.adminCookie, meal)
      assert.equal(open.statusCode, 200, open.body)
      const closed = await institution({
        type: 'language_school',
        enabledModules: { meals: false },
      })
      assertError(
        await post('/api/v1/workflows/meal', closed.adminCookie, meal),
        403,
        'module_disabled',
      )
    })
  })

  // --- If-Match ve ön büro sınırı ---------------------------------------------------------

  describe('If-Match: konusu olmayan oluşturmada 400, yoklamada sınıf sürümü (api-tasarimi.md §6)', () => {
    const goal = {
      studentId: 's1',
      subjectId: 'science',
      title: 'Fen netini artır',
      targetNet: 15,
      deadline: '2026-12-15',
    }

    test('oluşturma komutunda If-Match 400 if_match_not_supported; kayıt yazılmaz', async () => {
      const a = await institution()
      const ifMatch = { 'if-match': '"1"' }
      assertError(
        await post('/api/v1/workflows/goal', a.adminCookie, goal, ifMatch),
        400,
        'if_match_not_supported',
      )
      // Kimliksiz `lesson` oluşturur; kimlikli yolu güncellemedir ve If-Match alır.
      assertError(
        await post('/api/v1/workflows/lesson', a.adminCookie, {}, ifMatch),
        400,
        'if_match_not_supported',
      )
      assertError(
        await post('/api/v1/tutor-sessions', a.adminCookie, {}, ifMatch),
        400,
        'if_match_not_supported',
      )
      assert.equal(await count(a.id, 'studentGoals'), SEED.studentGoals.length)
      assert.equal(await count(a.id, 'tutorSessions'), 0)
      const created = await post('/api/v1/workflows/goal', a.adminCookie, goal)
      assert.equal(created.statusCode, 200, created.body)
    })

    test('yoklamada If-Match sınıf sürümüdür: tutmazsa 409 version_conflict, kayıt yazılmaz', async () => {
      const a = await institution()
      const url = '/api/v1/classes/c1/attendance'
      const body = { date: DAY, marks: marksFor('c1'), reason: REASON }
      assertError(
        await post(url, a.adminCookie, body, { 'if-match': '"99"' }),
        409,
        'version_conflict',
      )
      assert.equal(await count(a.id, 'attendance'), 0)
      assertError(
        await post('/api/v1/classes/test-yok/attendance', a.adminCookie, body, {
          'if-match': '"1"',
        }),
        404,
        'not_found',
      )
      const current = await version(a.id, 'classes', 'c1')
      const ok = await post(url, a.adminCookie, body, { 'if-match': `"${current}"` })
      assert.equal(ok.statusCode, 200, ok.body)
      assert.equal(await count(a.id, 'attendance'), classStudents('c1').length)
    })

    test('ön büro rehberlik, deneme sonucu ve yoklama komutlarında 403; kayıt yazılmaz', async () => {
      const a = await institution()
      const frontOffice = await member(a.id, 'onburo')
      const guidance = {
        studentId: 's1',
        teacherId: 't1',
        title: 'Görüşme',
        plan: 'Haftalık takip',
        internalNote: 'Gizli not',
        followUp: '2026-10-20',
      }
      const note = { text: 'Not', followUp: '2026-10-20', status: 'Takipte' }
      const result = {
        examId: 'exam-7-1',
        studentId: RESULTLESS.id,
        subjectId: 'math',
        correct: 8,
        wrong: 2,
        blank: 0,
        weakTopics: 'Kesirler',
      }
      const guidanceId = SEED.guidanceCases[0]?.id ?? 'guidance-s1'
      const before = await version(a.id, 'guidanceCases', guidanceId)
      for (const [url, body] of [
        ['/api/v1/workflows/guidance', guidance],
        [`/api/v1/workflows/guidance-note/${guidanceId}`, note],
        ['/api/v1/workflows/exam-result', result],
        ['/api/v1/classes/c1/attendance', { date: DAY, marks: marksFor('c1') }],
      ] as const)
        assertError(await post(url, frontOffice, body), 403)
      assert.equal(await count(a.id, 'guidanceCases'), SEED.guidanceCases.length)
      assert.equal(await version(a.id, 'guidanceCases', guidanceId), before)
      assert.equal(await count(a.id, 'mockResults'), SEED.mockResults.length)
      assert.equal(await count(a.id, 'attendance'), 0)
    })
  })

  // --- Ödeme --------------------------------------------------------------------------------

  // --- Sınıf yoklaması ----------------------------------------------------------------------

  describe('POST /classes/:classId/attendance (yoklama yinelenmez)', () => {
    const url = '/api/v1/classes/c1/attendance'
    const students = classStudents('c1')

    test('yönetici yoklama alır; aynı gün ikinci yoklama kaydı günceller, yinelemez', async () => {
      const a = await institution()
      const first = await post(url, a.adminCookie, {
        date: DAY,
        marks: marksFor('c1'),
        reason: REASON,
      })
      assert.equal(first.statusCode, 200, first.body)
      assert.equal(first.json().data.changes.inserted, students.length)
      const marks = { ...marksFor('c1'), [students[0]?.id ?? '']: 'late' }
      const second = await post(url, a.adminCookie, { date: DAY, marks, reason: REASON })
      assert.equal(second.statusCode, 200, second.body)
      assert.deepEqual(second.json().data.changes, {
        inserted: 0,
        updated: 1,
        archived: 0,
        restored: 0,
      })
      const rows = await loadRecords(db, a.id, ['attendance'])
      assert.equal(rows.length, students.length)
      assert.equal(rows.find((row) => row.data.studentId === students[0]?.id)?.data.status, 'late')
    })

    test('sınıfın öğretmeni yoklama alır; kapsam dışı öğretmen 403', async () => {
      const a = await institution()
      const own = await member(a.id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
      const outside = await member(a.id, 'ogretmen', [
        { kind: 'teacher', recordId: OUTSIDE_TEACHER.id },
      ])
      assertError(
        await post(url, outside, { date: DAY, marks: marksFor('c1') }),
        403,
        'attendance_class_forbidden',
      )
      assert.equal(await count(a.id, 'attendance'), 0)
      const response = await post(url, own, { date: DAY, marks: marksFor('c1') })
      assert.equal(response.statusCode, 200, response.body)
      assert.equal(await count(a.id, 'attendance'), students.length)
    })

    test('eksik işaret ve gelecek gün 422, biçimsiz tarih ve durum 400; kayıt yazılmaz', async () => {
      const a = await institution()
      const partial = Object.fromEntries(Object.entries(marksFor('c1')).slice(1))
      assertError(
        await post(url, a.adminCookie, { date: DAY, marks: partial, reason: REASON }),
        422,
        'attendance_incomplete',
      )
      assertError(
        await post(url, a.adminCookie, {
          date: '2099-01-05',
          marks: marksFor('c1'),
          reason: REASON,
        }),
        422,
        'attendance_future_date',
      )
      assertError(
        await post(url, a.adminCookie, {
          date: '2026-02-30',
          marks: marksFor('c1'),
          reason: REASON,
        }),
        400,
        'validation_failed',
      )
      assertError(
        await post(url, a.adminCookie, {
          date: DAY,
          marks: marksFor('c1', 'geldi'),
          reason: REASON,
        }),
        400,
        'validation_failed',
      )
      assert.equal(await count(a.id, 'attendance'), 0)
    })

    test('öğrenci 403, akademik modül kapalı 403, oturumsuz 401', async () => {
      const a = await institution()
      const student = await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }])
      assertError(await post(url, student, { date: DAY, marks: marksFor('c1') }), 403, 'forbidden')
      assertError(await post(url, null, { date: DAY, marks: marksFor('c1') }), 401)
      const closed = await institution({ enabledModules: { ...SEED.modules, academic: false } })
      assertError(
        await post(url, closed.adminCookie, { date: DAY, marks: marksFor('c1') }),
        403,
        'module_disabled',
      )
      assert.equal(await count(a.id, 'attendance'), 0)
    })

    test('olmayan sınıf 404; başka kurumun sınıfı 404 ve B değişmez', async () => {
      const a = await institution()
      const b = await institution()
      const foreign = { ...SEED.classes[0], id: 'test-c-b-only' }
      await insertMissingRecords(
        db,
        b.id,
        [{ collection: 'classes', id: foreign.id, data: foreign }],
        FIXED_NOW,
      )
      assertError(
        await post('/api/v1/classes/test-c-yok/attendance', a.adminCookie, {
          date: DAY,
          marks: {},
          reason: REASON,
        }),
        404,
        'not_found',
      )
      assertError(
        await post(`/api/v1/classes/${foreign.id}/attendance`, a.adminCookie, {
          date: DAY,
          marks: {},
          reason: REASON,
        }),
        404,
        'not_found',
      )
      assert.equal(await count(b.id, 'attendance'), 0)
    })
  })

  describe('DOM-AKD-035: yoklama düzeltme geçmişi', () => {
    const url = '/api/v1/classes/c1/attendance'
    const [first, second] = classStudents('c1')
    if (!first || !second) throw new Error('örnek veride c1 öğrencileri eksik')
    const read = (cookie: string, path: string) =>
      app.inject({ method: 'GET', url: path, headers: { origin: TEST_ORIGIN, cookie } })
    type Correction = {
      previousStatus: string
      status: string
      reason: string
      by: string
      at: string
    }
    const rowOf = async (institutionId: string, studentId: string) =>
      (await loadRecords(db, institutionId, ['attendance'])).find(
        (row) => row.data.studentId === studentId,
      )

    /** Öğretmen t1 bugünün yoklamasını alır; kullanıcı kimliği ve çerezi döner. */
    async function taken(institutionId: string) {
      const user = await createMember(app, institutionId, 'ogretmen', [
        { kind: 'teacher', recordId: 't1' },
      ])
      const cookie = await signInAs(app, user)
      const response = await post(url, cookie, { date: DAY, marks: marksFor('c1') })
      assert.equal(response.statusCode, 200, response.body)
      return { user, cookie }
    }

    test('yönetici düzeltmesi geçmişe kalıcı yazılır; değişmeyen öğrenciye yazılmaz, denetimde içerik yok', async () => {
      const a = await institution()
      await taken(a.id)
      const response = await post(url, a.adminCookie, {
        date: DAY,
        marks: { ...marksFor('c1'), [first.id]: 'absent' },
        reason: `  ${REASON}  `,
      })
      assert.equal(response.statusCode, 200, response.body)
      assert.equal(response.json().data.changes.updated, 1)
      const row = await rowOf(a.id, first.id)
      assert.equal(row?.version, 2)
      assert.equal(row?.data.status, 'absent')
      assert.deepEqual(row?.data.corrections, [
        {
          previousStatus: 'present',
          status: 'absent',
          reason: REASON,
          by: a.admin.id,
          at: FIXED_NOW.toISOString(),
        },
      ] satisfies Correction[])
      const unchanged = await rowOf(a.id, second.id)
      assert.equal(unchanged?.version, 1)
      assert.equal('corrections' in (unchanged?.data ?? {}), false)
      const entries = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'attendance.record')))
        .orderBy(asc(auditLog.createdAt))
      const last = entries.find((entry) => entry.actorUserId === a.admin.id)
      assert.deepEqual(last?.changes?.fields, ['corrections', 'status'])
      assert.equal(JSON.stringify(last?.changes).includes(REASON), false)
    })

    test('öğretmenin aynı gün güncellemesi gerekçesiz de geçmişe yazılır', async () => {
      const a = await institution()
      const { user, cookie } = await taken(a.id)
      const response = await post(url, cookie, {
        date: DAY,
        marks: { ...marksFor('c1'), [first.id]: 'late' },
      })
      assert.equal(response.statusCode, 200, response.body)
      const row = await rowOf(a.id, first.id)
      assert.deepEqual(row?.data.corrections, [
        {
          previousStatus: 'present',
          status: 'late',
          reason: '',
          by: user.id,
          at: FIXED_NOW.toISOString(),
        },
      ] satisfies Correction[])
    })

    test('gerekçesiz yönetici düzeltmesi 422; kayıt ve geçmiş değişmez', async () => {
      const a = await institution()
      await taken(a.id)
      for (const reason of [undefined, '   '])
        assertError(
          await post(url, a.adminCookie, {
            date: DAY,
            marks: { ...marksFor('c1'), [first.id]: 'absent' },
            reason,
          }),
          422,
          'correction_reason_required',
        )
      assertError(
        await post(url, a.adminCookie, {
          date: DAY,
          marks: { ...marksFor('c1'), [first.id]: 'absent' },
          reason: 'x'.repeat(501),
        }),
        400,
        'validation_failed',
      )
      const row = await rowOf(a.id, first.id)
      assert.equal(row?.version, 1)
      assert.equal(row?.data.status, 'present')
      assert.equal('corrections' in (row?.data ?? {}), false)
    })

    test('veli ve öğrenci yoklama okumasında corrections yok; öğretmen ve yönetici görür', async () => {
      const a = await institution()
      const { cookie } = await taken(a.id)
      await post(url, a.adminCookie, {
        date: DAY,
        marks: { ...marksFor('c1'), s1: 'excused' },
        reason: REASON,
      })
      const row = await rowOf(a.id, 's1')
      assert.ok(row)
      for (const reader of [
        await member(a.id, 'veli', [{ kind: 'child', recordId: 's1' }]),
        await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }]),
      ]) {
        const single = await read(reader, `/api/v1/collections/attendance/${row.id}`)
        assert.equal(single.statusCode, 200, single.body)
        assert.equal(single.json().data.record.status, 'excused', 'güncel durum döner')
        assert.equal('corrections' in single.json().data.record, false)
        const list = await read(reader, '/api/v1/collections/attendance?pageSize=100')
        assert.equal(list.statusCode, 200, list.body)
        for (const item of list.json().data) assert.equal('corrections' in item.record, false)
        assert.equal(list.body.includes(REASON), false)
      }
      for (const reader of [cookie, a.adminCookie]) {
        const single = await read(reader, `/api/v1/collections/attendance/${row.id}`)
        assert.equal(single.json().data.record.corrections?.[0]?.reason, REASON)
      }
    })
  })

  // --- Core yazma yetkisi (DOM-YTK-001) ----------------------------------------------------

  describe('DOM-YTK-001: temel yazma yetkisi core `authorize` tablosundandır', () => {
    const url = '/api/v1/classes/c1/attendance'

    test('DOM-AKD-035: yönetici yoklaması gerekçesiz 422 correction_reason_required, gerekçeyle 200', async () => {
      const a = await institution()
      for (const reason of [undefined, ' ', 'a'])
        assertError(
          await post(url, a.adminCookie, { date: DAY, marks: marksFor('c1'), reason }),
          422,
          'correction_reason_required',
        )
      assert.equal(await count(a.id, 'attendance'), 0)
      const ok = await post(url, a.adminCookie, {
        date: DAY,
        marks: marksFor('c1'),
        reason: REASON,
      })
      assert.equal(ok.statusCode, 200, ok.body)
      assert.equal(await count(a.id, 'attendance'), classStudents('c1').length)
    })

    test('gelecek gün uygulamanın saatine göredir: sabit saatte ertesi gün 422, kayıt yazılmaz', async () => {
      // Uygulamanın saati FIXED_NOW'dır; ertesi gün gerçek saate göre geçmiş olsa da gelecektir.
      const a = await institution()
      assertError(
        await post(url, a.adminCookie, {
          date: '2026-10-07',
          marks: marksFor('c1'),
          reason: REASON,
        }),
        422,
        'attendance_future_date',
      )
      assert.equal(await count(a.id, 'attendance'), 0)
    })

    test('DOM-YTK-022: öğretmen yalnız ders verdiği sınıfta ve aynı gün yoklama girer', async () => {
      const a = await institution()
      const own = await member(a.id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
      assertError(
        await post(url, own, { date: '2026-10-05', marks: marksFor('c1'), reason: REASON }),
        403,
        'attendance_correction_admin_only',
      )
      assert.equal(await count(a.id, 'attendance'), 0)
      const today = await post(url, own, { date: DAY, marks: marksFor('c1') })
      assert.equal(today.statusCode, 200, today.body)
      // Geçmiş günü yönetici gerekçeyle düzeltir.
      const corrected = await post(url, a.adminCookie, {
        date: '2026-10-05',
        marks: marksFor('c1', 'excused'),
        reason: REASON,
      })
      assert.equal(corrected.statusCode, 200, corrected.body)
    })

    test('öğrenci ödeme, yoklama, arşiv ve geri almada 403; kayıt değişmez', async () => {
      const a = await institution()
      const student = await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }])
      const key = { 'idempotency-key': 'test-ogrenci-0001' }
      assertError(
        await post(
          '/api/v1/payments',
          student,
          { studentId: 's1', amountCents: 100, method: 'Banka havalesi', reference: 'TR-X' },
          key,
        ),
        403,
      )
      assertError(
        await post(url, student, { date: DAY, marks: marksFor('c1'), reason: REASON }),
        403,
      )
      assertError(await send('DELETE', '/api/v1/classes/c3?replacementId=c2', student), 403)
      assertError(await post('/api/v1/classes/c3/restore', student), 403)
      assert.equal(await version(a.id, 'invoices', UNPAID.id), 1)
      assert.equal(await version(a.id, 'classes', 'c3'), 1)
      assert.equal(await count(a.id, 'attendance'), 0)
    })

    test('DOM-YTK-020: arşiv ve geri alma yalnız yöneticide; veli ve öğretmen 403', async () => {
      const a = await institution()
      const archived = await send(
        'DELETE',
        `/api/v1/classes/c3?replacementId=${SAME_LEVEL.id}`,
        a.adminCookie,
      )
      assert.equal(archived.statusCode, 200, archived.body)
      const archivedVersion = await version(a.id, 'classes', 'c3')
      for (const [role, links] of [
        ['onburo', []],
        ['ogretmen', [{ kind: 'teacher', recordId: 't1' }]],
        ['veli', [{ kind: 'child', recordId: 's1' }]],
      ] as const) {
        const cookie = await member(a.id, role, [...links])
        assertError(await post('/api/v1/classes/c3/restore', cookie), 403)
        assertError(await send('DELETE', '/api/v1/classes/c2?replacementId=c1', cookie), 403)
      }
      assert.equal(await version(a.id, 'classes', 'c3'), archivedVersion)
      assert.equal(await version(a.id, 'classes', 'c2'), 1)
    })
  })

  // --- Kampüs/sınıf/kadro arşivi ----------------------------------------------------------

  describe('DELETE /{branches,classes,teachers}/:id ve /restore', () => {
    test('sınıf arşivlenir, öğrenciler aktarılır; geri alma sınıfı açar ve aktarımı geri taşımaz', async () => {
      const a = await institution()
      const moved = classStudents('c3')
      const response = await send(
        'DELETE',
        `/api/v1/classes/c3?replacementId=${SAME_LEVEL.id}`,
        a.adminCookie,
      )
      assert.equal(response.statusCode, 200, response.body)
      const archived = await findRecord(db, a.id, 'classes', 'c3')
      assert.equal(archived?.data.isActive, false)
      for (const student of moved) {
        const row = await findRecord(db, a.id, 'students', student.id)
        assert.equal(row?.data.classId, SAME_LEVEL.id)
      }
      const restored = await post('/api/v1/classes/c3/restore', a.adminCookie)
      assert.equal(restored.statusCode, 200, restored.body)
      assert.equal((await findRecord(db, a.id, 'classes', 'c3'))?.data.isActive, true)
      const first = moved[0]
      if (first)
        assert.equal(
          (await findRecord(db, a.id, 'students', first.id))?.data.classId,
          SAME_LEVEL.id,
        )
      // Aktif kayıt arşivden geri alınamaz: 404.
      assertError(await post('/api/v1/classes/c3/restore', a.adminCookie), 404, 'not_found')
    })

    test('öğretmen ve kampüs arşivi; aynı kayda aktarım 422, olmayan kayıt 404', async () => {
      const a = await institution()
      const teacher = OUTSIDE_TEACHER.id
      const replacement = SEED.teachers.find(
        (item) =>
          item.id !== teacher && item.isActive && item.subjectId === OUTSIDE_TEACHER.subjectId,
      )
      assert.ok(replacement)
      assertError(
        await send('DELETE', `/api/v1/teachers/${teacher}?replacementId=${teacher}`, a.adminCookie),
        422,
        'transfer_target_invalid',
      )
      const archived = await send(
        'DELETE',
        `/api/v1/teachers/${teacher}?replacementId=${replacement.id}`,
        a.adminCookie,
      )
      assert.equal(archived.statusCode, 200, archived.body)
      assert.equal((await findRecord(db, a.id, 'teachers', teacher))?.data.isActive, false)
      const restored = await post(`/api/v1/teachers/${teacher}/restore`, a.adminCookie)
      assert.equal(restored.statusCode, 200, restored.body)
      assertError(await send('DELETE', '/api/v1/branches/test-b-yok', a.adminCookie), 404)
    })

    test('yönetici dışı roller 403; bilinmeyen sorgu 400; başka kurumun kaydı 404 ve B değişmez', async () => {
      const a = await institution()
      const b = await institution()
      const desk = await member(a.id, 'onburo')
      const teacher = await member(a.id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
      for (const cookie of [desk, teacher])
        assertError(
          await send('DELETE', '/api/v1/classes/c3?replacementId=c2', cookie),
          403,
          'forbidden',
        )
      assertError(
        await send('DELETE', '/api/v1/classes/c3?hedef=c2', a.adminCookie),
        400,
        'validation_failed',
      )
      assertError(await send('DELETE', '/api/v1/classes/c3', null), 401)
      assert.equal(await version(a.id, 'classes', 'c3'), 1)
      const foreign = { ...SEED.classes[2], id: 'test-c-b-arsiv' }
      await insertMissingRecords(
        db,
        b.id,
        [{ collection: 'classes', id: foreign.id, data: foreign }],
        FIXED_NOW,
      )
      assertError(
        await send('DELETE', `/api/v1/classes/${foreign.id}?replacementId=c2`, a.adminCookie),
        404,
        'not_found',
      )
      assert.equal(await version(b.id, 'classes', foreign.id), 1)
    })
  })

  // --- Etüt ---------------------------------------------------------------------------------

  describe('etüt planı, iptali ve yoklaması (optik değerlendirme ve etüt)', () => {
    const plan = {
      examId: 'exam-7-1',
      threshold: 70,
      fromDate: '2026-10-07',
      toDate: '2026-10-20',
      duration: 30,
      maxGroupSize: 12,
    }

    async function planned() {
      const a = await institution()
      const response = await post('/api/v1/tutor-sessions', a.adminCookie, plan)
      assert.equal(response.statusCode, 200, response.body)
      const sessions = await loadRecords(db, a.id, ['tutorSessions'])
      assert.ok(sessions.length > 0)
      return { a, sessions }
    }

    test('yönetici planı onaylar; plan değiştiyse 409, aynı plan ikinci kez 422', async () => {
      const a = await institution()
      assertError(
        await post('/api/v1/tutor-sessions', a.adminCookie, { ...plan, expectedPlan: '{}' }),
        409,
        'tutoring_plan_stale',
      )
      assert.equal(await count(a.id, 'tutorSessions'), 0)
      const response = await post('/api/v1/tutor-sessions', a.adminCookie, plan)
      assert.equal(response.statusCode, 200, response.body)
      const created: number = response.json().data.changes.inserted
      assert.ok(created > 0)
      assert.equal(await count(a.id, 'tutorSessions'), created)
      assertError(
        await post('/api/v1/tutor-sessions', a.adminCookie, plan),
        422,
        'tutoring_nothing_to_create',
      )
    })

    test('etüt gerekçeyle iptal edilir; iptal geçmişi korunur, ikinci iptal 409', async () => {
      const { a, sessions } = await planned()
      const id = sessions[0]?.id ?? ''
      const url = `/api/v1/tutor-sessions/${id}/cancel`
      assertError(await post(url, a.adminCookie, { reason: '' }), 400, 'validation_failed')
      const response = await post(url, a.adminCookie, { reason: 'Öğretmen izinli.' })
      assert.equal(response.statusCode, 200, response.body)
      const stored = await findRecord(db, a.id, 'tutorSessions', id)
      assert.equal(stored?.data.status, 'İptal')
      assert.equal(await count(a.id, 'tutorSessions'), sessions.length)
      assert.equal((await post(url, a.adminCookie, { reason: 'Tekrar.' })).statusCode, 409)
    })

    test('gelecek etüdün yoklaması 422; etüt saatinden sonra yoklama alınır', async () => {
      const { a, sessions } = await planned()
      const session = sessions[0]
      assert.ok(session)
      const ids = session.data.studentIds
      assert.ok(Array.isArray(ids))
      const marks = Object.fromEntries(ids.map((id) => [String(id), 'Geldi']))
      const url = `/api/v1/tutor-sessions/${session.id}/attendance`
      assertError(await post(url, a.adminCookie, { marks }), 422)
      assert.equal(await version(a.id, 'tutorSessions', session.id), 1)
      const response = await send('POST', url, await signInAs(later, a.admin), { marks }, {}, later)
      assert.equal(response.statusCode, 200, response.body)
      const stored = await findRecord(db, a.id, 'tutorSessions', session.id)
      assert.deepEqual(stored?.data.attendance, marks)
    })

    test('öğrenci ve veli etüt planlayamaz 403; olmayan etüt 404; modül kapalı 403; oturumsuz 401', async () => {
      const a = await institution()
      const student = await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }])
      const parent = await member(a.id, 'veli', [{ kind: 'child', recordId: 's1' }])
      for (const cookie of [student, parent])
        assertError(await post('/api/v1/tutor-sessions', cookie, plan), 403)
      assertError(
        await post('/api/v1/tutor-sessions/test-tutor-yok/cancel', a.adminCookie, {
          reason: 'Yok.',
        }),
        404,
        'not_found',
      )
      assertError(await post('/api/v1/tutor-sessions', null, plan), 401)
      const closed = await institution({ enabledModules: { ...SEED.modules, tutoring: false } })
      assertError(
        await post('/api/v1/tutor-sessions', closed.adminCookie, plan),
        403,
        'module_disabled',
      )
      assert.equal(await count(a.id, 'tutorSessions'), 0)
    })

    test('başka kurumun etüdü 404 ve B değişmez', async () => {
      const { a: b, sessions } = await planned()
      const a = await institution()
      const id = sessions[0]?.id ?? ''
      assertError(
        await post(`/api/v1/tutor-sessions/${id}/cancel`, a.adminCookie, { reason: 'Deneme.' }),
        404,
        'not_found',
      )
      assert.equal(await version(b.id, 'tutorSessions', id), 1)
    })
  })
})
