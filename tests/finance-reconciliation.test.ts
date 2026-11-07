import assert from 'node:assert/strict'
import test from 'node:test'

import type { State } from '../packages/school-core/src/data/seed.ts'
import {
  defaultFinanceExportProfile,
  financeExportProfileSchema,
  profiledReconciliationCsv,
} from '../packages/school-core/src/lib/finance-export-profile.ts'
import {
  financeSummary,
  invoiceLines,
  paymentLines,
  refundLines,
  studentDirectory,
} from '../packages/school-core/src/lib/finance-export.ts'
import {
  financeReconciliation,
  financeReconciliationExportQuerySchema,
  financeReconciliationQuerySchema,
  reconciliationPeriod,
  type ReconciliationPayment,
  type ReconciliationRow,
  type ReconciliationWithdrawal,
} from '../packages/school-core/src/lib/finance-reconciliation.ts'
import { OPENING_IMPORT_METHOD } from '../packages/school-core/src/lib/payments.ts'
import { isDomainError } from './support/domain-error.ts'

const PERIOD = { from: '2026-09-01', to: '2027-08-31' }
const directory = studentDirectory([{ id: 's1', name: 'Test Öğrenci', number: 712 }])

type Invoice = State['invoices'][number]
const invoice = (id: string, amount: number, dueDate: string, extra: Partial<Invoice> = {}) =>
  ({
    id,
    studentId: 's1',
    installment: 1,
    amount,
    dueDate: `${dueDate}T09:00:00.000Z`,
    paidAt: null,
    method: null,
    reminderAt: null,
    feeKind: 'tuition',
    ...extra,
  }) as Invoice

const payment = (
  amountCents: number,
  paidDay: string,
  allocations: Record<string, number> = {},
  reversedDay: string | null = null,
): ReconciliationPayment => ({
  studentId: 's1',
  amountCents,
  paidAt: `${paidDay}T09:00:00.000Z`,
  reversedAt: reversedDay === null ? null : `${reversedDay}T09:00:00.000Z`,
  allocations: Object.entries(allocations).map(([invoiceId, cents]) => ({
    invoiceId,
    amountCents: cents,
  })),
})

const withdrawal = (
  overrides: Partial<ReconciliationWithdrawal> & {
    paidCents?: number
    creditCents?: number
    debtInvoiceId?: string
  } = {},
): ReconciliationWithdrawal => {
  const { paidCents = 0, creditCents = 0, debtInvoiceId, ...rest } = overrides
  return {
    studentId: 's1',
    contractId: 'k1',
    withdrawalDate: '2026-10-01',
    refundCents: 0,
    debtCents: 0,
    refundPaidDate: null,
    breakdown: {
      paidCents,
      creditCents,
      extras: [],
      ...(debtInvoiceId === undefined ? {} : { debtInvoiceId }),
    },
    ...rest,
  }
}

type Contract = State['contracts'][number]
const contract = (id: string, invoiceIds: string[], extra: Partial<Contract> = {}) =>
  ({
    id,
    studentId: 's1',
    date: '2026-06-01T09:00:00.000Z',
    amount: 0,
    title: 'Sözleşme',
    invoiceIds,
    academicYear: 2026,
    ...extra,
  }) as Contract

function reconcile(
  input: {
    invoices?: Invoice[]
    payments?: ReconciliationPayment[]
    withdrawals?: ReconciliationWithdrawal[]
    contracts?: Contract[]
    cancelled?: string[]
    period?: { from: string; to: string }
  } = {},
) {
  return financeReconciliation({
    year: 2026,
    period: input.period ?? PERIOD,
    invoices: input.invoices ?? [],
    payments: input.payments ?? [],
    withdrawals: input.withdrawals ?? [],
    contracts: input.contracts ?? [],
    cancelledContractIds: new Set(input.cancelled ?? []),
    students: directory,
  })
}

function only(result: ReturnType<typeof reconcile>): ReconciliationRow {
  assert.equal(result.rows.length, 1)
  const [row] = result.rows
  assert.ok(row)
  return row
}

/** Kural: hareket formülü her satırda stoğa eşit ve beklenen alan formülün kendisidir. */
function assertBalanced(row: ReconciliationRow) {
  assert.equal(row.differenceCents, 0, 'fark sıfır olmalı')
  assert.equal(row.mismatchReason, null)
  assert.equal(
    row.openingCents +
      row.accruedCents -
      row.withdrawalAdjustmentCents -
      row.collectedCents -
      row.openingImportCents +
      row.reversedCents +
      row.refundedCents,
    row.closingCents,
  )
  assert.equal(row.closingCents, row.openDebtCents - row.creditCents)
}

