import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'
import { ITEM_CHECK_LIMIT } from '@kampus/school-core/skills/practice.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { institutions } from '../src/db/schema/auth.ts'
import {
  attemptItemChecks,
  taskAssignments,
  taskAssignmentTargets,
  taskAttempts,
} from '../src/db/schema/skills.ts'
import { GRADEBOOK_ASSIGNMENT_LIMIT } from '../src/services/practice-gradebook.ts'
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
 * Ünite alıştırma seti uçları (OG-085, IST-056; docs/domain/beceri-gelisimi.md DOM-BEC-047, 048;
 * DOM-BEC-041). Kural core `skills/practice.ts`'tedir; burada madde kontrolünün rol × kapsam sırası,
 * hak sınırı, mükerrer kontrol, kilit ve anahtarın açılması, velinin alıştırma puanını hiçbir yoldan
 * görmemesi ve not defterinin rol kapsamı ile ünite/beceri/kazanım kırılımı denetlenir.
 */

type Json = ReturnType<typeof JSON.parse>

const MINUTE = 60_000
const DUE = '2026-10-20T20:59:00.000Z'
const EXPLANATION = 'Pazar günleri okur.'
const UNIT = { number: 3, title: 'Daily routines' }
const ITEM_OUTCOME = { outcomeId: 'ENG.9.3.1', outcomeSource: 'platform' } as const
const SET_OUTCOME = { outcomeId: 'ENG.9.3', outcomeSource: 'platform' } as const

const question = (
  stem: string,
  correctOptionId: string,
  skill: 'listening' | 'reading',
  outcomes: readonly { outcomeId: string; outcomeSource: 'platform' }[] = [],
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
  answerKey: { questionType: 'multiple_choice', correctOptionId, explanation: EXPLANATION },
  license: { kind: 'institution_original' },
  tags: {
    subjectId: 'ingilizce',
    gradeLevels: [9],
    primarySkill: skill,
    cefrLevel: 'A2',
    outcomes: [...outcomes],
  },
})

const choice = (optionId: string) => ({ questionType: 'multiple_choice', optionId })

