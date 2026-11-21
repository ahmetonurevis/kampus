import assert from 'node:assert/strict'
import test from 'node:test'

import type { State } from '../packages/school-core/src/data/seed.ts'
import {
  basisPointsCsv,
  campusConsolidation,
  campusConsolidationCsv,
} from '../packages/school-core/src/lib/finance-campus-consolidation.ts'
import {
  costPerStudent,
  type CostCenterInfo,
  type PlacedStudent,
} from '../packages/school-core/src/lib/finance-cost-per-student.ts'
import {
  financeSummary,
  invoiceLines,
  paymentLines,
  refundLines,
  type ExportPayment,
  type ExportRefund,
} from '../packages/school-core/src/lib/finance-export.ts'

import { isDomainError } from './support/domain-error.ts'

const PERIOD = { from: '2026-09-01', to: '2027-08-31' }
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const center = (n: number, overrides: Partial<CostCenterInfo>): CostCenterInfo => ({
  id: id(n),
  code: `M${String(n)}`,
  name: `Merkez ${String(n)}`,
  type: 'unit',
  parentId: null,
  campusId: null,
  gradeLevel: null,
  courseId: null,
  isActive: true,
  ...overrides,
})
const placed = (prefix: string, count: number, campusId: string | null): PlacedStudent[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${String(index + 1)}`,
    campusId,
    gradeLevel: 7,
    courseIds: [],
  }))
const invoice = (
  invoiceId: string,
  studentId: string,
  amount: number,
  dueDay: string,
): State['invoices'][number] =>
  ({
    id: invoiceId,
    studentId,
    installment: 1,
    amount,
    dueDate: `${dueDay}T09:00:00.000Z`,
    paidAt: null,
    method: null,
    reminderAt: null,
  }) as State['invoices'][number]
const payment = (
  studentId: string,
  amountCents: number,
  paidDay: string,
  reversedDay: string | null = null,
): ExportPayment => ({
  studentId,
  amountCents,
  method: 'Nakit',
  reference: null,
  paidAt: `${paidDay}T09:00:00.000Z`,
  receiptYear: 2026,
  receiptNumber: 1,
  reversedAt: reversedDay === null ? null : `${reversedDay}T09:00:00.000Z`,
})
const refund = (studentId: string, refundCents: number, paidDay: string | null): ExportRefund => ({
  studentId,
  withdrawalDate: '2026-10-01',
  refundCents,
  refundPaidDate: paidDay,
  maskedIban: null,
  accountHolder: null,
})

const CAMPUSES = [
  { id: 'b1', name: 'Kadıköy Kampüsü', isActive: true },
  { id: 'b2', name: 'Ataşehir Kampüsü', isActive: true },
  { id: 'b3', name: 'Eski Kampüs', isActive: false },
]
// k1..k6 Kadıköy, a1..a3 Ataşehir, x1 kampüssüz; d1 ayrılmış Kadıköy öğrencisi (dönemde sayılmaz).
const STUDENTS = [...placed('k', 6, 'b1'), ...placed('a', 3, 'b2'), ...placed('x', 1, null)]
const STUDENT_CAMPUS = new Map<string, string | null>([
  ...STUDENTS.map((s): [string, string | null] => [s.id, s.campusId]),
  ['d1', 'b1'],
  ['z1', 'b9'],
])
const INVOICES = [
  invoice('i1', 'k1', 1_000_000, '2026-09-15'),
  invoice('i2', 'k2', 500_000, '2026-10-15'),
  invoice('i3', 'a1', 800_000, '2026-09-15'),
  invoice('i4', 'x1', 100_000, '2026-09-15'),
  invoice('i5', 'k1', 999_999, '2027-09-15'),
  invoice('i6', 'z1', 50_000, '2026-11-15'),
]
const PAYMENTS = [
  payment('k1', 600_000, '2026-09-10'),
  payment('k2', 200_000, '2026-09-11', '2026-09-12'),
  payment('d1', 300_000, '2026-08-20', '2026-09-05'),
  payment('a1', 400_000, '2026-10-01'),
]
const REFUNDS = [refund('d1', 150_000, '2026-10-20'), refund('a1', 70_000, null)]
const COSTS = costPerStudent({
  key: 'students',
  centers: [
    center(1, { code: 'GEN' }),
    center(2, { code: 'KAD', type: 'campus', campusId: 'b1' }),
    center(3, { code: 'ATA', type: 'campus', campusId: 'b2' }),
    center(4, { code: 'YAZ', type: 'program' }),
  ],
  lines: [
    { costCenterId: id(1), amountCents: 900_000 },
    { costCenterId: id(2), amountCents: 1_000_000 },
    { costCenterId: id(3), amountCents: 500_000 },
    { costCenterId: id(4), amountCents: 80_000 },
  ],
  students: STUDENTS,
})

const report = () =>
  campusConsolidation({
    period: PERIOD,
    campuses: CAMPUSES,
    studentCampus: STUDENT_CAMPUS,
    students: STUDENTS,
    payments: PAYMENTS,
    refunds: REFUNDS,
    invoices: INVOICES,
    allocated: new Map(),
    costs: COSTS,
  })

test('DOM-FIN-065: kampüs satırları gelir hareketlerini, öğrenciyi ve bütçe giderini toplar', () => {
  const result = report()
  assert.deepEqual(
    result.campuses.map((row) => row.name),
    ['Kadıköy Kampüsü', 'Ataşehir Kampüsü', 'Kampüse bağlı olmayan'],
    'hareketsiz pasif kampüs listelenmez',
  )
  const [kad, ata, none] = result.campuses
  assert.ok(kad && ata && none)
  assert.equal(kad.accruedCents, 1_500_000)
  assert.equal(kad.collectedCents, 800_000)
  assert.equal(kad.reversedCents, 500_000, 'önceki dönem tahsilatının iptali iptal gününe düşer')
  assert.equal(kad.refundedCents, 150_000)
  assert.equal(kad.netCollectedCents, 150_000)
  assert.equal(kad.studentCount, 6)
  // GEN 900.000 → KAD 6 : ATA 3 (YAZ öğrencisiz) = 600.000 / 300.000.
  assert.equal(kad.budgetExpenseCents, 1_600_000)
  assert.equal(kad.budgetSharedCents, 600_000)
  assert.equal(kad.hasCostCenter, true)
  assert.equal(kad.accruedPerStudentCents, 250_000)
  assert.equal(kad.budgetExpensePerStudentCents, 266_667)
  assert.equal(kad.studentShareBasisPoints, 6_000)
  assert.equal(ata.studentCount, 3)
  assert.equal(ata.suppressed, true)
  assert.equal(ata.accruedPerStudentCents, null)
  assert.equal(ata.refundedCents, 0, 'ödenmemiş iade sayılmaz')
  assert.equal(ata.budgetExpenseCents, 800_000)
  assert.equal(none.campusId, null)
  assert.equal(none.accruedCents, 150_000, 'bilinmeyen kampüs ve kampüssüz öğrenci')
  assert.equal(none.budgetExpenseCents, 80_000, 'kampüs merkezine bağlanmamış gider')
  assert.equal(none.hasCostCenter, false)
  assert.equal(none.studentCount, 1)
  assert.equal(none.suppressed, true)
})

test('DOM-FIN-065: kampüsler toplamı muhasebe özetine ve bütçe gider toplamına eşittir', () => {
  const result = report()
  const summary = financeSummary(
    paymentLines(PAYMENTS, new Map(), PERIOD),
    refundLines(REFUNDS, new Map(), PERIOD),
    invoiceLines(INVOICES, new Map(), new Map(), PERIOD),
  )
  const t = result.totals
  assert.equal(t.accruedCents, summary.invoices.totalCents)
  assert.equal(t.collectedCents - t.reversedCents, summary.payments.totalCents)
  assert.equal(t.refundedCents, summary.refunds.totalCents)
  assert.equal(t.netCollectedCents, summary.payments.totalCents - summary.refunds.totalCents)
  assert.equal(t.budgetExpenseCents, COSTS.totals.expenseCents)
  assert.equal(t.studentCount, 10)
  assert.equal(t.suppressed, false)
  assert.equal(t.accruedPerStudentCents, 245_000)
  for (const key of ['accruedCents', 'collectedCents', 'budgetExpenseCents'] as const)
    assert.equal(
      result.campuses.reduce((sum, row) => sum + row[key], 0),
      t[key],
      key,
    )
  assert.deepEqual(
    result.campuses.map((row) => row.accruedShareBasisPoints),
    [6_122, 3_265, 612],
  )
})

test('DOM-FIN-065: hareketi olmayan kurumda paylar boş, kampüssüz satır listelenmez', () => {
  const empty = campusConsolidation({
    period: PERIOD,
    campuses: CAMPUSES.slice(0, 1),
    studentCampus: new Map(),
    students: [],
    payments: [],
    refunds: [],
    invoices: [],
    allocated: new Map(),
    costs: costPerStudent({ key: 'students', centers: [], lines: [], students: [] }),
  })
  assert.equal(empty.campuses.length, 1)
  const [row] = empty.campuses
  assert.equal(row?.studentShareBasisPoints, null)
  assert.equal(row?.accruedPerStudentCents, null)
  assert.equal(row?.suppressed, false)
  assert.equal(row?.hasCostCenter, false)
})

test('DOM-FIN-065: dönem bir yılı aşamaz', () => {
  assert.throws(
    () =>
      campusConsolidation({
        period: { from: '2026-01-01', to: '2027-06-01' },
        campuses: [],
        studentCampus: new Map(),
        students: [],
        payments: [],
        refunds: [],
        invoices: [],
        allocated: new Map(),
        costs: COSTS,
      }),
    isDomainError('export_period_too_long'),
  )
})

test('DOM-FIN-065: CSV karşılaştırma tablosu ve kampüsler toplamı satırı', () => {
  const lines = campusConsolidationCsv(report()).split('\r\n')
  assert.equal(lines.length, 1 + 3 + 1)
  assert.match(lines[0] ?? '', /^"Kampüs";"Öğrenci";"Öğrenci payı \(%\)";"Tahakkuk"/)
  assert.equal(
    lines[1],
    '"Kadıköy Kampüsü";6;60,00;15000,00;61,22;8000,00;5000,00;1500,00;1500,00;16000,00;6000,00;64,52;2500,00;2666,67',
  )
  assert.ok(lines[2]?.endsWith('"Küçük grup";"Küçük grup"'))
  assert.ok(lines.at(-1)?.startsWith('"Kampüsler toplamı";10;100,00;24500,00;100,00;'))
  assert.equal(basisPointsCsv(-50), '-0,50')
  assert.equal(basisPointsCsv(null), '""')
})
