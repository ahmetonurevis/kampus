import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed } from '../packages/school-core/src/data/seed.ts'
import {
  ACTIVITY_FEE_KIND,
  FEE_ITEM_KINDS,
  INVOICE_FEE_KIND_LABELS,
  INVOICE_FEE_KINDS,
} from '../packages/school-core/src/lib/fee-tariffs.ts'
import {
  activityPayerName,
  applyParticipationCancel,
  applyPaidActivityJoin,
  paidActivitySchema,
  participationPaymentStatus,
  participationRefundStatus,
  planParticipationRefund,
  planPaidActivity,
  planPaidActivityCancel,
  planPaidActivityUpdate,
  retainedOnCancel,
  type PaidActivityTerms,
} from '../packages/school-core/src/lib/finance-paid-activities.ts'
import { reversePayment } from '../packages/school-core/src/lib/payments.ts'
import { isDomainError } from './support/domain-error.ts'

const TODAY = '2026-10-06'
const SEED = createSeed(new Date(`${TODAY}T09:00:00.000Z`))
const STUDENT = SEED.students[0]
const STUDENT_ID = STUDENT?.id ?? ''
const BANK = '11111111-1111-4111-8111-111111111111'
const IBAN = 'TR330006100519786457841326'

const INPUT = {
  name: 'Kapadokya gezisi',
  kind: 'trip',
  activityDate: '2026-10-20',
  feeCents: 150_000,
  joinDeadline: '2026-10-10',
  cancelDeadline: '2026-10-12',
  capacity: 2,
  lateRefundRule: 'percent',
  lateRefundPercent: 50,
  lateCostCents: null,
} as const

const terms = (overrides: Partial<PaidActivityTerms> = {}): PaidActivityTerms => ({
  status: 'open',
  name: INPUT.name,
  activityDate: INPUT.activityDate,
  feeCents: INPUT.feeCents,
  joinDeadline: INPUT.joinDeadline,
  cancelDeadline: INPUT.cancelDeadline,
  capacity: INPUT.capacity,
  lateRefundRule: 'percent',
  lateRefundPercent: 50,
  lateCostCents: null,
  ...overrides,
})

let serial = 0
const makeId = (prefix: string) => `${prefix}-test-${String(++serial)}`

function freshState() {
  return {
    students: SEED.students.map((item) => ({ ...item })),
    parents: SEED.parents.map((item) => ({ ...item })),
    invoices: SEED.invoices.filter((item) => item.studentId === STUDENT_ID).map((i) => ({ ...i })),
  }
}

function joined(activity = terms()) {
  const state = freshState()
  const plan = applyPaidActivityJoin(
    state,
    activity,
    { studentId: STUDENT_ID },
    {
      today: TODAY,
      activeStudentIds: new Set(),
      makeId,
    },
  )
  return { state, plan }
}

test('DOM-FIN-098: etkinlik şeması tarih ve iade kuralı tutarlılığını denetler', () => {
  assert.equal(paidActivitySchema.parse(INPUT).externalRef, null)
  const issues = (input: unknown) =>
    paidActivitySchema.safeParse(input).error?.issues.map((issue) => issue.path.join('.')) ?? []
  assert.deepEqual(issues({ ...INPUT, joinDeadline: '2026-10-21' }), ['joinDeadline'])
  assert.deepEqual(issues({ ...INPUT, cancelDeadline: '2026-10-21' }), ['cancelDeadline'])
  assert.deepEqual(issues({ ...INPUT, lateRefundPercent: null }), ['lateRefundPercent'])
  assert.deepEqual(issues({ ...INPUT, lateCostCents: 100 }), ['lateCostCents'])
  assert.deepEqual(
    issues({ ...INPUT, lateRefundRule: 'cost', lateRefundPercent: null, lateCostCents: null }),
    ['lateCostCents'],
  )
  assert.deepEqual(issues({ ...INPUT, lateRefundRule: 'cost', lateCostCents: 10 }), [
    'lateRefundPercent',
  ])
  assert.deepEqual(
    issues({ ...INPUT, lateRefundRule: 'cost', lateRefundPercent: null, lateCostCents: 200_000 }),
    ['lateCostCents'],
  )
  assert.deepEqual(issues({ ...INPUT, lateRefundPercent: 101 }), ['lateRefundPercent'])
  assert.deepEqual(issues({ ...INPUT, feeCents: 0 }), ['feeCents'])
  assert.deepEqual(issues({ ...INPUT, institutionId: 'x' }), [''])
})

