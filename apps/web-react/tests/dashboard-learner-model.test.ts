import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import type { QuizAttempt, QuizListItem } from '@kampus/react-shared/quizzes.ts'
import { academicLookups } from '../src/pages/academic/academic-rows.ts'
import type { Lesson } from '../src/pages/academic/schedule-model.ts'
import { latestQuizResult, todayLessons } from '../src/pages/dashboard/dashboard-learner-model.ts'

// Öğrenci ve veli Genel Bakışı'nın "Bugünkü ders programı" ve "Son quiz sonucu" kartları (OG-978):
// gün süzmesi (iptal hariç, Europe/Istanbul günü) ve son tamamlanan deneme seçimi.

const NOW = new Date('2026-10-15T09:00:00.000Z')
const seed = createSeed(NOW)
const wrap = <T extends { id: string }>(records: readonly T[]) =>
  records.map((record) => ({
    id: record.id,
    version: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    archivedAt: null,
    record,
  }))
const lookups = academicLookups({
  subjects: wrap(seed.subjects),
  classes: wrap(seed.classes),
  students: wrap(seed.students),
  teachers: wrap(seed.teachers),
  branches: wrap(seed.branches),
})

const teacher = seed.teachers[0]
const schoolClass = seed.classes[0]
if (!teacher || !schoolClass) throw new Error('örnek veride öğretmen ve sınıf bekleniyor')

const lesson = (id: string, date: string, extra: Partial<Lesson> = {}): Lesson => ({
  id,
  version: 1,
  classId: schoolClass.id,
  subjectId: teacher.subjectId,
  title: null,
  teacherId: teacher.id,
  originalTeacherId: null,
  date,
  duration: 40,
  room: '12',
  status: 'planned',
  cancelledAt: null,
  updatedAt: date,
  ...extra,
})

const TODAY = '2026-10-16'

test('IST-094: bugünün dersleri saat sırasıyla gelir; ders adı, öğretmen ve derslik yazılır', () => {
  const rows = todayLessons(
    [lesson('geç', '2026-10-16T11:00:00Z'), lesson('erken', '2026-10-16T06:30:00Z')],
    lookups,
    TODAY,
  )
  assert.deepEqual(
    rows.map((row) => [row.id, row.time]),
    [
      ['erken', '09:30'],
      ['geç', '14:00'],
    ],
  )
  assert.equal(rows[0]?.title, lookups.subjects.get(teacher.subjectId)?.name)
  assert.equal(rows[0]?.detail, `${teacher.name} · Derslik 12`)
  assert.equal(rows[0]?.duration, 40)
})

test('DOM-YTK-068: iptal edilen ders bugünün programında görünmez', () => {
  const rows = todayLessons(
    [
      lesson('açık', '2026-10-16T06:00:00Z'),
      lesson('iptal', '2026-10-16T07:00:00Z', {
        status: 'cancelled',
        cancelledAt: NOW.toISOString(),
      }),
    ],
    lookups,
    TODAY,
  )
  assert.deepEqual(
    rows.map((row) => row.id),
    ['açık'],
  )
})

test('gün sınırı Europe/Istanbul günüdür: UTC gece yarısı değil İstanbul gece yarısı', () => {
  const rows = todayLessons(
    [
      lesson('dün-23:59', '2026-10-15T20:59:59Z'),
      lesson('bugün-00:00', '2026-10-15T21:00:00Z'),
      lesson('bugün-23:59', '2026-10-16T20:59:00Z'),
      lesson('yarın-00:00', '2026-10-16T21:00:00Z'),
    ],
    lookups,
    TODAY,
  )
  assert.deepEqual(
    rows.map((row) => row.id),
    ['bugün-00:00', 'bugün-23:59'],
  )
})

test('ders yoksa liste boştur', () => {
  assert.deepEqual(todayLessons([], lookups, TODAY), [])
  assert.deepEqual(todayLessons([lesson('başka', '2026-10-20T06:00:00Z')], lookups, TODAY), [])
})

test('DOM-YTK-069: yedek atanmış derste öğretmen yerine "Yedek: ad" yazılır; ders başlığı kayıttadır', () => {
  const [row] = todayLessons(
    [lesson('yedek', '2026-10-16T06:00:00Z', { originalTeacherId: 'asil', title: 'Telafi' })],
    lookups,
    TODAY,
  )
  assert.equal(row?.title, 'Telafi')
  assert.equal(row?.detail, `Yedek: ${teacher.name} · Derslik 12`)
})

