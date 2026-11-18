import assert from 'node:assert/strict'
import test from 'node:test'

import {
  adjustmentDirectionLabel,
  assertPayrollDaysUnlocked,
  isPayrollMonthLocked,
  lockedMonthsIn,
  monthEnd,
  nextMonth,
  payRateCancelRange,
  payRateCreateRange,
  payRateEndRange,
  payrollAdjustmentCancelSchema,
  payrollAdjustmentInputSchema,
  payrollAdjustmentTargetMonth,
  payrollApproveSchema,
  payrollInputSummary,
  payrollMonthLabel,
  payrollMonthSchema,
  payrollParameterRange,
  payrollPeriodState,
  payrollReopenSchema,
  payrollYearMonths,
  planPayrollAdjustment,
  planPayrollAdjustmentCancel,
  planPayrollApproval,
  planPayrollReopen,
  type PayrollSummaryRate,
} from '../packages/school-core/src/lib/finance-payroll-periods.ts'
import {
  PAYROLL_PLATFORM_DEFAULTS,
  type PayrollInstitutionSet,
} from '../packages/school-core/src/lib/finance-payroll-parameters.ts'
import { isDomainError } from './support/domain-error.ts'

// Bordro onayı ve dönem kilidi (DOM-FIN-108; ON-200). Kararlar K-356…K-359.

const HASH = 'a'.repeat(64)
const OTHER_HASH = 'b'.repeat(64)
const approved = { status: 'approved' as const, id: 'p-1' }
const reopened = { status: 'reopened' as const, id: 'p-1' }

test('DOM-FIN-108: ay yardımcıları', () => {
  assert.equal(monthEnd('2026-02'), '2026-02-28')
  assert.equal(monthEnd('2028-02'), '2028-02-29')
  assert.equal(monthEnd('2026-12'), '2026-12-31')
  assert.equal(nextMonth('2026-12'), '2027-01')
  assert.equal(nextMonth('2026-09'), '2026-10')
  assert.equal(payrollMonthLabel('2026-10'), 'Ekim 2026')
  assert.deepEqual(payrollYearMonths(2026).slice(0, 2), ['2026-01', '2026-02'])
  assert.equal(payrollYearMonths(2026).length, 12)
  assert.equal(payrollMonthSchema.safeParse('2026-13').success, false)
  assert.equal(payrollMonthSchema.safeParse('2019-12').success, false)
  assert.equal(payrollMonthSchema.safeParse('2026-10').success, true)
})

test('DOM-FIN-108 K-357: kilitli ay ve aralık denetimi', () => {
  const locked = ['2026-08', '2026-09']
  assert.equal(isPayrollMonthLocked(locked, '2026-09'), true)
  assert.equal(isPayrollMonthLocked(locked, '2026-10'), false)
  assert.deepEqual(lockedMonthsIn(locked, { from: '2026-09-15', to: null }), ['2026-09'])
  assert.deepEqual(lockedMonthsIn(locked, { from: '2026-01-01', to: '2026-08-01' }), ['2026-08'])
  assert.deepEqual(lockedMonthsIn(locked, { from: '2026-10-01', to: null }), [])
  // İleri tarihli yazma serbest; boş aralık bir şey değiştirmez.
  assert.doesNotThrow(() => assertPayrollDaysUnlocked(locked, [{ from: '2026-10-01', to: null }]))
  assert.doesNotThrow(() => assertPayrollDaysUnlocked(locked, [null]))
  assert.throws(
    () => assertPayrollDaysUnlocked(locked, [{ from: '2026-09-30', to: '2026-09-30' }]),
    isDomainError('payroll_period_locked', 'conflict'),
  )
  try {
    assertPayrollDaysUnlocked(locked, [{ from: '2026-01-01', to: null }], 'endDate')
    assert.fail('kilit denetimi çalışmadı')
  } catch (error) {
    assert.ok(isDomainError('payroll_period_locked', 'conflict')(error))
    assert.deepEqual((error as { path: string[] }).path, ['endDate'])
    assert.match((error as Error).message, /Ağustos 2026, Eylül 2026/)
  }
  const many = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']
  assert.throws(
    () => assertPayrollDaysUnlocked(many, [{ from: '2026-01-01', to: null }]),
    /ve 2 ay daha/,
  )
})

