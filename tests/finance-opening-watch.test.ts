import assert from 'node:assert/strict'
import test from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  addDays,
  daysBetween,
  defaultOpeningYear,
  OPENING_WATCH_ROW_LIMIT,
  openingWatch,
  openingWatchQuerySchema,
  openingWindow,
  type OpeningContract,
  type OpeningInvoice,
  type OpeningStudent,
  type OpeningWatchInput,
  type OpeningWithdrawal,
} from '../packages/school-core/src/lib/finance-opening-watch.ts'
import type { EnrollmentRenewal } from '../packages/school-core/src/lib/enrollment-status.ts'

// DOM-FIN-061 açılış nöbeti (ON-095). Bugün 2026-09-20; yıl 2026–2027, başlangıç 2026-09-14.
const TODAY = '2026-09-20'
const YEAR = 2026
const WINDOW = openingWindow({ yearStartDate: '2026-09-14', terms: [], query: {} })

const student = (id: string, overrides: Partial<OpeningStudent> = {}): OpeningStudent => ({
  id,
  name: `Öğrenci ${id}`,
  classId: 'c1',
  isActive: true,
  joinedAt: '2025-06-01T09:00:00.000Z',
  ...overrides,
})
const invoice = (
  id: string,
  studentId: string,
  installment: number,
  dueDate: string,
  overrides: Partial<OpeningInvoice> = {},
): OpeningInvoice => ({
  id,
  studentId,
  installment,
  amount: 100_000,
  dueDate: `${dueDate}T09:00:00.000Z`,
  paidAt: null,
  academicYear: YEAR,
  ...overrides,
})
const contract = (
  id: string,
  studentId: string,
  overrides: Partial<OpeningContract> = {},
): OpeningContract => ({
  id,
  studentId,
  date: '2026-08-20T09:00:00.000Z',
  academicYear: YEAR,
  ...overrides,
})
const APPROVAL = {
  method: 'wet_signature' as const,
  approvedAt: '2026-08-21T09:00:00.000Z',
  approvedByUserId: 'u1',
  payerName: 'Veli',
  plan: [],
}
const SIGNATORY = {
  name: 'Kurucu',
  role: 'founder' as const,
  recordedAt: '2026-08-20T10:00:00.000Z',
  recordedByUserId: 'u1',
}
const renewal = (
  id: string,
  studentId: string,
  overrides: Partial<EnrollmentRenewal> = {},
): EnrollmentRenewal => ({
  id,
  studentId,
  mode: 'renew',
  status: 'Planlandı',
  year: YEAR,
  fromClassId: 'c1',
  targetClassId: 'c2',
  createdAt: '2026-09-01T09:00:00.000Z',
  ...overrides,
})
const withdrawal = (
  id: string,
  studentId: string,
  overrides: Partial<OpeningWithdrawal> = {},
): OpeningWithdrawal => ({
  id,
  studentId,
  withdrawalDate: '2026-09-10',
  refundCents: 50_000,
  refundDueDate: '2026-10-10',
  refundPaidDate: null,
  ...overrides,
})

function input(overrides: Partial<OpeningWatchInput> = {}): OpeningWatchInput {
  return {
    academicYear: YEAR,
    today: TODAY,
    window: WINDOW,
    students: [student('s1')],
    classes: [
      { id: 'c1', name: '9-A' },
      { id: 'c2', name: '10-A' },
    ],
    invoices: [],
    contracts: [],
    allocated: new Map(),
    renewals: [],
    withdrawals: [],
    ...overrides,
  }
}

test('DOM-FIN-061: varsayılan pencere başlangıçtan 30 gün önce ve 41 gün sonra', () => {
  assert.deepEqual(WINDOW, {
    from: '2026-08-15',
    to: '2026-10-25',
    anchorDate: '2026-09-14',
    termId: null,
  })
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(daysBetween('2026-09-14', '2026-09-20'), 6)
})

test('DOM-FIN-061: dil okulunda dönem seçilince pencere dönemin başlangıcına kurulur', () => {
  const terms = [{ id: 't2', name: 'Bahar', startDate: '2027-02-08', endDate: '2027-06-18' }]
  const window = openingWindow({ yearStartDate: '2026-09-14', terms, query: { termId: 't2' } })
  assert.deepEqual(window, {
    from: '2027-01-09',
    to: '2027-03-21',
    anchorDate: '2027-02-08',
    termId: 't2',
  })
})