describe('ünite alıştırma seti uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let now = FIXED_NOW

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
  })

  const at = (offsetMs: number) => {
    now = new Date(FIXED_NOW.getTime() + offsetMs)
  }

  /**
   * `t-eng` 9-A'nın, `t-mat` 9-B'nin öğretmenidir; Deniz (`s-1`) 9-A'da, Can (`s-3`) 9-B'de; veli
   * Deniz'in velisidir. Alıştırma seti (ünite 3) iki maddedir: okuma maddesi (`b` doğru, 1 puan,
   * kendi kazanımı) ve dinleme maddesi (`c` doğru, 3 puan, kazanımsız: setin kazanımı geçer).
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
    const reading = await seed(question('What does Tom do?', 'b', 'reading', [ITEM_OUTCOME]))
    const listening = await seed(question('Where is Ann?', 'c', 'listening'))
    const setInput = (unit: typeof UNIT | null): Partial<ResourceVersionInput> => ({
      title: 'Ünite 3 alıştırması',
      content: {
        type: 'exercise_set',
        unit,
        items: [
          { questionVersionId: reading, points: 1 },
          { questionVersionId: listening, points: 3 },
        ],
      } as never,
      license: { kind: 'institution_original' },
      tags: {
        subjectId: 'ingilizce',
        gradeLevels: [9],
        primarySkill: 'reading',
        cefrLevel: 'A2',
        outcomes: [SET_OUTCOME],
      },
    })
    const setId = await seed(setInput(UNIT))
    const unitlessSetId = await seed(setInput(null))
    // Aynı içerik açık atamada aynı kursiyere ikinci kez verilemez: değerlendirme ayrı kaynaktır.
    const evaluationSetId = await seed(setInput(UNIT))
    return { institution, cookies, reading, listening, setId, unitlessSetId, evaluationSetId }
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

  async function assign(
    t: Tenant,
    settings: Record<string, unknown> = {},
    targets: unknown[] | undefined = undefined,
    versionId = t.setId,
    cookie = t.cookies.teacher,
  ) {
    const data = await ok(
      await call(
        'POST',
        '/task-assignments',
        cookie,
        {
          resourceVersionId: versionId,
          settings: { deadline: { dueAt: DUE }, attempts: { kind: 'practice' }, ...settings },
          targets: targets ?? [{ kind: 'class', id: '9-A' }],
        },
        key(),
      ),
      201,
    )
    return data.id as string
  }
  const start = (assignmentId: string, cookie: string) =>
    call('POST', `/task-assignments/${assignmentId}/attempts`, cookie, {}, key())
  const check = (
    attemptId: string,
    cookie: string | undefined,
    body: unknown,
    rowVersion: number | null,
    headers: Record<string, string> = {},
  ) =>
    call('POST', `/task-attempts/${attemptId}/checks`, cookie, body, {
      ...(rowVersion === null ? {} : version(rowVersion)),
      ...headers,
    })
  const submit = (id: string, cookie: string, rowVersion: number) =>
    call('POST', `/task-attempts/${id}/submit`, cookie, {}, { ...key(), ...version(rowVersion) })
  const gradebook = (cookie?: string, query = '') =>
    call('GET', `/practice-gradebook${query}`, cookie)

  async function checkRows(institutionId: string) {
    return db
      .select({
        attemptId: attemptItemChecks.attemptId,
        questionVersionId: attemptItemChecks.questionVersionId,
        checkNumber: attemptItemChecks.checkNumber,
      })
      .from(attemptItemChecks)
      .where(eq(attemptItemChecks.institutionId, institutionId))
  }
  async function attemptRow(id: string) {
    const [row] = await db
      .select({ version: taskAttempts.version, answers: taskAttempts.answers })
      .from(taskAttempts)
      .where(eq(taskAttempts.id, id))
    return row
  }
  const feedbackOf = (attempt: Json, questionVersionId: string) =>
    (attempt.feedback as Json[]).find((entry) => entry.questionVersionId === questionVersionId)

  test('DOM-BEC-047: kontrol ucu 401; veli, öğretmen ve yönetici 403; başkasının ve başka kurumun denemesi, olmayan deneme 404; ret hiçbir satırı değiştirmez', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    const attempt = await ok(await start(assignmentId, t.cookies.student), 201)
    const body = { questionVersionId: t.reading, response: choice('a') }
    const before = await checkRows(t.institution.id)
    fails(await check(attempt.id, undefined, body, 1), 401, 'unauthenticated')
    for (const cookie of [t.cookies.parent, t.cookies.teacher, t.cookies.admin])
      fails(await check(attempt.id, cookie, body, 1), 403, 'forbidden')
    fails(await check(attempt.id, t.cookies.otherStudent, body, 1), 404, 'not_found')
    fails(await check(randomUUID(), t.cookies.student, body, 1), 404, 'not_found')
    const other = await createInstitution(app)
    const outsider = await signInAs(
      app,
      await createMember(app, other.id, 'ogrenci', [{ kind: 'student', recordId: 's-1' } as never]),
    )
    fails(await check(attempt.id, outsider, body, 1), 404, 'not_found')
    assert.deepEqual(await checkRows(t.institution.id), before)
    assert.equal((await attemptRow(attempt.id))?.version, 1)
  })

  test('DOM-BEC-047: kontrol ucu 400 (If-Match yok, katı gövde, bozuk cevap); 409 sürüm; görevde olmayan madde 422; ret hiçbir satırı değiştirmez', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    const attempt = await ok(await start(assignmentId, t.cookies.student), 201)
    const body = { questionVersionId: t.reading, response: choice('a') }
    fails(await check(attempt.id, t.cookies.student, body, null), 400, 'if_match_required')
    fails(
      await check(attempt.id, t.cookies.student, { ...body, correct: true }, 1),
      400,
      'validation_failed',
    )
    fails(
      await check(attempt.id, t.cookies.student, { questionVersionId: t.reading }, 1),
      400,
      'validation_failed',
    )
    fails(await check(attempt.id, t.cookies.student, body, 7), 409, 'version_conflict')
    fails(
      await check(
        attempt.id,
        t.cookies.student,
        { questionVersionId: randomUUID(), response: choice('a') },
        1,
      ),
      422,
      'answer_invalid',
    )
    assert.deepEqual(await checkRows(t.institution.id), [])
    const row = await attemptRow(attempt.id)
    assert.equal(row?.version, 1)
    assert.deepEqual(row?.answers, {})
  })

  test('DOM-BEC-047: aynı maddeye aynı If-Match ile eşzamanlı iki kontrolden yalnız biri kabul edilir, diğeri 409 çakışır; tek kontrol satırı kalır', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    const attempt = await ok(await start(assignmentId, t.cookies.student), 201)
    const [first, second] = await Promise.all(
      ['a', 'c'].map((optionId) =>
        check(
          attempt.id,
          t.cookies.student,
          { questionVersionId: t.reading, response: choice(optionId) },
          attempt.rowVersion,
        ),
      ),
    )
    const responses = [first!, second!]
    assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409])
    const loser = responses.find((r) => r.statusCode === 409)!
    // Sürüm kilidi ya da (sürüm artmadan çakışan) birincil anahtar: ikisi de 409'dur.
    assert.ok(['version_conflict', 'item_check_conflict'].includes(loser.json().code), loser.body)
    const winner = responses.find((r) => r.statusCode === 200)!.json().data as Json
    assert.equal(feedbackOf(winner, t.reading).used, 1)
    const rows = await checkRows(t.institution.id)
    assert.deepEqual(
      rows.map((row) => [row.attemptId, row.questionVersionId, row.checkNumber]),
      [[attempt.id, t.reading, 1]],
    )
    assert.equal((await attemptRow(attempt.id))?.version, winner.rowVersion)
  })

  test('DOM-BEC-047: modül kapalıyken kontrol ucu 403 module_disabled; kontrol satırı yazılmaz, deneme değişmez', async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    const attempt = await ok(await start(assignmentId, t.cookies.student), 201)
    await db
      .update(institutions)
      .set({ enabledModules: { learning: false } })
      .where(eq(institutions.id, t.institution.id))
    fails(
      await check(
        attempt.id,
        t.cookies.student,
        { questionVersionId: t.reading, response: choice('a') },
        attempt.rowVersion,
      ),
      403,
      'module_disabled',
    )
    assert.deepEqual(await checkRows(t.institution.id), [])
    const row = await attemptRow(attempt.id)
    assert.equal(row?.version, attempt.rowVersion)
    assert.deepEqual(row?.answers, {})
  })

  test(`DOM-BEC-047: madde başına ${ITEM_CHECK_LIMIT} hak; aynı cevap hak tüketmez; kilitli maddede yalnız o maddenin anahtarı açılır ve cevap değişmez; teslimde bütün anahtar`, async () => {
    const t = await tenant()
    const assignmentId = await assign(t)
    const attempt = await ok(await start(assignmentId, t.cookies.student), 201)
    assert.deepEqual(attempt.feedback, [])

    const wrong = await ok(
      await check(
        attempt.id,
        t.cookies.student,
        { questionVersionId: t.reading, response: choice('a') },
        1,
      ),
    )
    assert.deepEqual(feedbackOf(wrong, t.reading), {
      questionVersionId: t.reading,
      used: 1,
      remaining: 1,
      correct: false,
      correctParts: 0,
      parts: 1,
      locked: false,
      answerKey: null,
    })
    assert.deepEqual(wrong.answers[t.reading], choice('a'))
    assert.equal(wrong.result, null)
    assert.equal(feedbackOf(wrong, t.listening), undefined)

    // Son kontrolle aynı cevap mükerrerdir: hak tüketmez, satır ve sürüm değişmez.
    const repeat = await ok(
      await check(
        attempt.id,
        t.cookies.student,
        { questionVersionId: t.reading, response: choice('a') },
        wrong.rowVersion,
      ),
    )
    assert.equal(repeat.rowVersion, wrong.rowVersion)
    assert.equal(feedbackOf(repeat, t.reading).used, 1)
    assert.equal((await checkRows(t.institution.id)).length, 1)

    // Aynı `Idempotency-Key` yanıtı yineler, ikinci satır yazmaz.
    const replayKey = key()
    const second = await check(
      attempt.id,
      t.cookies.student,
      { questionVersionId: t.reading, response: choice('c') },
      wrong.rowVersion,
      replayKey,
    )
    const locked = await ok(second)
    const replay = await check(
      attempt.id,
      t.cookies.student,
      { questionVersionId: t.reading, response: choice('c') },
      wrong.rowVersion,
      replayKey,
    )
    assert.equal(replay.statusCode, 200, replay.body)
    assert.deepEqual(replay.json(), second.json())
    assert.equal((await checkRows(t.institution.id)).length, 2)

    // Hak bitti: madde kilitli, yalnız bu maddenin anahtarı açık.
    assert.deepEqual(
      { ...feedbackOf(locked, t.reading), answerKey: null },
      {
        questionVersionId: t.reading,
        used: 2,
        remaining: 0,
        correct: false,
        correctParts: 0,
        parts: 1,
        locked: true,
        answerKey: null,
      },
    )
    assert.equal(feedbackOf(locked, t.reading).answerKey.correctOptionId, 'b')
    assert.equal(feedbackOf(locked, t.reading).answerKey.explanation, EXPLANATION)
    assert.equal(locked.result, null)
    assert.ok(!JSON.stringify(locked).includes('"correctOptionId":"c"'))

    fails(
      await check(
        attempt.id,
        t.cookies.student,
        { questionVersionId: t.reading, response: choice('b') },
        locked.rowVersion,
      ),
      422,
      'item_check_locked',
    )

    // Kilitli maddenin cevabı kayıtta değişmez; diğer madde değişir.
    const saved = await ok(
      await call(
        'PATCH',
        `/task-attempts/${attempt.id}`,
        t.cookies.student,
        { answers: { [t.reading]: choice('b'), [t.listening]: choice('a') } },
        version(locked.rowVersion),
      ),
    )
    assert.deepEqual(saved.answers[t.reading], choice('c'))
    assert.deepEqual(saved.answers[t.listening], choice('a'))

    // Doğru cevap ilk kontrolde kilitler.
    const right = await ok(
      await check(
        attempt.id,
        t.cookies.student,
        { questionVersionId: t.listening, response: choice('c') },
        saved.rowVersion,
      ),
    )
    const listened = feedbackOf(right, t.listening)
    assert.deepEqual(
      [listened.used, listened.remaining, listened.correct, listened.locked],
      [1, 1, true, true],
    )
    assert.equal(listened.answerKey.correctOptionId, 'c')

    // Teslim: puan son kaydedilen cevaplardan (3 / 4), bütün anahtar açık; sonra kontrol 409.
    const done = await ok(await submit(attempt.id, t.cookies.student, right.rowVersion))
    assert.deepEqual([done.result.earned, done.result.possible, done.result.percent], [3, 4, 75])
    assert.equal(done.result.answerKey.length, 2)
    fails(
      await check(
        attempt.id,
        t.cookies.student,
        { questionVersionId: t.listening, response: choice('a') },
        done.rowVersion,
      ),
      409,
      'attempt_already_submitted',
    )

    // Yeni deneme sınırsız ve haklar sıfırdan başlar.
    const next = await ok(await start(assignmentId, t.cookies.student), 201)
    const fresh = await ok(
      await check(
        next.id,
        t.cookies.student,
        { questionVersionId: t.reading, response: choice('a') },
        next.rowVersion,
      ),
    )
    assert.equal(feedbackOf(fresh, t.reading).remaining, ITEM_CHECK_LIMIT - 1)
  })

  test('DOM-BEC-047: değerlendirmede anında geri bildirim yok (422); süresi dolmuş denemede 422 attempt_time_over', async () => {
    const t = await tenant()
    const evaluation = await assign(
      t,
      { attempts: { kind: 'evaluation', maxAttempts: 1 } },
      undefined,
      t.evaluationSetId,
    )
    const graded = await ok(await start(evaluation, t.cookies.student), 201)
    assert.equal(graded.feedback, null)
    fails(
      await check(
        graded.id,
        t.cookies.student,
        { questionVersionId: t.reading, response: choice('a') },
        1,
      ),
      422,
      'instant_feedback_unavailable',
    )
    const timed = await assign(t, { timeLimitMinutes: 10 })
    const attempt = await ok(await start(timed, t.cookies.student), 201)
    at(11 * MINUTE)
    fails(
      await check(
        attempt.id,
        t.cookies.student,
        { questionVersionId: t.reading, response: choice('a') },
        1,
      ),
      422,
      'attempt_time_over',
    )
    assert.deepEqual(await checkRows(t.institution.id), [])
  })

  test('DOM-BEC-041, 047: veli alıştırmada puanı, madde sonucunu ve geri bildirimi hiçbir yoldan görmez; değerlendirmede açılan puanı görür', async () => {
    const t = await tenant()
    const practice = await assign(t)
    const attempt = await ok(await start(practice, t.cookies.student), 201)
    const checked = await ok(
      await check(
        attempt.id,
        t.cookies.student,
        { questionVersionId: t.reading, response: choice('b') },
        1,
      ),
    )
    const done = await ok(await submit(attempt.id, t.cookies.student, checked.rowVersion))
    assert.equal(done.result.percent, 25)

    const parentAttempt = await ok(
      await call('GET', `/task-attempts/${attempt.id}`, t.cookies.parent),
    )
    assert.equal(parentAttempt.result, null)
    assert.equal(parentAttempt.feedback, null)
    const [listed] = await ok(
      await call('GET', `/task-attempts?assignmentId=${practice}`, t.cookies.parent),
    )
    assert.equal(listed.result, null)
    assert.equal(listed.feedback, null)
    const detail = await ok(await call('GET', `/task-assignments/${practice}`, t.cookies.parent))
    assert.equal(detail.progress[0].status, 'submitted')
    assert.equal(detail.progress[0].score, null)
    const row = (await ok(await call('GET', '/task-assignments', t.cookies.parent))).find(
      (item: Json) => item.id === practice,
    )
    assert.equal(row.progress[0].score, null)
    // Öğrenci kendi alıştırma puanını özette görür.
    const own = await ok(await call('GET', `/task-assignments/${practice}`, t.cookies.student))
    assert.equal(own.progress[0].score.percent, 25)

    // Değerlendirme alıştırma değildir: tamamlanınca toplam puan veliye de açılır (DOM-BEC-045).
    const evaluation = await assign(
      t,
      { attempts: { kind: 'evaluation', maxAttempts: 1 } },
      undefined,
      t.evaluationSetId,
    )
    const graded = await ok(await start(evaluation, t.cookies.student), 201)
    await ok(await submit(graded.id, t.cookies.student, graded.rowVersion))
    const parentEvaluation = await ok(
      await call('GET', `/task-assignments/${evaluation}`, t.cookies.parent),
    )
    assert.equal(parentEvaluation.progress[0].score.percent, 0)
  })

  test('DOM-BEC-048: not defteri 401; veli ve ön büro 403; modül kapalıyken 403; bilinmeyen parametre 400', async () => {
    const t = await tenant()
    fails(await gradebook(), 401, 'unauthenticated')
    fails(await gradebook(t.cookies.parent), 403, 'forbidden')
    fails(await gradebook(t.cookies.frontDesk), 403, 'forbidden')
    fails(await gradebook(t.cookies.teacher, '?page=2'), 400, 'validation_failed')
    const closed = await createInstitution(app, { enabledModules: { learning: false } })
    fails(await gradebook(await signInAs(app, closed.admin)), 403, 'module_disabled')
  })

  test('DOM-BEC-048: not defteri son tamamlanan denemeden ünite, beceri ve kazanım kırılımı verir; öğretmen kendi kapsamını, yönetici herkesi, öğrenci yalnız kendisini görür', async () => {
    const t = await tenant()
    // Yönetici iki sınıfa atar: iki öğretmen de atamayı görür (DOM-YTK-028).
    const practice = await assign(
      t,
      {},
      [
        { kind: 'class', id: '9-A' },
        { kind: 'class', id: '9-B' },
      ],
      t.setId,
      t.cookies.admin,
    )
    const unitless = await assign(t, {}, [{ kind: 'class', id: '9-A' }], t.unitlessSetId)
    // Değerlendirme not defterine girmez.
    const evaluation = await assign(
      t,
      { attempts: { kind: 'evaluation', maxAttempts: 1 } },
      undefined,
      t.evaluationSetId,
    )
    const solve = async (assignmentId: string, cookie: string, answers: Record<string, string>) => {
      const attempt = await ok(await start(assignmentId, cookie), 201)
      let rowVersion = attempt.rowVersion as number
      if (Object.keys(answers).length > 0)
        rowVersion = (
          await ok(
            await call(
              'PATCH',
              `/task-attempts/${attempt.id}`,
              cookie,
              {
                answers: Object.fromEntries(
                  Object.entries(answers).map(([id, option]) => [id, choice(option)]),
                ),
              },
              version(rowVersion),
            ),
          )
        ).rowVersion
      return ok(await submit(attempt.id, cookie, rowVersion))
    }
    // Deniz önce hepsini doğru, sonra yalnız okumayı doğru yapar: son deneme gösterilir (1 / 4).
    await solve(practice, t.cookies.student, { [t.reading]: 'b', [t.listening]: 'c' })
    at(MINUTE)
    await solve(practice, t.cookies.student, { [t.reading]: 'b', [t.listening]: 'a' })
    await solve(unitless, t.cookies.student, { [t.reading]: 'b', [t.listening]: 'c' })
    await solve(evaluation, t.cookies.student, { [t.reading]: 'b', [t.listening]: 'c' })
    // Can (9-B) hepsini doğru yapar; Deniz'in süren üçüncü denemesi sayılmaz.
    await solve(practice, t.cookies.otherStudent, { [t.reading]: 'b', [t.listening]: 'c' })
    await ok(await start(practice, t.cookies.student), 201)

    const admin = await ok(await gradebook(t.cookies.admin))
    assert.deepEqual(
      // Aynı anda açılan atamaların sırası kimliğe bağlıdır; içerik karşılaştırılır.
      admin.assignments
        .map((row: Json) => [row.id === practice ? 'practice' : 'unitless', row.unit, row.learners])
        .sort(),
      [
        ['practice', UNIT, 2],
        ['unitless', null, 1],
      ],
    )
    assert.deepEqual(
      admin.learners.map((row: Json) => [row.learnerId, row.learnerName]),
      [
        ['s-1', 'Deniz Yılmaz'],
        ['s-3', 'Can Arslan'],
      ],
    )
    const deniz = admin.learners[0]
    assert.equal(deniz.sets, 2)
    assert.deepEqual(
      [deniz.overall.earned, deniz.overall.possible, deniz.overall.percent],
      [5, 8, 63],
    )
    // Ünitesiz set yalnız genel toplamda.
    assert.deepEqual(deniz.units, [
      { ...UNIT, sets: 1, items: 2, earned: 1, possible: 4, percent: 25 },
    ])
    assert.deepEqual(
      deniz.skills.map((row: Json) => [row.skill, row.earned, row.possible]),
      [
        ['reading', 2, 2],
        ['listening', 3, 6],
      ],
    )
    assert.deepEqual(
      deniz.outcomes.map((row: Json) => [row.outcomeId, row.earned, row.possible]),
      [
        [SET_OUTCOME.outcomeId, 3, 6],
        [ITEM_OUTCOME.outcomeId, 2, 2],
      ],
    )
    assert.deepEqual(
      // Toplamda `sets` sonuç sayısıdır (kursiyer × alıştırma).
      [admin.totals.overall.earned, admin.totals.overall.possible, admin.totals.sets],
      [9, 12, 3],
    )
    assert.equal(admin.truncated, false)

    // 9-A öğretmeni iki atamayı da görür; 9-B öğretmeni yalnız kendi sınıfını hedefleyen atamayı.
    const teacher = await ok(await gradebook(t.cookies.teacher))
    assert.deepEqual(teacher.totals, admin.totals)
    const other = await ok(await gradebook(t.cookies.otherTeacher))
    assert.deepEqual(
      other.assignments.map((row: Json) => row.id),
      [practice],
    )
    assert.deepEqual(
      [other.totals.sets, other.totals.overall.earned, other.totals.overall.possible],
      [2, 5, 8],
    )

    // Hedef süzgeci; öğrenci yalnız kendi sonucunu görür.
    const filtered = await ok(await gradebook(t.cookies.admin, '?targetId=9-B'))
    assert.deepEqual(
      filtered.assignments.map((row: Json) => row.id),
      [practice],
    )
    const student = await ok(await gradebook(t.cookies.otherStudent))
    assert.deepEqual(
      student.learners.map((row: Json) => [row.learnerId, row.learnerName, row.overall.percent]),
      [['s-3', null, 100]],
    )
    assert.deepEqual(
      student.assignments.map((row: Json) => [row.id, row.learners]),
      [[practice, 1]],
    )
  })

  test('DOM-BEC-048: not defteri hedef ve otomatik puan süzgecini sınırdan önce uygular; süzgeç dışı çok sayıda yeni atama eski hedef setini gizlemez', async () => {
    const t = await tenant()
    const old = await assign(t, {}, [{ kind: 'class', id: '9-B' }], t.setId, t.cookies.admin)
    const attempt = await ok(await start(old, t.cookies.otherStudent), 201)
    await ok(await submit(attempt.id, t.cookies.otherStudent, attempt.rowVersion))
    // Daha yeni, 9-A hedefli ve sınırı aşan alıştırmalar (aynı içerik kopyaları, doğrudan yazılır).
    const [source] = await db.select().from(taskAssignments).where(eq(taskAssignments.id, old))
    const fillers = Array.from({ length: GRADEBOOK_ASSIGNMENT_LIMIT + 1 }, (_, index) => ({
      ...source!,
      id: randomUUID(),
      createdAt: new Date(FIXED_NOW.getTime() + (index + 1) * MINUTE),
    }))
    await db.insert(taskAssignments).values(fillers)
    await db.insert(taskAssignmentTargets).values(
      fillers.map((row) => ({
        institutionId: t.institution.id,
        assignmentId: row.id,
        targetKind: 'class' as const,
        targetId: '9-A',
      })),
    )

    const filtered = await ok(await gradebook(t.cookies.admin, '?targetId=9-B'))
    assert.deepEqual(
      filtered.assignments.map((row: Json) => [row.id, row.learners]),
      [[old, 1]],
    )
    assert.equal(filtered.totals.sets, 1)
    assert.equal(filtered.truncated, false)
    // Süzgeçsiz okuma yalnız en yeni sınır kadar atamayı alır ve bunu söyler.
    const all = await ok(await gradebook(t.cookies.admin))
    assert.equal(all.truncated, true)
    assert.equal(all.assignments.length, GRADEBOOK_ASSIGNMENT_LIMIT)
    assert.ok(!all.assignments.some((row: Json) => row.id === old))
  })

  test('DOM-BEC-048: başka kurumun alıştırma sonuçları not defterine girmez', async () => {
    const t = await tenant()
    const practice = await assign(t)
    const attempt = await ok(await start(practice, t.cookies.student), 201)
    await ok(await submit(attempt.id, t.cookies.student, attempt.rowVersion))
    const outsider = await ok(
      await gradebook(await signInAs(app, (await createInstitution(app)).admin)),
    )
    assert.deepEqual([outsider.assignments, outsider.learners], [[], []])
    assert.equal(outsider.totals.sets, 0)
  })
})
