import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compareQuotes,
  planPurchaseQuote,
  planPurchaseQuoteRemove,
  planPurchaseQuoteUpdate,
  planQuoteSelection,
  pricedLine,
  purchaseQuoteActions,
  quoteListActions,
  vatCents,
  type NewQuoteContext,
  type QuoteRequestItem,
} from '../packages/school-core/src/lib/finance-purchase-quotes.ts'

import { isDomainError } from './support/domain-error.ts'

// Satın alma teklifi ve karşılaştırması (DOM-FIN-072; ON-224).

const ZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'
const KEYBOARD = '00000000-0000-4000-8000-0000000000a1'
const MOUSE = '00000000-0000-4000-8000-0000000000a2'
const SUPPLIER = '00000000-0000-4000-8000-0000000000b1'
const TODAY = '2026-10-06'
const ITEMS: QuoteRequestItem[] = [
  { id: KEYBOARD, name: 'Klavye', quantity: 10, unit: 'piece' },
  { id: MOUSE, name: 'Fare', quantity: 3, unit: 'piece' },
]
const INPUT = {
  supplierId: SUPPLIER,
  deliveryDays: 7,
  validUntil: '2026-10-20',
  items: [
    { requestItemId: KEYBOARD, unitPriceCents: 20_000, vatRate: 20 },
    { requestItemId: MOUSE, unitPriceCents: 10_005, vatRate: 20 },
  ],
}
const CONTEXT: NewQuoteContext = {
  request: { status: 'approved' },
  items: ITEMS,
  orderActive: false,
  today: TODAY,
  supplier: { isActive: true },
  quoteCount: 0,
  supplierTaken: false,
}
const ADMIN = { userId: 'test-admin', role: 'yonetici' }
const FRONT = { userId: 'test-front', role: 'onburo' }

test('DOM-FIN-072: KDV kalemde kuruşa yarım yukarı yuvarlanır (K-138)', () => {
  assert.equal(vatCents(1_000, 20), 200)
  // 13 kuruş × %20 = 2,6 → 3; 12 kuruş × %20 = 2,4 → 2; yarım kuruş yukarı: 5 × %10 = 0,5 → 1.
  assert.equal(vatCents(13, 20), 3)
  assert.equal(vatCents(12, 20), 2)
  assert.equal(vatCents(5, 10), 1)
  assert.equal(vatCents(4, 10), 0)
  assert.equal(vatCents(99_999, 0), 0)
  assert.equal(vatCents(150, 1), 2)
  const line = pricedLine({ requestItemId: MOUSE, unitPriceCents: 10_005, vatRate: 20 }, 3)
  assert.deepEqual(
    [line.netCents, line.vatCents, line.grossCents],
    [30_015, 6_003, 36_018],
    'kalem KDV’si net üzerinden: 30.015 × %20 = 6.003',
  )
})

test('DOM-FIN-072: teklif onaylı talebin bütün kalemlerine fiyat verir', () => {
  const plan = planPurchaseQuote(INPUT, CONTEXT)
  assert.equal(plan.note, null)
  assert.equal(plan.items.length, 2)
  assert.throws(
    () => planPurchaseQuote({ ...INPUT, items: INPUT.items.slice(0, 1) }, CONTEXT),
    isDomainError('purchase_quote_item_missing'),
  )
  assert.throws(
    () =>
      planPurchaseQuote(
        {
          ...INPUT,
          items: [
            ...INPUT.items,
            {
              requestItemId: '00000000-0000-4000-8000-0000000000ff',
              unitPriceCents: 1,
              vatRate: 0,
            },
          ],
        },
        CONTEXT,
      ),
    isDomainError('purchase_quote_item_unknown'),
  )
  assert.throws(
    () => planPurchaseQuote({ ...INPUT, items: [INPUT.items[0], INPUT.items[0]] }, CONTEXT),
    ZodError,
  )
  assert.throws(
    () =>
      planPurchaseQuote(
        { ...INPUT, items: [{ ...INPUT.items[0], vatRate: 18 }, INPUT.items[1]] },
        CONTEXT,
      ),
    ZodError,
    'KDV oranı sabit kümededir',
  )
  assert.throws(() => planPurchaseQuote({ ...INPUT, deliveryDays: -1 }, CONTEXT), ZodError)
  assert.throws(
    () => planPurchaseQuote({ ...INPUT, institutionId: 'başka' }, CONTEXT),
    ZodError,
    'bilinmeyen alan reddedilir',
  )
})

