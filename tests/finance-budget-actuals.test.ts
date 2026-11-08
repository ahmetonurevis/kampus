import assert from 'node:assert/strict'
import test from 'node:test'

import type { State } from '../packages/school-core/src/data/seed.ts'
import {
  budgetActuals,
  budgetActualsCsv,
  budgetActualsQuerySchema,
  type BudgetActualRow,
  type BudgetActuals,
  type BudgetActualsInput,
  type BudgetExpenseActual,
} from '../packages/school-core/src/lib/finance-budget-actuals.ts'
import type { CostCenterNode } from '../packages/school-core/src/lib/finance-cost-centers.ts'
import { studentDirectory } from '../packages/school-core/src/lib/finance-export.ts'
import {
  financeReconciliation,
  type ReconciliationPayment,
  type ReconciliationWithdrawal,
} from '../packages/school-core/src/lib/finance-reconciliation.ts'
import { OPENING_IMPORT_METHOD } from '../packages/school-core/src/lib/payments.ts'

/**
 * DOM-FIN-066 bütçe–gerçekleşen (ON-244). Okul: Kadıköy kampüsü (b1) ve altında 7. sınıf programı,
 * Ataşehir kampüsü (b2), idari birim. Dönem 1 Eylül 2026 – 31 Ağustos 2027, bugün 15 Ekim 2026.
 */

const TODAY = '2026-10-15'
const PERIOD = {
  id: 'p1',
  name: '2026–2027',
  startDate: '2026-09-01',
  endDate: '2027-08-31',
  status: 'open' as const,
}
const MONTHS = 12

const center = (
  id: string,
  type: CostCenterNode['type'],
  overrides: Partial<CostCenterNode> = {},
): CostCenterNode & { name: string } => ({
  id,
  code: id.toUpperCase(),
  name: `Merkez ${id}`,
  type,
  parentId: null,
  campusId: null,
  gradeLevel: null,
  courseId: null,
  isActive: true,
  ...overrides,
})
const CENTERS = [
  center('kad', 'campus', { campusId: 'b1' }),
  center('kad7', 'program', { parentId: 'kad', gradeLevel: 7 }),
  center('ata', 'campus', { campusId: 'b2' }),
  center('idr', 'unit'),
]

const ITEMS: BudgetActualsInput['items'] = [
  {
    id: 'i-tui',
    code: 'G-100',
    name: 'Öğrenim',
    kind: 'income',
    feeKind: 'tuition',
    isActive: true,
  },
  {
    id: 'i-srv',
    code: 'G-900',
    name: 'Diğer gelir',
    kind: 'income',
    feeKind: null,
    isActive: true,
  },
  { id: 'e-per', code: 'P-100', name: 'Personel', kind: 'expense', feeKind: null, isActive: true },
]

const monthly = (first: number, rest = 0) => [
  first,
  ...Array.from({ length: MONTHS - 1 }, () => rest),
]

type Invoice = BudgetActualsInput['invoices'][number]
const invoice = (
  id: string,
  studentId: string,
  amount: number,
  dueDay: string,
  extra: Partial<Invoice> = {},
): Invoice => ({
  id,
  studentId,
  installment: 1,
  amount,
  dueDate: `${dueDay}T09:00:00.000Z`,
  paidAt: null,
  method: null,
  feeKind: 'tuition',
  ...extra,
})

const payment = (
  studentId: string,
  amountCents: number,
  paidDay: string,
  allocations: Record<string, number>,
  reversedDay: string | null = null,
): ReconciliationPayment => ({
  studentId,
  amountCents,
  paidAt: `${paidDay}T09:00:00.000Z`,
  reversedAt: reversedDay === null ? null : `${reversedDay}T09:00:00.000Z`,
  allocations: Object.entries(allocations).map(([invoiceId, cents]) => ({
    invoiceId,
    amountCents: cents,
  })),
})

