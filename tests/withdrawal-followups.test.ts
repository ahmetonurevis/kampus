import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { scholarshipEndClawbackInvoiceIds } from '../packages/school-core/src/lib/finance-scholarship-revocation.ts'
import { dateLabel, money } from '../packages/school-core/src/lib/format.ts'
import {
  quoteWithdrawalWithFollowups,
  withdrawalFollowupSections,
  withdrawStudentWithFollowups,
  type WithdrawalActivityParticipation,
  type WithdrawalFollowupContext,
} from '../packages/school-core/src/lib/withdrawal-followups.ts'
import {
  quoteWithdrawal,
  scholarshipEndAtWithdrawal,
  withdrawStudent,
  type WithdrawalScholarshipEnd,
} from '../packages/school-core/src/lib/withdrawals.ts'
import { isDomainError } from './support/domain-error.ts'

// ON-342: ayrılış hesabında kesilen ya da geri istenen burs (K-350, K-351) ve gezi/etkinlik
// katılımları (K-348, K-349). Tutarlar kuruştur.

const NOW = '2026-10-06T09:00:00.000Z'
const NET = 10_000_000
const DUE = '2026-09-15T09:00:00.000Z'

type Invoice = ReturnType<typeof createSeed>['invoices'][number]

function fixture() {
  const state = createSeed(new Date(NOW))
  const student = state.students[0]!
  const invoice = (
    id: string,
    installment: number,
    amount: number,
    feeKind = 'tuition',
    extra: Partial<Invoice> = {},
  ): Invoice => ({
    id,
    studentId: student.id,
    installment,
    amount,
    dueDate: DUE,
    paidAt: null,
    method: null,
    reminderAt: null,
    feeKind,
    ...extra,
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
      scholarship: { programId: 'p1', amountCents: 2_000_000 },
    },
  ]
  state.renewals = []
  return { state, studentId: student.id, invoice }
}

const context = (
  overrides: Partial<WithdrawalFollowupContext> = {},
): WithdrawalFollowupContext => ({
  institutionType: 'school',
  allocated: new Map(),
  creditCents: 0,
  now: NOW,
  ...overrides,
})

/** Öğretim başladıktan sonra, 30/180 gün görülmüş ayrılış. */
const QUOTE = {
  withdrawalDate: '2026-10-05',
  termStartDate: '2026-09-07',
  attendedUnits: 30,
  totalUnits: 180,
}
const WITHDRAW = { ...QUOTE, reason: 'relocation' }
let serial = 0
const makeId = (prefix: string) => `${prefix}-on342-${String(serial++)}`

/** Kesme: 2026-09-30'dan sonraki vadelerde 1.000.000 kuruşluk burs payı kalktı (t-r1). */
function terminated(effectiveDate = '2026-09-30'): WithdrawalScholarshipEnd {
  return {
    awardId: 'aw-1',
    contractId: 'c-now',
    kind: 'terminate',
    effectiveDate,
    reinstatedCents: 1_000_000,
    principalCents: 0,
    interestCents: 0,
    clawbackInvoiceIds: [],
  }
}

/** İptal (gerçek dışı beyan): ileriye 1.000.000, geri isteme anapara 1.000.000 ve faiz 5.000. */
function revoked(): WithdrawalScholarshipEnd {
  return {
    awardId: 'aw-1',
    contractId: 'c-now',
    kind: 'revoke',
    effectiveDate: '2026-10-01',
    reinstatedCents: 1_000_000,
    principalCents: 1_000_000,
    interestCents: 5_000,
    clawbackInvoiceIds: ['cb-p', 'cb-i'],
  }
}

function withReinstated(fx: ReturnType<typeof fixture>) {
  fx.state.invoices.push(fx.invoice('t-r1', 4, 1_000_000, 'tuition', { contractId: 'c-now' }))
  fx.state.contracts[0]!.invoiceIds = [...fx.state.contracts[0]!.invoiceIds!, 't-r1']
}

function withClawback(fx: ReturnType<typeof fixture>) {
  fx.state.invoices.push(
    fx.invoice('cb-p', 5, 1_000_000, 'tuition', { academicYear: 2026 }),
    fx.invoice('cb-i', 6, 5_000, 'tuition', { academicYear: 2026 }),
  )
}

