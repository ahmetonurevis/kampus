import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Participant } from '../packages/school-core/src/lib/communication.ts'
import { gradeQuiz } from '../packages/school-core/src/lib/domain.ts'
import { recordGrade } from '../packages/school-core/src/lib/grades.ts'
import {
  QUIZ_SUBMIT_GRACE_SECONDS,
  archiveQuiz,
  canSeeQuizQuestions,
  createQuiz,
  isQuizStaff,
  isScoredAttempt,
  quizAttemptStatus,
  quizAttemptView,
  quizReviewOpen,
  quizStatistics,
  startQuiz,
  submitQuiz,
  updateQuiz,
  withheldAttemptFields,
} from '../packages/school-core/src/lib/quiz.ts'
import { scopeFor, type ScopeSource } from '../packages/school-core/src/lib/scope.ts'
import { isDomainError } from './support/domain-error.ts'

// 2026-10-06 salıdır. Deniz (s1) ve Nehir (s25) 7-A (c1); Ece (s2) 5-A (c2). Selin Kaya (t1)
// c1 ve c2'de matematik, Ahmet Yıldırım (t2) Türkçe; Aylin Özer (t17) matematik ama bu sınıflara
// girmez. quiz1 c1 matematik (t1, c1 öğrencilerinin denemesi var), quiz4 c1 sosyal (t4, denemesiz).
const now = '2026-10-06T10:00:00.000Z'
const minutes = (n: number) => new Date(Date.parse(now) + n * 60_000).toISOString()
const seed = () => createSeed(new Date(now))
let sequence = 0
const id = (prefix: string) => `${prefix}-quiz-test-${++sequence}`

const person = (
  role: Participant['role'],
  kind: 'student' | 'teacher' | 'child',
  recordId: string,
) => ({ role, links: [{ kind, recordId }], userId: `u-${recordId}` }) satisfies Participant
const student = (recordId = 's1') => person('ogrenci', 'student', recordId)
const teacher = (recordId: string) => person('ogretmen', 'teacher', recordId)
const parent = person('veli', 'child', 's1')
const admin: Participant = { role: 'yonetici', links: [], userId: 'u-admin' }
const front: Participant = { role: 'onburo', links: [], userId: 'u-front' }

const QUIZ = {
  classId: 'c1',
  title: 'Denklemler tekrar',
  duration: 15,
  questionIds: ['q-math-7-0', 'q-math-7-1', 'q-math-7-2', 'q-math-7-3'],
}
const zodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'

function unchanged(state: State, action: () => unknown, check: (e: unknown) => boolean) {
  const before = JSON.stringify([state.quizzes, state.quizAttempts])
  assert.throws(action, check)
  assert.equal(JSON.stringify([state.quizzes, state.quizAttempts]), before)
}

/** Bankadaki anahtara göre doğru (ya da `wrong` için yanlış) şık. */
function key(state: State, questionId: string, wrong = false) {
  const question = state.bank.find((q) => q.id === questionId)!
  return wrong ? (question.answer + 1) % question.options.length : question.answer
}

// --- Hazırlama ---------------------------------------------------------------------------------

test('DOM-AKD-075: öğretmen tek dersle girdiği sınıfa bankadan quiz hazırlar; ders ve öğretmen atamadan', () => {
  const state = seed()
  const quiz = createQuiz(
    state,
    teacher('t1'),
    { ...QUIZ, dueDate: '2026-10-09T23:59:00+03:00' },
    id,
    now,
  )
  assert.equal(state.quizzes.at(-1), quiz)
  assert.equal(quiz.subjectId, 'math')
  assert.equal(quiz.teacherId, 't1')
  assert.equal(quiz.subject, 'Matematik')
  assert.equal(quiz.duration, 15)
  assert.equal(quiz.dueDate, '2026-10-09T20:59:00.000Z')
  assert.deepEqual(quiz.questionIds, QUIZ.questionIds)
  assert.deepEqual(quiz.createdBy, { role: 'ogretmen', userId: 'u-t1' })
  // Son tarihsiz quiz alan taşımaz.
  assert.equal('dueDate' in createQuiz(state, teacher('t1'), QUIZ, id, now), false)
})