// --- Son quiz sonucu ---------------------------------------------------------

const attempt = (
  quizId: string,
  studentId: string,
  extra: Partial<QuizAttempt> = {},
): QuizAttempt => ({
  id: `${quizId}-${studentId}`,
  quizId,
  studentId,
  status: 'completed',
  startedAt: '2026-10-10T08:00:00Z',
  expiresAt: '2026-10-10T08:40:00Z',
  submittedAt: '2026-10-10T08:20:00Z',
  result: { score: 80, correctCount: 8, total: 10 },
  ...extra,
})

const quiz = (id: string, attempts: QuizAttempt[]): QuizListItem => ({
  id,
  version: 1,
  classId: schoolClass.id,
  subjectId: 'math',
  subject: 'Matematik',
  teacherId: teacher.id,
  title: `Quiz ${id}`,
  duration: 40,
  dueDate: null,
  questionIds: [],
  questionCount: 10,
  status: 'open',
  createdAt: '2026-10-01T08:00:00Z',
  updatedAt: '2026-10-01T08:00:00Z',
  statistics: null,
  attempts,
})

test('DOM-AKD-078: son quiz en yeni gönderimli tamamlanan denemedir; puan sunucu sonucudur', () => {
  const latest = latestQuizResult(
    [
      quiz('q1', [attempt('q1', 's1', { submittedAt: '2026-10-10T08:20:00Z' })]),
      quiz('q2', [
        attempt('q2', 's1', {
          submittedAt: '2026-10-12T09:00:00Z',
          result: { score: 55, correctCount: 11, total: 20 },
        }),
      ]),
      quiz('q3', [attempt('q3', 's1', { submittedAt: '2026-10-11T09:00:00Z' })]),
    ],
    's1',
  )
  assert.deepEqual(latest, {
    quizId: 'q2',
    title: 'Quiz q2',
    subject: 'Matematik',
    score: 55,
    correctCount: 11,
    total: 20,
    at: '2026-10-12T09:00:00Z',
  })
})

test('süre işleyen ve süresi dolup boş sayılan deneme "tamamlanan" değildir', () => {
  const quizzes = [
    quiz('q1', [attempt('q1', 's1', { status: 'in_progress', result: null, submittedAt: null })]),
    quiz('q2', [
      attempt('q2', 's1', {
        status: 'expired',
        submittedAt: null,
        result: { score: 0, correctCount: 0, total: 10 },
      }),
    ]),
    quiz('q3', []),
  ]
  assert.equal(latestQuizResult(quizzes, 's1'), null)
  assert.equal(latestQuizResult([], 's1'), null)
})

test('DOM-AKD-079: veli seçili çocuğun denemesini görür; kardeşin denemesi sayılmaz', () => {
  const shared = quiz('q1', [
    attempt('q1', 's2', { submittedAt: '2026-10-14T09:00:00Z' }),
    attempt('q1', 's1', { submittedAt: '2026-10-10T09:00:00Z' }),
  ])
  assert.equal(latestQuizResult([shared], 's1')?.at, '2026-10-10T09:00:00Z')
  assert.equal(latestQuizResult([shared], 's2')?.at, '2026-10-14T09:00:00Z')
  assert.equal(latestQuizResult([shared], 's3'), null)
})

test('eşit gönderim anında liste sırası korunur; anı bozuk deneme en yeniye yenilir', () => {
  const equal = latestQuizResult(
    [
      quiz('a', [attempt('a', 's1', { submittedAt: '2026-10-10T09:00:00Z' })]),
      quiz('b', [attempt('b', 's1', { submittedAt: '2026-10-10T09:00:00Z' })]),
    ],
    's1',
  )
  assert.equal(equal?.quizId, 'a')
  const broken = latestQuizResult(
    [
      quiz('x', [attempt('x', 's1', { submittedAt: 'bozuk', expiresAt: null, startedAt: null })]),
      quiz('y', [attempt('y', 's1', { submittedAt: '2026-10-01T09:00:00Z' })]),
    ],
    's1',
  )
  assert.equal(broken?.quizId, 'y')
})
