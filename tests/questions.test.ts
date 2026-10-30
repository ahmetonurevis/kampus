import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Participant } from '../packages/school-core/src/lib/communication.ts'
import {
  QUESTION_ANSWER_LIMIT,
  QUESTION_SENSITIVE_NOTICE,
  QUESTION_STATUS_LABELS,
  answerQuestion,
  askQuestion,
  askQuestionSchema,
  isOpenQuestion,
  questionResponse,
  questionStatus,
  withdrawQuestion,
} from '../packages/school-core/src/lib/questions.ts'
import { archiveRecord, updateClass } from '../packages/school-core/src/lib/school-management.ts'
import { visibleRecords } from '../packages/school-core/src/lib/scope.ts'
import { isDomainError } from './support/domain-error.ts'

// 2026-10-06 salıdır. Deniz (s1) ve Nehir (s25) 7-A (c1); Ece (s2) 5-A (c2). 7-A'nın matematik
// öğretmeni Selin Kaya (t1), Türkçe öğretmeni Ahmet Yıldırım (t2), fen öğretmeni Derya Arslan (t3).
const now = '2026-10-06T10:00:00.000Z'
const later = '2026-10-06T12:00:00.000Z'
const seed = () => createSeed(new Date(now))
let sequence = 0
const id = (prefix: string) => `${prefix}-questions-test-${++sequence}`

const student = (recordId = 's1'): Participant => ({
  role: 'ogrenci',
  links: [{ kind: 'student', recordId }],
  userId: `u-${recordId}`,
})
const teacher = (recordId: string): Participant => ({
  role: 'ogretmen',
  links: [{ kind: 'teacher', recordId }],
  userId: `u-${recordId}`,
})
const parent: Participant = {
  role: 'veli',
  links: [
    { kind: 'child', recordId: 's1' },
    { kind: 'child', recordId: 's2' },
  ],
  userId: 'u-ayse',
}
const admin: Participant = { role: 'yonetici', links: [], userId: 'u-admin' }
const front: Participant = { role: 'onburo', links: [], userId: 'u-front' }

const ask = (overrides: Record<string, unknown> = {}) => ({
  subjectId: 'math',
  topic: 'Denklemler',
  title: 'Denklem çözümü',
  text: '2x + 6 = 18 denkleminde neden önce 6 çıkarıyoruz?',
  ...overrides,
})
const zodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'

function unchangedOnFailure(state: State, action: () => unknown, check: (e: unknown) => boolean) {
  const before = JSON.stringify(state.questions)
  assert.throws(action, check)
  assert.equal(JSON.stringify(state.questions), before)
}

// --- Soru gönderme -------------------------------------------------------------------------

test('DOM-ILT-090: öğrenci kendi sınıfının ders öğretmenine soru gönderir; öğretmen atamadan çözülür', () => {
  const state = seed()
  const created = askQuestion(state, student(), ask(), id, now)
  assert.equal(state.questions[0], created)
  assert.deepEqual(
    {
      studentId: created.studentId,
      teacherId: created.teacherId,
      subjectId: created.subjectId,
      topic: created.topic,
      createdAt: created.createdAt,
      answeredAt: created.answeredAt,
      answer: created.answer,
      fileName: created.fileName,
      askedBy: created.askedBy,
      followUps: created.followUps,
    },
    {
      studentId: 's1',
      teacherId: 't1',
      subjectId: 'math',
      topic: 'Denklemler',
      createdAt: now,
      answeredAt: null,
      answer: '',
      fileName: null,
      askedBy: { role: 'ogrenci', userId: 'u-s1' },
      followUps: [],
    },
  )
  assert.equal(questionStatus(created), 'pending')
  // Kazanım isteğe bağlıdır; form öğretmeni gösterdiyse aynı öğretmen kabul edilir.
  const plain = askQuestion(
    state,
    student(),
    ask({ subjectId: 'turkish', teacherId: 't2', topic: undefined }),
    id,
    now,
  )
  assert.equal(plain.teacherId, 't2')
  assert.equal('topic' in plain, false)
  // Dil okulunda da öğrenme modülüyle çalışır.
  askQuestion(state, student(), ask(), id, now, { institutionType: 'language_school' })
})