const ACTIVITY_TERMS = {
  activityDate: '2026-10-20',
  cancelDeadline: '2026-10-10',
  lateRefundRule: 'percent' as const,
  lateRefundPercent: 50,
  lateCostCents: null,
  feeCents: 300_000,
}

function participation(
  studentId: string,
  overrides: Partial<WithdrawalActivityParticipation> = {},
  terms: Partial<WithdrawalActivityParticipation['activity']> = {},
): WithdrawalActivityParticipation {
  return {
    participantId: 'pp-1',
    activityId: 'act-1',
    studentId,
    name: 'Müze gezisi',
    status: 'active',
    invoiceId: 'a-1',
    feeCents: 300_000,
    debtInvoiceId: null,
    activity: { ...ACTIVITY_TERMS, ...terms },
    ...overrides,
  }
}

const day = (value: string) => dateLabel(value, { year: 'numeric' })
const allocation = (entries: Record<string, number>) => new Map(Object.entries(entries))

// --- Burs (K-350, K-351) ------------------------------------------------------------------------

test('K-350, DOM-FIN-025: kesilmiş bursta istisna kalkar, kalkan pay tabana eklenir (kuruş)', () => {
  const fx = fixture()
  withReinstated(fx)
  const allocated = allocation({ 't-1': 1_000_000 })
  const burslu = quoteWithdrawal(fx.state, fx.studentId, QUOTE, context({ allocated })).breakdown
  // Burslu: hak edilen ödenenle sınırlı, yalnız yemeğin kullanılan payı borç.
  assert.equal(burslu.scholarshipExempt, true)
  assert.equal(burslu.baseCents, NET)
  assert.equal(burslu.entitledCents, 1_000_000)
  assert.equal(burslu.debtCents, 166_666)

  const { breakdown } = quoteWithdrawal(
    fx.state,
    fx.studentId,
    QUOTE,
    context({ allocated, scholarshipEnds: [terminated()] }),
  )
  const line = breakdown.contracts![0]!
  assert.equal(breakdown.scholarshipExempt, false)
  assert.equal(line.scholarshipExempt, false)
  assert.deepEqual(line.scholarshipEnd, {
    kind: 'terminate',
    effectiveDate: '2026-09-30',
    reinstatedCents: 1_000_000,
  })
  // Taban 10.000.000 + 1.000.000; kesinti %10; kullanım ⌊11.000.000 × 30 / 180⌋.
  assert.equal(breakdown.baseCents, 11_000_000)
  assert.equal(breakdown.deductionCents, 1_100_000)
  assert.equal(breakdown.usageCents, 1_833_333)
  assert.equal(breakdown.entitledCents, 2_933_333)
  assert.equal(breakdown.paidCents, 1_000_000)
  assert.equal(breakdown.refundCents, 0)
  assert.equal(breakdown.debtCents, 1_933_333 + 166_666)
  assert.equal(breakdown.scholarshipClawbacks, undefined)
})

test('K-350: kesme günü burslu sayılır; ertesi günkü ayrılışta istisna kalkar (sınır günü)', () => {
  const fx = fixture()
  withReinstated(fx)
  const allocated = allocation({ 't-1': 1_000_000 })
  const onDay = quoteWithdrawal(
    fx.state,
    fx.studentId,
    QUOTE,
    context({ allocated, scholarshipEnds: [terminated('2026-10-05')] }),
  ).breakdown
  assert.equal(onDay.scholarshipExempt, true)
  assert.equal(onDay.baseCents, NET)
  assert.equal(onDay.contracts![0]!.scholarshipEnd, undefined)
  assert.equal(onDay.debtCents, 166_666)

  const dayBefore = quoteWithdrawal(
    fx.state,
    fx.studentId,
    QUOTE,
    context({ allocated, scholarshipEnds: [terminated('2026-10-04')] }),
  ).breakdown
  assert.equal(dayBefore.scholarshipExempt, false)
  assert.equal(dayBefore.baseCents, 11_000_000)
})

