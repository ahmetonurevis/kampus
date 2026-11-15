import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed } from '../packages/school-core/src/data/seed.ts'
import {
  applyFreeTuitionBoard,
  applyFreeTuitionWaiver,
  assertContractNotFreeTuition,
  createFreeTuitionApplicationSchema,
  freeTuitionContractSet,
  freeTuitionDecisionCounts,
  freeTuitionMinimumQuota,
  freeTuitionRefundDueDate,
  freeTuitionRefundStatus,
  planFreeTuitionApplication,
  planFreeTuitionBoard,
  planFreeTuitionDocuments,
  planFreeTuitionMebbis,
  planFreeTuitionQuota,
  planFreeTuitionRefund,
  planFreeTuitionRound,
  recordFreeTuitionBoardSchema,
  type FreeTuitionStatus,
} from '../packages/school-core/src/lib/finance-free-tuition.ts'
import { reversePayment } from '../packages/school-core/src/lib/payments.ts'
import { quoteWithdrawal } from '../packages/school-core/src/lib/withdrawals.ts'
import { isDomainError } from './support/domain-error.ts'

const NOW = '2026-10-06T09:00:00.000Z'
const TODAY = '2026-10-06'
const IBAN = 'TR330006100519786457841326'
const ACCOUNT_ID = '7c3e9a1b-4d2f-4e8a-b6c5-2f1e0d9c8b7a'
const APP_A = '0b8f2c4e-1d3a-4c5b-9e7f-6a5b4c3d2e1f'
const APP_B = '1c9e3d5f-2e4b-4d6c-8f0a-7b6c5d4e3f20'
const MEMBERS = [
  { name: 'Ayten Demir', title: 'Müdür (başkan)' },
  { name: 'Selin Kaya', title: 'Öğretmen' },
  { name: 'Murat Şen', title: 'Rehber öğretmen' },
]

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
    { ...invoice('t-1', 1, 4_000_000), paidAt: '2026-09-10T09:00:00.000Z', method: 'Havale' },
    invoice('t-2', 2, 3_000_000),
    invoice('t-3', 3, 3_000_000),
    invoice('t-meal', 4, 1_000_000, 'meal'),
    invoice('t-old', 5, 2_000_000),
  ]
  state.contracts = [
    {
      id: 'c-old',
      studentId: student.id,
      date: '2025-06-01T09:00:00.000Z',
      amount: 2_000_000,
      title: 'Geçen yıl',
      invoiceIds: ['t-old'],
      netCents: 2_000_000,
      academicYear: 2025,
    },
    {
      id: 'c-now',
      studentId: student.id,
      date: '2026-06-01T09:00:00.000Z',
      amount: 11_000_000,
      title: 'Bu yıl',
      invoiceIds: ['t-1', 't-2', 't-3', 't-meal'],
      netCents: 10_000_000,
      academicYear: 2026,
      payer: 'guardian',
    },
  ]
  state.renewals = []
  return { state, studentId: student.id }
}

test('DOM-FIN-026: en az kontenjan öğrenci sayısının %3ü, 0,5 yukarı yuvarlanır', () => {
  assert.equal(freeTuitionMinimumQuota(100), 3)
  assert.equal(freeTuitionMinimumQuota(117), 4)
  assert.equal(freeTuitionMinimumQuota(116), 3)
  assert.equal(freeTuitionMinimumQuota(0), 0)
})

test('K-268: dönem eğitim yılı başına bir kez açılır', () => {
  const input = { academicYear: 2026, teachingStartDate: '2026-09-08' }
  assert.deepEqual(planFreeTuitionRound(input, [2025]), input)
  assert.throws(
    () => planFreeTuitionRound(input, [2026]),
    isDomainError('free_tuition_round_exists', 'conflict'),
  )
  assert.throws(() => planFreeTuitionRound({ ...input, teachingStartDate: '2026-02-30' }, []))
})

