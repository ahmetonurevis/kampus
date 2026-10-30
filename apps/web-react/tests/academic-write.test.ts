import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  attendanceMarks,
  defaultTerm,
  gradeTypeOptions,
  markCounts,
  scoreValue,
  teachingClassIds,
  teachingSubjectIds,
} from '../src/pages/academic/academic-write.ts'

const assignments = [
  { classId: 'c1', subjectId: 'math', teacherId: 't1' },
  { classId: 'c1', subjectId: 'phys', teacherId: 't2' },
  { classId: 'c2', subjectId: 'math', teacherId: 't1' },
  { classId: 'c2', subjectId: 'math', teacherId: 't1' },
  { classId: 'c3', subjectId: 'art', teacherId: 't2' },
]

test('öğretmen yalnız ders verdiği sınıfı ve dersi seçebilir', () => {
  assert.deepEqual([...teachingClassIds(assignments, 't1')].sort(), ['c1', 'c2'])
  assert.deepEqual(teachingSubjectIds(assignments, 't1', 'c1'), ['math'])
  assert.deepEqual(teachingSubjectIds(assignments, 't1', 'c2'), ['math'], 'tekrarsız')
  assert.deepEqual(teachingSubjectIds(assignments, 't1', 'c3'), [])
  assert.equal(teachingClassIds(assignments, '').size, 0)
})

test('yoklama işaretleri: varsayılan geldi, kayıtlı gün yüklenir, düzenleme üste biner', () => {
  const ids = ['s1', 's2', 's3']
  assert.deepEqual(attendanceMarks(ids, []), { s1: 'present', s2: 'present', s3: 'present' })
  const saved = [
    { studentId: 's1', status: 'absent' },
    { studentId: 's2', status: 'late' },
    { studentId: 's9', status: 'absent' },
    { studentId: 's3', status: 'bilinmeyen' },
  ]
  assert.deepEqual(attendanceMarks(ids, saved), { s1: 'absent', s2: 'late', s3: 'present' })
  assert.deepEqual(attendanceMarks(ids, saved, { s1: 'excused' }), {
    s1: 'excused',
    s2: 'late',
    s3: 'present',
  })
})

test('işaret sayımı dört durumu ayrı sayar', () => {
  assert.deepEqual(
    markCounts({ a: 'present', b: 'present', c: 'late', d: 'excused', e: 'absent' }),
    { present: 2, absent: 1, late: 1, excused: 1 },
  )
})

test('dönem varsayılanı eylülden ocağa 1, şubattan ağustosa 2', () => {
  assert.equal(defaultTerm('2026-10-30'), 1)
  assert.equal(defaultTerm('2027-01-15'), 1)
  assert.equal(defaultTerm('2027-02-01'), 2)
  assert.equal(defaultTerm('2027-08-31'), 2)
  assert.equal(defaultTerm('2026-09-01'), 1)
})

test('katılım puanı yalnız ortaokulda (8. sınıfa kadar) sunulur', () => {
  const types = (grade: number | undefined) => gradeTypeOptions(grade).map((option) => option.value)
  assert.deepEqual(types(7), ['sinav', 'performans', 'proje', 'katilim'])
  assert.deepEqual(types(9), ['sinav', 'performans', 'proje'])
  assert.equal(gradeTypeOptions(5)[0]?.label, 'sınav')
})

test('boş puan alanı 0 sayılmaz', () => {
  assert.equal(scoreValue(''), undefined)
  assert.equal(scoreValue('  '), undefined)
  assert.equal(scoreValue(Number.NaN), undefined)
  assert.equal(scoreValue('0'), 0)
  assert.equal(scoreValue('88'), 88)
  assert.equal(scoreValue(72), 72)
  assert.equal(scoreValue(undefined), undefined)
})