test('DOM-ILT-090: başka sınıfın dersi, yanlış öğretmen ve olmayan ders 403 question_scope_denied; kayıt değişmez', () => {
  const state = seed()
  for (const input of [
    ask({ subjectId: 'physics', topic: undefined }),
    ask({ teacherId: 't2' }),
    ask({ teacherId: 't-baska-kurum' }),
    ask({ subjectId: 'ders-yok', topic: undefined }),
  ])
    unchangedOnFailure(
      state,
      () => askQuestion(state, student(), input, id, now),
      isDomainError('question_scope_denied', 'forbidden'),
    )
})

test('DOM-ILT-090: bağlantısız veya kurumda olmayan öğrenci 403 student_scope_denied', () => {
  const state = seed()
  for (const by of [
    { ...student(), links: [] },
    student('s-baska-kurum'),
    {
      ...student(),
      links: [
        { kind: 'student' as const, recordId: 's1' },
        { kind: 'student' as const, recordId: 's25' },
      ],
    },
  ])
    unchangedOnFailure(
      state,
      () => askQuestion(state, by, ask(), id, now),
      isDomainError('student_scope_denied', 'forbidden'),
    )
})

test('DOM-YTK-001: soruyu yalnız öğrenci gönderir; veli, öğretmen, yönetici ve ön büro gönderemez', () => {
  const state = seed()
  for (const by of [parent, teacher('t1'), admin, front])
    unchangedOnFailure(
      state,
      () => askQuestion(state, by, ask(), id, now),
      isDomainError('permission_denied', 'forbidden'),
    )
})

test('DOM-YTK-040: öğrenme modülü kapalıyken soru gönderilmez, yanıtlanmaz ve geri çekilmez', () => {
  const state = seed()
  state.modules.learning = false
  unchangedOnFailure(
    state,
    () => askQuestion(state, student(), ask(), id, now),
    isDomainError('module_disabled', 'forbidden'),
  )
  unchangedOnFailure(
    state,
    () => answerQuestion(state, teacher('t1'), 'ask1', { text: 'Yanıt' }, id, now),
    isDomainError('module_disabled', 'forbidden'),
  )
  unchangedOnFailure(
    state,
    () => withdrawQuestion(state, student(), 'ask1', { withdrawn: true }, now),
    isDomainError('module_disabled', 'forbidden'),
  )
})

test('DOM-ILT-090: pasif öğrenci soru gönderemez (422 student_inactive)', () => {
  const state = seed()
  const deniz = state.students.find((s) => s.id === 's1')
  assert.ok(deniz)
  deniz.isActive = false
  unchangedOnFailure(
    state,
    () => askQuestion(state, student(), ask(), id, now),
    isDomainError('student_inactive'),
  )
})

test('DOM-ILT-090: dersin öğretmeni pasifse 422; kazanım dersin listesinde olmalı', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => askQuestion(state, student(), ask({ topic: 'Paragraf' }), id, now),
    isDomainError('question_topic_unknown'),
  )
  const selin = state.teachers.find((t) => t.id === 't1')
  assert.ok(selin)
  selin.isActive = false
  unchangedOnFailure(
    state,
    () => askQuestion(state, student(), ask(), id, now),
    isDomainError('question_teacher_unavailable'),
  )
})

test('DOM-ILT-090: dersi iki öğretmen paylaşıyorsa öğretmen seçilmeden soru gönderilmez', () => {
  const state = seed()
  state.assignments.push({
    id: 'assign-questions-test',
    classId: 'c1',
    subjectId: 'math',
    teacherId: 't3',
  })
  unchangedOnFailure(
    state,
    () => askQuestion(state, student(), ask(), id, now),
    isDomainError('question_teacher_required'),
  )
  assert.equal(askQuestion(state, student(), ask({ teacherId: 't3' }), id, now).teacherId, 't3')
})

