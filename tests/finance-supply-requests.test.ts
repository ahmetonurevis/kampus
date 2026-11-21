import assert from 'node:assert/strict'
import test from 'node:test'

import {
  planStockMovementCancel,
  STOCK_MOVEMENT_TYPE_LABELS,
  type CancellableMovement,
  type StockItemRef,
  type StockMovementContext,
  type StockWarehouseRef,
} from '../packages/school-core/src/lib/finance-inventory.ts'
import { planPurchaseRequest } from '../packages/school-core/src/lib/finance-purchase-requests.ts'
import {
  canSeeAllSupplyRequests,
  canViewSupplyRequest,
  isLivePurchaseLink,
  planSupplyFulfillment,
  planSupplyPurchaseConversion,
  planSupplyRequest,
  planSupplyRequestApprove,
  planSupplyRequestCancel,
  planSupplyRequestReject,
  remainingOf,
  supplyRemaining,
  supplyRequestActions,
  supplyRequestNumber,
  type SupplyLine,
  type SupplyRequestState,
  type SupplyStockCard,
} from '../packages/school-core/src/lib/finance-supply-requests.ts'

import { isDomainError } from './support/domain-error.ts'

// Sarf malzeme talebi (DOM-FIN-091; ON-233).

const ZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'
const issuePaths = (error: unknown) =>
  (error as { issues: { path: (string | number)[] }[] }).issues.map((issue) => issue.path.join('.'))

const PAPER = '00000000-0000-4000-8000-0000000000b1'
const GLOVE = '00000000-0000-4000-8000-0000000000b2'
const OLD = '00000000-0000-4000-8000-0000000000b3'
const MISSING = '00000000-0000-4000-8000-0000000000ff'
const MAIN = '00000000-0000-4000-8000-0000000000c1'
const LINE_PAPER = '00000000-0000-4000-8000-0000000000d1'
const LINE_GLOVE = '00000000-0000-4000-8000-0000000000d2'
const TODAY = '2026-10-06'

const CARDS = new Map<string, SupplyStockCard>([
  [PAPER, { id: PAPER, code: 'KAG-A4', name: 'A4 kâğıt', unit: 'pack', isActive: true }],
  [GLOVE, { id: GLOVE, code: 'ELD-M', name: 'Lateks eldiven', unit: 'box', isActive: true }],
  [OLD, { id: OLD, code: 'ESKI', name: 'Eski tebeşir', unit: 'box', isActive: false }],
])
const TEACHER = { userId: 'test-teacher', role: 'ogretmen' }
const OTHER_TEACHER = { userId: 'test-teacher-2', role: 'ogretmen' }
const ADMIN = { userId: 'test-admin', role: 'yonetici' }
const FRONT = { userId: 'test-front', role: 'onburo' }
const INPUT = {
  neededDate: '2026-10-09',
  justification: '9-A fen deneyi için',
  items: [
    { stockItemId: PAPER, quantity: 4 },
    { stockItemId: GLOVE, quantity: 2 },
  ],
}

const submitted = (overrides: Partial<SupplyRequestState> = {}): SupplyRequestState => ({
  status: 'submitted',
  requestedByUserId: TEACHER.userId,
  ...overrides,
})
const lines = (paperDone = 0, gloveDone = 0): SupplyLine[] => [
  { id: LINE_PAPER, stockItemId: PAPER, quantity: 4, fulfilledQuantity: paperDone },
  { id: LINE_GLOVE, stockItemId: GLOVE, quantity: 2, fulfilledQuantity: gloveDone },
]
const approved = (paperDone = 0, gloveDone = 0) => ({
  ...submitted({ status: 'approved' }),
  lines: lines(paperDone, gloveDone),
})

const STOCK_ITEMS = new Map<string, StockItemRef>(
  [...CARDS.values()].map((card) => [card.id, card]),
)
const WAREHOUSES = new Map<string, StockWarehouseRef>([
  [MAIN, { id: MAIN, name: 'Ana depo', campusId: 'b1', isActive: true }],
])
let movementCount = 0
const entry = (itemId: string, quantity: number, movementDate = '2026-10-01') => ({
  id: `m${String((movementCount += 1))}`,
  itemId,
  warehouseId: MAIN,
  type: 'in' as const,
  quantity,
  movementDate,
  cancelledAt: null,
})
const stock = (movements: StockMovementContext['movements']): StockMovementContext => ({
  items: STOCK_ITEMS,
  warehouses: WAREHOUSES,
  movements,
  today: TODAY,
})
const FULFILL = { warehouseId: MAIN, movementDate: TODAY }

