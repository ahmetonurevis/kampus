import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import { gradeQuiz } from '@kampus/school-core/lib/domain.ts'
import { quizStatistics } from '@kampus/school-core/lib/quiz.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { records } from '../src/db/schema/records.ts'
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
 * Quiz uçları (IST-095; docs/domain/akademik-olcme.md DOM-AKD-075…079). Her test kendi kurumunu
 * örnek veri kesitiyle kurar: 7-A (c1) ve 5-A (c2). Deniz (s1) ve Nehir (s25) 7-A'da, Ece (s2)
 * 5-A'dadır. Selin Kaya (t1) iki sınıfın matematiğine, Ahmet Yıldırım (t2) Türkçesine, t4
 * sosyaline, t11 İngilizcesine girer; Emre Demir (t5) bu sınıflara girmez. Örnek quizler: quiz1
 * (c1 matematik, t1) ve quiz6 (c2 matematik) denemeli; quiz4 (c1 sosyal, t4) ve quiz5 (c1
 * İngilizce, t11) denemesiz, süre 20 dakika. FIXED_NOW 2026-10-06T09:00Z.
 */

const SEED = createSeed(FIXED_NOW)
const CLASS_IDS = ['c1', 'c2']
const STUDENT_IDS = new Set(
  SEED.students.filter((item) => CLASS_IDS.includes(item.classId)).map((item) => item.id),
)
const QUIZZES = SEED.quizzes.filter((item) => CLASS_IDS.includes(item.classId))
const QUESTION_IDS = new Set(QUIZZES.flatMap((quiz) => quiz.questionIds))
const BANK = SEED.bank.filter(
  (question) => QUESTION_IDS.has(question.id) || question.subjectId === 'math',
)
type Sample = Partial<Record<CollectionName, readonly Record<string, unknown>[]>>
const SAMPLE: Sample = {
  subjects: SEED.subjects,
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASS_IDS.includes(item.id)),
  students: SEED.students.filter((item) => STUDENT_IDS.has(item.id)),
  assignments: SEED.assignments.filter((item) => CLASS_IDS.includes(item.classId)),
  bank: BANK,
  quizzes: QUIZZES,
  quizAttempts: SEED.quizAttempts.filter((item) => STUDENT_IDS.has(item.studentId)),
}

/** Yalnız B kurumunda bulunan quiz (çapraz kurum). */
const ONLY_B: Sample = {
  quizzes: [
    {
      id: 'quiz-only-b',
      title: 'B kurumunun quizi',
      classId: 'c1',
      subjectId: 'math',
      teacherId: 't1',
      subject: 'Matematik',
      questionIds: ['q-math-7-0'],
      duration: 20,
      createdAt: '2026-10-01T09:00:00.000Z',
    },
  ],
}

function rows(sample: Sample) {
  return Object.entries(sample).flatMap(([collection, items]) =>
    (items ?? []).map((data) => {
      const name = collection as CollectionName
      const id = recordKey(name, data)
      if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
      return { collection: name, id, data }
    }),
  )
}

const quizById = (id: string) => {
  const quiz = QUIZZES.find((item) => item.id === id)
  assert.ok(quiz, `${id} örnek veride yok`)
  return quiz
}
const bankQuestion = (id: string) => {
  const question = SEED.bank.find((item) => item.id === id)
  assert.ok(question, `${id} bankada yok`)
  return question
}

const NEW_QUIZ = {
  classId: 'c1',
  title: 'Rasyonel sayılar kısa sınavı',
  duration: 15,
  questionIds: ['q-math-7-0', 'q-math-7-1', 'q-math-7-2'],
}
/** Öğrenci ve veli yanıtında hiç bulunmaması gereken alan adları (DOM-AKD-078). */
const KEY_FIELDS = ['answer', 'answerKey', 'explanation', 'correct']
const EXPLANATIONS = SEED.bank
  .filter((question) => QUESTION_IDS.has(question.id) || NEW_QUIZ.questionIds.includes(question.id))
  .map((question) => question.explanation)
  .filter((text): text is string => typeof text === 'string' && text.length > 12)

type Json = ReturnType<typeof JSON.parse>
const minutes = (n: number) => new Date(FIXED_NOW.getTime() + n * 60_000)

function fieldNames(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) fieldNames(item, out)
  else if (typeof value === 'object' && value !== null)
    for (const [key, item] of Object.entries(value)) {
      out.add(key)
      // Cevap eşlemesinin anahtarları soru kimlikleridir; değerleri öğrencinin kendi şıkları.
      if (key !== 'answers') fieldNames(item, out)
    }
  return out
}