test('DOM-FIN-098, K-300: etkinlik günü geçmiş olamaz; düzeltme yalnız ad, kontenjan, son katılım ve referans', () => {
  assert.throws(
    () =>
      planPaidActivity(
        {
          ...INPUT,
          activityDate: '2026-10-05',
          joinDeadline: '2026-10-01',
          cancelDeadline: '2026-10-01',
        },
        TODAY,
      ),
    isDomainError('paid_activity_date_past'),
  )
  assert.equal(planPaidActivity(INPUT, TODAY).name, INPUT.name)

  const activity = { ...terms(), externalRef: null }
  const plan = planPaidActivityUpdate(
    activity,
    { capacity: 5, externalRef: 'plan-1' },
    {
      activeCount: 2,
    },
  )
  assert.deepEqual(plan.changed, ['capacity', 'externalRef'])
  assert.equal(plan.name, INPUT.name)
  assert.throws(
    () => planPaidActivityUpdate(activity, { capacity: 1 }, { activeCount: 2 }),
    isDomainError('paid_activity_capacity_below_participants'),
  )
  assert.throws(
    () => planPaidActivityUpdate(activity, { joinDeadline: '2026-10-21' }, { activeCount: 0 }),
    isDomainError('paid_activity_join_after_date'),
  )
  assert.throws(
    () => planPaidActivityUpdate(activity, { name: INPUT.name }, { activeCount: 0 }),
    isDomainError('paid_activity_unchanged'),
  )
  assert.throws(
    () =>
      planPaidActivityUpdate(
        { ...activity, status: 'cancelled' },
        { capacity: 3 },
        { activeCount: 0 },
      ),
    isDomainError('paid_activity_cancelled', 'conflict'),
  )
  assert.throws(() => planPaidActivityUpdate(activity, { feeCents: 1 }, { activeCount: 0 }))
  assert.throws(() => planPaidActivityUpdate(activity, {}, { activeCount: 0 }))

  assert.equal(
    planPaidActivityCancel(activity, { reason: 'Hava muhalefeti' }).reason,
    'Hava muhalefeti',
  )
  assert.throws(() => planPaidActivityCancel(activity, { reason: 'kısa' }))
  assert.throws(
    () => planPaidActivityCancel({ status: 'cancelled' }, { reason: 'Hava muhalefeti' }),
    isDomainError('paid_activity_cancelled', 'conflict'),
  )
})

test('DOM-FIN-098, K-301: katılım öğrenciye sözleşmesiz etkinlik taksiti açar', () => {
  const { state, plan } = joined()
  const invoice = state.invoices.at(-1)
  assert.ok(invoice)
  assert.equal(invoice.id, plan.invoiceId)
  assert.equal(invoice.feeKind, ACTIVITY_FEE_KIND)
  assert.equal(invoice.amount, INPUT.feeCents)
  assert.equal(invoice.dueDate, '2026-10-10T09:00:00.000Z')
  assert.equal(invoice.paidAt, null)
  assert.equal('contractId' in invoice, false)
  const highest = Math.max(
    ...SEED.invoices
      .filter((item) => item.studentId === STUDENT_ID)
      .map((item) => item.installment),
  )
  assert.equal(invoice.installment, highest + 1)
  assert.equal(plan.feeCents, INPUT.feeCents)
})