test('DOM-FIN-091: talep stok kartlarından açılır; numara sıradan türetilir', () => {
  const plan = planSupplyRequest(INPUT, { cards: CARDS, today: TODAY })
  assert.equal(plan.items.length, 2)
  assert.equal(plan.justification, '9-A fen deneyi için')
  assert.equal(supplyRequestNumber(7), 'SM-0007')
  assert.equal(supplyRequestNumber(12345), 'SM-12345')
})

test('DOM-FIN-091: bilinmeyen ya da başka kurumun kartı alan hatası (400), pasif kart 422', () => {
  assert.throws(
    () =>
      planSupplyRequest(
        { ...INPUT, items: [{ stockItemId: MISSING, quantity: 1 }] },
        { cards: CARDS, today: TODAY },
      ),
    (error) => ZodError(error) && issuePaths(error).includes('items.0.stockItemId'),
  )
  assert.throws(
    () =>
      planSupplyRequest(
        { ...INPUT, items: [{ stockItemId: OLD, quantity: 1 }] },
        { cards: CARDS, today: TODAY },
      ),
    isDomainError('supply_request_stock_item_inactive'),
  )
})

test('DOM-FIN-091: şema kalemsiz, mükerrer kartlı, sıfır miktarlı ve kısa gerekçeli talebi reddeder', () => {
  const context = { cards: CARDS, today: TODAY }
  for (const input of [
    { ...INPUT, items: [] },
    { ...INPUT, items: [INPUT.items[0], INPUT.items[0]] },
    { ...INPUT, items: [{ stockItemId: PAPER, quantity: 0 }] },
    { ...INPUT, items: [{ stockItemId: PAPER, quantity: 1.5 }] },
    { ...INPUT, justification: 'kısa' },
    { ...INPUT, neededDate: '09.10.2026' },
    { ...INPUT, institutionId: 'baska-kurum' },
  ])
    assert.throws(() => planSupplyRequest(input, context), ZodError)
})

test('DOM-FIN-091: istenen gün bugünden önce ve bir yıldan sonra olamaz', () => {
  const context = { cards: CARDS, today: TODAY }
  assert.throws(
    () => planSupplyRequest({ ...INPUT, neededDate: '2026-10-05' }, context),
    isDomainError('supply_request_needed_date_past'),
  )
  assert.equal(planSupplyRequest({ ...INPUT, neededDate: TODAY }, context).neededDate, TODAY)
  assert.equal(
    planSupplyRequest({ ...INPUT, neededDate: '2027-10-06' }, context).neededDate,
    '2027-10-06',
  )
  assert.throws(
    () => planSupplyRequest({ ...INPUT, neededDate: '2027-10-07' }, context),
    isDomainError('supply_request_needed_date_too_far'),
  )
})

test('DOM-FIN-091: onay ve ret yalnız onay bekleyen talepte; ret gerekçe ister', () => {
  assert.deepEqual(planSupplyRequestApprove(submitted(), undefined), { note: null })
  assert.deepEqual(planSupplyRequestApprove(submitted(), { note: '' }), { note: null })
  assert.equal(planSupplyRequestApprove(submitted(), { note: 'Uygun' }).note, 'Uygun')
  assert.equal(planSupplyRequestReject(submitted(), { reason: 'Bütçe yok' }).reason, 'Bütçe yok')
  assert.throws(() => planSupplyRequestReject(submitted(), { reason: 'yok' }), ZodError)
  for (const status of ['approved', 'rejected', 'fulfilled', 'cancelled'] as const) {
    assert.throws(
      () => planSupplyRequestApprove(submitted({ status }), {}),
      isDomainError('supply_request_not_submitted'),
    )
    assert.throws(
      () => planSupplyRequestReject(submitted({ status }), { reason: 'Gerekmiyor' }),
      isDomainError('supply_request_not_submitted'),
    )
  }
})

test('DOM-FIN-091: iptali yalnız talep eden onaydan önce yapar; yönetici başkasınınkini iptal etmez', () => {
  assert.equal(
    planSupplyRequestCancel(submitted(), { reason: 'Vazgeçildi' }, TEACHER).reason,
    'Vazgeçildi',
  )
  assert.throws(
    () => planSupplyRequestCancel(submitted(), { reason: 'Vazgeçildi' }, ADMIN),
    isDomainError('supply_request_not_owner', 'forbidden'),
  )
  assert.throws(
    () => planSupplyRequestCancel(submitted({ status: 'approved' }), { reason: 'Geç' }, TEACHER),
    ZodError,
  )
  assert.throws(
    () =>
      planSupplyRequestCancel(submitted({ status: 'approved' }), { reason: 'Vazgeçildi' }, TEACHER),
    isDomainError('supply_request_not_cancellable'),
  )
})

