import assert from 'node:assert/strict'
import test from 'node:test'

import {
  planPurchaseRequest,
  planPurchaseRequestApprove,
  planPurchaseRequestCancel,
  planPurchaseRequestReject,
  planPurchaseRequestSubmit,
  planPurchaseRequestUpdate,
  purchaseBudgetInfo,
  purchaseRequestActions,
  purchaseRequestNumber,
  purchaseRequestSchema,
  requestTotalCents,
  type PurchaseRequestRefs,
  type PurchaseRequestState,
} from '../packages/school-core/src/lib/finance-purchase-requests.ts'

import { isDomainError } from './support/domain-error.ts'

// Satın alma talebi (DOM-FIN-071; ON-222).

const ZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'
const INPUT = {
  costCenterId: '00000000-0000-4000-8000-000000000001',
  periodId: '00000000-0000-4000-8000-000000000002',
  budgetItemId: '00000000-0000-4000-8000-000000000003',
  justification: 'Fen laboratuvarı için deney malzemesi',
  items: [
    { name: 'Deney tüpü', quantity: 40, unit: 'piece', estimatedUnitPriceCents: 2_500 },
    { name: 'Eldiven', quantity: 3, unit: 'box', estimatedUnitPriceCents: 15_000 },
  ],
}
const REFS: PurchaseRequestRefs = {
  period: { status: 'open' },
  costCenter: { isActive: true },
  budgetItem: { kind: 'expense', isActive: true },
}
const ADMIN = { userId: 'test-admin', role: 'yonetici' }
const FRONT = { userId: 'test-front', role: 'onburo' }
const draft = (overrides: Partial<PurchaseRequestState> = {}): PurchaseRequestState => ({
  status: 'draft',
  requestedByUserId: FRONT.userId,
  ...overrides,
})

test('DOM-FIN-071: talep taslak olarak açılır; tutar miktar × tahmini birim fiyattan hesaplanır', () => {
  const plan = planPurchaseRequest(INPUT, REFS)
  assert.equal(plan.supplierId, null)
  assert.equal(requestTotalCents(plan.items), 40 * 2_500 + 3 * 15_000)
  assert.equal(purchaseRequestNumber(7), 'ST-0007')
  assert.equal(purchaseRequestNumber(12345), 'ST-12345')
})

test('DOM-FIN-071: kalem, miktar, birim ve gerekçe doğrulanır', () => {
  const bad = [
    { ...INPUT, items: [] },
    { ...INPUT, justification: 'kısa' },
    { ...INPUT, items: [{ ...INPUT.items[0], quantity: 1.5 }] },
    { ...INPUT, items: [{ ...INPUT.items[0], quantity: 0 }] },
    { ...INPUT, items: [{ ...INPUT.items[0], unit: 'ton' }] },
    { ...INPUT, items: [{ ...INPUT.items[0], estimatedUnitPriceCents: 0 }] },
    { ...INPUT, items: Array.from({ length: 51 }, () => INPUT.items[0]) },
    {
      ...INPUT,
      items: [{ ...INPUT.items[0], quantity: 1_000_000, estimatedUnitPriceCents: 100_000_000_000 }],
    },
    { ...INPUT, institutionId: 'b' },
  ]
  for (const input of bad) assert.equal(purchaseRequestSchema.safeParse(input).success, false)
  assert.throws(() => planPurchaseRequest({ ...INPUT, items: [] }, REFS), ZodError)
})

test('DOM-FIN-071: dönem kapalı değil, merkez etkin, kalem etkin gider kalemi, tedarikçi etkin', () => {
  const cases: [Partial<PurchaseRequestRefs>, string][] = [
    [{ period: null }, 'purchase_request_period_not_found'],
    [{ period: { status: 'closed' } }, 'purchase_request_period_closed'],
    [{ costCenter: null }, 'purchase_request_cost_center_not_found'],
    [{ costCenter: { isActive: false } }, 'purchase_request_cost_center_inactive'],
    [{ budgetItem: null }, 'purchase_request_budget_item_not_found'],
    [
      { budgetItem: { kind: 'income', isActive: true } },
      'purchase_request_budget_item_not_expense',
    ],
    [{ budgetItem: { kind: 'expense', isActive: false } }, 'purchase_request_budget_item_inactive'],
    [{ supplier: null }, 'purchase_request_supplier_not_found'],
    [{ supplier: { isActive: false } }, 'purchase_request_supplier_inactive'],
  ]
  for (const [refs, code] of cases)
    assert.throws(() => planPurchaseRequest(INPUT, { ...REFS, ...refs }), isDomainError(code))
  // Taslak dönem talep alır; gönderim açık dönem ister.
  assert.doesNotThrow(() => planPurchaseRequest(INPUT, { ...REFS, period: { status: 'draft' } }))
})

test('DOM-FIN-071: yalnız taslak düzeltilir; ön büro yalnız kendi talebini (K-128)', () => {
  assert.deepEqual(
    planPurchaseRequestUpdate(draft(), { justification: 'Yeni gerekçe metni' }, REFS, FRONT),
    { justification: 'Yeni gerekçe metni' },
  )
  assert.doesNotThrow(() => planPurchaseRequestUpdate(draft(), { supplierId: null }, REFS, ADMIN))
  assert.throws(
    () =>
      planPurchaseRequestUpdate(
        draft({ requestedByUserId: 'test-other' }),
        { supplierId: null },
        REFS,
        FRONT,
      ),
    isDomainError('purchase_request_not_owner', 'forbidden'),
  )
  assert.throws(
    () =>
      planPurchaseRequestUpdate(draft({ status: 'submitted' }), { supplierId: null }, REFS, ADMIN),
    isDomainError('purchase_request_not_draft'),
  )
  assert.throws(() => planPurchaseRequestUpdate(draft(), {}, REFS, ADMIN), ZodError)
})