test('IST-111 ON-085: eğitim yılı sorgusu; yıl zorunlu, sınırlı, bilinmeyen parametre 400', () => {
  assert.equal(financeReconciliationExportQuerySchema.parse({ year: '2026' }).year, 2026)
  assert.equal(financeReconciliationQuerySchema.parse({ year: '2026' }).status, 'all')
  assert.equal(financeReconciliationExportQuerySchema.safeParse({}).success, false)
  assert.equal(financeReconciliationExportQuerySchema.safeParse({ year: '1999' }).success, false)
  assert.equal(financeReconciliationExportQuerySchema.safeParse({ year: '20.5' }).success, false)
  assert.equal(
    financeReconciliationExportQuerySchema.safeParse({ year: '2026', x: '1' }).success,
    false,
  )
  assert.equal(
    financeReconciliationQuerySchema.safeParse({ year: '2026', status: 'x' }).success,
    false,
  )
})

test('DOM-FIN-056: dönem kurumun yıl aralığıdır, süren yılda bugünde biter, başlamamış yıl reddedilir', () => {
  assert.deepEqual(reconciliationPeriod(2025, null, '2026-10-06'), {
    from: '2025-09-01',
    to: '2026-08-31',
  })
  assert.deepEqual(reconciliationPeriod(2026, null, '2026-10-06'), {
    from: '2026-09-01',
    to: '2026-10-06',
  })
  assert.deepEqual(
    reconciliationPeriod(2025, { startDate: '2025-08-15', endDate: '2026-07-31' }, '2026-10-06'),
    { from: '2025-08-15', to: '2026-07-31' },
  )
  assert.throws(
    () => reconciliationPeriod(2027, null, '2026-10-06'),
    isDomainError('reconciliation_year_not_started'),
  )
  assert.throws(
    () =>
      reconciliationPeriod(2024, { startDate: '2024-09-01', endDate: '2026-08-31' }, '2026-10-06'),
    isDomainError('export_period_too_long'),
  )
})

test('DOM-FIN-056: kısmi ödemede yalnız kalan kısım kapanışa kalır', () => {
  const row = only(
    reconcile({
      invoices: [invoice('i1', 100_000, '2026-10-15')],
      payments: [payment(30_000, '2026-10-20', { i1: 30_000 })],
    }),
  )
  assertBalanced(row)
  assert.equal(row.accruedCents, 100_000)
  assert.equal(row.collectedCents, 30_000)
  assert.equal(row.closingCents, 70_000)
  assert.equal(row.openDebtCents, 70_000)
})

test('DOM-FIN-056: dönem başı borç önceki yıllardan gelir; tahsilat borcu o yılda düşürür', () => {
  const row = only(
    reconcile({
      invoices: [invoice('old', 50_000, '2026-05-15'), invoice('new', 20_000, '2026-11-15')],
      payments: [
        payment(10_000, '2026-06-01', { old: 10_000 }),
        payment(5_000, '2026-09-10', { old: 5_000 }),
      ],
    }),
  )
  assertBalanced(row)
  assert.equal(row.openingCents, 40_000)
  assert.equal(row.accruedCents, 20_000)
  assert.equal(row.collectedCents, 5_000)
  assert.equal(row.closingCents, 55_000)
})

test('DOM-FIN-033: önceki dönem tahsilatının iptali iptal gününde borcu geri açar', () => {
  const row = only(
    reconcile({
      invoices: [invoice('old', 50_000, '2026-05-15')],
      payments: [payment(50_000, '2026-06-01', { old: 50_000 }, '2026-09-20')],
    }),
  )
  assertBalanced(row)
  assert.equal(row.openingCents, 0)
  assert.equal(row.collectedCents, 0)
  assert.equal(row.reversedCents, 50_000)
  assert.equal(row.closingCents, 50_000)
})

test('DOM-FIN-033: aynı dönemde alınıp iptal edilen tahsilat iki yönde sayılır, kapanışa etkisi yok', () => {
  const row = only(
    reconcile({
      invoices: [invoice('i1', 40_000, '2026-10-15')],
      payments: [payment(40_000, '2026-10-16', { i1: 40_000 }, '2026-10-18')],
    }),
  )
  assertBalanced(row)
  assert.equal(row.collectedCents, 40_000)
  assert.equal(row.reversedCents, 40_000)
  assert.equal(row.closingCents, 40_000)
})