test('DOM-FIN-108 K-357: ücret tanımı yazmalarının etki aralığı', () => {
  // Yeni tanım: başlangıçtan süresiz; önceki tanımı kapatıyorsa eski bitişine kadar.
  assert.deepEqual(payRateCreateRange({ startDate: '2026-10-01', endDate: null }, undefined), {
    from: '2026-10-01',
    to: null,
  })
  assert.deepEqual(
    payRateCreateRange({ startDate: '2026-10-01', endDate: '2026-10-31' }, '2026-12-31'),
    { from: '2026-10-01', to: '2026-12-31' },
  )
  assert.deepEqual(payRateCreateRange({ startDate: '2026-10-01', endDate: '2026-10-31' }, null), {
    from: '2026-10-01',
    to: null,
  })
  assert.deepEqual(
    payRateCreateRange({ startDate: '2026-10-01', endDate: '2026-12-31' }, '2026-11-30'),
    { from: '2026-10-01', to: '2026-12-31' },
  )
  // Bitiş değişikliği: eski ve yeni bitiş arasındaki günler.
  assert.equal(payRateEndRange('2026-10-31', '2026-10-31'), null)
  assert.deepEqual(payRateEndRange('2026-10-31', null), { from: '2026-11-01', to: null })
  assert.deepEqual(payRateEndRange(null, '2026-09-15'), { from: '2026-09-16', to: null })
  assert.deepEqual(payRateEndRange('2026-12-31', '2026-10-31'), {
    from: '2026-11-01',
    to: '2026-12-31',
  })
  // İptal: tanımın aralığı ve kapattığı tanımın geri kazandığı günler.
  assert.deepEqual(payRateCancelRange({ startDate: '2026-09-01', endDate: null }, '2026-12-31'), {
    from: '2026-09-01',
    to: null,
  })
  assert.deepEqual(
    payRateCancelRange({ startDate: '2026-09-01', endDate: '2026-09-30' }, undefined),
    { from: '2026-09-01', to: '2026-09-30' },
  )
})

test('DOM-FIN-108 K-357: parametre setinin etki aralığı sonraki sete kadardır', () => {
  // Platform setleri 2025-01, 2025-07, 2026-01.
  assert.deepEqual(payrollParameterRange([], '2025-03-01'), {
    from: '2025-03-01',
    to: '2025-06-30',
  })
  assert.deepEqual(payrollParameterRange([], '2026-03-01'), { from: '2026-03-01', to: null })
  const own = {
    ...PAYROLL_PLATFORM_DEFAULTS[2]!,
    id: 'own',
    version: 1,
    effectiveFrom: '2026-06-01',
  }
  const sets: PayrollInstitutionSet[] = [own]
  assert.deepEqual(payrollParameterRange(sets, '2026-03-01'), {
    from: '2026-03-01',
    to: '2026-05-31',
  })
  // Değişen set kendi aralığını kesmez.
  assert.deepEqual(payrollParameterRange(sets, '2026-03-01', 'own'), {
    from: '2026-03-01',
    to: null,
  })
})

const rate = (overrides: Partial<PayrollSummaryRate>): PayrollSummaryRate => ({
  id: 'r-1',
  membershipId: 'm-1',
  component: 'wage',
  rateType: 'monthly_gross',
  amountCents: 4_000_000,
  startDate: '2026-01-01',
  endDate: null,
  ...overrides,
})

