import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed } from '../packages/school-core/src/data/seed.ts'
import {
  amountInputValue,
  openAmount,
  parseAmountInput,
  paymentFormSchema,
  planPayment,
  reversePayment,
  type PaymentContext,
} from '../packages/school-core/src/lib/payments.ts'
import { isDomainError } from './support/domain-error.ts'

const NOW = '2026-10-06T09:00:00.000Z'

function fixture() {
  const state = createSeed(new Date(NOW))
  const student = state.students[0]!
  state.invoices = [2, 1, 3].map((installment) => ({
    id: `test-inv-${installment}`,
    studentId: student.id,
    installment,
    amount: 10_000,
    dueDate: `2026-1${installment - 1}-15T09:00:00.000Z`,
    paidAt: null,
    method: null,
    reminderAt: null,
  }))
  return { state, studentId: student.id }
}
const context = (overrides: Partial<PaymentContext> = {}): PaymentContext => ({
  allocated: new Map(),
  cashEnabled: false,
  referenceInUse: false,
  now: NOW,
  ...overrides,
})
const bank = { method: 'Banka havalesi', reference: 'TR-0001' }
const paid = (state: ReturnType<typeof fixture>['state']) =>
  state.invoices.filter((invoice) => invoice.paidAt).map((invoice) => invoice.id)
function rejects(action: () => unknown, code: string, kind = 'rule') {
  assert.throws(action, isDomainError(code, kind))
}

test('DOM-FIN-030: kısmi ödeme taksiti açık bırakır, tam kapanan taksit paidAt alır', () => {
  const { state, studentId } = fixture()
  const plan = planPayment(state, { studentId, amountCents: 4_000, ...bank }, context())
  assert.deepEqual(plan.allocations, [{ invoiceId: 'test-inv-1', amountCents: 4_000 }])
  assert.deepEqual(paid(state), [])
  const second = planPayment(
    state,
    { studentId, amountCents: 6_000, method: 'Kredi kartı', reference: 'POS-1' },
    context({ allocated: new Map([['test-inv-1', 4_000]]) }),
  )
  assert.deepEqual(second.allocations, [{ invoiceId: 'test-inv-1', amountCents: 6_000 }])
  assert.deepEqual(paid(state), ['test-inv-1'])
  assert.equal(state.invoices.find((i) => i.id === 'test-inv-1')?.method, 'Kredi kartı')
})

test('DOM-FIN-030: mahsup en eski vadeden başlar, fazlası dağıtılmaz', () => {
  const { state, studentId } = fixture()
  const plan = planPayment(state, { studentId, amountCents: 35_000, ...bank }, context())
  assert.deepEqual(plan.allocations, [
    { invoiceId: 'test-inv-1', amountCents: 10_000 },
    { invoiceId: 'test-inv-2', amountCents: 10_000 },
    { invoiceId: 'test-inv-3', amountCents: 10_000 },
  ])
  assert.equal(plan.amountCents, 35_000)
  assert.equal(paid(state).length, 3)
})

test('DOM-FIN-030: seçilen taksit önce kapanır, kalan en eski vadeye gider', () => {
  const { state, studentId } = fixture()
  const plan = planPayment(
    state,
    { studentId, amountCents: 15_000, invoiceId: 'test-inv-3', ...bank },
    context(),
  )
  assert.deepEqual(plan.allocations, [
    { invoiceId: 'test-inv-3', amountCents: 10_000 },
    { invoiceId: 'test-inv-1', amountCents: 5_000 },
  ])
})

test('DOM-FIN-031: ödenmiş taksite ve açık taksiti olmayan öğrenciye tahsilat reddedilir; kayıt değişmez', () => {
  const { state, studentId } = fixture()
  state.invoices[0]!.paidAt = NOW
  const before = JSON.stringify(state)
  rejects(
    () =>
      planPayment(
        state,
        { studentId, amountCents: 100, invoiceId: state.invoices[0]!.id, ...bank },
        context(),
      ),
    'invoice_already_paid',
    'conflict',
  )
  for (const invoice of state.invoices) invoice.paidAt = NOW
  const closed = JSON.stringify(state)
  rejects(
    () => planPayment(state, { studentId, amountCents: 100, ...bank }, context()),
    'no_open_installments',
    'conflict',
  )
  assert.equal(JSON.stringify(state), closed)
  assert.notEqual(before, closed)
})

test('DOM-FIN-031: kullanılmış referans ve referanssız banka tahsilatı reddedilir', () => {
  const { state, studentId } = fixture()
  const before = JSON.stringify(state)
  rejects(
    () =>
      planPayment(
        state,
        { studentId, amountCents: 100, ...bank },
        context({ referenceInUse: true }),
      ),
    'payment_reference_used',
    'conflict',
  )
  rejects(
    () => planPayment(state, { studentId, amountCents: 100, method: 'Banka havalesi' }, context()),
    'payment_reference_required',
  )
  assert.equal(JSON.stringify(state), before)
})

