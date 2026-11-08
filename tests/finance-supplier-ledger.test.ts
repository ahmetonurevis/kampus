import assert from 'node:assert/strict'
import test from 'node:test'

import {
  checkSupplierInstallments,
  installmentState,
  normalizeInvoiceNumber,
  paymentInstructionCsv,
  planPaymentInstruction,
  planSupplierInvoice,
  planSupplierInvoiceCancel,
  planSupplierInvoicePlan,
  planSupplierPayment,
  planSupplierPaymentCancel,
  supplierInvoiceActions,
  supplierInvoiceAmounts,
  supplierInvoiceBalance,
  supplierStatement,
  type InstructionPayment,
  type SupplierInvoiceContext,
  type SupplierPaymentContext,
} from '../packages/school-core/src/lib/finance-supplier-ledger.ts'

import { isDomainError } from './support/domain-error.ts'

// Tedarikçi carisi ve ödeme planı (DOM-FIN-076; ON-143).

const ZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'
const SUPPLIER = '00000000-0000-4000-8000-0000000000a1'
const OTHER = '00000000-0000-4000-8000-0000000000a2'
const ORDER = '00000000-0000-4000-8000-0000000000b1'
const INSTALLMENT = '00000000-0000-4000-8000-0000000000c1'
const ACCOUNT = '00000000-0000-4000-8000-0000000000d1'
const TODAY = '2026-10-06'
const CONTEXT: SupplierInvoiceContext = {
  supplier: { id: SUPPLIER },
  numberTaken: false,
  today: TODAY,
}
const invoice = (overrides: Record<string, unknown> = {}) => ({
  supplierId: SUPPLIER,
  invoiceNumber: ' abc 2026 0001 ',
  invoiceDate: '2026-10-01',
  dueDate: '2026-10-31',
  amountCents: 120_000,
  amountIncludesVat: true,
  vatCents: 20_000,
  ...overrides,
})

test('DOM-FIN-076: KDV dahil ya da hariç tutardan net, KDV ve toplam', () => {
  assert.deepEqual(
    supplierInvoiceAmounts({ amountCents: 120_000, amountIncludesVat: true, vatCents: 20_000 }),
    { netCents: 100_000, vatCents: 20_000, grossCents: 120_000 },
  )
  assert.deepEqual(
    supplierInvoiceAmounts({ amountCents: 100_000, amountIncludesVat: false, vatCents: 20_000 }),
    { netCents: 100_000, vatCents: 20_000, grossCents: 120_000 },
  )
})

test('DOM-FIN-076: fatura numarası boşluksuz büyük harfle; tek vade tek taksit olur (K-161)', () => {
  assert.equal(normalizeInvoiceNumber(' gib 2026/01 '), 'GIB2026/01')
  const plan = planSupplierInvoice(invoice(), CONTEXT)
  assert.equal(plan.fields.invoiceNumber, 'ABC20260001')
  assert.deepEqual(plan.installments, [{ dueDate: '2026-10-31', amountCents: 120_000 }])
  assert.equal(plan.grossCents, 120_000)
  assert.equal(plan.orderOverrunConfirmed, false)
})

test('DOM-FIN-076: geçersiz fatura girdisi reddedilir', () => {
  assert.throws(() => planSupplierInvoice(invoice({ dueDate: undefined }), CONTEXT), ZodError)
  assert.throws(
    () =>
      planSupplierInvoice(
        invoice({ installments: [{ dueDate: '2026-10-31', amountCents: 120_000 }] }),
        CONTEXT,
      ),
    ZodError,
  )
  assert.throws(() => planSupplierInvoice(invoice({ vatCents: 120_000 }), CONTEXT), ZodError)
  assert.throws(() => planSupplierInvoice(invoice({ invoiceNumber: 'Ğ-1' }), CONTEXT), ZodError)
  assert.throws(() => planSupplierInvoice(invoice({ amountCents: 0 }), CONTEXT), ZodError)
  assert.throws(
    () => planSupplierInvoice(invoice({ invoiceDate: '2026-10-07' }), CONTEXT),
    isDomainError('supplier_invoice_date_in_future'),
  )
  assert.throws(
    () => planSupplierInvoice(invoice(), { ...CONTEXT, supplier: null }),
    isDomainError('supplier_invoice_supplier_not_found'),
  )
  assert.throws(
    () => planSupplierInvoice(invoice(), { ...CONTEXT, numberTaken: true }),
    isDomainError('supplier_invoice_number_exists', 'conflict'),
  )
})

