import assert from 'node:assert/strict'
import test from 'node:test'

import {
  statementLineLabel,
  studentStatement,
  type StatementInvoice,
  type StatementPayment,
  type StatementWithdrawal,
} from '../packages/school-core/src/lib/finance-statement.ts'

const TODAY = '2026-11-20'
const invoice = (installment: number, overrides: Partial<StatementInvoice> = {}) => ({
  id: `inv-${String(installment)}`,
  installment,
  amount: 10_000,
  paidAt: null,
  dueDate: `2026-${String(9 + installment)}-15T09:00:00.000Z`,
  ...overrides,
})
const payment = (
  id: string,
  allocations: StatementPayment['allocations'],
  overrides: Partial<StatementPayment> = {},
): StatementPayment => ({
  id,
  amountCents: allocations.reduce((sum, item) => sum + item.amountCents, 0),
  method: 'Banka havalesi',
  reference: `TR-${id}`,
  paidAt: '2026-10-10T09:00:00.000Z',
  receiptYear: 2026,
  receiptNumber: 1,
  reversedAt: null,
  allocations,
  ...overrides,
})

/**
 * IST-107 kabul ölçütü: her ekstrede toplamlar birbirini ve bakiyeyi tutar. Ödenmemiş ayrılış iadesi
 * kurumun öğrenciye borcudur; bakiye açık tutardan bu kadar aşağıdadır (DOM-FIN-054).
 */
function assertConsistent(statement: ReturnType<typeof studentStatement>) {
  const balance = statement.openCents - statement.refundDueCents
  assert.equal(statement.debitTotalCents - statement.creditTotalCents, balance)
  assert.equal(statement.lines.at(-1)?.balanceCents ?? 0, balance)
  assert.equal(statement.totalCents - statement.paidCents, statement.openCents)
}

const withdrawal = (overrides: Partial<StatementWithdrawal> = {}): StatementWithdrawal => ({
  id: 'w1',
  withdrawalDate: '2026-11-01',
  refundCents: 0,
  refundPaidDate: null,
  creditCents: 0,
  ...overrides,
})

test('IST-107: boş ekstre sıfırdır', () => {
  const statement = studentStatement('s1', [], [], TODAY)
  assert.deepEqual(statement.lines, [])
  assert.equal(statement.openCents, 0)
  assert.equal(statement.unappliedCents, 0)
})

test('IST-107: borç ve kısmi tahsilat tarih sırasıyla yürüyen bakiye verir', () => {
  const statement = studentStatement(
    's1',
    [invoice(1), invoice(2)],
    [
      payment('p2', [{ invoiceId: 'inv-1', amountCents: 6_000 }], {
        paidAt: '2026-11-01T09:00:00.000Z',
      }),
    ],
    TODAY,
  )
  assert.deepEqual(
    statement.lines.map((line) => [line.kind, line.date, line.balanceCents]),
    [
      ['installment', '2026-10-15', 10_000],
      ['payment', '2026-11-01', 4_000],
      ['installment', '2026-11-15', 14_000],
    ],
  )
  const [first, , second] = statement.lines
  assert.equal(first?.openCents, 4_000)
  assert.equal(first?.isOverdue, true)
  assert.equal(second?.openCents, 10_000)
  assert.equal(statement.overdueCents, 14_000)
  assert.equal(statement.overdueCount, 2)
  assertConsistent(statement)
})

test('IST-107: gelecek vade gecikmiş sayılmaz, tam ödenen taksit açık kalmaz', () => {
  const statement = studentStatement(
    's1',
    [invoice(1, { paidAt: '2026-10-10T09:00:00.000Z' }), invoice(3)],
    [payment('p1', [{ invoiceId: 'inv-1', amountCents: 10_000 }])],
    TODAY,
  )
  const lines = statement.lines.filter((line) => line.kind === 'installment')
  assert.deepEqual(
    lines.map((line) => [line.openCents, line.isOverdue]),
    [
      [0, false],
      [10_000, false],
    ],
  )
  assert.equal(statement.lines.filter((line) => line.kind === 'legacy_payment').length, 0)
  assertConsistent(statement)
})

test('DOM-FIN-033: iptal edilen tahsilat ters kayıtla kalır, bakiyeyi geri getirir', () => {
  const statement = studentStatement(
    's1',
    [invoice(1)],
    [
      payment('p1', [{ invoiceId: 'inv-1', amountCents: 10_000 }], {
        reversedAt: '2026-10-20T09:00:00.000Z',
      }),
    ],
    TODAY,
  )
  assert.deepEqual(
    statement.lines.map((line) => [
      line.kind,
      line.debitCents,
      line.creditCents,
      line.balanceCents,
    ]),
    [
      ['payment', 0, 10_000, -10_000],
      ['installment', 10_000, 0, 0],
      ['payment_reversal', 10_000, 0, 10_000],
    ],
  )
  assert.equal(statement.paidCents, 0)
  assert.equal(statement.openCents, 10_000)
  assertConsistent(statement)
})