test('DOM-AKD-075: yönetici dersi seçer, öğretmen sınıfın o dersine atanmış öğretmendir', () => {
  const state = seed()
  const quiz = createQuiz(
    state,
    admin,
    { ...QUIZ, subjectId: 'turkish', questionIds: ['q-turkish-0'] },
    id,
    now,
  )
  assert.equal(quiz.teacherId, 't2')
  unchanged(
    state,
    () => createQuiz(state, admin, QUIZ, id, now),
    isDomainError('quiz_subject_required'),
  )
  unchanged(
    state,
    () => createQuiz(state, admin, { ...QUIZ, subjectId: 'physics' }, id, now),
    isDomainError('quiz_teacher_unavailable'),
  )
  unchanged(
    state,
    () => createQuiz(state, admin, { ...QUIZ, subjectId: 'math', classId: 'yok' }, id, now),
    isDomainError('class_not_found', 'not_found'),
  )
})

test('DOM-AKD-075: bankada olmayan, başka dersin ya da düzeyin sorusu reddedilir; kayıt değişmez', () => {
  const state = seed()
  const t1 = teacher('t1')
  unchanged(
    state,
    () => createQuiz(state, t1, { ...QUIZ, questionIds: ['q-math-7-0', 'q-yok'] }, id, now),
    isDomainError('quiz_question_unavailable'),
  )
  unchanged(
    state,
    () => createQuiz(state, t1, { ...QUIZ, questionIds: ['q-math-5-0'] }, id, now),
    isDomainError('quiz_question_mismatch'),
  )
  unchanged(
    state,
    () => createQuiz(state, t1, { ...QUIZ, questionIds: ['q-turkish-0'] }, id, now),
    isDomainError('quiz_question_mismatch'),
  )
  for (const body of [
    { ...QUIZ, questionIds: [] },
    { ...QUIZ, questionIds: ['q-math-7-0', 'q-math-7-0'] },
    { ...QUIZ, duration: 2 },
    { ...QUIZ, duration: 15.5 },
    { ...QUIZ, title: ' ' },
    { ...QUIZ, teacherId: 't17' },
    { ...QUIZ, dueDate: '2026-10-09' },
  ])
    unchanged(state, () => createQuiz(state, t1, body, id, now), zodError)
  unchanged(
    state,
    () => createQuiz(state, t1, { ...QUIZ, dueDate: now }, id, now),
    isDomainError('quiz_due_in_past'),
  )
  state.classes.find((c) => c.id === 'c1')!.isActive = false
  unchanged(state, () => createQuiz(state, t1, QUIZ, id, now), isDomainError('record_inactive'))
})

test('DOM-AKD-075: başka sınıf ya da branş 403; ön büro, öğrenci ve veli quiz hazırlayamaz', () => {
  const state = seed()
  unchanged(
    state,
    () => createQuiz(state, teacher('t17'), QUIZ, id, now),
    isDomainError('quiz_scope_denied', 'forbidden'),
  )
  unchanged(
    state,
    () => createQuiz(state, teacher('t1'), { ...QUIZ, subjectId: 'turkish' }, id, now),
    isDomainError('quiz_scope_denied', 'forbidden'),
  )
  for (const actor of [front, student(), parent])
    unchanged(
      state,
      () => createQuiz(state, actor, { ...QUIZ, subjectId: 'math' }, id, now),
      isDomainError('permission_denied', 'forbidden'),
    )
})

test('DOM-AKD-075: learning modülü kapalıyken quiz yazılamaz', () => {
  const state = seed()
  state.modules.learning = false
  unchanged(
    state,
    () => createQuiz(state, teacher('t1'), QUIZ, id, now),
    isDomainError('module_disabled', 'forbidden'),
  )
  unchanged(
    state,
    () => startQuiz(state, student(), 'quiz4', id, now),
    isDomainError('module_disabled', 'forbidden'),
  )
})

// --- Düzenleme ve arşiv ------------------------------------------------------------------------

