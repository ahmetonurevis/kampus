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