test('DOM-FIN-076: ödeme planı toplamı faturaya eşit, vade fatura tarihinden önce olamaz; taksitler vade sırasında', () => {
  const plan = planSupplierInvoice(
    invoice({
      dueDate: undefined,
      installments: [
        { dueDate: '2026-12-01', amountCents: 60_000 },
        { dueDate: '2026-11-01', amountCents: 60_000 },
      ],
    }),
    CONTEXT,
  )
  assert.deepEqual(
    plan.installments.map((item) => item.dueDate),
    ['2026-11-01', '2026-12-01'],
  )
  const state = { grossCents: 120_000, invoiceDate: '2026-10-01' }
  assert.throws(
    () => checkSupplierInstallments([{ dueDate: '2026-11-01', amountCents: 100_000 }], state),
    isDomainError('supplier_invoice_plan_total_mismatch'),
  )
  assert.throws(
    () => checkSupplierInstallments([{ dueDate: '2026-09-30', amountCents: 120_000 }], state),
    isDomainError('supplier_invoice_installment_before_invoice'),
  )
})

test('DOM-FIN-076: siparişe bağlı fatura aynı tedarikçinin gönderilmiş siparişi; aşım açık onayla (K-162)', () => {
  const order = {
    supplierId: SUPPLIER,
    status: 'sent' as const,
    grossCents: 150_000,
    invoicedCents: 0,
  }
  const linked = (overrides: Record<string, unknown> = {}) =>
    invoice({ purchaseOrderId: ORDER, ...overrides })
  assert.equal(planSupplierInvoice(linked(), { ...CONTEXT, order }).orderOverrunConfirmed, false)
  assert.throws(
    () => planSupplierInvoice(linked(), { ...CONTEXT, order: null }),
    isDomainError('supplier_invoice_order_not_found'),
  )
  assert.throws(
    () => planSupplierInvoice(linked(), { ...CONTEXT, order: { ...order, supplierId: OTHER } }),
    isDomainError('supplier_invoice_order_supplier_mismatch'),
  )
  for (const status of ['draft', 'cancelled'] as const)
    assert.throws(
      () => planSupplierInvoice(linked(), { ...CONTEXT, order: { ...order, status } }),
      isDomainError('supplier_invoice_order_not_open'),
    )
  const over = { ...order, invoicedCents: 40_000 }
  assert.throws(
    () => planSupplierInvoice(linked(), { ...CONTEXT, order: over }),
    (error: unknown) =>
      isDomainError('supplier_invoice_exceeds_order_warning', 'conflict')(error) &&
      (error as Error).message.includes('100,00 ₺ aşıyor'),
  )
  assert.equal(
    planSupplierInvoice(linked({ confirmOverOrder: true }), { ...CONTEXT, order: over })
      .orderOverrunConfirmed,
    true,
  )
})

