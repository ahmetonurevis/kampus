import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addMonths,
  advanceClosedRemainder,
  advanceInstallmentPlan,
  advanceOutstanding,
  garnishmentQueue,
  monthlyDeductionRequestSchema,
  monthlyDeductions,
  monthsBetween,
  pensionOptOutKind,
  pensionStateIn,
  planStaffAdvance,
  planStaffAdvanceCancel,
  planStaffAdvanceClose,
  planStaffGarnishment,
  planStaffGarnishmentBalance,
  planStaffGarnishmentClose,
  planStaffPension,
  planStaffPensionOptOut,
  planStaffPensionPause,
  rateCents,
  rateLabel,
  staffAdvanceSchema,
  staffGarnishmentSchema,
  staffPensionPauseSchema,
  staffPensionSchema,
  type MonthlyDeductionSources,
  type StoredAdvanceTerms,
  type StoredGarnishmentTerms,
} from '../packages/school-core/src/lib/finance-staff-deductions.ts'

import { isDomainError } from './support/domain-error.ts'

// Avans ve kesintiler (DOM-FIN-101; ON-199; K-312…K-315). Bugün 2026-11-16.

const TODAY = '2026-11-16'
const STAFF = { role: 'ogretmen', active: true }
const ADVANCE = {
  membershipId: 'm-selin',
  amountCents: 1_000_000,
  givenDate: '2026-11-10',
  paymentMethod: 'bank_transfer',
  installmentCount: 3,
  firstMonth: '2026-11',
} as const
const advanceTerms = (
  overrides: Partial<StoredAdvanceTerms & { id: string }> = {},
): StoredAdvanceTerms & {
  id: string
} => ({
  id: 'adv-1',
  amountCents: 1_000_000,
  installmentCount: 3,
  firstMonth: '2026-11',
  givenDate: '2026-11-10',
  status: 'active',
  closedFromMonth: null,
  ...overrides,
})
const garnishment = (overrides: Partial<StoredGarnishmentTerms> = {}): StoredGarnishmentTerms => ({
  id: 'g-1',
  status: 'active',
  isAlimony: false,
  rateBasisPoints: 2500,
  remainingCents: 5_000_000,
  receivedDate: '2026-10-01',
  sequence: 1,
  closedDate: null,
  ...overrides,
})
const pension = (overrides: Partial<MonthlyDeductionSources['pensions'][number]> = {}) => ({
  id: 'p-1',
  rateBasisPoints: 300,
  startDate: '2026-09-01',
  optOutDate: null,
  pauses: [],
  ...overrides,
})
const NONE: MonthlyDeductionSources = { advances: [], garnishments: [], pensions: [] }
const request = (
  month: string,
  netCents: number | null = null,
  pensionBaseCents: number | null = null,
) => monthlyDeductionRequestSchema.parse({ month, netCents, pensionBaseCents })

test('DOM-FIN-101: ay yardımcıları yıl geçişini doğru sayar', () => {
  assert.equal(addMonths('2026-11', 3), '2027-02')
  assert.equal(addMonths('2026-01', -1), '2025-12')
  assert.equal(monthsBetween('2026-11', '2027-02'), 3)
  assert.equal(rateLabel(2500), '%25')
  assert.equal(rateLabel(333), '%3,33')
})

test('DOM-FIN-101 K-312: taksit planı kuruş farkını son taksite ekler, toplam tutara eşit', () => {
  const plan = advanceInstallmentPlan({
    amountCents: 1_000_000,
    installmentCount: 3,
    firstMonth: '2026-11',
  })
  assert.deepEqual(plan, [
    { month: '2026-11', amountCents: 333_333 },
    { month: '2026-12', amountCents: 333_333 },
    { month: '2027-01', amountCents: 333_334 },
  ])
  const odd = advanceInstallmentPlan({
    amountCents: 1_001,
    installmentCount: 7,
    firstMonth: '2026-12',
  })
  assert.equal(
    odd.reduce((total, item) => total + item.amountCents, 0),
    1_001,
  )
  assert.equal(odd.at(-1)?.amountCents, 143 + 1_001 - 143 * 7)
  assert.deepEqual(
    advanceInstallmentPlan({ amountCents: 50_000, installmentCount: 1, firstMonth: '2026-11' }),
    [{ month: '2026-11', amountCents: 50_000 }],
  )
})