function input(overrides: Partial<BudgetActualsInput> = {}): BudgetActualsInput {
  return {
    period: PERIOD,
    basis: 'accrual',
    today: TODAY,
    institutionType: 'school',
    centers: CENTERS,
    items: ITEMS,
    lines: [
      {
        costCenterId: 'kad',
        itemId: 'i-tui',
        amountCents: 1_200_000,
        monthlyCents: monthly(150_000, 95_454).map((value, index) =>
          index === MONTHS - 1 ? 1_200_000 - 150_000 - 95_454 * (MONTHS - 2) : value,
        ),
      },
      { costCenterId: 'ata', itemId: 'i-tui', amountCents: 400_000, monthlyCents: null },
      { costCenterId: 'idr', itemId: 'e-per', amountCents: 900_000, monthlyCents: null },
      { costCenterId: 'idr', itemId: 'i-srv', amountCents: 10_000, monthlyCents: null },
    ],
    invoices: [
      invoice('s1-1', 's1', 100_000, '2026-09-15'),
      invoice('s1-2', 's1', 100_000, '2026-10-15'),
      invoice('s1-3', 's1', 100_000, '2026-11-15'),
      invoice('s1-m', 's1', 10_000, '2026-09-05', { feeKind: 'meal' }),
      invoice('s2-1', 's2', 50_000, '2026-09-20'),
      invoice('s3-1', 's3', 30_000, '2026-09-10'),
      invoice('old', 's1', 70_000, '2026-08-31'),
    ],
    contracts: [],
    students: [
      { id: 's1', classId: 'c1' },
      { id: 's2', classId: 'c2' },
      { id: 's3', classId: 'c3' },
    ],
    classes: [
      { id: 'c1', branchId: 'b1', grade: 7 },
      { id: 'c2', branchId: 'b2', grade: 5 },
      { id: 'c3', branchId: 'b3', grade: 9 },
    ],
    contractCourseIds: new Map(),
    studentCourseIds: new Map(),
    payments: [],
    withdrawals: [],
    expenses: null,
    ...overrides,
  }
}

const rowOf = (report: BudgetActuals, itemId: string, centerId: string | null) => {
  const row = report.rows.find((item) => item.itemId === itemId && item.costCenterId === centerId)
  assert.ok(row, `${itemId}:${String(centerId)} satırı yok`)
  return row
}
const monthOf = (row: BudgetActualRow, month: string) => {
  const found = row.months.find((item) => item.month === month)
  assert.ok(found)
  return found
}

test('DOM-FIN-066: esas varsayılan tahakkuktur; bilinmeyen esas ve parametre reddedilir', () => {
  assert.deepEqual(budgetActualsQuerySchema.parse({}), { basis: 'accrual' })
  assert.deepEqual(budgetActualsQuerySchema.parse({ basis: 'cash' }), { basis: 'cash' })
  assert.equal(budgetActualsQuerySchema.safeParse({ basis: 'nakit' }).success, false)
  assert.equal(budgetActualsQuerySchema.safeParse({ basis: 'cash', x: 1 }).success, false)
})

test('DOM-FIN-066: tahakkuk vade gününde, dönem ve bugünle sınırlı; gelecek ay boş', () => {
  const report = budgetActuals(input())
  assert.equal(report.asOfDate, TODAY)
  assert.equal(report.months.length, MONTHS)
  // s1 7. sınıf programına uyar; programda satır yok, gerçekleşen planlı üst merkeze (kampüs) çıkar.
  const kad = rowOf(report, 'i-tui', 'kad')
  assert.equal(kad.actualCents, 200_000)
  assert.equal(kad.status, 'mapped')
  assert.equal(monthOf(kad, '2026-09').actualCents, 100_000)
  assert.equal(monthOf(kad, '2026-09').plannedCents, 150_000)
  assert.equal(monthOf(kad, '2026-09').varianceCents, -50_000)
  assert.equal(monthOf(kad, '2026-09').realizationBasisPoints, 6667)
  assert.equal(monthOf(kad, '2026-10').actualCents, 100_000)
  assert.equal(monthOf(kad, '2026-11').actualCents, null, 'gelecek ay sayılmaz')
  assert.equal(monthOf(kad, '2026-11').varianceCents, null)
  assert.equal(kad.plannedToDateCents, 150_000 + 95_454)
  assert.equal(kad.varianceCents, 200_000 - 1_200_000)
  assert.equal(kad.realizationBasisPoints, 1667)
  assert.equal(kad.costCenterPath, 'KAD')
  // Dağılımsız satır: aylık plan yok, toplam karşılaştırılır.
  const ata = rowOf(report, 'i-tui', 'ata')
  assert.equal(ata.actualCents, 50_000)
  assert.equal(monthOf(ata, '2026-09').plannedCents, null)
  assert.equal(monthOf(ata, '2026-09').realizationBasisPoints, null)
  assert.equal(ata.plannedToDateCents, null)
  assert.equal(ata.realizationBasisPoints, 1250)
  // Kampüs merkezi olmayan öğrenci dağıtılmamış satırına düşer.
  const none = rowOf(report, 'i-tui', null)
  assert.equal(none.actualCents, 30_000)
  assert.equal(none.hasLine, false)
  assert.equal(none.plannedCents, 0)
  assert.equal(none.realizationBasisPoints, null)
  assert.equal(none.costCenterName, null)
  // Ücret türü hiçbir kaleme eşlenmemiş hareket ayrıca verilir.
  assert.deepEqual(
    report.unmatched.map((entry) => [entry.feeKind, entry.actualCents]),
    [['meal', 10_000]],
  )
  assert.equal(report.totals.income.actualCents, 280_000)
  assert.equal(report.totals.income.unmatchedCents, 10_000)
  assert.equal(report.totals.income.plannedCents, 1_610_000)
  assert.equal(report.openingImportCents, 0)
})

