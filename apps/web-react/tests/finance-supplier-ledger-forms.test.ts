import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  evenInstallments,
  installmentsTotalCents,
  instructionEligible,
  invoiceBody,
  invoiceDefaults,
  invoiceFormField,
  invoiceFormSchema,
  invoiceGrossCents,
  invoiceLinesNetCents,
  invoiceNetCents,
  MATCH_STATUS_VIEW,
  orderLineRows,
  paymentBody,
  paymentDefaults,
  paymentFormField,
  paymentFormSchema,
} from '../src/pages/finance/finance-supplier-ledger-forms.ts'

// ON-143 (DOM-FIN-076): tedarikçi faturası, ödeme planı ve ödeme formu modeli.

const SUPPLIER = '00000000-0000-4000-8000-0000000000a1'

test('DOM-FIN-076: eşit aylık taksit önerisi kuruş artığını son taksite, ay sonunu ayın son gününe yazar', () => {
  assert.deepEqual(evenInstallments(100_000, 3, '2026-01-31'), [
    { dueDate: '2026-01-31', amount: '333,33' },
    { dueDate: '2026-02-28', amount: '333,33' },
    { dueDate: '2026-03-31', amount: '333,34' },
  ])
  assert.deepEqual(evenInstallments(100, 0, '2026-01-01'), [])
  assert.equal(
    installmentsTotalCents([{ amount: '333,33' }, { amount: '1.000' }, { amount: 'x' }]),
    133_333,
  )
})

test('DOM-FIN-076: fatura formu tek vade ya da plan gövdesi üretir; KDV hariç tutara KDV eklenir', () => {
  const values = {
    ...invoiceDefaults('2026-10-06'),
    supplierId: SUPPLIER,
    invoiceNumber: 'A-1',
    amount: '1.000',
    amountIncludesVat: 'false' as const,
    vat: '200',
    dueDate: '2026-10-31',
  }
  assert.equal(invoiceFormSchema.safeParse(values).success, true)
  assert.equal(invoiceGrossCents(values), 120_000)
  assert.deepEqual(invoiceBody(values), {
    supplierId: SUPPLIER,
    invoiceNumber: 'A-1',
    invoiceDate: '2026-10-06',
    amountCents: 100_000,
    amountIncludesVat: false,
    vatCents: 20_000,
    purchaseOrderId: null,
    note: null,
    dueDate: '2026-10-31',
  })
  const planned = invoiceBody(
    {
      ...values,
      planMode: 'plan',
      installments: [
        { dueDate: '2026-11-01', amount: '600' },
        { dueDate: '2026-12-01', amount: '600' },
      ],
    },
    true,
  )
  assert.deepEqual(planned.installments, [
    { dueDate: '2026-11-01', amountCents: 60_000 },
    { dueDate: '2026-12-01', amountCents: 60_000 },
  ])
  assert.equal('dueDate' in planned, false)
  assert.equal(planned.confirmOverOrder, true)
})

test('DOM-FIN-076: fatura formu vadesiz, boş planlı ve KDV’si tutarı aşan girişi reddeder', () => {
  const base = {
    ...invoiceDefaults('2026-10-06'),
    supplierId: SUPPLIER,
    invoiceNumber: 'A-1',
    amount: '100',
  }
  const issues = (values: object) =>
    invoiceFormSchema.safeParse(values).error?.issues.map((issue) => issue.path.join('.')) ?? []
  assert.deepEqual(issues(base), ['dueDate'])
  assert.deepEqual(issues({ ...base, planMode: 'plan' }), ['installments.root'])
  assert.deepEqual(issues({ ...base, dueDate: '2026-10-31', vat: '100' }), ['vat'])
  assert.equal(invoiceFormField('amountCents'), 'amount')
  assert.equal(invoiceFormField('installments.2.amountCents'), 'installments.2.amount')
  assert.equal(invoiceFormField('installments'), 'root.installments')
  assert.equal(invoiceFormField('unknown'), undefined)
})