test('DOM-FIN-071: gönderim taslak ve açık dönem ister', () => {
  assert.doesNotThrow(() => planPurchaseRequestSubmit(draft(), REFS, FRONT))
  assert.throws(
    () => planPurchaseRequestSubmit(draft(), { ...REFS, period: { status: 'draft' } }, FRONT),
    isDomainError('purchase_request_period_not_open'),
  )
  assert.throws(
    () => planPurchaseRequestSubmit(draft({ status: 'submitted' }), REFS, FRONT),
    isDomainError('purchase_request_not_draft'),
  )
  assert.throws(
    () => planPurchaseRequestSubmit(draft(), { ...REFS, costCenter: { isActive: false } }, FRONT),
    isDomainError('purchase_request_cost_center_inactive'),
  )
})

test('DOM-FIN-071: onay ve ret yalnız gönderilmiş talepte; ret gerekçeli, onay açık dönemde', () => {
  const submitted = draft({ status: 'submitted' })
  assert.deepEqual(planPurchaseRequestApprove(submitted, undefined, REFS), { note: null })
  assert.deepEqual(planPurchaseRequestApprove(submitted, { note: ' Uygun ' }, REFS), {
    note: 'Uygun',
  })
  assert.throws(
    () => planPurchaseRequestApprove(submitted, {}, { period: { status: 'closed' } }),
    isDomainError('purchase_request_period_not_open'),
  )
  for (const status of ['draft', 'approved', 'rejected', 'cancelled'] as const) {
    assert.throws(
      () => planPurchaseRequestApprove(draft({ status }), {}, REFS),
      isDomainError('purchase_request_not_submitted'),
    )
    assert.throws(
      () => planPurchaseRequestReject(draft({ status }), { reason: 'Bütçe yetersiz' }),
      isDomainError('purchase_request_not_submitted'),
    )
  }
  assert.deepEqual(planPurchaseRequestReject(submitted, { reason: 'Bütçe yetersiz' }), {
    reason: 'Bütçe yetersiz',
  })
  assert.throws(() => planPurchaseRequestReject(submitted, { reason: 'yok' }), ZodError)
})

test('DOM-FIN-071: iptal taslak ya da gönderilmişte, gerekçeyle; onaylanmış iptal edilmez (K-132)', () => {
  const reason = { reason: 'Artık gerekmiyor' }
  assert.doesNotThrow(() => planPurchaseRequestCancel(draft(), reason, FRONT))
  assert.doesNotThrow(() =>
    planPurchaseRequestCancel(draft({ status: 'submitted' }), reason, ADMIN),
  )
  for (const status of ['approved', 'rejected', 'cancelled'] as const)
    assert.throws(
      () => planPurchaseRequestCancel(draft({ status }), reason, ADMIN),
      isDomainError('purchase_request_not_cancellable'),
    )
  assert.throws(
    () => planPurchaseRequestCancel(draft({ requestedByUserId: 'test-other' }), reason, FRONT),
    isDomainError('purchase_request_not_owner', 'forbidden'),
  )
  assert.throws(() => planPurchaseRequestCancel(draft(), {}, FRONT), ZodError)
})

test('DOM-FIN-071: bütçe kalanı plan eksi onaylanmış taleplerdir; aşım yalnız bilgidir (K-131)', () => {
  assert.deepEqual(
    purchaseBudgetInfo(
      { plannedCents: 100_000, approvedCents: 60_000, pendingCents: 10_000 },
      50_000,
    ),
    {
      plannedCents: 100_000,
      approvedCents: 60_000,
      pendingCents: 10_000,
      remainingCents: 40_000,
      exceedsRemaining: true,
    },
  )
  assert.equal(
    purchaseBudgetInfo({ plannedCents: 100_000, approvedCents: 0, pendingCents: 0 }, 100_000)
      .exceedsRemaining,
    false,
  )
  const noLine = purchaseBudgetInfo({ plannedCents: null, approvedCents: 0, pendingCents: 0 }, 1)
  assert.equal(noLine.remainingCents, null)
  assert.equal(noLine.exceedsRemaining, false)
})

test('DOM-FIN-071: rol ve duruma göre ekran işlemleri', () => {
  assert.deepEqual(purchaseRequestActions(draft(), FRONT), {
    edit: true,
    submit: true,
    cancel: true,
    decide: false,
  })
  assert.deepEqual(purchaseRequestActions(draft(), { userId: 'test-other', role: 'onburo' }), {
    edit: false,
    submit: false,
    cancel: false,
    decide: false,
  })
  assert.deepEqual(purchaseRequestActions(draft({ status: 'submitted' }), ADMIN), {
    edit: false,
    submit: false,
    cancel: true,
    decide: true,
  })
  assert.deepEqual(purchaseRequestActions(draft({ status: 'submitted' }), FRONT).decide, false)
  assert.deepEqual(purchaseRequestActions(draft({ status: 'approved' }), ADMIN), {
    edit: false,
    submit: false,
    cancel: false,
    decide: false,
  })
  assert.deepEqual(
    purchaseRequestActions(draft({ requestedByUserId: 'test-teacher' }), {
      userId: 'test-teacher',
      role: 'ogretmen',
    }),
    { edit: false, submit: false, cancel: false, decide: false },
  )
})
