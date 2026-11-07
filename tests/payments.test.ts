import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed } from '../packages/school-core/src/data/seed.ts'
import {
  amountInputValue,
  openAmount,
  parseAmountInput,
  paymentFormSchema,
  assertMebbisChangeAllowed,
  bankAccountLabel,
  bankAccountSchema,
  hasScholarshipContract,
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
  bankAccountIds: [],
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
        { reversedAt: null, allocations: plan.allocations, withdrawals: [{ debtInvoiceId: null }] },
        { reason: 'Yanlış öğrenciye girildi' },
      ),
    'payment_student_withdrawn',
    'conflict',
  )
  assert.equal(JSON.stringify(state), before)
})

test('DOM-FIN-041, DOM-FIN-033: ayrılıştan sonra kalan borca alınan tahsilat iptal edilir; ayrılış öncesi tahsilat edilemez', () => {
  const { state } = fixture()
  const withdrawals = [{ debtInvoiceId: 'test-inv-3' }]
  const debtPayment = [{ invoiceId: 'test-inv-3', amountCents: 10_000 }]
  state.invoices.find((invoice) => invoice.id === 'test-inv-3')!.paidAt = NOW
  const result = reversePayment(
    state,
    { reversedAt: null, allocations: debtPayment, withdrawals },
    { reason: 'Yanlış tutar girildi' },
  )
  assert.equal(result.reason, 'Yanlış tutar girildi')
  assert.equal(state.invoices.find((invoice) => invoice.id === 'test-inv-3')?.paidAt, null)

  // Ayrılış öncesi taksite ya da karışık dağılmış tahsilat ayrılış hesabına girmiştir.
  for (const allocations of [
    [{ invoiceId: 'test-inv-1', amountCents: 10_000 }],
    [...debtPayment, { invoiceId: 'test-inv-1', amountCents: 5_000 }],
    [],
  ]) {
    state.invoices[1]!.paidAt = NOW
    const before = JSON.stringify(state)
    rejects(
      () =>
        reversePayment(
          state,
          { reversedAt: null, allocations, withdrawals },
          { reason: 'Yanlış tutar girildi' },
        ),
      'payment_student_withdrawn',
      'conflict',
    )
    assert.equal(JSON.stringify(state), before)
  }
  // Ayrılışı olmayan öğrencide denetim yoktur.
  assert.doesNotThrow(() =>
    reversePayment(
      state,
      { reversedAt: null, allocations: [{ invoiceId: 'test-inv-1', amountCents: 10_000 }] },
      { reason: 'Yanlış tutar girildi' },
    ),
  )
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
  const base = { amount: '100', reference: '', paidDate: '2026-10-01', bankAccountId: '' }
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

test('DOM-FIN-025: burs kararı öğrencinin kendi sözleşmesine bakar', () => {
  const contracts = [
    { studentId: 's1', scholarship: { programId: 'p1', amountCents: 100 } },
    { studentId: 's2' },
  ]
  assert.equal(hasScholarshipContract(contracts, 's1'), true)
  assert.equal(hasScholarshipContract(contracts, 's2'), false)
  assert.equal(hasScholarshipContract(contracts, 's3'), false)
})

test('IST-106: senet numara ister, banka hesabına bağlanmaz, burslu öğrenciden alınmaz', () => {
  const { state, studentId } = fixture()
  const note = { studentId, amountCents: 4_000, method: 'Senet' }
  const accounts = { bankAccountIds: ['a1'] }
  assert.throws(
    () => planPayment(state, note, context(accounts)),
    isDomainError('payment_reference_required'),
  )
  const plan = planPayment(state, { ...note, reference: 'SNT-1' }, context(accounts))
  assert.equal(plan.method, 'Senet')
  assert.equal(plan.bankAccountId, null)

  const before = structuredClone(state.invoices)
  state.contracts = [
    { ...state.contracts[0]!, studentId, scholarship: { programId: 'p1', amountCents: 100 } },
  ]
  assert.throws(
    () => planPayment(state, { ...note, reference: 'SNT-2' }, context(accounts)),
    isDomainError('scholarship_promissory_note'),
  )
  assert.deepEqual(state.invoices, before)
  assert.equal(
    planPayment(state, { ...bank, studentId, amountCents: 4_000 }, context()).method,
    'Banka havalesi',
  )
})

test('DOM-FIN-032: hesap tanımlıysa nakit dışı tahsilat hesap ister, nakit istemez', () => {
  const { state, studentId } = fixture()
  const accounts = { bankAccountIds: ['a1'] }
  const input = { studentId, amountCents: 4_000, ...bank }
  assert.throws(
    () => planPayment(state, input, context(accounts)),
    isDomainError('bank_account_required'),
  )
  assert.throws(
    () => planPayment(state, { ...input, bankAccountId: 'a2' }, context(accounts)),
    isDomainError('bank_account_invalid'),
  )
  assert.equal(
    planPayment(state, { ...input, bankAccountId: 'a1' }, context(accounts)).bankAccountId,
    'a1',
  )
  assert.equal(planPayment(state, input, context()).bankAccountId, null)
  const cash = { studentId, amountCents: 4_000, method: 'Nakit' }
  assert.equal(
    planPayment(state, cash, context({ ...accounts, cashEnabled: true })).bankAccountId,
    null,
  )
})

test('DOM-FIN-032: hesap IBAN mod 97 ile doğrulanır, boşluklar temizlenir; etiket son dört hane', () => {
  const account = { bankName: 'Örnek Bankası', accountHolder: 'Akademi Özel Okulları' }
  const parsed = bankAccountSchema.parse({ ...account, iban: 'tr33 0006 1005 1978 6457 8413 26' })
  assert.equal(parsed.iban, 'TR330006100519786457841326')
  assert.equal(bankAccountLabel(parsed), 'Örnek Bankası · 1326')
  assert.equal(
    bankAccountSchema.safeParse({ ...account, iban: 'TR330006100519786457841327' }).success,
    false,
  )
})

test('DOM-FIN-032: iptal edilen tahsilatın MEBBİS işareti değişmez', () => {
  assert.doesNotThrow(() => assertMebbisChangeAllowed({ reversedAt: null }))
  assert.throws(
    () => assertMebbisChangeAllowed({ reversedAt: NOW }),
    isDomainError('payment_already_reversed', 'conflict'),
  )
})