test('DOM-FIN-033: dönem sonrasındaki iptal ve tahsilat kapanışı değiştirmez', () => {
  const period = { from: '2025-09-01', to: '2026-08-31' }
  const row = only(
    reconcile({
      period,
      invoices: [invoice('i1', 40_000, '2026-03-15')],
      payments: [
        payment(40_000, '2026-04-01', { i1: 40_000 }, '2026-09-05'),
        payment(40_000, '2026-09-06', { i1: 40_000 }),
      ],
    }),
  )
  assertBalanced(row)
  assert.equal(row.collectedCents, 40_000)
  assert.equal(row.reversedCents, 0)
  assert.equal(row.closingCents, 0)
})

test('DOM-FIN-030: dağıtılmayan tahsilat ve vadesi gelmemiş taksite alınan para alacaktır', () => {
  const row = only(
    reconcile({
      period: { from: '2026-09-01', to: '2026-10-31' },
      invoices: [invoice('i1', 10_000, '2026-10-15'), invoice('later', 10_000, '2026-12-15')],
      payments: [payment(25_000, '2026-10-16', { i1: 10_000, later: 10_000 })],
    }),
  )
  assertBalanced(row)
  assert.equal(row.accruedCents, 10_000)
  assert.equal(row.openDebtCents, 0)
  assert.equal(row.creditCents, 15_000)
  assert.equal(row.closingCents, -15_000)
})

test('DOM-FIN-041: iade ödenene kadar kurumun borcudur, ödenince kapanış sıfırdır', () => {
  const invoices = [invoice('i1', 100_000, '2026-09-15', { paidAt: '2026-09-15T09:00:00.000Z' })]
  const payments = [payment(100_000, '2026-09-15', { i1: 100_000 })]
  const contracts = [contract('k1', ['i1'])]
  const base = { paidCents: 100_000, refundCents: 40_000 }

  const unpaid = only(reconcile({ invoices, payments, contracts, withdrawals: [withdrawal(base)] }))
  assertBalanced(unpaid)
  assert.equal(unpaid.withdrawalAdjustmentCents, 40_000)
  assert.equal(unpaid.refundedCents, 0)
  assert.equal(unpaid.closingCents, -40_000)

  const paid = only(
    reconcile({
      invoices,
      payments,
      contracts,
      withdrawals: [withdrawal({ ...base, refundPaidDate: '2026-10-05' })],
    }),
  )
  assertBalanced(paid)
  assert.equal(paid.refundedCents, 40_000)
  assert.equal(paid.closingCents, 0)
})

test('DOM-FIN-041: iptal edilen taksite alınan kısmi ödeme ayrılışta mahsup edilir', () => {
  // 100.000 + 100.000 plan; ikinci taksite 30.000 alındı, hak edilen 50.000, iade 80.000.
  const row = only(
    reconcile({
      invoices: [invoice('i1', 100_000, '2026-09-15', { paidAt: '2026-09-15T09:00:00.000Z' })],
      payments: [
        payment(100_000, '2026-09-15', { i1: 100_000 }),
        payment(30_000, '2026-09-20', { cancelled: 30_000 }),
      ],
      contracts: [contract('k1', ['i1'])],
      withdrawals: [
        withdrawal({ paidCents: 130_000, refundCents: 80_000, refundPaidDate: '2026-10-05' }),
      ],
    }),
  )
  assertBalanced(row)
  assert.equal(row.withdrawalAdjustmentCents, 50_000)
  assert.equal(row.closingCents, 0)
})

test('DOM-FIN-041: ayrılışta kalan borç taksitte açık kalır, tahsilatı borcu kapatır', () => {
  // Hak edilen 50.000, ödenen 30.000: 20.000 borç taksiti; iptal edilen taksitin parası mahsup edilir.
  const debt = invoice('debt', 20_000, '2026-10-01', { installment: 2 })
  const invoices = [debt]
  const contracts = [contract('k1', ['debt'])]
  const common = {
    invoices,
    contracts,
    withdrawals: [withdrawal({ paidCents: 30_000, debtInvoiceId: 'debt' })],
  }
  const open = only(
    reconcile({ ...common, payments: [payment(30_000, '2026-09-20', { cancelled: 30_000 })] }),
  )
  assertBalanced(open)
  assert.equal(open.withdrawalAdjustmentCents, -30_000)
  assert.equal(open.closingCents, 20_000)

  const settled = only(
    reconcile({
      ...common,
      payments: [
        payment(30_000, '2026-09-20', { cancelled: 30_000 }),
        payment(20_000, '2026-10-10', { debt: 20_000 }),
      ],
    }),
  )
  assertBalanced(settled)
  assert.equal(settled.closingCents, 0)
})