test('DOM-AKD-076: denemesiz quizin soruları, süresi ve son tarihi düzenlenir; null son tarihi kaldırır', () => {
  const state = seed()
  const quiz = createQuiz(state, teacher('t1'), QUIZ, id, now)
  const later = '2026-10-06T11:00:00.000Z'
  updateQuiz(
    state,
    teacher('t1'),
    quiz.id,
    { questionIds: ['q-math-7-5'], duration: 30, dueDate: '2026-10-20T12:00:00Z', title: 'Yeni' },
    later,
  )
  assert.deepEqual(quiz.questionIds, ['q-math-7-5'])
  assert.equal(quiz.duration, 30)
  assert.equal(quiz.dueDate, '2026-10-20T12:00:00.000Z')
  assert.equal(quiz.title, 'Yeni')
  assert.equal(quiz.updatedAt, later)
  updateQuiz(state, admin, quiz.id, { dueDate: null }, later)
  assert.equal('dueDate' in quiz, false)
  unchanged(
    state,
    () => updateQuiz(state, teacher('t1'), quiz.id, { dueDate: now }, now),
    isDomainError('quiz_due_in_past'),
  )
  unchanged(
    state,
    () => updateQuiz(state, teacher('t1'), quiz.id, { questionIds: ['q-math-5-0'] }, now),
    isDomainError('quiz_question_mismatch'),
  )
  for (const body of [{}, { classId: 'c2' }, { subjectId: 'turkish' }, { score: 100 }])
    unchanged(state, () => updateQuiz(state, teacher('t1'), quiz.id, body, now), zodError)
})

test('DOM-AKD-076: denemesi olan quizin soruları değişmez, başlığı ve süresi değişir', () => {
  const state = seed()
  const quiz1 = state.quizzes.find((q) => q.id === 'quiz1')!
  unchanged(
    state,
    () => updateQuiz(state, teacher('t1'), 'quiz1', { questionIds: ['q-math-7-0'] }, now),
    isDomainError('quiz_has_attempts', 'conflict'),
  )
  // Aynı soru listesi değişiklik değildir.
  updateQuiz(
    state,
    teacher('t1'),
    'quiz1',
    { questionIds: [...quiz1.questionIds], duration: 25 },
    now,
  )
  assert.equal(quiz1.duration, 25)
  // Başlatılmış (gönderilmemiş) deneme de soruları kilitler.
  const fresh = createQuiz(state, teacher('t1'), QUIZ, id, now)
  startQuiz(state, student(), fresh.id, id, now)
  unchanged(
    state,
    () => updateQuiz(state, teacher('t1'), fresh.id, { questionIds: ['q-math-7-0'] }, now),
    isDomainError('quiz_has_attempts', 'conflict'),
  )
})

test('DOM-AKD-076: başka dersin öğretmeni 403, quizi görmeyen 404; yönetici düzenler', () => {
  const state = seed()
  unchanged(
    state,
    () => updateQuiz(state, teacher('t2'), 'quiz1', { title: 'Başka' }, now),
    isDomainError('quiz_not_owner', 'forbidden'),
  )
  unchanged(
    state,
    () => updateQuiz(state, teacher('t17'), 'quiz1', { title: 'Başka' }, now),
    isDomainError('quiz_not_found', 'not_found'),
  )
  unchanged(
    state,
    () => archiveQuiz(state, teacher('t17'), 'quiz1'),
    isDomainError('quiz_not_found', 'not_found'),
  )
  unchanged(
    state,
    () => updateQuiz(state, admin, 'quiz-yok', { title: 'Başka' }, now),
    isDomainError('quiz_not_found', 'not_found'),
  )
  for (const actor of [front, student(), parent])
    unchanged(
      state,
      () => updateQuiz(state, actor, 'quiz1', { title: 'Başka' }, now),
      isDomainError('permission_denied', 'forbidden'),
    )
  assert.equal(updateQuiz(state, admin, 'quiz1', { title: 'Yönetici' }, now).title, 'Yönetici')
})

