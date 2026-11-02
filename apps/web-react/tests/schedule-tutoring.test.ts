import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { academicLookups, type AcademicSources } from '../src/pages/academic/academic-rows.ts'
import {
  scheduleByDay,
  scheduleLesson,
  viewDays,
  type Lesson,
} from '../src/pages/academic/schedule-model.ts'
import {
  scheduleTutoring,
  scheduleTutorings,
  type TutorSessionRecord,
} from '../src/pages/academic/schedule-tutoring.ts'

// IST-096: haftalık ders programında kazanım etütleri (Vue `tutoringCalendarEntries` ile aynı
// metin; iptal hariç; hafta sınırı Europe/Istanbul; öğrenci listesi yalnız öğretmen ve yönetici).

const NOW = new Date('2026-10-15T09:00:00.000Z')
const wrap = <T extends { id: string }>(records: readonly T[]) =>
  records.map((record) => ({
    id: record.id,
    version: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    archivedAt: null,
    record,
  }))

function fixture() {
  const seed = createSeed(NOW)
  const sources: AcademicSources = {
    subjects: wrap(seed.subjects),
    classes: wrap(seed.classes),
    students: wrap(seed.students),
    teachers: wrap(seed.teachers),
    branches: wrap(seed.branches),
  }
  return { seed, lookups: academicLookups(sources) }
}

const session = (overrides: Partial<TutorSessionRecord> = {}): TutorSessionRecord => ({
  id: 'etut-1',
  examId: 'exam-1',
  branchId: 'b1',
  grade: 7,
  subjectId: 'math',
  topic: 'Cebirsel ifadeler',
  studentIds: ['s1', 's2', 's3'],
  scores: [],
  teacherId: 't1',
  // 27 Ekim 2026 Salı 16:00 (İstanbul).
  date: '2026-10-27T13:00:00.000Z',
  duration: 40,
  room: '204',
  roomClassId: 'c1',
  capacity: 6,
  status: 'Planlandı',
  attendance: {},
  threshold: 70,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  ...overrides,
})

describe('programdaki etüt satırı (IST-096)', () => {
  test('başlık ve alt satır Vue ile aynı biçimdedir; saat İstanbul saatidir', () => {
    const { lookups } = fixture()
    const subject = lookups.subjects.get('math')!.name
    const row = scheduleTutoring(session(), lookups, 'teacher')!
    assert.equal(row.kind, 'tutoring')
    assert.equal(row.title, `Etüt · ${subject} · Cebirsel ifadeler`)
    assert.equal(row.subtitle, '3 öğrenci · Derslik 204')
    assert.equal(row.day, '2026-10-27')
    assert.equal(row.time, '16:00')
    assert.equal(row.cancelled, false)
  })

  test('iptal edilen etüt programda yoktur', () => {
    const { lookups } = fixture()
    assert.equal(scheduleTutoring(session({ status: 'İptal' }), lookups, 'teacher'), null)
    const rows = scheduleTutorings(
      [session(), session({ id: 'etut-2', status: 'İptal' }), session({ id: 'etut-3' })],
      lookups,
      'teacher',
    )
    assert.deepEqual(
      rows.map((row) => row.id),
      ['etut-1', 'etut-3'],
    )
  })

  test('öğrenci adları yalnız öğretmen ve yöneticide; öğrenci kitlesinde liste yoktur', () => {
    const { seed, lookups } = fixture()
    const name = (id: string) => seed.students.find((s) => s.id === id)!.name
    const teacher = scheduleTutoring(session(), lookups, 'teacher')!
    assert.deepEqual(
      teacher.students?.map((s) => s.name),
      ['s1', 's2', 's3'].map(name),
    )
    assert.equal(scheduleTutoring(session(), lookups, 'admin')!.students?.length, 3)
    const student = scheduleTutoring(session({ studentIds: ['s1'] }), lookups, 'student')!
    assert.equal(student.students, null)
    assert.equal(student.studentCount, 1)
    assert.equal(student.subtitle, '1 öğrenci · Derslik 204')
  })

  test('veli: seçili çocuk dışındaki kayıt yoktur, sayı çocuğa daraltılır', () => {
    const { lookups } = fixture()
    // Sunucu veliye yalnız kendi çocuklarını bırakır (s1 ve s2); seçili çocuk s2.
    const own = session({ studentIds: ['s1', 's2'] })
    const row = scheduleTutoring(own, lookups, 'student', 's2')!
    assert.equal(row.studentCount, 1)
    assert.equal(row.subtitle, '1 öğrenci · Derslik 204')
    assert.equal(row.students, null)
    assert.equal(scheduleTutoring(own, lookups, 'student', 's9'), null)
  })

  test('hafta sınırı Europe/Istanbul gününe göredir (UTC gece yarısı sınırı kaymaz)', () => {
    const { lookups } = fixture()
    // 25 Ekim 21:30 UTC = 26 Ekim 00:30 İstanbul: pazartesi, yeni haftanın ilk günü.
    const monday = session({ id: 'pzt', date: '2026-10-25T21:30:00.000Z' })
    // 1 Kasım 20:59 UTC = 1 Kasım 23:59 İstanbul: o haftanın pazarı.
    const sunday = session({ id: 'paz', date: '2026-11-01T20:59:00.000Z' })
    // 1 Kasım 21:00 UTC = 2 Kasım 00:00 İstanbul: bir sonraki haftanın pazartesisi.
    const next = session({ id: 'sonraki', date: '2026-11-01T21:00:00.000Z' })
    const rows = scheduleTutorings([monday, sunday, next], lookups, 'teacher')
    const week = viewDays('hafta', '2026-10-26')
    const byDay = scheduleByDay(rows, week)
    assert.deepEqual(
      byDay.get('2026-10-26')?.map((row) => row.id),
      ['pzt'],
    )
    assert.deepEqual(
      byDay.get('2026-11-01')?.map((row) => row.id),
      ['paz'],
    )
    const total = [...byDay.values()].flat().length
    assert.equal(total, 2)
    assert.equal(
      [...scheduleByDay(rows, viewDays('hafta', '2026-11-02')).values()].flat()[0]?.id,
      'sonraki',
    )
  })

  test('ders ve etüt aynı günde saat sırasıyla birleşir', () => {
    const { lookups } = fixture()
    const lesson: Lesson = {
      id: 'ders-1',
      version: 1,
      classId: 'c1',
      subjectId: 'math',
      title: 'Matematik',
      teacherId: 't1',
      originalTeacherId: null,
      date: '2026-10-27T06:00:00.000Z',
      duration: 40,
      room: '101',
      status: 'planned',
      cancelledAt: null,
      updatedAt: NOW.toISOString(),
    }
    const entries = [
      ...scheduleTutorings([session()], lookups, 'teacher'),
      scheduleLesson(lesson, lookups, 'teacher'),
    ]
    const day = scheduleByDay(entries, viewDays('hafta', '2026-10-26')).get('2026-10-27')!
    assert.deepEqual(
      day.map((row) => `${row.kind}:${row.time}`),
      ['lesson:09:00', 'tutoring:16:00'],
    )
  })
})