describe('quiz uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let now = FIXED_NOW
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-quiz-${String(++serial).padStart(5, '0')}` })

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}, extra: Sample = {}) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, rows({ ...SAMPLE }), FIXED_NOW)
    await insertMissingRecords(db, created.id, rows(extra), FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }
  async function member(institutionId: string, role: Role, links: MembershipLinkInput[] = []) {
    const user = await createMember(app, institutionId, role, links)
    return signInAs(app, user)
  }
  const student = (institutionId: string, studentId = 's1') =>
    member(institutionId, 'ogrenci', [{ kind: 'student', recordId: studentId }])
  const parent = (institutionId: string, studentId = 's1') =>
    member(institutionId, 'veli', [{ kind: 'child', recordId: studentId }])
  const teacher = (institutionId: string, teacherId: string) =>
    member(institutionId, 'ogretmen', [{ kind: 'teacher', recordId: teacherId }])

  function send(
    method: 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string | null,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      headers: {
        origin: TEST_ORIGIN,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie === null ? {} : { cookie }),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    })
  }
  const read = (cookie: string | null, url: string) =>
    app.inject({
      method: 'GET',
      url,
      headers: { origin: TEST_ORIGIN, ...(cookie === null ? {} : { cookie }) },
    })
  const ifMatch = (version: number): Record<string, string> => ({
    'if-match': `"${String(version)}"`,
  })
  const create = (
    cookie: string | null,
    body: unknown = NEW_QUIZ,
    headers: Record<string, string> = key(),
  ) => send('POST', '/api/v1/quizzes', cookie, body, headers)
  const patch = (cookie: string, id: string, body: unknown, headers: Record<string, string>) =>
    send('PATCH', `/api/v1/quizzes/${id}`, cookie, body, headers)
  const archive = (cookie: string, id: string, headers: Record<string, string>) =>
    send('DELETE', `/api/v1/quizzes/${id}`, cookie, undefined, headers)
  const start = (cookie: string, id: string, headers: Record<string, string> = key()) =>
    send('POST', `/api/v1/quizzes/${id}/attempt`, cookie, undefined, headers)
  const submit = (
    cookie: string,
    id: string,
    body: unknown,
    headers: Record<string, string> = key(),
  ) => send('POST', `/api/v1/quizzes/${id}/attempt/submit`, cookie, body, headers)

  function assertError(
    response: Awaited<ReturnType<typeof read>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const outcome = (response: Awaited<ReturnType<typeof read>>) => {
    const body = response.json() as { code?: string; message?: string }
    return [response.statusCode, body.code, body.message]
  }
  const snapshot = async (institutionId: string) =>
    (
      await loadRecords(db, institutionId, ['quizzes', 'quizAttempts', 'grades'], {
        includeArchived: true,
      })
    )
      .map((row) => [row.collection, row.id, row.version, row.archivedAt, row.data])
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
  /** Başarısız isteklerden sonra quiz ve denemeler (veri, sürüm, arşiv) aynı kalır. */
  async function unchanged(institutionId: string, action: () => Promise<void>) {
    const before = await snapshot(institutionId)
    await action()
    assert.deepEqual(await snapshot(institutionId), before)
  }
  const versionOf = async (institutionId: string, id: string) => {
    const row = await findRecord(db, institutionId, 'quizzes', id)
    assert.ok(row, `quizzes/${id} yok`)
    return row.version
  }
  const ids = (response: Awaited<ReturnType<typeof read>>) =>
    (response.json().data as { id: string }[]).map((item) => item.id)

  /** Yanıtta cevap anahtarı, açıklama ve soru bazında doğru/yanlış yok (DOM-AKD-078). */
  function assertKeyless(response: Awaited<ReturnType<typeof read>>, label: string) {
    assert.ok(response.statusCode < 300, `${label}: ${response.body}`)
    const names = fieldNames(response.json())
    for (const field of KEY_FIELDS) assert.ok(!names.has(field), `${label}: ${field} alanı döndü`)
    for (const text of EXPLANATIONS)
      assert.ok(!response.body.includes(text), `${label}: çözüm açıklaması döndü`)
  }

  /** İlk `right` soruyu doğru, gerisini yanlış cevaplar; beklenen sonuç core puanlamasıdır. */
  function answersFor(questionIds: readonly string[], right: number) {
    const answers: Record<string, number> = {}
    questionIds.forEach((id, index) => {
      const question = bankQuestion(id)
      answers[id] =
        index < right ? question.answer : (question.answer + 1) % question.options.length
    })
    const bank = SEED.bank.filter((question) => questionIds.includes(question.id))
    return { answers, expected: gradeQuiz({ questionIds }, bank, answers) }
  }

  // --- Kimlik, rol, modül ----------------------------------------------------------------------

  test('oturumsuz istek 401', async () => {
    assertError(await read(null, '/api/v1/quizzes'), 401)
    assertError(await read(null, '/api/v1/quizzes/quiz1'), 401)
    assertError(await create(null), 401)
  })

  test('DOM-YTK-040: learning modülü kapalıyken bütün quiz uçları 403 module_disabled', async () => {
    const a = await institution({ enabledModules: { learning: false } })
    const t1 = await teacher(a.id, 't1')
    const s1 = await student(a.id)
    await unchanged(a.id, async () => {
      assertError(await read(a.adminCookie, '/api/v1/quizzes'), 403, 'module_disabled')
      assertError(await read(a.adminCookie, '/api/v1/quizzes/quiz1'), 403, 'module_disabled')
      assertError(await create(t1), 403, 'module_disabled')
      assertError(await patch(t1, 'quiz4', { title: 'Yeni' }, ifMatch(1)), 403, 'module_disabled')
      assertError(await archive(t1, 'quiz4', ifMatch(1)), 403, 'module_disabled')
      assertError(await start(s1, 'quiz4'), 403, 'module_disabled')
      assertError(await submit(s1, 'quiz4', { answers: {} }), 403, 'module_disabled')
    })
  })

  test('DOM-AKD-075, DOM-AKD-077: ön büro okuyamaz, öğrenci ve veli quiz hazırlayamaz, öğretmen ve veli çözemez (403)', async () => {
    const a = await institution()
    const frontDesk = await member(a.id, 'onburo')
    const p1 = await parent(a.id)
    const t4 = await teacher(a.id, 't4')
    await unchanged(a.id, async () => {
      assertError(await read(frontDesk, '/api/v1/quizzes'), 403, 'forbidden')
      assertError(await read(frontDesk, '/api/v1/quizzes/quiz1'), 403, 'forbidden')
      assertError(await create(await student(a.id)), 403, 'forbidden')
      assertError(await create(p1), 403, 'forbidden')
      assertError(await start(t4, 'quiz4'), 403, 'forbidden')
      assertError(await start(p1, 'quiz4'), 403, 'forbidden')
      assertError(await submit(p1, 'quiz1', { answers: {} }), 403, 'forbidden')
    })
  })

  // --- CRUD ------------------------------------------------------------------------------------

  test('DOM-AKD-075, DOM-AKD-076: öğretmen quiz hazırlar, anahtarla okur, düzenler ve denemesiz quizi arşivler', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const created = await create(t1, { ...NEW_QUIZ, dueDate: '2026-10-20T23:59:00+03:00' })
    assert.equal(created.statusCode, 201, created.body)
    const quiz = created.json().data as Json
    const id = quiz.id as string
    assert.equal(created.headers.location, `/api/v1/quizzes/${id}`)
    assert.equal(quiz.version, 1)
    assert.equal(quiz.classId, 'c1')
    assert.equal(quiz.subjectId, 'math')
    assert.equal(quiz.teacherId, 't1')
    assert.equal(quiz.dueDate, '2026-10-20T20:59:00.000Z')
    assert.equal(quiz.questionCount, 3)
    assert.equal(quiz.status, 'open')

    const detail = await read(t1, `/api/v1/quizzes/${id}`)
    assert.equal(detail.statusCode, 200, detail.body)
    const data = detail.json().data as Json
    assert.deepEqual(
      (data.questions as Json[]).map((q) => q.id),
      NEW_QUIZ.questionIds,
    )
    assert.deepEqual(
      (data.answerKey as Json[]).map((k) => [k.questionId, k.answer]),
      NEW_QUIZ.questionIds.map((qid) => [qid, bankQuestion(qid).answer]),
    )
    assert.deepEqual(data.attempts, [])
    assert.deepEqual(data.statistics, { started: 0, scored: 0, inProgress: 0, average: null })

    const list = await read(t1, '/api/v1/quizzes?classId=c1&status=open&pageSize=100')
    assert.equal(list.statusCode, 200, list.body)
    assert.ok(ids(list).includes(id))
    assert.equal(ids(list)[0], id, 'en yeni quiz başta')

    const edited = await patch(
      t1,
      id,
      { title: 'Rasyonel sayılar tekrar', duration: 25, questionIds: ['q-math-7-3'] },
      ifMatch(1),
    )
    assert.equal(edited.statusCode, 200, edited.body)
    assert.equal(edited.json().data.version, 2)
    assert.equal(edited.json().data.title, 'Rasyonel sayılar tekrar')
    assert.equal(edited.json().data.duration, 25)
    assert.deepEqual(edited.json().data.questionIds, ['q-math-7-3'])
    const undated = await patch(t1, id, { dueDate: null }, ifMatch(2))
    assert.equal(undated.statusCode, 200, undated.body)
    assert.equal(undated.json().data.dueDate, null)

    const archived = await archive(t1, id, ifMatch(3))
    assert.equal(archived.statusCode, 200, archived.body)
    assertError(await read(t1, `/api/v1/quizzes/${id}`), 404, 'not_found')
    const audits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.entityId, id)))
    assert.deepEqual(audits.map((row) => row.action).sort(), [
      'quiz.archive',
      'quiz.create',
      'quiz.update',
      'quiz.update',
    ])
  })

  test('DOM-AKD-075: geçmiş son tarih, ders ve düzey dışı soru, bankada olmayan soru 422; sınıf düzenlenmez (400)', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    await unchanged(a.id, async () => {
      assertError(
        await create(t1, { ...NEW_QUIZ, dueDate: '2026-10-01T09:00:00Z' }),
        422,
        'quiz_due_in_past',
      )
      assertError(await create(a.adminCookie, NEW_QUIZ), 422, 'quiz_subject_required')
      // 5. sınıf sorusu 7-A'ya, Türkçe sorusu matematik quizine konmaz.
      assertError(
        await create(t1, { ...NEW_QUIZ, questionIds: ['q-math-5-0'] }),
        422,
        'quiz_question_mismatch',
      )
      assertError(
        await create(t1, { ...NEW_QUIZ, questionIds: ['q-yok'] }),
        422,
        'quiz_question_unavailable',
      )
      assertError(await create(t1, { ...NEW_QUIZ, duration: 3 }), 400, 'validation_failed')
      assertError(await patch(t1, 'quiz4', { classId: 'c2' }, ifMatch(1)), 400, 'validation_failed')
      assertError(await patch(t1, 'quiz4', {}, ifMatch(1)), 400, 'validation_failed')
    })
    const byAdmin = await create(a.adminCookie, { ...NEW_QUIZ, subjectId: 'math' })
    assert.equal(byAdmin.statusCode, 201, byAdmin.body)
    assert.equal(byAdmin.json().data.teacherId, 't1')
  })

  test('Idempotency-Key: oluşturma, başlatma ve gönderimde zorunlu, aynı anahtar ilk yanıtı tekrarlar; If-Match 400', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const s1 = await student(a.id)
    await unchanged(a.id, async () => {
      assertError(await create(t1, NEW_QUIZ, {}), 400, 'idempotency_key_required')
      assertError(
        await create(t1, NEW_QUIZ, { ...key(), ...ifMatch(1) }),
        400,
        'if_match_not_supported',
      )
      assertError(await start(s1, 'quiz4', {}), 400, 'idempotency_key_required')
      assertError(await submit(s1, 'quiz4', { answers: {} }, {}), 400, 'idempotency_key_required')
    })
    const headers = key()
    const first = await create(t1, NEW_QUIZ, headers)
    const second = await create(t1, NEW_QUIZ, headers)
    assert.equal(first.statusCode, 201, first.body)
    assert.equal(second.statusCode, 201, second.body)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.deepEqual(second.json(), first.json())
    const created = (await loadRecords(db, a.id, ['quizzes'])).filter(
      (row) => row.data.title === NEW_QUIZ.title,
    )
    assert.equal(created.length, 1)
  })

  test('If-Match: düzenleme ve arşivde zorunlu (400); bayat sürüm 409, kayıt değişmez', async () => {
    const a = await institution()
    const t4 = await teacher(a.id, 't4')
    await unchanged(a.id, async () => {
      assertError(await patch(t4, 'quiz4', { title: 'Yeni başlık' }, {}), 400, 'if_match_required')
      assertError(await archive(t4, 'quiz4', {}), 400, 'if_match_required')
      assertError(
        await patch(t4, 'quiz4', { title: 'Yeni başlık' }, ifMatch(7)),
        409,
        'version_conflict',
      )
      assertError(await archive(t4, 'quiz4', ifMatch(7)), 409, 'version_conflict')
    })
  })

  // --- Kapsam ----------------------------------------------------------------------------------

  test('DOM-AKD-075, DOM-AKD-076: başka sınıfın ve branşın öğretmeni quiz hazırlayamaz ve düzenleyemez', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const t2 = await teacher(a.id, 't2')
    const t5 = await teacher(a.id, 't5')
    await unchanged(a.id, async () => {
      // Derse girmediği sınıf.
      assertError(await create(t5, { ...NEW_QUIZ, subjectId: 'math' }), 403, 'quiz_scope_denied')
      // Girdiği sınıfın başka branşı.
      assertError(await create(t1, { ...NEW_QUIZ, subjectId: 'turkish' }), 403, 'quiz_scope_denied')
      // Aynı sınıfa başka dersle giren öğretmen quizi görür ama yazamaz; görmeyen için 404.
      assertError(
        await patch(t2, 'quiz4', { title: 'Yeni başlık' }, ifMatch(1)),
        403,
        'quiz_not_owner',
      )
      assertError(await archive(t2, 'quiz4', ifMatch(1)), 403, 'quiz_not_owner')
      assertError(await patch(t5, 'quiz4', { title: 'Yeni başlık' }, ifMatch(1)), 404, 'not_found')
      assertError(await read(t5, '/api/v1/quizzes/quiz4'), 404, 'not_found')
    })
  })

  test('DOM-AKD-079: öğrenci başkasının denemesini, veli başka çocuğun denemesini görmez; başka sınıfın quizi 404', async () => {
    const a = await institution()
    const s1 = await student(a.id, 's1')
    const s25 = await student(a.id, 's25')
    const p1 = await parent(a.id, 's1')

    const own = await read(s25, '/api/v1/quizzes/quiz1')
    assert.equal(own.statusCode, 200, own.body)
    const ownData = own.json().data as Json
    assert.deepEqual(
      (ownData.attempts as Json[]).map((attempt) => attempt.studentId),
      ['s25'],
    )
    assert.equal(ownData.statistics, null, 'öğrenci sınıf ortalamasını görmez')
    // Başka sınıfın quizi olmayan quizle aynı 404; başlatılamaz.
    assert.deepEqual(
      outcome(await read(s1, '/api/v1/quizzes/quiz6')),
      outcome(await read(s1, '/api/v1/quizzes/quiz-yok')),
    )
    assertError(await read(s1, '/api/v1/quizzes/quiz6'), 404, 'not_found')
    await unchanged(a.id, async () => {
      assertError(await start(await student(a.id, 's2'), 'quiz4'), 404, 'not_found')
    })

    const parentList = await read(p1, '/api/v1/quizzes?pageSize=100')
    assert.equal(parentList.statusCode, 200, parentList.body)
    const items = parentList.json().data as Json[]
    assert.ok(items.length > 0)
    assert.ok(
      items.every((item) => item.classId === 'c1'),
      'veli yalnız çocuğunun sınıfı',
    )
    assert.ok(items.every((item) => item.statistics === null))
    assert.ok(
      items
        .flatMap((item) => item.attempts as Json[])
        .every((attempt) => attempt.studentId === 's1'),
    )
    assertError(await read(p1, '/api/v1/quizzes/quiz6'), 404, 'not_found')

    // Genel koleksiyon okuması da aynı kapsamdadır.
    const collection = await read(s25, '/api/v1/collections/quizAttempts?pageSize=100')
    assert.equal(collection.statusCode, 200, collection.body)
    assert.ok((collection.json().data as Json[]).every((item) => item.record.studentId === 's25'))
  })

  // --- Çapraz kurum ----------------------------------------------------------------------------

  test('IST-002, DOM-AKD-076: başka kurumun quizi olmayan kimlikle aynı 404, B değişmez', async () => {
    const a = await institution()
    const b = await institution({}, ONLY_B)
    const t1 = await teacher(a.id, 't1')
    const s1 = await student(a.id, 's1')
    const calls = [
      (id: string) => read(a.adminCookie, `/api/v1/quizzes/${id}`),
      (id: string) => patch(t1, id, { title: 'Yeni başlık' }, ifMatch(1)),
      (id: string) => archive(t1, id, ifMatch(1)),
      (id: string) => start(s1, id),
      (id: string) => submit(s1, id, { answers: {} }),
    ]
    await unchanged(a.id, () =>
      unchanged(b.id, async () => {
        for (const call of calls) {
          const foreign = await call('quiz-only-b')
          assertError(foreign, 404, 'not_found')
          assert.deepEqual(outcome(foreign), outcome(await call('quiz-yok')))
        }
        const list = await read(a.adminCookie, '/api/v1/quizzes?pageSize=100')
        assert.equal(list.statusCode, 200, list.body)
        assert.ok(!ids(list).includes('quiz-only-b'))
      }),
    )
    // Aynı istek A'nın kendi kaydında çalışır: 404 rol ya da gövdeden gelmiyor.
    assert.equal((await read(a.adminCookie, '/api/v1/quizzes/quiz1')).statusCode, 200)
  })

  test('IST-002: gövdedeki institutionId 400, kayıt yazılmaz', async () => {
    const a = await institution()
    const b = await institution()
    const t1 = await teacher(a.id, 't1')
    await unchanged(a.id, () =>
      unchanged(b.id, async () => {
        assertError(
          await create(t1, { ...NEW_QUIZ, institutionId: b.id }),
          400,
          'validation_failed',
        )
      }),
    )
  })

  // --- Çözme ve puanlama -----------------------------------------------------------------------

  test('DOM-AKD-077, DOM-AKD-078: öğrenci başlatır, cevaplardan puan alır; anahtar öğrenci ve veliye hiç dönmez', async () => {
    const a = await institution()
    const s1 = await student(a.id, 's1')
    const p1 = await parent(a.id, 's1')
    const t4 = await teacher(a.id, 't4')
    const quiz = quizById('quiz4')

    // Başlatmadan önce soru metni yok; veli de görmez.
    const before = await read(s1, '/api/v1/quizzes/quiz4')
    assertKeyless(before, 'başlatma öncesi ayrıntı')
    assert.equal(before.json().data.questions, null)

    const started = await start(s1, 'quiz4')
    assert.equal(started.statusCode, 201, started.body)
    assertKeyless(started, 'başlatma')
    assert.equal(started.headers.location, '/api/v1/quizzes/quiz4')
    const attempt = started.json().data.attempt as Json
    assert.equal(attempt.status, 'in_progress')
    assert.equal(attempt.result, null)
    assert.deepEqual(attempt.answers, {})
    assert.equal(attempt.expiresAt, minutes(quiz.duration).toISOString())
    assert.deepEqual(
      (started.json().data.questions as Json[]).map((q) => Object.keys(q).sort()),
      quiz.questionIds.map(() => ['id', 'options', 'text', 'topic']),
    )
    // Yeniden açmak süreyi baştan başlatmaz: aynı deneme 200.
    const reopened = await start(s1, 'quiz4')
    assert.equal(reopened.statusCode, 200, reopened.body)
    assert.equal(reopened.json().data.attempt.id, attempt.id)
    assert.equal(reopened.json().data.attempt.expiresAt, attempt.expiresAt)
    assertKeyless(await read(s1, '/api/v1/quizzes/quiz4'), 'süren deneme ayrıntısı')
    assert.equal((await read(p1, '/api/v1/quizzes/quiz4')).json().data.questions, null)

    // Denemesi olan quizin soruları değişmez, quiz arşivlenmez (DOM-AKD-076).
    await unchanged(a.id, async () => {
      assertError(
        await patch(t4, 'quiz4', { questionIds: quiz.questionIds.slice(1) }, ifMatch(1)),
        409,
        'quiz_has_attempts',
      )
      assertError(await archive(t4, 'quiz4', ifMatch(1)), 409, 'quiz_has_attempts')
    })
    // Başlık düzenlemesi serbesttir.
    const version = await versionOf(a.id, 'quiz4')
    const renamed = await patch(t4, 'quiz4', { title: 'Sosyal tekrar' }, ifMatch(version))
    assert.equal(renamed.statusCode, 200, renamed.body)
    assert.equal(renamed.json().data.version, version + 1)

    // İstemci puanı kabul edilmez: puan alanı ve quizde olmayan soru reddedilir.
    const { answers, expected } = answersFor(quiz.questionIds, 2)
    await unchanged(a.id, async () => {
      assertError(await submit(s1, 'quiz4', { answers, score: 100 }), 400, 'validation_failed')
      assertError(
        await submit(s1, 'quiz4', { answers: { ...answers, 'q-yok': 0 } }),
        422,
        'quiz_answer_invalid',
      )
    })
    const headers = key()
    const submitted = await submit(s1, 'quiz4', { answers }, headers)
    assert.equal(submitted.statusCode, 200, submitted.body)
    assertKeyless(submitted, 'gönderim')
    const result = submitted.json().data as Json
    assert.equal(result.status, 'completed')
    assert.deepEqual(result.answers, answers)
    assert.deepEqual(result.result, {
      score: expected.score,
      correctCount: expected.correct,
      total: expected.total,
      topicScores: expected.topicScores,
    })
    // Ağ yinelemesi aynı anahtarla ilk yanıtı alır; yeni anahtarla ikinci gönderim 409.
    const replay = await submit(s1, 'quiz4', { answers }, headers)
    assert.equal(replay.statusCode, 200)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), submitted.json())
    await unchanged(a.id, async () => {
      const all = answersFor(quiz.questionIds, quiz.questionIds.length).answers
      assertError(await submit(s1, 'quiz4', { answers: all }), 409, 'quiz_already_submitted')
      assertError(await start(s1, 'quiz4'), 409, 'quiz_already_attempted')
    })

    // Sonuçlanınca öğrenci ve veli soruları anahtarsız, sonucu kendi cevaplarıyla görür.
    for (const [label, cookie] of [
      ['öğrenci', s1],
      ['veli', p1],
    ] as const) {
      const detail = await read(cookie, '/api/v1/quizzes/quiz4')
      assertKeyless(detail, `${label} ayrıntısı`)
      assert.equal((detail.json().data.questions as Json[]).length, quiz.questionIds.length)
      assert.equal(detail.json().data.attempts[0].result.score, expected.score)
      const list = await read(cookie, '/api/v1/quizzes?pageSize=100')
      assertKeyless(list, `${label} listesi`)
    }
    // Öğretmen anahtarı ve denemeyi öğrenci adıyla görür.
    const staff = (await read(t4, '/api/v1/quizzes/quiz4')).json().data as Json
    assert.equal(staff.answerKey.length, quiz.questionIds.length)
    const row = (staff.attempts as Json[]).find((item) => item.studentId === 's1')
    assert.equal(row?.studentName, SEED.students.find((s) => s.id === 's1')?.name)
    assert.deepEqual(staff.statistics, {
      started: 1,
      scored: 1,
      inProgress: 0,
      average: expected.score,
    })
  })

  test('DOM-AKD-078, DOM-AKD-079: sonuç ve ortalama cevaplardan hesaplanır, kayıttaki puan okunmaz', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const quiz = quizById('quiz1')
    const attempts = SEED.quizAttempts.filter((item) => item.quizId === 'quiz1')
    const bank = SEED.bank.filter((question) => quiz.questionIds.includes(question.id))
    const expected = quizStatistics(quiz, attempts, bank, FIXED_NOW.toISOString())
    // Kayıttaki kopyalar bozulsa da (istemci ya da eski görünüm) sonuç cevaplardan gelir.
    await db.execute(
      sql`UPDATE records SET data = jsonb_set(data, '{score}', '100'::jsonb)
          WHERE institution_id = ${a.id} AND collection = 'quizAttempts'`,
    )
    const list = await read(t1, '/api/v1/quizzes?classId=c1&subjectId=math&pageSize=100')
    assert.equal(list.statusCode, 200, list.body)
    const item = (list.json().data as Json[]).find((row) => row.id === 'quiz1')
    assert.deepEqual(item?.statistics, expected)
    assert.ok(expected.average !== null && expected.average < 100)
    assert.deepEqual(item?.attempts, [], 'öğretmen listesi denemeleri taşımaz')

    const s1 = await student(a.id, 's1')
    const own = SEED.quizAttempts.find((row) => row.quizId === 'quiz1' && row.studentId === 's1')
    assert.ok(own)
    const studentRow = (
      (await read(s1, '/api/v1/quizzes?pageSize=100')).json().data as Json[]
    ).find((row) => row.id === 'quiz1')
    assert.equal(studentRow?.statistics, null)
    assert.equal(studentRow?.attempts[0].result.score, gradeQuiz(quiz, bank, own.answers).score)
  })

  test('DOM-AKD-077: süre sunucuda işler; ağ payı içinde gönderim kabul, sonrası 422 ve deneme 0 ile kalır', async () => {
    const a = await institution()
    const s1 = await student(a.id, 's1')
    const s25 = await student(a.id, 's25')
    const t11 = await teacher(a.id, 't11')
    const quiz = quizById('quiz5')
    try {
      assert.equal((await start(s1, 'quiz5')).statusCode, 201)
      assert.equal((await start(s25, 'quiz5')).statusCode, 201)
      const { answers, expected } = answersFor(quiz.questionIds, quiz.questionIds.length)

      now = new Date(minutes(quiz.duration).getTime() + 30_000)
      const inGrace = await submit(s1, 'quiz5', { answers })
      assert.equal(inGrace.statusCode, 200, inGrace.body)
      assert.equal(inGrace.json().data.result.score, expected.score)

      now = new Date(minutes(quiz.duration).getTime() + 61_000)
      await unchanged(a.id, async () => {
        assertError(await submit(s25, 'quiz5', { answers }), 422, 'quiz_time_expired')
        assertError(await start(s25, 'quiz5'), 409, 'quiz_already_attempted')
      })
      const expired = (await read(s25, '/api/v1/quizzes/quiz5')).json().data.attempts[0] as Json
      assert.equal(expired.status, 'expired')
      assert.equal(expired.result.score, 0)
      const staff = (await read(t11, '/api/v1/quizzes/quiz5')).json().data as Json
      assert.deepEqual(staff.statistics, {
        started: 2,
        scored: 2,
        inProgress: 0,
        average: Math.round(expected.score / 2),
      })
    } finally {
      now = FIXED_NOW
    }
  })

  test('DOM-AKD-077: bitiş anı son tarihi geçmez; son tarihten sonra deneme başlatılamaz (422)', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const due = minutes(60).toISOString()
    const created = await create(t1, { ...NEW_QUIZ, duration: 120, dueDate: due })
    assert.equal(created.statusCode, 201, created.body)
    const id = created.json().data.id as string
    const started = await start(await student(a.id, 's1'), id)
    assert.equal(started.statusCode, 201, started.body)
    assert.equal(started.json().data.attempt.expiresAt, due)
    const s25 = await student(a.id, 's25')
    try {
      now = minutes(120)
      await unchanged(a.id, async () => {
        assertError(await start(s25, id), 422, 'quiz_closed')
      })
      const list = await read(t1, '/api/v1/quizzes?status=closed&pageSize=100')
      assert.ok(ids(list).includes(id))
    } finally {
      now = FIXED_NOW
    }
  })

  test('DOM-AKD-078: süren deneme genel koleksiyon okumasında hiçbir role dönmez; sonuçlanınca döner', async () => {
    const a = await institution()
    const s1 = await student(a.id, 's1')
    const p1 = await parent(a.id, 's1')
    const t4 = await teacher(a.id, 't4')
    const started = await start(s1, 'quiz4')
    assert.equal(started.statusCode, 201, started.body)
    const attemptId = started.json().data.attempt.id as string
    const url = '/api/v1/collections/quizAttempts?quizId=quiz4&pageSize=100'
    for (const cookie of [s1, p1, t4, a.adminCookie]) {
      const list = await read(cookie, url)
      assert.equal(list.statusCode, 200, list.body)
      assert.ok(!ids(list).includes(attemptId), 'süren deneme listede yok')
      assertError(
        await read(cookie, `/api/v1/collections/quizAttempts/${attemptId}`),
        404,
        'not_found',
      )
    }
    // Süzgeçsiz yönetici listesi (SQL sayfası) de toplamda saymaz.
    const whole = await read(a.adminCookie, '/api/v1/collections/quizAttempts?pageSize=100')
    const stored = await loadRecords(db, a.id, ['quizAttempts'])
    assert.equal(whole.json().meta.total, stored.length - 1)

    const { answers } = answersFor(quizById('quiz4').questionIds, 1)
    assert.equal((await submit(s1, 'quiz4', { answers })).statusCode, 200)
    assert.ok(ids(await read(s1, url)).includes(attemptId))
    assert.ok(ids(await read(t4, url)).includes(attemptId))
  })

  test('DOM-AKD-060, DOM-AKD-077: süren deneme nota aktarılmaz (422); gönderimden sonra puan cevaplardan', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const s1 = await student(a.id, 's1')
    const created = await create(t1)
    assert.equal(created.statusCode, 201, created.body)
    const id = created.json().data.id as string
    assert.equal((await start(s1, id)).statusCode, 201)
    const transfer = () =>
      send(
        'POST',
        '/api/v1/grades',
        t1,
        {
          studentId: 's1',
          subjectId: 'math',
          term: 1,
          assessmentType: 'performans',
          date: '2026-10-06',
          quizId: id,
        },
        key(),
      )
    await unchanged(a.id, async () => {
      assertError(await transfer(), 422, 'quiz_not_attempted')
    })
    const { answers, expected } = answersFor(NEW_QUIZ.questionIds, 1)
    assert.equal((await submit(s1, id, { answers })).statusCode, 200)
    const graded = await transfer()
    assert.equal(graded.statusCode, 201, graded.body)
    const grades = (await loadRecords(db, a.id, ['grades'])).filter((row) => row.data.quizId === id)
    assert.deepEqual(
      grades.map((row) => row.data.score),
      [expected.score],
    )
  })

  test('DOM-AKD-077: pasif öğrenci quiz başlatamaz (422)', async () => {
    const a = await institution()
    const s1 = await student(a.id, 's1')
    await db
      .update(records)
      .set({ data: sql`jsonb_set(${records.data}, '{isActive}', 'false'::jsonb)` })
      .where(
        and(
          eq(records.institutionId, a.id),
          eq(records.collection, 'students'),
          eq(records.id, 's1'),
        ),
      )
    await unchanged(a.id, async () => {
      assertError(await start(s1, 'quiz4'), 422, 'student_inactive')
    })
  })
})