test('DOM-FIN-041: eski ayrılış kaydında borç taksiti son açılan taksittir', () => {
  const row = only(
    reconcile({
      invoices: [
        invoice('i1', 10_000, '2026-09-15', { paidAt: '2026-09-15T09:00:00.000Z' }),
        invoice('debt', 5_000, '2026-10-01', { installment: 2 }),
      ],
      payments: [payment(10_000, '2026-09-15', { i1: 10_000 })],
      contracts: [contract('k1', ['i1', 'debt'])],
      withdrawals: [withdrawal({ paidCents: 10_000, debtCents: 5_000 })],
    }),
  )
  assertBalanced(row)
  assert.equal(row.closingCents, 5_000)

  // Borç taksiti sonradan ödense de ayrılışta mahsup edilen alacağı değiştirmez.
  const settled = only(
    reconcile({
      invoices: [
        invoice('i1', 10_000, '2026-09-15', { paidAt: '2026-09-15T09:00:00.000Z' }),
        invoice('debt', 5_000, '2026-10-01', {
          installment: 2,
          paidAt: '2026-10-10T09:00:00.000Z',
        }),
      ],
      payments: [
        payment(10_000, '2026-09-15', { i1: 10_000 }),
        payment(5_000, '2026-10-10', { debt: 5_000 }),
      ],
      contracts: [contract('k1', ['i1', 'debt'])],
      withdrawals: [withdrawal({ paidCents: 10_000, debtCents: 5_000 })],
    }),
  )
  assertBalanced(settled)
  assert.equal(settled.withdrawalAdjustmentCents, 0)
  assert.equal(settled.closingCents, 0)
})

test('DOM-FIN-056: ayrılışın sözleşmesi kayıtlı değilse öğrencinin taksitleri esas alınır', () => {
  const row = only(
    reconcile({
      invoices: [invoice('i1', 10_000, '2026-09-15', { paidAt: '2026-09-15T09:00:00.000Z' })],
      payments: [payment(10_000, '2026-09-15', { i1: 10_000 })],
      withdrawals: [withdrawal({ paidCents: 10_000, refundCents: 4_000 })],
    }),
  )
  assertBalanced(row)
  assert.equal(row.closingCents, -4_000)
})

test('DOM-FIN-025: burs ve indirim bilgi sütunudur, formüle girmez; burslu toplam tutar', () => {
  const row = only(
    reconcile({
      invoices: [invoice('i1', 60_000, '2026-10-15')],
      payments: [payment(60_000, '2026-10-15', { i1: 60_000 })],
      contracts: [
        contract('k1', ['i1'], {
          scholarship: { programId: 'p1', amountCents: 30_000 },
          discounts: [
            { kind: 'sibling', amountCents: 8_000 },
            { kind: 'early', amountCents: 2_000 },
          ],
        } as Partial<Contract>),
      ],
    }),
  )
  assertBalanced(row)
  assert.equal(row.scholarshipCents, 30_000)
  assert.equal(row.discountCents, 10_000)
  assert.equal(row.closingCents, 0)
})

test('DOM-FIN-025: tam bursta taksit olmasa da öğrenci satırda görünür', () => {
  const row = only(
    reconcile({
      contracts: [
        contract('k1', [], {
          scholarship: { programId: 'p1', amountCents: 100_000 },
        } as Partial<Contract>),
      ],
    }),
  )
  assertBalanced(row)
  assert.equal(row.scholarshipCents, 100_000)
  assert.equal(row.accruedCents, 0)
})

test('DOM-FIN-012: başka yılın, iptal edilen yenilemenin ve değişen sürümün bursu sayılmaz', () => {
  const scholarship = { programId: 'p1', amountCents: 1_000 }
  const row = only(
    reconcile({
      invoices: [invoice('i1', 5_000, '2026-10-15')],
      contracts: [
        contract('other-year', [], { academicYear: 2025, scholarship } as Partial<Contract>),
        contract('cancelled-renewal', [], { scholarship } as Partial<Contract>),
        contract('amended', [], {
          scholarship,
          approval: { method: 'wet_signature' },
        } as unknown as Partial<Contract>),
        contract('current', [], {
          amendsContractId: 'amended',
          approval: { method: 'wet_signature' },
          scholarship: { programId: 'p1', amountCents: 7_000 },
        } as unknown as Partial<Contract>),
      ],
      cancelled: ['cancelled-renewal'],
    }),
  )
  assert.equal(row.scholarshipCents, 7_000)
})

test('DOM-FIN-056: tahsilat kaydı olmadan ödenmiş taksit tutmayan öğrenci listesine düşer', () => {
  const result = reconcile({
    invoices: [invoice('legacy', 30_000, '2026-10-15', { paidAt: '2026-10-16T09:00:00.000Z' })],
  })
  const row = only(result)
  assert.equal(result.mismatchCount, 1)
  assert.equal(row.closingCents, 0)
  assert.equal(row.expectedClosingCents, 30_000)
  assert.equal(row.differenceCents, -30_000)
  assert.equal(row.mismatchReason, 'unrecorded_payment')
  assert.equal(result.totals.differenceCents, -30_000)
})