test('DOM-FIN-032: nakit kurum ayarına bağlıdır', () => {
  const { state, studentId } = fixture()
  const cash = { studentId, amountCents: 100, method: 'Nakit' }
  const before = JSON.stringify(state)
  rejects(() => planPayment(state, cash, context()), 'cash_payment_disabled')
  assert.equal(JSON.stringify(state), before)
  const plan = planPayment(state, cash, context({ cashEnabled: true }))
  assert.equal(plan.method, 'Nakit')
  assert.equal(plan.reference, null)
})

test('DOM-FIN-030: ödeme tarihi gün olarak alınır, ileri gün reddedilir', () => {
  const { state, studentId } = fixture()
  rejects(
    () =>
      planPayment(
        state,
        { studentId, amountCents: 100, paidDate: '2026-10-07', ...bank },
        context(),
      ),
    'payment_date_in_future',
  )
  const plan = planPayment(
    state,
    { studentId, amountCents: 100, paidDate: '2026-10-01', ...bank },
    context(),
  )
  assert.equal(plan.paidAt, '2026-10-01T09:00:00.000Z')
})

test('olmayan öğrenci ve başka öğrencinin taksiti 404 türünde reddedilir', () => {
  const { state, studentId } = fixture()
  rejects(
    () => planPayment(state, { studentId: 'yok', amountCents: 100, ...bank }, context()),
    'student_not_found',
    'not_found',
  )
  rejects(
    () =>
      planPayment(state, { studentId, amountCents: 100, invoiceId: 'baskasi', ...bank }, context()),
    'invoice_not_found',
    'not_found',
  )
})

test('DOM-FIN-033: iptal taksiti yeniden açar, ikinci iptal reddedilir', () => {
  const { state, studentId } = fixture()
  const plan = planPayment(state, { studentId, amountCents: 10_000, ...bank }, context())
  assert.equal(paid(state).length, 1)
  const { reason } = reversePayment(
    state,
    { reversedAt: null, allocations: plan.allocations },
    { reason: 'Yanlış öğrenciye girildi' },
  )
  assert.equal(reason, 'Yanlış öğrenciye girildi')
  assert.equal(paid(state).length, 0)
  rejects(
    () =>
      reversePayment(
        state,
        { reversedAt: NOW, allocations: plan.allocations },
        { reason: 'Yeniden iptal' },
      ),
    'payment_already_reversed',
    'conflict',
  )
  assert.throws(() =>
    reversePayment(state, { reversedAt: null, allocations: [] }, { reason: 'kısa' }),
  )
})

test('tahsilat kaydı olmadan ödenmiş eski taksit tam ödenmiş sayılır', () => {
  const { state } = fixture()
  const invoice = state.invoices[0]!
  assert.equal(openAmount(invoice, new Map([[invoice.id, 3_000]])), 7_000)
  invoice.paidAt = NOW
  assert.equal(openAmount(invoice, new Map()), 0)
})

test('DOM-FIN-041: ayrılmış öğrencinin tahsilatı iptal edilemez; kayıt değişmez', () => {
  const { state, studentId } = fixture()
  const plan = planPayment(state, { studentId, amountCents: 10_000, ...bank }, context())
  const before = JSON.stringify(state)
  rejects(
    () =>
      reversePayment(
        state,
        { reversedAt: null, allocations: plan.allocations, studentWithdrawn: true },
        { reason: 'Yanlış öğrenciye girildi' },
      ),
    'payment_student_withdrawn',
    'conflict',
  )
  assert.equal(JSON.stringify(state), before)
})

test('DOM-FIN-001: tutar metinden kuruşa kayıpsız çevrilir', () => {
  for (const [input, cents] of [
    ['1.234,56', 123_456],
    ['1234,56', 123_456],
    ['1234.5', 123_450],
    ['999.999,99', 99_999_999],
    ['0,07', 7],
    [' 100 ', 10_000],
    ['1000000', 100_000_000],
  ] as const)
    assert.equal(parseAmountInput(input), cents, input)
  for (const input of [
    '',
    '0',
    '0,00',
    'abc',
    '1,234',
    '1.23.4',
    '12,345',
    '-5',
    '1000000,01',
    '1.234.567',
    '0.500',
    '00.500',
  ])
    assert.equal(parseAmountInput(input), null, input)
  assert.equal(amountInputValue(123_456), '1234,56')
  assert.equal(parseAmountInput(amountInputValue(5)), 5)
})

test('DOM-FIN-031: tahsilat formu nakit dışında referans ister', () => {
  const base = { amount: '100', reference: '', paidDate: '2026-10-01' }
  assert.equal(paymentFormSchema.safeParse({ ...base, method: 'Nakit' }).success, true)
  assert.equal(paymentFormSchema.safeParse({ ...base, method: 'Kredi kartı' }).success, false)
  assert.equal(
    paymentFormSchema.safeParse({ ...base, method: 'Kredi kartı', reference: 'POS-1' }).success,
    true,
  )
  assert.equal(
    paymentFormSchema.safeParse({ ...base, amount: '0', method: 'Nakit' }).success,
    false,
  )
})