test('K-350: iptal geriye etkilidir; önceki ileri tarihli kesmenin payı da tabana girer', () => {
  const ends = [
    { ...terminated('2026-12-31'), reinstatedCents: 400_000 },
    { ...revoked(), reinstatedCents: 600_000 },
  ]
  assert.deepEqual(scholarshipEndAtWithdrawal(ends, '2026-10-05'), {
    kind: 'revoke',
    effectiveDate: '2026-10-01',
    reinstatedCents: 1_000_000,
  })
  // İptal yokken ileri tarihli kesme ayrılışa girmez.
  assert.equal(scholarshipEndAtWithdrawal([ends[0]!], '2026-10-05'), undefined)
  // Geriye tarihli ayrılış iptal gününden önce olsa da iptal girer.
  assert.equal(scholarshipEndAtWithdrawal([ends[1]!], '2026-09-20')?.kind, 'revoke')
  assert.equal(scholarshipEndAtWithdrawal([], '2026-10-05'), undefined)
})

test('K-351, K-266: geri isteme alacağı ayrı satırdır; bakiyeye ve tabana girmez, ayrılış iptal etmez', () => {
  const fx = fixture()
  withReinstated(fx)
  withClawback(fx)
  const allocated = allocation({ 't-1': 1_000_000, 'cb-p': 400_000 })
  const ctx = context({ allocated, scholarshipEnds: [revoked()] })
  const { breakdown } = quoteWithdrawal(fx.state, fx.studentId, QUOTE, ctx)
  assert.equal(breakdown.scholarshipExempt, false)
  assert.equal(breakdown.contracts![0]!.scholarshipEnd?.kind, 'revoke')
  assert.equal(breakdown.baseCents, 11_000_000)
  // Geri isteme anaparası tabana eklenmez, tahsilatı öğrenim ödemesine girmez: çift sayım yok.
  assert.equal(breakdown.paidCents, 1_000_000)
  assert.equal(breakdown.debtCents, 1_933_333 + 166_666)
  assert.deepEqual(breakdown.scholarshipClawbacks, [
    {
      awardId: 'aw-1',
      contractId: 'c-now',
      effectiveDate: '2026-10-01',
      principalCents: 1_000_000,
      interestCents: 5_000,
      openCents: 600_000 + 5_000,
    },
  ])

  const result = withdrawStudent(fx.state, fx.studentId, WITHDRAW, makeId, ctx)
  const left = new Set(fx.state.invoices.map((invoice) => invoice.id))
  assert.ok(left.has('cb-p') && left.has('cb-i'), 'geri isteme taksitleri kalır')
  assert.ok(!left.has('t-r1'), 'kalkan payın ödenmemiş taksiti diğer açık taksitlerle iptal edilir')
  assert.equal(result.breakdown.debtCents, 1_933_333 + 166_666)
  const debt = fx.state.invoices.find((invoice) => invoice.id === result.breakdown.debtInvoiceId)
  assert.equal(debt?.amount, 1_933_333 + 166_666)
})

test('K-351: ödenmiş geri isteme alacağının açığı sıfırdır; faizsiz kayıt satır açmaz', () => {
  const fx = fixture()
  withClawback(fx)
  fx.state.invoices.find((invoice) => invoice.id === 'cb-p')!.paidAt = NOW
  fx.state.invoices.find((invoice) => invoice.id === 'cb-i')!.paidAt = NOW
  const { breakdown } = quoteWithdrawal(
    fx.state,
    fx.studentId,
    QUOTE,
    context({ scholarshipEnds: [revoked(), terminated()] }),
  )
  assert.equal(breakdown.scholarshipClawbacks?.length, 1)
  assert.equal(breakdown.scholarshipClawbacks?.[0]?.openCents, 0)
})

test('K-349, K-351, DOM-FIN-012: listesi olmayan eski sözleşme etkinlik ve geri isteme taksitini saymaz', () => {
  const fx = fixture()
  delete fx.state.contracts[0]!.invoiceIds
  withClawback(fx)
  fx.state.invoices.push(fx.invoice('a-1', 7, 300_000, 'activity'))
  const allocated = allocation({ 'cb-p': 400_000, 'a-1': 100_000 })
  const ctx = context({ allocated, scholarshipEnds: [revoked()] })
  const { breakdown } = quoteWithdrawal(fx.state, fx.studentId, QUOTE, ctx)
  assert.deepEqual(
    breakdown.extras.map((line) => line.invoiceId),
    ['t-meal'],
  )
  assert.equal(breakdown.paidCents, 0)
  withdrawStudent(fx.state, fx.studentId, WITHDRAW, makeId, ctx)
  const left = new Set(fx.state.invoices.map((invoice) => invoice.id))
  assert.ok(left.has('a-1') && left.has('cb-p') && left.has('cb-i'))
  assert.ok(!left.has('t-1') && !left.has('t-meal'))
})

