import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import {
  currentEvaluationsOf,
  examRows,
  extremes,
  gradeTrend,
  homeworkReviews,
  netTrend,
  percentText,
  questionRows,
  studyPriority,
  subjectScores,
  topicHint,
  topicScores,
} from '../src/pages/academic/exam-analysis-model.ts'

const NOW = new Date('2026-10-15T09:00:00.000Z')
const seed = createSeed(NOW)
const subjects = new Map(seed.subjects.map((subject) => [subject.id, subject]))
const own = (studentId: string) => seed.grades.filter((grade) => grade.studentId === studentId)

test('subjectScores: ders ortalaması notlardan hesaplanır ve ders adı güncel kayıttan gelir', () => {
  const renamed = new Map([['math', { name: 'Matematik (güncel)' }]])
  const scores = subjectScores(
    [
      { subjectId: 'math', subject: 'Matematik', score: 60 },
      { subjectId: 'math', subject: 'Matematik', score: 80 },
    ],
    renamed,
  )
  assert.deepEqual(scores, [
    { subjectId: 'math', topic: 'Matematik (güncel)', score: 70, count: 2 },
  ])
  const all = subjectScores(own('s1'), subjects)
  assert.ok(all.length > 1)
  for (const item of all) assert.ok(item.score >= 0 && item.score <= 100)
})

test('topicScores: kazanım testi notu konu sayılmaz, quiz konu puanları dersine göre eklenir', () => {
  const grades = [
    { subjectId: 'math', topic: 'Denklemler', score: 60 },
    { subjectId: 'math', topic: 'Denklemler', score: 80 },
    { subjectId: 'math', topic: 'Kazanım testi', score: 10 },
    { subjectId: 'turkish', topic: 'Paragraf', score: 90 },
  ]
  const attempts = [
    { quizId: 'q-math', topicScores: [{ topic: 'Oran orantı', score: 50 }] },
    { quizId: 'q-turkish', topicScores: [{ topic: 'Paragraf', score: 10 }] },
  ]
  const quizzes = [
    { id: 'q-math', subjectId: 'math' },
    { id: 'q-turkish', subjectId: 'turkish' },
  ]
  assert.deepEqual(topicScores(grades, attempts, quizzes, 'math'), [
    { topic: 'Denklemler', score: 70 },
    { topic: 'Oran orantı', score: 50 },
  ])
  assert.deepEqual(topicScores(grades, [], quizzes, 'science'), [])
})

test('extremes: en güçlü ve en zayıf alan; boş listede ikisi de yok', () => {
  const result = extremes([
    { topic: 'A', score: 40 },
    { topic: 'B', score: 90 },
    { topic: 'C', score: 70 },
  ])
  assert.equal(result.strongest?.topic, 'B')
  assert.equal(result.weakest?.topic, 'A')
  assert.deepEqual(extremes([]), { strongest: undefined, weakest: undefined })
})

test('topicHint ve studyPriority: 65 ve 80 işletme eşikleridir', () => {
  assert.equal(topicHint(64), 'Tekrar ve ek çalışma önerilir')
  assert.equal(topicHint(65), 'Gelişmeye devam ediyor')
  assert.equal(topicHint(80), 'Güçlü alan')
  assert.equal(studyPriority(80).strong, true)
  assert.equal(studyPriority(70).label, 'Pekiştirme zamanı')
  assert.equal(studyPriority(64).label, 'Etüt önerilir')
})

test('gradeTrend: tarihe göre sıralı gün ortalaması; not yoksa boş', () => {
  const points = gradeTrend([
    { date: '2026-05-01', score: 80 },
    { date: '2026-03-01', score: 60 },
    { date: '2026-03-01', score: 70 },
  ])
  assert.deepEqual(
    points.map((point) => point.value),
    [65, 80],
  )
  assert.deepEqual(gradeTrend([]), [])
})

const exam = seed.mockExams.find((item) => item.id === 'exam-7-1')
const resultsOf = (studentId: string) => seed.mockResults.filter((r) => r.studentId === studentId)

test('examRows: yalnız sonucu olan denemeler, net yanlış cezasıyla; eksik dersli deneme eğilime girmez', () => {
  assert.ok(exam)
  const rows = examRows(seed.mockExams, resultsOf('s1'), new Set())
  assert.deepEqual(
    rows.map((row) => row.id),
    ['exam-7-1', 'exam-7-2'],
  )
  const first = rows[0]
  assert.ok(first)
  const expected = resultsOf('s1')
    .filter((r) => r.examId === 'exam-7-1')
    .reduce((sum, r) => sum + (r.correct - r.wrong / exam.wrongPenalty), 0)
  assert.equal(first.net, Math.round(expected * 100) / 100)
  assert.equal(first.complete, true)
  assert.equal(netTrend(rows).length, 2)

  const partial = examRows(
    seed.mockExams,
    resultsOf('s1').filter((r) => !(r.examId === 'exam-7-2' && r.subjectId === 'science')),
    new Set(),
  )
  assert.equal(partial[1]?.complete, false)
  assert.equal(netTrend(partial).length, 1)
  assert.deepEqual(examRows(seed.mockExams, [], new Set()), [])
})