test('DOM-FIN-101 K-312: avans şeması tutar, taksit ve ay biçimini doğrular', () => {
  assert.equal(staffAdvanceSchema.safeParse(ADVANCE).success, true)
  for (const bad of [
    { ...ADVANCE, amountCents: 0 },
    { ...ADVANCE, amountCents: 10.5 },
    { ...ADVANCE, installmentCount: 25 },
    { ...ADVANCE, installmentCount: 0 },
    { ...ADVANCE, firstMonth: '2026-13' },
    { ...ADVANCE, givenDate: '2026-02-30' },
    { ...ADVANCE, paymentMethod: 'check' },
    { ...ADVANCE, amountCents: 2, installmentCount: 3 },
    { ...ADVANCE, extra: true },
  ])
    assert.equal(staffAdvanceSchema.safeParse(bad).success, false, JSON.stringify(bad))
})

test('DOM-FIN-101 K-312: avans günü, ilk ay ve personel kuralları', () => {
  const input = staffAdvanceSchema.parse(ADVANCE)
  assert.deepEqual(planStaffAdvance(input, { today: TODAY, staff: STAFF }), input)
  assert.throws(
    () => planStaffAdvance({ ...input, givenDate: '2026-11-17' }, { today: TODAY, staff: STAFF }),
    isDomainError('staff_deduction_date_in_future'),
  )
  assert.throws(
    () => planStaffAdvance({ ...input, firstMonth: '2026-10' }, { today: TODAY, staff: STAFF }),
    isDomainError('staff_advance_first_month_before_given'),
  )
  assert.throws(
    () => planStaffAdvance({ ...input, firstMonth: '2027-12' }, { today: TODAY, staff: STAFF }),
    isDomainError('staff_advance_first_month_too_late'),
  )
  assert.doesNotThrow(() =>
    planStaffAdvance({ ...input, firstMonth: '2027-11' }, { today: TODAY, staff: STAFF }),
  )
  assert.throws(
    () => planStaffAdvance(input, { today: TODAY, staff: null }),
    isDomainError('staff_deduction_staff_not_found'),
  )
  assert.throws(
    () => planStaffAdvance(input, { today: TODAY, staff: { role: 'veli', active: true } }),
    isDomainError('staff_deduction_not_staff'),
  )
  assert.throws(
    () => planStaffAdvance(input, { today: TODAY, staff: { role: 'onburo', active: false } }),
    isDomainError('staff_deduction_staff_inactive'),
  )
})

test('DOM-FIN-101 K-312: erken kapama kalan taksitleri keser, kalan tutar plandan hesaplanır', () => {
  const advance = advanceTerms()
  const close = { closedDate: TODAY, fromMonth: '2026-12', method: 'cash' } as const
  assert.doesNotThrow(() => planStaffAdvanceClose(advance, close, TODAY))
  const closed = advanceTerms({ status: 'closed', closedFromMonth: '2026-12' })
  assert.equal(advanceClosedRemainder(closed), 333_333 + 333_334)
  assert.equal(advanceClosedRemainder(advance), null)
  assert.equal(advanceOutstanding(advance, '2026-12'), 666_667)
  assert.equal(advanceOutstanding(closed, '2026-11'), 333_333)
  assert.equal(advanceOutstanding(advanceTerms({ status: 'cancelled' }), '2026-11'), 0)

  assert.throws(
    () => planStaffAdvanceClose(closed, close, TODAY),
    isDomainError('staff_advance_not_active'),
  )
  assert.throws(
    () => planStaffAdvanceClose(advance, { ...close, closedDate: '2026-11-17' }, TODAY),
    isDomainError('staff_deduction_date_in_future'),
  )
  assert.throws(
    () => planStaffAdvanceClose(advance, { ...close, closedDate: '2026-11-09' }, TODAY),
    isDomainError('staff_advance_close_before_given'),
  )
  assert.throws(
    () => planStaffAdvanceClose(advance, { ...close, fromMonth: '2026-10' }, TODAY),
    isDomainError('staff_advance_close_month_past'),
  )
  assert.throws(
    () => planStaffAdvanceClose(advance, { ...close, fromMonth: '2027-02' }, TODAY),
    isDomainError('staff_advance_close_month_outside_plan'),
  )
})

test('DOM-FIN-101 K-312: iptal yalnız mahsubu süren avansta', () => {
  assert.doesNotThrow(() => planStaffAdvanceCancel({ status: 'active' }))
  for (const status of ['closed', 'cancelled'] as const)
    assert.throws(
      () => planStaffAdvanceCancel({ status }),
      isDomainError('staff_advance_not_active'),
    )
})