test('DOM-FIN-098, K-301: kapalı, dolu, mükerrer ve geçersiz katılımda taksit yazılmaz', () => {
  const reject = (
    activity: PaidActivityTerms,
    input: unknown,
    active: string[],
    code: string,
    kind = 'rule',
    today = TODAY,
  ) => {
    const state = freshState()
    const before = structuredClone(state.invoices)
    assert.throws(
      () =>
        applyPaidActivityJoin(state, activity, input, {
          today,
          activeStudentIds: new Set(active),
          makeId,
          institutionType: 'language_school',
        }),
      isDomainError(code, kind),
    )
    assert.deepEqual(state.invoices, before)
  }
  reject(
    terms({ status: 'cancelled' }),
    { studentId: STUDENT_ID },
    [],
    'paid_activity_cancelled',
    'conflict',
  )
  reject(terms(), { studentId: STUDENT_ID }, [], 'paid_activity_join_closed', 'rule', '2026-10-11')
  reject(terms(), { studentId: 'yok' }, [], 'paid_activity_student_not_found')
  reject(
    terms(),
    { studentId: STUDENT_ID },
    [STUDENT_ID],
    'paid_activity_participant_exists',
    'conflict',
  )
  reject(
    terms({ capacity: 1 }),
    { studentId: STUDENT_ID },
    ['s-other'],
    'paid_activity_full',
    'conflict',
  )
  const state = freshState()
  const target = state.students.find((item) => item.id === STUDENT_ID)
  assert.ok(target)
  Object.assign(target, { isActive: false })
  assert.throws(
    () =>
      applyPaidActivityJoin(
        state,
        terms(),
        { studentId: STUDENT_ID },
        {
          today: TODAY,
          activeStudentIds: new Set(),
          makeId,
        },
      ),
    isDomainError('paid_activity_student_not_found'),
  )
  assert.throws(() =>
    applyPaidActivityJoin(
      freshState(),
      terms(),
      { studentId: '' },
      {
        today: TODAY,
        activeStudentIds: new Set(),
        makeId,
      },
    ),
  )
})

test('DOM-FIN-098, K-302: kesinti son iptal gününe kadar sıfır, sonra oran ya da masraf', () => {
  const percent = terms()
  assert.equal(retainedOnCancel(percent, '2026-10-12', 'participant'), 0)
  assert.equal(retainedOnCancel(percent, '2026-10-13', 'participant'), 75_000)
  assert.equal(retainedOnCancel(percent, '2026-10-13', 'activity'), 0)
  assert.equal(
    retainedOnCancel(terms({ lateRefundPercent: 0 }), '2026-10-13', 'participant'),
    150_000,
  )
  assert.equal(retainedOnCancel(terms({ lateRefundPercent: 100 }), '2026-10-13', 'participant'), 0)
  // İade edilen kısım kuruşa yuvarlanır; kesinti kalan kısımdır.
  assert.equal(
    retainedOnCancel(terms({ lateRefundPercent: 33 }), '2026-10-13', 'participant', 1001),
    671,
  )
  const cost = terms({ lateRefundRule: 'cost', lateRefundPercent: null, lateCostCents: 40_000 })
  assert.equal(retainedOnCancel(cost, '2026-10-13', 'participant'), 40_000)
  assert.equal(retainedOnCancel(cost, '2026-10-13', 'participant', 30_000), 30_000)
})

function cancelled(
  options: { paid?: number; fully?: boolean; today?: string; kind?: 'participant' | 'activity' },
  activity = terms(),
) {
  const { state, plan } = joined(activity)
  const invoice = state.invoices.find((item) => item.id === plan.invoiceId)
  assert.ok(invoice)
  if (options.fully) Object.assign(invoice, { paidAt: `${TODAY}T10:00:00.000Z`, method: 'Nakit' })
  const result = applyParticipationCancel(
    state,
    activity,
    {
      studentId: STUDENT_ID,
      status: 'active',
      invoiceId: plan.invoiceId,
      feeCents: INPUT.feeCents,
    },
    {
      today: options.today ?? TODAY,
      kind: options.kind ?? 'participant',
      allocated: new Map([[plan.invoiceId, options.paid ?? 0]]),
      makeId,
    },
  )
  return { state, plan, result }
}