test('IST-107: taksiti aşan tutar iade alacağıdır, bakiyeyi düşürmez', () => {
  const statement = studentStatement(
    's1',
    [invoice(1)],
    [payment('p1', [{ invoiceId: 'inv-1', amountCents: 10_000 }], { amountCents: 12_500 })],
    TODAY,
  )
  assert.equal(statement.unappliedCents, 2_500)
  assert.equal(statement.lines.find((line) => line.kind === 'payment')?.unappliedCents, 2_500)
  assert.equal(statement.openCents, 0)
  assertConsistent(statement)
})

test('IST-107: silinmiş taksite dağılan tutar borçtan düşmez, iade alacağına yazılır', () => {
  const statement = studentStatement(
    's1',
    [invoice(1)],
    [payment('p1', [{ invoiceId: 'silinmis', amountCents: 3_000 }])],
    TODAY,
  )
  assert.equal(statement.unappliedCents, 3_000)
  assert.equal(statement.openCents, 10_000)
  assertConsistent(statement)
})

test('IST-107: taksiti aşan dağılım iki tahsilatta da sınırlanır', () => {
  const statement = studentStatement(
    's1',
    [invoice(1)],
    [
      payment('p1', [{ invoiceId: 'inv-1', amountCents: 8_000 }]),
      payment('p2', [{ invoiceId: 'inv-1', amountCents: 8_000 }], {
        paidAt: '2026-10-11T09:00:00.000Z',
      }),
    ],
    TODAY,
  )
  assert.equal(statement.paidCents, 10_000)
  assert.equal(statement.unappliedCents, 6_000)
  assertConsistent(statement)
})

test('IST-107: tahsilat kaydı olmadan ödenmiş eski taksit alacak satırı açar', () => {
  const statement = studentStatement(
    's1',
    [invoice(1, { paidAt: '2026-10-12T09:00:00.000Z', method: 'Nakit' })],
    [],
    TODAY,
  )
  const legacy = statement.lines.find((line) => line.kind === 'legacy_payment')
  assert.equal(legacy?.creditCents, 10_000)
  assert.equal(legacy?.method, 'Nakit')
  assert.equal(legacy?.date, '2026-10-12')
  assert.equal(statement.openCents, 0)
  assertConsistent(statement)
})

test('IST-107: gün Europe/Istanbul ile yazılır; aynı gün önce borç gelir', () => {
  const statement = studentStatement(
    's1',
    [invoice(1)],
    [
      payment('p1', [{ invoiceId: 'inv-1', amountCents: 1_000 }], {
        paidAt: '2026-10-14T22:30:00.000Z',
      }),
    ],
    TODAY,
  )
  assert.deepEqual(
    statement.lines.map((line) => [line.kind, line.date]),
    [
      ['installment', '2026-10-15'],
      ['payment', '2026-10-15'],
    ],
  )
})

test('IST-107: satır açıklaması tür, yöntem ve dekont numarasını yazar', () => {
  const { lines } = studentStatement(
    's1',
    [invoice(1), invoice(2, { paidAt: '2026-10-12T09:00:00.000Z', method: 'Nakit' })],
    [
      payment('p1', [{ invoiceId: 'inv-1', amountCents: 1_000 }], {
        reversedAt: '2026-10-20T09:00:00.000Z',
        receiptNumber: 7,
      }),
    ],
    TODAY,
  )
  assert.deepEqual(lines.map(statementLineLabel), [
    'Tahsilat · Banka havalesi · Dekont 2026-7',
    '2. taksit ödemesi · Nakit',
    '1. taksit · Gecikmiş',
    'Tahsilat iptali · Dekont 2026-7',
    '2. taksit',
  ])
})

test('DOM-FIN-014: açılış aktarımı borcu kapatır, tahsilat ve dekont satırı yazmaz', () => {
  const opening = invoice(1, {
    paidAt: '2026-09-01T09:00:00.000Z',
    method: 'Açılış aktarımı',
  })
  const statement = studentStatement('s1', [opening, invoice(2)], [], TODAY)
  const line = statement.lines.find((item) => item.kind === 'opening_import')
  assert.ok(line)
  assert.equal(line.creditCents, opening.amount)
  assert.equal(line.receiptNumber, null)
  assert.equal(statementLineLabel(line), 'Açılış aktarımı · 1. taksit')
  assert.equal(statement.lines.filter((item) => item.kind === 'payment').length, 0)
  assert.equal(statement.lines.filter((item) => item.kind === 'legacy_payment').length, 0)
  assert.equal(statement.openingImportCents, opening.amount)
  assert.equal(statement.paidCents, opening.amount)
  assert.equal(statement.lines.at(-1)?.balanceCents, statement.openCents)
})

test('DOM-FIN-014: tahsilat kaydı olmayan eski taksit açılış aktarımı sayılmaz', () => {
  const legacy = invoice(1, { paidAt: '2026-09-01T09:00:00.000Z', method: 'Nakit' })
  const statement = studentStatement('s1', [legacy], [], TODAY)
  assert.equal(statement.lines.filter((item) => item.kind === 'legacy_payment').length, 1)
  assert.equal(statement.openingImportCents, 0)
})