test('DOM-FIN-101 K-313: icra şeması varsayılan oran dörtte bir, nafaka işareti hayır', () => {
  const parsed = staffGarnishmentSchema.parse({
    membershipId: 'm-selin',
    office: ' İstanbul 12. İcra Dairesi ',
    fileNumber: '2026/1234',
    claimCents: 5_000_000,
    receivedDate: '2026-10-01',
  })
  assert.equal(parsed.rateBasisPoints, 2500)
  assert.equal(parsed.isAlimony, false)
  assert.equal(parsed.office, 'İstanbul 12. İcra Dairesi')
  for (const bad of [
    { ...parsed, rateBasisPoints: 0 },
    { ...parsed, rateBasisPoints: 10_001 },
    { ...parsed, office: 'İc' },
    { ...parsed, fileNumber: '' },
    { ...parsed, claimCents: -1 },
  ])
    assert.equal(staffGarnishmentSchema.safeParse(bad).success, false, JSON.stringify(bad))
  assert.throws(
    () =>
      planStaffGarnishment(
        { ...parsed, receivedDate: '2026-11-17' },
        { today: TODAY, staff: STAFF },
      ),
    isDomainError('staff_deduction_date_in_future'),
  )
  assert.throws(
    () => planStaffGarnishment(parsed, { today: TODAY, staff: null }),
    isDomainError('staff_deduction_staff_not_found'),
  )
})

test('DOM-FIN-101 K-313: kalan alacak ve kapanış kuralları', () => {
  const open = { status: 'active', claimCents: 100, receivedDate: '2026-10-01' } as const
  assert.doesNotThrow(() => planStaffGarnishmentBalance(open, 0))
  assert.throws(
    () => planStaffGarnishmentBalance(open, 101),
    isDomainError('staff_garnishment_remaining_exceeds_claim'),
  )
  assert.throws(
    () => planStaffGarnishmentBalance({ ...open, status: 'closed' }, 10),
    isDomainError('staff_garnishment_closed'),
  )
  const close = { closedDate: TODAY, reason: 'paid_off' } as const
  assert.doesNotThrow(() => planStaffGarnishmentClose(open, close, TODAY))
  assert.throws(
    () => planStaffGarnishmentClose({ ...open, status: 'closed' }, close, TODAY),
    isDomainError('staff_garnishment_closed'),
  )
  assert.throws(
    () => planStaffGarnishmentClose(open, { ...close, closedDate: '2026-09-30' }, TODAY),
    isDomainError('staff_garnishment_close_before_received'),
  )
  assert.throws(
    () => planStaffGarnishmentClose(open, { ...close, closedDate: '2026-11-17' }, TODAY),
    isDomainError('staff_deduction_date_in_future'),
  )
})

test('DOM-FIN-101 K-313: icra sırası nafaka önce, sonra tebliğ günü, aynı gün kayıt sırası', () => {
  const queue = garnishmentQueue([
    garnishment({ id: 'late', receivedDate: '2026-10-20', sequence: 1 }),
    garnishment({ id: 'same-2', receivedDate: '2026-10-05', sequence: 3 }),
    garnishment({ id: 'same-1', receivedDate: '2026-10-05', sequence: 2 }),
    garnishment({ id: 'alimony', receivedDate: '2026-11-01', sequence: 4, isAlimony: true }),
  ])
  assert.deepEqual(
    queue.map((item) => item.id),
    ['alimony', 'same-1', 'same-2', 'late'],
  )
})

test('DOM-FIN-101 K-314: BES şeması varsayılan %3, en az %3; ara verme en çok 12 ay', () => {
  const parsed = staffPensionSchema.parse({ membershipId: 'm-selin', startDate: '2026-09-01' })
  assert.equal(parsed.rateBasisPoints, 300)
  assert.equal(staffPensionSchema.safeParse({ ...parsed, rateBasisPoints: 299 }).success, false)
  assert.equal(
    staffPensionPauseSchema.safeParse({ fromMonth: '2026-12', toMonth: '2027-11' }).success,
    true,
  )
  assert.equal(
    staffPensionPauseSchema.safeParse({ fromMonth: '2026-12', toMonth: '2027-12' }).success,
    false,
  )
  assert.equal(
    staffPensionPauseSchema.safeParse({ fromMonth: '2026-12', toMonth: '2026-11' }).success,
    false,
  )
  assert.equal(
    staffPensionPauseSchema.safeParse({ fromMonth: '2026-1', toMonth: '2026-11' }).success,
    false,
  )
})