test('DOM-FIN-066: gerçekleşen kalem için satırı olan en yakın merkeze yazılır', () => {
  const base = input()
  const report = budgetActuals(
    input({
      lines: [
        ...base.lines,
        { costCenterId: 'kad7', itemId: 'i-tui', amountCents: 300_000, monthlyCents: null },
      ],
    }),
  )
  assert.equal(rowOf(report, 'i-tui', 'kad7').actualCents, 200_000)
  assert.equal(rowOf(report, 'i-tui', 'kad7').costCenterPath, 'KAD / KAD7')
  assert.equal(rowOf(report, 'i-tui', 'kad').actualCents, 0)
  // Satırı olmayan kalemde gerçekleşen eşleşen merkezde plansız satır açar.
  const noLines = budgetActuals(input({ lines: [] }))
  const program = rowOf(noLines, 'i-tui', 'kad7')
  assert.equal(program.hasLine, false)
  assert.equal(program.actualCents, 200_000)
})

test('DOM-FIN-066: merkez eşlemesi en özel tekil merkezdir; belirsizlikte kampüs, pasif merkez yok', () => {
  const centers = [
    ...CENTERS,
    center('ata5', 'program', { parentId: 'ata', gradeLevel: 5 }),
    center('ort9', 'program', { gradeLevel: 9 }),
  ]
  const report = budgetActuals(input({ centers, lines: [] }))
  assert.equal(rowOf(report, 'i-tui', 'ata5').actualCents, 50_000)
  // b3'ün kampüs merkezi yok; hiçbir kampüse bağlı olmayan 9. sınıf programı tektir.
  assert.equal(rowOf(report, 'i-tui', 'ort9').actualCents, 30_000)

  const ambiguous = budgetActuals(
    input({
      centers: [
        ...CENTERS,
        center('u1', 'unit', { parentId: 'kad' }),
        center('u1-7', 'program', { parentId: 'u1', gradeLevel: 7 }),
      ],
      lines: [],
    }),
  )
  assert.equal(rowOf(ambiguous, 'i-tui', 'kad').actualCents, 200_000)

  // Başka kampüsün programı ve pasif merkez seçilmez.
  const other = budgetActuals(
    input({
      centers: [
        center('kad', 'campus', { campusId: 'b1', isActive: false }),
        center('ata', 'campus', { campusId: 'b2' }),
        center('ata7', 'program', { parentId: 'ata', gradeLevel: 7 }),
      ],
      lines: [],
    }),
  )
  assert.equal(rowOf(other, 'i-tui', null).actualCents, 230_000)
  assert.equal(
    other.rows.some((row) => row.costCenterId === 'ata7'),
    false,
  )
})

