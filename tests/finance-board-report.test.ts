import assert from 'node:assert/strict'
import test from 'node:test'

import type { State } from '../packages/school-core/src/data/seed.ts'
import type { EnrollmentRenewal } from '../packages/school-core/src/lib/enrollment-status.ts'
import {
  BOARD_REPORT_MIN_GROUP,
  boardReportPeriod,
  boardReportQuerySchema,
  financeBoardReport,
  suppressSmallGroups,
  type BoardReportInput,
  type BoardReportPeriod,
  type BoardReportWithdrawal,
} from '../packages/school-core/src/lib/finance-board-report.ts'
import {
  financeTotals,
  type ExportPayment,
} from '../packages/school-core/src/lib/finance-export.ts'
import { financeReconciliation } from '../packages/school-core/src/lib/finance-reconciliation.ts'
import type { PackageReportSale } from '../packages/school-core/src/lib/finance-package-report.ts'
import { isDomainError } from './support/domain-error.ts'

// DOM-FIN-064 yönetim kurulu raporu (ON-251). Yıl 2026–2027; bugün 2027-01-15, dönem sürüyor.
const TODAY = '2027-01-15'
const YEAR = 2026
const PERIOD = boardReportPeriod({
  year: YEAR,
  yearRange: null,
  terms: [],
  query: {},
  today: TODAY,
})

type Invoice = State['invoices'][number]
type Contract = State['contracts'][number]
const invoice = (
  id: string,
  studentId: string,
  amount: number,
  dueDay: string,
  extra: Partial<Invoice> = {},
) =>
  ({
    id,
    studentId,
    installment: 1,
    amount,
    dueDate: `${dueDay}T09:00:00.000Z`,
    paidAt: null,
    method: null,
    reminderAt: null,
    feeKind: 'tuition',
    ...extra,
  }) as Invoice
const contract = (id: string, studentId: string, extra: Partial<Contract> = {}) =>
  ({
    id,
    studentId,
    date: '2026-06-01T09:00:00.000Z',
    amount: 0,
    title: 'Sözleşme',
    invoiceIds: [],
    academicYear: YEAR,
    ...extra,
  }) as Contract