test('K-268: kontenjan hesaplanan sayının ve kabul sayısının altına inemez', () => {
  assert.deepEqual(
    planFreeTuitionQuota({ confirmedQuota: 5 }, { studentCount: 100, acceptedCount: 0 }),
    {
      confirmedQuota: 5,
      studentCount: 100,
      computedQuota: 3,
    },
  )
  assert.throws(
    () => planFreeTuitionQuota({ confirmedQuota: 2 }, { studentCount: 100, acceptedCount: 0 }),
    isDomainError('free_tuition_quota_below_minimum'),
  )
  assert.throws(
    () => planFreeTuitionQuota({ confirmedQuota: 3 }, { studentCount: 100, acceptedCount: 4 }),
    isDomainError('free_tuition_quota_below_accepted'),
  )
  assert.equal(
    planFreeTuitionQuota(
      { confirmedQuota: 10 },
      { studentCount: 100, acceptedCount: 0, basisPoints: 1000 },
    ).computedQuota,
    10,
  )
})

test('K-269: aday sabit gerekçe ve belge listesiyle; mükerrer, bursu olan ve pasif öğrenci reddedilir', () => {
  const { state, studentId } = fixture()
  const empty = { applicantStudentIds: new Set<string>(), scholarshipStudentIds: new Set<string>() }
  const input = { studentId, reason: 'financial_need', documents: ['application_form'] }
  assert.deepEqual(planFreeTuitionApplication(state, input, empty), input)
  assert.deepEqual(
    planFreeTuitionApplication(state, { studentId, reason: 'other' }, empty).documents,
    [],
  )
  assert.throws(
    () =>
      planFreeTuitionApplication(state, input, {
        ...empty,
        applicantStudentIds: new Set([studentId]),
      }),
    isDomainError('free_tuition_application_exists', 'conflict'),
  )
  assert.throws(
    () =>
      planFreeTuitionApplication(state, input, {
        ...empty,
        scholarshipStudentIds: new Set([studentId]),
      }),
    isDomainError('free_tuition_scholarship_conflict'),
  )
  assert.throws(
    () => planFreeTuitionApplication(state, { ...input, studentId: 'yok' }, empty),
    isDomainError('student_not_found', 'not_found'),
  )
  state.students[0]!.isActive = false
  assert.throws(
    () => planFreeTuitionApplication(state, input, empty),
    isDomainError('student_not_found', 'not_found'),
  )
  // Serbest metin ve tanımsız belge alınmaz (KVKK: en az veri).
  assert.equal(
    createFreeTuitionApplicationSchema.safeParse({ ...input, note: 'Aile geliri düşük' }).success,
    false,
  )
  assert.equal(
    createFreeTuitionApplicationSchema.safeParse({ ...input, documents: ['tapu'] }).success,
    false,
  )
  assert.equal(
    createFreeTuitionApplicationSchema.safeParse({
      ...input,
      documents: ['report_card', 'report_card'],
    }).success,
    false,
  )
})

test('K-269: belge işaretleri karar verilene kadar değişir', () => {
  const input = { documents: ['income_statement'] }
  assert.deepEqual(planFreeTuitionDocuments({ status: 'pending' }, input), input)
  assert.deepEqual(planFreeTuitionDocuments({ status: 'reserve' }, input), input)
  for (const status of ['accepted', 'rejected'] as const)
    assert.throws(
      () => planFreeTuitionDocuments({ status }, input),
      isDomainError('free_tuition_application_decided', 'conflict'),
    )
})