test('DOM-FIN-056: önceki yılın kayıtsız ödemesi bu yılı tutmaz yapmaz', () => {
  const result = reconcile({
    invoices: [
      invoice('legacy', 30_000, '2026-05-15', { paidAt: '2026-05-16T09:00:00.000Z' }),
      invoice('i1', 10_000, '2026-10-15'),
    ],
  })
  assert.equal(result.mismatchCount, 0)
  assertBalanced(only(result))
})

test('DOM-FIN-056: başka öğrencinin taksitine yazılan dağılımda iki öğrenci de tutmaz', () => {
  const result = reconcile({
    invoices: [
      invoice('i1', 10_000, '2026-10-15'),
      invoice('other', 10_000, '2026-10-15', { studentId: 's2' }),
    ],
    payments: [payment(10_000, '2026-10-20', { other: 10_000 })],
  })
  assert.equal(result.mismatchCount, 2)
  assert.deepEqual(
    result.rows.map((row) => [row.studentId, row.differenceCents, row.mismatchReason]),
    [
      ['s2', -10_000, 'other'],
      ['s1', 10_000, 'other'],
    ],
  )
  assert.equal(result.totals.differenceCents, 0)
})

test('DOM-FIN-056: tahsilatı aşan dağılım tutmaz', () => {
  const row = only(
    reconcile({
      invoices: [invoice('i1', 10_000, '2026-10-15')],
      payments: [payment(4_000, '2026-10-20', { i1: 10_000 })],
    }),
  )
  assert.equal(row.closingCents, 0)
  assert.equal(row.expectedClosingCents, 6_000)
  assert.equal(row.differenceCents, -6_000)
  assert.equal(row.mismatchReason, 'other')
})

test('DOM-FIN-030: taksiti aşan dağılım borçtan düşülmez, alacak kalır ve tutar', () => {
  const row = only(
    reconcile({
      invoices: [invoice('i1', 10_000, '2026-10-15')],
      payments: [payment(12_000, '2026-10-20', { i1: 12_000 })],
    }),
  )
  assertBalanced(row)
  assert.equal(row.openDebtCents, 0)
  assert.equal(row.creditCents, 2_000)
})

/** Dosyadan aktarılan geçmiş ödeme: taksit ödendi görünür, tahsilat satırı yoktur (DOM-FIN-014). */
const imported = (id: string, amount: number, dueDate: string, paidDay: string) =>
  invoice(id, amount, dueDate, {
    paidAt: `${paidDay}T09:00:00.000Z`,
    method: OPENING_IMPORT_METHOD,
  })

test('DOM-FIN-056 DOM-FIN-014: açılış aktarımı tahsilat sayılmaz, ayrı kalemle formül tutar', () => {
  const result = reconcile({ invoices: [imported('i1', 30_000, '2026-10-15', '2026-10-16')] })
  const row = only(result)
  assertBalanced(row)
  assert.equal(result.mismatchCount, 0)
  assert.equal(row.accruedCents, 30_000)
  assert.equal(row.collectedCents, 0)
  assert.equal(row.openingImportCents, 30_000)
  assert.equal(row.closingCents, 0)
  assert.equal(result.totals.openingImportCents, 30_000)
  assert.equal(result.totals.collectedCents, 0)
})

test('DOM-FIN-056 DOM-FIN-014: önceki yılın borcunu kapatan aktarım o yılın açılışından düşer', () => {
  const row = only(reconcile({ invoices: [imported('i1', 30_000, '2026-05-15', '2026-09-10')] }))
  assertBalanced(row)
  assert.equal(row.openingCents, 30_000)
  assert.equal(row.accruedCents, 0)
  assert.equal(row.openingImportCents, 30_000)
  assert.equal(row.closingCents, 0)
})

test('DOM-FIN-056 DOM-FIN-014: önceki yılda kapanmış aktarım bu yılda satır üretmez', () => {
  const result = reconcile({ invoices: [imported('i1', 30_000, '2026-05-15', '2026-05-16')] })
  assert.deepEqual(result.rows, [])
  assert.equal(result.totals.openingImportCents, 0)
})

