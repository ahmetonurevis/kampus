import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import {
  endScholarship,
  quoteScholarshipEnd,
  scholarshipEndNotice,
  scholarshipShareSchedule,
  type PriorScholarshipEnd,
  type ScholarshipEndAward,
} from '../packages/school-core/src/lib/finance-scholarship-revocation.ts'
import { isDomainError } from './support/domain-error.ts'

// Burs kesilmesi ve gerçek dışı beyanda iptal ile geri isteme (DOM-FIN-025; IST-105; ON-283;
// K-264…K-267). Sözleşme: 100.000 ₺ ilan, 30.000 ₺ burs, dört eşit öğrenim taksiti (17.500 ₺) ve
// bir yemek taksiti. Burs payı her taksitte 7.500 ₺'dir.

const NOW = '2026-10-06T09:00:00.000Z'
const PROGRAM = 'prog-test-1'
const SCHOLARSHIP = 3_000_000
const TUITION = 1_750_000
const SHARE = 750_000

let counter = 0
const makeId = (prefix: string) => `${prefix}-test-${String(++counter)}`

function fixture(
  options: { full?: boolean; year?: number; dues?: string[]; approved?: boolean } = {},
) {
  const state: State = createSeed(new Date(NOW))
  const student = state.students[0]!
  const year = options.year ?? 2026
  const dues = options.dues ?? ['2026-09-15', '2026-10-15', '2026-11-15', '2026-12-15']
  const invoice = (
    id: string,
    installment: number,
    amount: number,
    due: string,
    feeKind = 'tuition',
  ) => ({
    id,
    studentId: student.id,
    installment,
    amount,
    dueDate: `${due}T09:00:00.000Z`,
    paidAt: null as string | null,
    method: null as string | null,
    reminderAt: null,
    feeKind,
    contractId: 'contract-test-1',
    academicYear: year,
  })
  const tuition = options.full
    ? []
    : dues.map((due, index) => invoice(`inv-test-${String(index + 1)}`, index + 1, TUITION, due))
  state.invoices = [...tuition, invoice('inv-test-meal', 5, 500_000, dues[0]!, 'meal')]
  const net = options.full ? 0 : TUITION * dues.length
  state.contracts = [
    {
      id: 'contract-test-1',
      studentId: student.id,
      date: `${String(year)}-09-01T09:00:00.000Z`,
      amount: net + 500_000,
      title: 'Özel okul eğitim sözleşmesi',
      invoiceIds: state.invoices.map((item) => item.id),
      academicYear: year,
      tariffId: 'tariff-test-1',
      tariffVersion: 1,
      grossCents: net + (options.full ? 7_000_000 : SCHOLARSHIP),
      netCents: net,
      discounts: [],
      extras: [{ kind: 'meal', amountCents: 500_000 }],
      approvedByUserId: 'u-test-admin',
      payer: 'guardian',
      scholarship: { programId: PROGRAM, amountCents: options.full ? 7_000_000 : SCHOLARSHIP },
      ...(options.approved
        ? {
            signatory: {
              name: 'Test Kurucu',
              role: 'founder' as const,
              recordedAt: NOW,
              recordedByUserId: 'u-test-admin',
            },
            approval: {
              method: 'wet_signature' as const,
              approvedAt: NOW,
              approvedByUserId: 'u-test-admin',
              payerName: 'Test Veli',
              plan: state.invoices.map((item) => ({
                invoiceId: item.id,
                installment: item.installment,
                amount: item.amount,
                dueDate: item.dueDate,
                feeKind: item.feeKind,
              })),
            },
          }
        : {}),
    },
  ]
  state.renewals = []
  const award: ScholarshipEndAward = {
    id: 'award-test-1',
    programId: PROGRAM,
    studentId: student.id,
    academicYear: year,
  }
  return { state, student, award }
}

const context = (prior: PriorScholarshipEnd[] = [], now = NOW) => ({ now, makeId, prior })
const snapshot = (state: State) => JSON.stringify([state.invoices, state.contracts])

test('K-264: burs payı taksitlere orantılı yayılır; kuruş farkı en büyük kalanla önceki vadeye gider', () => {
  const lines = [
    { dueDate: '2026-10-15', amountCents: 100 },
    { dueDate: '2026-09-15', amountCents: 100 },
    { dueDate: '2026-11-15', amountCents: 100 },
  ]
  const shares = scholarshipShareSchedule(1_000_001, lines, 2026)
  assert.deepEqual(shares, [
    { dueDate: '2026-09-15', shareCents: 333_334 },
    { dueDate: '2026-10-15', shareCents: 333_334 },
    { dueDate: '2026-11-15', shareCents: 333_333 },
  ])
  // Eşit olmayan taksitte pay tutarla orantılıdır.
  const uneven = scholarshipShareSchedule(
    1_000,
    [
      { dueDate: '2026-09-15', amountCents: 3 },
      { dueDate: '2026-10-15', amountCents: 1 },
    ],
    2026,
  )
  assert.deepEqual(
    uneven.map((item) => item.shareCents),
    [750, 250],
  )
  assert.deepEqual(
    scholarshipShareSchedule(0, lines, 2026).map((item) => item.shareCents),
    [0, 0, 0],
  )
})