const exportPayment = (
  studentId: string,
  method: string,
  amountCents: number,
  paidDay: string,
  reversedDay: string | null = null,
): ExportPayment => ({
  studentId,
  amountCents,
  method,
  reference: null,
  paidAt: `${paidDay}T09:00:00.000Z`,
  receiptYear: 2026,
  receiptNumber: 1,
  reversedAt: reversedDay === null ? null : `${reversedDay}T09:00:00.000Z`,
})
const withdrawal = (
  id: string,
  studentId: string,
  withdrawalDate: string,
  reason: BoardReportWithdrawal['reason'],
): BoardReportWithdrawal => ({
  id,
  studentId,
  contractId: `k-${studentId}`,
  withdrawalDate,
  reason,
  refundCents: 0,
  debtCents: 0,
  refundPaidDate: null,
  breakdown: { paidCents: 0, creditCents: 0, extras: [] },
})
const renewal = (
  id: string,
  studentId: string,
  overrides: Partial<EnrollmentRenewal> = {},
): EnrollmentRenewal => ({
  id,
  studentId,
  mode: 'renew',
  status: 'Planlandı',
  year: YEAR + 1,
  fromClassId: 'c1',
  targetClassId: 'c2',
  createdAt: '2026-12-01T09:00:00.000Z',
  ...overrides,
})
const student = (id: string, joinedDay: string | null, isActive = true) => ({
  id,
  classId: 'c1',
  isActive,
  ...(joinedDay === null ? {} : { joinedAt: `${joinedDay}T09:00:00.000Z` }),
})
const ids = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1)}`)

function input(overrides: Partial<BoardReportInput> = {}): BoardReportInput {
  return {
    period: PERIOD,
    today: TODAY,
    institutionType: 'school',
    invoices: [],
    contracts: [],
    cancelledContractIds: new Set(),
    payments: [],
    methodPayments: [],
    allocated: new Map(),
    withdrawals: [],
    students: [],
    renewals: [],
    prospects: [],
    packageSales: null,
    ...overrides,
  }
}

// --- Dönem --------------------------------------------------------------------------------------

test('DOM-FIN-064 dönem: eğitim yılı aralığı, süren yılda bitiş bugündür', () => {
  assert.deepEqual(PERIOD, {
    kind: 'year',
    year: YEAR,
    from: '2026-09-01',
    to: TODAY,
    endDate: '2027-08-31',
    complete: false,
    termId: null,
    termName: null,
  } satisfies BoardReportPeriod)
  const stored = boardReportPeriod({
    year: 2025,
    yearRange: { startDate: '2025-09-15', endDate: '2026-06-30' },
    terms: [],
    query: {},
    today: TODAY,
  })
  assert.equal(stored.from, '2025-09-15')
  assert.equal(stored.to, '2026-06-30')
  assert.equal(stored.complete, true)
})

test('DOM-FIN-064 dönem: dil okulu dönemi ve elle aralık', () => {
  const terms = [{ id: 't1', name: 'Güz', startDate: '2026-09-07', endDate: '2026-12-20' }]
  const term = boardReportPeriod({
    year: YEAR,
    yearRange: null,
    terms,
    query: { termId: 't1' },
    today: TODAY,
  })
  assert.equal(term.kind, 'term')
  assert.equal(term.termName, 'Güz')
  assert.equal(term.to, '2026-12-20')
  assert.equal(term.complete, true)
  const custom = boardReportPeriod({
    year: YEAR,
    yearRange: null,
    terms,
    query: { from: '2026-10-01', to: '2026-10-31' },
    today: TODAY,
  })
  assert.equal(custom.kind, 'custom')
  assert.deepEqual([custom.from, custom.to], ['2026-10-01', '2026-10-31'])
})

test('DOM-FIN-064 dönem: hatalı dönem 422 kodlarıyla reddedilir', () => {
  const base = { year: YEAR, yearRange: null, terms: [], today: TODAY }
  assert.throws(
    () => boardReportPeriod({ ...base, query: { termId: 'yok' } }),
    isDomainError('board_report_term_not_found'),
  )
  assert.throws(
    () => boardReportPeriod({ ...base, query: { from: '2026-10-02', to: '2026-10-01' } }),
    isDomainError('export_period_invalid'),
  )
  assert.throws(
    () => boardReportPeriod({ ...base, query: { from: '2025-01-01', to: '2026-06-01' } }),
    isDomainError('export_period_too_long'),
  )
  assert.throws(
    () => boardReportPeriod({ ...base, year: 2027, query: {} }),
    isDomainError('board_report_period_not_started'),
  )
})

test('DOM-FIN-064 sorgu: aralığın iki ucu birlikte, dönem ile aralık birlikte verilmez', () => {
  assert.equal(boardReportQuerySchema.safeParse({ year: '2026' }).success, true)
  assert.equal(boardReportQuerySchema.safeParse({ year: 2026, from: '2026-10-01' }).success, false)
  assert.equal(
    boardReportQuerySchema.safeParse({
      year: 2026,
      termId: 't1',
      from: '2026-10-01',
      to: '2026-10-02',
    }).success,
    false,
  )
  assert.equal(boardReportQuerySchema.safeParse({ year: 1999 }).success, false)
  assert.equal(boardReportQuerySchema.safeParse({ year: 2026, extra: 1 }).success, false)
})

// --- Küçük grup bastırma --------------------------------------------------------------------------

test('DOM-FIN-064 küçük grup: 1–4 kişilik hücre gizlenir, tek gizli hücrede en küçük ikinci de', () => {
  const count = (cell: { n: number }) => cell.n
  assert.equal(BOARD_REPORT_MIN_GROUP, 5)
  assert.deepEqual(
    suppressSmallGroups([{ n: 0 }, { n: 7 }, { n: 12 }], count).map((cell) => cell.suppressed),
    [false, false, false],
  )
  // Tek birincil gizli hücre: en küçük görünür dolu hücre (7) de gizlenir; sıfır gizlenmez.
  assert.deepEqual(
    suppressSmallGroups([{ n: 2 }, { n: 0 }, { n: 7 }, { n: 12 }], count).map(
      (cell) => cell.suppressed,
    ),
    [true, false, true, false],
  )
  // İki birincil gizli hücre birbirini korur.
  assert.deepEqual(
    suppressSmallGroups([{ n: 1 }, { n: 4 }, { n: 9 }], count).map((cell) => cell.suppressed),
    [true, true, false],
  )
  // Başka dolu hücre yoksa ikincil gizleme yapılamaz.
  assert.deepEqual(
    suppressSmallGroups([{ n: 3 }, { n: 0 }], count).map((cell) => cell.suppressed),
    [true, false],
  )
})

// --- Finans -----------------------------------------------------------------------------------

test('DOM-FIN-064 finans: toplamlar yıl sonu mutabakatıyla aynıdır (DOM-FIN-056)', () => {
  const invoices = [
    invoice('i1', 's1', 100_000, '2026-09-15', {
      paidAt: '2026-09-10T09:00:00.000Z',
      method: 'Nakit',
    }),
    invoice('i2', 's1', 100_000, '2026-10-15'),
    invoice('i3', 's2', 50_000, '2026-11-15'),
  ]
  const contracts = [
    contract('k1', 's1', {
      invoiceIds: ['i1', 'i2'],
      scholarship: { amountCents: 20_000 } as Contract['scholarship'],
    }),
  ]
  const payments = [
    {
      studentId: 's1',
      amountCents: 100_000,
      paidAt: '2026-09-10T09:00:00.000Z',
      reversedAt: null,
      allocations: [{ invoiceId: 'i1', amountCents: 100_000 }],
    },
  ]
  const data = input({ invoices, contracts, payments })
  const report = financeBoardReport(data)
  const reconciliation = financeReconciliation({
    year: YEAR,
    period: { from: PERIOD.from, to: PERIOD.to },
    invoices,
    contracts,
    cancelledContractIds: new Set(),
    payments,
    withdrawals: [],
    students: new Map(),
  })
  assert.deepEqual(report.finance.totals, reconciliation.totals)
  assert.equal(report.finance.totals.accruedCents, 250_000)
  assert.equal(report.finance.totals.scholarshipCents, 20_000)
  assert.equal(report.finance.mismatchCount, reconciliation.mismatchCount)
})

test('DOM-FIN-064 finans: yöntem kırılımı dönem gün kuralıyla, küçük grup gizli', () => {
  const methodPayments = [
    ...ids('h', 6).map((id) => exportPayment(id, 'Banka havalesi', 10_000, '2026-10-01')),
    ...ids('n', 5).map((id) => exportPayment(id, 'Nakit', 5_000, '2026-11-01')),
    // İptal iptal gününde düşer; dönem dışındaki ödeme sayılmaz.
    exportPayment('n1', 'Nakit', 2_000, '2026-11-02', '2026-11-03'),
    exportPayment('k1', 'Kredi kartı', 7_000, '2026-12-01'),
    exportPayment('h1', 'Banka havalesi', 99_000, '2026-08-01'),
  ]
  const { methods } = financeBoardReport(input({ methodPayments })).finance
  assert.equal(methods.collectedCents, 60_000 + 27_000 + 7_000)
  assert.equal(methods.reversedCents, 2_000)
  assert.equal(methods.netCents, methods.collectedCents - methods.reversedCents)
  const byMethod = new Map(methods.rows.map((row) => [row.method, row]))
  // Kredi kartında tek kişi: birincil; en küçük dolu görünür hücre (nakit, 5 kişi) ikincil.
  assert.equal(byMethod.get('Kredi kartı')?.suppressed, true)
  assert.equal(byMethod.get('Kredi kartı')?.collectedCents, null)
  assert.equal(byMethod.get('Nakit')?.suppressed, true)
  assert.deepEqual(byMethod.get('Banka havalesi'), {
    method: 'Banka havalesi',
    studentCount: 6,
    collectedCents: 60_000,
    reversedCents: 0,
    netCents: 60_000,
    suppressed: false,
  })
  assert.deepEqual(byMethod.get('Senet'), {
    method: 'Senet',
    studentCount: 0,
    collectedCents: 0,
    reversedCents: 0,
    netCents: 0,
    suppressed: false,
  })
})

test('DOM-FIN-064 finans: yaşlandırma bugünün gecikmiş tutarıdır (/finance/totals ile aynı)', () => {
  const invoices = [
    // 1–30 gün: 5 öğrenci, biri kısmi ödemeli.
    ...ids('a', 5).map((id) => invoice(`${id}-i`, id, 10_000, '2027-01-01')),
    // 31–60 gün: 6 öğrenci.
    ...ids('b', 6).map((id) => invoice(`${id}-i`, id, 20_000, '2026-12-01')),
    // 90+ gün: 1 öğrenci → gizli, ikincil olarak 1–30 de gizlenir.
    invoice('c1-i', 'c1', 30_000, '2026-09-20'),
    // Vadesi bugün: gecikmiş değildir. Ödenmiş taksit sayılmaz.
    invoice('d1-i', 'd1', 40_000, TODAY),
    invoice('e1-i', 'e1', 40_000, '2026-10-01', {
      paidAt: '2026-10-01T09:00:00.000Z',
      method: 'Nakit',
    }),
  ]
  const allocated = new Map([['a1-i', 4_000]])
  const { aging } = financeBoardReport(input({ invoices, allocated })).finance
  assert.equal(aging.asOf, TODAY)
  assert.equal(aging.overdueCents, 46_000 + 120_000 + 30_000)
  assert.equal(aging.overdueCents, financeTotals(invoices, allocated, TODAY).overdueCents)
  assert.equal(aging.studentCount, 12)
  assert.deepEqual(aging.rows, [
    { bucket: 'days_1_30', studentCount: null, amountCents: null, suppressed: true },
    { bucket: 'days_31_60', studentCount: 6, amountCents: 120_000, suppressed: false },
    { bucket: 'days_61_90', studentCount: 0, amountCents: 0, suppressed: false },
    { bucket: 'days_91_plus', studentCount: null, amountCents: null, suppressed: true },
  ])
})

test('DOM-FIN-064 finans: dönem sonundan sonra vadesi gelen taksit yaşlandırmaya girmez', () => {
  const period = boardReportPeriod({
    year: YEAR,
    yearRange: null,
    terms: [],
    query: { from: '2026-09-01', to: '2026-10-31' },
    today: TODAY,
  })
  const invoices = [
    invoice('i1', 's1', 10_000, '2026-10-15'),
    invoice('i2', 's1', 25_000, '2026-12-15'),
  ]
  const { aging } = financeBoardReport(input({ period, invoices })).finance
  assert.equal(aging.overdueCents, 10_000)
})

test('DOM-FIN-064 finans: paket gelir toplamı yalnız verildiğinde (dil okulu)', () => {
  const sale: PackageReportSale = {
    id: 'sale-1',
    studentId: 's1',
    packageName: '40 saatlik paket',
    kind: 'hours',
    purchasedHours: 40,
    netCents: 1_800_000,
    soldAt: '2026-10-06T09:00:00.000Z',
    expiresDate: null,
    entries: [
      {
        kind: 'consumed',
        hours: 10,
        occurredDate: '2026-11-01',
        sourceType: 'lesson',
        archivedAt: null,
        createdAt: '2026-11-01T10:00:00.000Z',
      },
    ],
  }
  assert.equal(financeBoardReport(input()).finance.packages, null)
  const report = financeBoardReport(
    input({ institutionType: 'language_school', packageSales: [sale], renewals: null }),
  )
  assert.deepEqual(report.finance.packages, {
    saleCount: 1,
    soldHours: 40,
    usedHours: 10,
    refundedHours: 0,
    expiredHours: 0,
    soldCents: 1_800_000,
    recognizedCents: 450_000,
    returnedCents: 0,
    openingDeferredCents: 0,
    closingDeferredCents: 1_350_000,
  })
  assert.equal(report.enrollment.renewal, null)
})

// --- Kayıt --------------------------------------------------------------------------------------

test('DOM-FIN-064 kayıt: dönem başı + yeni − ayrılış − mezuniyet = dönem sonu (DOM-KAY-026)', () => {
  const students = [
    // Dönemden önce kayıtlı, sürüyor (biri kesin kayıt günü olmayan eski kayıt).
    student('old1', '2025-09-01'),
    student('old2', null),
    // Dönemde yeni kayıt.
    student('new1', '2026-10-01'),
    student('new2', '2027-01-15'),
    // Dönemden sonra kayıt: sayılmaz.
    student('late', '2027-02-01'),
    // Dönemde ayrılan (önceden kayıtlı) ve dönemde gelip ayrılan.
    student('w1', '2025-09-01', false),
    student('w2', '2026-09-10', false),
    // Dönemden önce ayrılan: hiç sayılmaz.
    student('w0', '2024-09-01', false),
    // Dönemde mezun.
    student('g1', '2025-09-01', false),
    // Ayrılış kaydı olmayan pasif öğrenci yerleştirilemez.
    student('x1', '2025-09-01', false),
  ]
  const withdrawals = [
    withdrawal('wd1', 'w1', '2026-11-01', 'transfer'),
    withdrawal('wd2', 'w2', '2026-12-01', 'documented'),
    withdrawal('wd0', 'w0', '2025-06-01', 'financial'),
  ]
  const renewals = [
    renewal('r-g1', 'g1', {
      mode: 'graduate',
      status: 'Mezun',
      activatedAt: '2026-12-20T09:00:00.000Z',
    }),
  ]
  const { enrollment } = financeBoardReport(input({ students, withdrawals, renewals }))
  assert.equal(enrollment.startCount, 4)
  assert.equal(enrollment.newCount, 3)
  assert.equal(enrollment.withdrawnCount, 2)
  assert.equal(enrollment.graduatedCount, 1)
  assert.equal(enrollment.endCount, 4)
  assert.equal(
    enrollment.startCount +
      enrollment.newCount -
      enrollment.withdrawnCount -
      enrollment.graduatedCount,
    enrollment.endCount,
  )
  // İki ayrılış nedeni (birer kişi) birbirini korur; tutar ya da ad yok.
  const shown = enrollment.reasons.filter((row) => !row.suppressed)
  assert.ok(shown.every((row) => row.count === 0))
  assert.deepEqual(
    enrollment.reasons.filter((row) => row.suppressed).map((row) => [row.reason, row.count]),
    [
      ['transfer', null],
      ['documented', null],
    ],
  )
})

test('DOM-FIN-064 kayıt: beş ve üstü ayrılış nedeni sayıyla görünür', () => {
  const students = ids('w', 6).map((id) => student(id, '2025-09-01', false))
  const withdrawals = students.map((item, index) =>
    withdrawal(`wd${String(index)}`, item.id, '2026-10-01', 'relocation'),
  )
  const { enrollment } = financeBoardReport(input({ students, withdrawals }))
  assert.deepEqual(
    enrollment.reasons.find((row) => row.reason === 'relocation'),
    { reason: 'relocation', count: 6, suppressed: false },
  )
  assert.equal(enrollment.withdrawnCount, 6)
})

test('DOM-FIN-064 kayıt: yenileme oranı sonraki yıla yenilenen / dönem sonunda aktif', () => {
  const students = ids('s', 5).map((id) => student(id, '2025-09-01'))
  const renewals = [
    renewal('r1', 's1'),
    renewal('r2', 's2', { status: 'Tamamlandı', activatedAt: '2027-01-10T09:00:00.000Z' }),
    // İptal edilen yenileme ve başka yılın yenilemesi sayılmaz.
    renewal('r3', 's3', { status: 'İptal' }),
    renewal('r4', 's4', { year: YEAR }),
    // Mezuniyet planı olan paydadan çıkar.
    renewal('r5', 's5', { mode: 'graduate', status: 'Planlandı' }),
  ]
  const { enrollment } = financeBoardReport(input({ students, renewals }))
  assert.deepEqual(enrollment.renewal, {
    targetYear: YEAR + 1,
    eligibleCount: 4,
    renewedCount: 2,
    rate: 50,
  })
  assert.equal(financeBoardReport(input({ renewals: null })).enrollment.renewal, null)
  assert.equal(financeBoardReport(input()).enrollment.renewal?.rate, null)
})

test('DOM-FIN-064 kayıt: aday hunisi dönemde açılan adaylardan, crm kapalıysa yok', () => {
  const prospects = [
    { stage: 'Yeni', source: 'Web' },
    { stage: 'Görüşme planlandı', source: 'Web' },
    { stage: 'Kayıt oldu', studentId: 's1', source: 'Web' },
    { stage: 'Kayıt oldu', studentId: 's2', source: 'Web' },
  ]
  const { funnel } = financeBoardReport(input({ prospects }))
  assert.equal(funnel?.prospects, 4)
  assert.deepEqual(
    funnel?.steps.map((step) => [step.step, step.count]),
    [
      ['prospect', 4],
      ['meeting', 3],
      ['enrolled', 2],
    ],
  )
  assert.equal(funnel?.conversionRate, 50)
  assert.equal(financeBoardReport(input({ prospects: null })).funnel, null)
})

test('DOM-FIN-064 rapor kişi adı ve kimliği taşımaz', () => {
  const students = [student('ogr-gizli-1', '2025-09-01', false)]
  const report = financeBoardReport(
    input({
      students,
      withdrawals: [withdrawal('wd-gizli', 'ogr-gizli-1', '2026-10-01', 'other')],
      invoices: [invoice('tak-gizli', 'ogr-gizli-1', 10_000, '2026-10-01')],
      methodPayments: [exportPayment('ogr-gizli-1', 'Nakit', 1_000, '2026-10-02')],
    }),
  )
  const text = JSON.stringify(report)
  assert.equal(text.includes('gizli'), false)
})