test("DOM-AKD-076: denemesi olan quiz arşivlenmez; denemesiz quiz State'ten çıkar", () => {
  const state = seed()
  unchanged(
    state,
    () => archiveQuiz(state, teacher('t1'), 'quiz1'),
    isDomainError('quiz_has_attempts', 'conflict'),
  )
  unchanged(
    state,
    () => archiveQuiz(state, teacher('t2'), 'quiz4'),
    isDomainError('quiz_not_owner', 'forbidden'),
  )
  const archived = archiveQuiz(state, admin, 'quiz4')
  assert.equal(archived.id, 'quiz4')
  assert.equal(
    state.quizzes.some((q) => q.id === 'quiz4'),
    false,
  )
})

// --- Çözme ------------------------------------------------------------------------------------

test('DOM-AKD-077: deneme başlatılır, süre işler; yenileme aynı denemeyi döndürür', () => {
  const state = seed()
  const first = startQuiz(state, student(), 'quiz4', id, now)
  assert.equal(first.created, true)
  assert.equal(state.quizAttempts.at(-1), first.attempt)
  assert.equal(first.attempt.status, 'started')
  assert.equal(first.attempt.startedAt, now)
  assert.equal(first.attempt.expiresAt, minutes(20))
  assert.equal(first.attempt.score, 0)
  assert.deepEqual(first.attempt.answers, {})
  assert.equal(quizAttemptStatus(first.attempt, now), 'in_progress')
  const again = startQuiz(state, student(), 'quiz4', id, minutes(5))
  assert.equal(again.created, false)
  assert.equal(again.attempt, first.attempt)
  assert.equal(again.attempt.expiresAt, minutes(20))
  assert.equal(state.quizAttempts.filter((a) => a.quizId === 'quiz4').length, 1)
})

test('DOM-AKD-077: tek deneme; ikinci gönderim 409, yeni başlatma 409', () => {
  const state = seed()
  const quiz = state.quizzes.find((q) => q.id === 'quiz4')!
  startQuiz(state, student(), 'quiz4', id, now)
  const answers = Object.fromEntries(quiz.questionIds.map((q) => [q, key(state, q)]))
  const attempt = submitQuiz(state, student(), 'quiz4', { answers }, minutes(10))
  assert.equal(attempt.status, 'completed')
  assert.equal(attempt.submittedAt, minutes(10))
  assert.equal(attempt.date, minutes(10))
  assert.equal(attempt.score, 100)
  assert.equal(quizAttemptStatus(attempt, minutes(10)), 'completed')
  unchanged(
    state,
    () => submitQuiz(state, student(), 'quiz4', { answers: {} }, minutes(11)),
    isDomainError('quiz_already_submitted', 'conflict'),
  )
  unchanged(
    state,
    () => startQuiz(state, student(), 'quiz4', id, minutes(11)),
    isDomainError('quiz_already_attempted', 'conflict'),
  )
  // Eski (alanı olmayan) deneme tamamlanmıştır: quiz1 yeniden başlatılmaz.
  unchanged(
    state,
    () => startQuiz(state, student(), 'quiz1', id, now),
    isDomainError('quiz_already_attempted', 'conflict'),
  )
})

test('DOM-AKD-077: süre ve ağ payı geçince gönderim reddedilir; deneme boş sonuçla kalır', () => {
  const state = seed()
  startQuiz(state, student(), 'quiz4', id, now)
  const grace = new Date(Date.parse(minutes(20)) + QUIZ_SUBMIT_GRACE_SECONDS * 1000).toISOString()
  const late = new Date(Date.parse(grace) + 1000).toISOString()
  unchanged(
    state,
    () => submitQuiz(state, student(), 'quiz4', { answers: {} }, late),
    isDomainError('quiz_time_expired'),
  )
  const attempt = state.quizAttempts.at(-1)!
  assert.equal(quizAttemptStatus(attempt, late), 'expired')
  assert.equal(isScoredAttempt(attempt, late), true)
  unchanged(
    state,
    () => startQuiz(state, student(), 'quiz4', id, late),
    isDomainError('quiz_already_attempted', 'conflict'),
  )
  // Ağ payı içinde gönderim kabul edilir.
  const other = seed()
  startQuiz(other, student(), 'quiz4', id, now)
  assert.equal(submitQuiz(other, student(), 'quiz4', { answers: {} }, grace).status, 'completed')
})

