import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { gradeQuiz } from '@kampus/school-core/lib/domain.ts'
import {
  attemptResult,
  deliverySummary,
  homeworkRow,
  HOMEWORK_LIST,
  learningLookups,
  materialRow,
  MATERIAL_LIST,
  QUIZ_LIST,
  studentQuizRow,
  teacherHomeworkRow,
  teacherQuizRow,
  uniqueValues,
} from '../src/pages/learning/learning-rows.ts'

const NOW = new Date('2026-10-15T09:00:00.000Z')
// Core `homeworkStatus` saati `now` parametresiyle alır; testler `NOW`'ı iletir.
const PAST = '2026-10-01T09:00:00.000Z'
const FUTURE = '2026-11-01T09:00:00.000Z'

const wrap = <T extends { id: string }>(records: readonly T[]) =>
  records.map((record) => ({
    id: record.id,
    version: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    archivedAt: null,
    record,
  }))

function setup() {
  const seed = createSeed(NOW)
  const classes = wrap(seed.classes)
  const students = wrap(seed.students)
  const lookups = learningLookups(classes, students)
  const classId = 'c1'
  const classStudents = seed.students.filter((student) => student.classId === classId)
  const template = seed.homework.find((item) => item.classId === classId)
  assert.ok(template)
  const homework = (id: string, dueDate: string) => ({ ...template, id, dueDate, classId })
  return { seed, lookups, classStudents, homework, classId }
}

const submission = (homeworkId: string, studentId: string, score: number | null = null) => ({
  homeworkId,
  studentId,
  score,
})

test('learningLookups sınıf eşlemesi kurar; pasif öğrenci ad sırasıyla sayılmaz', () => {
  const { seed, lookups, classStudents } = setup()
  assert.equal(lookups.classes.get('c1')?.name, '7-A')
  const active = lookups.studentsByClass.get('c1') ?? []
  assert.equal(active.length, classStudents.length)
  const names = active.map((student) => student.name)
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b, 'tr')),
  )

  const first = seed.students[0]
  assert.ok(first)
  const inactive = learningLookups(wrap(seed.classes), wrap([{ ...first, isActive: false }]))
  assert.equal(inactive.studentsByClass.get(first.classId), undefined)
})

test('homeworkRow durumu core homeworkStatus ile verir ve yalnız o öğrencinin teslimini sayar', () => {
  const { homework } = setup()
  const future = wrap([homework('hw-f', FUTURE)])[0]
  const past = wrap([homework('hw-p', PAST)])[0]
  assert.ok(future && past)

  assert.equal(homeworkRow(future, [], 's1', NOW).status, 'Bekliyor')
  assert.equal(homeworkRow(past, [], 's1', NOW).status, 'Gecikmiş')
  const delivered = [submission('hw-p', 's1')]
  assert.equal(homeworkRow(past, delivered, 's1', NOW).status, 'Teslim edildi')
  assert.equal(homeworkRow(past, delivered, 's2', NOW).status, 'Gecikmiş')
  const graded = [submission('hw-p', 's1', 88)]
  const row = homeworkRow(past, graded, 's1', NOW)
  assert.equal(row.status, 'Değerlendirildi')
  assert.equal(row.score, 88)
  assert.equal(homeworkRow(past, delivered, 's1', NOW).score, null)
})

test('deliverySummary teslim eden, geciken, bekleyen ve değerlendirilen sayılarını verir', () => {
  const { lookups, classStudents, homework, classId } = setup()
  const [a, b, c] = classStudents
  assert.ok(a && b && c)
  const late = homework('hw-late', PAST)
  const submissions = [submission('hw-late', a.id, 70), submission('hw-late', b.id)]

  const summary = deliverySummary(late, submissions, lookups.studentsByClass, NOW)
  assert.equal(summary.total, classStudents.length)
  assert.equal(summary.delivered, 2)
  assert.equal(summary.evaluated, 1)
  assert.equal(summary.late, classStudents.length - 2)
  assert.equal(summary.pending, 0)
  assert.equal(summary.students.find((entry) => entry.studentId === c.id)?.status, 'Gecikmiş')

  // Süresi süren ödevde teslim etmeyenler "bekleyen"dir, geciken yoktur.
  const open = homework('hw-open', FUTURE)
  const openSummary = deliverySummary(
    open,
    [submission('hw-open', a.id)],
    lookups.studentsByClass,
    NOW,
  )
  assert.equal(openSummary.late, 0)
  assert.equal(openSummary.pending, classStudents.length - 1)
  assert.equal(openSummary.delivered, 1)

  // Başka ödevin teslimi sayılmaz; başka sınıfın öğrencisi listeye girmez.
  const other = deliverySummary(late, [submission('hw-open', a.id)], lookups.studentsByClass, NOW)
  assert.equal(other.delivered, 0)
  const noClass = deliverySummary(
    { ...late, classId: 'yok' },
    submissions,
    lookups.studentsByClass,
    NOW,
  )
  assert.equal(noClass.total, 0)
  assert.equal(classId, 'c1')
})