test('DOM-ILT-090: metin sınırları Zod ile; öğrenci kimliği ve bilinmeyen alan reddedilir; dosya 422', () => {
  const state = seed()
  for (const input of [
    ask({ title: 'a' }),
    ask({ title: 'x'.repeat(121) }),
    ask({ text: 'kısa' }),
    ask({ text: 'x'.repeat(2001) }),
    ask({ subjectId: '' }),
    ask({ studentId: 's25' }),
    ask({ institutionId: 'baska' }),
  ])
    unchangedOnFailure(state, () => askQuestion(state, student(), input, id, now), zodError)
  assert.equal(askQuestionSchema.safeParse(ask({ text: 'x'.repeat(2000) })).success, true)
  unchangedOnFailure(
    state,
    () => askQuestion(state, student(), ask({ files: ['soru.jpg'] }), id, now),
    isDomainError('question_files_unsupported'),
  )
})

test('DOM-ILT-014: soru formu özel nitelikli veri uyarısını taşır', () => {
  assert.match(QUESTION_SENSITIVE_NOTICE, /Sağlık/)
  assert.match(QUESTION_SENSITIVE_NOTICE, /rehberlik/)
})

// --- Yanıt ---------------------------------------------------------------------------------

test('DOM-ILT-092: atanmış öğretmen yanıtlar; ilk yanıt answer/answeredAt, sonrakiler ek yanıt olur', () => {
  const state = seed()
  const created = askQuestion(state, student(), ask(), id, now)
  const answered = answerQuestion(
    state,
    teacher('t1'),
    created.id,
    { text: 'İki taraftan aynı sayıyı çıkarırız.' },
    id,
    later,
  )
  assert.equal(answered.answer, 'İki taraftan aynı sayıyı çıkarırız.')
  assert.equal(answered.answeredAt, later)
  assert.deepEqual(answered.answeredBy, { role: 'ogretmen', userId: 'u-t1' })
  assert.equal(questionStatus(answered), 'answered')
  const correction = '2026-10-06T13:00:00.000Z'
  answerQuestion(
    state,
    teacher('t1'),
    created.id,
    { text: 'Düzeltme: sonra 2’ye böl.' },
    id,
    correction,
  )
  // Verilmiş yanıt ve yanıt anı değişmez; düzeltme ek yanıttır.
  assert.equal(created.answer, 'İki taraftan aynı sayıyı çıkarırız.')
  assert.equal(created.answeredAt, later)
  assert.equal(created.followUps?.length, 1)
  assert.equal(created.followUps?.[0]?.text, 'Düzeltme: sonra 2’ye böl.')
  assert.equal(created.followUps?.[0]?.by.userId, 'u-t1')
  // Eski örnek kayıt da (`followUps` yok) yanıtlanır.
  const seeded = answerQuestion(state, teacher('t1'), 'ask1', { text: 'Toplam 21.' }, id, later)
  assert.equal(seeded.answeredAt, later)
})

test('DOM-ILT-092: başka öğretmen ve olmayan soru 404; yönetici ve öğrenci yanıt yazamaz', () => {
  const state = seed()
  for (const by of [teacher('t2'), teacher('t-baska-kurum')])
    unchangedOnFailure(
      state,
      () => answerQuestion(state, by, 'ask1', { text: 'Yanıt' }, id, now),
      isDomainError('question_not_found', 'not_found'),
    )
  unchangedOnFailure(
    state,
    () => answerQuestion(state, teacher('t1'), 'soru-yok', { text: 'Yanıt' }, id, now),
    isDomainError('question_not_found', 'not_found'),
  )
  for (const by of [admin, front, student(), parent])
    unchangedOnFailure(
      state,
      () => answerQuestion(state, by, 'ask1', { text: 'Yanıt' }, id, now),
      isDomainError('permission_denied', 'forbidden'),
    )
  // Pasif öğretmen kaydı kapsam vermez.
  const selin = state.teachers.find((t) => t.id === 't1')
  assert.ok(selin)
  selin.isActive = false
  unchangedOnFailure(
    state,
    () => answerQuestion(state, teacher('t1'), 'ask1', { text: 'Yanıt' }, id, now),
    isDomainError('question_not_found', 'not_found'),
  )
})