test('DOM-FIN-066: sözleşmenin sınıfı öğrencinin bugünkü sınıfından önce gelir', () => {
  const contracts = [
    { id: 'k-old', studentId: 's2', classId: 'c1', date: '', amount: 0, title: '' },
  ] as unknown as State['contracts']
  const report = budgetActuals(
    input({
      contracts,
      invoices: [invoice('s2-1', 's2', 50_000, '2026-09-20', { contractId: 'k-old' })],
    }),
  )
  assert.equal(rowOf(report, 'i-tui', 'kad').actualCents, 50_000)
})

test('DOM-FIN-066 DOM-FIN-056: tahakkuk mutabakattaki tahakkuk eksi ayrılış düzeltmesine eşittir', () => {
  const invoices = [
    invoice('w-1', 's1', 50_000, '2026-09-15', {
      paidAt: '2026-09-15T09:00:00.000Z',
      method: 'Nakit',
    }),
  ]
  const contracts = [
    { id: 'k1', studentId: 's1', date: '', amount: 100_000, title: '', invoiceIds: ['w-1'] },
  ] as unknown as State['contracts']
  const withdrawals: ReconciliationWithdrawal[] = [
    {
      studentId: 's1',
      contractId: 'k1',
      withdrawalDate: '2026-10-01',
      refundCents: 20_000,
      debtCents: 0,
      refundPaidDate: '2026-10-05',
      breakdown: { paidCents: 50_000, creditCents: 0, extras: [] },
    },
  ]
  const payments = [payment('s1', 50_000, '2026-09-15', { 'w-1': 50_000 })]
  const report = budgetActuals(input({ invoices, contracts, withdrawals, payments, lines: [] }))
  const row = rowOf(report, 'i-tui', 'kad7')
  assert.equal(monthOf(row, '2026-09').actualCents, 50_000)
  assert.equal(monthOf(row, '2026-10').actualCents, -20_000)
  const reconciliation = financeReconciliation({
    year: 2026,
    period: { from: PERIOD.startDate, to: TODAY },
    invoices: invoices as State['invoices'],
    contracts,
    cancelledContractIds: new Set(),
    payments,
    withdrawals,
    students: studentDirectory([]),
  })
  assert.equal(
    row.actualCents,
    reconciliation.totals.accruedCents - reconciliation.totals.withdrawalAdjustmentCents,
  )

  // Tahsilat esası: tahsilat − ödenen iade, mutabakattaki tahsilat − iptal − iade.
  const cash = budgetActuals(
    input({ basis: 'cash', invoices, contracts, withdrawals, payments, lines: [] }),
  )
  assert.equal(
    rowOf(cash, 'i-tui', 'kad7').actualCents,
    reconciliation.totals.collectedCents -
      reconciliation.totals.reversedCents -
      reconciliation.totals.refundedCents,
  )
})

test('DOM-FIN-066: tahsilat esası ödeme, iptal ve iade gününde; dağıtılmamış tahsilat eşlenmemiş', () => {
  const report = budgetActuals(
    input({
      basis: 'cash',
      payments: [
        payment('s1', 120_000, '2026-09-16', { 's1-1': 100_000 }),
        payment('s2', 50_000, '2026-09-21', { 's2-1': 50_000 }, '2026-10-02'),
        payment('s1', 5_000, '2026-09-30', { cancelled: 5_000 }),
        payment('s1', 1_000, '2026-11-01', { 's1-2': 1_000 }),
      ],
      withdrawals: [
        {
          studentId: 's3',
          contractId: 'k3',
          withdrawalDate: '2026-09-25',
          refundCents: 7_000,
          debtCents: 0,
          refundPaidDate: '2026-10-03',
          breakdown: { paidCents: 0, creditCents: 0, extras: [] },
        },
      ],
      invoices: [
        ...input().invoices,
        invoice('imp', 's1', 40_000, '2026-09-01', {
          paidAt: '2026-09-02T09:00:00.000Z',
          method: OPENING_IMPORT_METHOD,
        }),
      ],
    }),
  )
  const kad = rowOf(report, 'i-tui', 'kad')
  assert.equal(monthOf(kad, '2026-09').actualCents, 100_000 + 40_000)
  assert.equal(monthOf(kad, '2026-10').actualCents, 0)
  const ata = rowOf(report, 'i-tui', 'ata')
  assert.equal(monthOf(ata, '2026-09').actualCents, 50_000)
  assert.equal(monthOf(ata, '2026-10').actualCents, -50_000)
  assert.equal(rowOf(report, 'i-tui', null).actualCents, -7_000)
  assert.deepEqual(
    report.unmatched.map((entry) => [entry.feeKind, entry.actualCents]),
    [[null, 25_000]],
  )
  assert.equal(report.openingImportCents, 40_000)
})