test('K-269, K-350: ücretsiz okutmalı sözleşmede burs sonu hesabı değiştirmez', () => {
  const fx = fixture()
  withReinstated(fx)
  const { breakdown } = quoteWithdrawal(
    fx.state,
    fx.studentId,
    QUOTE,
    context({ scholarshipEnds: [terminated()], freeTuitionContractIds: new Set(['c-now']) }),
  )
  assert.equal(breakdown.baseCents, NET)
  assert.equal(breakdown.entitledCents, 0)
  assert.equal(breakdown.contracts![0]!.scholarshipEnd, undefined)
})

test('K-351: geri isteme taksitleri kesme kaydının sırasından ayrılır', () => {
  assert.deepEqual(
    scholarshipEndClawbackInvoiceIds({
      invoiceIds: ['r-1', 'r-2', 'p', 'i'],
      lines: [
        { status: 'clawback', shareCents: 500 },
        { status: 'reinstated', shareCents: 300 },
        { status: 'reinstated', shareCents: 0 },
        { status: 'reinstated', shareCents: 200 },
      ],
    }),
    ['p', 'i'],
  )
  assert.deepEqual(
    scholarshipEndClawbackInvoiceIds({
      invoiceIds: ['r-1'],
      lines: [{ status: 'reinstated', shareCents: 300 }],
    }),
    [],
  )
})

// --- Gezi ve etkinlik (K-348, K-349) ------------------------------------------------------------

test('K-348, DOM-FIN-098: son iptal günü içindeki ayrılışta gerçekleşmemiş etkinlik tam iade edilir', () => {
  const fx = fixture()
  fx.state.invoices.push(fx.invoice('a-1', 7, 300_000, 'activity', { paidAt: NOW }))
  const quote = quoteWithdrawalWithFollowups(
    fx.state,
    fx.studentId,
    QUOTE,
    context({
      participations: [participation(fx.studentId, {}, { cancelDeadline: '2026-10-05' })],
    }),
  )
  assert.deepEqual(quote.breakdown.activities, [
    {
      participantId: 'pp-1',
      activityId: 'act-1',
      name: 'Müze gezisi',
      activityDate: '2026-10-20',
      outcome: 'cancelled',
      invoiceId: 'a-1',
      amountCents: 300_000,
      paidCents: 300_000,
      retainedCents: 0,
      refundCents: 300_000,
      openCents: 0,
    },
  ])
  // Etkinlik iadesi ayrılış bakiyesine girmez (K-349).
  const plain = quoteWithdrawal(fx.state, fx.studentId, QUOTE, context())
  assert.equal(quote.breakdown.refundCents, plain.breakdown.refundCents)
  assert.equal(quote.breakdown.debtCents, plain.breakdown.debtCents)
  // Önizleme State'i değiştirmez.
  assert.ok(fx.state.invoices.some((invoice) => invoice.id === 'a-1'))
})

test('K-348: son iptal gününden sonraki ayrılışta etkinliğin kuralı uygulanır; kesinti farkı borçtur (sınır günü)', () => {
  const fx = fixture()
  fx.state.invoices.push(fx.invoice('a-1', 7, 300_000, 'activity'))
  const allocated = allocation({ 'a-1': 100_000 })
  const late = quoteWithdrawalWithFollowups(
    fx.state,
    fx.studentId,
    QUOTE,
    context({
      allocated,
      participations: [participation(fx.studentId, {}, { cancelDeadline: '2026-10-04' })],
    }),
  ).breakdown.activities![0]!
  // %50 iade: kesinti 150.000, alınan 100.000; fark 50.000 borç, iade yok.
  assert.equal(late.retainedCents, 150_000)
  assert.equal(late.paidCents, 100_000)
  assert.equal(late.refundCents, 0)
  assert.equal(late.openCents, 50_000)

  const cost = quoteWithdrawalWithFollowups(
    fx.state,
    fx.studentId,
    QUOTE,
    context({
      allocated,
      participations: [
        participation(
          fx.studentId,
          {},
          {
            cancelDeadline: '2026-10-04',
            lateRefundRule: 'cost',
            lateRefundPercent: null,
            lateCostCents: 40_000,
          },
        ),
      ],
    }),
  ).breakdown.activities![0]!
  assert.equal(cost.retainedCents, 40_000)
  assert.equal(cost.refundCents, 60_000)
  assert.equal(cost.openCents, 0)
})

