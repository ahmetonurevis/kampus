import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed } from '../packages/school-core/src/data/seed.ts'
import {
  isValidTurkishIban,
  payerNameOf,
  planRefundPayment,
  quoteWithdrawal,
  refundDueDate,
  withdrawalFormSchema,
  withdrawStudent,
  type WithdrawalContext,
} from '../packages/school-core/src/lib/withdrawals.ts'
import { isDomainError } from './support/domain-error.ts'

const NOW = '2026-10-06T09:00:00.000Z'
const IBAN = 'TR330006100519786457841326'
const NET = 10_000_000

function fixture() {
  const state = createSeed(new Date(NOW))
  const student = state.students[0]!
  const invoice = (id: string, installment: number, amount: number, feeKind = 'tuition') => ({
    id,
    studentId: student.id,
    installment,
    amount,
    dueDate: '2026-09-15T09:00:00.000Z',
    paidAt: null as string | null,
    method: null as string | null,
    reminderAt: null,
    feeKind,
  })
  state.invoices = [
    invoice('t-1', 1, 5_000_000),
    invoice('t-2', 2, 5_000_000),
    invoice('t-meal', 3, 1_000_000, 'meal'),
  ]
  state.contracts = [
    {
      id: 'c-now',
      studentId: student.id,
      date: '2026-01-01T09:00:00.000Z',
      amount: 11_000_000,
      title: 'Sözleşme',
      invoiceIds: ['t-1', 't-2', 't-meal'],
      netCents: NET,
    },
  ]
  state.renewals = []
  return { state, studentId: student.id }
}
const context = (overrides: Partial<WithdrawalContext> = {}): WithdrawalContext => ({
  institutionType: 'school',
  allocated: new Map(),
  creditCents: 0,
  now: NOW,
  ...overrides,
})
const BEFORE = {
  withdrawalDate: '2026-08-20',
  termStartDate: '2026-09-07',
  attendedUnits: 0,
  totalUnits: 180,
}
const AFTER = { ...BEFORE, withdrawalDate: '2026-10-01', attendedUnits: 18 }
const WITHDRAW = { ...AFTER, reason: 'relocation' }
let serial = 0
const makeId = (prefix: string) => `${prefix}-test-${String(serial++)}`

test('DOM-FIN-040: dönem başlamadan %10 kesilir, kalanı iade edilir', () => {
  const { state, studentId } = fixture()
  state.invoices[0]!.paidAt = NOW
  const { breakdown } = quoteWithdrawal(state, studentId, BEFORE, context())
  assert.equal(breakdown.started, false)
  assert.equal(breakdown.deductionCents, 1_000_000)
  assert.equal(breakdown.usageCents, 0)
  assert.equal(breakdown.entitledCents, 1_000_000)
  assert.equal(breakdown.paidCents, 5_000_000)
  assert.equal(breakdown.refundCents, 4_000_000)
  assert.equal(breakdown.debtCents, 0)
})

test('DOM-FIN-040: resmî okul belgesinde kesinti yoktur; yalnız okulda ve dönem başlamadan', () => {
  const { state, studentId } = fixture()
  state.invoices[0]!.paidAt = NOW
  const { breakdown } = quoteWithdrawal(
    state,
    studentId,
    { ...BEFORE, publicSchoolExemption: true },
    context(),
  )
  assert.equal(breakdown.deductionCents, 0)
  assert.equal(breakdown.refundCents, 5_000_000)
  assert.throws(
    () => quoteWithdrawal(state, studentId, { ...AFTER, publicSchoolExemption: true }, context()),
    isDomainError('exemption_not_applicable'),
  )
  assert.throws(
    () =>
      quoteWithdrawal(
        state,
        studentId,
        { ...BEFORE, publicSchoolExemption: true },
        context({ institutionType: 'language_school' }),
      ),
    isDomainError('exemption_not_applicable'),
  )
})

test('DOM-FIN-040: dönem başladıysa kesinti + kullanım; ödenen azsa iade sıfır, kalan borçtur', () => {
  const { state, studentId } = fixture()
  const { breakdown } = quoteWithdrawal(state, studentId, AFTER, context())
  assert.equal(breakdown.usageCents, 1_000_000)
  assert.equal(breakdown.entitledCents, 2_000_000)
  assert.equal(breakdown.refundCents, 0)
  // Öğrenim borcu 2.000.000; yemeğin kullanılan payı 100.000 ödenmemiş.
  assert.equal(breakdown.debtCents, 2_100_000)
})

test('DOM-FIN-040: hak edilen tutar tabanı aşmaz', () => {
  const { state, studentId } = fixture()
  const { breakdown } = quoteWithdrawal(
    state,
    studentId,
    { ...AFTER, attendedUnits: 180 },
    context(),
  )
  assert.equal(breakdown.entitledCents, NET)
})

