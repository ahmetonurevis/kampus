import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import { csvAmount, csvCell, CSV_SEPARATOR } from '../packages/school-core/src/lib/csv.ts'
import {
  assertFinancePeriod,
  defaultOverviewPeriod,
  financeOverview,
  financeOverviewQuerySchema,
  financeSummary,
  financeTotals,
  invoiceLines,
  invoicesCsv,
  paymentLines,
  paymentsCsv,
  refundLines,
  refundsCsv,
  studentBalance,
  studentDirectory,
  type ExportPayment,
} from '../packages/school-core/src/lib/finance-export.ts'
import { isDomainError } from './support/domain-error.ts'

const PERIOD = { from: '2026-10-01', to: '2026-10-31' }
const students = studentDirectory([{ id: 's1', name: 'Test Öğrenci', number: 712 }])
const payment = (overrides: Partial<ExportPayment> = {}): ExportPayment => ({
  studentId: 's1',
  amountCents: 123_456,
  method: 'Banka havalesi',
  reference: 'TR-1',
  paidAt: '2026-10-10T09:00:00.000Z',
  receiptYear: 2026,
  receiptNumber: 7,
  reversedAt: null,
  ...overrides,
})

test('IST-111: dönem başlangıcı bitişi geçemez, dönem bir yılı aşamaz', () => {
  assert.doesNotThrow(() => assertFinancePeriod({ from: '2026-01-01', to: '2026-12-31' }))
  assert.throws(
    () => assertFinancePeriod({ from: '2026-02-01', to: '2026-01-01' }),
    isDomainError('export_period_invalid'),
  )
  assert.throws(
    () => assertFinancePeriod({ from: '2026-01-01', to: '2027-01-02' }),
    isDomainError('export_period_too_long'),
  )
})

test('DOM-FIN-033: tahsilat ödeme gününde artı, iptal gününde eksi satırdır', () => {
  const samePeriod = paymentLines(
    [payment({ reversedAt: '2026-10-20T09:00:00.000Z' })],
    students,
    PERIOD,
  )
  assert.deepEqual(
    samePeriod.map((line) => [line.type, line.amountCents]),
    [
      ['Tahsilat', 123_456],
      ['Tahsilat iptali', -123_456],
    ],
  )
  assert.equal(financeSummary(samePeriod, [], []).payments.totalCents, 0)

  const nextPeriod = paymentLines(
    [payment({ paidAt: '2026-09-10T09:00:00.000Z', reversedAt: '2026-10-05T09:00:00.000Z' })],
    students,
    PERIOD,
  )
  assert.deepEqual(
    nextPeriod.map((line) => line.amountCents),
    [-123_456],
  )
})

test('IST-111: gün Europe/Istanbul günüdür; dönem dışı satır girmez', () => {
  const lines = paymentLines(
    [
      payment({ paidAt: '2026-09-30T21:30:00.000Z', receiptNumber: 1 }),
      payment({ paidAt: '2026-09-30T20:30:00.000Z', receiptNumber: 2 }),
      payment({ paidAt: '2026-10-31T21:30:00.000Z', receiptNumber: 3 }),
    ],
    students,
    PERIOD,
  )
  assert.deepEqual(
    lines.map((line) => line.receipt),
    ['2026-1'],
  )
  assert.equal(lines[0]?.date, '2026-10-01')
})

test('DOM-FIN-041: yalnız ödenmiş iade aktarılır', () => {
  const refund = {
    studentId: 's1',
    withdrawalDate: '2026-09-20',
    refundCents: 5_000,
    maskedIban: 'TR** **** 1326',
    accountHolder: 'Test Veli',
  }
  const lines = refundLines(
    [
      { ...refund, refundPaidDate: '2026-10-05' },
      { ...refund, refundPaidDate: null },
      { ...refund, refundPaidDate: '2026-11-01' },
    ],
    students,
    PERIOD,
  )
  assert.equal(lines.length, 1)
  assert.equal(financeSummary([], lines, []).refunds.totalCents, 5_000)
  assert.ok(refundsCsv(lines).includes('"TR** **** 1326"'))
})