test('DOM-FIN-076: plan değişikliği ve iptal yalnız ödemesiz etkin faturada', () => {
  const state = {
    grossCents: 120_000,
    invoiceDate: '2026-10-01',
    cancelled: false,
    hasPayments: false,
  }
  const installments = [{ dueDate: '2026-11-01', amountCents: 120_000 }]
  assert.deepEqual(planSupplierInvoicePlan(state, { installments }), installments)
  assert.throws(
    () => planSupplierInvoicePlan({ ...state, hasPayments: true }, { installments }),
    isDomainError('supplier_invoice_plan_locked'),
  )
  assert.throws(
    () => planSupplierInvoicePlan({ ...state, cancelled: true }, { installments }),
    isDomainError('supplier_invoice_cancelled'),
  )
  assert.deepEqual(planSupplierInvoiceCancel(state, { reason: ' Yanlış giriş ' }), {
    reason: 'Yanlış giriş',
  })
  assert.throws(() => planSupplierInvoiceCancel(state, { reason: 'x' }), ZodError)
  assert.throws(
    () => planSupplierInvoiceCancel({ ...state, hasPayments: true }, { reason: 'Yanlış giriş' }),
    isDomainError('supplier_invoice_has_payments'),
  )
  assert.deepEqual(
    supplierInvoiceActions({ cancelled: false, hasPayments: true, remainingCents: 1 }),
    {
      pay: true,
      replan: false,
      cancel: false,
    },
  )
})

const PAYMENT_CONTEXT: SupplierPaymentContext = {
  installment: {
    amountCents: 60_000,
    paidCents: 20_000,
    invoiceDate: '2026-10-01',
    invoiceCancelled: false,
  },
  bankAccountIds: [ACCOUNT],
  dayClosed: false,
  today: TODAY,
}
const payment = (overrides: Record<string, unknown> = {}) => ({
  installmentId: INSTALLMENT,
  paidDate: TODAY,
  amountCents: 40_000,
  method: 'eft',
  bankAccountId: ACCOUNT,
  ...overrides,
})

test('DOM-FIN-076: ödeme taksitin kalanını aşamaz; kısmi ödeme olur', () => {
  assert.equal(
    planSupplierPayment(payment({ amountCents: 10_000 }), PAYMENT_CONTEXT).amountCents,
    10_000,
  )
  assert.equal(planSupplierPayment(payment(), PAYMENT_CONTEXT).description, null)
  assert.throws(
    () => planSupplierPayment(payment({ amountCents: 40_001 }), PAYMENT_CONTEXT),
    (error: unknown) =>
      isDomainError('supplier_payment_exceeds_installment')(error) &&
      (error as Error).message.includes('400,00'),
  )
  assert.throws(
    () =>
      planSupplierPayment(payment(), {
        ...PAYMENT_CONTEXT,
        installment: { ...PAYMENT_CONTEXT.installment!, paidCents: 60_000 },
      }),
    isDomainError('supplier_payment_exceeds_installment'),
  )
})

test('DOM-FIN-076: ödeme yöntemi, banka hesabı ve gün denetimi', () => {
  assert.throws(
    () => planSupplierPayment(payment({ bankAccountId: null }), PAYMENT_CONTEXT),
    ZodError,
  )
  assert.throws(() => planSupplierPayment(payment({ method: 'cash' }), PAYMENT_CONTEXT), ZodError)
  assert.equal(
    planSupplierPayment(payment({ method: 'cash', bankAccountId: null }), PAYMENT_CONTEXT).method,
    'cash',
  )
  assert.throws(
    () => planSupplierPayment(payment({ bankAccountId: OTHER }), PAYMENT_CONTEXT),
    isDomainError('supplier_payment_bank_account_not_found'),
  )
  assert.throws(
    () => planSupplierPayment(payment({ paidDate: '2026-10-07' }), PAYMENT_CONTEXT),
    isDomainError('supplier_payment_date_in_future'),
  )
  assert.throws(
    () => planSupplierPayment(payment({ paidDate: '2026-09-30' }), PAYMENT_CONTEXT),
    isDomainError('supplier_payment_before_invoice'),
  )
  assert.throws(
    () => planSupplierPayment(payment(), { ...PAYMENT_CONTEXT, installment: null }),
    isDomainError('supplier_payment_installment_not_found'),
  )
  assert.throws(
    () =>
      planSupplierPayment(payment(), {
        ...PAYMENT_CONTEXT,
        installment: { ...PAYMENT_CONTEXT.installment!, invoiceCancelled: true },
      }),
    isDomainError('supplier_invoice_cancelled'),
  )
})