test('DOM-FIN-061: elle pencere önceliklidir; ters, uzun ve bilinmeyen dönem reddedilir', () => {
  const base = { yearStartDate: '2026-09-14', terms: [] }
  assert.deepEqual(openingWindow({ ...base, query: { from: '2026-09-01', to: '2026-09-30' } }), {
    from: '2026-09-01',
    to: '2026-09-30',
    anchorDate: '2026-09-14',
    termId: null,
  })
  const code = (fn: () => unknown) => {
    try {
      fn()
    } catch (error) {
      assert.ok(error instanceof DomainError)
      return error.code
    }
    return null
  }
  assert.equal(
    code(() => openingWindow({ ...base, query: { from: '2026-09-30', to: '2026-09-01' } })),
    'opening_window_invalid',
  )
  // 120 gün kabul, 121 gün ret (iki uç dahil).
  assert.equal(
    code(() => openingWindow({ ...base, query: { from: '2026-09-01', to: '2026-12-29' } })),
    null,
  )
  assert.equal(
    code(() => openingWindow({ ...base, query: { from: '2026-09-01', to: '2026-12-30' } })),
    'opening_window_too_long',
  )
  assert.equal(
    code(() => openingWindow({ ...base, query: { termId: 'yok' } })),
    'opening_term_not_found',
  )
})

test('DOM-FIN-061: sorgu şeması pencerenin iki ucunu birlikte ister, bilinmeyen alanı reddeder', () => {
  assert.equal(openingWatchQuerySchema.safeParse({ from: '2026-09-01' }).success, false)
  assert.equal(
    openingWatchQuerySchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success,
    false,
  )
  assert.equal(openingWatchQuerySchema.safeParse({ institutionId: 'x' }).success, false)
  assert.deepEqual(openingWatchQuerySchema.parse({ academicYear: '2026' }), { academicYear: 2026 })
})

test('DOM-FIN-061: eğitim yılı ayardan, etkin yıldan ya da bugünden', () => {
  assert.equal(defaultOpeningYear({ settingsYear: 2025, activeYear: 2026, today: TODAY }), 2025)
  assert.equal(defaultOpeningYear({ settingsYear: null, activeYear: 2026, today: TODAY }), 2026)
  assert.equal(defaultOpeningYear({ settingsYear: null, activeYear: null, today: TODAY }), 2026)
  assert.equal(
    defaultOpeningYear({ settingsYear: null, activeYear: null, today: '2027-08-31' }),
    2026,
  )
})

test('DOM-FIN-061: ilk taksit zincirin en küçük numaralı güncel taksitidir; kısmi ödeme düşülür', () => {
  const result = openingWatch(
    input({
      students: [student('s1'), student('s2'), student('s3'), student('s4')],
      contracts: [
        contract('k1', 's1', { invoiceIds: ['i1', 'i2'] }),
        // Ek protokolün taksiti kök zincirde kalır: ilk taksit hâlâ i3 (2. taksit değil).
        contract('k2', 's2'),
        contract('k2-ek', 's2', { amendsContractId: 'k2', revision: 2 }),
        contract('k3', 's3', { academicYear: 2025 }),
      ],
      invoices: [
        // Sözleşme bağı taksit listesinden (`invoiceIds`) bulunur; yıl sözleşmeden gelir.
        invoice('i1', 's1', 1, '2026-09-10', { academicYear: undefined }),
        invoice('i2', 's1', 2, '2026-10-10'),
        invoice('i3', 's2', 1, '2026-09-25', { contractId: 'k2' }),
        invoice('i4', 's2', 2, '2026-09-26', { contractId: 'k2-ek' }),
        // Geçen yılın sözleşmesi sayılmaz.
        invoice('i5', 's3', 1, '2026-09-01', { contractId: 'k3', academicYear: 2025 }),
        // Sözleşmesiz eski taksit: öğrenci başına en küçük; vadesi 7 günden uzak sayılmaz.
        invoice('i6', 's4', 1, '2026-09-28'),
        invoice('i7', 's4', 2, '2026-09-29'),
        // Yılı olmayan eski taksit sayılmaz.
        invoice('i8', 's4', 1, '2026-09-01', { academicYear: undefined }),
      ],
      allocated: new Map([['i1', 30_000]]),
    }),
  )
  assert.deepEqual(
    result.firstInstallments.rows.map((row) => [row.invoiceId, row.status, row.overdueDays]),
    [
      ['i1', 'overdue', 10],
      ['i3', 'due_soon', 0],
    ],
  )
  const [first] = result.firstInstallments.rows
  assert.equal(first?.remainingCents, 70_000)
  assert.equal(first?.contractId, 'k1')
  assert.equal(first?.className, '9-A')
  assert.equal(result.firstInstallments.overdueCount, 1)
  assert.equal(result.firstInstallments.overdueCents, 70_000)
  assert.equal(result.firstInstallments.dueSoonCount, 1)
  assert.equal(result.firstInstallments.dueSoonCents, 100_000)
})

