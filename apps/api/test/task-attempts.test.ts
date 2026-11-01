import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { records } from '../src/db/schema/records.ts'
import { taskAttempts } from '../src/db/schema/skills.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { seedResource } from './support/resources-sample.ts'

/**
 * Otomatik puanlı görev deneme uçları (F4b3a; ADR 0004 karar 5, 6; DOM-BEC-010, 042…045;
 * DOM-YTK-028). Kural core `skills/scoring.ts`'tedir; burada rol × kapsam, sıra (kapsam → rol →
 * sürüm → kural), sunucu saatiyle süre ve kapanış, puanın cevaplardan hesaplanması, anahtarın
 * açılması, sınıf değişimi ve log/denetimde cevap ile öğrenci kimliğinin olmadığı denetlenir.
 */

type Json = ReturnType<typeof JSON.parse>

const MINUTE = 60_000
const DUE = '2026-10-20T20:59:00.000Z'
const SECRET_EXPLANATION = 'GIZLI-COZUM'
const SECRET_STEM = 'What does Tom do on Sundays?'

const question = (
  stem: string,
  correctOptionId: string,
  skill: 'listening' | 'reading' = 'listening',
): Partial<ResourceVersionInput> => ({
  title: `Soru: ${stem}`,
  content: {
    type: 'question',
    question: {
      questionType: 'multiple_choice',
      stem,
      options: [
        { id: 'a', text: 'He swims.' },
        { id: 'b', text: 'He reads.' },
        { id: 'c', text: 'He cooks.' },
        { id: 'd', text: 'He sleeps.' },
      ],
    },
  },
  answerKey: { questionType: 'multiple_choice', correctOptionId, explanation: SECRET_EXPLANATION },
  license: { kind: 'institution_original' },
  tags: { subjectId: 'ingilizce', gradeLevels: [9], primarySkill: skill, cefrLevel: 'A2' },
})

const choice = (optionId: string | null) => ({ questionType: 'multiple_choice', optionId })