test('K-348: ayrılış günündeki ve önceki etkinlik gerçekleşmiştir; ödenmemiş kısım borç kalır, ödenmiş satır açmaz', () => {
  const fx = fixture()
  fx.state.invoices.push(
    fx.invoice('a-2', 7, 200_000, 'activity'),
    fx.invoice('a-3', 8, 150_000, 'activity', { paidAt: NOW }),
    fx.invoice('a-d', 9, 40_000, 'activity'),
  )
  const { breakdown } = quoteWithdrawalWithFollowups(
    fx.state,
    fx.studentId,
    QUOTE,
    context({
      allocated: allocation({ 'a-2': 50_000 }),
      participations: [
        participation(
          fx.studentId,
          { participantId: 'pp-2', invoiceId: 'a-2', feeCents: 200_000, name: 'Tiyatro' },
          { activityDate: '2026-10-05', cancelDeadline: '2026-10-01' },
        ),
        participation(
          fx.studentId,
          { participantId: 'pp-3', invoiceId: 'a-3', feeCents: 150_000 },
          { activityDate: '2026-09-20', cancelDeadline: '2026-09-10' },
        ),
        participation(
          fx.studentId,
          {
            participantId: 'pp-4',
            invoiceId: 'a-closed',
            status: 'cancelled',
            debtInvoiceId: 'a-d',
            name: 'Konser',
          },
          { activityDate: '2026-11-01' },
        ),
      ],
    }),
  )
  assert.deepEqual(
    breakdown.activities?.map((line) => [line.participantId, line.outcome, line.openCents]),
    [
      ['pp-2', 'held', 150_000],
      ['pp-4', 'held', 40_000],
    ],
  )
  assert.equal(breakdown.activities?.[1]?.invoiceId, 'a-d')
})

test('K-348, K-349: ayrılış gerçekleşmemiş katılımı aynı işlemde iptal eder; gerçekleşmiş borç kalır', () => {
  const fx = fixture()
  fx.state.invoices.push(
    fx.invoice('a-1', 7, 300_000, 'activity'),
    fx.invoice('a-2', 8, 200_000, 'activity'),
  )
  const allocated = allocation({ 'a-1': 100_000 })
  const participations = [
    participation(fx.studentId, {}, { cancelDeadline: '2026-10-04' }),
    participation(
      fx.studentId,
      { participantId: 'pp-2', invoiceId: 'a-2', feeCents: 200_000, name: 'Tiyatro' },
      { activityDate: '2026-10-01', cancelDeadline: '2026-09-25' },
    ),
  ]
  const plain = withdrawStudent(
    structuredClone(fx.state),
    fx.studentId,
    WITHDRAW,
    makeId,
    context({ allocated }),
  )
  const result = withdrawStudentWithFollowups(
    fx.state,
    fx.studentId,
    WITHDRAW,
    makeId,
    context({ allocated, participations }),
  )
  assert.equal(result.breakdown.refundCents, plain.breakdown.refundCents)
  assert.equal(result.breakdown.debtCents, plain.breakdown.debtCents)
  assert.equal(result.activityCancels.length, 1)
  const [cancel] = result.activityCancels
  assert.equal(cancel?.participantId, 'pp-1')
  assert.equal(cancel?.plan.cancelledDate, '2026-10-05')
  assert.equal(cancel?.plan.closedInvoiceId, 'a-1')
  const left = new Map(fx.state.invoices.map((invoice) => [invoice.id, invoice]))
  assert.ok(!left.has('a-1'), 'iptal edilen katılımın ödenmemiş taksiti kapanır')
  assert.ok(left.has('a-2'), 'gerçekleşmiş etkinliğin taksiti kalır')
  const debt = left.get(cancel?.plan.debtInvoiceId ?? '')
  assert.equal(debt?.amount, 50_000)
  assert.equal(debt?.feeKind, 'activity')
  assert.equal(debt?.contractId, undefined)
  // Satırlar etkinlik gününe göre sıralıdır: önce gerçekleşmiş tiyatro.
  const [held, line] = result.breakdown.activities!
  assert.equal(line?.debtInvoiceId, debt?.id)
  assert.equal(held?.outcome, 'held')
  assert.equal(held?.openCents, 200_000)
})