test('K-264: tam bursta pay Eylül–Haziran on aya eşit yayılır, vade ayın birincisidir', () => {
  const shares = scholarshipShareSchedule(1_000_005, [], 2026)
  assert.equal(shares.length, 10)
  assert.equal(shares[0]?.dueDate, '2026-09-01')
  assert.equal(shares[9]?.dueDate, '2027-06-01')
  assert.deepEqual(
    shares.map((item) => item.shareCents),
    [100_001, 100_001, 100_001, 100_001, 100_001, 100_000, 100_000, 100_000, 100_000, 100_000],
  )
  assert.equal(
    shares.reduce((sum, item) => sum + item.shareCents, 0),
    1_000_005,
  )
})

test('DOM-FIN-025, K-265: kesme ileriye etkilidir; kesme gününden sonraki pay ayrı öğrenim taksiti olur', () => {
  const { state, award, student } = fixture()
  const quote = quoteScholarshipEnd(
    state,
    award,
    { kind: 'terminate', effectiveDate: '2026-11-01' },
    context(),
  )
  assert.equal(quote.keptCents, 2 * SHARE)
  assert.equal(quote.reinstatedCents, 2 * SHARE)
  assert.equal(quote.principalCents, 0)
  assert.equal(quote.interestCents, 0)
  assert.equal(quote.clawbackDueDate, null)
  assert.equal(quote.totalCents, 2 * SHARE)
  assert.deepEqual(quote.reinstated, [
    { dueDate: '2026-11-15', amountCents: SHARE },
    { dueDate: '2026-12-15', amountCents: SHARE },
  ])
  const before = state.invoices.map((item) => ({ ...item }))
  const result = endScholarship(
    state,
    award,
    'terminate',
    {
      reason: 'discipline',
      note: 'Disiplin kurulu kararı.',
      effectiveDate: '2026-11-01',
      confirmedCents: 2 * SHARE,
    },
    context(),
  )
  assert.equal(result.reason, 'discipline')
  assert.equal(result.invoiceIds.length, 2)
  // Önceki taksitler değişmez; yeni taksitler sözleşme zincirinde sıradaki numarayı alır.
  assert.deepEqual(state.invoices.slice(0, before.length), before)
  const added = state.invoices.slice(before.length)
  assert.deepEqual(
    added.map((item) => [
      item.installment,
      item.amount,
      item.dueDate,
      item.contractId,
      item.feeKind,
    ]),
    [
      [6, SHARE, '2026-11-15T09:00:00.000Z', 'contract-test-1', 'tuition'],
      [7, SHARE, '2026-12-15T09:00:00.000Z', 'contract-test-1', 'tuition'],
    ],
  )
  assert.ok(added.every((item) => item.studentId === student.id && item.academicYear === 2026))
  assert.deepEqual(state.contracts[0]?.invoiceIds?.slice(-2), result.invoiceIds)
  // Onaylı sözleşmenin tutarı ve burs kalemi değişmez (DOM-FIN-010).
  assert.equal(state.contracts[0]?.scholarship?.amountCents, SCHOLARSHIP)
  const notice = scholarshipEndNotice(result.quote, {
    programName: 'Başarı Bursu',
    studentName: 'Test Öğrenci',
    reason: result.reason,
  })
  assert.match(notice[0] ?? '', /öğrencinin "Başarı Bursu" bursu disiplin gerekçesiyle/)
  assert.match(notice.join(' '), /geri istenmez/)
  assert.match(notice.join(' '), /2 ek taksit/)
  const course = scholarshipEndNotice(result.quote, {
    programName: 'Kur Bursu',
    studentName: 'Test Kursiyer',
    reason: 'other',
    institutionType: 'language_school',
  })
  assert.match(course[0] ?? '', /kursiyerin "Kur Bursu"/)
})