test('DOM-FIN-076: ödeme formu kalanı önerir; nakitte hesap gönderilmez, banka ödemesinde zorunlu', () => {
  const defaults = paymentDefaults({ id: 'i1', remainingCents: 12_345 }, '2026-10-06', 'b1')
  assert.equal(defaults.amount, '123,45')
  assert.deepEqual(paymentBody({ ...defaults, method: 'cash' }), {
    installmentId: 'i1',
    paidDate: '2026-10-06',
    amountCents: 12_345,
    method: 'cash',
    bankAccountId: null,
    description: null,
  })
  assert.equal(paymentFormSchema.safeParse({ ...defaults, bankAccountId: '' }).success, false)
  assert.equal(
    paymentFormSchema.safeParse({ ...defaults, method: 'cash', bankAccountId: '' }).success,
    true,
  )
  assert.equal(paymentFormField('amountCents'), 'amount')
  assert.equal(paymentFormField('bankAccountId'), 'bankAccountId')
  assert.equal(instructionEligible({ method: 'eft', cancelledAt: null }), true)
  assert.equal(instructionEligible({ method: 'cheque', cancelledAt: null }), false)
  assert.equal(instructionEligible({ method: 'transfer', cancelledAt: '2026-10-06' }), false)
})

const ORDER = '00000000-0000-4000-8000-0000000000b1'
const ITEM = '00000000-0000-4000-8000-0000000000e1'

test('DOM-FIN-095: siparişe bağlı fatura kalem ister; kalemler sipariş kaleminden önerilir ve gövdeye kuruşla girer (K-280)', () => {
  const base = {
    ...invoiceDefaults('2026-10-06'),
    supplierId: SUPPLIER,
    invoiceNumber: 'A-1',
    amount: '1.200',
    vat: '200',
    dueDate: '2026-10-31',
    purchaseOrderId: ORDER,
  }
  const issues = (values: object) =>
    invoiceFormSchema.safeParse(values).error?.issues.map((issue) => issue.path.join('.')) ?? []
  assert.deepEqual(issues(base), ['lines.root'])
  const lines = orderLineRows([{ id: ITEM, quantity: 5, unitPriceCents: 20_000 }])
  assert.deepEqual(lines, [
    { orderItemId: ITEM, description: '', quantity: '5', unitPrice: '200,00' },
  ])
  assert.equal(invoiceLinesNetCents(lines), 100_000)
  assert.equal(invoiceNetCents(base), 100_000)
  assert.equal(invoiceNetCents({ ...base, amountIncludesVat: 'false' }), 120_000)
  const extra = { orderItemId: '', description: ' Kargo ', quantity: '1', unitPrice: '50' }
  const values = { ...base, lines: [...lines, extra] }
  assert.deepEqual(issues(values), [])
  assert.deepEqual(invoiceBody(values).lines, [
    { orderItemId: ITEM, description: null, quantity: 5, unitPriceCents: 20_000 },
    { orderItemId: null, description: 'Kargo', quantity: 1, unitPriceCents: 5_000 },
  ])
  assert.equal('lines' in invoiceBody({ ...values, purchaseOrderId: '' }), false)
  assert.deepEqual(issues({ ...base, lines: [...lines, ...lines] }), ['lines.1.orderItemId'])
  assert.deepEqual(issues({ ...base, lines: [{ ...extra, description: 'x' }] }), [
    'lines.0.description',
  ])
  assert.deepEqual(issues({ ...base, lines: [{ ...lines[0], quantity: '1,5' }] }), [
    'lines.0.quantity',
  ])
  assert.deepEqual(issues({ ...base, lines: [{ ...lines[0], unitPrice: '0' }] }), [
    'lines.0.unitPrice',
  ])
  assert.equal(invoiceFormField('lines.1.unitPriceCents'), 'lines.1.unitPrice')
  assert.equal(invoiceFormField('lines.0.orderItemId'), 'lines.0.orderItemId')
  assert.equal(invoiceFormField('lines.0.bilinmeyen'), undefined)
  assert.equal(invoiceFormField('lines'), 'root.lines')
  assert.deepEqual(
    [MATCH_STATUS_VIEW.matched.tone, MATCH_STATUS_VIEW.price_mismatch.tone],
    ['green', 'amber'],
  )
})