test('DOM-AKD-077: son tarih süreyi kısaltır; son tarihten sonra deneme başlatılmaz', () => {
  const state = seed()
  const quiz = createQuiz(state, teacher('t1'), { ...QUIZ, dueDate: minutes(10) }, id, now)
  const { attempt } = startQuiz(state, student(), quiz.id, id, now)
  assert.equal(attempt.expiresAt, minutes(10))
  unchanged(
    state,
    () => startQuiz(state, student('s25'), quiz.id, id, minutes(10)),
    isDomainError('quiz_closed'),
  )
  unchanged(
    state,
    () => submitQuiz(state, student('s25'), quiz.id, { answers: {} }, minutes(5)),
    isDomainError('quiz_not_started'),
  )
})

test('DOM-AKD-077: başka sınıfın quizi 404; veli, öğretmen ve pasif öğrenci çözemez', () => {
  const state = seed()
  unchanged(
    state,
    () => startQuiz(state, student('s2'), 'quiz4', id, now),
    isDomainError('quiz_not_found', 'not_found'),
  )
  unchanged(
    state,
    () => startQuiz(state, student(), 'quiz-yok', id, now),
    isDomainError('quiz_not_found', 'not_found'),
  )
  for (const actor of [parent, teacher('t4'), admin, front])
    unchanged(
      state,
      () => startQuiz(state, actor, 'quiz4', id, now),
      isDomainError('permission_denied', 'forbidden'),
    )
  unchanged(
    state,
    () => startQuiz(state, student('s-yok'), 'quiz4', id, now),
    isDomainError('student_scope_denied', 'forbidden'),
  )
  state.students.find((s) => s.id === 's1')!.isActive = false
  unchanged(
    state,
    () => startQuiz(state, student(), 'quiz4', id, now),
    isDomainError('student_inactive'),
  )
})

// --- Puanlama ve anahtarın gizliliği ----------------------------------------------------------

test('DOM-AKD-078: puan yalnız cevaplardan hesaplanır; istemci puanı ve geçersiz cevap reddedilir', () => {
  const state = seed()
  const quiz = state.quizzes.find((q) => q.id === 'quiz4')!
  startQuiz(state, student(), 'quiz4', id, now)
  const [a, b, c] = quiz.questionIds
  for (const body of [
    { answers: {}, score: 100 },
    { answers: { [a!]: 1.5 } },
    { answers: { [a!]: -1 } },
    {},
  ])
    unchanged(state, () => submitQuiz(state, student(), 'quiz4', body, minutes(1)), zodError)
  unchanged(
    state,
    () => submitQuiz(state, student(), 'quiz4', { answers: { 'q-math-7-0': 0 } }, minutes(1)),
    isDomainError('quiz_answer_invalid'),
  )
  unchanged(
    state,
    () => submitQuiz(state, student(), 'quiz4', { answers: { [a!]: 9 } }, minutes(1)),
    isDomainError('quiz_answer_invalid'),
  )
  // Boş ve `null` soru yanlış sayılır.
  const answers = { [a!]: key(state, a!), [b!]: key(state, b!, true), [c!]: null }
  const attempt = submitQuiz(state, student(), 'quiz4', { answers }, minutes(1))
  const expected = gradeQuiz(quiz, state.bank, { [a!]: key(state, a!) }, true)
  assert.equal(attempt.correct, 1)
  assert.equal(attempt.total, quiz.questionIds.length)
  assert.equal(attempt.score, expected.score)
  assert.deepEqual(attempt.topicScores, expected.topicScores)
  assert.deepEqual(attempt.answers, { [a!]: key(state, a!), [b!]: key(state, b!, true) })
})