describe('görev deneme uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let now = FIXED_NOW
  const logs: string[] = []

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { logs, clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
  })

  const at = (offsetMs: number) => {
    now = new Date(FIXED_NOW.getTime() + offsetMs)
  }

  /**
   * `t-eng` (İngilizce) 9-A'nın öğretmenidir, `t-mat` 9-B'nin. Deniz (`s-1`) 9-A'da, Can (`s-3`)
   * 9-B'de. Veli Deniz'in velisidir. Tek soru (`b` doğru) ve iki sorulu quiz (1 + 3 puan) yayında.
   */
  async function tenant() {
    now = FIXED_NOW
    const institution = await createInstitution(app)
    await insertMissingRecords(
      db,
      institution.id,
      [
        {
          collection: 'teachers',
          id: 't-eng',
          data: { id: 't-eng', name: 'Selin Kaya', subjectId: 'ingilizce', branchId: 'b-1' },
        },
        {
          collection: 'teachers',
          id: 't-mat',
          data: { id: 't-mat', name: 'Murat Demir', subjectId: 'matematik', branchId: 'b-1' },
        },
        ...['9-A', '9-B'].map((id, index) => ({
          collection: 'classes' as const,
          id,
          data: { id, grade: 9, level: '9', branchId: 'b-1', teacherId: ['t-eng', 't-mat'][index] },
        })),
        ...[
          ['s-1', 'Deniz Yılmaz', '9-A'],
          ['s-3', 'Can Arslan', '9-B'],
        ].map(([id, name, classId]) => ({
          collection: 'students' as const,
          id: id!,
          data: { id, name, classId, isActive: true },
        })),
        {
          collection: 'assignments',
          id: 'as-1',
          data: { id: 'as-1', classId: '9-A', teacherId: 't-eng', subjectId: 'ingilizce' },
        },
        {
          collection: 'assignments',
          id: 'as-2',
          data: { id: 'as-2', classId: '9-B', teacherId: 't-mat', subjectId: 'matematik' },
        },
      ],
      FIXED_NOW,
    )
    const member = (role: 'ogretmen' | 'ogrenci' | 'veli', kind: string, recordId: string) =>
      createMember(app, institution.id, role, [{ kind, recordId } as never])
    const teacher = await member('ogretmen', 'teacher', 't-eng')
    const cookies = {
      admin: await signInAs(app, institution.admin),
      teacher: await signInAs(app, teacher),
      otherTeacher: await signInAs(app, await member('ogretmen', 'teacher', 't-mat')),
      student: await signInAs(app, await member('ogrenci', 'student', 's-1')),
      otherStudent: await signInAs(app, await member('ogrenci', 'student', 's-3')),
      parent: await signInAs(app, await member('veli', 'child', 's-1')),
      frontDesk: await signInAs(app, await createMember(app, institution.id, 'onburo')),
    }
    const seed = async (input: Partial<ResourceVersionInput>) =>
      (
        await seedResource(db, institution.id, {
          ownerUserId: teacher.id,
          versions: [{ status: 'published', input }],
        })
      ).versions[0]!.id
    const questionId = await seed(question(SECRET_STEM, 'b'))
    const first = await seed(question('Where does Ann live?', 'a', 'reading'))
    const second = await seed(question('What is the main idea?', 'c', 'reading'))
    const quizId = await seed({
      title: 'Okuma quizi',
      content: {
        type: 'quiz',
        items: [
          { questionVersionId: first, points: 1 },
          { questionVersionId: second, points: 3 },
        ],
      },
      license: { kind: 'institution_original' },
      tags: { subjectId: 'ingilizce', gradeLevels: [9], primarySkill: 'reading', cefrLevel: 'A2' },
    })
    return { institution, cookies, seed, questionId, quizId, quizItems: [first, second] as const }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  function call(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    cookie?: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
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
  const version = (rowVersion: number) => ({ 'if-match': `"${rowVersion}"` })

  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function fails(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code, response.body)
  }

  /** Öğretmen 9-A'ya atar; ayarlar core `assignmentSettingsSchema`. */
  async function assign(t: Tenant, settings: Record<string, unknown> = {}, versionId?: string) {
    const data = await ok(
      await call(
        'POST',
        '/task-assignments',
        t.cookies.teacher,
        {
          resourceVersionId: versionId ?? t.questionId,
          settings: { deadline: { dueAt: DUE }, ...settings },
          targets: [{ kind: 'class', id: '9-A' }],
        },
        key(),
      ),
      201,
    )
    return data.id as string
  }
  const start = (assignmentId: string, cookie = '', headers: Record<string, string> = key()) =>
    call('POST', `/task-assignments/${assignmentId}/attempts`, cookie, {}, headers)
  const save = (id: string, cookie: string, answers: unknown, rowVersion?: number) =>
    call(
      'PATCH',
      `/task-attempts/${id}`,
      cookie,
      { answers },
      rowVersion === undefined ? {} : version(rowVersion),
    )
  const submit = (id: string, cookie: string, payload: unknown, rowVersion: number) =>
    call('POST', `/task-attempts/${id}/submit`, cookie, payload, {
      ...key(),
      ...version(rowVersion),
    })
  const list = (assignmentId: string, cookie: string, extra = '') =>
    call('GET', `/task-attempts?assignmentId=${assignmentId}${extra}`, cookie)

  async function attemptRows(institutionId: string) {
    return db
      .select({ id: taskAttempts.id, version: taskAttempts.version })
      .from(taskAttempts)
      .where(eq(taskAttempts.institutionId, institutionId))
  }

  test('DOM-BEC-042, DOM-YTK-028: 401; ön büro 403; yazma yalnız öğrenci; hedeflenmeyen öğrenci ve başka kurum 404; modül kapalıyken 403 module_disabled', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    fails(await start(assignmentId), 401, 'unauthenticated')
    fails(await list(assignmentId, t.cookies.frontDesk), 403, 'forbidden')
    for (const cookie of [t.cookies.parent, t.cookies.teacher, t.cookies.admin])
      fails(await start(assignmentId, cookie), 403, 'forbidden')
    fails(await start(assignmentId, t.cookies.otherStudent), 404, 'not_found')
    fails(await list(assignmentId, t.cookies.otherStudent), 404, 'not_found')
    fails(await list(assignmentId, t.cookies.otherTeacher), 404, 'not_found')
    fails(await start(assignmentId, t.cookies.student, {}), 400, 'idempotency_key_required')
    fails(
      await start(assignmentId, t.cookies.student, { ...key(), ...version(1) }),
      400,
      'if_match_not_supported',
    )
    assert.deepEqual(await attemptRows(t.institution.id), [])

    const attempt = await ok(await start(assignmentId, t.cookies.student), 201)
    // Başka kurum: aynı kimliklerle 404.
    const other = await createInstitution(app)
    const otherAdmin = await signInAs(app, other.admin)
    fails(await call('GET', `/task-attempts/${attempt.id}`, otherAdmin), 404, 'not_found')
    fails(await list(assignmentId, otherAdmin), 404, 'not_found')

    const closed = await createInstitution(app, { enabledModules: { learning: false } })
    const admin = await signInAs(app, closed.admin)
    const id = '00000000-0000-4000-8000-000000000001'
    for (const response of await Promise.all([
      list(id, admin),
      call('GET', `/task-attempts/${id}`, admin),
      start(id, admin),
      save(id, admin, {}, 1),
      submit(id, admin, {}, 1),
    ]))
      fails(response, 403, 'module_disabled')
  })

  test('DOM-BEC-010, DOM-BEC-043, DOM-BEC-045: başlatma, cevap kaydı ve teslim; puan cevaplardan; istemci puanı 400; ikinci teslim 409; anahtar kapanışta açılır', async () => {
    const t = await tenant()
    const [first, second] = t.quizItems
    const assignmentId = await assign(
      t,
      { attempts: { kind: 'evaluation', maxAttempts: 2 }, timeLimitMinutes: 30 },
      t.quizId,
    )
    const response = await start(assignmentId, t.cookies.student)
    const started = await ok(response, 201)
    assert.equal(response.headers.location, `/api/v1/task-attempts/${started.id}`)
    assert.equal(started.status, 'in_progress')
    assert.equal(started.remainingMs, 30 * MINUTE)
    assert.equal(started.result, null)
    assert.deepEqual(
      started.questions.map((q: Json) => [q.questionVersionId, q.points]),
      [
        [first, 1],
        [second, 3],
      ],
    )
    assert.ok(!response.body.includes(SECRET_EXPLANATION), 'anahtar açıklaması sızdı')
    assert.ok(!response.body.includes('correctOptionId'), 'anahtar sızdı')
    fails(await start(assignmentId, t.cookies.student), 409, 'attempt_in_progress')

    // Cevap kaydı: If-Match zorunlu, eski sürüm 409, uyuşmayan cevap 422.
    fails(
      await save(started.id, t.cookies.student, { [first]: choice('a') }),
      400,
      'if_match_required',
    )
    fails(
      await save(started.id, t.cookies.student, { [first]: choice('a') }, 9),
      409,
      'version_conflict',
    )
    fails(
      await save(
        started.id,
        t.cookies.student,
        { [first]: { questionType: 'true_false', answer: 'true' } },
        1,
      ),
      422,
      'answer_invalid',
    )
    fails(await save(started.id, t.cookies.parent, { [first]: choice('a') }, 1), 403, 'forbidden')
    fails(
      await save(started.id, t.cookies.otherStudent, { [first]: choice('a') }, 1),
      404,
      'not_found',
    )
    const saved = await ok(await save(started.id, t.cookies.student, { [first]: choice('a') }, 1))
    assert.deepEqual(saved.answers, { [first]: choice('a') })
    assert.equal(saved.rowVersion, 2)

    // İstemcinin puanı ve durum alanı kabul edilmez; kayıt değişmez.
    for (const payload of [{ score: 100 }, { answers: {}, result: { earned: 4 } }])
      fails(await submit(started.id, t.cookies.student, payload, 2), 400, 'validation_failed')
    fails(
      await call('POST', `/task-attempts/${started.id}/submit`, t.cookies.student, {}, version(2)),
      400,
      'idempotency_key_required',
    )
    const submitted = await ok(
      await submit(started.id, t.cookies.student, { answers: { [second]: choice('b') } }, 2),
    )
    assert.equal(submitted.status, 'submitted')
    assert.equal(submitted.late, false)
    assert.equal(submitted.counted, true)
    // 1 (doğru) + 3 (yanlış) → 1/4; kursiyer kapanıştan önce yalnız toplamı görür.
    assert.deepEqual(submitted.result, {
      earned: 1,
      possible: 4,
      percent: 25,
      items: null,
      answerKey: null,
    })
    fails(await submit(started.id, t.cookies.student, {}, 2), 409, 'version_conflict')
    fails(await submit(started.id, t.cookies.student, {}, 3), 409, 'attempt_already_submitted')
    fails(await save(started.id, t.cookies.student, {}, 3), 409, 'attempt_already_submitted')

    // Personel madde sonuçlarını görür, anahtarı kapanıştan önce görmez.
    const staff = (await ok(await list(assignmentId, t.cookies.teacher)))[0]
    assert.deepEqual(
      staff.result.items.map((item: Json) => [item.questionVersionId, item.earned]),
      [
        [first, 1],
        [second, 0],
      ],
    )
    assert.equal(staff.result.answerKey, null)
    const admin = await ok(await list(assignmentId, t.cookies.admin, '&learnerId=s-1'))
    assert.equal(admin.length, 1)
    assert.deepEqual(await ok(await list(assignmentId, t.cookies.admin, '&learnerId=s-3')), [])
    const parentView = await ok(await call('GET', `/task-attempts/${started.id}`, t.cookies.parent))
    assert.equal(parentView.result.percent, 25)
    assert.equal(parentView.result.items, null)
    fails(
      await call('GET', `/task-attempts/${started.id}`, t.cookies.otherStudent),
      404,
      'not_found',
    )
    fails(
      await call('GET', `/task-attempts/${started.id}`, t.cookies.otherTeacher),
      404,
      'not_found',
    )

    // Teslim kapanınca (geç kabul 0) anahtar ve açıklama kursiyere açılır.
    now = new Date(new Date(DUE).getTime() + MINUTE)
    const released = await call('GET', `/task-attempts/${started.id}`, t.cookies.student)
    const full = await ok(released)
    assert.equal(full.result.items.length, 2)
    assert.deepEqual(
      full.result.answerKey.map((entry: Json) => entry.answerKey.correctOptionId),
      ['a', 'c'],
    )
    assert.ok(released.body.includes(SECRET_EXPLANATION))
    fails(await start(assignmentId, t.cookies.student), 422, 'submission_closed')
  })

  test('DOM-BEC-042: değerlendirme hakkı dolunca 422; "en yüksek" politikasında sayılan deneme en iyisi; eşzamanlı başlatma tek satır', async () => {
    const t = await tenant()
    const assignmentId = await assign(t, {
      attempts: { kind: 'evaluation', maxAttempts: 2, countPolicy: 'highest' },
    })
    const answer = async (optionId: string) => {
      const attempt = await ok(await start(assignmentId, t.cookies.student), 201)
      return ok(
        await submit(
          attempt.id,
          t.cookies.student,
          { answers: { [t.questionId]: choice(optionId) } },
          1,
        ),
      )
    }
    const wrong = await answer('a')
    const right = await answer('b')
    assert.equal(right.attemptNumber, 2)
    fails(await start(assignmentId, t.cookies.student), 422, 'attempt_limit_reached')
    const rows = await ok(await list(assignmentId, t.cookies.teacher))
    assert.deepEqual(
      rows.map((row: Json) => [row.id, row.counted, row.result.percent]),
      [
        [wrong.id, false, 0],
        [right.id, true, 100],
      ],
    )

    // Hak 1: aynı anda iki başlatma tek deneme açar (kurum kilidi; diğeri 409).
    const single = await assign(t, {}, await t.seed(question('Second question?', 'd')))
    const both = await Promise.all([
      start(single, t.cookies.student),
      start(single, t.cookies.student),
    ])
    assert.deepEqual(both.map((r) => r.statusCode).sort(), [201, 409])
  })

  test('DOM-BEC-043: süre dolunca cevap kaydı 422; deneme kaydedilmiş cevaplarla otomatik teslim sayılır; teslim gönderilen cevabı almaz', async () => {
    const t = await tenant()
    const assignmentId = await assign(t, { timeLimitMinutes: 10 })
    const attempt = await ok(await start(assignmentId, t.cookies.student), 201)
    at(5 * MINUTE)
    const saved = await ok(
      await save(attempt.id, t.cookies.student, { [t.questionId]: choice('b') }, 1),
    )
    assert.equal(saved.remainingMs, 5 * MINUTE)
    at(11 * MINUTE)
    fails(
      await save(attempt.id, t.cookies.student, { [t.questionId]: choice('a') }, 2),
      422,
      'attempt_time_over',
    )
    const expired = await ok(await call('GET', `/task-attempts/${attempt.id}`, t.cookies.student))
    assert.deepEqual(
      [expired.status, expired.autoSubmitted, expired.result.percent],
      ['expired', true, 100],
    )
    const submitted = await ok(
      await submit(attempt.id, t.cookies.student, { answers: { [t.questionId]: choice('a') } }, 2),
    )
    assert.equal(submitted.status, 'submitted')
    assert.equal(submitted.completedAt, new Date(FIXED_NOW.getTime() + 10 * MINUTE).toISOString())
    assert.deepEqual(submitted.answers, { [t.questionId]: choice('b') })
    assert.equal(submitted.result.percent, 100)
  })

  test('DOM-BEC-044, DOM-BEC-045: son teslimden sonra geç kabulde teslim late; alıştırmada anahtar deneme bitince açılır', async () => {
    const t = await tenant()
    const assignmentId = await assign(t, { deadline: { dueAt: DUE, lateAcceptanceDays: 2 } })
    now = new Date(new Date(DUE).getTime() + 60 * MINUTE)
    const attempt = await ok(await start(assignmentId, t.cookies.student), 201)
    const late = await ok(await submit(attempt.id, t.cookies.student, {}, 1))
    assert.equal(late.late, true)
    // Değerlendirmede geç kabul süresince anahtar kapalı; yanıtsız madde yanlış.
    assert.deepEqual(late.result, {
      earned: 0,
      possible: 1,
      percent: 0,
      items: null,
      answerKey: null,
    })

    now = FIXED_NOW
    const practice = await assign(
      t,
      { attempts: { kind: 'practice' } },
      await t.seed(question('Second question?', 'd')),
    )
    const open = await ok(await start(practice, t.cookies.student), 201)
    assert.equal(open.result, null)
    const done = await ok(await submit(open.id, t.cookies.student, {}, 1))
    assert.equal(done.counted, false)
    assert.equal(done.result.answerKey.length, 1)
    assert.equal(done.result.items.length, 1)
  })

  test('DOM-YTK-028: sınıf değiştiren öğrenci eski sınıftaki denemesini ve puanını görür, yeni deneme başlatamaz; denemesi olmayan atama 404', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    const empty = await assign(t, {}, await t.seed(question('Second question?', 'd')))
    const attempt = await ok(await start(assignmentId, t.cookies.student), 201)
    await ok(
      await submit(attempt.id, t.cookies.student, { answers: { [t.questionId]: choice('b') } }, 1),
    )
    await db
      .update(records)
      .set({
        data: sql`jsonb_set(${records.data}, '{classId}', '"9-B"')`,
        version: sql`${records.version} + 1`,
      })
      .where(
        and(
          eq(records.institutionId, t.institution.id),
          eq(records.collection, 'students'),
          eq(records.id, 's-1'),
        ),
      )
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const rows = await ok(await list(assignmentId, cookie))
      assert.deepEqual(
        rows.map((row: Json) => [row.id, row.result.percent]),
        [[attempt.id, 100]],
      )
      assert.equal(
        (await ok(await call('GET', `/task-attempts/${attempt.id}`, cookie))).result.percent,
        100,
      )
      fails(await list(empty, cookie), 404, 'not_found')
    }
    fails(await start(assignmentId, t.cookies.student), 404, 'not_found')
    // Yeni sınıfın öğretmeni eski sınıfın atamasını ve denemesini görmez.
    fails(
      await call('GET', `/task-attempts/${attempt.id}`, t.cookies.otherTeacher),
      404,
      'not_found',
    )
  })

  test('DOM-BEC-043: log ve denetimde cevap ve öğrenci kimliği yok; denetime yalnız başlatma ve teslim, alan adlarıyla', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    const from = logs.length
    const attempt = await ok(await start(assignmentId, t.cookies.student), 201)
    await ok(await save(attempt.id, t.cookies.student, { [t.questionId]: choice('c') }, 1))
    await ok(await submit(attempt.id, t.cookies.student, {}, 2))
    await ok(await list(assignmentId, t.cookies.teacher))
    const written = logs.slice(from).join('\n')
    assert.ok(written.includes('task_attempt.submit'), 'işlem logu yok')
    for (const text of ['s-1', 'optionId', SECRET_STEM, SECRET_EXPLANATION])
      assert.ok(!written.includes(text), `${text} loglandı`)
    const audits = await db
      .select({ action: auditLog.action, entityId: auditLog.entityId, changes: auditLog.changes })
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, t.institution.id), eq(auditLog.entityType, 'task_attempt')),
      )
    assert.deepEqual(audits.map((row) => row.action).sort(), [
      'task_attempt.start',
      'task_attempt.submit',
    ])
    assert.ok(audits.every((row) => row.entityId === attempt.id))
    const stored = JSON.stringify(audits)
    for (const text of ['s-1', 'optionId', '"c"']) assert.ok(!stored.includes(text), text)
  })
})
