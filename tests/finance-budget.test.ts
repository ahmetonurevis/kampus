import assert from 'node:assert/strict'
import test from 'node:test'

import { defaultAcademicYearDates } from '../packages/school-core/src/lib/academic-years.ts'
import {
  assertPeriodWritable,
  budgetItemSchema,
  budgetPeriodSchema,
  evenMonthlySplit,
  periodMonths,
  planBudgetItem,
  planBudgetItemUpdate,
  planBudgetLine,
  planBudgetLineUpdate,
  planBudgetPeriod,
  planBudgetPeriodClose,
  planBudgetPeriodOpen,
  planBudgetPeriodUpdate,
  type BudgetItemNode,
  type BudgetPeriodNode,
} from '../packages/school-core/src/lib/finance-budget.ts'

import { isDomainError } from './support/domain-error.ts'

const ZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const item = (n: number, overrides: Partial<BudgetItemNode> = {}): BudgetItemNode => ({
  id: id(n),
  code: `K${String(n)}`,
  kind: 'income',
  feeKind: null,
  isActive: true,
  ...overrides,
})
const period = (n: number, overrides: Partial<BudgetPeriodNode> = {}): BudgetPeriodNode => ({
  id: id(100 + n),
  name: `Dönem ${String(n)}`,
  academicYear: 2026,
  status: 'draft',
  startDate: '2026-09-01',
  endDate: '2027-08-31',
  ...overrides,
})
const yearDates = defaultAcademicYearDates

// --- Kalem ---------------------------------------------------------------------------------------

test('DOM-FIN-062: gelir kalemi ücret türüne eşlenir, gider kalemi eşlenmez', () => {
  const income = planBudgetItem(
    { code: 'g-100', name: 'Öğrenim geliri', kind: 'income', feeKind: 'tuition' },
    [],
  )
  assert.deepEqual(income, {
    code: 'G-100',
    name: 'Öğrenim geliri',
    kind: 'income',
    feeKind: 'tuition',
  })
  assert.equal(planBudgetItem({ code: 'P', name: 'Personel', kind: 'expense' }, []).feeKind, null)
  assert.throws(
    () => budgetItemSchema.parse({ code: 'P', name: 'Personel', kind: 'expense', feeKind: 'meal' }),
    ZodError,
  )
})

test('DOM-FIN-062: kalem kodu tekil; ücret türüne tek etkin gelir kalemi (K-60)', () => {
  assert.throws(
    () => planBudgetItem({ code: 'k1', name: 'Yeni', kind: 'income' }, [item(1)]),
    isDomainError('budget_item_code_taken', 'conflict'),
  )
  const tuition = item(1, { feeKind: 'tuition' })
  assert.throws(
    () =>
      planBudgetItem({ code: 'X', name: 'Yeni', kind: 'income', feeKind: 'tuition' }, [tuition]),
    isDomainError('budget_item_fee_kind_taken', 'conflict'),
  )
  assert.equal(
    planBudgetItem({ code: 'X', name: 'Yeni', kind: 'income', feeKind: 'tuition' }, [
      { ...tuition, isActive: false },
    ]).feeKind,
    'tuition',
  )
})

test('DOM-FIN-062: kullanılan kalemin türü değişmez; giderde ücret türü kalmaz; boş düzeltme 400', () => {
  const current = item(1)
  assert.throws(
    () => planBudgetItemUpdate(current, { kind: 'expense' }, { items: [current], inUse: true }),
    isDomainError('budget_item_in_use'),
  )
  assert.deepEqual(
    planBudgetItemUpdate(current, { kind: 'expense' }, { items: [current], inUse: false }),
    { kind: 'expense' },
  )
  const mapped = item(2, { feeKind: 'meal' })
  assert.throws(
    () => planBudgetItemUpdate(mapped, { kind: 'expense' }, { items: [mapped], inUse: false }),
    isDomainError('budget_item_fee_kind_expense'),
  )
  assert.throws(
    () => planBudgetItemUpdate(current, {}, { items: [current], inUse: false }),
    ZodError,
  )
  // Pasif kalem yeniden etkinleşirken ücret türü boşta olmalı.
  const passive = item(3, { feeKind: 'meal', isActive: false })
  assert.throws(
    () =>
      planBudgetItemUpdate(passive, { isActive: true }, { items: [passive, mapped], inUse: false }),
    isDomainError('budget_item_fee_kind_taken', 'conflict'),
  )
})

// --- Dönem ---------------------------------------------------------------------------------------

test('DOM-FIN-062: eğitim yılına bağlı dönem yılın günlerini kopyalar (K-58, IST-011)', () => {
  const plan = planBudgetPeriod(
    { name: '2026–2027 bütçesi', academicYear: 2026 },
    { periods: [], yearDates: () => ({ startDate: '2026-09-07', endDate: '2027-08-31' }) },
  )
  assert.deepEqual(plan, {
    name: '2026–2027 bütçesi',
    academicYear: 2026,
    startDate: '2026-09-07',
    endDate: '2027-08-31',
  })
  const ranged = planBudgetPeriod(
    { name: 'Mali yıl', startDate: '2027-01-01', endDate: '2027-12-31' },
    { periods: [], yearDates },
  )
  assert.equal(ranged.academicYear, null)
})