test('K-270: kurul kararı kontenjan, gün, aday durumu ve kabul sayısıyla denetlenir', () => {
  const applications = new Map<string, { status: FreeTuitionStatus; studentId: string }>([
    [APP_A, { status: 'pending', studentId: 's-a' }],
    [APP_B, { status: 'reserve', studentId: 's-b' }],
  ])
  const input = {
    meetingDate: TODAY,
    members: MEMBERS,
    decisions: [
      { applicationId: APP_A, decision: 'accepted' },
      { applicationId: APP_B, decision: 'reserve' },
    ],
  }
  const context = { today: TODAY, applications, acceptedCount: 0 }
  assert.equal(planFreeTuitionBoard({ confirmedQuota: 1 }, input, context).decisions.length, 2)
  assert.throws(
    () => planFreeTuitionBoard({ confirmedQuota: null }, input, context),
    isDomainError('free_tuition_quota_not_confirmed'),
  )
  assert.throws(
    () =>
      planFreeTuitionBoard({ confirmedQuota: 1 }, { ...input, meetingDate: '2026-10-07' }, context),
    isDomainError('free_tuition_date_future'),
  )
  assert.throws(
    () => planFreeTuitionBoard({ confirmedQuota: 1 }, input, { ...context, acceptedCount: 1 }),
    isDomainError('free_tuition_quota_exceeded'),
  )
  assert.throws(
    () =>
      planFreeTuitionBoard({ confirmedQuota: 3 }, input, {
        ...context,
        applications: new Map([[APP_A, { status: 'accepted', studentId: 's-a' }]]),
      }),
    isDomainError('free_tuition_application_decided', 'conflict'),
  )
  assert.throws(
    () =>
      planFreeTuitionBoard({ confirmedQuota: 3 }, input, {
        ...context,
        applications: new Map([[APP_A, { status: 'pending', studentId: 's-a' }]]),
      }),
    isDomainError('free_tuition_application_not_found', 'not_found'),
  )
  assert.equal(
    recordFreeTuitionBoardSchema.safeParse({ ...input, members: MEMBERS.slice(0, 2) }).success,
    false,
  )
  assert.equal(
    recordFreeTuitionBoardSchema.safeParse({
      ...input,
      decisions: [input.decisions[0], input.decisions[0]],
    }).success,
    false,
  )
  assert.deepEqual(
    freeTuitionDecisionCounts([
      { decision: 'accepted' },
      { decision: 'reserve' },
      { decision: 'reserve' },
    ]),
    { accepted: 1, reserve: 2, rejected: 0 },
  )
})

test('DOM-FIN-026, K-270: kabulde açık öğrenim taksitleri kapanır, alınan öğrenim ücreti iade olur', () => {
  const { state, studentId } = fixture()
  // t-2 kısmen ödenmiş: ödenen kısmı iadeye, kalanı vazgeçilen alacağa girer.
  const waiver = applyFreeTuitionWaiver(state, studentId, 2026, {
    allocated: new Map([['t-2', 1_000_000]]),
  })
  assert.deepEqual(waiver, {
    contractIds: ['c-now'],
    contractId: 'c-now',
    cancelledInvoiceIds: ['t-2', 't-3'],
    refundedInvoiceIds: ['t-1', 't-2'],
    waivedCents: 5_000_000,
    refundCents: 5_000_000,
  })
  assert.deepEqual(
    state.invoices.map((invoice) => invoice.id),
    ['t-1', 't-meal', 't-old'],
  )
  const contract = state.contracts.find((item) => item.id === 'c-now')!
  assert.deepEqual(contract.invoiceIds, ['t-1', 't-meal'])
  // Geçen yılın sözleşmesi ve ek hizmet dokunulmaz.
  assert.deepEqual(state.contracts.find((item) => item.id === 'c-old')!.invoiceIds, ['t-old'])
})

test('K-270: sözleşmesi olmayan ya da ek protokolü onay bekleyen öğrenciye uygulanmaz; State değişmez', () => {
  const { state, studentId } = fixture()
  const before = structuredClone(state.invoices)
  assert.throws(
    () => applyFreeTuitionWaiver(state, studentId, 2027, { allocated: new Map() }),
    isDomainError('free_tuition_contract_missing'),
  )
  assert.throws(
    () =>
      applyFreeTuitionWaiver(state, studentId, 2027, {
        allocated: new Map(),
        institutionType: 'language_school',
      }),
    (error: unknown) => error instanceof Error && error.message.startsWith('Kursiyerin'),
  )
  state.contracts.push({
    id: 'c-amend',
    studentId,
    date: '2026-09-20T09:00:00.000Z',
    amount: 9_000_000,
    title: 'Ek protokol',
    invoiceIds: [],
    netCents: 9_000_000,
    academicYear: 2026,
    amendsContractId: 'c-now',
    revision: 2,
  })
  assert.throws(
    () => applyFreeTuitionWaiver(state, studentId, 2026, { allocated: new Map() }),
    isDomainError('free_tuition_amendment_pending', 'conflict'),
  )
  assert.deepEqual(state.invoices, before)
})

