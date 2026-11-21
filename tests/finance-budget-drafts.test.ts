import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BUDGET_DRAFT_STATUSES,
  budgetDraftActions,
  budgetDraftChanges,
  budgetDraftComparison,
  budgetDraftComparisonCsv,
  budgetDraftLinesSchema,
  budgetDraftReasonSchema,
  budgetDraftTotals,
  budgetDraftTransition,
  canBudgetDraft,
  canPrepareBudgetDraft,
  planBudgetDraftApproval,
  planBudgetDraftCreate,
  planBudgetDraftLines,
  planBudgetDraftReopen,
  planBudgetDraftSubmit,
  planBudgetOwner,
  previousBudgetPeriod,
  type BudgetDraftLineValue,
  type BudgetDraftStatus,
} from '../packages/school-core/src/lib/finance-budget-drafts.ts'

import { isDomainError } from './support/domain-error.ts'

// Bütçe hazırlama ve onay (DOM-FIN-093; ON-243).

const PERIOD = '11111111-1111-4111-8111-111111111111'
const CENTER = '22222222-2222-4222-8222-222222222222'
const ITEM_A = '33333333-3333-4333-8333-333333333333'
const ITEM_B = '44444444-4444-4444-8444-444444444444'
const ITEM_C = '55555555-5555-4555-8555-555555555555'
const OPEN = { status: 'open' as const }
const CLOSED = { status: 'closed' as const }
const MANAGER = { role: 'yonetici', isOwner: false }
const OWNER = { role: 'ogretmen', isOwner: true }
const STRANGER = { role: 'onburo', isOwner: false }
const items = new Map([
  [ITEM_A, { isActive: true }],
  [ITEM_B, { isActive: true }],
  [ITEM_C, { isActive: false }],
])
const line = (
  itemId: string,
  amountCents: number,
  justification: string | null = null,
): BudgetDraftLineValue => ({ itemId, amountCents, justification })

test('DOM-FIN-093: durum geçişleri; geçersiz geçiş 422 budget_draft_status_invalid', () => {
  assert.equal(budgetDraftTransition('draft', 'submit'), 'submitted')
  assert.equal(budgetDraftTransition('revision_requested', 'submit'), 'submitted')
  assert.equal(budgetDraftTransition('submitted', 'approve'), 'approved')
  assert.equal(budgetDraftTransition('submitted', 'requestRevision'), 'revision_requested')
  assert.equal(budgetDraftTransition('submitted', 'reject'), 'rejected')
  assert.equal(budgetDraftTransition('approved', 'reopen'), 'draft')
  assert.equal(budgetDraftTransition('revision_requested', 'edit'), 'revision_requested')
  const allowed: Record<BudgetDraftStatus, string[]> = {
    draft: ['edit', 'submit'],
    submitted: ['approve', 'requestRevision', 'reject'],
    approved: ['reopen'],
    revision_requested: ['edit', 'submit'],
    rejected: [],
  }
  for (const status of BUDGET_DRAFT_STATUSES)
    for (const action of [
      'edit',
      'submit',
      'approve',
      'requestRevision',
      'reject',
      'reopen',
    ] as const) {
      assert.equal(canBudgetDraft(status, action), allowed[status].includes(action))
      if (!allowed[status].includes(action))
        assert.throws(
          () => budgetDraftTransition(status, action),
          isDomainError('budget_draft_status_invalid'),
        )
    }
})