test('DOM-FIN-108 K-356: girdi özeti ve damga kaynağı', () => {
  const rates = [
    rate({ id: 'r-1', endDate: '2026-09-14' }),
    rate({ id: 'r-2', startDate: '2026-09-15', amountCents: 4_500_000 }),
    rate({ id: 'r-3', membershipId: 'm-2', rateType: 'hourly', amountCents: 50_000 }),
    rate({ id: 'r-4', membershipId: 'm-3', component: 'benefit', rateType: 'meal' }),
    // Ayla kesişmeyen tanımlar sayılmaz.
    rate({ id: 'r-5', membershipId: 'm-4', startDate: '2026-10-01' }),
    rate({ id: 'r-6', membershipId: 'm-5', endDate: '2026-08-31' }),
  ]
  const adjustments = [
    { id: 'a-1', membershipId: 'm-1', item: 'wage', amountCents: 10_000 },
    { id: 'a-2', membershipId: 'm-2', item: 'other', amountCents: -2_500 },
  ]
  const { summary, digestSource } = payrollInputSummary('2026-09', rates, adjustments, [])
  assert.deepEqual(summary, {
    staffCount: 3,
    rateCount: 4,
    // Aynı personelin ayda son başlayan aylık brüt ücreti (zam sonrası) sayılır.
    monthlyGrossTotalCents: 4_500_000,
    adjustmentCount: 2,
    adjustmentTotalCents: 7_500,
    parameterSetId: 'platform-2026-01-01',
    parameterEffectiveFrom: '2026-01-01',
  })
  // Sıra damgayı değiştirmez; değer değişikliği değiştirir.
  const shuffled = payrollInputSummary(
    '2026-09',
    [...rates].reverse(),
    [...adjustments].reverse(),
    [],
  )
  assert.equal(shuffled.digestSource, digestSource)
  const changed = payrollInputSummary(
    '2026-09',
    rates.map((item) => (item.id === 'r-3' ? { ...item, amountCents: 60_000 } : item)),
    adjustments,
    [],
  )
  assert.notEqual(changed.digestSource, digestSource)
  // Parametre tablosundan önceki ay.
  const early = payrollInputSummary('2024-05', [], [], [])
  assert.equal(early.summary.parameterSetId, null)
  assert.equal(early.summary.parameterEffectiveFrom, null)
  assert.equal(early.summary.staffCount, 0)
})

test('DOM-FIN-108 K-356: onay kuralları', () => {
  const hashes = { expected: HASH, current: HASH }
  assert.doesNotThrow(() => planPayrollApproval('2026-09', '2026-10-06', null, hashes))
  assert.doesNotThrow(() => planPayrollApproval('2026-10', '2026-10-06', reopened, hashes))
  assert.throws(
    () => planPayrollApproval('2026-11', '2026-10-06', null, hashes),
    isDomainError('payroll_period_in_future'),
  )
  assert.throws(
    () => planPayrollApproval('2026-09', '2026-10-06', approved, hashes),
    isDomainError('payroll_period_already_approved', 'conflict'),
  )
  assert.throws(
    () =>
      planPayrollApproval('2026-09', '2026-10-06', null, { expected: HASH, current: OTHER_HASH }),
    isDomainError('payroll_inputs_changed', 'conflict'),
  )
  assert.equal(payrollApproveSchema.safeParse({ inputsHash: 'x' }).success, false)
  assert.equal(payrollApproveSchema.safeParse({ inputsHash: HASH, extra: 1 }).success, false)
  assert.equal(payrollPeriodState(null), 'open')
  assert.equal(payrollPeriodState(approved), 'approved')
  assert.equal(payrollPeriodState(reopened), 'reopened')
})