test('DOM-FIN-062: dönem ya yıl ya aralık; ters, uzun ve aynı adlı dönem reddedilir', () => {
  assert.throws(() => budgetPeriodSchema.parse({ name: 'Boş' }), ZodError)
  assert.throws(
    () => budgetPeriodSchema.parse({ name: 'İkisi', academicYear: 2026, startDate: '2026-09-01' }),
    ZodError,
  )
  assert.throws(
    () => budgetPeriodSchema.parse({ name: 'Yarım', startDate: '2026-09-01' }),
    ZodError,
  )
  const plan = (input: unknown, periods: BudgetPeriodNode[] = []) =>
    planBudgetPeriod(input, { periods, yearDates })
  assert.throws(
    () => plan({ name: 'Ters', startDate: '2026-09-02', endDate: '2026-09-01' }),
    isDomainError('budget_period_dates_invalid'),
  )
  assert.equal(
    plan({ name: 'Tek gün', startDate: '2026-09-01', endDate: '2026-09-01' }).name,
    'Tek gün',
  )
  assert.equal(
    plan({ name: 'Artık yıl', startDate: '2027-09-01', endDate: '2028-08-31' }).endDate,
    '2028-08-31',
  )
  assert.throws(
    () => plan({ name: 'Uzun', startDate: '2026-09-01', endDate: '2027-09-02' }),
    isDomainError('budget_period_too_long'),
  )
  assert.throws(
    () => plan({ name: 'Dönem 1', academicYear: 2026 }, [period(1)]),
    isDomainError('budget_period_name_taken', 'conflict'),
  )
})

test('DOM-FIN-062: dönem günleri yalnız taslakta ve dağılımlı satır yokken değişir', () => {
  const context = { periods: [period(1)], yearDates, hasDistributedLines: false }
  assert.deepEqual(
    planBudgetPeriodUpdate(period(1), { startDate: '2027-01-01', endDate: '2027-12-31' }, context),
    { academicYear: null, startDate: '2027-01-01', endDate: '2027-12-31' },
  )
  assert.deepEqual(planBudgetPeriodUpdate(period(1), { academicYear: 2027 }, context), {
    academicYear: 2027,
    startDate: '2027-09-01',
    endDate: '2028-08-31',
  })
  assert.throws(
    () =>
      planBudgetPeriodUpdate(
        period(1),
        { academicYear: 2027 },
        {
          ...context,
          hasDistributedLines: true,
        },
      ),
    isDomainError('budget_period_has_distribution'),
  )
  // Aynı günlere yeniden bağlamak dağılımı bozmaz.
  assert.deepEqual(
    planBudgetPeriodUpdate(
      period(1),
      { academicYear: 2026 },
      { ...context, hasDistributedLines: true },
    ),
    { academicYear: 2026, startDate: '2026-09-01', endDate: '2027-08-31' },
  )
  const open = period(1, { status: 'open' })
  assert.throws(
    () => planBudgetPeriodUpdate(open, { academicYear: 2027 }, context),
    isDomainError('budget_period_not_draft'),
  )
  assert.deepEqual(planBudgetPeriodUpdate(open, { name: 'Yeni ad' }, context), { name: 'Yeni ad' })
  assert.throws(
    () =>
      planBudgetPeriodUpdate(open, { name: 'Dönem 2' }, { ...context, periods: [open, period(2)] }),
    isDomainError('budget_period_name_taken', 'conflict'),
  )
  assert.throws(
    () => planBudgetPeriodUpdate(period(1, { status: 'closed' }), { name: 'Kapalı' }, context),
    isDomainError('budget_period_closed'),
  )
  assert.throws(
    () =>
      planBudgetPeriodUpdate(period(1), { academicYear: 2026, startDate: '2026-09-01' }, context),
    ZodError,
  )
})

test('DOM-FIN-062: taslak → açık → kapalı; açık dönemler örtüşmez (K-56, K-57)', () => {
  const draft = period(1)
  assert.doesNotThrow(() => planBudgetPeriodOpen(draft, [draft, period(2)]))
  const openOther = period(2, { status: 'open', startDate: '2027-08-31', endDate: '2027-12-31' })
  assert.throws(
    () => planBudgetPeriodOpen(draft, [draft, openOther]),
    isDomainError('budget_period_overlap'),
  )
  const adjacent = { ...openOther, startDate: '2027-09-01' }
  assert.doesNotThrow(() => planBudgetPeriodOpen(draft, [draft, adjacent]))
  assert.throws(
    () => planBudgetPeriodOpen(period(1, { status: 'open' }), []),
    isDomainError('budget_period_not_draft'),
  )
  assert.throws(() => planBudgetPeriodClose(draft), isDomainError('budget_period_not_open'))
  assert.doesNotThrow(() => planBudgetPeriodClose({ status: 'open' }))
  assert.throws(
    () => planBudgetPeriodClose({ status: 'closed' }),
    isDomainError('budget_period_not_open'),
  )
  assert.throws(
    () => assertPeriodWritable({ status: 'closed' }),
    isDomainError('budget_period_closed'),
  )
})