test('DOM-FIN-076, DOM-FIN-036: kapalı güne nakit ödeme yazılmaz, ödeme günü kapalı nakit ödeme iptal edilmez (K-166, K-190)', () => {
  const closed = { ...PAYMENT_CONTEXT, dayClosed: true }
  assert.throws(
    () => planSupplierPayment(payment({ method: 'cash', bankAccountId: null }), closed),
    isDomainError('finance_day_closed'),
  )
  assert.equal(planSupplierPayment(payment(), closed).method, 'eft')
  assert.throws(
    () =>
      planSupplierPaymentCancel(
        { cancelled: false, method: 'cash' },
        { reason: 'Hatalı tutar' },
        true,
      ),
    isDomainError('finance_day_closed'),
  )
  // Ödeme günü açıksa nakit iptal gün sonundan düşer; bugünün kapalı olmasına bakılmaz.
  assert.deepEqual(
    planSupplierPaymentCancel(
      { cancelled: false, method: 'cash' },
      { reason: 'Hatalı tutar' },
      false,
    ),
    { reason: 'Hatalı tutar' },
  )
  assert.deepEqual(
    planSupplierPaymentCancel(
      { cancelled: false, method: 'transfer' },
      { reason: 'Hatalı tutar' },
      true,
    ),
    { reason: 'Hatalı tutar' },
  )
  assert.throws(
    () =>
      planSupplierPaymentCancel(
        { cancelled: true, method: 'eft' },
        { reason: 'Hatalı tutar' },
        false,
      ),
    isDomainError('supplier_payment_cancelled'),
  )
})

test('DOM-FIN-076: taksit ve fatura durumu; vade günü vadesi geçmiş sayılmaz', () => {
  assert.equal(
    installmentState({ dueDate: TODAY, amountCents: 10, paidCents: 0 }, TODAY).overdue,
    false,
  )
  assert.equal(
    installmentState({ dueDate: '2026-10-05', amountCents: 10, paidCents: 5 }, TODAY)
      .remainingCents,
    5,
  )
  const items = [
    { dueDate: '2026-10-01', amountCents: 50_000, paidCents: 20_000 },
    { dueDate: '2026-11-01', amountCents: 70_000, paidCents: 0 },
  ]
  assert.deepEqual(
    supplierInvoiceBalance({ grossCents: 120_000, cancelled: false }, items, TODAY),
    {
      paidCents: 20_000,
      remainingCents: 100_000,
      overdueCents: 30_000,
      nextDueDate: '2026-10-01',
      status: 'overdue',
    },
  )
  assert.equal(
    supplierInvoiceBalance({ grossCents: 120_000, cancelled: false }, items, '2026-09-30').status,
    'partially_paid',
  )
  const paid = items.map((item) => ({ ...item, paidCents: item.amountCents }))
  assert.equal(
    supplierInvoiceBalance({ grossCents: 120_000, cancelled: false }, paid, TODAY).status,
    'paid',
  )
  assert.equal(
    supplierInvoiceBalance(
      { grossCents: 120_000, cancelled: false },
      items.map((i) => ({ ...i, paidCents: 0 })),
      '2026-09-01',
    ).status,
    'open',
  )
  assert.equal(
    supplierInvoiceBalance({ grossCents: 1, cancelled: true }, [], TODAY).status,
    'cancelled',
  )
})