test('DOM-AKD-078: öğrenciye giden sorular ve deneme cevap anahtarı ile açıklama taşımaz', () => {
  const state = seed()
  const { questions, attempt } = startQuiz(state, student(), 'quiz4', id, now)
  const quiz = state.quizzes.find((q) => q.id === 'quiz4')!
  assert.deepEqual(
    questions.map((q) => q.id),
    quiz.questionIds,
  )
  for (const question of questions) {
    assert.deepEqual(Object.keys(question).sort(), ['id', 'options', 'text', 'topic'])
    const bank = state.bank.find((q) => q.id === question.id)!
    assert.equal(JSON.stringify(question).includes(bank.explanation), false)
  }
  // Süre işlerken sonuç ve cevaplar açılmaz.
  const running = quizAttemptView(attempt, quiz, state.bank, minutes(1), 'ogretmen')
  assert.equal(running.status, 'in_progress')
  assert.equal(running.result, null)
  const answers = Object.fromEntries(quiz.questionIds.map((q) => [q, key(state, q)]))
  submitQuiz(state, student(), 'quiz4', { answers }, minutes(2))
  const done = quizAttemptView(attempt, quiz, state.bank, minutes(2), 'ogretmen')
  assert.equal(done.status, 'completed')
  assert.equal(done.result?.score, 100)
  assert.deepEqual(done.answers, answers)
  assert.deepEqual(Object.keys(done).sort(), [
    'answers',
    'expiresAt',
    'id',
    'quizId',
    'result',
    'startedAt',
    'status',
    'studentId',
    'submittedAt',
  ])
  assert.deepEqual(Object.keys(done.result!).sort(), ['correct', 'score', 'topicScores', 'total'])
  // Sonuç cevaplardan yeniden hesaplanır; kayıttaki kopya değişse de görünüm değişmez.
  attempt.score = 3
  assert.equal(quizAttemptView(attempt, quiz, state.bank, minutes(2), 'ogrenci').result?.score, 100)
  // Eski deneme: gönderim anı `date`tir.
  const legacy = state.quizAttempts.find((a) => a.quizId === 'quiz1' && a.studentId === 's1')!
  const quiz1 = state.quizzes.find((q) => q.id === 'quiz1')!
  const view = quizAttemptView(legacy, quiz1, state.bank, now, 'veli')
  assert.equal(view.submittedAt, legacy.date)
  assert.equal(view.result?.score, legacy.score)
})

test('DOM-AKD-078: öğrenci ve veli son tarihe ya da kapanışa kadar yalnız puan ve doğru sayısını görür', () => {
  const state = seed()
  const quiz = createQuiz(state, teacher('t1'), { ...QUIZ, dueDate: minutes(60) }, id, now)
  const { attempt } = startQuiz(state, student(), quiz.id, id, now)
  const answers = Object.fromEntries(quiz.questionIds.map((q) => [q, key(state, q)]))
  submitQuiz(state, student(), quiz.id, { answers }, minutes(2))
  for (const role of ['ogrenci', 'veli'] as const) {
    // Tam puanlı öğrencinin cevapları anahtardır; tek sorulu konunun yüzdesi soru bazında doğrudur.
    const early = quizAttemptView(attempt, quiz, state.bank, minutes(59), role)
    assert.equal('answers' in early, false, role)
    assert.deepEqual(early.result, { score: 100, correct: quiz.questionIds.length, total: 4 })
    assert.deepEqual(withheldAttemptFields(role, quiz, minutes(59)), ['answers', 'topicScores'])
    // Son tarih geçince cevaplar ve konu yüzdeleri açılır.
    const late = quizAttemptView(attempt, quiz, state.bank, minutes(60), role)
    assert.deepEqual(late.answers, answers)
    assert.ok(late.result?.topicScores?.length)
    assert.deepEqual(withheldAttemptFields(role, quiz, minutes(60)), [])
    // Son tarihsiz quiz kapanınca (arşiv) açılır.
    const open = { questionIds: quiz.questionIds }
    assert.equal('answers' in quizAttemptView(attempt, open, state.bank, minutes(600), role), false)
    const archived = quizAttemptView(attempt, { ...open, archived: true }, state.bank, now, role)
    assert.deepEqual(archived.answers, answers)
  }
  // Personel her zaman ayrıntıyı görür.
  const staff = quizAttemptView(attempt, quiz, state.bank, minutes(3), 'ogretmen')
  assert.deepEqual(staff.answers, answers)
  assert.ok(staff.result?.topicScores)
  assert.deepEqual(withheldAttemptFields('yonetici', quiz, minutes(3)), [])
  assert.equal(quizReviewOpen({}, minutes(600)), false)
  assert.equal(quizReviewOpen({ dueDate: minutes(1) }, minutes(1)), true)
  assert.equal(isQuizStaff('ogretmen'), true)
  assert.equal(isQuizStaff('onburo'), false)
  assert.equal(isQuizStaff(undefined), false)
})