test('DOM-FIN-066: gider kaynağı yoksa "gerçekleşen verisi yok"; kaynak verilince hesaplanır', () => {
  const none = budgetActuals(input())
  const expense = rowOf(none, 'e-per', 'idr')
  assert.equal(expense.status, 'no_expense_data')
  assert.equal(expense.actualCents, null)
  assert.equal(monthOf(expense, '2026-09').actualCents, null)
  assert.equal(none.expenseData, 'none')
  assert.equal(none.totals.expense.actualCents, null)
  assert.equal(none.totals.net.actualCents, null)
  assert.equal(none.totals.net.plannedCents, 1_610_000 - 900_000)

  const expenses: BudgetExpenseActual[] = [
    {
      itemId: 'e-per',
      costCenterId: 'idr',
      accrualDate: '2026-09-30',
      paidDate: '2026-10-05',
      amountCents: 300_000,
      source: 'manual',
    },
    {
      itemId: 'e-per',
      costCenterId: null,
      accrualDate: '2026-10-01',
      paidDate: null,
      amountCents: 4_000,
      source: 'purchase',
    },
    // Gelir kalemine ve dönem dışına yazılan satır sayılmaz.
    {
      itemId: 'i-tui',
      costCenterId: 'kad',
      accrualDate: '2026-09-30',
      paidDate: null,
      amountCents: 1,
      source: 'manual',
    },
    {
      itemId: 'e-per',
      costCenterId: 'idr',
      accrualDate: '2026-12-01',
      paidDate: null,
      amountCents: 9,
      source: 'manual',
    },
  ]
  const accrual = budgetActuals(input({ expenses }))
  assert.equal(accrual.expenseData, 'available')
  assert.equal(monthOf(rowOf(accrual, 'e-per', 'idr'), '2026-09').actualCents, 300_000)
  assert.equal(rowOf(accrual, 'e-per', null).actualCents, 4_000)
  assert.equal(accrual.totals.expense.actualCents, 304_000)
  assert.equal(accrual.totals.net.actualCents, 280_000 - 304_000)
  const cash = budgetActuals(input({ basis: 'cash', expenses }))
  assert.equal(monthOf(rowOf(cash, 'e-per', 'idr'), '2026-10').actualCents, 300_000)
  assert.equal(
    cash.rows.some((row) => row.itemId === 'e-per' && row.costCenterId === null),
    false,
  )
})

test('DOM-FIN-066: ücret türüne eşlenmemiş gelir kalemi; pasif kalem yalnız dönemde satırı varsa eşler', () => {
  const report = budgetActuals(input())
  const other = rowOf(report, 'i-srv', 'idr')
  assert.equal(other.status, 'unmapped_item')
  assert.equal(other.actualCents, null)

  const items = [
    { ...ITEMS[0], isActive: false } as (typeof ITEMS)[number],
    {
      id: 'i-new',
      code: 'G-101',
      name: 'Yeni öğrenim',
      kind: 'income' as const,
      feeKind: 'tuition' as const,
      isActive: true,
    },
  ]
  const preferred = budgetActuals(input({ items, lines: [] }))
  assert.equal(
    preferred.rows.every((row) => row.itemId === 'i-new'),
    true,
  )
  const inactiveOnly = budgetActuals(
    input({
      items: [items[0] as (typeof ITEMS)[number]],
      lines: [{ costCenterId: 'kad', itemId: 'i-tui', amountCents: 1, monthlyCents: null }],
    }),
  )
  assert.equal(rowOf(inactiveOnly, 'i-tui', 'kad').actualCents, 200_000)
  const unused = budgetActuals(input({ items: [items[0] as (typeof ITEMS)[number]], lines: [] }))
  assert.equal(unused.rows.length, 0)
  assert.equal(unused.unmatched.find((entry) => entry.feeKind === 'tuition')?.actualCents, 280_000)
})

