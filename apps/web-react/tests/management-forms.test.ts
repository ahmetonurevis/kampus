import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { subjectsForGrade } from '@kampus/school-core/data/curriculum.ts'
import {
  ARCHIVE_ERROR_CODES,
  archiveDependents,
  archiveDestinations,
  assignedTeachers,
  branchDefaults,
  canManageStructure,
  CLASS_ERROR_FIELDS,
  COORDINATOR_BRANCH_ERROR,
  COORDINATOR_DUTIES_PATH,
  TEACHER_ERROR_FIELDS,
  classBody,
  classDefaults,
  classStepOf,
  fillSubjectTeachers,
  missingTeachers,
  NO_DESTINATION,
  recordName,
  teacherDefaults,
  transferSummary,
} from '../src/pages/management/management-forms.ts'
import {
  managementLookups,
  studentCountsByClass,
  type ManagementSources,
} from '../src/pages/management/management-rows.ts'

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

function lookups(mutate?: (state: typeof seed) => void) {
  const state = structuredClone(seed)
  mutate?.(state)
  const sources: ManagementSources = {
    branches: wrap(state.branches),
    classes: wrap(state.classes),
    teachers: wrap(state.teachers),
    assignments: wrap(state.assignments),
    subjects: wrap(state.subjects),
  }
  const byClass = new Map<string, number>()
  for (const student of state.students)
    if (student.isActive) byClass.set(student.classId, (byClass.get(student.classId) ?? 0) + 1)
  const counts = studentCountsByClass({
    total: 0,
    groups: [...byClass].map(([value, count]) => ({ value, count })),
  })
  return managementLookups(sources, counts)
}

test('düzenleme düğmeleri yalnız yöneticiye görünür; ön büro ve diğer roller salt okur (DOM-YTK-001)', () => {
  assert.equal(canManageStructure('yonetici'), true)
  for (const role of ['onburo', 'ogretmen', 'ogrenci', 'veli'] as const)
    assert.equal(canManageStructure(role), false, role)
  assert.equal(canManageStructure(undefined), false)
})

test('form varsayılanları kayıttan dolar; yeni kayıtta ilk aktif kampüs seçilir', () => {
  const branch = seed.branches[0]!
  assert.deepEqual(branchDefaults(branch), { name: branch.name, address: branch.address })
  assert.deepEqual(branchDefaults(), { name: '', address: '' })

  const teacher = seed.teachers[0]!
  assert.equal(teacherDefaults(teacher, seed.branches).email, teacher.email)
  const created = teacherDefaults(undefined, seed.branches)
  assert.equal(created.branchId, branch.id)
  assert.equal(created.subjectId, 'math')

  const schoolClass = seed.classes.find((item) => item.id === 'c1')!
  const assignments = seed.assignments.filter((item) => item.classId === 'c1')
  const values = classDefaults(schoolClass, assignments, seed.branches, seed.teachers)
  assert.equal(values.section, schoolClass.section)
  assert.equal(values.capacity, schoolClass.capacity)
  assert.deepEqual(values.subjectTeachers, assignedTeachers(assignments))
  assert.equal(classDefaults(undefined, [], seed.branches, seed.teachers).capacity, 24)
})

test('ders öğretmeni önerisi geçerli seçimi korur, önce aynı kampüsten, sonra herhangi bir kampüsten seçer', () => {
  const teachers = seed.teachers
  const math = teachers.filter((teacher) => teacher.subjectId === 'math')
  const [first, second] = math
  assert.ok(first && second && first.branchId !== second.branchId)

  const filled = fillSubjectTeachers(7, second.branchId, { math: first.id }, teachers)
  assert.equal(filled.math, first.id, 'geçerli seçim korunur')

  const byCampus = fillSubjectTeachers(7, second.branchId, {}, teachers)
  assert.equal(teachers.find((teacher) => teacher.id === byCampus.math)?.branchId, second.branchId)

  // Başka branşın öğretmeni seçilmişse geçersizdir: yerine uygun öğretmen gelir.
  const wrong = teachers.find((teacher) => teacher.subjectId !== 'math')!
  assert.notEqual(
    fillSubjectTeachers(7, first.branchId, { math: wrong.id }, teachers).math,
    wrong.id,
  )

  // Düzeyde olmayan dersin eski seçimi gövdeye sızmaz.
  const keys = Object.keys(fillSubjectTeachers(5, first.branchId, { physics: 't1' }, teachers))
  assert.deepEqual(
    keys.sort(),
    subjectsForGrade(5)
      .map((subject) => subject.id)
      .sort(),
  )
})

test('pasif öğretmen önerilmez; öğretmeni olmayan ders eksik sayılır', () => {
  const math = seed.teachers.filter((teacher) => teacher.subjectId === 'math')
  const inactive = seed.teachers.map((teacher) =>
    teacher.subjectId === 'math' ? { ...teacher, isActive: false } : teacher,
  )
  assert.ok(math.length > 0)
  const filled = fillSubjectTeachers(7, math[0]!.branchId, {}, inactive)
  assert.equal(filled.math, '')
  assert.deepEqual(
    missingTeachers(7, { ...filled, turkish: 't2' }).some((item) => item.id === 'math'),
    true,
  )
  assert.deepEqual(
    missingTeachers(7, Object.fromEntries(subjectsForGrade(7).map((s) => [s.id, 't1']))),
    [],
  )
})