test('DOM-AKD-078: soru metni öğrenciye başlatınca, veliye sonuçlanınca; anahtar yalnız personelde', () => {
  assert.equal(canSeeQuizQuestions('ogrenci', undefined), false)
  assert.equal(canSeeQuizQuestions('ogrenci', 'in_progress'), true)
  assert.equal(canSeeQuizQuestions('veli', 'in_progress'), false)
  assert.equal(canSeeQuizQuestions('veli', 'completed'), true)
  assert.equal(canSeeQuizQuestions('veli', 'expired'), true)
  assert.equal(canSeeQuizQuestions('ogretmen', undefined), true)
  assert.equal(canSeeQuizQuestions('yonetici', undefined), true)
  assert.equal(canSeeQuizQuestions('onburo', 'completed'), false)
})

test('DOM-AKD-078: bankadan silinen soru deneme başlatmayı engeller', () => {
  const state = seed()
  const quiz = state.quizzes.find((q) => q.id === 'quiz4')!
  state.bank = state.bank.filter((q) => q.id !== quiz.questionIds[0])
  unchanged(
    state,
    () => startQuiz(state, student(), 'quiz4', id, now),
    isDomainError('quiz_question_unavailable'),
  )
})

// --- Ortalama ----------------------------------------------------------------------------------

test('DOM-AKD-079: ortalama cevaplardan hesaplanır, saklanmaz; süren deneme girmez, süresi dolan 0', () => {
  const state = seed()
  const quiz1 = state.quizzes.find((q) => q.id === 'quiz1')!
  const own = state.quizAttempts.filter((a) => a.quizId === 'quiz1')
  const scores = own.map((a) => gradeQuiz(quiz1, state.bank, a.answers, true).score)
  const stats = quizStatistics(quiz1, state.quizAttempts, state.bank, now)
  assert.equal(stats.started, own.length)
  assert.equal(stats.scored, own.length)
  assert.equal(stats.inProgress, 0)
  assert.equal(stats.average, Math.round(scores.reduce((s, x) => s + x, 0) / scores.length))
  assert.equal('average' in quiz1, false)

  const quiz4 = state.quizzes.find((q) => q.id === 'quiz4')!
  assert.deepEqual(quizStatistics(quiz4, state.quizAttempts, state.bank, now), {
    started: 0,
    scored: 0,
    inProgress: 0,
    average: null,
  })
  startQuiz(state, student(), 'quiz4', id, now)
  startQuiz(state, student('s25'), 'quiz4', id, now)
  const answers = Object.fromEntries(quiz4.questionIds.map((q) => [q, key(state, q)]))
  submitQuiz(state, student(), 'quiz4', { answers }, minutes(5))
  assert.deepEqual(quizStatistics(quiz4, state.quizAttempts, state.bank, minutes(5)), {
    started: 2,
    scored: 1,
    inProgress: 1,
    average: 100,
  })
  // s25 süresinde göndermedi: boş sonuçla (0) ortalamaya girer.
  assert.deepEqual(quizStatistics(quiz4, state.quizAttempts, state.bank, minutes(30)), {
    started: 2,
    scored: 2,
    inProgress: 0,
    average: 50,
  })
})

test('DOM-AKD-079: eski kayıtta öğrencinin birden çok denemesi varsa ilk deneme sayılır', () => {
  const state = seed()
  const quiz1 = state.quizzes.find((q) => q.id === 'quiz1')!
  const before = quizStatistics(quiz1, state.quizAttempts, state.bank, now)
  const first = state.quizAttempts.find((a) => a.quizId === 'quiz1' && a.studentId === 's1')!
  const perfect = Object.fromEntries(quiz1.questionIds.map((q) => [q, key(state, q)]))
  state.quizAttempts.push({ ...first, id: 'attempt-retry', date: now, answers: perfect })
  assert.deepEqual(quizStatistics(quiz1, state.quizAttempts, state.bank, now), before)
})