test('DOM-FIN-108 K-356: yeniden açma kuralları', () => {
  assert.equal(planPayrollReopen(approved, 0), approved)
  assert.throws(
    () => planPayrollReopen(null, 0),
    isDomainError('payroll_period_not_approved', 'conflict'),
  )
  assert.throws(
    () => planPayrollReopen(reopened, 0),
    isDomainError('payroll_period_not_approved', 'conflict'),
  )
  assert.throws(
    () => planPayrollReopen(approved, 2),
    isDomainError('payroll_period_has_adjustments'),
  )
  assert.equal(payrollReopenSchema.safeParse({ reason: 'kısa' }).success, false)
  assert.equal(payrollReopenSchema.safeParse({ reason: 'x'.repeat(501) }).success, false)
  assert.deepEqual(payrollReopenSchema.parse({ reason: '  Eksik ek ders  ' }), {
    reason: 'Eksik ek ders',
  })
})

test('DOM-FIN-108 K-358: düzeltme kaydı kuralları ve hedef ay', () => {
  const staff = { role: 'ogretmen' }
  assert.deepEqual(planPayrollAdjustment('2026-09', approved, staff, ['2026-09']), {
    period: approved,
    targetMonth: '2026-10',
  })
  // Sonraki ay da kilitliyse ilk kilitsiz aya aktarılır.
  assert.equal(
    planPayrollAdjustment('2026-08', approved, staff, ['2026-08', '2026-09']).targetMonth,
    '2026-10',
  )
  assert.equal(payrollAdjustmentTargetMonth('2026-12', []), '2027-01')
  assert.throws(
    () => payrollAdjustmentTargetMonth('2099-11', ['2099-11', '2099-12']),
    isDomainError('payroll_period_locked', 'conflict'),
  )
  assert.throws(
    () => planPayrollAdjustment('2026-09', null, staff, []),
    isDomainError('payroll_period_not_locked'),
  )
  assert.throws(
    () => planPayrollAdjustment('2026-09', reopened, staff, []),
    isDomainError('payroll_period_not_locked'),
  )
  assert.throws(
    () => planPayrollAdjustment('2026-09', approved, null, ['2026-09']),
    isDomainError('payroll_adjustment_staff_not_found'),
  )
  assert.throws(
    () => planPayrollAdjustment('2026-09', approved, { role: 'veli' }, ['2026-09']),
    isDomainError('payroll_adjustment_not_staff'),
  )
  assert.doesNotThrow(() => planPayrollAdjustmentCancel({ targetMonth: '2026-10' }, ['2026-09']))
  assert.throws(
    () => planPayrollAdjustmentCancel({ targetMonth: '2026-10' }, ['2026-10']),
    isDomainError('payroll_period_locked', 'conflict'),
  )
})

test('DOM-FIN-108 K-358: düzeltme şeması', () => {
  const valid = {
    membershipId: 'm-1',
    item: 'lesson',
    amountCents: -12_500,
    reason: 'Fazla ek ders',
  }
  assert.equal(payrollAdjustmentInputSchema.safeParse(valid).success, true)
  assert.equal(payrollAdjustmentInputSchema.safeParse({ ...valid, amountCents: 0 }).success, false)
  assert.equal(
    payrollAdjustmentInputSchema.safeParse({ ...valid, amountCents: 1_000_000_001 }).success,
    false,
  )
  assert.equal(
    payrollAdjustmentInputSchema.safeParse({ ...valid, amountCents: 1.5 }).success,
    false,
  )
  assert.equal(payrollAdjustmentInputSchema.safeParse({ ...valid, item: 'bonus' }).success, false)
  assert.equal(payrollAdjustmentInputSchema.safeParse({ ...valid, reason: 'yok' }).success, false)
  assert.equal(
    payrollAdjustmentInputSchema.safeParse({ ...valid, institutionId: 'b' }).success,
    false,
  )
  assert.equal(payrollAdjustmentCancelSchema.safeParse({ reason: 'Yanlış personel' }).success, true)
  assert.equal(adjustmentDirectionLabel(100), 'Ek ödeme')
  assert.equal(adjustmentDirectionLabel(-100), 'Geri alınacak')
})