test('DOM-FIN-098, K-302: süresinde iptalde ödenmemiş taksit kapanır, iade yok', () => {
  const { state, plan, result } = cancelled({})
  assert.equal(
    state.invoices.some((item) => item.id === plan.invoiceId),
    false,
  )
  assert.deepEqual(
    { ...result },
    {
      cancelKind: 'participant',
      cancelledDate: TODAY,
      retainedCents: 0,
      paidCents: 0,
      refundCents: 0,
      closedInvoiceId: plan.invoiceId,
      debtInvoiceId: null,
    },
  )
})

test('DOM-FIN-098, K-302: tam ödenmiş taksit kalır, süresinde tam, geç iptalde oran kadar iade', () => {
  const early = cancelled({ fully: true })
  assert.ok(early.state.invoices.some((item) => item.id === early.plan.invoiceId))
  assert.equal(early.result.refundCents, INPUT.feeCents)
  assert.equal(early.result.closedInvoiceId, null)
  const late = cancelled({ fully: true, today: '2026-10-15' })
  assert.equal(late.result.retainedCents, 75_000)
  assert.equal(late.result.refundCents, 75_000)
  assert.equal(late.result.debtInvoiceId, null)
})

test('DOM-FIN-098, K-302: geç iptalde kısmi ödeme kesintiden azsa fark yeni taksit, fazlaysa iade', () => {
  const short = cancelled({ paid: 30_000, today: '2026-10-15' })
  assert.equal(short.result.paidCents, 30_000)
  assert.equal(short.result.refundCents, 0)
  assert.ok(short.result.debtInvoiceId)
  const debt = short.state.invoices.find((item) => item.id === short.result.debtInvoiceId)
  assert.equal(debt?.amount, 45_000)
  assert.equal(debt?.feeKind, ACTIVITY_FEE_KIND)
  assert.equal(debt?.dueDate, '2026-10-15T09:00:00.000Z')
  assert.equal(
    short.state.invoices.some((item) => item.id === short.plan.invoiceId),
    false,
  )

  const over = cancelled({ paid: 100_000, today: '2026-10-15' })
  assert.equal(over.result.refundCents, 25_000)
  assert.equal(over.result.debtInvoiceId, null)

  const lateUnpaid = cancelled(
    { today: '2026-10-15' },
    terms({ lateRefundRule: 'cost', lateRefundPercent: null, lateCostCents: 20_000 }),
  )
  assert.equal(lateUnpaid.result.retainedCents, 20_000)
  assert.equal(
    lateUnpaid.state.invoices.find((item) => item.id === lateUnpaid.result.debtInvoiceId)?.amount,
    20_000,
  )
})

test('DOM-FIN-098, K-302: kurum iptalinde geç olsa da tam iade', () => {
  const { result } = cancelled({ paid: 100_000, today: '2026-10-19', kind: 'activity' })
  assert.equal(result.retainedCents, 0)
  assert.equal(result.refundCents, 100_000)
  assert.equal(result.cancelKind, 'activity')
})

test('DOM-FIN-098, K-302: iptal edilmiş katılım ve kayıp taksit reddedilir, State değişmez', () => {
  const { state, plan } = joined()
  const before = structuredClone(state.invoices)
  const participation = {
    studentId: STUDENT_ID,
    status: 'cancelled' as const,
    invoiceId: plan.invoiceId,
    feeCents: INPUT.feeCents,
  }
  const context = { today: TODAY, kind: 'participant' as const, allocated: new Map(), makeId }
  assert.throws(
    () => applyParticipationCancel(state, terms(), participation, context),
    isDomainError('paid_activity_participation_cancelled', 'conflict'),
  )
  assert.throws(
    () =>
      applyParticipationCancel(
        state,
        terms(),
        { ...participation, status: 'active', invoiceId: 'yok' },
        context,
      ),
    isDomainError('paid_activity_invoice_missing', 'conflict'),
  )
  assert.deepEqual(state.invoices, before)
})

