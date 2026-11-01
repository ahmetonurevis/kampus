import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { csvAmount, csvCell } from '../packages/school-core/src/lib/csv.ts'
import {
  assertFinancePeriod,
  financeSummary,
  financeTotals,
  invoiceLines,
  invoicesCsv,
  paymentLines,
  paymentsCsv,
  refundLines,
  refundsCsv,
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
  assert.deepEqual(summary, { count: 3, totalCents: 30_000, paidCents: 12_500 })
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
    remainingCents: 16_500,
    overdueCents: 7_500,
  })
})