test('DOM-FIN-025: kesme günü geçmiş ya da yıl dışı olamaz; önizleme değiştiyse yazılmaz, State değişmez', () => {
  const { state, award } = fixture()
  const before = snapshot(state)
  const body = (effectiveDate: string, confirmedCents = 2 * SHARE) => ({
    reason: 'academic',
    note: 'Başarı şartı sağlanmadı.',
    effectiveDate,
    confirmedCents,
  })
  assert.throws(
    () => endScholarship(state, award, 'terminate', body('2026-10-05'), context()),
    isDomainError('scholarship_end_date_past'),
  )
  assert.throws(
    () => endScholarship(state, award, 'terminate', body('2027-09-01'), context()),
    isDomainError('scholarship_end_date_out_of_year'),
  )
  assert.throws(
    () => endScholarship(state, award, 'terminate', body('2026-11-01', 1), context()),
    isDomainError('scholarship_end_changed', 'conflict'),
  )
  // Son vadeden sonra kesmenin etkisi yoktur.
  assert.throws(
    () => endScholarship(state, award, 'terminate', body('2027-01-01', 0), context()),
    isDomainError('scholarship_end_no_change'),
  )
  assert.throws(() =>
    endScholarship(state, award, 'terminate', { ...body('2026-11-01'), reason: 'x' }, context()),
  )
  assert.throws(() =>
    endScholarship(state, award, 'terminate', { ...body('2026-11-01'), note: ' ' }, context()),
  )
  assert.equal(snapshot(state), before)
})

test('DOM-FIN-025, K-266: gerçek dışı beyanda uygulanan pay vade gününden bugüne kanuni faiziyle geri istenir', () => {
  const { state, award } = fixture()
  const quote = quoteScholarshipEnd(state, award, { kind: 'revoke' }, context())
  assert.equal(quote.effectiveDate, '2026-10-06')
  assert.equal(quote.keptCents, 0)
  assert.equal(quote.principalCents, SHARE)
  // 750.000 × 21 gün × %24 / 365 = 10.356,16 → 10.356.
  assert.equal(quote.interestCents, 10_356)
  assert.equal(quote.reinstatedCents, 3 * SHARE)
  assert.equal(quote.clawbackDueDate, '2026-11-05')
  const clawback = quote.lines.find((line) => line.status === 'clawback')
  assert.equal(clawback?.interestDays, 21)
  const total = 3 * SHARE + SHARE + 10_356
  assert.equal(quote.totalCents, total)
  const before = state.invoices.length
  const result = endScholarship(
    state,
    award,
    'revoke',
    { note: 'Gelir belgesi sahte çıktı.', confirmedCents: total },
    context(),
  )
  assert.equal(result.reason, 'false_declaration')
  const added = state.invoices.slice(before)
  assert.deepEqual(
    added.map((item) => [
      item.installment,
      item.amount,
      item.dueDate.slice(0, 10),
      item.contractId,
    ]),
    [
      [6, SHARE, '2026-10-15', 'contract-test-1'],
      [7, SHARE, '2026-11-15', 'contract-test-1'],
      [8, SHARE, '2026-12-15', 'contract-test-1'],
      // Geri isteme alacağı sözleşmeye bağlanmaz; ayrılış onu iptal etmez.
      [9, SHARE, '2026-11-05', undefined],
      [10, 10_356, '2026-11-05', undefined],
    ],
  )
  assert.deepEqual(state.contracts[0]?.invoiceIds?.slice(-3), result.invoiceIds.slice(0, 3))
  const notice = scholarshipEndNotice(result.quote, {
    programName: 'Başarı Bursu',
    studentName: 'Test Öğrenci',
    reason: 'false_declaration',
  }).join(' ')
  assert.match(notice, /gerçeğe aykırı beyan/)
  assert.match(notice, /3095 sayılı Kanun/)
})

test('DOM-FIN-025, K-267: kesmeden sonra iptal, kesmenin kaldırdığı payı ikinci kez yazmaz', () => {
  const { state, award } = fixture()
  const terminated = endScholarship(
    state,
    award,
    'terminate',
    {
      reason: 'attendance',
      note: 'Devamsızlık sınırı aşıldı.',
      effectiveDate: '2026-11-01',
      confirmedCents: 2 * SHARE,
    },
    context(),
  )
  const prior: PriorScholarshipEnd[] = [
    { kind: 'terminate', effectiveDate: '2026-11-01', invoiceIds: terminated.invoiceIds },
  ]
  assert.throws(
    () =>
      quoteScholarshipEnd(
        state,
        award,
        { kind: 'terminate', effectiveDate: '2026-11-02' },
        context(prior),
      ),
    isDomainError('scholarship_already_terminated', 'conflict'),
  )
  const later = '2026-12-20T09:00:00.000Z'
  const quote = quoteScholarshipEnd(state, award, { kind: 'revoke' }, context(prior, later))
  assert.deepEqual(
    quote.lines.map((line) => [line.dueDate, line.shareCents, line.status]),
    [
      ['2026-09-15', SHARE, 'clawback'],
      ['2026-10-15', SHARE, 'clawback'],
      ['2026-11-15', SHARE, 'already_reinstated'],
      ['2026-12-15', SHARE, 'already_reinstated'],
    ],
  )
  assert.equal(quote.reinstatedCents, 0)
  assert.equal(quote.principalCents, 2 * SHARE)
  // 96 ve 66 gün, %24: 47.342,46 + 32.547,94 → satır başına aşağı.
  assert.equal(quote.interestCents, 47_342 + 32_547)
  const revoked: PriorScholarshipEnd[] = [
    ...prior,
    { kind: 'revoke', effectiveDate: '2026-12-20', invoiceIds: [] },
  ]
  for (const input of [{ kind: 'revoke' }, { kind: 'terminate', effectiveDate: '2026-12-21' }])
    assert.throws(
      () => quoteScholarshipEnd(state, award, input, context(revoked, later)),
      isDomainError('scholarship_already_revoked', 'conflict'),
    )
})

