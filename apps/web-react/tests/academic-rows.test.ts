import assert from 'node:assert/strict'
import { subjectAverages } from '@kampus/school-core/lib/grades.ts'
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
  attendanceRangeError,
  attendanceRangeFilters,
  ATTENDANCE_RANGE_LONG_ERROR,
  ATTENDANCE_RANGE_ORDER_ERROR,
  isDayKey,
  overallAverage,
  scoreText,
  scoreTone,
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
const grade = (
  subjectId: string,
  score: number,
  subject = subjects.get(subjectId)?.name ?? subjectId,
) => ({
  subjectId,
  subject,
  score,
})

// --- Ders ve genel ortalama ---------------------------------------------------

test('notu olmayan öğrencide ders ve genel ortalama boş/0 döner', () => {
  assert.deepEqual(subjectAverages([]), [])
  assert.equal(overallAverage([]), 0)
})

test('tek notlu derste ortalama o nottur ve sayı 1 olur', () => {
  assert.deepEqual(subjectAverages([grade('math', 73)]), [
    { subjectId: 'math', name: 'Matematik', average: 73, count: 1 },
  ])
  assert.equal(overallAverage([{ score: 73 }]), 73)
})

test('karışık derslerde ders ortalaması yuvarlanır, Türkçe ad sırasıyla dizilir', () => {
  const result = subjectAverages([
    grade('math', 80),
    grade('eng', 90),
    grade('math', 55),
    grade('art', 61),
    grade('math', 70),
    grade('eng', 71),
  ])
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
    subjectAverages(grades).map((item) => item.average),
    [40, 100],
  )
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

test('IST-093: tarih aralığı hatası bitiş < başlangıç ve 1 yıldan uzun aralığı yakalar', () => {
  assert.equal(attendanceRangeError('2026-10-06', '2026-10-05'), ATTENDANCE_RANGE_ORDER_ERROR)
  assert.equal(attendanceRangeError('2025-10-05', '2026-10-06'), ATTENDANCE_RANGE_LONG_ERROR)
  // Başlangıçtan bir yıl sonraki gün dahildir; artık yıl ve tek uçlu aralık geçerlidir.
  assert.equal(attendanceRangeError('2025-10-06', '2026-10-06'), '')
  assert.equal(attendanceRangeError('2024-02-29', '2025-03-01'), '')
  assert.equal(attendanceRangeError('2024-02-29', '2025-03-02'), ATTENDANCE_RANGE_LONG_ERROR)
  assert.equal(attendanceRangeError('2026-10-06', '2026-10-06'), '')
  assert.equal(attendanceRangeError('', '2026-10-05'), '')
  assert.equal(attendanceRangeError('2026-10-06', ''), '')
})

test('IST-093: aralık süzgeci geçerli uçları sunucuya taşır; geçersiz aralık uygulanmaz', () => {
  assert.deepEqual(attendanceRangeFilters('2026-10-01', '2026-10-15'), {
    dateFrom: '2026-10-01',
    dateTo: '2026-10-15',
  })
  assert.deepEqual(attendanceRangeFilters('2026-10-01', ''), { dateFrom: '2026-10-01' })
  assert.deepEqual(attendanceRangeFilters('', '2026-10-15'), { dateTo: '2026-10-15' })
  assert.deepEqual(attendanceRangeFilters('', ''), {})
  assert.deepEqual(attendanceRangeFilters('2026-10-15', '2026-10-01'), {})
  assert.deepEqual(attendanceRangeFilters('2024-01-01', '2026-10-01'), {})
})

test('DOM-AKD-036: geç geldi satırı dakikayı taşır; CSV durumu "Geç geldi · 12 dk" yazar', () => {
  const { seed, lookups } = sources()
  const base = { ...seed.attendance[0]!, classId: 'c1', reason: '' }
  const late = attendanceRow(wrap([{ ...base, status: 'late', lateMinutes: 12 }])[0]!, lookups)
  assert.equal(late.lateMinutes, 12)
  assert.equal(attendanceCsvRow(late).statusLabel, 'Geç geldi · 12 dk')
  const plain = attendanceRow(wrap([{ ...base, status: 'late' }])[0]!, lookups)
  assert.equal(plain.lateMinutes, null)
  assert.equal(attendanceCsvRow(plain).statusLabel, 'Geç geldi')
  // Dakika yalnız geç gelen kayıtta anlamlıdır.
  const other = attendanceRow(wrap([{ ...base, status: 'present', lateMinutes: 5 }])[0]!, lookups)
  assert.equal(other.lateMinutes, null)
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