const evaluation = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'ev-1',
    examId: 'exam-7-1',
    studentId: 's1',
    subjectId: 'math',
    booklet: 'A',
    profileId: 'p1',
    keyRevision: 2,
    questionResults: [
      {
        number: 1,
        subjectId: 'math',
        topic: 'Denklemler',
        answer: 'B',
        response: 'B',
        outcome: 'correct',
      },
      {
        number: 2,
        subjectId: 'math',
        topic: 'Denklemler',
        answer: 'C',
        response: undefined,
        outcome: 'blank',
      },
    ],
    correct: 1,
    wrong: 0,
    blank: 1,
    multiple: 0,
    cancelled: 0,
    topicScores: [{ topic: 'Denklemler', total: 2, correct: 1, percent: 50 }],
    weakTopics: ['Denklemler'],
    net: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  }) as Parameters<typeof currentEvaluationsOf>[0][number]

test('currentEvaluationsOf: anahtar revizyonu ya da sonuç bağı değişen analiz güncel sayılmaz', () => {
  const result = (evaluationId: string | null) =>
    ({
      ...resultsOf('s1').find((r) => r.examId === 'exam-7-1' && r.subjectId === 'math'),
      evaluationId,
    }) as Parameters<typeof currentEvaluationsOf>[2][number]
  const profile = (revision: number) => [{ id: 'p1', examId: 'exam-7-1', revision }]

  assert.equal(currentEvaluationsOf([evaluation()], profile(2), [result('ev-1')]).length, 1)
  // Anahtar yeniden düzenlendi: revizyon uyuşmaz.
  assert.equal(currentEvaluationsOf([evaluation()], profile(3), [result('ev-1')]).length, 0)
  // Sonuç elle değişti: sonuç artık bu analize bağlı değil.
  assert.equal(currentEvaluationsOf([evaluation()], profile(2), [result(null)]).length, 0)
  // Profil okunamadı (başka düzey): analiz gösterilmez.
  assert.equal(currentEvaluationsOf([evaluation()], [], [result('ev-1')]).length, 0)
})

test('examRows: güncel analizli ders sayısı hesaplanır', () => {
  const results = resultsOf('s1').map((r) =>
    r.examId === 'exam-7-1' && r.subjectId === 'math' ? { ...r, evaluationId: 'ev-1' } : r,
  )
  const rows = examRows(seed.mockExams, results, new Set(['ev-1']))
  assert.equal(rows[0]?.analysed, 1)
  assert.equal(rows[1]?.analysed, 0)
})

test('questionRows: öğrencinin işareti, doğru cevap ve sonuç; boş işaret "—"', () => {
  const rows = questionRows(evaluation(), 'Matematik')
  assert.deepEqual(
    rows.map((row) => [row.number, row.response, row.answer, row.outcome, row.subject]),
    [
      [1, 'B', 'B', 'Doğru', 'Matematik'],
      [2, '—', 'C', 'Boş', 'Matematik'],
    ],
  )
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length)
})

test('percentText: sorusu olmayan kazanım "—"', () => {
  assert.equal(percentText(50), '%50')
  assert.equal(percentText(0), '%0')
  assert.equal(percentText(null), '—')
})

test('homeworkReviews: yalnız geri bildirimli teslimler, yeniden eskiye; bilinmeyen ödev atlanır', () => {
  const teachers = new Map([['t1', { name: 'Selin Kaya' }]])
  const homework = [{ id: 'hw1', title: 'Denklemler', teacherId: 't1' }]
  const submission = (id: string, homeworkId: string, feedback: string, submittedAt: string) =>
    ({ id, homeworkId, studentId: 's1', feedback, score: 80, submittedAt }) as Parameters<
      typeof homeworkReviews
    >[0][number]
  const rows = homeworkReviews(
    [
      submission('a', 'hw1', 'Güzel.', '2026-10-01T09:00:00.000Z'),
      submission('b', 'hw1', '', '2026-10-02T09:00:00.000Z'),
      submission('c', 'hw1', 'Daha iyi.', '2026-10-03T09:00:00.000Z'),
      submission('d', 'yok', 'Kayıp ödev.', '2026-10-04T09:00:00.000Z'),
    ],
    homework,
    teachers,
  )
  assert.deepEqual(
    rows.map((row) => [row.id, row.teacher, row.title]),
    [
      ['c', 'Selin Kaya', 'Denklemler'],
      ['a', 'Selin Kaya', 'Denklemler'],
    ],
  )
})