test('DOM-FIN-040: kısmi ödeme ve dağıtılmamış tahsilat iadeye girer; ek hizmetin kullanılmayan kısmı döner', () => {
  const { state, studentId } = fixture()
  state.invoices[2]!.paidAt = NOW
  const { breakdown } = quoteWithdrawal(
    state,
    studentId,
    AFTER,
    context({ allocated: new Map([['t-1', 3_000_000]]), creditCents: 500 }),
  )
  assert.equal(breakdown.paidCents, 3_000_000)
  assert.equal(breakdown.extras[0]?.usedCents, 100_000)
  assert.equal(breakdown.refundCents, 1_000_000 + 900_000 + 500)
})

test('DOM-FIN-040: eski sözleşmede taban tutardır; tarih ve birim denetlenir', () => {
  const { state, studentId } = fixture()
  delete state.contracts[0]!.netCents
  assert.equal(quoteWithdrawal(state, studentId, BEFORE, context()).breakdown.baseCents, 11_000_000)
  for (const [input, code] of [
    [{ ...BEFORE, withdrawalDate: '2026-10-07' }, 'withdrawal_date_in_future'],
    [{ ...AFTER, attendedUnits: 181 }, 'attended_exceeds_total'],
    [{ ...BEFORE, attendedUnits: 1 }, 'attended_before_term'],
  ] as const)
    assert.throws(() => quoteWithdrawal(state, studentId, input, context()), isDomainError(code))
  assert.throws(
    () => quoteWithdrawal(state, 'yok', BEFORE, context()),
    isDomainError('student_not_found', 'not_found'),
  )
  state.contracts = []
  assert.throws(
    () => quoteWithdrawal(state, studentId, BEFORE, context()),
    isDomainError('withdrawal_contract_missing'),
  )
})

test('DOM-FIN-041, DOM-KAY-024: ayrılış öğrenciyi pasifler, açık taksiti iptal eder, borç taksiti açar, ileri kayıtları sonlandırır', () => {
  const { state, studentId } = fixture()
  state.invoices[0]!.paidAt = '2026-09-15T09:00:00.000Z'
  const member = { id: 'm1', clubId: 'x', studentId, status: 'Aktif' }
  state.clubMemberships = [member] as typeof state.clubMemberships
  state.transportAssignments = [{ id: 'tr1', studentId }] as typeof state.transportAssignments
  const session = (id: string, date: string, studentIds: string[]) =>
    ({ id, date, status: 'Planlandı', studentIds }) as (typeof state.tutorSessions)[number]
  state.tutorSessions = [
    session('alone', '2026-10-20T10:00:00.000Z', [studentId]),
    session('group', '2026-10-21T10:00:00.000Z', [studentId, 'other']),
    session('past', '2026-10-01T10:00:00.000Z', [studentId]),
  ]
  const plan = withdrawStudent(state, studentId, WITHDRAW, makeId, context())

  assert.equal(state.students.find((s) => s.id === studentId)?.isActive, false)
  // Öğrenim fazlası 3.000.000, ödenmemiş yemeğin kullanılan payı 100.000: iade netleşir.
  assert.equal(plan.breakdown.refundCents, 2_900_000)
  assert.equal(plan.breakdown.debtCents, 0)
  assert.equal(plan.refundDueDate, '2026-11-01')
  const invoices = state.invoices.filter((i) => i.studentId === studentId)
  assert.deepEqual(
    invoices.map((i) => i.id),
    ['t-1'],
  )
  assert.deepEqual(state.contracts[0]!.invoiceIds, ['t-1'])
  assert.equal(state.contracts[0]!.amount, 11_000_000)
  assert.equal(state.clubMemberships.length, 0)
  assert.equal(state.transportAssignments.length, 0)
  const byId = (id: string) => state.tutorSessions.find((s) => s.id === id)
  assert.equal(byId('alone')?.status, 'İptal')
  assert.deepEqual(byId('group')?.studentIds, ['other'])
  assert.equal(byId('group')?.status, 'Planlandı')
  assert.deepEqual(byId('past')?.studentIds, [studentId])

  const again = JSON.stringify(state)
  assert.throws(
    () => withdrawStudent(state, studentId, WITHDRAW, makeId, context()),
    isDomainError('student_already_withdrawn', 'conflict'),
  )
  assert.equal(JSON.stringify(state), again)
})

test('DOM-KAY-024: planlanmış yenileme iptal edilir, taksitleri kalkar; tahsilatlıysa ayrılış reddedilir', () => {
  const planned = () => {
    const { state, studentId } = fixture()
    state.contracts.push({
      id: 'c-next',
      studentId,
      date: '2026-05-01T09:00:00.000Z',
      amount: 7_000,
      title: 'Yenileme',
      invoiceIds: ['n-1'],
    })
    state.invoices.push({ ...state.invoices[0]!, id: 'n-1', amount: 7_000 })
    state.renewals = [
      { id: 'r1', studentId, status: 'Planlandı', contractId: 'c-next' },
    ] as typeof state.renewals
    return { state, studentId }
  }
  const { state, studentId } = planned()
  const plan = withdrawStudent(state, studentId, WITHDRAW, makeId, context())
  assert.equal(plan.contractId, 'c-now')
  assert.equal(plan.breakdown.baseCents, NET)
  assert.equal(state.renewals[0]?.status, 'İptal')
  assert.equal(
    state.invoices.some((i) => i.id === 'n-1'),
    false,
  )

  const paid = planned()
  const before = JSON.stringify(paid.state)
  assert.throws(
    () =>
      withdrawStudent(
        paid.state,
        paid.studentId,
        WITHDRAW,
        makeId,
        context({ allocated: new Map([['n-1', 100]]) }),
      ),
    isDomainError('withdrawal_renewal_paid', 'conflict'),
  )
  assert.equal(JSON.stringify(paid.state), before)
})