test('DOM-FIN-062: dönem ayları takvim ayıdır; eşit bölmede kalan kuruş ilk aylara', () => {
  assert.equal(periodMonths({ startDate: '2026-09-01', endDate: '2027-08-31' }).length, 12)
  assert.deepEqual(periodMonths({ startDate: '2026-11-15', endDate: '2027-02-01' }), [
    '2026-11',
    '2026-12',
    '2027-01',
    '2027-02',
  ])
  assert.deepEqual(periodMonths({ startDate: '2026-09-15', endDate: '2026-09-20' }), ['2026-09'])
  assert.deepEqual(evenMonthlySplit(1_000, 3), [334, 333, 333])
  assert.deepEqual(evenMonthlySplit(0, 2), [0, 0])
  assert.deepEqual(evenMonthlySplit(100, 0), [])
})

// --- Satır ---------------------------------------------------------------------------------------

const lineInput = {
  costCenterId: id(1),
  itemId: id(2),
  amountCents: 1_200_000,
}
type LineContext = Parameters<typeof planBudgetLine>[1]
const lineContext: LineContext = {
  period: period(1),
  center: { isActive: true },
  item: { isActive: true },
  duplicate: false,
}

test('DOM-FIN-062: satır planlanan tutarı ve isteğe bağlı aylık dağılımı taşır (K-59)', () => {
  assert.deepEqual(planBudgetLine(lineInput, lineContext), { ...lineInput, monthlyCents: null })
  const monthly = evenMonthlySplit(1_200_000, 12)
  assert.deepEqual(
    planBudgetLine({ ...lineInput, monthlyCents: monthly }, lineContext).monthlyCents,
    monthly,
  )
  assert.throws(
    () =>
      planBudgetLine({ ...lineInput, monthlyCents: evenMonthlySplit(1_200_000, 11) }, lineContext),
    isDomainError('budget_line_months_mismatch'),
  )
  assert.throws(
    () =>
      planBudgetLine({ ...lineInput, monthlyCents: evenMonthlySplit(1_199_999, 12) }, lineContext),
    isDomainError('budget_line_monthly_sum'),
  )
  assert.throws(() => planBudgetLine({ ...lineInput, amountCents: -1 }, lineContext), ZodError)
  assert.throws(() => planBudgetLine({ ...lineInput, amountCents: 1.5 }, lineContext), ZodError)
  assert.throws(
    () => planBudgetLine({ ...lineInput, amountCents: 1_000_000_000_001 }, lineContext),
    ZodError,
  )
})

test('DOM-FIN-062: kapalı dönem, eksik ya da pasif merkez ve kalem, mükerrer satır reddedilir', () => {
  const cases: [Partial<LineContext>, string, string?][] = [
    [{ period: period(1, { status: 'closed' }) }, 'budget_period_closed'],
    [{ center: null }, 'cost_center_not_found'],
    [{ center: { isActive: false } }, 'cost_center_inactive'],
    [{ item: null }, 'budget_item_not_found'],
    [{ item: { isActive: false } }, 'budget_item_inactive'],
    [{ duplicate: true }, 'budget_line_exists', 'conflict'],
  ]
  for (const [overrides, code, kind] of cases)
    assert.throws(
      () => planBudgetLine(lineInput, { ...lineContext, ...overrides }),
      isDomainError(code, kind),
      code,
    )
  // Açık dönemde satır eklenir.
  assert.equal(
    planBudgetLine(lineInput, { ...lineContext, period: period(1, { status: 'open' }) })
      .amountCents,
    1_200_000,
  )
})

test('DOM-FIN-062: satır düzeltmesinde dağılım tutarla tutarlı kalır; kapalı dönemde yok', () => {
  const current = { amountCents: 1_200, monthlyCents: evenMonthlySplit(1_200, 12) }
  const open = period(1, { status: 'open' })
  assert.throws(
    () => planBudgetLineUpdate(current, { amountCents: 2_400 }, open),
    isDomainError('budget_line_monthly_sum'),
  )
  assert.deepEqual(
    planBudgetLineUpdate(current, { amountCents: 2_400, monthlyCents: null }, open),
    {
      amountCents: 2_400,
      monthlyCents: null,
    },
  )
  assert.deepEqual(
    planBudgetLineUpdate({ amountCents: 5, monthlyCents: null }, { amountCents: 7 }, open),
    { amountCents: 7, monthlyCents: null },
  )
  assert.deepEqual(planBudgetLineUpdate(current, { amountCents: 1_200 }, open), current)
  assert.throws(
    () => planBudgetLineUpdate(current, { amountCents: 1 }, period(1, { status: 'closed' })),
    isDomainError('budget_period_closed'),
  )
  assert.throws(() => planBudgetLineUpdate(current, {}, open), ZodError)
})