test('DOM-FIN-030: taksit durumu ve ödenen tutar dağılımdan hesaplanır', () => {
  const state = createSeed(new Date('2026-10-06T09:00:00.000Z'))
  const base = { ...state.invoices[0]!, studentId: 's1', amount: 10_000, method: null }
  const lines = invoiceLines(
    [
      { ...base, id: 'a', installment: 1, dueDate: '2026-10-15T09:00:00.000Z', paidAt: null },
      { ...base, id: 'b', installment: 2, dueDate: '2026-10-16T09:00:00.000Z', paidAt: null },
      {
        ...base,
        id: 'c',
        installment: 3,
        dueDate: '2026-10-17T09:00:00.000Z',
        paidAt: '2026-10-01T09:00:00.000Z',
        feeKind: 'meal',
      },
      { ...base, id: 'd', installment: 4, dueDate: '2026-11-15T09:00:00.000Z', paidAt: null },
    ],
    new Map([['b', 2_500]]),
    students,
    PERIOD,
  )
  assert.deepEqual(
    lines.map((line) => [line.status, line.paidCents, line.feeKind]),
    [
      ['Açık', 0, 'Öğrenim ücreti'],
      ['Kısmi', 2_500, 'Öğrenim ücreti'],
      ['Ödendi', 10_000, 'Yemek'],
    ],
  )
  const summary = financeSummary([], [], lines).invoices
  assert.deepEqual(summary, {
    count: 3,
    totalCents: 30_000,
    paidCents: 12_500,
    openingImportCents: 0,
  })
  assert.ok(invoicesCsv(lines).includes('"Kısmi";100,00;25,00'))
})

test('IST-111: CSV ayırıcı, ondalık virgül ve okul no doğru; formül kaçılır, eksi tutar sayı kalır', () => {
  assert.equal(csvAmount(123_456), '1234,56')
  assert.equal(csvAmount(-5), '-0,05')
  assert.equal(csvAmount(0), '0,00')
  assert.equal(csvCell('=SUM(A1)'), `"'=SUM(A1)"`)
  const lines = paymentLines(
    [payment({ reference: '=HACK()', reversedAt: '2026-10-20T09:00:00.000Z' })],
    students,
    PERIOD,
  )
  const [header, first, second] = paymentsCsv(lines).split('\r\n')
  assert.ok(header?.startsWith('"Tarih";"Hareket";"Dekont no"'))
  assert.ok(first?.includes(`"'=HACK()";1234,56`))
  assert.ok(first?.includes('"Test Öğrenci";"712"'))
  assert.ok(second?.endsWith(';-1234,56'))
})

test('IST-111: kaydı olmayan öğrenci boş hücre verir, satır kaybolmaz', () => {
  const lines = paymentLines([payment({ studentId: 'silinmis' })], students, PERIOD)
  assert.equal(lines[0]?.studentName, '')
  assert.equal(lines[0]?.amountCents, 123_456)
})

test('DOM-FIN-030: kartlar kısmi ödemeyi sayar; gecikmiş tutar kalan kısımdır', () => {
  const invoice = (id: string, dueDate: string, paidAt: string | null = null) => ({
    id,
    amount: 10_000,
    dueDate,
    paidAt,
  })
  const totals = financeTotals(
    [
      invoice('late', '2026-09-01T09:00:00.000Z'),
      invoice('next', '2026-11-01T09:00:00.000Z'),
      invoice('done', '2026-09-01T09:00:00.000Z', '2026-09-01T09:00:00.000Z'),
    ],
    new Map([
      ['late', 2_500],
      ['next', 1_000],
    ]),
    '2026-10-06',
  )
  assert.deepEqual(totals, {
    totalCents: 30_000,
    paidCents: 13_500,
    openingImportCents: 0,
    remainingCents: 16_500,
    overdueCents: 7_500,
  })
})

// --- Finans özeti (IST-116, IST-121) -------------------------------------------------------

const overviewInvoice = (id: string, studentId: string, amount: number, dueDate: string) => ({
  id,
  studentId,
  amount,
  dueDate,
  paidAt: null as string | null,
})