test('DOM-FIN-056 DOM-FIN-030: vadesinden önce aktarılan ödeme tahsilat gibi avanstır', () => {
  // Önceki yılda ödenip bu yılda vadesi gelen: açılıştaki alacak tahakkukla kapanır.
  const carried = only(
    reconcile({ invoices: [imported('i1', 30_000, '2026-10-15', '2026-08-20')] }),
  )
  assertBalanced(carried)
  assert.equal(carried.openingCents, -30_000)
  assert.equal(carried.openingImportCents, 0)
  assert.equal(carried.closingCents, 0)

  // Bu yılda ödenip vadesi dönem sonrasında olan: kapanışa alacak kalır, tahakkuk yazılmaz.
  const ahead = only(
    reconcile({
      invoices: [imported('i1', 30_000, '2027-05-15', '2026-09-10')],
      period: { from: '2026-09-01', to: '2027-03-31' },
    }),
  )
  assertBalanced(ahead)
  assert.equal(ahead.accruedCents, 0)
  assert.equal(ahead.openingImportCents, 30_000)
  assert.equal(ahead.creditCents, 30_000)
  assert.equal(ahead.closingCents, -30_000)
})

test('DOM-FIN-056 DOM-FIN-014: dönem sonrasındaki aktarım kapanışı değiştirmez, borç açık kalır', () => {
  const row = only(reconcile({ invoices: [imported('i1', 30_000, '2026-10-15', '2027-09-10')] }))
  assertBalanced(row)
  assert.equal(row.openingImportCents, 0)
  assert.equal(row.closingCents, 30_000)
  assert.equal(row.openDebtCents, 30_000)
})

test('DOM-FIN-056 DOM-FIN-014: aktarım gün sınırı Europe/Istanbul günüdür', () => {
  // 31 Ağustos 21:30Z İstanbul'da 1 Eylül'dür: açılışta değil, dönem hareketindedir.
  const row = only(
    reconcile({
      invoices: [
        invoice('i1', 30_000, '2026-05-15', {
          paidAt: '2026-08-31T21:30:00.000Z',
          method: OPENING_IMPORT_METHOD,
        }),
      ],
    }),
  )
  assertBalanced(row)
  assert.equal(row.openingCents, 30_000)
  assert.equal(row.openingImportCents, 30_000)
})

test('DOM-FIN-056 DOM-FIN-014: aktarım, gerçek tahsilat ve iptali birbirine karışmaz', () => {
  const result = reconcile({
    invoices: [
      imported('i1', 30_000, '2026-09-15', '2026-09-16'),
      invoice('i2', 50_000, '2026-10-15'),
    ],
    payments: [
      payment(20_000, '2026-10-20', { i2: 20_000 }, '2026-10-25'),
      payment(5_000, '2026-11-01', { i2: 5_000 }),
    ],
  })
  const row = only(result)
  assertBalanced(row)
  assert.equal(row.openingImportCents, 30_000)
  assert.equal(row.collectedCents, 25_000)
  assert.equal(row.reversedCents, 20_000)
  assert.equal(row.closingCents, 45_000)
})

test('DOM-FIN-056 DOM-FIN-014: aktarımlı taksitte ayrılış iadesi formülü bozmaz', () => {
  const row = only(
    reconcile({
      invoices: [imported('i1', 100_000, '2026-09-15', '2026-09-14')],
      contracts: [contract('k1', ['i1'])],
      withdrawals: [
        withdrawal({ paidCents: 100_000, refundCents: 25_000, refundPaidDate: '2026-11-01' }),
      ],
    }),
  )
  assertBalanced(row)
  assert.equal(row.openingImportCents, 100_000)
  assert.equal(row.withdrawalAdjustmentCents, 25_000)
  assert.equal(row.refundedCents, 25_000)
  assert.equal(row.closingCents, 0)
})

test('DOM-FIN-056: tahsilatsız ödenmiş taksit aktarım değilse tutmayan kalır', () => {
  const row = only(
    reconcile({
      invoices: [
        invoice('legacy', 30_000, '2026-10-15', {
          paidAt: '2026-10-16T09:00:00.000Z',
          method: 'Banka havalesi',
        }),
      ],
    }),
  )
  assert.equal(row.openingImportCents, 0)
  assert.equal(row.differenceCents, -30_000)
  assert.equal(row.mismatchReason, 'unrecorded_payment')
})

test('DOM-FIN-056 DOM-FIN-014: aktarımlı taksite tahsilat da dağıtılmışsa tutmaz, incelenir', () => {
  const row = only(
    reconcile({
      invoices: [imported('i1', 30_000, '2026-10-15', '2026-10-16')],
      payments: [payment(10_000, '2026-10-16', { i1: 10_000 })],
    }),
  )
  assert.equal(row.differenceCents, 10_000)
  assert.equal(row.mismatchReason, 'other')
})