test('DOM-FIN-091: karşılama kalemleri stoktan tam çıkarınca talep karşılanır', () => {
  const plan = planSupplyFulfillment(
    approved(),
    FULFILL,
    stock([entry(PAPER, 10), entry(GLOVE, 5)]),
  )
  assert.equal(plan.status, 'fulfilled')
  assert.equal(plan.partial, false)
  assert.deepEqual(plan.issues, [
    { requestItemId: LINE_PAPER, stockItemId: PAPER, quantity: 4 },
    { requestItemId: LINE_GLOVE, stockItemId: GLOVE, quantity: 2 },
  ])
})

test('DOM-FIN-091: stok yetmezse karşılanabilen miktar çıkar, talep onaylı kalır', () => {
  const plan = planSupplyFulfillment(approved(), FULFILL, stock([entry(PAPER, 3)]))
  assert.equal(plan.status, 'approved')
  assert.deepEqual(plan.issues, [{ requestItemId: LINE_PAPER, stockItemId: PAPER, quantity: 3 }])
  // İkinci karşılama yalnız kalanı çıkarır.
  const second = planSupplyFulfillment(
    approved(3, 0),
    FULFILL,
    stock([entry(PAPER, 3), entry(PAPER, 10, '2026-10-05'), entry(GLOVE, 2)]),
  )
  assert.deepEqual(
    second.issues.map((issue) => issue.quantity),
    [1, 2],
  )
  assert.equal(second.status, 'fulfilled')
})

test('DOM-FIN-091: depoda hiç stok yoksa karşılama 422; kısmi kapatma açıklama ister', () => {
  assert.throws(
    () => planSupplyFulfillment(approved(), FULFILL, stock([])),
    isDomainError('supply_request_nothing_available'),
  )
  assert.throws(
    () => planSupplyFulfillment(approved(), { ...FULFILL, close: true }, stock([])),
    isDomainError('supply_request_close_note_required'),
  )
  assert.throws(
    () =>
      planSupplyFulfillment(approved(), { ...FULFILL, close: true, closeNote: 'yok' }, stock([])),
    isDomainError('supply_request_close_note_short'),
  )
  const closed = planSupplyFulfillment(
    approved(),
    { ...FULFILL, close: true, closeNote: 'Eldiven alınmayacak' },
    stock([entry(PAPER, 10)]),
  )
  assert.equal(closed.status, 'fulfilled')
  assert.equal(closed.partial, true)
  assert.equal(closed.closeNote, 'Eldiven alınmayacak')
  assert.deepEqual(
    closed.issues.map((issue) => issue.stockItemId),
    [PAPER],
  )
})

test('DOM-FIN-091: elle miktar kalanı ve depodaki miktarı aşamaz; bilinmeyen kalem 400', () => {
  const movements = stock([entry(PAPER, 2), entry(GLOVE, 5)])
  const plan = planSupplyFulfillment(
    approved(),
    { ...FULFILL, lines: [{ itemId: LINE_GLOVE, quantity: 1 }] },
    movements,
  )
  assert.deepEqual(plan.issues, [{ requestItemId: LINE_GLOVE, stockItemId: GLOVE, quantity: 1 }])
  assert.equal(plan.status, 'approved')
  assert.throws(
    () =>
      planSupplyFulfillment(
        approved(),
        { ...FULFILL, lines: [{ itemId: LINE_GLOVE, quantity: 3 }] },
        movements,
      ),
    isDomainError('supply_request_quantity_exceeds_remaining'),
  )
  assert.throws(
    () =>
      planSupplyFulfillment(
        approved(),
        { ...FULFILL, lines: [{ itemId: LINE_PAPER, quantity: 4 }] },
        movements,
      ),
    isDomainError('stock_insufficient'),
  )
  assert.throws(
    () =>
      planSupplyFulfillment(
        approved(),
        { ...FULFILL, lines: [{ itemId: MISSING, quantity: 1 }] },
        movements,
      ),
    (error) => ZodError(error) && issuePaths(error).includes('lines.0.itemId'),
  )
  assert.throws(
    () =>
      planSupplyFulfillment(
        approved(),
        {
          ...FULFILL,
          lines: [
            { itemId: LINE_GLOVE, quantity: 1 },
            { itemId: LINE_GLOVE, quantity: 1 },
          ],
        },
        movements,
      ),
    ZodError,
  )
})