test('DOM-FIN-093: taslağı yönetici ya da birim sorumlusu açar; pasif merkez, kapalı dönem ve ikinci taslak reddedilir (K-257)', () => {
  const input = { periodId: PERIOD, costCenterId: CENTER }
  const checks = {
    period: OPEN,
    center: { isActive: true },
    actor: OWNER,
    exists: false,
  }
  assert.deepEqual(planBudgetDraftCreate(input, checks), input)
  assert.deepEqual(planBudgetDraftCreate(input, { ...checks, actor: MANAGER }), input)
  assert.throws(
    () => planBudgetDraftCreate(input, { ...checks, actor: STRANGER }),
    isDomainError('budget_draft_not_owner', 'forbidden'),
  )
  assert.throws(
    () => planBudgetDraftCreate(input, { ...checks, center: null }),
    isDomainError('cost_center_not_found'),
  )
  assert.throws(
    () => planBudgetDraftCreate(input, { ...checks, center: { isActive: false } }),
    isDomainError('cost_center_inactive'),
  )
  assert.throws(
    () => planBudgetDraftCreate(input, { ...checks, period: null }),
    isDomainError('budget_period_not_found'),
  )
  assert.throws(
    () => planBudgetDraftCreate(input, { ...checks, period: CLOSED }),
    isDomainError('budget_period_closed'),
  )
  assert.throws(
    () => planBudgetDraftCreate(input, { ...checks, exists: true }),
    isDomainError('budget_draft_exists', 'conflict'),
  )
  assert.throws(() => planBudgetDraftCreate({ periodId: 'x', costCenterId: CENTER }, checks))
  assert.equal(canPrepareBudgetDraft(MANAGER), true)
  assert.equal(canPrepareBudgetDraft(OWNER), true)
  assert.equal(canPrepareBudgetDraft(STRANGER), false)
})

test('DOM-FIN-093: satırlar yerine yazılır; kalem tekil, pasif kalem yeni eklenemez, boş gerekçe null', () => {
  const checks = {
    status: 'draft' as const,
    period: OPEN,
    items,
    currentItemIds: new Set([ITEM_C]),
  }
  assert.deepEqual(
    planBudgetDraftLines(
      {
        lines: [
          { itemId: ITEM_A, amountCents: 100_000, justification: '  Yeni öğretmen  ' },
          { itemId: ITEM_C, amountCents: 0, justification: '   ' },
        ],
      },
      checks,
    ),
    [line(ITEM_A, 100_000, 'Yeni öğretmen'), line(ITEM_C, 0)],
  )
  const duplicate = budgetDraftLinesSchema.safeParse({
    lines: [
      { itemId: ITEM_A, amountCents: 1 },
      { itemId: ITEM_A, amountCents: 2 },
    ],
  })
  assert.equal(duplicate.success, false)
  assert.deepEqual(duplicate.error?.issues[0]?.path, ['lines', 1, 'itemId'])
  assert.equal(
    budgetDraftLinesSchema.safeParse({ lines: [{ itemId: ITEM_A, amountCents: -1 }] }).success,
    false,
  )
  assert.equal(
    budgetDraftLinesSchema.safeParse({ lines: [{ itemId: ITEM_A, amountCents: 1.5 }] }).success,
    false,
  )
  assert.throws(
    () =>
      planBudgetDraftLines(
        { lines: [{ itemId: ITEM_C, amountCents: 1 }] },
        {
          ...checks,
          currentItemIds: new Set(),
        },
      ),
    (error: unknown) =>
      isDomainError('budget_item_inactive')(error) &&
      JSON.stringify((error as { path: unknown }).path) === '["lines","0","itemId"]',
  )
  assert.throws(
    () => planBudgetDraftLines({ lines: [{ itemId: PERIOD, amountCents: 1 }] }, checks),
    isDomainError('budget_item_not_found'),
  )
  assert.throws(
    () => planBudgetDraftLines({ lines: [] }, { ...checks, status: 'submitted' }),
    isDomainError('budget_draft_status_invalid'),
  )
  assert.throws(
    () => planBudgetDraftLines({ lines: [] }, { ...checks, period: CLOSED }),
    isDomainError('budget_period_closed'),
  )
})

