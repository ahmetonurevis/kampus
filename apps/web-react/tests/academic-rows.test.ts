import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import {
  ROLE_HOMEROOM,
  ROLE_SUBJECT,
  NO_REASON,
  academicLookups,
  addDays,
  attendanceCounts,
  attendanceCsvRow,
  attendanceRow,
  attendanceStatusLabel,
  gradeCsvRow,
  gradeRow,
  attendanceDayFilters,
  isDayKey,
  isVisibleLesson,
  lessonRow,
  lessonsByDay,
  overallAverage,
  scoreText,
  scoreTone,
  subjectAverages,
  teacherClassRow,
  weekDays,
  weekStart,
  type AcademicSources,
} from '../src/pages/academic/academic-rows.ts'

const NOW = new Date('2026-10-15T09:00:00.000Z')

// API satırı: sistem alanları üstte, core kaydı `record` içinde.
const wrap = <T extends { id: string }>(records: readonly T[]) =>
  records.map((record) => ({
    id: record.id,
    version: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    archivedAt: null,
    record,
  }))

function sources() {
  const seed = createSeed(NOW)
  const data: AcademicSources = {
    subjects: wrap(seed.subjects),
    classes: wrap(seed.classes),
    students: wrap(seed.students),
    teachers: wrap(seed.teachers),
    branches: wrap(seed.branches),
  }
  return { seed, data, lookups: academicLookups(data) }
}

const subjects = new Map([
  ['math', { name: 'Matematik' }],
  ['eng', { name: 'İngilizce' }],
  ['art', { name: 'Görsel Sanatlar' }],
])
const grade = (subjectId: string, score: number, subject = subjectId) => ({
  subjectId,
  subject,
  score,
})

// --- Ders ve genel ortalama ---------------------------------------------------

test('notu olmayan öğrencide ders ve genel ortalama boş/0 döner', () => {
  assert.deepEqual(subjectAverages([], subjects), [])
  assert.equal(overallAverage([]), 0)
})

test('tek notlu derste ortalama o nottur ve sayı 1 olur', () => {
  assert.deepEqual(subjectAverages([grade('math', 73)], subjects), [
    { subjectId: 'math', name: 'Matematik', average: 73, count: 1 },
  ])
  assert.equal(overallAverage([{ score: 73 }]), 73)
})

test('karışık derslerde ders ortalaması yuvarlanır, Türkçe ad sırasıyla dizilir', () => {
  const result = subjectAverages(
    [
      grade('math', 80),
      grade('eng', 90),
      grade('math', 55),
      grade('art', 61),
      grade('math', 70),
      grade('eng', 71),
    ],
    subjects,
  )
  assert.deepEqual(
    result.map((item) => item.name),
    ['Görsel Sanatlar', 'İngilizce', 'Matematik'],
  )
  assert.deepEqual(
    result.map((item) => [item.subjectId, item.average, item.count]),
    [
      ['art', 61, 1],
      ['eng', 81, 2], // (90 + 71) / 2 = 80,5 → 81
      ['math', 68, 3], // 205 / 3 = 68,33 → 68
    ],
  )
})

test('genel ortalama bütün notların ortalamasıdır, ders ortalamalarının değil', () => {
  const grades = [grade('math', 100), grade('math', 100), grade('math', 100), grade('eng', 40)]
  // Tüm notlar: 340 / 4 = 85. Ders ortalamalarının ortalaması (100 + 40) / 2 = 70 olurdu.
  assert.equal(overallAverage(grades), 85)
  assert.deepEqual(
    subjectAverages(grades, subjects).map((item) => item.average),
    [40, 100],
  )
})

test('ders kaydı eşlemede yoksa notun kendi ders adı kullanılır', () => {
  assert.equal(subjectAverages([grade('x', 50, 'Satranç')], subjects)[0]!.name, 'Satranç')
})

test('başarı rozeti 65 altında dikkat, 65 ve üstünde yeşil olur', () => {
  assert.equal(scoreTone(64), 'amber')
  assert.equal(scoreTone(65), 'green')
  assert.equal(scoreText(80), '80/100')
})

