import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import {
  ALL_BRANCHES,
  RISK_LEVELS,
  branchFilterValue,
  filterByBranch,
  riskLevel,
  riskReasons,
  riskRows,
  riskSummary,
} from '../src/pages/management/risk-rows.ts'

const NOW = new Date('2026-10-15T09:00:00.000Z')
const seed = createSeed(NOW)
const lookups = {
  classes: new Map(seed.classes.map((item) => [item.id, item])),
  branches: new Map(seed.branches.map((item) => [item.id, item])),
}
const wrap = <T extends { id: string }>(records: readonly T[]) =>
  records.map((record) => ({
    id: record.id,
    version: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    archivedAt: null,
    record,
  }))
const students = wrap(seed.students.slice(0, 6))
const [s1, s2, s3, s4, s5] = students.map((row) => row.id) as [
  string,
  string,
  string,
  string,
  string,
]
const counts = (groups: { value: string; count: number; sum?: number }[]) => ({
  groups,
  total: groups.reduce((sum, group) => sum + group.count, 0),
})

test('riskLevel (IST-121): eşikler Vue ile aynı; 6 ders ya da 65 altı listeye girer, 8 ders ya da 55 altı yüksektir', () => {
  assert.equal(riskLevel(80, 5), null)
  assert.equal(riskLevel(65, 5), null)
  assert.equal(riskLevel(64, 0), RISK_LEVELS.watch)
  assert.equal(riskLevel(90, 6), RISK_LEVELS.watch)
  assert.equal(riskLevel(90, 8), RISK_LEVELS.high)
  assert.equal(riskLevel(54, 0), RISK_LEVELS.high)
  assert.equal(riskLevel(55, 0), RISK_LEVELS.watch)
})

test('riskLevel: hiç notu olmayan öğrencinin ortalaması uydurulmaz, yalnız devamsızlık değerlendirilir', () => {
  assert.equal(riskLevel(null, 0), null)
  assert.equal(riskLevel(null, 6), RISK_LEVELS.watch)
})

test('riskRows: ortalama sunucu toplamından hesaplanır, aktif olmayan öğrenci ve eşik altı öğrenci dışarıda kalır', () => {
  const inactive = students.map((row) =>
    row.id === s5 ? { ...row, record: { ...row.record, isActive: false } } : row,
  )
  const rows = riskRows(
    inactive,
    lookups,
    counts([
      { value: s1, count: 3, sum: 200 }, // 67: risk yok
      { value: s2, count: 2, sum: 100 }, // 50: yüksek
      { value: s3, count: 2, sum: 125 }, // 63: takip
      { value: s5, count: 1, sum: 10 }, // pasif
    ]),
    counts([
      { value: s1, count: 7 }, // devamsız: takip
      { value: s4, count: 9 }, // notsuz ama 9 devamsızlık: yüksek
    ]),
  )
  assert.deepEqual(
    rows.map((row) => [row.id, row.risk, row.score, row.absent]),
    [
      [s4, RISK_LEVELS.high, null, 9],
      [s2, RISK_LEVELS.high, 50, 0],
      [s1, RISK_LEVELS.watch, 67, 7],
      [s3, RISK_LEVELS.watch, 63, 0],
    ],
  )
  assert.deepEqual(riskSummary(rows), { tracked: 4, high: 2 })
})

test('riskRows: sınıf ve şube adı kapsamdaki kayıtlardan gelir; sayım yokken liste boştur', () => {
  const [row] = riskRows(students, lookups, undefined, counts([{ value: s1, count: 6 }]))
  const student = seed.students.find((item) => item.id === s1)!
  const schoolClass = seed.classes.find((item) => item.id === student.classId)!
  assert.equal(row?.class, schoolClass.name)
  assert.equal(row?.branch, seed.branches.find((item) => item.id === schoolClass.branchId)?.name)
  assert.deepEqual(riskRows(students, lookups, undefined, undefined), [])
})

test('riskRows (DOM-YTK-020, DOM-ILT-041): satırlar yalnız ölçülen alanları taşır, rehberlik iç notu alanı yoktur', () => {
  const rows = riskRows(students, lookups, counts([{ value: s2, count: 1, sum: 10 }]), undefined)
  for (const row of rows)
    assert.deepEqual(Object.keys(row).sort(), [
      'absent',
      'branch',
      'branchId',
      'class',
      'classId',
      'id',
      'name',
      'number',
      'risk',
      'score',
    ])
})

test('riskReasons: nedenler yalnız aşılan eşiklerden yazılır', () => {
  assert.deepEqual(riskReasons({ score: 60, absent: 7 }), [
    '7 ders devamsızlık',
    'Not ortalaması 60/100',
  ])
  assert.deepEqual(riskReasons({ score: null, absent: 2 }), [])
})

test('filterByBranch (IST-121): kampüs seçilince yalnız o kampüsün öğrencileri kalır, boş değer hepsini döndürür', () => {
  const [a, b] = seed.branches
  assert.ok(a && b)
  const inBranch = (branchId: string) =>
    seed.students.filter(
      (student) => seed.classes.find((item) => item.id === student.classId)?.branchId === branchId,
    )
  const first = inBranch(a.id)[0]
  const second = inBranch(b.id)[0]
  assert.ok(first && second)
  const rows = riskRows(
    wrap([first, second]),
    lookups,
    undefined,
    counts([
      { value: first.id, count: 7 },
      { value: second.id, count: 9 },
    ]),
  )
  assert.equal(rows.length, 2)
  assert.deepEqual(filterByBranch(rows, ALL_BRANCHES), rows)
  assert.deepEqual(
    filterByBranch(rows, a.id).map((row) => row.id),
    [first.id],
  )
  assert.deepEqual(
    filterByBranch(rows, b.id).map((row) => row.id),
    [second.id],
  )
  assert.deepEqual(filterByBranch(rows, 'yok-kampus'), [])
})

test('branchFilterValue: bilinmeyen ya da boş kampüs değeri "tümü" sayılır', () => {
  const [a] = seed.branches
  assert.ok(a)
  assert.equal(branchFilterValue(a.id, lookups.branches), a.id)
  assert.equal(branchFilterValue(null, lookups.branches), ALL_BRANCHES)
  assert.equal(branchFilterValue('bozuk', lookups.branches), ALL_BRANCHES)
})