test('DOM-FIN-098, K-303: iade ödemesi ayrılış kurallarıyla; hesap sahibi veli ya da öğrenci', () => {
  const parent = SEED.parents.find((item) => item.id === STUDENT?.parentId)
  assert.ok(parent && STUDENT)
  assert.equal(activityPayerName(STUDENT, parent), parent.name)
  assert.equal(activityPayerName(STUDENT, undefined), STUDENT.name)
  assert.equal(activityPayerName(undefined, undefined), '')

  const row = {
    refundCents: 75_000,
    refundPaidDate: null,
    cancelledDate: '2026-10-05',
    payerName: parent.name,
  }
  const body = {
    paidDate: TODAY,
    iban: IBAN,
    accountHolder: parent.name,
    bankAccountId: BANK,
  }
  const context = { today: TODAY, bankAccountIds: [BANK], dayClosed: false }
  assert.equal(planParticipationRefund(row, body, context).bankAccountId, BANK)
  assert.throws(
    () => planParticipationRefund(row, { ...body, paidDate: '2026-10-04' }, context),
    isDomainError('paid_activity_refund_before_cancel'),
  )
  assert.throws(
    () => planParticipationRefund(row, { ...body, accountHolder: 'Başka Kişi' }, context),
    isDomainError('refund_holder_mismatch'),
  )
  assert.throws(
    () => planParticipationRefund(row, body, { ...context, dayClosed: true }),
    isDomainError('finance_day_closed'),
  )
  assert.throws(
    () => planParticipationRefund({ ...row, refundCents: 0 }, body, context),
    isDomainError('paid_activity_refund_not_due', 'conflict'),
  )
  assert.throws(
    () => planParticipationRefund({ ...row, cancelledDate: null }, body, context),
    isDomainError('paid_activity_refund_not_due', 'conflict'),
  )
  assert.throws(
    () => planParticipationRefund({ ...row, refundPaidDate: TODAY }, body, context),
    isDomainError('refund_already_paid', 'conflict'),
  )
})

test('DOM-FIN-098: ödeme ve iade durumu türetilir; etkinlik kalemi tarife türü değildir', () => {
  assert.equal(participationPaymentStatus(100, 0), 'unpaid')
  assert.equal(participationPaymentStatus(100, 40), 'partial')
  assert.equal(participationPaymentStatus(100, 100), 'paid')
  assert.equal(participationRefundStatus({ refundCents: 0, refundPaidDate: null }), 'none')
  assert.equal(participationRefundStatus({ refundCents: 5, refundPaidDate: null }), 'pending')
  assert.equal(participationRefundStatus({ refundCents: 5, refundPaidDate: TODAY }), 'paid')
  assert.equal((FEE_ITEM_KINDS as readonly string[]).includes(ACTIVITY_FEE_KIND), false)
  assert.equal(INVOICE_FEE_KINDS.includes(ACTIVITY_FEE_KIND), true)
  assert.equal(INVOICE_FEE_KIND_LABELS.activity, 'Gezi ve etkinlik')
})

test('DOM-FIN-098, K-302: iptal edilen katılımın taksitine alınan tahsilat iptal edilemez', () => {
  const state = freshState()
  const before = structuredClone(state.invoices)
  const payment = {
    reversedAt: null,
    allocations: [{ invoiceId: 'inv-activity', amountCents: 100 }],
    activityInvoiceIds: new Set(['inv-activity']),
  }
  assert.throws(
    () => reversePayment(state as never, payment, { reason: 'Yanlış kayıt' }),
    isDomainError('payment_activity_cancelled', 'conflict'),
  )
  assert.deepEqual(state.invoices, before)
  assert.deepEqual(
    reversePayment(
      state as never,
      { ...payment, activityInvoiceIds: new Set() },
      {
        reason: 'Yanlış kayıt',
      },
    ),
    { reason: 'Yanlış kayıt' },
  )
})