test('DOM-FIN-072: talep onaylı değilse, sipariş açıldıysa ya da tedarikçi uygun değilse teklif girilmez', () => {
  assert.throws(
    () => planPurchaseQuote(INPUT, { ...CONTEXT, request: { status: 'submitted' } }),
    isDomainError('purchase_quote_request_not_approved'),
  )
  assert.throws(
    () => planPurchaseQuote(INPUT, { ...CONTEXT, orderActive: true }),
    isDomainError('purchase_quote_locked'),
  )
  assert.throws(
    () => planPurchaseQuote(INPUT, { ...CONTEXT, supplier: null }),
    isDomainError('purchase_quote_supplier_not_found'),
  )
  assert.throws(
    () => planPurchaseQuote(INPUT, { ...CONTEXT, supplier: { isActive: false } }),
    isDomainError('purchase_quote_supplier_inactive'),
  )
  assert.throws(
    () => planPurchaseQuote(INPUT, { ...CONTEXT, supplierTaken: true }),
    isDomainError('purchase_quote_supplier_exists', 'conflict'),
  )
  assert.throws(
    () => planPurchaseQuote(INPUT, { ...CONTEXT, quoteCount: 10 }),
    isDomainError('purchase_quote_limit'),
  )
  assert.throws(
    () => planPurchaseQuote({ ...INPUT, validUntil: '2026-10-05' }, CONTEXT),
    isDomainError('purchase_quote_valid_until_past'),
  )
  assert.doesNotThrow(() => planPurchaseQuote({ ...INPUT, validUntil: TODAY }, CONTEXT))
})

test('DOM-FIN-072: ön büro yalnız kendi teklifini düzeltir ve siler (K-136)', () => {
  const own = { createdByUserId: FRONT.userId }
  const other = { createdByUserId: 'test-other' }
  assert.deepEqual(planPurchaseQuoteUpdate(own, { deliveryDays: 3 }, CONTEXT, FRONT), {
    deliveryDays: 3,
  })
  assert.throws(
    () => planPurchaseQuoteUpdate(other, { deliveryDays: 3 }, CONTEXT, FRONT),
    isDomainError('purchase_quote_not_owner', 'forbidden'),
  )
  assert.doesNotThrow(() => planPurchaseQuoteUpdate(other, { note: '' }, CONTEXT, ADMIN))
  assert.throws(() => planPurchaseQuoteUpdate(own, {}, CONTEXT, FRONT), ZodError)
  assert.throws(
    () => planPurchaseQuoteUpdate(own, { items: INPUT.items.slice(1) }, CONTEXT, FRONT),
    isDomainError('purchase_quote_item_missing'),
  )
  assert.throws(
    () => planPurchaseQuoteUpdate(own, { validUntil: '2026-01-01' }, CONTEXT, FRONT),
    isDomainError('purchase_quote_valid_until_past'),
  )
  assert.throws(
    () => planPurchaseQuoteRemove(other, CONTEXT, FRONT),
    isDomainError('purchase_quote_not_owner', 'forbidden'),
  )
  assert.throws(
    () => planPurchaseQuoteRemove(own, { ...CONTEXT, orderActive: true }, FRONT),
    isDomainError('purchase_quote_locked'),
  )
})

const quote = (id: string, keyboard: number, mouse: number, validUntil = '2026-10-20') => ({
  id,
  validUntil,
  prices: [
    { requestItemId: KEYBOARD, unitPriceCents: keyboard, vatRate: 20 as const },
    { requestItemId: MOUSE, unitPriceCents: mouse, vatRate: 20 as const },
  ],
})