test('DOM-FIN-076: ekstre fatura, ödeme ve iptalleri günlerine yazar, bakiye yürür', () => {
  const movements = supplierStatement(
    [
      {
        id: 'i1',
        invoiceNumber: 'A1',
        invoiceDate: '2026-10-01',
        grossCents: 100,
        createdAt: '2026-10-01T08:00:00.000Z',
        cancelledAt: null,
      },
      {
        id: 'i2',
        invoiceNumber: 'A2',
        invoiceDate: '2026-10-02',
        grossCents: 50,
        createdAt: '2026-10-02T08:00:00.000Z',
        cancelledAt: '2026-10-03T22:00:00.000Z',
      },
    ],
    [
      {
        id: 'p1',
        invoiceId: 'i1',
        invoiceNumber: 'A1',
        paidDate: '2026-10-02',
        amountCents: 30,
        method: 'eft',
        createdAt: '2026-10-02T09:00:00.000Z',
        cancelledAt: '2026-10-05T09:00:00.000Z',
      },
      {
        id: 'p2',
        invoiceId: 'i1',
        invoiceNumber: 'A1',
        paidDate: '2026-10-05',
        amountCents: 70,
        method: 'cash',
        createdAt: '2026-10-05T09:00:00.000Z',
        cancelledAt: null,
      },
    ],
  )
  assert.deepEqual(
    movements.map((m) => [m.kind, m.date, m.debitCents, m.creditCents, m.balanceCents]),
    [
      ['invoice', '2026-10-01', 100, 0, 100],
      ['invoice', '2026-10-02', 50, 0, 150],
      ['payment', '2026-10-02', 0, 30, 120],
      // 22.00 UTC İstanbul'da ertesi gündür.
      ['invoice_cancel', '2026-10-04', 0, 50, 70],
      ['payment', '2026-10-05', 0, 70, 0],
      ['payment_cancel', '2026-10-05', 30, 0, 30],
    ],
  )
})

const instruction = (overrides: Partial<InstructionPayment> = {}): InstructionPayment => ({
  id: INSTALLMENT,
  method: 'transfer',
  cancelled: false,
  exported: false,
  supplierName: 'Alfa Bilişim A.Ş.',
  iban: 'TR330006100519786457841326',
  amountCents: 123_456,
  paidDate: TODAY,
  description: '=Fatura A1 ödemesi',
  sourceIban: 'TR320010009999901234567890',
  ...overrides,
})

test('DOM-FIN-076: talimat dosyası yalnız etkin havale/EFT ve IBAN’lı tedarikçi; yeniden alma açık onayla (K-164, K-165)', () => {
  const input = { paymentIds: [INSTALLMENT, INSTALLMENT] }
  assert.equal(planPaymentInstruction(input, [instruction()]).payments.length, 1)
  assert.throws(() => planPaymentInstruction({ paymentIds: [] }, []), ZodError)
  assert.throws(
    () => planPaymentInstruction(input, []),
    isDomainError('supplier_payment_not_found'),
  )
  assert.throws(
    () => planPaymentInstruction(input, [instruction({ cancelled: true })]),
    isDomainError('supplier_payment_cancelled'),
  )
  assert.throws(
    () => planPaymentInstruction(input, [instruction({ method: 'cheque' })]),
    isDomainError('supplier_payment_instruction_method'),
  )
  assert.throws(
    () => planPaymentInstruction(input, [instruction({ iban: null })]),
    (error: unknown) =>
      isDomainError('supplier_payment_instruction_iban_missing')(error) &&
      (error as Error).message.includes('Alfa Bilişim'),
  )
  assert.throws(
    () => planPaymentInstruction(input, [instruction({ exported: true })]),
    isDomainError('supplier_payment_instruction_exported_warning', 'conflict'),
  )
  assert.equal(
    planPaymentInstruction({ ...input, confirmReexport: true }, [instruction({ exported: true })])
      .reexported,
    true,
  )
})

test('DOM-FIN-076: talimat CSV’si ; ayırıcılı, ondalık virgüllü, IBAN açık ve formül kaçışlı', () => {
  assert.equal(
    paymentInstructionCsv([instruction()]),
    [
      '"Alıcı unvanı";"Alıcı IBAN";"Tutar";"Para birimi";"Açıklama";"Ödeme günü";"Gönderen IBAN"',
      `"Alfa Bilişim A.Ş.";"TR330006100519786457841326";1234,56;"TRY";"'=Fatura A1 ödemesi";"${TODAY}";"TR320010009999901234567890"`,
    ].join('\r\n'),
  )
})