// --- Sınıf eşlemesi -----------------------------------------------------------

test('arşivdeki öğrenci sınıf eşlemesine girmez', () => {
  const { seed } = sources()
  const first = seed.students.find((s) => s.classId === 'c1')!
  const students = wrap(seed.students).map((row) =>
    row.id === first.id ? { ...row, record: { ...row.record, isActive: false } } : row,
  )
  const lookups = academicLookups({ ...sources().data, students })
  assert.equal(
    lookups.studentsByClass.get('c1')!.some((s) => s.id === first.id),
    false,
  )
})

// --- Not ve yoklama satırları -------------------------------------------------

test('not satırı öğrenci ve ders adını eşlemeden alır; CSV tarih ve puanı ekrandaki gibi yazar', () => {
  const { seed, data, lookups } = sources()
  const row = wrap(seed.grades)[0]!
  const mapped = gradeRow(row, lookups)
  const student = seed.students.find((s) => s.id === row.record.studentId)!
  assert.equal(mapped.id, row.id)
  assert.equal(mapped.student, student.name)
  assert.equal(mapped.subject, seed.subjects.find((s) => s.id === row.record.subjectId)!.name)
  assert.equal(mapped.score, row.record.score)
  const csv = gradeCsvRow(mapped)
  assert.equal(csv.score, `${row.record.score}/100`)
  assert.match(csv.date, /\d{4}/)
  assert.equal(data.subjects.length > 0, true)
})

test('eksik eşlemede not satırı kaydın kendi ders adına düşer, öğrenci adı boş kalır', () => {
  const { seed, lookups } = sources()
  const orphan = wrap([
    { ...seed.grades[0]!, studentId: 'yok', subjectId: 'yok', subject: 'Satranç' },
  ])[0]!
  const mapped = gradeRow(orphan, lookups)
  assert.equal(mapped.student, '')
  assert.equal(mapped.subject, 'Satranç')
})

test('yoklama satırı sınıf adını eşler; mazeret yoksa CSV "Kayıtlı mazeret yok" yazar', () => {
  const { seed, lookups } = sources()
  const record = { ...seed.attendance[0]!, classId: 'c1', status: 'late', reason: '' }
  const mapped = attendanceRow(wrap([record])[0]!, lookups)
  assert.equal(mapped.className, '7-A')
  assert.equal(mapped.statusLabel, 'Geç geldi')
  assert.equal(mapped.reason, '')
  assert.equal(attendanceCsvRow(mapped).reason, NO_REASON)
})

test('bilinmeyen yoklama durumu olduğu gibi etiketlenir ve sayıma girmez', () => {
  assert.equal(attendanceStatusLabel('present'), 'Geldi')
  assert.equal(attendanceStatusLabel('absent'), 'Gelmedi')
  assert.equal(attendanceStatusLabel('excused'), 'Mazeretli')
  assert.equal(attendanceStatusLabel('tuhaf'), 'tuhaf')
  assert.deepEqual(
    attendanceCounts([
      { status: 'present' },
      { status: 'present' },
      { status: 'absent' },
      { status: 'late' },
      { status: 'tuhaf' },
    ]),
    { present: 2, absent: 1, late: 1, excused: 0 },
  )
  assert.deepEqual(attendanceCounts([]), { present: 0, absent: 0, late: 0, excused: 0 })
})

test('gün anahtarı yalnız YYYY-MM-DD biçimini kabul eder', () => {
  assert.equal(isDayKey('2026-10-15'), true)
  assert.equal(isDayKey('2026-10-15T00:00:00Z'), false)
  assert.equal(isDayKey('15.10.2026'), false)
  assert.equal(isDayKey(undefined), false)
  assert.equal(isDayKey(20261015), false)
})

test('tek gün süzgeci dateFrom ve dateTo aynı günü taşır; geçersiz gün süzgeç üretmez', () => {
  assert.deepEqual(attendanceDayFilters('2026-10-15'), {
    dateFrom: '2026-10-15',
    dateTo: '2026-10-15',
  })
  assert.deepEqual(attendanceDayFilters(''), {})
  assert.deepEqual(attendanceDayFilters('15.10.2026'), {})
})