test('DOM-FIN-091: onaysız talep karşılanmaz; gelecek gün ve pasif depo stok kurallarıyla reddedilir', () => {
  for (const status of ['submitted', 'rejected', 'fulfilled', 'cancelled'] as const)
    assert.throws(
      () =>
        planSupplyFulfillment(
          { ...submitted({ status }), lines: lines() },
          FULFILL,
          stock([entry(PAPER, 10)]),
        ),
      isDomainError('supply_request_not_approved'),
    )
  assert.throws(
    () =>
      planSupplyFulfillment(
        approved(),
        { ...FULFILL, movementDate: '2026-10-07' },
        stock([entry(PAPER, 10)]),
      ),
    isDomainError('stock_movement_date_future'),
  )
  assert.throws(
    () => planSupplyFulfillment(approved(), { ...FULFILL, warehouseId: MISSING }, stock([])),
    isDomainError('stock_warehouse_not_found'),
  )
})

test('DOM-FIN-091: otomatik karşılama pasif kartı atlar', () => {
  const inactive: SupplyLine[] = [
    { id: LINE_PAPER, stockItemId: OLD, quantity: 1, fulfilledQuantity: 0 },
    { id: LINE_GLOVE, stockItemId: GLOVE, quantity: 1, fulfilledQuantity: 0 },
  ]
  const plan = planSupplyFulfillment(
    { ...submitted({ status: 'approved' }), lines: inactive },
    FULFILL,
    stock([entry(OLD, 5), entry(GLOVE, 5)]),
  )
  assert.deepEqual(
    plan.issues.map((issue) => issue.stockItemId),
    [GLOVE],
  )
  assert.equal(plan.status, 'approved')
})

const CONVERT = {
  costCenterId: '00000000-0000-4000-8000-000000000001',
  periodId: '00000000-0000-4000-8000-000000000002',
  budgetItemId: '00000000-0000-4000-8000-000000000003',
  prices: [
    { itemId: LINE_PAPER, estimatedUnitPriceCents: 12_000 },
    { itemId: LINE_GLOVE, estimatedUnitPriceCents: 30_000 },
  ],
}
const convertible = (paperDone = 0, gloveDone = 0, purchaseRequestStatus = null as never) => ({
  ...approved(paperDone, gloveDone),
  sequence: 3,
  justification: '9-A fen deneyi için',
  purchaseRequestStatus,
})

test('DOM-FIN-091: kalan satın alma talebine kartı bağlı kalemlerle dönüşür', () => {
  const input = planSupplyPurchaseConversion(convertible(3, 0), CONVERT, CARDS)
  assert.equal(input.justification, 'Sarf talebi SM-0003: 9-A fen deneyi için')
  assert.equal(input.supplierId, null)
  assert.deepEqual(input.items, [
    {
      name: 'A4 kâğıt (KAG-A4)',
      quantity: 1,
      unit: 'pack',
      estimatedUnitPriceCents: 12_000,
      stockItemId: PAPER,
    },
    {
      name: 'Lateks eldiven (ELD-M)',
      quantity: 2,
      unit: 'box',
      estimatedUnitPriceCents: 30_000,
      stockItemId: GLOVE,
    },
  ])
  // Dönen gövde satın alma talebi şemasından geçer (DOM-FIN-071).
  const purchase = planPurchaseRequest(input, {
    period: { status: 'open' },
    costCenter: { isActive: true },
    budgetItem: { kind: 'expense', isActive: true },
    stockItems: new Map([
      [PAPER, { name: 'A4 kâğıt', unit: 'pack', isActive: true }],
      [GLOVE, { name: 'Lateks eldiven', unit: 'box', isActive: true }],
    ]),
  })
  assert.equal(purchase.items.length, 2)
  // Tamamen karşılanmış kalem taşınmaz ve fiyatı istenmez.
  const partial = planSupplyPurchaseConversion(
    convertible(4, 0),
    { ...CONVERT, prices: [CONVERT.prices[1]] },
    CARDS,
  )
  assert.deepEqual(
    partial.items.map((item) => item.stockItemId),
    [GLOVE],
  )
})