test('teacherHomeworkRow sınıf adı ve teslim sayısını eşler', () => {
  const { lookups, classStudents, homework } = setup()
  const [a] = classStudents
  assert.ok(a)
  const item = wrap([homework('hw-t', PAST)])[0]
  assert.ok(item)
  const row = teacherHomeworkRow(item, [submission('hw-t', a.id)], lookups, NOW)
  assert.equal(row.className, '7-A')
  assert.equal(row.delivered, 1)
  assert.equal(row.total, classStudents.length)
})

function quizFixture() {
  const seed = createSeed(NOW)
  const quiz = seed.quizzes.find((item) =>
    seed.quizAttempts.some((attempt) => attempt.quizId === item.id),
  )
  assert.ok(quiz)
  const attempts = seed.quizAttempts.filter((attempt) => attempt.quizId === quiz.id)
  assert.ok(attempts.length > 1)
  return { seed, quiz, attempts, lookups: learningLookups(wrap(seed.classes), []) }
}

test('attemptResult soru bankası varken puanı cevaplardan core gradeQuiz ile hesaplar', () => {
  const { seed, quiz, attempts } = quizFixture()
  const attempt = attempts[0]
  assert.ok(attempt)
  const expected = gradeQuiz(quiz, seed.bank, attempt.answers, true)
  assert.deepEqual(attemptResult(attempt, quiz, seed.bank), {
    correct: expected.correct,
    total: expected.total,
    score: expected.score,
  })

  // Saklı puan bozulsa bile cevaplar esastır.
  const tampered = { ...attempt, score: 1, correct: 0 }
  assert.equal(attemptResult(tampered, quiz, seed.bank).score, expected.score)
})

test('attemptResult cevap anahtarı yoksa veya eksikse saklı sonuca düşer', () => {
  const { seed, quiz, attempts } = quizFixture()
  const attempt = attempts[0]
  assert.ok(attempt)
  const stored = { correct: attempt.correct, total: attempt.total, score: attempt.score }
  assert.deepEqual(attemptResult(attempt, quiz, null), stored)
  assert.deepEqual(attemptResult(attempt, quiz, []), stored)
  const partial = seed.bank.filter((question) => question.id !== quiz.questionIds[0])
  assert.deepEqual(attemptResult(attempt, quiz, partial), stored)
})

test('teacherQuizRow sınıf ortalamasını denemelerin cevaplarından hesaplar', () => {
  const { seed, quiz, attempts, lookups } = quizFixture()
  const item = wrap([quiz])[0]
  assert.ok(item)
  const scores = attempts.map((attempt) => gradeQuiz(quiz, seed.bank, attempt.answers, true).score)
  const expected = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)

  const row = teacherQuizRow(item, attempts, seed.bank, lookups)
  assert.equal(row.average, expected)
  assert.equal(row.solved, attempts.length)
  assert.equal(row.questions, quiz.questionIds.length)
  assert.equal(row.className, lookups.classes.get(quiz.classId)?.name)

  // Başka quizin denemesi ortalamaya girmez; çözen yoksa ortalama yoktur.
  const foreign = attempts.map((attempt) => ({ ...attempt, quizId: 'baska' }))
  const empty = teacherQuizRow(item, foreign, seed.bank, lookups)
  assert.equal(empty.average, null)
  assert.equal(empty.solved, 0)
})

test('studentQuizRow çözülme durumunu ve yalnız o öğrencinin sonucunu verir', () => {
  const { quiz, attempts } = quizFixture()
  const item = wrap([quiz])[0]
  const attempt = attempts[0]
  assert.ok(item && attempt)

  const solved = studentQuizRow(item, attempts, attempt.studentId)
  assert.equal(solved.completion, 'Çözüldü')
  assert.equal(solved.score, attempt.score)
  assert.equal(solved.correct, attempt.correct)
  assert.equal(solved.date, attempt.date)

  const unsolved = studentQuizRow(item, attempts, 'baska-ogrenci')
  assert.equal(unsolved.completion, 'Henüz çözülmedi')
  assert.equal(unsolved.score, null)
  assert.equal(unsolved.correct, null)
  assert.equal(unsolved.date, null)
})

test('materialRow tablo alanlarını eşler; uniqueValues tekrarı atar', () => {
  const { seed } = setup()
  const material = seed.materials[0]
  assert.ok(material)
  const row = materialRow(wrap([material])[0]!)
  assert.deepEqual(row, {
    id: material.id,
    title: material.title,
    subject: material.subject,
    level: material.level,
    type: material.type,
    fileName: material.fileName,
  })
  assert.deepEqual(uniqueValues(['a', 'b', 'a']), ['a', 'b'])
  assert.deepEqual(uniqueValues([]), [])
})

test('liste yapılandırmaları API beyaz listesindeki alanları kullanır', () => {
  // api-tasarimi.md §3: sıralama ve eşitlik filtresi alanları sunucuda beyaz listedir.
  const sortable = new Set(['id', 'title', 'dueDate'])
  for (const config of [HOMEWORK_LIST, QUIZ_LIST, MATERIAL_LIST]) {
    for (const field of Object.values(config.sortFields)) assert.ok(sortable.has(field), field)
    for (const field of config.defaultSort) assert.ok(sortable.has(field.replace(/^-/, '')), field)
  }
  const filterable = new Set(['classId', 'subjectId'])
  for (const config of [HOMEWORK_LIST, QUIZ_LIST, MATERIAL_LIST])
    for (const field of Object.values(config.filterFields)) assert.ok(filterable.has(field), field)
})