test('DOM-FIN-061: ödenmiş ilk taksit ve vadesi bugün olan taksit doğru ayrılır', () => {
  const result = openingWatch(
    input({
      students: [student('s1'), student('s2'), student('s3')],
      invoices: [
        invoice('p1', 's1', 1, '2026-09-01', { paidAt: '2026-09-01T10:00:00.000Z' }),
        invoice('p2', 's2', 1, '2026-09-01'),
        invoice('p3', 's3', 1, TODAY),
      ],
      allocated: new Map([['p2', 100_000]]),
    }),
  )
  assert.deepEqual(
    result.firstInstallments.rows.map((row) => [row.invoiceId, row.status]),
    [['p3', 'due_soon']],
  )
})

test('DOM-FIN-061: satır sınırı uygulanır, sayılar tam kalır', () => {
  const ids = Array.from({ length: OPENING_WATCH_ROW_LIMIT + 5 }, (_, i) => `s${String(i)}`)
  const result = openingWatch(
    input({
      students: ids.map((id) => student(id)),
      invoices: ids.map((id) => invoice(`inv-${id}`, id, 1, '2026-09-15')),
    }),
  )
  assert.equal(result.firstInstallments.rows.length, OPENING_WATCH_ROW_LIMIT)
  assert.equal(result.firstInstallments.overdueCount, OPENING_WATCH_ROW_LIMIT + 5)
})

test('DOM-FIN-061: onaylanmamış sözleşmeler; iptal, onaylı, başka yıl ve ayrılan öğrenci yok', () => {
  const result = openingWatch(
    input({
      students: [student('s1'), student('s2'), student('s3', { isActive: false })],
      contracts: [
        contract('a', 's1', { date: '2026-08-25T09:00:00.000Z' }),
        contract('b', 's2', { signatory: SIGNATORY, date: '2026-08-22T09:00:00.000Z' }),
        contract('c', 's2', { signatory: SIGNATORY, approval: APPROVAL }),
        contract('d', 's2', {
          amendsContractId: 'c',
          revision: 2,
          cancelledAt: '2026-09-02T09:00:00.000Z',
        }),
        contract('e', 's1', { academicYear: 2025 }),
        contract('f', 's3'),
      ],
    }),
  )
  assert.deepEqual(
    result.unapprovedContracts.rows.map((row) => [row.contractId, row.status, row.revision]),
    [
      ['b', 'awaiting_approval', 1],
      ['a', 'awaiting_signatory', 1],
    ],
  )
  assert.equal(result.unapprovedContracts.awaitingSignatoryCount, 1)
  assert.equal(result.unapprovedContracts.awaitingApprovalCount, 1)
})