test('DOM-ILT-092: geri çekilmiş soru yanıtlanmaz; yanıt sınırı ve metin sınırı', () => {
  const state = seed()
  const created = askQuestion(state, student(), ask(), id, now)
  withdrawQuestion(state, student(), created.id, { withdrawn: true }, now)
  unchangedOnFailure(
    state,
    () => answerQuestion(state, teacher('t1'), created.id, { text: 'Yanıt' }, id, later),
    isDomainError('question_withdrawn', 'conflict'),
  )
  for (const input of [{ text: '' }, { text: 'x'.repeat(2001) }, { text: 'Yanıt', answer: 'x' }])
    unchangedOnFailure(
      state,
      () => answerQuestion(state, teacher('t1'), 'ask1', input, id, later),
      zodError,
    )
  for (let i = 0; i < QUESTION_ANSWER_LIMIT; i += 1)
    answerQuestion(state, teacher('t1'), 'ask1', { text: `Yanıt ${i + 1}` }, id, later)
  const full = state.questions.find((q) => q.id === 'ask1')
  assert.equal(full?.followUps?.length, QUESTION_ANSWER_LIMIT - 1)
  unchangedOnFailure(
    state,
    () => answerQuestion(state, teacher('t1'), 'ask1', { text: 'Bir yanıt daha' }, id, later),
    isDomainError('question_answer_limit'),
  )
})

// --- Geri çekme ----------------------------------------------------------------------------

test('DOM-ILT-091: öğrenci yanıtlanmamış sorusunu geri çeker; kayıt ve metin korunur', () => {
  const state = seed()
  const created = askQuestion(state, student(), ask(), id, now)
  const count = state.questions.length
  const withdrawn = withdrawQuestion(state, student(), created.id, { withdrawn: true }, later)
  assert.equal(state.questions.length, count)
  assert.equal(withdrawn.withdrawnAt, later)
  assert.deepEqual(withdrawn.withdrawnBy, { role: 'ogrenci', userId: 'u-s1' })
  assert.equal(withdrawn.text, ask().text)
  assert.equal(questionStatus(withdrawn), 'withdrawn')
  assert.equal(QUESTION_STATUS_LABELS[questionStatus(withdrawn)], 'Geri çekildi')
  assert.equal(isOpenQuestion(withdrawn), false)
  unchangedOnFailure(
    state,
    () => withdrawQuestion(state, student(), created.id, { withdrawn: true }, later),
    isDomainError('question_withdrawn', 'conflict'),
  )
})

test('DOM-ILT-091: yanıtlanmış soru geri çekilmez; başkasının sorusu 404; metin değiştirilemez', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => withdrawQuestion(state, student(), 'ask25', { withdrawn: true }, now),
    isDomainError('question_answered', 'conflict'),
  )
  // ask2 Ece'nin (s2) sorusudur; Deniz göremez ve geri çekemez.
  for (const questionId of ['ask2', 'soru-yok'])
    unchangedOnFailure(
      state,
      () => withdrawQuestion(state, student(), questionId, { withdrawn: true }, now),
      isDomainError('question_not_found', 'not_found'),
    )
  for (const by of [parent, teacher('t1'), admin])
    unchangedOnFailure(
      state,
      () => withdrawQuestion(state, by, 'ask1', { withdrawn: true }, now),
      isDomainError('permission_denied', 'forbidden'),
    )
  for (const input of [{}, { withdrawn: false }, { withdrawn: true, text: 'Yeni metin' }])
    unchangedOnFailure(
      state,
      () => withdrawQuestion(state, student(), 'ask1', input, now),
      zodError,
    )
})

// --- Okuma kapsamı ve yanıt süresi ---------------------------------------------------------

test('DOM-ILT-093: öğrenci kendi, veli çocuklarının, öğretmen kendine atanan sorularını görür; ön büro görmez', () => {
  const state = seed()
  const created = askQuestion(state, student(), ask(), id, now)
  const ids = (by: Participant) => visibleRecords(state, by, 'questions').map((q) => q.id)
  assert.ok(ids(student()).includes(created.id))
  assert.ok(!ids(student('s25')).includes(created.id))
  assert.ok(ids(parent).includes(created.id))
  assert.ok(
    !ids({ role: 'veli', links: [{ kind: 'child', recordId: 's25' }], userId: 'u-p' }).includes(
      created.id,
    ),
  )
  assert.ok(ids(teacher('t1')).includes(created.id))
  assert.ok(!ids(teacher('t2')).includes(created.id))
  assert.ok(ids(admin).includes(created.id))
  assert.deepEqual(ids(front), [])
  assert.ok(
    ids(student()).every((qid) => state.questions.find((q) => q.id === qid)?.studentId === 's1'),
  )
})