// --- Nota aktarım ------------------------------------------------------------------------------

test('DOM-AKD-060, DOM-AKD-077: süren deneme nota aktarılmaz; gönderilince puan cevaplardan gelir', () => {
  const state = seed()
  const quiz = createQuiz(state, teacher('t1'), QUIZ, id, now)
  startQuiz(state, student(), quiz.id, id, now)
  const t1 = { role: 'ogretmen' as const, links: [{ kind: 'teacher' as const, recordId: 't1' }] }
  const input = {
    studentId: 's1',
    subjectId: 'math',
    term: 1,
    assessmentType: 'performans',
    date: '2026-10-06',
    quizId: quiz.id,
  }
  const grades = JSON.stringify(state.grades)
  assert.throws(
    () => recordGrade(state, t1, input, id, minutes(1)),
    isDomainError('quiz_not_attempted'),
  )
  assert.equal(JSON.stringify(state.grades), grades)
  const [a, b] = QUIZ.questionIds
  submitQuiz(
    state,
    student(),
    quiz.id,
    { answers: { [a!]: key(state, a!), [b!]: key(state, b!) } },
    minutes(2),
  )
  const grade = recordGrade(state, t1, input, id, minutes(3))
  assert.equal(grade.score, 50)
  assert.equal(grade.quizId, quiz.id)
})

// --- Görünürlük ---------------------------------------------------------------------------------

test('DOM-AKD-079: denemeyi quizin öğretmeni ve sınıfın rehber öğretmeni okur; branş dışı öğretmen okumaz', () => {
  const state = seed()
  const visible = (source: ScopeSource, by: Participant) =>
    scopeFor(source, by)
      .read('quizAttempts', state.quizAttempts)
      .map((row) => row.id)
  // attempt-s1-0: Deniz'in (c1) quiz1 (matematik, t1) denemesi; quiz2 Türkçedir (t2). Selin Kaya (t1)
  // c1'in rehber öğretmenidir; Türkçe (t2) ve İngilizce (t11) öğretmenleri c1'e girer ama ne
  // quizin öğretmeni ne rehberdir.
  const quiz2 = state.quizAttempts.find((a) => a.quizId === 'quiz2' && a.studentId === 's1')!
  assert.ok(visible(state, teacher('t1')).includes('attempt-s1-0'))
  assert.ok(!visible(state, teacher('t2')).includes('attempt-s1-0'), 'branş dışı öğretmen')
  assert.ok(!visible(state, teacher('t11')).includes('attempt-s1-0'))
  assert.ok(visible(state, teacher('t2')).includes(quiz2.id), 'kendi quizinin denemesi')
  assert.ok(visible(state, teacher('t1')).includes(quiz2.id), 'rehber öğretmen')
  assert.ok(visible(state, admin).includes('attempt-s1-0'))
  assert.ok(visible(state, student()).every((attemptId) => attemptId.startsWith('attempt-s1-')))
  assert.ok(visible(state, parent).includes('attempt-s1-0'))
  assert.deepEqual(visible(state, front), [])
  // Sınıftan ayrılan (atama sona eren) öğretmen kendi quizinin denemesini görmeye devam eder.
  const left = {
    ...state,
    assignments: state.assignments.filter((a) => !(a.classId === 'c1' && a.teacherId === 't2')),
  }
  assert.ok(visible(left, teacher('t2')).includes(quiz2.id))
  // Kaynakta quiz yoksa (API yüklemediyse) öğretmen yalnız rehberi olduğu sınıfı görür.
  const { students, teachers, classes, assignments, clubs, mockExams, modules } = state
  const withoutQuizzes: ScopeSource = {
    students,
    teachers,
    classes,
    assignments,
    clubs,
    mockExams,
    modules,
  }
  assert.ok(!visible(withoutQuizzes, teacher('t2')).includes(quiz2.id))
})