// --- Sınıflar -----------------------------------------------------------------

test('öğretmen sınıf satırı görev ve aktif öğrenci sayısını verir', () => {
  const { seed, data, lookups } = sources()
  const c1 = data.classes.find((row) => row.id === 'c1')!
  const homeroom = teacherClassRow(c1, lookups, c1.record.teacherId)
  assert.equal(homeroom.duty, ROLE_HOMEROOM)
  assert.equal(homeroom.count, seed.students.filter((s) => s.classId === 'c1' && s.isActive).length)
  assert.equal(teacherClassRow(c1, lookups, 'baska-ogretmen').duty, ROLE_SUBJECT)
})

// --- Hafta ve ders programı ---------------------------------------------------

test('hafta başlangıcı pazartesidir; pazar önceki pazartesiye bağlanır', () => {
  assert.equal(weekStart('2026-10-26'), '2026-10-26') // pazartesi
  assert.equal(weekStart('2026-10-30'), '2026-10-26') // cuma
  assert.equal(weekStart('2026-11-01'), '2026-10-26') // pazar
  assert.equal(weekStart('2026-11-02'), '2026-11-02')
})

test('gün ekleme ay ve yıl sınırını aşar; hafta 7 gündür', () => {
  assert.equal(addDays('2026-10-30', 3), '2026-11-02')
  assert.equal(addDays('2026-01-01', -1), '2025-12-31')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
  assert.deepEqual(weekDays('2026-10-26'), [
    '2026-10-26',
    '2026-10-27',
    '2026-10-28',
    '2026-10-29',
    '2026-10-30',
    '2026-10-31',
    '2026-11-01',
  ])
})

test('iptal edilen ders günlük programda görünmez, kalan dersler saat sırasıyla gelir', () => {
  const { seed, lookups } = sources()
  const base = seed.schedule[0]!
  const lesson = (id: string, date: string, extra: Record<string, unknown> = {}) => ({
    ...base,
    id,
    classId: 'c1',
    date,
    ...extra,
  })
  const items = wrap([
    lesson('gec', '2026-10-27T09:00:00.000Z'),
    lesson('iptal', '2026-10-27T07:00:00.000Z', { cancelledAt: '2026-10-26T10:00:00.000Z' }),
    lesson('erken', '2026-10-27T06:00:00.000Z'),
    lesson('hafta-disi', '2026-11-04T06:00:00.000Z'),
  ])
  assert.equal(isVisibleLesson(items[2]!.record), true)
  assert.equal(isVisibleLesson(items[1]!.record), false)
  const days = lessonsByDay(items, lookups, 'teacher', '2026-10-26')
  assert.equal(days.size, 7)
  assert.deepEqual(
    days.get('2026-10-27')!.map((row) => row.id),
    ['erken', 'gec'],
  )
  const all = [...days.values()].flat().map((row) => row.id)
  assert.equal(all.includes('iptal'), false)
  assert.equal(all.includes('hafta-disi'), false)
})

test('ders satırı İstanbul saatiyle gün/saat verir; alt başlık kitleye göre sınıf ya da öğretmendir', () => {
  const { seed, lookups } = sources()
  const record = {
    ...seed.schedule[0]!,
    classId: 'c1',
    teacherId: 't1',
    date: '2026-10-27T06:00:00.000Z',
    room: '101',
  }
  const item = wrap([record])[0]!
  const teacher = lessonRow(item, lookups, 'teacher')
  const student = lessonRow(item, lookups, 'student')
  assert.equal(teacher.day, '2026-10-27')
  assert.equal(teacher.time, '09:00')
  assert.equal(teacher.subtitle, '7-A · Derslik 101')
  const teacherName = seed.teachers.find((t) => t.id === 't1')!.name
  assert.equal(student.subtitle, `${teacherName} · Derslik 101`)
})