test('DOM-ILT-013, DOM-ILT-093: yanıt süresi iş saatiyle hesaplanır; geri çekilen soru gecikmiş sayılmaz', () => {
  // Cuma 16:00 (İstanbul) sorulan soru pazartesi 16:00'ya kadar yanıtlanabilir.
  const friday = '2026-10-09T13:00:00.000Z'
  const question = { createdAt: friday, answeredAt: null }
  const response = questionResponse(question, '2026-10-10T20:00:00.000Z')
  assert.equal(response.dueAt, '2026-10-12T13:00:00.000Z')
  assert.equal(response.overdue, false)
  assert.equal(questionResponse(question, '2026-10-12T14:00:00.000Z').overdue, true)
  assert.equal(
    questionResponse({ ...question, withdrawnAt: friday }, '2026-10-12T14:00:00.000Z').overdue,
    false,
  )
  const answered = questionResponse(
    { createdAt: friday, answeredAt: '2026-10-13T08:00:00.000Z' },
    '2026-10-14T08:00:00.000Z',
  )
  assert.equal(answered.answeredAt, '2026-10-13T08:00:00.000Z')
  assert.equal(answered.overdue, false)
})

// --- Öğretmen değişimi -----------------------------------------------------------------------

test('DOM-ILT-092: ders öğretmeni değişince açık sorular taşınır; geri çekilen soru eski öğretmende kalır', () => {
  const state = seed()
  const open = askQuestion(state, student(), ask(), id, now)
  const withdrawn = askQuestion(state, student(), ask({ title: 'Geri çekilecek' }), id, now)
  withdrawQuestion(state, student(), withdrawn.id, { withdrawn: true }, now)
  const selin = state.teachers.find((t) => t.id === 't1')
  assert.ok(selin)
  state.teachers.push({ ...structuredClone(selin), id: 't-math-2', name: 'Yeni Matematik' })
  updateClass(state, 'c1', { subjectTeachers: { math: 't-math-2' } }, id, now)
  assert.equal(open.teacherId, 't-math-2')
  assert.equal(withdrawn.teacherId, 't1')
  // Yeni öğretmen taşınan soruyu yanıtlar, eski öğretmen artık göremez (404).
  answerQuestion(
    state,
    teacher('t-math-2'),
    open.id,
    { text: 'Yeni öğretmenden yanıt.' },
    id,
    later,
  )
  unchangedOnFailure(
    state,
    () => answerQuestion(state, teacher('t1'), open.id, { text: 'Eski öğretmen' }, id, later),
    isDomainError('question_not_found', 'not_found'),
  )
})

test('DOM-ILT-091: geri çekilen soru öğretmen arşivinde devir istemez; açık soru ister', () => {
  const state = seed()
  const selin = state.teachers.find((t) => t.id === 't1')
  assert.ok(selin)
  state.teachers.push({ ...structuredClone(selin), id: 't-solo', name: 'Görevsiz Öğretmen' })
  const base = state.questions.find((q) => q.id === 'ask1')
  assert.ok(base)
  state.questions.push({
    ...structuredClone(base),
    id: 'ask-solo',
    teacherId: 't-solo',
    withdrawnAt: now,
  })
  archiveRecord(state, 'teacher', 't-solo', '', now)
  assert.equal(state.teachers.find((t) => t.id === 't-solo')?.isActive, false)

  const other = seed()
  const otherSelin = other.teachers.find((t) => t.id === 't1')
  assert.ok(otherSelin)
  other.teachers.push({ ...structuredClone(otherSelin), id: 't-solo', name: 'Görevsiz Öğretmen' })
  const otherBase = other.questions.find((q) => q.id === 'ask1')
  assert.ok(otherBase)
  other.questions.push({ ...structuredClone(otherBase), id: 'ask-solo', teacherId: 't-solo' })
  assert.throws(
    () => archiveRecord(other, 'teacher', 't-solo', '', now),
    isDomainError('replacement_teacher_required'),
  )
})