test('DOM-FIN-025, K-266: oran değişen aralıkta faiz iki orandan hesaplanır', () => {
  const { state, award } = fixture({ year: 2023, dues: ['2024-03-15', '2024-05-15'] })
  const quote = quoteScholarshipEnd(
    state,
    award,
    { kind: 'revoke' },
    context([], '2024-07-01T09:00:00.000Z'),
  )
  const may = quote.lines.find((line) => line.dueDate === '2024-05-15')
  assert.deepEqual(
    may?.segments.map((item) => [item.days, item.basisPoints]),
    [
      [17, 900],
      [30, 2_400],
    ],
  )
  // 1.500.000 × (17 × 900 + 30 × 2.400) / 3.650.000 = 35.876,71 → 35.876.
  assert.equal(may?.interestCents, 35_876)
  assert.equal(may?.shareCents, 1_500_000)
})

test('K-264: tam bursta kesme kalan ayları yeni taksit olarak yazar', () => {
  const { state, award } = fixture({ full: true })
  const quote = quoteScholarshipEnd(
    state,
    award,
    { kind: 'terminate', effectiveDate: '2027-01-15' },
    context(),
  )
  assert.equal(quote.fullScholarship, true)
  assert.equal(quote.keptCents, 3_500_000)
  assert.deepEqual(
    quote.reinstated.map((line) => line.dueDate),
    ['2027-02-01', '2027-03-01', '2027-04-01', '2027-05-01', '2027-06-01'],
  )
  assert.equal(quote.reinstatedCents, 3_500_000)
})

test('DOM-FIN-051: onaylı sözleşmede pay onay anının planından hesaplanır; yeni taksit plana girmez', () => {
  const { state, award } = fixture({ approved: true })
  const result = endScholarship(
    state,
    award,
    'terminate',
    {
      reason: 'institution_decision',
      note: 'Kurum kararı.',
      effectiveDate: '2026-12-01',
      confirmedCents: SHARE,
    },
    context(),
  )
  assert.equal(result.quote.reinstatedCents, SHARE)
  assert.equal(state.contracts[0]?.approval?.plan.length, 5)
  const prior: PriorScholarshipEnd[] = [
    { kind: 'terminate', effectiveDate: '2026-12-01', invoiceIds: result.invoiceIds },
  ]
  const quote = quoteScholarshipEnd(state, award, { kind: 'revoke' }, context(prior))
  assert.equal(quote.lines.length, 4)
  assert.equal(quote.reinstatedCents, 2 * SHARE)
})

test('DOM-FIN-025: ayrılan öğrenci, açık ek protokol ve bulunmayan sözleşme reddedilir', () => {
  const inactive = fixture()
  inactive.state.students[0]!.isActive = false
  assert.throws(
    () => quoteScholarshipEnd(inactive.state, inactive.award, { kind: 'revoke' }, context()),
    isDomainError('scholarship_student_inactive', 'conflict'),
  )
  const amended = fixture({ approved: true })
  const base = amended.state.contracts[0]!
  amended.state.contracts.push({
    ...base,
    id: 'contract-test-2',
    amendsContractId: base.id,
    revision: 2,
  })
  delete amended.state.contracts[1]!.approval
  assert.throws(
    () => quoteScholarshipEnd(amended.state, amended.award, { kind: 'revoke' }, context()),
    isDomainError('scholarship_contract_amendment_open', 'conflict'),
  )
  const other = fixture()
  assert.throws(
    () =>
      quoteScholarshipEnd(
        other.state,
        { ...other.award, programId: 'prog-other' },
        { kind: 'revoke' },
        context(),
      ),
    isDomainError('scholarship_contract_not_found'),
  )
  assert.throws(() => quoteScholarshipEnd(other.state, other.award, { kind: 'x' }, context()))
})