test('IST-116: özet tahsilatı, açık ve gecikmiş tutarı ay kırılımıyla verir; kısmi ödemede yalnız kalan sayılır', () => {
  const overview = financeOverview({
    invoices: [
      overviewInvoice('i1', 's1', 100_000, '2026-09-15T09:00:00.000Z'),
      overviewInvoice('i2', 's1', 100_000, '2026-10-15T09:00:00.000Z'),
      overviewInvoice('i3', 's2', 50_000, '2026-11-15T09:00:00.000Z'),
      {
        ...overviewInvoice('i4', 's3', 70_000, '2026-09-20T09:00:00.000Z'),
        paidAt: '2026-09-20T10:00:00.000Z',
      },
    ],
    allocated: new Map([['i1', 30_000]]),
    payments: [
      payment({ amountCents: 30_000, paidAt: '2026-09-25T09:00:00.000Z' }),
      payment({ amountCents: 70_000, paidAt: '2026-09-20T10:00:00.000Z' }),
    ],
    period: { from: '2026-09-01', to: '2026-11-30' },
    today: '2026-10-20',
  })
  assert.equal(overview.collectedCents, 100_000)
  // i1'in kalanı (70 bin) ve i2 (100 bin) gecikmiş; i3 henüz vadesinde.
  assert.equal(overview.overdueCents, 170_000)
  assert.equal(overview.openCents, 220_000)
  assert.deepEqual(overview.months, [
    {
      month: '2026-09',
      collectedCents: 100_000,
      dueCents: 170_000,
      openCents: 70_000,
      overdueCents: 70_000,
    },
    {
      month: '2026-10',
      collectedCents: 0,
      dueCents: 100_000,
      openCents: 100_000,
      overdueCents: 100_000,
    },
    { month: '2026-11', collectedCents: 0, dueCents: 50_000, openCents: 50_000, overdueCents: 0 },
  ])
  // Tam ödeyen ve vadesi gelmeyen öğrenci listede yok; en eski ödenmemiş vade gösterilir.
  assert.deepEqual(overview.overdueStudents, [
    { studentId: 's1', overdueCents: 170_000, oldestDueDate: '2026-09-15' },
  ])
})

test('IST-116: açık ve gecikmiş tutar dönemden bağımsızdır ve finans toplamlarıyla aynıdır', () => {
  const invoices = [
    overviewInvoice('i1', 's1', 100_000, '2026-01-15T09:00:00.000Z'),
    overviewInvoice('i2', 's2', 40_000, '2026-12-15T09:00:00.000Z'),
  ]
  const allocated = new Map([['i1', 25_000]])
  const today = '2026-10-20'
  const overview = financeOverview({
    invoices,
    allocated,
    payments: [],
    period: { from: '2026-10-01', to: '2026-10-31' },
    today,
  })
  const totals = financeTotals(invoices, allocated, today)
  assert.equal(overview.openCents, totals.remainingCents)
  assert.equal(overview.overdueCents, totals.overdueCents)
  // Dönem dışındaki taksit kırılıma girmez; öğrenci yine gecikmiş listededir.
  assert.deepEqual(overview.months, [
    { month: '2026-10', collectedCents: 0, dueCents: 0, openCents: 0, overdueCents: 0 },
  ])
  assert.equal(overview.overdueStudents[0]?.overdueCents, 75_000)
})

test('DOM-FIN-033: iptal, iptal edildiği ayda düşer; özet muhasebe toplamıyla aynıdır', () => {
  const payments = [
    payment({
      amountCents: 40_000,
      paidAt: '2026-09-10T09:00:00.000Z',
      reversedAt: '2026-10-05T09:00:00.000Z',
    }),
    payment({ amountCents: 10_000, paidAt: '2026-10-10T09:00:00.000Z' }),
  ]
  const period = { from: '2026-09-01', to: '2026-10-31' }
  const overview = financeOverview({
    invoices: [],
    allocated: new Map(),
    payments,
    period,
    today: '2026-10-20',
  })
  assert.deepEqual(
    overview.months.map((month) => [month.month, month.collectedCents]),
    [
      ['2026-09', 40_000],
      ['2026-10', -30_000],
    ],
  )
  assert.equal(overview.collectedCents, 10_000)
  const lines = paymentLines(payments, students, period)
  assert.equal(financeSummary(lines, [], []).payments.totalCents, overview.collectedCents)
})