test('K-395, DOM-FIN-112: yedek ve izin bekleyen katılım ayrılıştan sonraki etkinlikte parasız iptal edilir', () => {
  const fx = fixture()
  fx.state.invoices.push(fx.invoice('a-1', 7, 300_000, 'activity'))
  const seatless = (
    participantId: string,
    status: 'waitlisted' | 'awaiting_consent',
    activityDate: string,
  ) =>
    participation(
      fx.studentId,
      { participantId, activityId: `act-${participantId}`, status, invoiceId: null },
      { activityDate, cancelDeadline: '2026-10-01' },
    )
  const participations = [
    participation(fx.studentId),
    seatless('pp-wait', 'waitlisted', '2026-10-20'),
    seatless('pp-consent', 'awaiting_consent', '2026-10-06'),
    // Sınır: etkinlik ayrılış günü (2026-10-05) ya da önce; katılım değişmez.
    seatless('pp-same', 'waitlisted', '2026-10-05'),
    seatless('pp-past', 'awaiting_consent', '2026-10-01'),
  ]
  const plain = withdrawStudentWithFollowups(
    structuredClone(fx.state),
    fx.studentId,
    WITHDRAW,
    makeId,
    context({ participations: [participation(fx.studentId)] }),
  )
  const invoicesBefore = fx.state.invoices.length
  const result = withdrawStudentWithFollowups(
    fx.state,
    fx.studentId,
    WITHDRAW,
    makeId,
    context({ participations }),
  )
  // Para etkisi yok: döküm yalnız taksitli katılımın satırını taşır.
  assert.deepEqual(result.breakdown, {
    ...plain.breakdown,
    debtInvoiceId: result.breakdown.debtInvoiceId,
  })
  assert.deepEqual(
    result.breakdown.activities?.map((line) => line.participantId),
    ['pp-1'],
  )
  assert.deepEqual(
    result.activityCancels.map((item) => [item.participantId, item.activityId, item.freesSeat]),
    [
      ['pp-consent', 'act-pp-consent', true],
      ['pp-1', 'act-1', true],
      ['pp-wait', 'act-pp-wait', false],
    ],
  )
  for (const cancel of result.activityCancels.filter((item) => item.participantId !== 'pp-1'))
    assert.deepEqual(cancel.plan, {
      cancelKind: 'participant',
      cancelledDate: '2026-10-05',
      paidCents: 0,
      retainedCents: 0,
      refundCents: 0,
      closedInvoiceId: null,
      debtInvoiceId: null,
    })
  // Taksitsiz iptal yeni taksit açmaz; yalnız asilin taksiti kapanır.
  assert.equal(fx.state.invoices.filter((item) => item.feeKind === 'activity').length, 0)
  assert.ok(fx.state.invoices.length <= invoicesBefore)
  // Önizleme de aynı satırları verir, State değişmez.
  const fresh = fixture()
  fresh.state.invoices.push(fresh.invoice('a-1', 7, 300_000, 'activity'))
  const before = structuredClone(fresh.state)
  const quote = quoteWithdrawalWithFollowups(
    fresh.state,
    fresh.studentId,
    QUOTE,
    context({ participations }),
  )
  assert.deepEqual(
    quote.breakdown.activities?.map((line) => line.participantId),
    ['pp-1'],
  )
  assert.deepEqual(fresh.state, before)
})

test('K-348: taksiti bulunamayan katılım ayrılışı yazmadan reddeder; State değişmez', () => {
  const fx = fixture()
  const before = structuredClone(fx.state)
  assert.throws(
    () =>
      withdrawStudentWithFollowups(
        fx.state,
        fx.studentId,
        WITHDRAW,
        makeId,
        context({ participations: [participation(fx.studentId, { invoiceId: 'yok' })] }),
      ),
    isDomainError('paid_activity_invoice_missing', 'conflict'),
  )
  assert.deepEqual(fx.state, before)
})