test('DOM-FIN-101 K-314: BES katılım, ara verme, cayma ve durum', () => {
  const parsed = staffPensionSchema.parse({ membershipId: 'm-selin', startDate: '2026-09-01' })
  assert.deepEqual(planStaffPension(parsed, { staff: STAFF, hasOpenEnrollment: false }), parsed)
  assert.throws(
    () => planStaffPension(parsed, { staff: STAFF, hasOpenEnrollment: true }),
    isDomainError('staff_pension_already_enrolled', 'conflict'),
  )
  assert.throws(
    () =>
      planStaffPension(parsed, {
        staff: { role: 'yonetici', active: false },
        hasOpenEnrollment: false,
      }),
    isDomainError('staff_deduction_staff_inactive'),
  )
  const enrolled = pension({ pauses: [{ fromMonth: '2026-12', toMonth: '2027-02' }] })
  assert.doesNotThrow(() =>
    planStaffPensionPause(enrolled, { fromMonth: '2027-03', toMonth: '2027-04' }),
  )
  assert.throws(
    () => planStaffPensionPause(enrolled, { fromMonth: '2027-02', toMonth: '2027-04' }),
    isDomainError('staff_pension_pause_overlap'),
  )
  assert.throws(
    () => planStaffPensionPause(enrolled, { fromMonth: '2026-08', toMonth: '2026-09' }),
    isDomainError('staff_pension_pause_before_start'),
  )
  assert.throws(
    () =>
      planStaffPensionPause(pension({ optOutDate: '2026-10-01' }), {
        fromMonth: '2027-01',
        toMonth: '2027-01',
      }),
    isDomainError('staff_pension_opted_out'),
  )
  assert.doesNotThrow(() => planStaffPensionOptOut(enrolled, TODAY, TODAY))
  assert.throws(
    () => planStaffPensionOptOut(enrolled, '2026-08-31', TODAY),
    isDomainError('staff_pension_opt_out_before_start'),
  )
  assert.throws(
    () => planStaffPensionOptOut(enrolled, '2026-11-17', TODAY),
    isDomainError('staff_deduction_date_in_future'),
  )
  assert.throws(
    () => planStaffPensionOptOut(pension({ optOutDate: '2026-10-01' }), TODAY, TODAY),
    isDomainError('staff_pension_opted_out'),
  )

  assert.equal(pensionOptOutKind(pension()), null)
  assert.equal(pensionOptOutKind(pension({ optOutDate: '2026-11-01' })), 'cooling_off')
  assert.equal(pensionOptOutKind(pension({ optOutDate: '2026-11-02' })), 'exit')

  assert.equal(pensionStateIn(enrolled, '2026-08'), 'scheduled')
  assert.equal(pensionStateIn(enrolled, '2026-09'), 'active')
  assert.equal(pensionStateIn(enrolled, '2027-01'), 'paused')
  assert.equal(pensionStateIn(pension({ optOutDate: '2026-11-20' }), '2026-11'), 'opted_out')
  assert.equal(pensionStateIn(pension({ optOutDate: '2026-11-20' }), '2026-10'), 'active')
})

test('DOM-FIN-101 K-315: sıra avans, nafaka, sıradaki icra, bekleyen icra, BES', () => {
  const result = monthlyDeductions(request('2026-11', 4_000_000, 5_000_000), {
    advances: [advanceTerms()],
    garnishments: [
      garnishment({ id: 'second', receivedDate: '2026-10-10', sequence: 2 }),
      garnishment({ id: 'first', receivedDate: '2026-10-01', sequence: 1 }),
      garnishment({ id: 'alimony', isAlimony: true, rateBasisPoints: 1000, sequence: 3 }),
    ],
    pensions: [pension()],
  })
  assert.deepEqual(
    result.lines.map((line) => [
      line.order,
      line.kind,
      line.sourceId,
      line.amountCents,
      line.status,
    ]),
    [
      [1, 'advance', 'adv-1', 333_333, 'applied'],
      [2, 'garnishment', 'alimony', 400_000, 'applied'],
      [3, 'garnishment', 'first', 1_000_000, 'applied'],
      [4, 'garnishment', 'second', 0, 'waiting'],
      [5, 'pension', 'p-1', 150_000, 'applied'],
    ],
  )
  assert.equal(result.totalCents, 333_333 + 400_000 + 1_000_000 + 150_000)
  assert.equal(result.remainingNetCents, 4_000_000 - result.totalCents)
})