test('sınıf gövdesi yalnız düzeyin derslerini taşır', () => {
  const body = classBody({
    grade: 5,
    section: 'A',
    branchId: 'b1',
    teacherId: 't1',
    capacity: 24,
    room: '101',
    subjectTeachers: { math: 't1', physics: 't2', turkish: 't3' },
  })
  assert.equal('physics' in body.subjectTeachers, false)
  assert.equal(body.subjectTeachers.math, 't1')
})

test('sunucu hata kodları doğru alana ve adıma bağlanır', () => {
  assert.equal(CLASS_ERROR_FIELDS.capacity_below_students, 'capacity')
  assert.equal(CLASS_ERROR_FIELDS.classroom_in_use, 'room')
  assert.equal(CLASS_ERROR_FIELDS.class_name_taken, 'section')
  assert.equal(classStepOf('capacity'), 0)
  assert.equal(classStepOf('subjectTeachers.math'), 1)
  assert.ok(ARCHIVE_ERROR_CODES.has('transfer_capacity_insufficient'))
  assert.equal(ARCHIVE_ERROR_CODES.has('version_conflict'), false)
})

test('arşiv hedefleri: kampüs kendisi dışındaki aktifler, sınıf aynı düzeyde ve boş yerle, öğretmen aynı branşta', () => {
  const data = lookups((state) => {
    state.branches[1]!.isActive = false
  })
  const branches = archiveDestinations('branch', 'b1', data)
  assert.ok(branches.every((item) => item.id !== 'b1' && item.id !== 'b2'))
  assert.ok(branches.length > 0)

  const source = seed.classes.find((item) => item.id === 'c1')!
  const classes = archiveDestinations('class', 'c1', data)
  assert.ok(classes.length > 0)
  for (const item of classes) {
    const target = seed.classes.find((entry) => entry.id === item.id)!
    assert.equal(target.grade, source.grade)
    assert.match(item.label, /\d+ boş yer$/)
  }

  const teacher = seed.teachers.find((item) => item.id === 't1')!
  const teachers = archiveDestinations('teacher', 't1', data)
  assert.ok(teachers.length > 0)
  for (const item of teachers)
    assert.equal(seed.teachers.find((entry) => entry.id === item.id)?.subjectId, teacher.subjectId)

  assert.equal(recordName('class', 'c1', data), source.name)
  assert.equal(recordName('class', 'yok', data), undefined)
})

test('arşiv sonucu aktarılan kayıtları Türkçe sayar; aktarım yoksa boş döner', () => {
  const entity = { collection: 'classes', id: 'c1' }
  assert.equal(transferSummary({ entity, records: [{ ...entity, change: 'archive' }] }), '')
  const text = transferSummary({
    entity,
    records: [
      { ...entity, change: 'archive' },
      { collection: 'students', id: 's1', change: 'update' },
      { collection: 'students', id: 's2', change: 'update' },
      { collection: 'schedule', id: 'l1', change: 'update' },
      { collection: 'bilinmeyenKoleksiyon', id: 'x1', change: 'update' },
    ],
  })
  assert.equal(text, 'Aktarılan kayıtlar: 2 öğrenci, 1 ders, 1 diğer kayıt.')
  assert.equal(
    transferSummary(
      { entity, records: [{ collection: 'students', id: 's1', change: 'update' }] },
      'Ataşehir Kampüsü',
    ),
    '1 öğrenci Ataşehir Kampüsü hedefine aktarıldı.',
  )
  assert.doesNotMatch(text, /bilinmeyen/)
})

test('arşiv penceresi bağlı aktif kayıtları sayar; bağ yoksa hedef istenmez (IST-010)', () => {
  const data = lookups()
  assert.deepEqual(archiveDependents('class', 'c1', data), ['10 öğrenci'])
  // t1 (Selin Kaya): 8 ders ataması, 4 sınıfın danışmanı.
  assert.deepEqual(archiveDependents('teacher', 't1', data), [
    '8 ders ataması',
    '4 sınıf danışmanlığı',
  ])
  assert.deepEqual(archiveDependents('branch', 'b3', data), [
    '8 sınıf',
    '80 öğrenci',
    '16 öğretmen',
  ])

  // Arşivdeki sınıfın atamaları ve danışmanlığı sayılmaz; öğrencisiz sınıf hedef istemez.
  const archived = lookups((state) => {
    for (const item of state.classes) if (item.teacherId === 't1') item.isActive = false
    for (const item of state.assignments) if (item.teacherId === 't1') item.classId = 'c1'
    for (const student of state.students) if (student.classId === 'c2') student.isActive = false
  })
  assert.deepEqual(archiveDependents('teacher', 't1', archived), [])
  assert.deepEqual(archiveDependents('class', 'c2', archived), [])
  assert.match(NO_DESTINATION.teacher, /aynı branştan/)
  assert.ok(ARCHIVE_ERROR_CODES.has('tutor_schedule_conflict'))
})

test('DOM-YTK-027: zümre başkanlığı branş reddi Branş alanına bağlanır ve görev sayfasına yönlendirir', () => {
  assert.equal(TEACHER_ERROR_FIELDS.coordinator_duty_outside_branch, 'subjectId')
  assert.equal(TEACHER_ERROR_FIELDS[COORDINATOR_BRANCH_ERROR], 'subjectId')
  assert.equal(COORDINATOR_DUTIES_PATH, '/yonetici/koordinator-gorevleri')
})