test('DOM-FIN-056: gün sınırı Europe/Istanbul günüdür', () => {
  // 31 Ağustos 21:30 UTC, İstanbul'da 1 Eylül'dür; dönemin ilk gününe düşer.
  const row = only(
    reconcile({
      invoices: [invoice('i1', 10_000, '2026-10-15')],
      payments: [
        {
          studentId: 's1',
          amountCents: 10_000,
          paidAt: '2026-08-31T21:30:00.000Z',
          reversedAt: null,
          allocations: [{ invoiceId: 'i1', amountCents: 10_000 }],
        },
      ],
    }),
  )
  assertBalanced(row)
  assert.equal(row.openingCents, 0)
  assert.equal(row.collectedCents, 10_000)
})

test('DOM-FIN-056: hareketsiz ve bakiyesiz öğrenci satır üretmez; satırlar ada göre sıralı', () => {
  const students = studentDirectory([
    { id: 's1', name: 'Zeynep', number: 1 },
    { id: 's2', name: 'Çağla', number: 2 },
    { id: 's3', name: 'Ali', number: 3 },
  ])
  const result = financeReconciliation({
    year: 2026,
    period: PERIOD,
    invoices: [
      invoice('z', 1_000, '2026-10-15'),
      invoice('c', 1_000, '2026-10-15', { studentId: 's2' }),
      invoice('later', 1_000, '2027-10-15', { studentId: 's3' }),
    ],
    payments: [],
    withdrawals: [],
    contracts: [],
    cancelledContractIds: new Set(),
    students,
  })
  assert.deepEqual(
    result.rows.map((row) => row.studentName),
    ['Çağla', 'Zeynep'],
  )
  assert.equal(result.studentCount, 2)
  assert.equal(result.totals.accruedCents, 2_000)
})

test('IST-111: mutabakat toplamları aynı dönemin aktarım toplamlarına eşittir', () => {
  const invoices = [
    invoice('i1', 100_000, '2026-09-15', { paidAt: '2026-09-15T09:00:00.000Z' }),
    invoice('i2', 40_000, '2026-10-15'),
    invoice('outside', 900, '2026-05-15'),
  ]
  const payments = [
    payment(100_000, '2026-09-15', { i1: 100_000 }),
    payment(15_000, '2026-10-16', { i2: 15_000 }, '2026-10-20'),
    payment(900, '2026-06-15', { outside: 900 }, '2026-09-02'),
  ]
  const withdrawals = [
    withdrawal({ paidCents: 100_000, refundCents: 25_000, refundPaidDate: '2026-11-01' }),
  ]
  const result = reconcile({ invoices, payments, withdrawals, contracts: [contract('k1', ['i1'])] })
  const exportPayments = payments.map((item, index) => ({
    ...item,
    method: 'Banka havalesi',
    reference: null,
    receiptYear: 2026,
    receiptNumber: index + 1,
  }))
  const summary = financeSummary(
    paymentLines(exportPayments, directory, PERIOD),
    refundLines(
      [
        {
          studentId: 's1',
          withdrawalDate: '2026-10-01',
          refundCents: 25_000,
          refundPaidDate: '2026-11-01',
          maskedIban: null,
          accountHolder: null,
        },
      ],
      directory,
      PERIOD,
    ),
    invoiceLines(invoices, new Map(), directory, PERIOD),
  )
  assert.equal(
    result.totals.collectedCents - result.totals.reversedCents,
    summary.payments.totalCents,
  )
  assert.equal(result.totals.refundedCents, summary.refunds.totalCents)
  assert.equal(result.totals.accruedCents, summary.invoices.totalCents)
})

const ROW: ReconciliationRow = {
  studentId: 's1',
  studentName: '=KOMUT()',
  studentNumber: '712',
  openingCents: 1_000,
  accruedCents: 200_050,
  withdrawalAdjustmentCents: 0,
  collectedCents: 150_000,
  openingImportCents: 0,
  reversedCents: 0,
  refundedCents: 0,
  scholarshipCents: 5_000,
  discountCents: 3_000,
  closingCents: -2_500,
  expectedClosingCents: -2_500,
  differenceCents: 0,
  openDebtCents: 0,
  creditCents: 2_500,
  mismatchReason: null,
}