test('DOM-FIN-091: dönüştürme canlı bağda 409, kalansız ve onaysız talepte 422, eksik fiyatta 400', () => {
  for (const status of ['draft', 'submitted', 'approved'] as const)
    assert.throws(
      () => planSupplyPurchaseConversion(convertible(0, 0, status as never), CONVERT, CARDS),
      isDomainError('supply_request_already_converted', 'conflict'),
    )
  for (const status of ['rejected', 'cancelled'] as const)
    assert.equal(
      planSupplyPurchaseConversion(convertible(0, 0, status as never), CONVERT, CARDS).items.length,
      2,
    )
  assert.throws(
    () => planSupplyPurchaseConversion(convertible(4, 2), CONVERT, CARDS),
    isDomainError('supply_request_nothing_remaining'),
  )
  assert.throws(
    () => planSupplyPurchaseConversion({ ...convertible(), status: 'submitted' }, CONVERT, CARDS),
    isDomainError('supply_request_not_approved'),
  )
  assert.throws(
    () =>
      planSupplyPurchaseConversion(
        convertible(),
        { ...CONVERT, prices: [CONVERT.prices[0]] },
        CARDS,
      ),
    (error) => ZodError(error) && issuePaths(error).includes('prices'),
  )
  assert.throws(
    () => planSupplyPurchaseConversion(convertible(4, 0), CONVERT, CARDS),
    (error) => ZodError(error) && issuePaths(error).includes('prices.0.itemId'),
  )
  assert.throws(
    () => planSupplyPurchaseConversion(convertible(), { ...CONVERT, prices: [] }, CARDS),
    ZodError,
  )
})

test('DOM-FIN-091: gerekçe satın alma talebi sınırına kırpılır', () => {
  const long = { ...convertible(), justification: 'x'.repeat(1000) }
  const input = planSupplyPurchaseConversion(long, CONVERT, CARDS)
  assert.ok(input.justification.length <= 2000)
  assert.ok(input.justification.startsWith('Sarf talebi SM-0003: '))
})

test('DOM-FIN-091: kapsam — yönetici ve ön büro hepsini, öğretmen yalnız kendi talebini görür', () => {
  assert.equal(canSeeAllSupplyRequests('yonetici'), true)
  assert.equal(canSeeAllSupplyRequests('onburo'), true)
  assert.equal(canSeeAllSupplyRequests('ogretmen'), false)
  assert.equal(canSeeAllSupplyRequests('veli'), false)
  assert.equal(canViewSupplyRequest(submitted(), TEACHER), true)
  assert.equal(canViewSupplyRequest(submitted(), OTHER_TEACHER), false)
  assert.equal(canViewSupplyRequest(submitted(), FRONT), true)
})

test('DOM-FIN-091: rol işlemleri durumla birlikte hesaplanır', () => {
  const base = { lines: lines(), purchaseRequestStatus: null }
  assert.deepEqual(supplyRequestActions({ ...submitted(), ...base }, TEACHER), {
    cancel: true,
    decide: false,
    fulfill: false,
    convert: false,
  })
  assert.deepEqual(supplyRequestActions({ ...submitted(), ...base }, ADMIN), {
    cancel: false,
    decide: true,
    fulfill: false,
    convert: false,
  })
  assert.deepEqual(supplyRequestActions({ ...submitted({ status: 'approved' }), ...base }, FRONT), {
    cancel: false,
    decide: false,
    fulfill: true,
    convert: true,
  })
  assert.equal(
    supplyRequestActions(
      { ...submitted({ status: 'approved' }), lines: lines(), purchaseRequestStatus: 'draft' },
      ADMIN,
    ).convert,
    false,
  )
  assert.equal(
    supplyRequestActions(
      { ...submitted({ status: 'approved' }), lines: lines(4, 2), purchaseRequestStatus: null },
      ADMIN,
    ).convert,
    false,
  )
  assert.deepEqual(
    supplyRequestActions({ ...submitted({ status: 'approved' }), ...base }, TEACHER),
    { cancel: false, decide: false, fulfill: false, convert: false },
  )
  assert.equal(isLivePurchaseLink('rejected'), false)
  assert.equal(remainingOf({ quantity: 2, fulfilledQuantity: 5 }), 0)
  assert.equal(supplyRemaining(lines(1, 1)), 4)
})

test('DOM-FIN-078, DOM-FIN-091: sarf talebi çıkışı hareket listesinden iptal edilmez', () => {
  assert.equal(STOCK_MOVEMENT_TYPE_LABELS.supply, 'Sarf talebi karşılama')
  const movement: CancellableMovement = {
    id: 'm-supply',
    itemId: PAPER,
    warehouseId: MAIN,
    type: 'supply',
    quantity: 1,
    movementDate: TODAY,
    cancelledAt: null,
    transferId: null,
    receiptId: null,
  }
  assert.throws(
    () =>
      planStockMovementCancel(
        movement,
        { reason: 'Yanlış çıkış' },
        { items: STOCK_ITEMS, warehouses: WAREHOUSES, movements: [movement] },
      ),
    isDomainError('stock_movement_from_supply'),
  )
})