test('DOM-FIN-093: gönderim sürümü artırır; satırsız taslak ve gerekçesiz değişen kalem 422 (K-257)', () => {
  const approved = new Map([[ITEM_A, 100_000]])
  const base = { status: 'draft' as const, revision: 0, period: OPEN, approved }
  // Onaylı tutarı aynı kalan kalem ve sıfır tutarlı yeni kalem gerekçe istemez.
  assert.deepEqual(
    planBudgetDraftSubmit({ ...base, lines: [line(ITEM_A, 100_000), line(ITEM_B, 0)] }),
    { status: 'submitted', revision: 1 },
  )
  assert.deepEqual(
    planBudgetDraftSubmit({
      ...base,
      status: 'revision_requested',
      revision: 2,
      lines: [line(ITEM_A, 150_000, 'Fiyat artışı')],
    }),
    { status: 'submitted', revision: 3 },
  )
  assert.throws(
    () => planBudgetDraftSubmit({ ...base, lines: [line(ITEM_A, 100_000), line(ITEM_B, 5)] }),
    (error: unknown) =>
      isDomainError('budget_draft_justification_required')(error) &&
      JSON.stringify((error as { path: unknown }).path) === '["lines","1","justification"]',
  )
  assert.throws(
    () => planBudgetDraftSubmit({ ...base, lines: [line(ITEM_A, 90_000)] }),
    isDomainError('budget_draft_justification_required'),
  )
  assert.throws(
    () => planBudgetDraftSubmit({ ...base, lines: [] }),
    isDomainError('budget_draft_empty'),
  )
  assert.throws(
    () => planBudgetDraftSubmit({ ...base, status: 'approved', lines: [line(ITEM_A, 1)] }),
    isDomainError('budget_draft_status_invalid'),
  )
  assert.throws(
    () => planBudgetDraftSubmit({ ...base, period: CLOSED, lines: [line(ITEM_A, 100_000)] }),
    isDomainError('budget_period_closed'),
  )
})

test('DOM-FIN-093: değişen kalemler eklenen, tutarı değişen ve çıkarılandır', () => {
  assert.deepEqual(
    budgetDraftChanges(
      [line(ITEM_A, 100), line(ITEM_B, 200)],
      [line(ITEM_A, 100), line(ITEM_C, 50), line(ITEM_B, 250)],
    ),
    [
      { itemId: ITEM_C, beforeCents: null, afterCents: 50 },
      { itemId: ITEM_B, beforeCents: 200, afterCents: 250 },
    ],
  )
  assert.deepEqual(budgetDraftChanges([line(ITEM_A, 100)], []), [
    { itemId: ITEM_A, beforeCents: 100, afterCents: null },
  ])
  assert.deepEqual(budgetDraftChanges([line(ITEM_A, 1)], [line(ITEM_A, 1)]), [])
})

test('DOM-FIN-093: onay bütçe satırlarını taslağa eşitler; dağılım tutar değişince kalkar (K-258)', () => {
  const current = [
    { id: 'l-a', itemId: ITEM_A, amountCents: 100, monthlyCents: [50, 50], version: 2 },
    { id: 'l-b', itemId: ITEM_B, amountCents: 200, monthlyCents: [100, 100], version: 1 },
    { id: 'l-c', itemId: ITEM_C, amountCents: 300, monthlyCents: null, version: 4 },
  ]
  const checks = {
    status: 'submitted' as const,
    period: OPEN,
    center: { isActive: true },
    items,
    lines: [line(ITEM_A, 100), line(ITEM_B, 250)],
    current,
  }
  assert.deepEqual(planBudgetDraftApproval(checks), {
    status: 'approved',
    inserts: [],
    updates: [{ id: 'l-b', version: 1, amountCents: 250, monthlyCents: null }],
    removals: [{ id: 'l-c', version: 4 }],
  })
  // Pasif kalem satırı olduğu sürece tutarı düzeltilebilir; yeni satır etkin kalem ister.
  assert.deepEqual(
    planBudgetDraftApproval({ ...checks, current: [], lines: [line(ITEM_A, 7)] }).inserts,
    [{ itemId: ITEM_A, amountCents: 7 }],
  )
  assert.equal(
    planBudgetDraftApproval({ ...checks, lines: [line(ITEM_C, 1)] }).updates[0]?.id,
    'l-c',
  )
  assert.throws(
    () => planBudgetDraftApproval({ ...checks, current: [], lines: [line(ITEM_C, 1)] }),
    isDomainError('budget_item_inactive'),
  )
  assert.throws(
    () =>
      planBudgetDraftApproval({
        ...checks,
        center: { isActive: false },
        current: [],
        lines: [line(ITEM_A, 1)],
      }),
    isDomainError('cost_center_inactive'),
  )
  // Pasif merkezde yalnız var olan satırlar düzeltilir.
  assert.equal(
    planBudgetDraftApproval({ ...checks, center: { isActive: false } }).updates.length,
    1,
  )
  assert.throws(
    () => planBudgetDraftApproval({ ...checks, status: 'draft' }),
    isDomainError('budget_draft_status_invalid'),
  )
  assert.throws(
    () => planBudgetDraftApproval({ ...checks, period: CLOSED }),
    isDomainError('budget_period_closed'),
  )
})