test('DOM-FIN-061: kayıt değişiklikleri pencere içindeki DOM-KAY-026 olaylarıdır', () => {
  const result = openingWatch(
    input({
      students: [
        student('new', { joinedAt: '2026-09-02T09:00:00.000Z' }),
        student('old', { joinedAt: '2025-01-01T09:00:00.000Z', classId: 'c2' }),
        student('grad', { isActive: false }),
        student('left', { isActive: false }),
        student('left2', { isActive: false }),
      ],
      renewals: [
        renewal('r1', 'old', {
          status: 'Tamamlandı',
          createdAt: '2026-05-01T09:00:00.000Z',
          activatedAt: '2026-09-14T06:00:00.000Z',
        }),
        renewal('r2', 'grad', {
          mode: 'graduate',
          status: 'Mezun',
          activatedAt: '2026-09-14T07:00:00.000Z',
        }),
        // Yenilemesi planlanıp ayrılışla iptal edilen öğrenci "yenilemeden ayrılan" değildir.
        renewal('r3', 'left2', { status: 'İptal' }),
        // Başka yılın yenilemesi sayılmaz.
        renewal('r4', 'new', { year: 2027, createdAt: '2026-09-05T09:00:00.000Z' }),
      ],
      withdrawals: [
        withdrawal('w1', 'left', { withdrawalDate: '2026-09-16' }),
        withdrawal('w2', 'left2', { withdrawalDate: '2026-09-17' }),
      ],
    }),
  )
  const { counts, withdrawnWithoutRenewal, rows } = result.enrollmentChanges
  assert.deepEqual(counts, { enrolled: 1, renewed: 0, promoted: 1, graduated: 1, withdrawn: 2 })
  assert.equal(withdrawnWithoutRenewal, 1)
  assert.deepEqual(
    rows.map((row) => [row.kind, row.studentId, row.date, row.fromClassName, row.toClassName]),
    [
      ['withdrawn', 'left2', '2026-09-17', '9-A', null],
      ['withdrawn', 'left', '2026-09-16', '9-A', null],
      ['graduated', 'grad', '2026-09-14', '9-A', null],
      ['promoted', 'old', '2026-09-14', '9-A', '10-A'],
      ['enrolled', 'new', '2026-09-02', null, '9-A'],
    ],
  )
  assert.equal(rows.find((row) => row.studentId === 'left')?.withoutRenewal, true)
})

test('DOM-FIN-061: pencerede yapılan yenileme planı sayılır, pencere dışı olay sayılmaz', () => {
  const result = openingWatch(
    input({
      students: [student('s1')],
      renewals: [renewal('r1', 's1', { createdAt: '2026-08-20T09:00:00.000Z' })],
      window: openingWindow({
        yearStartDate: '2026-09-14',
        terms: [],
        query: { from: '2026-08-20', to: '2026-08-20' },
      }),
    }),
  )
  assert.deepEqual(result.enrollmentChanges.counts.renewed, 1)
  assert.deepEqual(
    result.enrollmentChanges.rows.map((row) => [row.kind, row.fromClassName, row.toClassName]),
    [['renewed', '9-A', '10-A']],
  )
  const outside = openingWatch(
    input({ renewals: [renewal('r1', 's1', { createdAt: '2026-05-01T09:00:00.000Z' })] }),
  )
  assert.equal(outside.enrollmentChanges.rows.length, 0)
})

test('DOM-FIN-061: bekleyen iadeler pencereden bağımsızdır; ödenen ve iadesiz ayrılış girmez', () => {
  const result = openingWatch(
    input({
      students: [student('s1', { isActive: false }), student('s2', { isActive: false })],
      withdrawals: [
        withdrawal('w1', 's1', { withdrawalDate: '2026-03-01', refundDueDate: '2026-04-01' }),
        withdrawal('w2', 's2', { refundDueDate: '2026-10-10', refundCents: 20_000 }),
        withdrawal('w3', 's2', { refundPaidDate: '2026-09-15' }),
        withdrawal('w4', 's2', { refundCents: 0 }),
      ],
    }),
  )
  assert.deepEqual(
    result.refunds.rows.map((row) => [row.withdrawalId, row.overdueDays]),
    [
      ['w1', 172],
      ['w2', 0],
    ],
  )
  assert.equal(result.refunds.pendingCount, 2)
  assert.equal(result.refunds.pendingCents, 70_000)
  assert.equal(result.refunds.overdueCount, 1)
  assert.equal(result.refunds.overdueCents, 50_000)
  assert.equal(result.refunds.rows[0]?.studentName, 'Öğrenci s1')
})

test('DOM-FIN-061: girdi değişmez, bilinmeyen öğrenci ve sınıf boş adla döner', () => {
  const data = input({
    students: [],
    invoices: [invoice('i1', 'yok', 1, '2026-09-10')],
  })
  const snapshot = structuredClone({ ...data, allocated: [...data.allocated] })
  const result = openingWatch(data)
  assert.equal(result.firstInstallments.rows[0]?.studentName, '—')
  assert.equal(result.firstInstallments.rows[0]?.className, null)
  assert.deepEqual(structuredClone({ ...data, allocated: [...data.allocated] }), snapshot)
})
