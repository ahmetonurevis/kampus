import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import {
  archiveViewFilter,
  campusesInView,
  campusSummaries,
  classCsvRow,
  classRow,
  isActiveFilter,
  isArchiveView,
  managementLookups,
  recordStatus,
  studentCountsByClass,
  teacherCsvRow,
  teacherRow,
  type ManagementSources,
} from '../src/pages/management/management-rows.ts'

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

/** Kampüse bağlı kayıt: sunucu `joined.branchName` döndürür. */
const wrapWithBranch = <T extends { id: string; branchId: string }>(records: readonly T[]) => {
  const branches = createSeed(NOW).branches
  return wrap(records).map((row) => {
    const name = branches.find((branch) => branch.id === row.record.branchId)?.name
    return name ? { ...row, joined: { branchName: name } } : row
  })
}

/** Sunucu `counts?groupBy=classId&isActive=true` yanıtının seed'den karşılığı. */
function activeStudentCounts() {
  const byClass = new Map<string, number>()
  for (const student of createSeed(NOW).students)
    if (student.isActive) byClass.set(student.classId, (byClass.get(student.classId) ?? 0) + 1)
  return studentCountsByClass({
    total: [...byClass.values()].reduce((sum, count) => sum + count, 0),
    groups: [...byClass].map(([value, count]) => ({ value, count })),
  })
}

function sources(): ManagementSources {
  const seed = createSeed(NOW)
  return {
    branches: wrap(seed.branches),
    classes: wrapWithBranch(seed.classes),
    teachers: wrapWithBranch(seed.teachers),
    assignments: wrap(seed.assignments),
    subjects: wrap(seed.subjects),
  }
}

test('sınıf satırı kampüs, danışman, aktif öğrenci ve ders sayısını eşlemeden alır', () => {
  const data = sources()
  const lookups = managementLookups(data, activeStudentCounts())
  const c1 = data.classes.find((row) => row.id === 'c1')!
  const row = classRow(c1, lookups)
  const seed = createSeed(NOW)
  const expectedCount = seed.students.filter((s) => s.classId === 'c1' && s.isActive).length
  assert.equal(row.name, '7-A')
  assert.equal(row.branch, seed.branches.find((b) => b.id === c1.record.branchId)!.name)
  assert.equal(row.teacher, 'Selin Kaya')
  assert.equal(row.count, expectedCount)
  assert.equal(row.detail, `Ortaokul · Derslik ${c1.record.room}`)
  assert.equal(row.lessons, seed.assignments.filter((a) => a.classId === 'c1').length)
  assert.equal(row.status, 'Aktif')
  assert.equal(classCsvRow(row).count, `${expectedCount} / ${c1.record.capacity}`)
})

test('sayım yanıtı sınıf kimliğine eşlenir; sınıfsız (null) grup ve eksik sınıf 0 kalır', () => {
  const counts = studentCountsByClass({
    total: 7,
    groups: [
      { value: 'c1', count: 5 },
      { value: 'c2', count: 1 },
      { value: null, count: 1 },
    ],
  })
  assert.deepEqual(
    [...counts],
    [
      ['c1', 5],
      ['c2', 1],
    ],
  )
  const data = sources()
  const lookups = managementLookups(data, counts)
  assert.equal(
    classRow(
      data.classes.find((row) => row.id === 'c1')!,
      lookups,
    ).count,
    5,
  )
  assert.equal(
    classRow(
      data.classes.find((row) => row.id === 'c3')!,
      lookups,
    ).count,
    0,
  )
  // Sayım gelmeden (bekleyen sorgu) satır kırılmaz.
  assert.equal(classRow(data.classes[0]!, managementLookups(data)).count, 0)
})

test('lise sınıfı Lise olarak etiketlenir; eksik eşleme boş kalır', () => {
  const data = sources()
  const lookups = managementLookups(data, activeStudentCounts())
  const lise = data.classes.find((row) => row.record.grade >= 9)!
  const orphan = { ...lise, record: { ...lise.record, branchId: 'yok', teacherId: 'yok' } }
  const row = classRow(orphan, lookups)
  assert.match(row.detail, /^Lise · Derslik /)
  assert.equal(row.teacher, '')
  // Kampüs adı gelmeyen (kapsam dışı) kayıtta "—".
  assert.equal(classRow({ ...lise, joined: {} }, lookups).branch, '—')
})

test('öğretmen satırı aktif sınıflardaki dersleri listeler; dersi yoksa açıklama yazar', () => {
  const data = sources()
  const lookups = managementLookups(data)
  const t1 = data.teachers.find((row) => row.id === 't1')!
  const row = teacherRow(t1, lookups)
  assert.equal(row.name, 'Selin Kaya')
  assert.equal(row.subject, 'Matematik')
  assert.ok(row.classes.split(', ').includes('7-A'))
  assert.equal(teacherCsvRow(row).attendanceRate, `%${t1.record.attendanceRate}`)

  // 7-A arşivlenirse o sınıftaki dersi listelenmez.
  data.classes = data.classes.map((item) =>
    item.id === 'c1' ? { ...item, record: { ...item.record, isActive: false } } : item,
  )
  assert.equal(teacherRow(t1, managementLookups(data)).classes.split(', ').includes('7-A'), false)

  data.assignments = data.assignments.filter((item) => item.record.teacherId !== 't1')
  assert.equal(teacherRow(t1, managementLookups(data)).classes, 'Henüz ders atanmamış')
})

test('kampüs özeti yalnız aktif sınıf, öğrenci ve öğretmenleri sayar', () => {
  const data = sources()
  const seed = createSeed(NOW)
  const lookups = managementLookups(data, activeStudentCounts())
  const [first] = campusSummaries(data, lookups)
  const b1Classes = seed.classes.filter((c) => c.branchId === 'b1')
  assert.equal(first!.id, 'b1')
  assert.equal(first!.classes.length, b1Classes.length)
  assert.equal(
    first!.students,
    seed.students.filter((s) => s.isActive && b1Classes.some((c) => c.id === s.classId)).length,
  )
  assert.equal(first!.teachers, seed.teachers.filter((t) => t.branchId === 'b1').length)

  data.teachers = data.teachers.map((item) =>
    item.id === 't1' ? { ...item, record: { ...item.record, isActive: false } } : item,
  )
  assert.equal(campusSummaries(data, managementLookups(data))[0]!.teachers, first!.teachers - 1)
  assert.equal(recordStatus({ isActive: false }), 'Arşivde')
  assert.equal(recordStatus({}), 'Aktif')
})

test('kayıt durumu sekmesi adres değerine ve sunucu isActive süzgecine çevrilir', () => {
  assert.equal(isArchiveView('arsiv'), true)
  assert.equal(isArchiveView(''), false)
  assert.equal(isArchiveView(undefined), false)
  assert.equal(archiveViewFilter(true), 'arsiv')
  assert.equal(archiveViewFilter(false), '')
  assert.deepEqual(isActiveFilter(false), { isActive: 'true' })
  assert.deepEqual(isActiveFilter(true), { isActive: 'false' })
})

test('kampüs kartları sekmeye göre süzülür', () => {
  const cards = [{ status: 'Aktif' }, { status: 'Arşivde' }, { status: 'Aktif' }]
  assert.equal(campusesInView(cards, false).length, 2)
  assert.deepEqual(campusesInView(cards, true), [{ status: 'Arşivde' }])
})