test('DOM-FIN-026: iade son günü öğretim başlangıcından iki ay sonra; geç kararda kabul günü', () => {
  assert.equal(freeTuitionRefundDueDate('2026-09-08', '2026-10-01'), '2026-11-08')
  assert.equal(freeTuitionRefundDueDate('2026-12-31', '2027-01-05'), '2027-02-28')
  assert.equal(freeTuitionRefundDueDate('2026-09-08', '2026-12-01'), '2026-12-01')
  assert.equal(freeTuitionRefundStatus({ refundCents: 0, refundPaidDate: null }), 'none')
  assert.equal(freeTuitionRefundStatus({ refundCents: 10, refundPaidDate: null }), 'pending')
  assert.equal(freeTuitionRefundStatus({ refundCents: 10, refundPaidDate: TODAY }), 'paid')
})

test('K-270: iade ödemesi ayrılış iadesinin kurallarıyla, kabul gününden önce olamaz', () => {
  const award = {
    refundCents: 5_000_000,
    refundPaidDate: null,
    acceptedDate: '2026-10-01',
    payerName: 'Ayşe Yılmaz',
  }
  const context = { today: TODAY, bankAccountIds: [ACCOUNT_ID], dayClosed: false }
  const input = {
    paidDate: '2026-10-02',
    iban: IBAN,
    accountHolder: 'ayşe  yılmaz',
    bankAccountId: ACCOUNT_ID,
  }
  assert.equal(planFreeTuitionRefund(award, input, context).paidDate, '2026-10-02')
  assert.throws(
    () => planFreeTuitionRefund(award, { ...input, paidDate: '2026-09-30' }, context),
    isDomainError('free_tuition_refund_before_award'),
  )
  assert.throws(
    () => planFreeTuitionRefund({ ...award, refundCents: 0 }, input, context),
    isDomainError('free_tuition_refund_not_due', 'conflict'),
  )
  assert.throws(
    () => planFreeTuitionRefund({ ...award, refundPaidDate: '2026-10-02' }, input, context),
    isDomainError('refund_already_paid', 'conflict'),
  )
  assert.throws(
    () => planFreeTuitionRefund(award, { ...input, accountHolder: 'Başka Kişi' }, context),
    isDomainError('refund_holder_mismatch'),
  )
  assert.throws(
    () => planFreeTuitionRefund(award, input, { ...context, dayClosed: true }),
    isDomainError('finance_day_closed'),
  )
})

test('K-271: MEBBİS günü bir kez, kabul gününden önce ve gelecekte olamaz', () => {
  const award = { mebbisRecordedDate: null, acceptedDate: '2026-10-01' }
  assert.deepEqual(planFreeTuitionMebbis(award, { recordedDate: TODAY }, TODAY), {
    recordedDate: TODAY,
  })
  assert.throws(
    () => planFreeTuitionMebbis(award, { recordedDate: '2026-10-07' }, TODAY),
    isDomainError('free_tuition_date_future'),
  )
  assert.throws(
    () => planFreeTuitionMebbis(award, { recordedDate: '2026-09-30' }, TODAY),
    isDomainError('free_tuition_mebbis_before_award'),
  )
  assert.throws(
    () =>
      planFreeTuitionMebbis(
        { ...award, mebbisRecordedDate: TODAY },
        { recordedDate: TODAY },
        TODAY,
      ),
    isDomainError('free_tuition_mebbis_recorded', 'conflict'),
  )
})

test('K-270: kapsanan sözleşmeye ek protokol açılmaz', () => {
  const covered = freeTuitionContractSet([{ contractIds: ['c-now'] }])
  assert.throws(
    () => assertContractNotFreeTuition('c-now', covered),
    isDomainError('contract_free_tuition'),
  )
  assert.doesNotThrow(() => assertContractNotFreeTuition('c-old', covered))
})