test('DOM-FIN-066: başlamamış dönemde gerçekleşen yok; biten dönemde bugüne kadar plan tamamıdır', () => {
  const future = budgetActuals(
    input({ period: { ...PERIOD, startDate: '2027-09-01', endDate: '2028-08-31' } }),
  )
  assert.equal(future.asOfDate, null)
  assert.equal(
    future.rows.every((row) => row.status === 'not_started'),
    true,
  )
  assert.equal(
    future.rows.every((row) => row.actualCents === null),
    true,
  )
  assert.deepEqual(future.unmatched, [])
  assert.equal(future.totals.income.actualCents, null)
  assert.equal(future.totals.income.unmatchedCents, null)

  const past = budgetActuals(input({ today: '2027-10-01' }))
  assert.equal(past.asOfDate, PERIOD.endDate)
  assert.equal(rowOf(past, 'i-tui', 'ata').plannedToDateCents, 400_000)
  assert.equal(rowOf(past, 'i-tui', 'kad').actualCents, 300_000)
  assert.equal(
    rowOf(past, 'i-tui', 'kad').months.every((month) => month.actualCents !== null),
    true,
  )
})

test('DOM-FIN-066: dil okulunda kur paket satışından, yoksa öğrencinin tek kurundan', () => {
  const centers = [
    center('dil', 'campus', { campusId: 'b1' }),
    center('b1k', 'program', { parentId: 'dil', courseId: 'course-b1' }),
    center('a2k', 'program', { courseId: 'course-a2' }),
  ]
  const report = budgetActuals(
    input({
      institutionType: 'language_school',
      centers,
      lines: [],
      invoices: [
        invoice('l1', 's1', 10_000, '2026-09-10', { contractId: 'sale-1' }),
        invoice('l2', 's2', 20_000, '2026-09-10'),
        invoice('l3', 's3', 30_000, '2026-09-10'),
      ],
      contractCourseIds: new Map([['sale-1', 'course-b1']]),
      studentCourseIds: new Map([
        ['s2', ['course-a2']],
        ['s3', ['course-a2', 'course-b1']],
      ]),
    }),
  )
  assert.equal(rowOf(report, 'i-tui', 'b1k').actualCents, 10_000)
  assert.equal(rowOf(report, 'i-tui', 'a2k').actualCents, 20_000)
  // Birden çok kuru olan öğrencinin kuru belirsizdir; kampüs merkezi de yok (b3).
  assert.equal(rowOf(report, 'i-tui', null).actualCents, 30_000)
})

test('DOM-FIN-066: CSV ay ay ve dönem satırı, eşlenmemiş gelir; formül kaçışlı', () => {
  const report = budgetActuals(
    input({
      items: [
        { ...ITEMS[0], name: '=Öğrenim' } as (typeof ITEMS)[number],
        ITEMS[2] as (typeof ITEMS)[number],
      ],
    }),
  )
  const csv = budgetActualsCsv(report)
  const lines = csv.split('\r\n')
  assert.equal(
    lines[0],
    '"Kalem kodu";"Kalem";"Tür";"Maliyet merkezi";"Ay";"Plan (₺)";"Gerçekleşen (₺)";"Fark (₺)";"Gerçekleşme (%)";"Durum"',
  )
  assert.ok(
    lines.includes(
      '"G-100";"\'=Öğrenim";"Gelir";"KAD · Merkez kad";"2026-09";1500,00;1000,00;-500,00;66,67;"Hesaplandı"',
    ),
  )
  assert.ok(
    lines.includes(
      '"G-100";"\'=Öğrenim";"Gelir";"Dağıtılmamış";"Dönem";0,00;300,00;300,00;"";"Hesaplandı"',
    ),
  )
  assert.ok(
    lines.includes(
      '"P-100";"Personel";"Gider";"IDR · Merkez idr";"Dönem";9000,00;"";"";"";"Gerçekleşen verisi yok"',
    ),
  )
  assert.ok(
    lines.includes(
      '"";"Yemek (kaleme eşlenmemiş)";"Gelir";"";"Dönem";"";100,00;"";"";"Eşlenmemiş gelir"',
    ),
  )
  // Satır başına 12 ay + dönem; eşlenmemiş gelir de aynı biçim.
  assert.equal(lines.length, 1 + (report.rows.length + report.unmatched.length) * (MONTHS + 1))
})