test('IST-107, DOM-FIN-040: ayrılışta iptal edilen taksite alınan tutar iade hesabına girer, iade alacağı ayrıca yazılmaz', () => {
  // 2. taksit ayrılışta iptal edildi; ona alınan 3.000 hesaba girdi, hesap 1.000 iade çıkardı.
  const invoices = [invoice(1, { paidAt: '2026-10-10T09:00:00.000Z', method: 'Banka havalesi' })]
  const payments = [
    payment('p1', [{ invoiceId: 'inv-1', amountCents: 10_000 }]),
    payment('p2', [{ invoiceId: 'inv-iptal', amountCents: 3_000 }], {
      paidAt: '2026-10-20T09:00:00.000Z',
    }),
  ]
  const pending = studentStatement('s1', invoices, payments, TODAY, [
    withdrawal({ refundCents: 1_000 }),
  ])
  assert.equal(pending.unappliedCents, 0)
  assert.equal(pending.refundDueCents, 1_000)
  assert.equal(pending.openCents, 0)
  assert.deepEqual(
    pending.lines.map((line) => [line.kind, line.date, line.debitCents, line.creditCents]),
    [
      ['installment', '2026-10-15', 10_000, 0],
      ['payment', '2026-10-10', 0, 10_000],
      ['payment', '2026-10-20', 0, 3_000],
      ['withdrawal_settlement', '2026-11-01', 2_000, 0],
    ].sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
  )
  assert.equal(pending.lines.at(-1)?.balanceCents, -1_000)
  assertConsistent(pending)

  const paid = studentStatement('s1', invoices, payments, TODAY, [
    withdrawal({ refundCents: 1_000, refundPaidDate: '2026-11-10' }),
  ])
  const last = paid.lines.at(-1)
  assert.equal(last?.kind, 'refund_payment')
  assert.equal(last.debitCents, 1_000)
  assert.equal(last.balanceCents, 0)
  assert.equal(paid.refundDueCents, 0)
  assertConsistent(paid)
})

test('IST-107, DOM-FIN-054: ayrılışta mahsup edilen dağıtılmamış tutar alacak yazılır; sonraki fazla ödeme iade alacağı kalır', () => {
  const invoices = [
    invoice(1, { paidAt: '2026-10-10T09:00:00.000Z', method: 'Banka havalesi' }),
    invoice(2, { id: 'borc', amount: 1_000, dueDate: '2026-11-01T09:00:00.000Z' }),
  ]
  const payments = [
    payment('p1', [{ invoiceId: 'inv-1', amountCents: 10_000 }], { amountCents: 12_500 }),
    payment('p2', [{ invoiceId: 'borc', amountCents: 1_000 }], {
      amountCents: 1_500,
      paidAt: '2026-11-05T09:00:00.000Z',
    }),
  ]
  const statement = studentStatement('s1', invoices, payments, TODAY, [
    withdrawal({ refundCents: 2_500, creditCents: 2_500, refundPaidDate: '2026-11-03' }),
  ])
  const first = statement.lines.find((line) => line.paymentId === 'p1')
  assert.equal(first?.creditCents, 12_500)
  assert.equal(first.unappliedCents, 0)
  assert.equal(statement.unappliedCents, 500)
  assert.equal(statement.lines.filter((line) => line.kind === 'withdrawal_settlement').length, 0)
  assert.equal(statement.openCents, 0)
  assertConsistent(statement)
})

test('IST-107, DOM-FIN-041: ayrılışta kalan borç hesabı tutar; mahsup borç satırıdır', () => {
  const invoices = [
    invoice(1, { paidAt: '2026-10-10T09:00:00.000Z', method: 'Banka havalesi' }),
    invoice(3, { id: 'borc', amount: 1_000, dueDate: '2026-11-01T09:00:00.000Z' }),
  ]
  const payments = [
    payment('p1', [{ invoiceId: 'inv-1', amountCents: 10_000 }]),
    payment('p2', [{ invoiceId: 'inv-iptal', amountCents: 2_000 }], {
      paidAt: '2026-10-20T09:00:00.000Z',
    }),
  ]
  const statement = studentStatement('s1', invoices, payments, TODAY, [withdrawal()])
  const settlement = statement.lines.find((line) => line.kind === 'withdrawal_settlement')
  assert.equal(settlement?.debitCents, 2_000)
  assert.equal(statementLineLabel(settlement), 'Ayrılış hesabı · hak edilen ücret')
  assert.equal(statement.openCents, 1_000)
  assert.equal(statement.overdueCents, 1_000)
  assert.equal(statement.refundDueCents, 0)
  assert.equal(statement.unappliedCents, 0)
  assertConsistent(statement)
})

test('IST-107: ayrılış ve iade satırlarının açıklaması', () => {
  const { lines } = studentStatement(
    's1',
    [invoice(1, { paidAt: '2026-10-10T09:00:00.000Z', method: 'Nakit' })],
    [],
    TODAY,
    [withdrawal({ refundCents: 4_000, refundPaidDate: '2026-11-05' })],
  )
  assert.deepEqual(lines.map(statementLineLabel).slice(-2), [
    'Ayrılış hesabı · iade alacağı',
    'İade ödemesi',
  ])
})