test('K-270: iadeye giren taksitin tahsilatı iptal edilemez', () => {
  const { state } = fixture()
  const payment = { reversedAt: null, allocations: [{ invoiceId: 't-1', amountCents: 4_000_000 }] }
  const input = { reason: 'Yanlış kayıt düzeltmesi' }
  assert.throws(
    () => reversePayment(state, { ...payment, freeTuitionInvoiceIds: new Set(['t-1']) }, input),
    isDomainError('payment_free_tuition_refunded', 'conflict'),
  )
  assert.equal(state.invoices[0]!.paidAt, '2026-09-10T09:00:00.000Z')
  reversePayment(state, { ...payment, freeTuitionInvoiceIds: new Set(['t-9']) }, input)
  assert.equal(state.invoices[0]!.paidAt, null)
})

test('K-270: ücretsiz okutmalı sözleşmede ayrılış öğrenim ücreti istemez, iadeyi yinelemez', () => {
  const { state, studentId } = fixture()
  applyFreeTuitionWaiver(state, studentId, 2026, { allocated: new Map() })
  const input = {
    withdrawalDate: '2026-10-05',
    termStartDate: '2026-09-07',
    attendedUnits: 20,
    totalUnits: 180,
  }
  const base = {
    institutionType: 'school' as const,
    allocated: new Map(),
    creditCents: 0,
    now: NOW,
  }
  const free = quoteWithdrawal(state, studentId, input, {
    ...base,
    freeTuitionContractIds: new Set(['c-now']),
  })
  const line = free.breakdown.contracts?.find((item) => item.contractId === 'c-now')
  assert.equal(line?.paidCents, 0)
  assert.equal(line?.entitledCents, 0)
  const normal = quoteWithdrawal(state, studentId, input, base)
  assert.ok(normal.breakdown.refundCents > free.breakdown.refundCents)
})

test('K-270: kurul kararı kabul edilenlere hak planı üretir; hatalı satır yolu gösterir, State değişmez', () => {
  const { state, studentId } = fixture()
  const round = { confirmedQuota: 2, academicYear: 2026, teachingStartDate: '2026-09-08' }
  const applications = new Map<string, { status: FreeTuitionStatus; studentId: string }>([
    [APP_A, { status: 'pending', studentId }],
    [APP_B, { status: 'pending', studentId: 's-yok' }],
  ])
  const input = {
    meetingDate: '2026-10-01',
    members: MEMBERS,
    decisions: [
      { applicationId: APP_B, decision: 'rejected' },
      { applicationId: APP_A, decision: 'accepted' },
    ],
  }
  const context = {
    today: TODAY,
    applications,
    acceptedCount: 0,
    allocated: new Map<string, number>(),
    scholarshipStudentIds: new Set<string>(),
  }
  const before = structuredClone(state.invoices)
  assert.throws(
    () =>
      applyFreeTuitionBoard(state, round, input, {
        ...context,
        scholarshipStudentIds: new Set([studentId]),
      }),
    (error: unknown) =>
      isDomainError('free_tuition_scholarship_conflict')(error) &&
      (error as { path: string[] }).path.join('.') === 'decisions.1.decision',
  )
  assert.throws(
    () => applyFreeTuitionBoard(state, { ...round, academicYear: 2027 }, input, context),
    (error: unknown) =>
      isDomainError('free_tuition_contract_missing')(error) &&
      (error as { path: string[] }).path.join('.') === 'decisions.1.decision',
  )
  assert.deepEqual(state.invoices, before)
  const result = applyFreeTuitionBoard(state, round, input, context)
  assert.equal(result.awards.length, 1)
  assert.equal(result.awards[0]?.applicationId, APP_A)
  assert.equal(result.awards[0]?.refundDueDate, '2026-11-08')
  assert.equal(result.awards[0]?.refundCents, 4_000_000)
})