test('IST-111 DOM-FIN-014: aktarım varken de toplamlar aynı dönemin aktarım toplamlarına eşittir', () => {
  const invoices = [
    imported('i1', 30_000, '2026-09-15', '2026-09-16'),
    invoice('i2', 40_000, '2026-10-15'),
  ]
  const payments = [payment(10_000, '2026-10-16', { i2: 10_000 })]
  const result = reconcile({ invoices, payments })
  const summary = financeSummary(
    paymentLines(
      payments.map((item, index) => ({
        ...item,
        method: 'Banka havalesi',
        reference: null,
        receiptYear: 2026,
        receiptNumber: index + 1,
      })),
      directory,
      PERIOD,
    ),
    [],
    invoiceLines(invoices, new Map(), directory, PERIOD),
  )
  assert.equal(result.mismatchCount, 0)
  assert.equal(result.totals.collectedCents, summary.payments.totalCents)
  assert.equal(result.totals.accruedCents, summary.invoices.totalCents)
  assert.equal(result.totals.openingImportCents, summary.invoices.openingImportCents)
})

test('IST-111: standart dosyada formül kaçışı, ondalık virgül ve eksi tutar', () => {
  const [header, line] = profiledReconciliationCsv([ROW], null).split('\r\n')
  assert.ok(header?.startsWith('"Öğrenci";"Okul no";"Açılış (₺)"'))
  assert.ok(header?.endsWith('"Denetim"'))
  assert.ok(
    line?.startsWith(`"'=KOMUT()";"712";10,00;2000,50;0,00;1500,00;0,00;0,00;0,00;50,00;30,00;`),
  )
  assert.ok(line?.includes(';-25,00;-25,00;0,00;"Tutuyor"'))
})

test('DOM-FIN-056 DOM-FIN-014: dosyada açılış aktarımı tahsilatın yanında ayrı sütundur', () => {
  const [header, line] = profiledReconciliationCsv(
    [{ ...ROW, openingImportCents: 12_345 }],
    null,
  ).split('\r\n')
  const headers = header?.split(';') ?? []
  const index = headers.indexOf('"Açılış aktarımı (₺)"')
  assert.equal(headers[index - 1], '"Tahsilat (₺)"')
  assert.equal(line?.split(';')[index], '123,45')
})

test('DOM-FIN-055 DOM-FIN-014: açılış aktarımı profilde seçilebilir sütundur', () => {
  const profile = defaultFinanceExportProfile()
  assert.ok(profile.columns.reconciliation?.some((item) => item.source === 'openingImport'))
  const parsed = financeExportProfileSchema.safeParse({
    ...profile,
    columns: {
      ...profile.columns,
      reconciliation: [{ source: 'openingImport', header: 'Aktarım' }],
    },
  })
  assert.equal(parsed.success, true)
  assert.ok(parsed.success)
  const [header, line] = profiledReconciliationCsv(
    [{ ...ROW, openingImportCents: 500 }],
    parsed.data,
  ).split('\r\n')
  assert.equal(header, '"Aktarım"')
  assert.equal(line, '5,00')
})

test('DOM-FIN-056: tutmayan satırın nedeni dosyada yazılır', () => {
  const body = profiledReconciliationCsv(
    [{ ...ROW, differenceCents: -100, mismatchReason: 'other' }],
    null,
  )
  assert.ok(body.includes('"Tutmuyor: Kayıtlar incelenmeli"'))
})

test('DOM-FIN-055: profil biçimi ve sütunları mutabakat dosyasına uygulanır, tutar değişmez', () => {
  const profile = financeExportProfileSchema.parse({
    ...defaultFinanceExportProfile(),
    separator: ',',
    decimal: '.',
    columns: {
      ...defaultFinanceExportProfile().columns,
      reconciliation: [
        { source: 'studentNumber', header: 'No' },
        { source: 'fixed', header: 'Hesap kodu', value: '120.01' },
        { source: 'closing', header: 'Bakiye' },
      ],
    },
  })
  assert.equal(
    profiledReconciliationCsv([ROW], profile),
    '"No","Hesap kodu","Bakiye"\r\n"712","120.01",-25.00',
  )
})

test('DOM-FIN-055: mutabakat sütunu olmayan eski profil geçerlidir, biçimi korunur', () => {
  const { reconciliation, ...oldColumns } = defaultFinanceExportProfile().columns
  assert.ok(reconciliation)
  const old = financeExportProfileSchema.parse({
    ...defaultFinanceExportProfile(),
    separator: '\t',
    columns: oldColumns,
  })
  assert.equal(old.columns.reconciliation, undefined)
  const [header] = profiledReconciliationCsv([ROW], old).split('\r\n')
  assert.ok(header?.startsWith('"Öğrenci"\t"Okul no"'))
})

test('DOM-FIN-055: mutabakat sütununda dosyada olmayan kaynak reddedilir', () => {
  const result = financeExportProfileSchema.safeParse({
    ...defaultFinanceExportProfile(),
    columns: {
      ...defaultFinanceExportProfile().columns,
      reconciliation: [{ source: 'hesapKodu', header: 'Hesap kodu' }],
    },
  })
  assert.equal(result.success, false)
})