test('DOM-FIN-093: yeni revizyon yalnız onaylı taslaktan ve açık dönemde (K-258)', () => {
  assert.equal(planBudgetDraftReopen({ status: 'approved', period: OPEN }), 'draft')
  assert.throws(
    () => planBudgetDraftReopen({ status: 'submitted', period: OPEN }),
    isDomainError('budget_draft_status_invalid'),
  )
  assert.throws(
    () => planBudgetDraftReopen({ status: 'approved', period: CLOSED }),
    isDomainError('budget_period_closed'),
  )
})

test('DOM-FIN-093: ekran düğmeleri rol, sorumluluk, durum ve döneme göre (K-256, K-257)', () => {
  const none = {
    edit: false,
    submit: false,
    approve: false,
    requestRevision: false,
    reject: false,
    reopen: false,
  }
  assert.deepEqual(budgetDraftActions({ status: 'draft' }, OWNER, 'open'), {
    ...none,
    edit: true,
    submit: true,
  })
  assert.deepEqual(budgetDraftActions({ status: 'submitted' }, OWNER, 'open'), none)
  assert.deepEqual(budgetDraftActions({ status: 'submitted' }, MANAGER, 'draft'), {
    ...none,
    approve: true,
    requestRevision: true,
    reject: true,
  })
  assert.deepEqual(budgetDraftActions({ status: 'approved' }, OWNER, 'open'), {
    ...none,
    reopen: true,
  })
  assert.deepEqual(budgetDraftActions({ status: 'draft' }, STRANGER, 'open'), none)
  assert.deepEqual(budgetDraftActions({ status: 'submitted' }, MANAGER, 'closed'), none)
})

test('DOM-FIN-093: bütçe sorumlusu kurumun etkin personelidir; null sorumluyu kaldırır (K-257)', () => {
  assert.equal(
    planBudgetOwner({ membershipId: ' m-1 ' }, { role: 'ogretmen', active: true }),
    'm-1',
  )
  assert.equal(planBudgetOwner({ membershipId: null }, undefined), null)
  assert.throws(
    () => planBudgetOwner({ membershipId: 'm-1' }, null),
    isDomainError('budget_owner_not_found'),
  )
  assert.throws(
    () => planBudgetOwner({ membershipId: 'm-1' }, { role: 'veli', active: true }),
    isDomainError('budget_owner_not_staff'),
  )
  assert.throws(
    () => planBudgetOwner({ membershipId: 'm-1' }, { role: 'onburo', active: false }),
    isDomainError('budget_owner_inactive'),
  )
  assert.throws(() => planBudgetOwner({}, undefined))
  assert.equal(budgetDraftReasonSchema.safeParse({ reason: 'kısa' }).success, false)
})