test('IST-121: gecikmiş öğrenciler tutar büyükten küçüğe, eşitlikte kimlikle sıralanır; ödenen taksit düşer', () => {
  const overview = financeOverview({
    invoices: [
      overviewInvoice('i1', 's-b', 10_000, '2026-09-01T09:00:00.000Z'),
      overviewInvoice('i2', 's-a', 10_000, '2026-09-01T09:00:00.000Z'),
      overviewInvoice('i3', 's-c', 90_000, '2026-09-01T09:00:00.000Z'),
      overviewInvoice('i4', 's-d', 5_000, '2026-09-01T09:00:00.000Z'),
      overviewInvoice('i5', 's-c', 1_000, '2026-08-01T09:00:00.000Z'),
    ],
    // Dağıtım taksit tutarını aşsa bile kalan eksiye düşmez.
    allocated: new Map([['i4', 9_000]]),
    payments: [],
    period: { from: '2026-09-01', to: '2026-09-30' },
    today: '2026-10-20',
  })
  assert.deepEqual(
    overview.overdueStudents.map((row) => [row.studentId, row.overdueCents, row.oldestDueDate]),
    [
      ['s-c', 91_000, '2026-08-01'],
      ['s-a', 10_000, '2026-09-01'],
      ['s-b', 10_000, '2026-09-01'],
    ],
  )
})

test('vade günü Europe/Istanbul gününe göre aya düşer; bugün vadesi gelen gecikmiş sayılmaz', () => {
  const overview = financeOverview({
    // 30 Eylül 22:00 UTC İstanbul'da 1 Ekim'dir.
    invoices: [
      overviewInvoice('i1', 's1', 10_000, '2026-09-30T22:00:00.000Z'),
      overviewInvoice('i2', 's2', 20_000, '2026-10-20T09:00:00.000Z'),
    ],
    allocated: new Map(),
    payments: [],
    period: { from: '2026-09-01', to: '2026-10-31' },
    today: '2026-10-20',
  })
  assert.deepEqual(
    overview.months.map((month) => [month.month, month.dueCents, month.overdueCents]),
    [
      ['2026-09', 0, 0],
      ['2026-10', 30_000, 10_000],
    ],
  )
})

test('varsayılan özet dönemi içinde bulunulan ay dahil son altı aydır; yıl sınırını geçer', () => {
  assert.deepEqual(defaultOverviewPeriod('2026-10-20'), { from: '2026-05-01', to: '2026-10-20' })
  assert.deepEqual(defaultOverviewPeriod('2026-02-03'), { from: '2025-09-01', to: '2026-02-03' })
  const overview = financeOverview({
    invoices: [],
    allocated: new Map(),
    payments: [],
    period: defaultOverviewPeriod('2026-02-03'),
    today: '2026-02-03',
  })
  assert.deepEqual(
    overview.months.map((month) => month.month),
    ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'],
  )
})

test('özet sorgusunda dönem ya birlikte ya hiç verilir', () => {
  assert.equal(financeOverviewQuerySchema.safeParse({}).success, true)
  assert.equal(
    financeOverviewQuerySchema.safeParse({ from: '2026-01-01', to: '2026-02-01' }).success,
    true,
  )
  assert.equal(financeOverviewQuerySchema.safeParse({ from: '2026-01-01' }).success, false)
  assert.equal(financeOverviewQuerySchema.safeParse({ to: '2026-01-01' }).success, false)
  assert.equal(financeOverviewQuerySchema.safeParse({ extra: '1' }).success, false)
})

// --- Öğrenci bakiyesi (DOM-FIN-052) --------------------------------------------------------

test('DOM-FIN-052: öğrenci bakiyesi kısmi ödemede yalnız kalanı sayar; en yakın açık taksiti verir', () => {
  const balance = studentBalance(
    's1',
    [
      overviewInvoice('i1', 's1', 100_000, '2026-09-15T09:00:00.000Z'),
      overviewInvoice('i2', 's1', 100_000, '2026-11-15T09:00:00.000Z'),
      overviewInvoice('i3', 's1', 100_000, '2026-10-20T09:00:00.000Z'),
      {
        ...overviewInvoice('i4', 's1', 50_000, '2026-08-15T09:00:00.000Z'),
        paidAt: '2026-08-15T10:00:00.000Z',
      },
    ],
    new Map([
      ['i1', 30_000],
      ['i3', 40_000],
    ]),
    '2026-10-20',
  )
  assert.deepEqual(balance, {
    studentId: 's1',
    totalCents: 350_000,
    paidCents: 120_000,
    openingImportCents: 0,
    openCents: 230_000,
    overdueCents: 70_000,
    overdueCount: 1,
    // Bugün vadesi gelen gecikmiş sayılmaz, en yakın açık taksittir; kalan kısmı döner.
    nextDue: { date: '2026-10-20', amountCents: 60_000 },
  })
})