test('DOM-FIN-072: karşılaştırma satırda ve toplamda en düşük geçerli teklifi vurgular', () => {
  const comparison = compareQuotes(
    ITEMS,
    [
      quote('a', 20_000, 10_000),
      quote('b', 19_000, 12_000),
      // Süresi geçmiş en ucuz teklif vurgulanmaz.
      quote('c', 1_000, 1_000, '2026-10-05'),
    ],
    TODAY,
  )
  const keyboardRow = comparison.rows.find((row) => row.requestItemId === KEYBOARD)
  assert.deepEqual(
    keyboardRow?.cells.map((cell) => [cell.quoteId, cell.grossCents, cell.lowest]),
    [
      ['a', 240_000, false],
      ['b', 228_000, true],
      ['c', 12_000, false],
    ],
  )
  const mouseRow = comparison.rows.find((row) => row.requestItemId === MOUSE)
  assert.deepEqual(
    mouseRow?.cells.filter((cell) => cell.lowest).map((cell) => cell.quoteId),
    ['a'],
  )
  assert.deepEqual(
    comparison.quotes.map((summary) => [
      summary.quoteId,
      summary.netCents,
      summary.vatCents,
      summary.grossCents,
      summary.expired,
      summary.lowest,
    ]),
    [
      ['a', 230_000, 46_000, 276_000, false, false],
      ['b', 226_000, 45_200, 271_200, false, true],
      ['c', 13_000, 2_600, 15_600, true, false],
    ],
  )
  assert.equal(comparison.lowestGrossCents, 271_200)
  const tie = compareQuotes(ITEMS, [quote('a', 100, 100), quote('b', 100, 100)], TODAY)
  assert.deepEqual(
    tie.quotes.map((summary) => summary.lowest),
    [true, true],
    'eşitlikte ikisi de en düşük',
  )
  assert.equal(compareQuotes(ITEMS, [], TODAY).lowestGrossCents, null)
})

test('DOM-FIN-072: en düşük olmayan teklif gerekçesiz seçilmez (K-137)', () => {
  const quotes = [quote('a', 20_000, 10_000), quote('b', 19_000, 12_000)]
  const comparison = compareQuotes(ITEMS, quotes, TODAY)
  const context = (
    id: string,
    overrides: Partial<{ selected: boolean; validUntil: string }> = {},
  ) => ({
    ...CONTEXT,
    comparison,
    quote: { id, validUntil: '2026-10-20', selected: false, ...overrides },
  })
  assert.deepEqual(planQuoteSelection({}, context('b')), { reason: null, lowest: true })
  assert.throws(
    () => planQuoteSelection({ reason: 'kısa' }, context('a')),
    isDomainError('purchase_quote_reason_required'),
  )
  assert.throws(
    () => planQuoteSelection(undefined, context('a')),
    isDomainError('purchase_quote_reason_required'),
  )
  assert.deepEqual(planQuoteSelection({ reason: '  Teslim süresi daha kısa  ' }, context('a')), {
    reason: 'Teslim süresi daha kısa',
    lowest: false,
  })
  assert.throws(
    () => planQuoteSelection({}, context('b', { selected: true })),
    isDomainError('purchase_quote_already_selected'),
  )
  assert.throws(
    () => planQuoteSelection({}, context('b', { validUntil: '2026-10-01' })),
    isDomainError('purchase_quote_expired'),
  )
  assert.throws(
    () => planQuoteSelection({}, { ...context('b'), orderActive: true }),
    isDomainError('purchase_quote_locked'),
  )
  assert.throws(() => planQuoteSelection({ reason: 5 }, context('b')), ZodError)
})

test('DOM-FIN-072: rol düğmeleri sunucu kurallarıyla aynıdır (K-136)', () => {
  const base = { request: { status: 'approved' as const }, orderActive: false, today: TODAY }
  const quoteState = { createdByUserId: FRONT.userId, validUntil: '2026-10-20', selected: false }
  assert.deepEqual(purchaseQuoteActions(quoteState, base, FRONT), {
    edit: true,
    remove: true,
    select: false,
  })
  assert.deepEqual(purchaseQuoteActions(quoteState, base, ADMIN), {
    edit: true,
    remove: true,
    select: true,
  })
  assert.deepEqual(purchaseQuoteActions({ ...quoteState, createdByUserId: 'x' }, base, FRONT), {
    edit: false,
    remove: false,
    select: false,
  })
  assert.equal(
    purchaseQuoteActions({ ...quoteState, validUntil: '2026-10-01' }, base, ADMIN).select,
    false,
  )
  assert.deepEqual(purchaseQuoteActions(quoteState, { ...base, orderActive: true }, ADMIN), {
    edit: false,
    remove: false,
    select: false,
  })
  assert.deepEqual(purchaseQuoteActions(quoteState, base, { userId: 'x', role: 'ogretmen' }), {
    edit: false,
    remove: false,
    select: false,
  })
  assert.deepEqual(quoteListActions({ ...base, quoteCount: 2, hasSelection: true }, ADMIN), {
    add: true,
    order: true,
  })
  assert.deepEqual(quoteListActions({ ...base, quoteCount: 10, hasSelection: true }, FRONT), {
    add: false,
    order: false,
  })
  assert.deepEqual(
    quoteListActions(
      { ...base, request: { status: 'submitted' }, quoteCount: 0, hasSelection: false },
      ADMIN,
    ),
    { add: false, order: false },
  )
})