test('DOM-FIN-101 K-315: tavan — satır net ücretin kalanını ve kalan alacağı aşamaz', () => {
  const capped = monthlyDeductions(request('2026-11', 500_000, 5_000_000), {
    advances: [advanceTerms({ amountCents: 900_000, installmentCount: 2 })],
    garnishments: [garnishment({ remainingCents: 50_000 })],
    pensions: [pension()],
  })
  assert.deepEqual(
    capped.lines.map((line) => [line.kind, line.requestedCents, line.amountCents, line.status]),
    [
      ['advance', 450_000, 450_000, 'applied'],
      ['garnishment', 125_000, 50_000, 'capped'],
      ['pension', 150_000, 0, 'capped'],
    ],
  )
  assert.equal(capped.totalCents, 500_000)
  assert.equal(capped.remainingNetCents, 0)

  const byClaim = monthlyDeductions(request('2026-11', 4_000_000), {
    ...NONE,
    garnishments: [garnishment({ remainingCents: 12_345 })],
  })
  assert.deepEqual(
    byClaim.lines.map((line) => [line.requestedCents, line.amountCents, line.status]),
    [[1_000_000, 12_345, 'capped']],
  )
})

test('DOM-FIN-101 K-315: kuruş — oranlı tutar kuruşa aşağı yuvarlanır', () => {
  assert.equal(rateCents(1_234_567, 2500), 308_641)
  assert.equal(rateCents(999, 300), 29)
  const result = monthlyDeductions(request('2026-11', 1_234_567, 999), {
    ...NONE,
    garnishments: [garnishment()],
    pensions: [pension()],
  })
  assert.deepEqual(
    result.lines.map((line) => line.amountCents),
    [308_641, 29],
  )
})

test('DOM-FIN-101 K-315: net ücret yoksa yalnız sabit tutarlar; icra net bekler, BES matrah', () => {
  const result = monthlyDeductions(request('2026-12'), {
    advances: [advanceTerms()],
    garnishments: [garnishment(), garnishment({ id: 'g-2', sequence: 2 })],
    pensions: [pension()],
  })
  assert.deepEqual(
    result.lines.map((line) => [line.kind, line.amountCents, line.status]),
    [
      ['advance', 333_333, 'applied'],
      ['garnishment', null, 'needs_net'],
      ['garnishment', 0, 'waiting'],
      ['pension', null, 'needs_base'],
    ],
  )
  assert.equal(result.totalCents, 333_333)
  assert.equal(result.remainingNetCents, null)
  const withBase = monthlyDeductions(request('2026-12', null, 1_000_000), {
    ...NONE,
    pensions: [pension()],
  })
  assert.equal(withBase.lines[0]?.amountCents, 30_000)
})

test('DOM-FIN-101 K-315: yürürlükte olmayan kayıtlar listeye girmez', () => {
  const sources: MonthlyDeductionSources = {
    advances: [
      advanceTerms({ id: 'cancelled', status: 'cancelled' }),
      advanceTerms({ id: 'closed', status: 'closed', closedFromMonth: '2026-12' }),
      advanceTerms({ id: 'later', firstMonth: '2027-01' }),
    ],
    garnishments: [
      garnishment({ id: 'future', receivedDate: '2026-12-01' }),
      garnishment({ id: 'closed', status: 'closed', closedDate: '2026-11-05' }),
      garnishment({ id: 'settled', remainingCents: 0, sequence: 0 }),
    ],
    pensions: [
      pension({ id: 'scheduled', startDate: '2027-01-01' }),
      pension({ id: 'out', optOutDate: '2026-11-01' }),
      pension({ id: 'paused', pauses: [{ fromMonth: '2026-11', toMonth: '2026-11' }] }),
    ],
  }
  const november = monthlyDeductions(request('2026-11', 1_000_000, 1_000_000), sources)
  assert.deepEqual(
    november.lines.map((line) => [line.kind, line.sourceId, line.status]),
    [
      ['advance', 'closed', 'applied'],
      ['garnishment', 'settled', 'settled'],
      ['pension', 'paused', 'paused'],
    ],
  )
  // Kapanan icra kapanış ayından önceki aylarda geçmiş kesinti olarak görünür.
  const october = monthlyDeductions(request('2026-10', 1_000_000), {
    ...NONE,
    garnishments: [garnishment({ id: 'closed', status: 'closed', closedDate: '2026-11-05' })],
  })
  assert.deepEqual(
    october.lines.map((line) => [line.sourceId, line.amountCents]),
    [['closed', 250_000]],
  )
  assert.deepEqual(monthlyDeductions(request('2026-11'), NONE).lines, [])
})
