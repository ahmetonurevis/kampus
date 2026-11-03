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
import { resourceVersions } from '../src/db/schema/resources.ts'
import { taskAttempts } from '../src/db/schema/skills.ts'
import { AppError } from '../src/errors.ts'
import type { ServiceContext } from '../src/plugins/authenticate.ts'
import {
  saveTaskAttemptAnswers,
  startTaskAttempt,
  submitTaskAttempt,
} from '../src/services/task-attempts.ts'
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
      otherParent: await signInAs(app, await member('veli', 'child', 's-3')),
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
    return {
      institution,
      cookies,
      seed,
      teacherId: teacher.id,
      questionId,
      quizId,
      quizItems: [first, second] as const,
    }
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
  /** Atama ayrıntısındaki kursiyer durum özeti; listedeki satırla aynı olmalı (IST-051). */
  const progressOf = async (assignmentId: string, cookie: string) => {
    const detail = await ok(await call('GET', `/task-assignments/${assignmentId}`, cookie))
    const row = (await ok(await call('GET', '/task-assignments', cookie))).find(
      (item: Json) => item.id === assignmentId,
    )
    assert.deepEqual(row.progress, detail.progress)
    return detail
  }
  const list = (assignmentId: string, cookie: string, extra = '') =>
    call('GET', `/task-attempts?assignmentId=${assignmentId}${extra}`, cookie)

  /** Öğrencinin sınıfını doğrudan değiştirir (geçiş ucu bu testlerin konusu değil). */
  async function moveStudent(institutionId: string, studentId: string, classId: string) {
    await db
      .update(records)
      .set({
        data: sql`jsonb_set(${records.data}, '{classId}', ${JSON.stringify(classId)}::jsonb)`,
        version: sql`${records.version} + 1`,
      })
      .where(
        and(
          eq(records.institutionId, institutionId),
          eq(records.collection, 'students'),
          eq(records.id, studentId),
        ),
      )
  }

  /** Yönetici atar (atayan olmayan öğretmenin görünürlüğü için). */
  async function assignAsAdmin(
    t: Tenant,
    targets: unknown[],
    settings: Record<string, unknown> = {},
  ) {
    const data = await ok(
      await call(
        'POST',
        '/task-assignments',
        t.cookies.admin,
        {
          resourceVersionId: t.questionId,
          settings: { deadline: { dueAt: DUE }, ...settings },
          targets,
        },
        key(),
      ),
      201,
    )
    return data.id as string
  }

  const learnersOf = async (assignmentId: string, cookie: string) =>
    (await ok(await list(assignmentId, cookie))).map((row: Json) => row.learnerId).sort()

  async function attemptRows(institutionId: string) {
    return db
      .select({ id: taskAttempts.id, version: taskAttempts.version })
      .from(taskAttempts)
      .where(eq(taskAttempts.institutionId, institutionId))
  }

  /** Deneme satırları ve denetim kayıtları: ret hiçbirini değiştirmemeli. */
  async function stored(institutionId: string) {
    const audits = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.institutionId, institutionId))
    return { attempts: await attemptRows(institutionId), audits: audits.length }
  }

  /** Öğretmenin yayındaki kaynağı; kaynak ve sürüm kimliğiyle (telif bildirimi ve kaldırma için). */
  async function seedOwned(
    t: Tenant,
    input: Partial<ResourceVersionInput>,
    share: { shareScope?: 'students'; sharedStudentIds?: string[] } = {},
  ) {
    const { resource, versions } = await seedResource(db, t.institution.id, {
      ownerUserId: t.teacherId,
      ...share,
      versions: [{ status: 'published', input }],
    })
    return { resourceId: resource.id, versionId: versions[0]!.id }
  }

  /** Telif incelemesi sonunda yeniden yayın: sürüm doğrudan `published`'a döner. */
  async function republish(t: Tenant, versionId: string) {
    await db
      .update(resourceVersions)
      .set({ status: 'published' })
      .where(
        and(
          eq(resourceVersions.institutionId, t.institution.id),
          eq(resourceVersions.id, versionId),
        ),
      )
  }

  /** Yönetici 9-A ve 9-B'ye alıştırma olarak atar: Deniz ve Can hedeflenir. */
  async function assignBoth(t: Tenant, versionId: string) {
    const data = await ok(
      await call(
        'POST',
        '/task-assignments',
        t.cookies.admin,
        {
          resourceVersionId: versionId,
          settings: { deadline: { dueAt: DUE }, attempts: { kind: 'practice' } },
          targets: [
            { kind: 'class', id: '9-A' },
            { kind: 'class', id: '9-B' },
          ],
        },
        key(),
      ),
      201,
    )
    return data.id as string
  }

  /** Başka kurumda aynı kayıt kimliğine (`s-1`) bağlı öğrenci. */
  async function foreignStudent() {
    const other = await createInstitution(app)
    await insertMissingRecords(
      db,
      other.id,
      [
        {
          collection: 'classes',
          id: '9-A',
          data: { id: '9-A', grade: 9, level: '9', branchId: 'b-1' },
        },
        {
          collection: 'students',
          id: 's-1',
          data: { id: 's-1', name: 'Deniz Yılmaz', classId: '9-A', isActive: true },
        },
      ],
      FIXED_NOW,
    )
    return signInAs(
      app,
      await createMember(app, other.id, 'ogrenci', [{ kind: 'student', recordId: 's-1' } as never]),
    )
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
      subskills: null,
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
    const fresh = (await progressOf(assignmentId, t.cookies.student)).progress[0]
    assert.deepEqual(
      [
        fresh.status,
        fresh.used,
        fresh.limit,
        fresh.remaining,
        fresh.canAct,
        fresh.actionableUntil,
        fresh.score,
      ],
      ['pending', 0, 2, 2, true, DUE, null],
    )
    const wrong = await answer('a')
    const right = await answer('b')
    assert.equal(right.attemptNumber, 2)
    fails(await start(assignmentId, t.cookies.student), 422, 'attempt_limit_reached')
    // IST-051: özet sayılan denemeyi (en yüksek) ve hakkın dolduğunu gösterir; veli de aynısını.
    for (const cookie of [t.cookies.student, t.cookies.parent]) {
      const [done] = (await progressOf(assignmentId, cookie)).progress
      assert.deepEqual(done, {
        learnerId: 's-1',
        status: 'submitted',
        resubmissionRequested: false,
        attemptId: right.id,
        submissionId: null,
        lastActivityAt: right.completedAt,
        used: 2,
        limit: 2,
        remaining: 0,
        canAct: false,
        actionableUntil: null,
        blockedBy: 'limit',
        score: { earned: 1, possible: 1, percent: 100 },
      })
    }
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

  test('DOM-BEC-043, IST-051: özet süren denemenin bitişini verir; süre dolunca cevap kaydı 422; deneme kaydedilmiş cevaplarla otomatik teslim sayılır; teslim gönderilen cevabı almaz', async () => {
    const t = await tenant()
    const assignmentId = await assign(t, { timeLimitMinutes: 10 })
    const attempt = await ok(await start(assignmentId, t.cookies.student), 201)
    // IST-051: süren denemenin özeti deneme bitişinde eskir (süre dolunca istemci yeniden okur).
    const running = (await progressOf(assignmentId, t.cookies.student)).progress[0]
    assert.deepEqual(
      [running.status, running.actionableUntil],
      ['in_progress', new Date(FIXED_NOW.getTime() + 10 * MINUTE).toISOString()],
    )
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
      subskills: null,
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

  test('DOM-YTK-028: görünürlük atamayı izler: atamayı gören atayan olmayan öğretmen sınıf değiştiren öğrencinin denemesini görür; yeni sınıfın öğretmeni görmez; hedef listesi daraltılır, deneme listesi daraltılmaz', async () => {
    const t = await tenant()
    // Yönetici 9-A'ya ve Can'a (9-B) atar: İngilizce öğretmeni 9-A, matematik öğretmeni Can hedefi
    // yüzünden görür; ikisi de atayan değildir.
    const mixed = await assignAsAdmin(t, [
      { kind: 'class', id: '9-A' },
      { kind: 'student', id: 's-3' },
    ])
    const deniz = await ok(await start(mixed, t.cookies.student), 201)
    const can = await ok(await start(mixed, t.cookies.otherStudent), 201)
    // Atayan olmayan öğretmenin hedef listesi kendi kapsamına daralır…
    const seenTargets = async (cookie: string) =>
      (await ok(await call('GET', `/task-assignments/${mixed}`, cookie))).targets
    assert.deepEqual(await seenTargets(t.cookies.teacher), [{ kind: 'class', id: '9-A' }])
    assert.deepEqual(await seenTargets(t.cookies.otherTeacher), [{ kind: 'student', id: 's-3' }])
    // …ama atamayı gördüğü için atamanın bütün denemelerini görür.
    for (const cookie of [t.cookies.admin, t.cookies.teacher, t.cookies.otherTeacher])
      assert.deepEqual(await learnersOf(mixed, cookie), ['s-1', 's-3'])
    assert.deepEqual(
      (await ok(await list(mixed, t.cookies.otherTeacher, '&learnerId=s-1'))).map(
        (row: Json) => row.id,
      ),
      [deniz.id],
    )
    assert.equal(
      (await ok(await call('GET', `/task-attempts/${can.id}`, t.cookies.teacher))).learnerId,
      's-3',
    )
  })

  test("DOM-YTK-028: Deniz 9-A'dan 9-B'ye geçince 9-A atamasındaki denemesini 9-A öğretmeni görmeye devam eder; 9-B öğretmeni 9-B'yi hedeflemeyen atamayı ve denemeyi görmez", async () => {
    const t = await tenant()
    const assignmentId = await assignAsAdmin(t, [{ kind: 'class', id: '9-A' }])
    const attempt = await ok(await start(assignmentId, t.cookies.student), 201)
    await ok(
      await submit(attempt.id, t.cookies.student, { answers: { [t.questionId]: choice('b') } }, 1),
    )
    await moveStudent(t.institution.id, 's-1', '9-B')
    // 9-A öğretmeni (atayan değil) atamayı sınıf hedefinden görür; Deniz artık 9-B'de.
    assert.deepEqual(await learnersOf(assignmentId, t.cookies.teacher), ['s-1'])
    assert.equal(
      (await ok(await call('GET', `/task-attempts/${attempt.id}`, t.cookies.teacher))).result
        .percent,
      100,
    )
    // 9-B öğretmeni Deniz'in güncel öğretmeni olsa da 9-B'yi hedeflemeyen atamayı görmez.
    fails(await list(assignmentId, t.cookies.otherTeacher), 404, 'not_found')
    fails(
      await call('GET', `/task-attempts/${attempt.id}`, t.cookies.otherTeacher),
      404,
      'not_found',
    )
  })

  test('DOM-YTK-028, DOM-YTK-025: aynı atamada üç öğrencinin denemesi varken öğrenci ve veli yalnız kendi kaydını, iki çocuklu veli iki çocuğununkini görür', async () => {
    const t = await tenant()
    await insertMissingRecords(
      db,
      t.institution.id,
      [
        ['s-2', 'Ece Yılmaz'],
        ['s-4', 'Mert Öz'],
      ].map(([id, name]) => ({
        collection: 'students' as const,
        id: id!,
        data: { id, name, classId: '9-A', isActive: true },
      })),
      FIXED_NOW,
    )
    const signIn = async (role: 'ogrenci' | 'veli', links: { kind: string; recordId: string }[]) =>
      signInAs(app, await createMember(app, t.institution.id, role, links as never))
    const ece = await signIn('ogrenci', [{ kind: 'student', recordId: 's-2' }])
    const mert = await signIn('ogrenci', [{ kind: 'student', recordId: 's-4' }])
    const twoChildren = await signIn('veli', [
      { kind: 'child', recordId: 's-1' },
      { kind: 'child', recordId: 's-2' },
    ])
    const assignmentId = await assign(t)
    const ids = new Map<string, string>()
    for (const [learner, cookie] of [
      ['s-1', t.cookies.student],
      ['s-2', ece],
      ['s-4', mert],
    ] as const)
      ids.set(learner, (await ok(await start(assignmentId, cookie), 201)).id)

    for (const [cookie, expected] of [
      [t.cookies.student, ['s-1']],
      [t.cookies.parent, ['s-1']],
      [mert, ['s-4']],
      [twoChildren, ['s-1', 's-2']],
      [t.cookies.teacher, ['s-1', 's-2', 's-4']],
    ] as const) {
      assert.deepEqual(await learnersOf(assignmentId, cookie), expected)
      const page = await list(assignmentId, cookie)
      assert.equal(page.json().meta.total, expected.length)
    }
    // Başka kursiyerin süzgeci boş döner; ayrıntısı 404 (varlık sızmaz).
    for (const cookie of [t.cookies.student, t.cookies.parent, twoChildren]) {
      assert.deepEqual(await ok(await list(assignmentId, cookie, '&learnerId=s-4')), [])
      fails(await call('GET', `/task-attempts/${ids.get('s-4')}`, cookie), 404, 'not_found')
    }
    assert.equal(
      (await ok(await call('GET', `/task-attempts/${ids.get('s-2')}`, twoChildren))).learnerId,
      's-2',
    )
    // IST-051: atama özeti de kendi kapsamındadır; iki çocuklu veli her çocuğun durumunu ayrı görür.
    for (const [cookie, expected] of [
      [t.cookies.student, ['s-1']],
      [t.cookies.parent, ['s-1']],
      [twoChildren, ['s-1', 's-2']],
    ] as const) {
      const { progress } = await progressOf(assignmentId, cookie)
      assert.deepEqual(
        progress.map((row: Json) => [row.learnerId, row.status, row.attemptId, row.blockedBy]),
        expected.map((learner) => [learner, 'in_progress', ids.get(learner), 'in_progress']),
      )
    }
    fails(await call('GET', `/task-attempts/${ids.get('s-2')}`, t.cookies.parent), 404, 'not_found')
  })

  test('DOM-BEC-045: alıştırmada deneme bitince personel de madde sonuçlarını ve anahtarı görür; değerlendirmede kapanışa kadar görmez', async () => {
    const t = await tenant()
    const practice = await assign(t, { attempts: { kind: 'practice' } })
    const attempt = await ok(await start(practice, t.cookies.student), 201)
    await ok(
      await submit(attempt.id, t.cookies.student, { answers: { [t.questionId]: choice('a') } }, 1),
    )
    for (const cookie of [t.cookies.teacher, t.cookies.admin]) {
      const { result } = await ok(await call('GET', `/task-attempts/${attempt.id}`, cookie))
      assert.equal(result.percent, 0)
      assert.equal(result.items.length, 1)
      assert.equal(result.answerKey[0].questionVersionId, t.questionId)
      assert.equal(result.answerKey[0].answerKey.correctOptionId, 'b')
    }
    const evaluation = await assign(t, {}, await t.seed(question('Second question?', 'd')))
    const graded = await ok(await start(evaluation, t.cookies.student), 201)
    await ok(await submit(graded.id, t.cookies.student, {}, 1))
    const { result } = await ok(await call('GET', `/task-attempts/${graded.id}`, t.cookies.teacher))
    assert.equal(result.items.length, 1)
    assert.equal(result.answerKey, null)
  })

  test('DOM-KYN-021: lisansı dolmuş içerikte yeni deneme 409 resource_license_expired; süren deneme kaydedilir ve teslim edilir', async () => {
    const t = await tenant()
    const license = {
      kind: 'licensed_publication' as const,
      publisher: 'Örnek Yayınevi',
      contractNumber: 'SZ-2026-01',
      coverage: 'Kurumun bütün öğrencileri',
      expiryDate: '2026-10-06',
      restrictedToBookOwners: false,
    }
    const licensed = await t.seed({ ...question('Licensed question?', 'c'), license })
    const assignmentId = await assign(t, { attempts: { kind: 'practice' } }, licensed)
    // Bitiş günü dahil geçerlidir: deneme başlar.
    const running = await ok(await start(assignmentId, t.cookies.student), 201)
    at(24 * 60 * MINUTE)
    try {
      // Lisans core kuralından önce denetlenir: süren deneme varken de lisans hatası gelir.
      fails(await start(assignmentId, t.cookies.student), 409, 'resource_license_expired')
      // Süren iş biter: içerik gösterilir, özet süren denemeyi gösterir.
      const ongoing = await progressOf(assignmentId, t.cookies.student)
      assert.deepEqual([ongoing.contentUnavailable, ongoing.content.versionId], [null, licensed])
      assert.equal(ongoing.content.licenseKind, 'licensed_publication')
      assert.deepEqual(ongoing.content.body, { type: 'question', questionCount: 1 })
      for (const text of ['SZ-2026-01', 'answerKey', 'Örnek Yayınevi'])
        assert.ok(!JSON.stringify(ongoing).includes(text), text)
      assert.equal(ongoing.progress[0].blockedBy, 'in_progress')
      const saved = await ok(
        await save(running.id, t.cookies.student, { [licensed]: choice('c') }, 1),
      )
      const done = await ok(await submit(running.id, t.cookies.student, {}, saved.rowVersion))
      assert.equal(done.result.percent, 100)
      const before = await attemptRows(t.institution.id)
      fails(await start(assignmentId, t.cookies.student), 409, 'resource_license_expired')
      assert.deepEqual(await attemptRows(t.institution.id), before)
      // Süren iş kalmadı: yeni deneme lisans yüzünden kapalı, içerik gösterilmez (DOM-KYN-021).
      const expired = await progressOf(assignmentId, t.cookies.student)
      assert.deepEqual(
        [expired.content, expired.contentUnavailable, expired.progress[0].blockedBy],
        [null, 'license_expired', 'license_expired'],
      )
      assert.equal(expired.progress[0].score.percent, 100)
    } finally {
      at(0)
    }
  })

  test('DOM-KYN-025, DOM-KYN-051, IST-036: kaldırılan kaynakta yeni deneme 422 content_unavailable; süren deneme de kaydedilemez ve teslim edilemez; hiçbir kayıt değişmez; başka kurum 404', async () => {
    const t = await tenant()
    const { resourceId, versionId } = await seedOwned(t, question('Removed question?', 'a'))
    const assignmentId = await assign(t, { attempts: { kind: 'practice' } }, versionId)
    const running = await ok(await start(assignmentId, t.cookies.student), 201)
    await ok(
      await call('POST', `/resources/${resourceId}/remove`, t.cookies.admin, {
        reason: 'Telif ihlali kabul edildi',
      }),
    )
    // Özet yazma ucuyla aynı kapıdan geçer (OG-985): süren deneme de sürdürülemez.
    const summary = await ok(
      await call('GET', `/task-assignments/${assignmentId}`, t.cookies.student),
    )
    assert.deepEqual(
      [summary.progress[0].canAct, summary.progress[0].blockedBy, summary.contentUnavailable],
      [false, 'content_unavailable', 'unavailable'],
    )
    const before = await stored(t.institution.id)
    fails(await start(assignmentId, t.cookies.student), 422, 'content_unavailable')
    fails(
      await save(running.id, t.cookies.student, { [versionId]: choice('a') }, running.rowVersion),
      422,
      'content_unavailable',
    )
    fails(
      await submit(running.id, t.cookies.student, {}, running.rowVersion),
      422,
      'content_unavailable',
    )
    assert.deepEqual(await stored(t.institution.id), before)
    // Başka kurumun öğrencisi aynı kimliklerle atamayı ve denemeyi bulamaz (kapsam kuraldan önce).
    const foreign = await foreignStudent()
    fails(await start(assignmentId, foreign), 404, 'not_found')
    fails(await submit(running.id, foreign, {}, running.rowVersion), 404, 'not_found')
    assert.deepEqual(await stored(t.institution.id), before)
  })

  test('DOM-KYN-051, OG-996: hata sırası kapsam 404 → rol 403 → sürüm 409 → içerik kuralı 422: kaldırılmış içerikte eski sürümle cevap kaydı ve teslim 409 version_conflict, güncel sürümle 422 content_unavailable; kayıt değişmez', async () => {
    const t = await tenant()
    const { resourceId, versionId } = await seedOwned(t, question('Ordered question?', 'a'))
    const assignmentId = await assign(t, { attempts: { kind: 'practice' } }, versionId)
    const running = await ok(await start(assignmentId, t.cookies.student), 201)
    const saved = await ok(
      await save(running.id, t.cookies.student, { [versionId]: choice('b') }, running.rowVersion),
    )
    await ok(
      await call('POST', `/resources/${resourceId}/remove`, t.cookies.admin, {
        reason: 'Telif ihlali kabul edildi',
      }),
    )
    const before = await stored(t.institution.id)
    const stale = running.rowVersion as number
    // Taslak ve teslim uçlarıyla aynı sıra (api-tasarimi §6): sürüm içerik kuralından önce gelir.
    fails(
      await save(running.id, t.cookies.student, { [versionId]: choice('a') }, stale),
      409,
      'version_conflict',
    )
    fails(await submit(running.id, t.cookies.student, {}, stale), 409, 'version_conflict')
    fails(
      await save(running.id, t.cookies.student, { [versionId]: choice('a') }, saved.rowVersion),
      422,
      'content_unavailable',
    )
    fails(
      await submit(running.id, t.cookies.student, {}, saved.rowVersion),
      422,
      'content_unavailable',
    )
    // Kapsam ve rol sürümden önce: veli 403, başka kurum 404 (eski sürümle de).
    fails(await submit(running.id, t.cookies.parent, {}, stale), 403, 'forbidden')
    fails(await submit(running.id, await foreignStudent(), {}, stale), 404, 'not_found')
    assert.deepEqual(await stored(t.institution.id), before)
  })

  test("DOM-KYN-051, OG-985: quiz'in bağlı sorusu kaldırılınca görev ayrıntısı da içeriği göstermez (özetle aynı sürüm kümesi); özet content_unavailable; başka kurum 404", async () => {
    const t = await tenant()
    const { resourceId, versionId } = await seedOwned(t, question('Linked question?', 'a'))
    const quizId = await t.seed({
      title: 'Bağlı soru quizi',
      content: { type: 'quiz', items: [{ questionVersionId: versionId, points: 1 }] },
      license: { kind: 'institution_original' },
      tags: { subjectId: 'ingilizce', gradeLevels: [9], primarySkill: 'reading', cefrLevel: 'A2' },
    })
    const assignmentId = await assign(t, { attempts: { kind: 'practice' } }, quizId)
    const gate = async () => {
      const seen = await progressOf(assignmentId, t.cookies.student)
      return [seen.contentUnavailable, seen.content?.versionId ?? null, seen.progress[0].blockedBy]
    }
    assert.deepEqual(await gate(), [null, quizId, null])
    await ok(
      await call('POST', `/resources/${resourceId}/remove`, t.cookies.admin, {
        reason: 'Telif ihlali kabul edildi',
      }),
    )
    // Quiz'in kendisi kaldırılmadı; soru kaldırıldığı için yazma ucu 422 verir, ayrıntı da kapalı.
    assert.deepEqual(await gate(), ['unavailable', null, 'content_unavailable'])
    fails(await start(assignmentId, t.cookies.student), 422, 'content_unavailable')
    fails(
      await call('GET', `/task-assignments/${assignmentId}`, await foreignStudent()),
      404,
      'not_found',
    )
  })

  /** Öğrenci tamamlanmış bir deneme bırakır, sonra yönetici kaynağı kaldırır (DOM-KYN-051). */
  async function removedAfterAttempt(t: Tenant, removeQuiz: boolean) {
    const stem = 'Who wrote the removed text?'
    const item = await seedOwned(t, question(stem, 'a', 'reading'))
    const quiz = await seedOwned(t, {
      title: 'Kaldırılacak quiz',
      content: { type: 'quiz', items: [{ questionVersionId: item.versionId, points: 2 }] },
      license: { kind: 'institution_original' },
      tags: { subjectId: 'ingilizce', gradeLevels: [9], primarySkill: 'reading', cefrLevel: 'A2' },
    })
    const assignmentId = await assign(t, { attempts: { kind: 'practice' } }, quiz.versionId)
    const running = await ok(await start(assignmentId, t.cookies.student), 201)
    const answers = { [item.versionId]: choice('a') }
    const done = await ok(
      await submit(running.id, t.cookies.student, { answers }, running.rowVersion),
    )
    assert.deepEqual([done.result.percent, done.contentRemoved], [100, false])
    await ok(
      await call(
        'POST',
        `/resources/${(removeQuiz ? quiz : item).resourceId}/remove`,
        t.cookies.admin,
        { reason: 'Telif ihlali kabul edildi' },
      ),
    )
    return { assignmentId, attemptId: running.id as string, answers, stem }
  }

  for (const removeQuiz of [true, false])
    test(`DOM-KYN-051, OG-997: ${removeQuiz ? 'quizin kendisi' : 'quizin bağlı sorusu'} kaldırılınca deneme listesi ve ayrıntısı 404 değil: kayıt ve cevaplar korunur, contentRemoved; soru metni ve anahtar gelmez; kapsam dışı ve başka kurum 404, kayıt değişmez`, async () => {
      const t = await tenant()
      const { assignmentId, attemptId, answers, stem } = await removedAfterAttempt(t, removeQuiz)
      const before = await stored(t.institution.id)
      for (const cookie of [
        t.cookies.student,
        t.cookies.parent,
        t.cookies.teacher,
        t.cookies.admin,
      ]) {
        const rows = await ok(await list(assignmentId, cookie))
        assert.deepEqual(
          rows.map((row: Json) => [
            row.id,
            row.status,
            row.contentRemoved,
            row.result,
            row.answers,
          ]),
          [[attemptId, 'submitted', true, null, answers]],
        )
        const response = await call('GET', `/task-attempts/${attemptId}`, cookie)
        const detail = await ok(response)
        assert.deepEqual(
          [detail.contentRemoved, detail.contentUnavailable, detail.questions, detail.passage],
          [true, 'unavailable', [], null],
        )
        assert.deepEqual(
          [detail.result, detail.answers, detail.status],
          [null, answers, 'submitted'],
        )
        for (const text of [stem, SECRET_EXPLANATION, 'correctOptionId'])
          assert.ok(!response.body.includes(text), text)
      }
      // Kapsam aynen kalır: hedeflenmeyen öğrenci, atamayı görmeyen öğretmen ve başka kurum 404.
      const foreign = await foreignStudent()
      for (const cookie of [t.cookies.otherStudent, t.cookies.otherTeacher, foreign]) {
        fails(await list(assignmentId, cookie), 404, 'not_found')
        fails(await call('GET', `/task-attempts/${attemptId}`, cookie), 404, 'not_found')
      }
      fails(await list(assignmentId, t.cookies.frontDesk), 403, 'forbidden')
      assert.deepEqual(await stored(t.institution.id), before)
    })

  const PASSAGE_BODY = 'Ann lives in Izmir and takes the ferry to work every day.'

  test('DOM-KYN-051, DOM-BEC-010, OG-997: yalnız okuma parçası kaldırılınca deneme contentRemoved true; soru ve parça metni ile anahtar gelmez, anahtarlar durduğu için puan ve madde sonuçları kalır (personel ve öğrenci)', async () => {
    const t = await tenant()
    const tags = {
      subjectId: 'ingilizce',
      gradeLevels: [9],
      primarySkill: 'reading' as const,
      cefrLevel: 'A2' as const,
    }
    const passage = await seedOwned(t, {
      title: 'Ann günü',
      content: { type: 'reading_passage', body: PASSAGE_BODY, glossary: [] },
      license: { kind: 'institution_original' },
      tags,
    })
    const stem = 'Where does Ann live in the removed passage?'
    const item = await seedOwned(t, question(stem, 'a', 'reading'))
    const quiz = await seedOwned(t, {
      title: 'Parçalı quiz',
      content: {
        type: 'quiz',
        items: [{ questionVersionId: item.versionId, points: 2 }],
        passageVersionId: passage.versionId,
      },
      license: { kind: 'institution_original' },
      tags,
    })
    const assignmentId = await assign(t, { attempts: { kind: 'practice' } }, quiz.versionId)
    const running = await ok(await start(assignmentId, t.cookies.student), 201)
    const done = await ok(
      await submit(
        running.id,
        t.cookies.student,
        { answers: { [item.versionId]: choice('a') } },
        running.rowVersion,
      ),
    )
    assert.deepEqual([done.result.percent, done.contentRemoved], [100, false])
    await ok(
      await call('POST', `/resources/${passage.resourceId}/remove`, t.cookies.admin, {
        reason: 'Telif ihlali kabul edildi',
      }),
    )
    const before = await stored(t.institution.id)
    for (const cookie of [t.cookies.student, t.cookies.teacher, t.cookies.admin]) {
      const rows = await ok(await list(assignmentId, cookie))
      assert.equal(rows.length, 1)
      const response = await call('GET', `/task-attempts/${running.id}`, cookie)
      const detail = await ok(response)
      for (const view of [rows[0], detail]) {
        assert.equal(view.contentRemoved, true)
        assert.deepEqual(
          [view.result.earned, view.result.possible, view.result.percent],
          [2, 2, 100],
        )
        assert.equal(view.result.items.length, 1)
        assert.equal(view.result.answerKey, null)
      }
      assert.deepEqual([detail.questions, detail.passage], [[], null])
      assert.equal(detail.contentUnavailable, 'unavailable')
      for (const text of [stem, PASSAGE_BODY, SECRET_EXPLANATION, 'correctOptionId'])
        assert.ok(!response.body.includes(text), text)
    }
    assert.deepEqual(await stored(t.institution.id), before)
  })

  test('DOM-KYN-025, DOM-KYN-021, OG-997: telif bildirimiyle askıdaki (incelemede) ve lisansı biten içerik kaldırılmış sayılmaz: contentRemoved false, puan kalır', async () => {
    const t = await tenant()
    const reported = await seedOwned(t, question('Reported question?', 'a'))
    const licensed = await seedOwned(t, {
      ...question('Licensed question?', 'c'),
      license: {
        kind: 'licensed_publication',
        publisher: 'Örnek Yayınevi',
        contractNumber: 'SZ-2026-03',
        coverage: 'Kurumun bütün öğrencileri',
        expiryDate: '2026-10-06',
        restrictedToBookOwners: false,
      },
    })
    const finished = async (versionId: string, optionId: string) => {
      const assignmentId = await assign(t, { attempts: { kind: 'practice' } }, versionId)
      const running = await ok(await start(assignmentId, t.cookies.student), 201)
      const done = await ok(
        await submit(
          running.id,
          t.cookies.student,
          { answers: { [versionId]: choice(optionId) } },
          running.rowVersion,
        ),
      )
      assert.equal(done.result.percent, 100)
      return { assignmentId, attemptId: running.id as string }
    }
    const first = await finished(reported.versionId, 'a')
    const second = await finished(licensed.versionId, 'c')
    await ok(
      await call(
        'POST',
        `/resources/${reported.resourceId}/versions/${reported.versionId}/report`,
        t.cookies.teacher,
        { reason: 'Telif ihlali şüphesi' },
      ),
    )
    at(24 * 60 * MINUTE)
    try {
      for (const { assignmentId, attemptId } of [first, second])
        for (const cookie of [t.cookies.student, t.cookies.teacher, t.cookies.admin]) {
          const rows = await ok(await list(assignmentId, cookie))
          const detail = await ok(await call('GET', `/task-attempts/${attemptId}`, cookie))
          for (const view of [rows[0], detail]) {
            assert.equal(view.contentRemoved, false)
            assert.equal(view.result.percent, 100)
          }
        }
    } finally {
      at(0)
    }
  })

  test('DOM-YTK-028, OG-997: kapsam dışı veli (başkasının çocuğu) kaldırılmış içerikte de deneme listesi ve ayrıntısında 404; ilgili veli görür; kayıt değişmez', async () => {
    const t = await tenant()
    const { assignmentId, attemptId } = await removedAfterAttempt(t, true)
    const before = await stored(t.institution.id)
    fails(await list(assignmentId, t.cookies.otherParent), 404, 'not_found')
    fails(await call('GET', `/task-attempts/${attemptId}`, t.cookies.otherParent), 404, 'not_found')
    const rows = await ok(await list(assignmentId, t.cookies.parent))
    assert.deepEqual(
      rows.map((row: Json) => [row.id, row.contentRemoved]),
      [[attemptId, true]],
    )
    assert.deepEqual(await stored(t.institution.id), before)
  })

  test('DOM-KYN-025, IST-036: telif bildirimiyle incelemedeki kaynakta yeni deneme 422 content_unavailable; süren deneme kaydedilir ve teslim edilir, mükerrer teslim yeni kayıt açmaz; yeniden yayında deneme açılır', async () => {
    const t = await tenant()
    const { resourceId, versionId } = await seedOwned(t, question('Reported question?', 'a'))
    const assignmentId = await assign(t, { attempts: { kind: 'practice' } }, versionId)
    const running = await ok(await start(assignmentId, t.cookies.student), 201)
    const version = `/resources/${resourceId}/versions/${versionId}`
    await ok(
      await call('POST', `${version}/report`, t.cookies.teacher, {
        reason: 'Telif ihlali şüphesi',
      }),
    )
    // Özet (OG-985): süren deneme sürdürülür (Sabah kararı 47: içerik görünür).
    const summary = async () => {
      const seen = await ok(
        await call('GET', `/task-assignments/${assignmentId}`, t.cookies.student),
      )
      return [seen.progress[0].canAct, seen.progress[0].blockedBy, seen.contentUnavailable]
    }
    assert.deepEqual(await summary(), [false, 'in_progress', null])
    const before = await stored(t.institution.id)
    fails(await start(assignmentId, t.cookies.student), 422, 'content_unavailable')
    assert.deepEqual(await stored(t.institution.id), before)
    // Süren deneme biter (sabah kararı adayı: askıda yeni iş yok, süren iş tamamlanır).
    const saved = await ok(
      await save(running.id, t.cookies.student, { [versionId]: choice('a') }, running.rowVersion),
    )
    const once = { ...key(), ...{ 'if-match': `"${saved.rowVersion}"` } }
    const done = await ok(
      await call('POST', `/task-attempts/${running.id}/submit`, t.cookies.student, {}, once),
    )
    assert.equal(done.result.percent, 100)
    const finished = await stored(t.institution.id)
    // Aynı anahtarla tekrar aynı yanıtı verir; yeni anahtarla ikinci teslim 409.
    const replay = await ok(
      await call('POST', `/task-attempts/${running.id}/submit`, t.cookies.student, {}, once),
    )
    assert.deepEqual(replay, done)
    fails(
      await submit(running.id, t.cookies.student, {}, done.rowVersion),
      409,
      'attempt_already_submitted',
    )
    fails(await start(assignmentId, t.cookies.student), 422, 'content_unavailable')
    assert.deepEqual(await stored(t.institution.id), finished)
    // Tamamlanan deneme süren iş değildir: içerik kapanır, yeni deneme önerilmez.
    assert.deepEqual(await summary(), [false, 'content_unavailable', 'unavailable'])
    // Yönetici yeniden yayına alır (onay koşulları bu testin konusu değil): yeni deneme açılır.
    await republish(t, versionId)
    await ok(await start(assignmentId, t.cookies.student), 201)
  })

  test('DOM-KYN-021, IST-036: kitap sahibiyle sınırlı lisansta kitap sahibi olmayan öğrenci deneme başlatamaz (422 content_unavailable); kitap sahibi başlatır', async () => {
    const t = await tenant()
    const { versionId } = await seedOwned(
      t,
      {
        ...question('Book owner question?', 'a'),
        license: {
          kind: 'licensed_publication',
          publisher: 'Örnek Yayınevi',
          contractNumber: 'SZ-2026-02',
          coverage: 'Basılı kitap sahibi öğrenciler',
          expiryDate: '2027-06-30',
          restrictedToBookOwners: true,
        },
      },
      { shareScope: 'students', sharedStudentIds: ['s-1'] },
    )
    const assignmentId = await assignBoth(t, versionId)
    const before = await stored(t.institution.id)
    fails(await start(assignmentId, t.cookies.otherStudent), 422, 'content_unavailable')
    assert.deepEqual(await stored(t.institution.id), before)
    await ok(await start(assignmentId, t.cookies.student), 201)
  })

  test('DOM-YTK-028: servis de yalnız öğrenciye yazdırır: veli çocuğunun denemesini başlatamaz, cevaplayamaz, teslim edemez (403); kayıt değişmez', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    const attempt = await ok(await start(assignmentId, t.cookies.student), 201)
    const parent = await createMember(app, t.institution.id, 'veli', [
      { kind: 'child', recordId: 's-1' } as never,
    ])
    const ctx: ServiceContext = {
      db,
      institutionId: t.institution.id,
      actor: { userId: parent.id, role: 'veli', membershipId: parent.membershipId },
      now,
      log: app.log,
    }
    const forbidden = (error: unknown) =>
      error instanceof AppError && error.statusCode === 403 && error.code === 'forbidden'
    const before = await attemptRows(t.institution.id)
    await assert.rejects(startTaskAttempt(ctx, assignmentId, null), forbidden)
    await assert.rejects(
      saveTaskAttemptAnswers(
        ctx,
        {
          attemptId: attempt.id,
          answers: { [t.questionId]: { questionType: 'multiple_choice', optionId: 'b' } },
          expectedVersion: 1,
        },
        null,
      ),
      forbidden,
    )
    await assert.rejects(
      submitTaskAttempt(ctx, { attemptId: attempt.id, expectedVersion: 1 }, null),
      forbidden,
    )
    assert.deepEqual(await attemptRows(t.institution.id), before)
    // Kapsam rolden önce: velinin çocuğu olmayan kursiyerin denemesi 404.
    const other = await createMember(app, t.institution.id, 'veli', [
      { kind: 'child', recordId: 's-3' } as never,
    ])
    await assert.rejects(
      submitTaskAttempt(
        { ...ctx, actor: { userId: other.id, role: 'veli', membershipId: other.membershipId } },
        { attemptId: attempt.id, expectedVersion: 1 },
        null,
      ),
      (error: unknown) => error instanceof AppError && error.statusCode === 404,
    )
  })

  test('IST-051: puanlama bağlamı kurulamayan atama için uyarı istek başına bir kez ve yalnız atama kimliğiyle loglanır (kursiyer sayısından bağımsız); özet içerik kapısıyla content_unavailable', async () => {
    const t = await tenant()
    const assignmentId = await assignAsAdmin(t, [
      { kind: 'class', id: '9-A' },
      { kind: 'class', id: '9-B' },
    ])
    const twins = await signInAs(
      app,
      await createMember(app, t.institution.id, 'veli', [
        { kind: 'child', recordId: 's-1' },
        { kind: 'child', recordId: 's-3' },
      ] as never),
    )
    // Veri bütünlüğü bozulur: puanlama sürümünün içeriği yok (bağlam kurulamaz).
    await db
      .update(resourceVersions)
      .set({ status: 'removed', content: null, answerKey: null, removedAt: FIXED_NOW })
      .where(
        and(
          eq(resourceVersions.institutionId, t.institution.id),
          eq(resourceVersions.id, t.questionId),
        ),
      )
    const from = logs.length
    const [row] = (await ok(await call('GET', '/task-assignments', twins))).filter(
      (item: Json) => item.id === assignmentId,
    )
    // İçeriği olmayan sürüm içerik kapısından da geçmez: yazma ucu 422 `content_unavailable`
    // döneceğinden özet de onu söyler (OG-985; kapı diğer engellerden önce gelir).
    assert.deepEqual(
      row.progress.map((item: Json) => [item.learnerId, item.canAct, item.blockedBy]),
      [
        ['s-1', false, 'content_unavailable'],
        ['s-3', false, 'content_unavailable'],
      ],
    )
    const warnings = logs
      .slice(from)
      .filter((line) => line.includes('task_progress.scoring_unavailable'))
    assert.equal(warnings.length, 1)
    assert.ok(warnings[0]!.includes(assignmentId), 'atama kimliği yok')
    for (const text of ['s-1', 's-3', SECRET_STEM])
      assert.ok(!warnings[0]!.includes(text), `${text} loglandı`)
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