test('DOM-FIN-052: taksiti olmayan ya da borcu bitmiş öğrencide bakiye sıfırdır, sıradaki taksit yoktur', () => {
  assert.deepEqual(studentBalance('s1', [], new Map(), '2026-10-20'), {
    studentId: 's1',
    totalCents: 0,
    paidCents: 0,
    openingImportCents: 0,
    openCents: 0,
    overdueCents: 0,
    overdueCount: 0,
    nextDue: null,
  })
  const settled = studentBalance(
    's1',
    [overviewInvoice('i1', 's1', 10_000, '2026-11-15T09:00:00.000Z')],
    new Map([['i1', 10_000]]),
    '2026-10-20',
  )
  assert.equal(settled.openCents, 0)
  assert.equal(settled.nextDue, null)
})

// --- Açılış aktarımı (DOM-FIN-014, ON-060, ON-061) -----------------------------------------

const openingInvoice = {
  id: 'open-1',
  studentId: 's1',
  installment: 1,
  amount: 40_000,
  dueDate: '2026-09-15T09:00:00.000Z',
  paidAt: '2026-09-14T09:00:00.000Z',
  method: 'Açılış aktarımı',
  reminderAt: null,
} as State['invoices'][number]
const openInvoice = {
  ...openingInvoice,
  id: 'open-2',
  installment: 2,
  dueDate: '2026-10-15T09:00:00.000Z',
  paidAt: null,
  method: null,
} as State['invoices'][number]
const collectedInvoice = {
  ...openingInvoice,
  id: 'open-3',
  installment: 3,
  amount: 10_000,
  method: 'Nakit',
} as State['invoices'][number]

test('DOM-FIN-014: açılış aktarımı toplamda ödendi sayılır, tahsilat tutarından ayrılır', () => {
  const invoices = [openingInvoice, openInvoice, collectedInvoice]
  assert.deepEqual(financeTotals(invoices, new Map(), '2026-10-01'), {
    totalCents: 90_000,
    paidCents: 50_000,
    openingImportCents: 40_000,
    remainingCents: 40_000,
    overdueCents: 0,
  })
  const balance = studentBalance('s1', invoices, new Map(), '2026-10-01')
  assert.equal(balance.paidCents, 50_000)
  assert.equal(balance.openingImportCents, 40_000)
  assert.equal(balance.openCents, 40_000)
})

test('DOM-FIN-014: açılış aktarımı dönem tahsilatını değiştirmez', () => {
  const overview = financeOverview({
    invoices: [openingInvoice, openInvoice],
    allocated: new Map(),
    payments: [],
    period: { from: '2026-09-01', to: '2026-10-31' },
    today: '2026-10-01',
  })
  assert.equal(overview.collectedCents, 0)
  assert.equal(overview.openCents, 40_000)
})

test('DOM-FIN-014: taksit dosyası ödendi yazar ve Açılış aktarımı etiketini taşır', () => {
  const lines = invoiceLines(
    [openingInvoice, openInvoice, collectedInvoice],
    new Map(),
    studentDirectory([{ id: 's1', name: 'Ece', number: 7 }]),
    { from: '2026-09-01', to: '2026-10-31' },
  )
  assert.deepEqual(
    lines.map((line) => [line.status, line.paidCents, line.note]),
    [
      ['Ödendi', 40_000, 'Açılış aktarımı'],
      ['Ödendi', 10_000, ''],
      ['Açık', 0, ''],
    ],
  )
  const summary = financeSummary([], [], lines).invoices
  assert.equal(summary.paidCents, 50_000)
  assert.equal(summary.openingImportCents, 40_000)
  const [header, opening, collected] = invoicesCsv(lines).split('\r\n')
  assert.ok(header?.endsWith(`"Ödenen (₺)"${CSV_SEPARATOR}"Açıklama"`))
  assert.ok(opening?.includes(`"Ödendi"${CSV_SEPARATOR}400,00${CSV_SEPARATOR}400,00`))
  assert.ok(opening?.endsWith(`${CSV_SEPARATOR}"Açılış aktarımı"`))
  assert.ok(collected?.endsWith(`${CSV_SEPARATOR}""`))
})
