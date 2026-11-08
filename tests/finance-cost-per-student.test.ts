import assert from 'node:assert/strict'
import test from 'node:test'

import type { CostCenterNode } from '../packages/school-core/src/lib/finance-cost-centers.ts'
import {
  costPerStudent,
  costPerStudentCsv,
  costReportQuerySchema,
  periodStudents,
  splitByWeights,
  type CostCenterInfo,
  type CostExpenseLine,
  type PlacedStudent,
} from '../packages/school-core/src/lib/finance-cost-per-student.ts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const COURSE = '00000000-0000-4000-8000-0000000000c1'
const center = (
  n: number,
  code: string,
  overrides: Partial<CostCenterNode> = {},
): CostCenterInfo => ({
  id: id(n),
  code,
  name: `Merkez ${code}`,
  type: 'unit',
  parentId: null,
  campusId: null,
  gradeLevel: null,
  courseId: null,
  isActive: true,
  ...overrides,
})
const placed = (
  count: number,
  prefix: string,
  campusId: string | null,
  gradeLevel: number | null,
  courseIds: string[] = [],
): PlacedStudent[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${String(index + 1)}`,
    campusId,
    gradeLevel,
    courseIds,
  }))

// GEN (birim, kök) · KAD (kampüs b1) ⊃ KAD-IDR (birim), KAD-7, KAD-8 · ATA (kampüs b2)
const GEN = center(1, 'GEN')
const KAD = center(2, 'KAD', { type: 'campus', campusId: 'b1' })
const KAD_IDR = center(3, 'KAD-IDR', { parentId: id(2) })
const KAD_7 = center(4, 'KAD-7', { type: 'program', parentId: id(2), gradeLevel: 7 })
const KAD_8 = center(5, 'KAD-8', { type: 'program', parentId: id(2), gradeLevel: 8 })
const ATA = center(6, 'ATA', { type: 'campus', campusId: 'b2' })
const CENTERS = [GEN, KAD, KAD_IDR, KAD_7, KAD_8, ATA]
const LINES: CostExpenseLine[] = [
  { costCenterId: GEN.id, amountCents: 1_000_000 },
  { costCenterId: KAD.id, amountCents: 600_000 },
  { costCenterId: KAD_IDR.id, amountCents: 400_000 },
  { costCenterId: KAD_7.id, amountCents: 100_000 },
  { costCenterId: KAD_7.id, amountCents: 200_000 },
  { costCenterId: ATA.id, amountCents: 200_000 },
]
const STUDENTS = [
  ...placed(6, 'k7-', 'b1', 7),
  ...placed(4, 'k8-', 'b1', 8),
  ...placed(5, 'a7-', 'b2', 7),
  ...placed(1, 'x-', null, 7),
]
const rowOf = (report: ReturnType<typeof costPerStudent>, code: string) => {
  const row = report.centers.find((item) => item.code === code)
  assert.ok(row, code)
  return row
}

test('DOM-FIN-065: ortak gider öğrenci sayısıyla yukarıdan aşağıya paylaştırılır', () => {
  const report = costPerStudent({
    key: 'students',
    centers: CENTERS,
    lines: LINES,
    students: STUDENTS,
  })
  // Kök: GEN 1.000.000, KAD (10) : ATA (5) → 666.667 / 333.333 (kalan kuruş büyük kesre).
  const kad = rowOf(report, 'KAD')
  assert.equal(kad.sharedInCents, 666_667)
  assert.equal(kad.directCents, 600_000)
  assert.equal(kad.totalCents, 1_966_667)
  assert.equal(kad.studentCount, 10)
  assert.equal(kad.perStudentCents, 196_667)
  // KAD kapsamı: gelen pay + KAD + KAD-IDR = 1.666.667, 6 : 4.
  const k7 = rowOf(report, 'KAD-7')
  assert.equal(k7.sharedInCents, 1_000_000)
  assert.equal(k7.totalCents, 1_300_000)
  assert.equal(k7.perStudentCents, 216_667)
  assert.equal(k7.campusId, 'b1')
  const k8 = rowOf(report, 'KAD-8')
  assert.equal(k8.totalCents, 666_667)
  assert.equal(k8.studentCount, 4)
  assert.equal(k8.perStudentCents, null, 'küçük grup gizlenir')
  assert.equal(k8.suppressed, true)
  assert.equal(k7.totalCents + k8.totalCents, kad.totalCents, 'alt merkezler kampüsü tamamlar')
  const ata = rowOf(report, 'ATA')
  assert.equal(ata.totalCents, 533_333)
  assert.equal(ata.perStudentCents, 106_667)
  assert.equal(kad.totalCents + ata.totalCents, 2_500_000, 'kampüsler toplam gideri taşır')
  const gen = rowOf(report, 'GEN')
  assert.equal(gen.shared, true)
  assert.equal(gen.studentCount, null)
  assert.equal(gen.totalCents, 1_000_000)
  assert.deepEqual(report.totals, {
    expenseCents: 2_500_000,
    studentCount: 16,
    perStudentCents: 156_250,
    suppressed: false,
    unallocatedCents: 0,
    studentsWithoutCampus: 1,
  })
  assert.deepEqual(
    report.centers.map((row) => [row.path, row.depth]),
    [
      ['ATA', 1],
      ['GEN', 1],
      ['KAD', 1],
      ['KAD / KAD-7', 2],
      ['KAD / KAD-8', 2],
      ['KAD / KAD-IDR', 2],
    ],
  )
})

test('DOM-FIN-065: eşit anahtar ortak gideri öğrencili merkezlere eşit böler', () => {
  const report = costPerStudent({
    key: 'equal',
    centers: CENTERS,
    lines: LINES,
    students: STUDENTS,
  })
  assert.equal(rowOf(report, 'KAD').sharedInCents, 500_000)
  assert.equal(rowOf(report, 'ATA').sharedInCents, 500_000)
  assert.equal(rowOf(report, 'KAD-7').totalCents, 1_050_000)
  assert.equal(rowOf(report, 'KAD-8').totalCents, 750_000)
})

test('DOM-FIN-065: öğrencili merkez yoksa kökteki ortak gider paylaştırılamaz', () => {
  const report = costPerStudent({
    key: 'students',
    centers: [GEN, KAD],
    lines: [{ costCenterId: GEN.id, amountCents: 1_000_000 }],
    students: [],
  })
  assert.equal(report.totals.unallocatedCents, 1_000_000)
  assert.equal(report.totals.perStudentCents, null)
  assert.equal(report.totals.suppressed, false)
  const kad = rowOf(report, 'KAD')
  assert.equal(kad.totalCents, 0)
  assert.equal(kad.perStudentCents, null)
  assert.equal(kad.suppressed, false)
})

test('DOM-FIN-065: öğrencisiz alt merkez pay almaz, gider kapsamda kalır', () => {
  const report = costPerStudent({
    key: 'students',
    centers: [KAD, KAD_7, KAD_8],
    lines: [
      { costCenterId: KAD.id, amountCents: 900_000 },
      { costCenterId: KAD_8.id, amountCents: 50_000 },
    ],
    students: placed(6, 's', 'b1', 7),
  })
  assert.equal(rowOf(report, 'KAD-7').totalCents, 900_000)
  assert.equal(rowOf(report, 'KAD-8').sharedInCents, 0)
  assert.equal(rowOf(report, 'KAD-8').totalCents, 50_000)
  assert.equal(rowOf(report, 'KAD').totalCents, 950_000)
})

test('DOM-FIN-065: bağsız program alt programların öğrencilerini, kur programı kursiyerleri sayar', () => {
  const ORT = center(7, 'KAD-ORT', { type: 'program', parentId: KAD.id })
  const k7 = { ...KAD_7, parentId: ORT.id }
  const k8 = { ...KAD_8, parentId: ORT.id }
  const report = costPerStudent({
    key: 'students',
    centers: [KAD, ORT, k7, k8],
    lines: [{ costCenterId: KAD.id, amountCents: 1_000_000 }],
    students: [...placed(6, 'k7-', 'b1', 7), ...placed(4, 'k8-', 'b1', 8)],
  })
  assert.equal(rowOf(report, 'KAD-ORT').studentCount, 10)
  assert.equal(rowOf(report, 'KAD-ORT').totalCents, 1_000_000)
  assert.equal(rowOf(report, 'KAD-7').totalCents, 600_000)

  const course = center(8, 'B1', { type: 'program', courseId: COURSE })
  const language = costPerStudent({
    key: 'students',
    centers: [course],
    lines: [{ costCenterId: course.id, amountCents: 700_000 }],
    students: [...placed(7, 'k', 'b1', null, [COURSE]), ...placed(3, 'y', 'b2', null)],
  })
  assert.equal(rowOf(language, 'B1').studentCount, 7, 'kampüs kısıtı yoksa bütün kursiyerler')
  assert.equal(rowOf(language, 'B1').perStudentCents, 100_000)
})

test('DOM-FIN-065: tutarı olmayan pasif merkez listelenmez, tutarlı pasif merkez kalır', () => {
  const passive = { ...ATA, isActive: false }
  const empty = costPerStudent({ key: 'students', centers: [passive], lines: [], students: [] })
  assert.equal(empty.centers.length, 0)
  const withLine = costPerStudent({
    key: 'students',
    centers: [passive],
    lines: [{ costCenterId: passive.id, amountCents: 10 }],
    students: [],
  })
  assert.equal(withLine.centers.length, 1)
})

test('DOM-FIN-065: bölüşüm kuruşu kaybetmez, sıfır ağırlıkta pay yoktur', () => {
  assert.deepEqual(splitByWeights(100, [1, 1, 1]), [34, 33, 33])
  assert.deepEqual(splitByWeights(10, [0, 0]), [0, 0])
  assert.deepEqual(splitByWeights(0, [3, 1]), [0, 0])
  const shares = splitByWeights(1_000_001, [7, 3, 11])
  assert.equal(
    shares.reduce((sum, value) => sum + value, 0),
    1_000_001,
  )
})

test('DOM-FIN-065: dönemin öğrencileri kayıt ve çıkış gününe göre sayılır', () => {
  const students = periodStudents({
    period: { startDate: '2026-09-01', endDate: '2027-08-31' },
    classes: [
      { id: 'c1', branchId: 'b1', grade: 7 },
      { id: 'c2', branchId: '', grade: 8 },
    ],
    students: [
      { id: 's1', classId: 'c1', joinedAt: '2025-09-01T09:00:00.000Z' },
      { id: 's2', classId: 'c1', joinedAt: '2027-09-10T09:00:00.000Z' },
      { id: 's3', classId: 'c1', isActive: false },
      { id: 's4', classId: 'c1', isActive: false },
      { id: 's5', classId: 'c1', isActive: false },
      { id: 's6', classId: 'c2', joinedAt: 'geçersiz' },
      { id: 's7', classId: null },
    ],
    exits: new Map([
      ['s3', '2026-12-01'],
      ['s4', '2026-06-30'],
    ]),
    memberships: [
      { studentId: 's1', courseId: 'k2' },
      { studentId: 's1', courseId: 'k1' },
      { studentId: 's1', courseId: 'k1' },
    ],
  })
  assert.deepEqual(students, [
    { id: 's1', campusId: 'b1', gradeLevel: 7, courseIds: ['k1', 'k2'] },
    { id: 's3', campusId: 'b1', gradeLevel: 7, courseIds: [] },
    { id: 's6', campusId: null, gradeLevel: 8, courseIds: [] },
    { id: 's7', campusId: null, gradeLevel: null, courseIds: [] },
  ])
})

test('DOM-FIN-065: sorgu dönem ister, anahtar varsayılanı öğrenci sayısı; CSV küçük grubu yazar', () => {
  assert.equal(costReportQuerySchema.safeParse({}).success, false)
  assert.deepEqual(costReportQuerySchema.parse({ periodId: id(1) }), {
    periodId: id(1),
    key: 'students',
  })
  assert.equal(costReportQuerySchema.safeParse({ periodId: id(1), key: 'x' }).success, false)
  const csv = costPerStudentCsv(
    costPerStudent({ key: 'students', centers: CENTERS, lines: LINES, students: STUDENTS }),
  )
  const lines = csv.split('\r\n')
  assert.equal(lines.length, 1 + 6 + 1)
  assert.match(lines[0] ?? '', /^"Merkez";"Ad";"Tür"/)
  assert.ok(lines.some((line) => line.startsWith('"KAD / KAD-8"') && line.endsWith('"Küçük grup"')))
  assert.ok(lines.some((line) => line.startsWith('"GEN"') && line.includes('(paylaştırıldı)')))
  assert.equal(lines.at(-1), '"Kurum toplamı";"";"";25000,00;"";25000,00;16;1562,50')
})
