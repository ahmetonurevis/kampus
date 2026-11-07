import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { money } from '../packages/school-core/src/lib/format.ts'
import {
  contractLineRows,
  contractLinesToShow,
  isValidTurkishIban,
  paidTuitionLabel,
  payerNameOf,
  planRefundPayment,
  quoteWithdrawal,
  refundDueDate,
  refundPayerName,
  refundPayerOptions,
  WITHDRAWAL_REASON_LABELS,
  withdrawalFormSchema,
  withdrawStudentSchema,
  withdrawStudent,
  withdrawalTargetLabel,
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

test('DOM-FIN-025: ayrılan bursludan okuduğu süre için ücret istenmez, ek hizmet istenir', () => {
  const { state, studentId } = fixture()
  state.contracts[0]!.scholarship = { programId: 'p1', amountCents: 2_000_000 }
  const { breakdown } = quoteWithdrawal(state, studentId, AFTER, context())
  assert.equal(breakdown.scholarshipExempt, true)
  assert.equal(breakdown.entitledCents, 0)
  assert.equal(breakdown.refundCents, 0)
  // Yalnız yemeğin kullanılan payı kalır.
  assert.equal(breakdown.debtCents, 100_000)

  const paid = quoteWithdrawal(
    state,
    studentId,
    AFTER,
    context({ allocated: new Map([['t-1', 5_000_000]]) }),
  ).breakdown
  // Ödenen, normal hesabın hak ettiğini aşıyorsa fark yine iade edilir.
  assert.equal(paid.entitledCents, 2_000_000)
  assert.equal(paid.refundCents, 2_900_000)
  assert.equal(paid.debtCents, 0)
})

test('DOM-FIN-025: bursu olmayan öğrencide istisna yoktur', () => {
  const { state, studentId } = fixture()
  const { breakdown } = quoteWithdrawal(state, studentId, AFTER, context())
  assert.equal(breakdown.scholarshipExempt, false)
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

test('DOM-FIN-041: borç kalırsa açılan taksit dökümde saklanır; önizleme ve iadeli ayrılışta yoktur', () => {
  const { state, studentId } = fixture()
  const half = { ...WITHDRAW, ...AFTER, attendedUnits: 90 }
  assert.equal(
    quoteWithdrawal(state, studentId, AFTER, context()).breakdown.debtInvoiceId,
    undefined,
  )
  const plan = withdrawStudent(state, studentId, half, makeId, context())
  assert.ok(plan.breakdown.debtCents > 0)
  const debt = state.invoices.find((invoice) => invoice.id === plan.breakdown.debtInvoiceId)
  assert.equal(debt?.amount, plan.breakdown.debtCents)
  assert.deepEqual(state.contracts[0]!.invoiceIds?.at(-1), debt?.id)

  const refunded = fixture()
  refunded.state.invoices[0]!.paidAt = NOW
  const refund = withdrawStudent(refunded.state, refunded.studentId, WITHDRAW, makeId, context())
  assert.equal(refund.breakdown.debtCents, 0)
  assert.equal(refund.breakdown.debtInvoiceId, undefined)
})

/** Öğrenim sözleşmesine (`fixture`) ek, ON-058 gibi sözleşme ve taksit açan paket satışı. */
function withPackage(
  state: ReturnType<typeof fixture>['state'],
  studentId: string,
  overrides: { netCents?: number; extra?: boolean } = {},
) {
  const netCents = overrides.netCents ?? 2_000_000
  const base = state.invoices[0]!
  state.invoices.push({ ...base, id: 'p-1', installment: 1, amount: netCents })
  if (overrides.extra)
    state.invoices.push({
      ...base,
      id: 'p-book',
      installment: 2,
      amount: 100_000,
      feeKind: 'stationery',
    })
  state.contracts.push({
    id: 'c-package',
    studentId,
    date: '2026-09-20T09:00:00.000Z',
    amount: netCents,
    title: 'Dil kursu paket sözleşmesi: 40 saat',
    invoiceIds: overrides.extra ? ['p-1', 'p-book'] : ['p-1'],
    grossCents: netCents,
    netCents,
  })
  return { invoiceId: 'p-1', contractId: 'c-package' }
}
const hour = (
  hours: number,
  occurredDate = '2026-09-25',
  kind: 'consumed' | 'refunded' = 'consumed',
) => ({
  kind,
  hours,
  occurredDate,
})
const sale = (entries: readonly ReturnType<typeof hour>[], purchasedHours = 40) => ({
  id: 'sale-1',
  contractId: 'c-package',
  purchasedHours,
  entries,
})

/** Paketli ayrılış yönetici onayı ister (K-21): önizlemenin tutarı onaylanmış olarak gönderilir. */
function approved<T extends typeof WITHDRAW>(
  state: ReturnType<typeof createSeed>,
  studentId: string,
  input: T,
  options: WithdrawalContext,
) {
  const { withdrawalDate, termStartDate, attendedUnits, totalUnits } = input
  const quote = { withdrawalDate, termStartDate, attendedUnits, totalUnits }
  const { refundCents } = quoteWithdrawal(state, studentId, quote, options).breakdown
  return { ...input, approvedRefundCents: refundCents }
}

test('DOM-FIN-040, K-06: paket satışı iade hesabına girer; kullanım kayıtlı saatten hesaplanır', () => {
  const { state, studentId } = fixture()
  withPackage(state, studentId)
  state.invoices.find((invoice) => invoice.id === 'p-1')!.paidAt = NOW
  const { contractId, breakdown } = quoteWithdrawal(
    state,
    studentId,
    AFTER,
    context({ packageSales: [sale([hour(10)])] }),
  )
  assert.equal(contractId, 'c-package')
  const [tuition, pack] = breakdown.contracts!
  // Öğrenim: girilen birim 18/180. Taban 10.000.000, hak edilen 2.000.000, ödenen yok.
  assert.equal(tuition?.contractId, 'c-now')
  assert.equal(tuition?.packageSaleId, undefined)
  assert.equal(tuition?.attendedUnits, 18)
  assert.equal(tuition?.entitledCents, 2_000_000)
  // Paket: 10/40 saat kullanıldı, 500.000; %10 kesinti 200.000; ödenen 2.000.000.
  assert.equal(pack?.packageSaleId, 'sale-1')
  assert.equal(pack?.attendedUnits, 10)
  assert.equal(pack?.totalUnits, 40)
  assert.equal(pack?.returnedHours, 30)
  assert.equal(pack?.deductionCents, 200_000)
  assert.equal(pack?.usageCents, 500_000)
  assert.equal(pack?.entitledCents, 700_000)
  assert.equal(pack?.paidCents, 2_000_000)
  assert.equal(pack?.balanceCents, 1_300_000)
  // Toplam döküm satırların toplamıdır.
  assert.equal(breakdown.baseCents, NET + 2_000_000)
  assert.equal(breakdown.entitledCents, 2_700_000)
  assert.equal(breakdown.paidCents, 2_000_000)
  // Öğrenim -2.000.000, yemek kullanılan payı -100.000, paket +1.300.000: tek bakiyede netleşir.
  assert.equal(tuition?.balanceCents, -2_100_000)
  assert.equal(breakdown.refundCents, 0)
  assert.equal(breakdown.debtCents, 800_000)
})

test('DOM-FIN-040: ikinci sözleşmenin tahsilatı hesapta kaybolmaz, fazlası iade edilir', () => {
  const { state, studentId } = fixture()
  withPackage(state, studentId)
  const { breakdown } = quoteWithdrawal(
    state,
    studentId,
    BEFORE,
    context({
      allocated: new Map([
        ['t-1', 5_000_000],
        ['p-1', 2_000_000],
      ]),
      packageSales: [sale([])],
    }),
  )
  // Dönem başlamadı: öğrenim 5.000.000 − 1.000.000, paket 2.000.000 − 200.000.
  assert.equal(breakdown.refundCents, 4_000_000 + 1_800_000)
  assert.equal(breakdown.debtCents, 0)
})

test('DOM-DIL-051: dönem başlamadan tüketilen saat de sayılır; ayrılıştan sonraki saat ücrete de iade saatinden düşmeye de girmez', () => {
  const { state, studentId } = fixture()
  withPackage(state, studentId)
  const entries = [hour(4, '2026-08-10'), hour(2, '2026-10-02'), hour(1, '2026-08-11', 'refunded')]
  const line = quoteWithdrawal(state, studentId, AFTER, context({ packageSales: [sale(entries)] }))
    .breakdown.contracts![1]!
  assert.equal(line.attendedUnits, 4)
  assert.equal(line.usageCents, 200_000)
  // Ücreti alınmayan saat iade edilir: 40 − 4 kullanılan − 1 önceden iade.
  assert.equal(line.returnedHours, 35)
  const before = quoteWithdrawal(
    state,
    studentId,
    BEFORE,
    context({ packageSales: [sale(entries)] }),
  ).breakdown.contracts![1]!
  assert.equal(before.attendedUnits, 4)
  assert.equal(before.usageCents, 200_000)
})

test('DOM-DIL-051, H-19: süresi dolan paketin kalan saati iade hesabına girer', () => {
  const { state, studentId } = fixture()
  withPackage(state, studentId)
  const expired = { ...sale([hour(30)]), expiresDate: '2026-09-30' }
  const line = quoteWithdrawal(state, studentId, AFTER, context({ packageSales: [expired] }))
    .breakdown.contracts![1]!
  assert.equal(line.returnedHours, 10)
  assert.equal(line.usageCents, 1_500_000)
})

test('DOM-FIN-040, H-13: indirimli pakette kullanım net ücretten hesaplanır; toplam ücreti aşmaz', () => {
  const { state, studentId } = fixture()
  withPackage(state, studentId, { netCents: 1_000_001 })
  const third = quoteWithdrawal(
    state,
    studentId,
    AFTER,
    context({ packageSales: [sale([hour(13)])] }),
  ).breakdown.contracts![1]!
  // floor(1.000.001 × 13 / 40) = 325.000; kesinti floor(100.000,1) = 100.000: ödeyici lehine.
  assert.equal(third.usageCents, 325_000)
  assert.equal(third.deductionCents, 100_000)
  const full = quoteWithdrawal(
    state,
    studentId,
    AFTER,
    context({ packageSales: [sale([hour(40)])] }),
  ).breakdown.contracts![1]!
  assert.equal(full.entitledCents, 1_000_001)
  assert.equal(full.returnedHours, 0)
})

test('DOM-FIN-003: paket satışının ek kalemi kullanılan saat oranında hesaplanır', () => {
  const { state, studentId } = fixture()
  withPackage(state, studentId, { extra: true })
  const { breakdown } = quoteWithdrawal(
    state,
    studentId,
    AFTER,
    context({ packageSales: [sale([hour(10)])] }),
  )
  const book = breakdown.extras.find((line) => line.invoiceId === 'p-book')
  assert.equal(book?.usedCents, 25_000)
  assert.equal(breakdown.contracts![1]?.extraBalanceCents, -25_000)
  assert.equal(breakdown.contracts![0]?.extraBalanceCents, -100_000)
})

test('DOM-FIN-012: ek protokol zinciri tek sözleşme sayılır; satış zincirin başından bulunur', () => {
  const { state, studentId } = fixture()
  withPackage(state, studentId)
  state.invoices.push({ ...state.invoices[0]!, id: 'p-2', installment: 2, amount: 3_000_000 })
  const approval = {
    method: 'wet_signature' as const,
    approvedAt: NOW,
    approvedByUserId: 'u1',
    payerName: 'Veli',
    plan: [],
  }
  state.contracts.find((item) => item.id === 'c-package')!.approval = approval
  state.contracts.push(
    {
      id: 'c-package-2',
      studentId,
      date: '2026-09-25T09:00:00.000Z',
      amount: 3_000_000,
      title: 'Ek protokol',
      invoiceIds: ['p-2'],
      netCents: 3_000_000,
      amendsContractId: 'c-package',
      approval,
    },
    {
      id: 'c-unapproved',
      studentId,
      date: '2026-09-30T09:00:00.000Z',
      amount: 9_000_000,
      title: 'Önerilen ek protokol',
      invoiceIds: [],
      netCents: 9_000_000,
      amendsContractId: 'c-now',
    },
  )
  const { breakdown } = quoteWithdrawal(
    state,
    studentId,
    AFTER,
    context({ packageSales: [sale([hour(10)])] }),
  )
  assert.deepEqual(
    breakdown.contracts!.map((line) => line.contractId),
    ['c-now', 'c-package-2'],
  )
  assert.equal(breakdown.baseCents, NET + 3_000_000)
  assert.equal(breakdown.contracts![1]?.packageSaleId, 'sale-1')
  assert.equal(breakdown.contracts![1]?.usageCents, 750_000)
})

test('DOM-KAY-024: yenileme planının sözleşmesi hesaba girmez, yalnız iptal edilir', () => {
  const { state, studentId } = fixture()
  withPackage(state, studentId)
  state.contracts.push({
    id: 'c-next',
    studentId,
    date: '2026-10-01T09:00:00.000Z',
    amount: 7_000_000,
    title: 'Yenileme',
    invoiceIds: ['n-1'],
    netCents: 7_000_000,
    academicYear: 2027,
  })
  state.invoices.push({ ...state.invoices[0]!, id: 'n-1', amount: 7_000_000 })
  state.renewals = [
    { id: 'r1', studentId, status: 'Planlandı', contractId: 'c-next' },
  ] as typeof state.renewals
  const options = context({ packageSales: [sale([])] })
  const input = approved(state, studentId, WITHDRAW, options)
  const plan = withdrawStudent(state, studentId, input, makeId, options)
  assert.deepEqual(
    plan.breakdown.contracts!.map((line) => line.contractId),
    ['c-now', 'c-package'],
  )
  assert.equal(plan.breakdown.baseCents, NET + 2_000_000)
  assert.equal(
    state.invoices.some((invoice) => invoice.id === 'n-1'),
    false,
  )
  assert.equal(state.renewals[0]?.status, 'İptal')
})

test('DOM-FIN-040: geçen yılın sözleşmesi hesaba girmez, açık taksiti olduğu gibi kalır; paket yıl geçse de girer', () => {
  const { state, studentId } = fixture()
  state.contracts[0]!.academicYear = 2026
  state.invoices.push({ ...state.invoices[0]!, id: 'old-open', amount: 1_000 })
  state.contracts.push({
    id: 'c-old',
    studentId,
    date: '2025-01-01T09:00:00.000Z',
    amount: 8_000_000,
    title: 'Geçen yıl',
    invoiceIds: ['old-open'],
    netCents: 8_000_000,
    academicYear: 2025,
  })
  withPackage(state, studentId)
  state.contracts.at(-1)!.academicYear = 2025
  const options = context({ packageSales: [sale([])] })
  const input = approved(state, studentId, WITHDRAW, options)
  const plan = withdrawStudent(state, studentId, input, makeId, options)
  assert.deepEqual(
    plan.breakdown.contracts!.map((line) => line.contractId),
    ['c-now', 'c-package'],
  )
  assert.equal(
    state.invoices.some((invoice) => invoice.id === 'old-open'),
    true,
  )
  assert.deepEqual(state.contracts.find((item) => item.id === 'c-old')?.invoiceIds, ['old-open'])
})

test('DOM-FIN-012: taksit listesi olmayan eski sözleşme başka sözleşmenin taksitini saymaz', () => {
  const { state, studentId } = fixture()
  withPackage(state, studentId)
  delete state.contracts[0]!.invoiceIds
  const { breakdown } = quoteWithdrawal(
    state,
    studentId,
    BEFORE,
    context({
      allocated: new Map([['p-1', 2_000_000]]),
      packageSales: [sale([])],
    }),
  )
  assert.equal(breakdown.contracts![0]?.paidCents, 0)
  assert.equal(breakdown.contracts![1]?.paidCents, 2_000_000)
  assert.equal(breakdown.paidCents, 2_000_000)
})

test('DOM-FIN-041, K-06: ayrılış bütün sözleşmelerin açık taksitini iptal eder; borç tek taksittir, ana sözleşmeye yazılır', () => {
  const { state, studentId } = fixture()
  withPackage(state, studentId)
  state.invoices.find((invoice) => invoice.id === 't-1')!.paidAt = NOW
  state.invoices.push({ ...state.invoices[0]!, id: 'p-paid', installment: 7, amount: 1 })
  state.contracts.find((item) => item.id === 'c-package')!.invoiceIds = ['p-1', 'p-paid']
  const half = { ...WITHDRAW, attendedUnits: 150 }
  const options = context({ packageSales: [sale([hour(30)])] })
  const plan = withdrawStudent(
    state,
    studentId,
    approved(state, studentId, half, options),
    makeId,
    options,
  )
  assert.equal(plan.contractId, 'c-package')
  const debt = state.invoices.find((invoice) => invoice.id === plan.breakdown.debtInvoiceId)
  assert.equal(debt?.amount, plan.breakdown.debtCents)
  assert.ok(plan.breakdown.debtCents > 0)
  assert.equal((debt as { contractId?: string } | undefined)?.contractId, 'c-package')
  assert.equal(debt?.installment, 8)
  const contract = (id: string) => state.contracts.find((item) => item.id === id)
  assert.deepEqual(contract('c-now')?.invoiceIds, ['t-1'])
  assert.deepEqual(contract('c-package')?.invoiceIds, ['p-paid', debt?.id])
  assert.equal(
    state.invoices.some((invoice) => ['t-2', 't-meal', 'p-1'].includes(invoice.id)),
    false,
  )
})

test('DOM-FIN-040: tek sözleşmeli öğrencide döküm tek satırdır ve toplamla aynıdır', () => {
  const { state, studentId } = fixture()
  state.invoices[0]!.paidAt = NOW
  const { breakdown } = quoteWithdrawal(state, studentId, AFTER, context())
  assert.equal(breakdown.contracts?.length, 1)
  const [line] = breakdown.contracts!
  assert.equal(line?.contractId, 'c-now')
  assert.equal(line?.baseCents, breakdown.baseCents)
  assert.equal(line?.entitledCents, breakdown.entitledCents)
  assert.equal(line?.balanceCents, breakdown.refundCents)
  assert.deepEqual(contractLinesToShow(breakdown.contracts), [])
  assert.deepEqual(contractLinesToShow(undefined), [])
})

test('IST-110: birden çok sözleşmede ve pakette döküm sözleşme sözleşme gösterilir', () => {
  const { state, studentId } = fixture()
  withPackage(state, studentId)
  const many = quoteWithdrawal(state, studentId, AFTER, context({ packageSales: [sale([])] }))
  assert.equal(contractLinesToShow(many.breakdown.contracts).length, 2)
  // Yalnız paketi olan kursiyerde girilen birim anlamsızdır; saat gösterilir.
  state.contracts = state.contracts.filter((item) => item.id === 'c-package')
  const only = quoteWithdrawal(state, studentId, AFTER, context({ packageSales: [sale([])] }))
  assert.equal(contractLinesToShow(only.breakdown.contracts).length, 1)
})

test('IST-110: sözleşme satırı burs, ek hizmet, kalan saat ve sonucu gösterir', () => {
  const line = {
    contractId: 'c1',
    title: 'Sözleşme',
    payer: 'guardian' as const,
    attendedUnits: 18,
    totalUnits: 180,
    scholarshipExempt: false,
    baseCents: 100,
    deductionCents: 10,
    usageCents: 10,
    entitledCents: 20,
    paidCents: 50,
    extraBalanceCents: 0,
    balanceCents: 30,
  }
  const labels = (input: Parameters<typeof contractLineRows>[0]) =>
    contractLineRows(input, 1_000).map(([label]) => label)
  assert.deepEqual(labels(line), [
    'Ödeyici',
    'Hesap tabanı (net ücret)',
    'Kesinti (%10)',
    'Kullanım (18 / 180)',
    'Hak edilen',
    'Ödenen öğrenim ücreti',
    'Bu sözleşmeden iade',
  ])
  const rich = labels({
    ...line,
    packageSaleId: 's1',
    attendedUnits: 10,
    totalUnits: 40,
    returnedHours: 30,
    scholarshipExempt: true,
    extraBalanceCents: -5,
    balanceCents: -1,
  })
  assert.ok(rich.includes('Kullanım (10 / 40 ders saati, kayıttan)'))
  for (const label of [
    'Burslu istisnası',
    'Ek hizmet bakiyesi',
    'İade edilen kalan saat',
    'Bu sözleşmeden borç',
  ])
    assert.ok(rich.includes(label), label)
})

test('ON-322, DOM-KAY-012: iade etiketleri okulda okul ve öğrenim ücreti, öteki türlerde kurum ve kurs ücreti', () => {
  for (const type of [undefined, 'school'] as const) {
    assert.equal(withdrawalTargetLabel(type), 'Gittiği okul')
    assert.equal(paidTuitionLabel(type), 'Ödenen öğrenim ücreti')
  }
  assert.equal(withdrawalTargetLabel('language_school'), 'Gittiği kurum')
  assert.equal(paidTuitionLabel('language_school'), 'Ödenen kurs ücreti')
  const line = {
    contractId: 'c1',
    title: 'Sözleşme',
    payer: 'student' as const,
    attendedUnits: 1,
    totalUnits: 10,
    scholarshipExempt: false,
    baseCents: 100,
    deductionCents: 10,
    usageCents: 10,
    entitledCents: 20,
    paidCents: 50,
    extraBalanceCents: 0,
    balanceCents: 30,
  }
  const paid = (type?: 'school' | 'language_school') =>
    contractLineRows(line, 1_000, undefined, type).find(([, value]) => value === money(50))
  assert.deepEqual(paid(), ['Ödenen öğrenim ücreti', money(50)])
  assert.deepEqual(paid('language_school'), ['Ödenen kurs ücreti', money(50)])
})

/** İki sözleşme, farklı ödeyici: öğrenim veli, paket kursiyer; öğrenim taksiti ödendi (iade oluşur). */
function twoPayers() {
  const { state, studentId } = fixture()
  withPackage(state, studentId)
  state.contracts.find((item) => item.id === 'c-now')!.payer = 'guardian'
  state.contracts.find((item) => item.id === 'c-package')!.payer = 'student'
  state.invoices.find((invoice) => invoice.id === 't-1')!.paidAt = NOW
  const student = state.students.find((item) => item.id === studentId)!
  const parent = state.parents.find((item) => item.id === student.parentId)!
  return { state, studentId, studentName: student.name, parentName: parent.name }
}
const DECISION = { payer: 'student', reason: 'Tahsilat kursiyerin hesabından yapıldı' }

test('K-12, DOM-FIN-040: önizleme ödeyicilerin farkını ve sözleşme başına ödeyiciyi döner', () => {
  const { state, studentId, studentName, parentName } = twoPayers()
  const quote = quoteWithdrawal(state, studentId, AFTER, context({ packageSales: [sale([])] }))
  assert.equal(quote.payersDiffer, true)
  assert.deepEqual(quote.payers, [
    { contractId: 'c-now', payer: 'guardian', payerName: parentName },
    { contractId: 'c-package', payer: 'student', payerName: studentName },
  ])
  assert.deepEqual(
    quote.breakdown.contracts!.map((line) => line.payer),
    ['guardian', 'student'],
  )
  // Ad kayda girecek dökümde yoktur: iade yanıtı idempotency kaydına hesap sahibini yazmaz.
  assert.equal(JSON.stringify(quote.breakdown).includes(parentName), false)
})

test('K-12: ödeyicisi aynı olan öğrencide önizleme farkı bildirmez, karar istenmez', () => {
  const { state, studentId } = fixture()
  withPackage(state, studentId)
  state.invoices[0]!.paidAt = NOW
  const input = { ...WITHDRAW, attendedUnits: 1 }
  const options = context({ packageSales: [sale([])] })
  assert.equal(quoteWithdrawal(state, studentId, AFTER, options).payersDiffer, false)
  const body = approved(state, studentId, input, options)
  const plan = withdrawStudent(state, studentId, body, makeId, options)
  assert.ok(plan.breakdown.refundCents > 0)
  assert.equal(plan.breakdown.payerDecision, undefined)
})

test('K-12: ödeyiciler farklı ve iade varsa karar zorunludur; kayıt değişmez', () => {
  const { state, studentId } = twoPayers()
  const before = JSON.stringify(state)
  const options = context({ packageSales: [sale([])] })
  const input = { ...WITHDRAW, attendedUnits: 1 }
  const quote = quoteWithdrawal(state, studentId, { ...AFTER, attendedUnits: 1 }, options)
  assert.ok(quote.breakdown.refundCents > 0)
  assert.throws(
    () => withdrawStudent(state, studentId, input, makeId, options),
    (error: unknown) => {
      assert.ok(isDomainError('withdrawal_payer_decision_required')(error))
      assert.deepEqual((error as { path?: unknown }).path, ['payerDecision'])
      return true
    },
  )
  assert.equal(JSON.stringify(state), before)
  // Hesaba girmeyen kişi seçilemez; biçim doğrulaması şemadadır.
  assert.throws(
    () =>
      withdrawStudent(
        state,
        studentId,
        { ...input, payerDecision: { payer: 'baska-kisi', reason: 'Gerekçe yazıldı' } },
        makeId,
        options,
      ),
    isDomainError('withdrawal_payer_invalid'),
  )
  assert.equal(JSON.stringify(state), before)
  for (const reason of ['', 'x'.repeat(501)])
    assert.throws(() =>
      withdrawStudent(
        state,
        studentId,
        { ...input, payerDecision: { payer: 'student', reason } },
        makeId,
        options,
      ),
    )
  assert.equal(JSON.stringify(state), before)
})

test('K-12: karar kayda girer, hesap değişmez; iade yalnız seçilen ödeyiciye yazılır', () => {
  const { state, studentId, studentName, parentName } = twoPayers()
  const options = context({ packageSales: [sale([])] })
  const input = { ...WITHDRAW, attendedUnits: 1 }
  const { breakdown: quoted } = quoteWithdrawal(
    state,
    studentId,
    { ...AFTER, attendedUnits: 1 },
    options,
  )
  const body = { ...approved(state, studentId, input, options), payerDecision: DECISION }
  const plan = withdrawStudent(state, studentId, body, makeId, { ...options })
  assert.deepEqual(plan.breakdown.payerDecision, DECISION)
  assert.equal(plan.breakdown.refundCents, quoted.refundCents)
  assert.deepEqual(plan.breakdown.contracts, quoted.contracts)
  assert.equal(refundPayerName(state, plan), studentName)

  const row = { refundCents: 100, refundPaidDate: null, payerName: refundPayerName(state, plan) }
  const pay = { paidDate: '2026-10-05', iban: IBAN, accountHolder: studentName }
  assert.equal(planRefundPayment(row, pay, '2026-10-06').accountHolder, studentName)
  assert.throws(
    () => planRefundPayment(row, { ...pay, accountHolder: parentName }, '2026-10-06'),
    isDomainError('refund_holder_mismatch'),
  )
})

test('K-12: iadesi sıfır olan ayrılışta karar istenmez, verilse de yazılmaz', () => {
  const { state, studentId, parentName } = twoPayers()
  state.invoices.find((invoice) => invoice.id === 't-1')!.paidAt = null
  const options = context({ packageSales: [sale([])] })
  assert.equal(quoteWithdrawal(state, studentId, AFTER, options).payersDiffer, true)
  const plan = withdrawStudent(
    state,
    studentId,
    { ...approved(state, studentId, WITHDRAW, options), payerDecision: DECISION },
    makeId,
    options,
  )
  assert.equal(plan.breakdown.refundCents, 0)
  assert.ok(plan.breakdown.debtCents > 0)
  assert.equal(plan.breakdown.payerDecision, undefined)
  assert.notEqual(parentName, '')
})

test('K-12: seçenekler ödeyici başına birdir; önizlemede ad, kayıtta tür yazılır', () => {
  const options = refundPayerOptions([
    { contractId: 'a', payer: 'guardian', payerName: 'Veli Adı' },
    { contractId: 'b', payer: 'guardian', payerName: 'Veli Adı' },
    { contractId: 'c', payer: 'student', payerName: 'Öğrenci Adı' },
    { contractId: 'd', payer: 'student', payerName: ' ' },
  ])
  assert.deepEqual(
    options.map((item) => item.contractId),
    ['a', 'c'],
  )
  const line = {
    contractId: 'a',
    title: 'Sözleşme',
    payer: 'student' as const,
    attendedUnits: 0,
    totalUnits: 1,
    scholarshipExempt: false,
    baseCents: 0,
    deductionCents: 0,
    usageCents: 0,
    entitledCents: 0,
    paidCents: 0,
    extraBalanceCents: 0,
    balanceCents: 0,
  }
  assert.deepEqual(contractLineRows(line, 1_000)[0], ['Ödeyici', 'Öğrenci veya kursiyer'])
  assert.deepEqual(contractLineRows(line, 1_000, 'Deniz')[0], ['Ödeyici', 'Deniz'])
})

test('K-12: adı bulunamayan ödeyici seçilemez', () => {
  const { state, studentId } = twoPayers()
  const student = state.students.find((item) => item.id === studentId)!
  student.parentId = 'yok'
  const input = {
    ...WITHDRAW,
    attendedUnits: 1,
    payerDecision: { payer: 'guardian', reason: 'Gerekçe yazıldı' },
  }
  assert.throws(
    () => withdrawStudent(state, studentId, input, makeId, context({ packageSales: [sale([])] })),
    isDomainError('withdrawal_payer_invalid'),
  )
})

test('K-21, DOM-FIN-040: paketli ayrılış yönetici onayı ister; onay gördüğü tutara bağlıdır, kayıt değişmez', () => {
  const { state, studentId } = fixture()
  withPackage(state, studentId)
  state.invoices.find((invoice) => invoice.id === 'p-1')!.paidAt = NOW
  const options = context({ packageSales: [sale([hour(10)])] })
  const before = JSON.stringify(state)
  assert.throws(
    () => withdrawStudent(state, studentId, WITHDRAW, makeId, options),
    (error: unknown) => {
      assert.ok(isDomainError('withdrawal_refund_approval_required')(error))
      assert.deepEqual((error as { path?: unknown }).path, ['approvedRefundCents'])
      return true
    },
  )
  const body = approved(state, studentId, WITHDRAW, options)
  // Önizlemeden sonra saat girildiyse eski tutarın onayı geçmez.
  assert.throws(
    () =>
      withdrawStudent(
        state,
        studentId,
        { ...body, approvedRefundCents: body.approvedRefundCents + 1 },
        makeId,
        options,
      ),
    isDomainError('withdrawal_refund_changed', 'conflict'),
  )
  assert.throws(() =>
    withdrawStudent(state, studentId, { ...body, approvedRefundCents: -1 }, makeId, options),
  )
  assert.equal(JSON.stringify(state), before)
  const plan = withdrawStudent(state, studentId, body, makeId, options)
  assert.equal(plan.breakdown.refundApprovedCents, body.approvedRefundCents)
  assert.equal(plan.breakdown.refundApprovedCents, plan.breakdown.refundCents)
})

test('K-21: paket yoksa onay istenmez, tutar dökümde yazmaz', () => {
  const { state, studentId } = fixture()
  const plan = withdrawStudent(state, studentId, WITHDRAW, makeId, context())
  assert.equal(plan.breakdown.refundApprovedCents, undefined)
})

test('K-21, DOM-DIL-051: elle girilen toplam ayrılış gününe göre elenmez, ders saati elenir', () => {
  const { state, studentId } = fixture()
  withPackage(state, studentId)
  const entries = [
    { ...hour(6, '2026-10-05'), sourceType: 'manual' as const },
    { ...hour(4, '2026-10-05'), sourceType: 'lesson' as const },
  ]
  const early = { ...AFTER, withdrawalDate: '2026-10-01' }
  const { breakdown } = quoteWithdrawal(
    state,
    studentId,
    early,
    context({ packageSales: [sale(entries)] }),
  )
  const line = breakdown.contracts!.find((item) => item.packageSaleId === 'sale-1')
  assert.equal(line?.attendedUnits, 6)
  assert.equal(line?.usedHoursMissing, undefined)
})

test('DOM-DIL-051, K-43: geriye tarihli ayrılışta ücret ve iade saati aynı hareketlerden hesaplanır; saat kaybolmaz', () => {
  const { state, studentId } = fixture()
  withPackage(state, studentId)
  // 20 saatlik paket: ayrılıştan önce 5, sonra 3 saat ders yazılmış.
  const entries = [
    { ...hour(5, '2026-09-25'), sourceType: 'lesson' as const },
    { ...hour(3, '2026-10-03'), sourceType: 'lesson' as const },
  ]
  const line = quoteWithdrawal(
    state,
    studentId,
    AFTER,
    context({ packageSales: [sale(entries, 20)] }),
  ).breakdown.contracts!.find((item) => item.packageSaleId === 'sale-1')!
  assert.equal(line.attendedUnits, 5)
  assert.equal(line.returnedHours, 15)
  assert.equal(line.attendedUnits + line.returnedHours, line.totalUnits)
  // Elle girilen toplam ayrılıştan sonra girilse de sayılır (K-43); ders saati yine elenir.
  const withManual = [...entries, { ...hour(2, '2026-10-05'), sourceType: 'manual' as const }]
  const manualLine = quoteWithdrawal(
    state,
    studentId,
    AFTER,
    context({ packageSales: [sale(withManual, 20)] }),
  ).breakdown.contracts!.find((item) => item.packageSaleId === 'sale-1')!
  assert.equal(manualLine.attendedUnits, 7)
  assert.equal(manualLine.returnedHours, 13)
})

test('K-21: saat girilmemişse satır işaretlenir ve döküm söyler; sıfır girişi saat girilmiş sayılır', () => {
  const { state, studentId } = fixture()
  withPackage(state, studentId)
  const lineOf = (entries: readonly ReturnType<typeof hour>[]) =>
    quoteWithdrawal(
      state,
      studentId,
      AFTER,
      context({ packageSales: [sale(entries)] }),
    ).breakdown.contracts!.find((item) => item.packageSaleId === 'sale-1')!
  const missing = lineOf([])
  assert.equal(missing.usedHoursMissing, true)
  assert.deepEqual(
    contractLineRows(missing, 1_000).find(([label]) => label === 'Kullanılan saat'),
    ['Kullanılan saat', 'Girilmedi; hesap sıfır saate göre'],
  )
  const zero = lineOf([hour(0)])
  assert.equal(zero.usedHoursMissing, undefined)
  assert.equal(
    contractLineRows(zero, 1_000).some(([label]) => label === 'Kullanılan saat'),
    false,
  )
  // Öğrenim satırı bu uyarıyı taşımaz.
  const tuition = quoteWithdrawal(
    state,
    studentId,
    AFTER,
    context({ packageSales: [sale([])] }),
  ).breakdown.contracts!.find((item) => item.packageSaleId === undefined)
  assert.equal(tuition?.usedHoursMissing, undefined)
})

test('DOM-FIN-041: kararsız ayrılışta iade kaydın sözleşmesinin ödeyicisinedir', () => {
  const { state, studentId } = fixture()
  const student = state.students.find((item) => item.id === studentId)!
  const parent = state.parents.find((item) => item.id === student.parentId)!
  const plan = { contractId: 'c-now', breakdown: {} }
  assert.equal(refundPayerName(state, plan), parent.name)
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

test('K-30: ayrılış nedeninde sağlık yok, belgeli neden var', () => {
  const body = { ...WITHDRAW, studentId: 's1', contractId: 'c1' }
  const issue = (reason: string) =>
    withdrawStudentSchema
      .safeParse({ ...body, reason })
      .error?.issues.some((item) => item.path.includes('reason')) ?? false
  assert.equal(issue('health'), true)
  assert.equal(issue('documented'), false)
  assert.equal(WITHDRAWAL_REASON_LABELS.documented, 'Belgeli neden')
  assert.ok(!Object.keys(WITHDRAWAL_REASON_LABELS).includes('health'))
})