test('ON-342: kesilen burs, geri isteme ve etkinlik aynı öğrencide birlikte; tutarlar karışmaz', () => {
  const fx = fixture()
  withReinstated(fx)
  withClawback(fx)
  fx.state.invoices.push(fx.invoice('a-1', 7, 300_000, 'activity', { paidAt: NOW }))
  const allocated = allocation({ 't-1': 1_000_000, 'cb-p': 400_000 })
  const ctx = context({
    allocated,
    scholarshipEnds: [terminated('2026-09-20'), { ...revoked(), reinstatedCents: 0 }],
    participations: [participation(fx.studentId)],
  })
  const quote = quoteWithdrawalWithFollowups(fx.state, fx.studentId, QUOTE, ctx)
  assert.equal(quote.breakdown.baseCents, 11_000_000)
  assert.equal(quote.breakdown.debtCents, 1_933_333 + 166_666)
  assert.equal(quote.breakdown.scholarshipClawbacks?.[0]?.openCents, 605_000)
  assert.equal(quote.breakdown.activities?.[0]?.refundCents, 300_000)

  const result = withdrawStudentWithFollowups(fx.state, fx.studentId, WITHDRAW, makeId, ctx)
  assert.deepEqual(
    { ...result.breakdown, debtInvoiceId: undefined },
    { ...quote.breakdown, debtInvoiceId: undefined },
  )
  const sections = withdrawalFollowupSections(result.breakdown)
  assert.deepEqual(
    sections.map((section) => section.title),
    ['Burs', 'Gezi ve etkinlik'],
  )
  assert.deepEqual(sections[0]?.rows, [
    [
      `Burs iptal edildi (${day('2026-10-01')})`,
      `Kalkan pay ${money(1_000_000)} tabana eklendi; burslu istisnası yok`,
    ],
    ['Geri istenen burs', money(1_000_000)],
    ['Kanuni faiz', money(5_000)],
    ['Geri isteme alacağında açık', money(605_000)],
  ])
  assert.ok(sections[0]?.note?.includes('iade ve kalan borca girmez'))
  assert.deepEqual(sections[1]?.rows, [
    [`Müze gezisi (${day('2026-10-20')})`, `Katılım iptal edildi; iade ${money(300_000)}`],
  ])
})

test('IST-110: döküm satırları sonucu söyler; eski kayıtta bölüm yoktur, döküm değişmez', () => {
  const legacy = {
    contracts: [
      {
        contractId: 'c-old',
        title: 'Eski',
        payer: 'guardian' as const,
        attendedUnits: 1,
        totalUnits: 2,
        scholarshipExempt: true,
        baseCents: 1,
        deductionCents: 0,
        usageCents: 0,
        entitledCents: 0,
        paidCents: 0,
        extraBalanceCents: 0,
        balanceCents: 0,
      },
    ],
  }
  assert.deepEqual(withdrawalFollowupSections(legacy), [])
  assert.deepEqual(withdrawalFollowupSections({}), [])
  const line = {
    participantId: 'p',
    activityId: 'a',
    name: 'Gezi',
    activityDate: '2026-10-20',
    invoiceId: 'i',
    amountCents: 300_000,
    paidCents: 0,
    retainedCents: 0,
    refundCents: 0,
    openCents: 0,
  }
  const rows = withdrawalFollowupSections({
    contracts: [
      ...legacy.contracts,
      {
        ...legacy.contracts[0]!,
        contractId: 'c-2',
        title: 'Yeni',
        scholarshipEnd: { kind: 'terminate', effectiveDate: '2026-09-30', reinstatedCents: 0 },
      },
    ],
    activities: [
      { ...line, outcome: 'cancelled' },
      { ...line, outcome: 'cancelled', openCents: 50_000 },
      { ...line, outcome: 'held', openCents: 70_000 },
    ],
  })
  assert.deepEqual(rows[0], {
    title: 'Burs',
    note: null,
    rows: [[`Burs kesildi (${day('2026-09-30')}) · Yeni`, 'Burslu istisnası yok']],
  })
  assert.deepEqual(
    rows[1]?.rows.map(([, value]) => value),
    [
      'Katılım iptal edildi; iade ve borç yok',
      `Katılım iptal edildi; kesinti borcu ${money(50_000)}`,
      `Gerçekleşti; açık borç ${money(70_000)}`,
    ],
  )
})