test('DOM-FIN-040: iade son günü bir ay sonradır, ay sonu kırpılır', () => {
  assert.equal(refundDueDate('2026-10-01'), '2026-11-01')
  assert.equal(refundDueDate('2026-01-31'), '2026-02-28')
  assert.equal(refundDueDate('2026-12-15'), '2027-01-15')
})

test('DOM-FIN-041: iade ödemesi IBAN, ödeyici ve tekrar denetler', () => {
  assert.equal(isValidTurkishIban(IBAN), true)
  assert.equal(isValidTurkishIban('TR330006100519786457841327'), false)
  assert.equal(isValidTurkishIban('DE89370400440532013000'), false)
  const row = { refundCents: 100, refundPaidDate: null, payerName: 'Ayşe Yılmaz' }
  const input = {
    paidDate: '2026-10-05',
    iban: `${IBAN.slice(0, 4)} ${IBAN.slice(4)}`,
    accountHolder: ' ayşe  yılmaz',
  }
  const today = '2026-10-06'
  assert.equal(planRefundPayment(row, input, today).iban, IBAN)
  assert.throws(() => planRefundPayment(row, { ...input, iban: 'TR1' }, today))
  assert.throws(
    () => planRefundPayment(row, { ...input, accountHolder: 'Başka Kişi' }, today),
    isDomainError('refund_holder_mismatch'),
  )
  assert.throws(
    () => planRefundPayment(row, { ...input, paidDate: '2026-10-07' }, today),
    isDomainError('refund_date_in_future'),
  )
  assert.throws(
    () => planRefundPayment({ ...row, refundCents: 0 }, input, today),
    isDomainError('refund_not_due', 'conflict'),
  )
  assert.throws(
    () => planRefundPayment({ ...row, refundPaidDate: '2026-10-01' }, input, today),
    isDomainError('refund_already_paid', 'conflict'),
  )
})

test('DOM-KAY-012: ödeyici adı sözleşmeden okunur', () => {
  const { state, studentId } = fixture()
  const student = state.students.find((s) => s.id === studentId)!
  const parent = state.parents.find((p) => p.id === student.parentId)!
  assert.equal(payerNameOf(state, 'c-now'), parent.name)
  state.contracts[0]!.payer = 'student'
  assert.equal(payerNameOf(state, 'c-now'), student.name)
  assert.throws(() => payerNameOf(state, 'yok'), isDomainError('withdrawal_contract_missing'))
})

test('DOM-FIN-040: iade ve borç netleşir; ikisi aynı anda oluşmaz', () => {
  const { state, studentId } = fixture()
  // Taban 10.000.000; görülen yarısı: hak edilen 6.000.000, öğrenim ödemesi yok.
  state.invoices[2]!.paidAt = NOW
  const half = { ...AFTER, attendedUnits: 90 }
  const debt = quoteWithdrawal(state, studentId, half, context()).breakdown
  // Yemek 1.000.000 ödendi, 500.000 kullanıldı: 500.000 fazla öğrenim borcundan düşer.
  assert.equal(debt.refundCents, 0)
  assert.equal(debt.debtCents, 5_500_000)

  const covered = quoteWithdrawal(
    state,
    studentId,
    half,
    context({ allocated: new Map([['t-1', 5_000_000]]), creditCents: 1_000_000 }),
  ).breakdown
  // -1.000.000 öğrenim, +500.000 yemek, +1.000.000 dağıtılmamış tahsilat.
  assert.equal(covered.refundCents, 500_000)
  assert.equal(covered.debtCents, 0)
})

test('IST-110: ayrılış formu öğrenci ve geçerli birim ister', () => {
  const values = {
    studentId: 's1',
    withdrawalDate: '2026-10-01',
    termStartDate: '2026-09-07',
    attendedUnits: 18,
    totalUnits: 180,
    publicSchoolExemption: false,
    reason: 'transfer',
    targetSchool: '',
  }
  assert.equal(withdrawalFormSchema.safeParse(values).success, true)
  assert.equal(withdrawalFormSchema.safeParse({ ...values, studentId: '' }).success, false)
  assert.equal(withdrawalFormSchema.safeParse({ ...values, totalUnits: 0 }).success, false)
  assert.equal(withdrawalFormSchema.safeParse({ ...values, attendedUnits: NaN }).success, false)
})