test('DOM-FIN-093: önceki dönem bu dönemden önce biten son açık ya da kapalı dönemdir (K-259)', () => {
  const period = (
    id: string,
    startDate: string,
    endDate: string,
    status: 'draft' | 'open' | 'closed',
  ) => ({
    id,
    name: id,
    startDate,
    endDate,
    status,
  })
  const current = period('2026', '2026-09-01', '2027-08-31', 'draft')
  const periods = [
    current,
    period('2024', '2024-09-01', '2025-08-31', 'closed'),
    period('2025', '2025-09-01', '2026-08-31', 'closed'),
    period('2025-taslak', '2025-10-01', '2026-08-31', 'draft'),
    period('örtüşen', '2026-01-01', '2026-12-31', 'open'),
  ]
  assert.equal(previousBudgetPeriod(periods, current)?.id, '2025')
  assert.equal(previousBudgetPeriod([current], current), null)
  assert.equal(
    previousBudgetPeriod(
      [
        period('a', '2025-01-01', '2025-08-31', 'open'),
        period('b', '2025-03-01', '2025-08-31', 'open'),
      ],
      current,
    )?.id,
    'b',
  )
})

test('DOM-FIN-093: karşılaştırma taslak, onaylı bütçe ve önceki dönemi yan yana verir; CSV kaçışlı', () => {
  const comparisonItems = [
    { id: ITEM_B, code: 'P-100', name: 'Personel', kind: 'expense' as const },
    { id: ITEM_A, code: 'G-100', name: 'Öğrenim geliri', kind: 'income' as const },
    { id: ITEM_C, code: 'K-100', name: 'Kırtasiye', kind: 'expense' as const },
    { id: PERIOD, code: 'Z-1', name: 'İlgisiz', kind: 'expense' as const },
  ]
  const comparison = budgetDraftComparison({
    items: comparisonItems,
    draft: [line(ITEM_B, 500_00, '=Zam'), line(ITEM_A, 1_000_00)],
    approved: new Map([[ITEM_B, 400_00]]),
    previous: new Map([
      [ITEM_B, { plannedCents: 450_00, actualCents: 420_00 }],
      [ITEM_C, { plannedCents: null, actualCents: 30_00 }],
      [ITEM_A, { plannedCents: 900_00, actualCents: null }],
    ]),
  })
  assert.deepEqual(
    comparison.rows.map((row) => row.itemCode),
    ['G-100', 'K-100', 'P-100'],
  )
  const personnel = comparison.rows[2]
  assert.equal(personnel?.approvedCents, 400_00)
  assert.equal(personnel?.changeFromPreviousCents, 80_00)
  assert.equal(comparison.rows[1]?.draftCents, null)
  assert.equal(comparison.rows[0]?.changeFromPreviousCents, null)
  assert.deepEqual(comparison.totals.expense, {
    draftCents: 500_00,
    approvedCents: 400_00,
    previousPlanCents: 450_00,
    previousActualCents: 450_00,
  })
  assert.equal(comparison.totals.income.previousActualCents, 0)
  const csv = budgetDraftComparisonCsv(comparison).split('\r\n')
  assert.equal(
    csv[0],
    '"Kalem kodu";"Kalem";"Tür";"Önceki dönem planı (₺)";"Önceki dönem gerçekleşeni (₺)";"Onaylı bütçe (₺)";"Taslak (₺)";"Değişim (₺)";"Gerekçe"',
  )
  assert.equal(csv[3], '"P-100";"Personel";"Gider";450,00;420,00;400,00;500,00;80,00;"\'=Zam"')
  assert.equal(csv[5], '"";"Gider toplamı";"Gider";450,00;450,00;400,00;500,00;50,00;""')

  const fresh = budgetDraftComparison({
    items: comparisonItems,
    draft: [line(ITEM_A, 10)],
    approved: new Map(),
    previous: null,
  })
  assert.equal(fresh.totals.income.previousActualCents, null)
  assert.equal(
    budgetDraftComparisonCsv(fresh).split('\r\n')[2],
    '"";"Gelir toplamı";"Gelir";0,00;"";0,00;0,10;"";""',
  )
  assert.deepEqual(
    budgetDraftTotals([
      { amountCents: 5, itemKind: 'income' },
      { amountCents: 7, itemKind: 'expense' },
      { amountCents: 3, itemKind: 'expense' },
    ]),
    { incomeCents: 5, expenseCents: 10 },
  )
})
