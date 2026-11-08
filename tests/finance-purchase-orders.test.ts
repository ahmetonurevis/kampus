import assert from 'node:assert/strict'
import test from 'node:test'

import {
  expectedDeliveryDate,
  planPurchaseOrder,
  planPurchaseOrderCancel,
  planPurchaseOrderSend,
  purchaseOrderActions,
  purchaseOrderAmounts,
  purchaseOrderNumber,
  purchaseOrderYear,
  type PurchaseOrderContext,
} from '../packages/school-core/src/lib/finance-purchase-orders.ts'

import { isDomainError } from './support/domain-error.ts'

// Satın alma siparişi (DOM-FIN-073; ON-225).

const ZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'
const QUOTE = '00000000-0000-4000-8000-0000000000c1'
const CONTEXT: PurchaseOrderContext = {
  request: { status: 'approved' },
  quote: { selected: true, validUntil: '2026-10-20' },
  supplier: { isActive: true },
  orderActive: false,
  today: '2026-10-06',
}

test('DOM-FIN-073: sipariş numarası SA-<yıl>-<sıra>, yıl Europe/Istanbul (K-139)', () => {
  assert.equal(purchaseOrderNumber(2026, 7), 'SA-2026-0007')
  assert.equal(purchaseOrderNumber(2026, 12_345), 'SA-2026-12345')
  // 31 Aralık 21.30 UTC İstanbul'da 1 Ocak 00.30'dur.
  assert.equal(purchaseOrderYear('2026-12-31T21:30:00.000Z'), 2027)
  assert.equal(purchaseOrderYear(new Date('2026-12-31T20:59:00.000Z')), 2026)
})

test('DOM-FIN-073: sipariş yalnız onaylı talebin seçili ve geçerli teklifinden açılır', () => {
  assert.deepEqual(planPurchaseOrder({ quoteId: QUOTE, note: '  ' }, CONTEXT), {
    quoteId: QUOTE,
    note: null,
  })
  assert.throws(() => planPurchaseOrder({ quoteId: 'x' }, CONTEXT), ZodError)
  assert.throws(() => planPurchaseOrder({ quoteId: QUOTE, institutionId: 'b' }, CONTEXT), ZodError)
  assert.throws(
    () => planPurchaseOrder({ quoteId: QUOTE }, { ...CONTEXT, quote: null }),
    isDomainError('purchase_order_quote_not_found'),
  )
  assert.throws(
    () => planPurchaseOrder({ quoteId: QUOTE }, { ...CONTEXT, request: { status: 'cancelled' } }),
    isDomainError('purchase_order_request_not_approved'),
  )
  assert.throws(
    () => planPurchaseOrder({ quoteId: QUOTE }, { ...CONTEXT, orderActive: true }),
    isDomainError('purchase_order_exists', 'conflict'),
    'talepte tek etkin sipariş (K-140)',
  )
  assert.throws(
    () =>
      planPurchaseOrder(
        { quoteId: QUOTE },
        { ...CONTEXT, quote: { selected: false, validUntil: '2026-10-20' } },
      ),
    isDomainError('purchase_order_quote_not_selected'),
  )
  assert.throws(
    () =>
      planPurchaseOrder(
        { quoteId: QUOTE },
        { ...CONTEXT, quote: { selected: true, validUntil: '2026-10-05' } },
      ),
    isDomainError('purchase_quote_expired'),
  )
  assert.throws(
    () => planPurchaseOrder({ quoteId: QUOTE }, { ...CONTEXT, supplier: { isActive: false } }),
    isDomainError('purchase_order_supplier_inactive'),
  )
})

test('DOM-FIN-073: gönderildi işareti yalnız taslakta, iptal taslak ve gönderilmişte', () => {
  assert.doesNotThrow(() => planPurchaseOrderSend({ status: 'draft' }))
  for (const status of ['sent', 'partially_received', 'completed', 'cancelled'] as const)
    assert.throws(
      () => planPurchaseOrderSend({ status }),
      isDomainError('purchase_order_not_draft'),
    )
  assert.deepEqual(
    planPurchaseOrderCancel({ status: 'sent' }, { reason: ' Tedarikçi stokta yok ' }),
    {
      reason: 'Tedarikçi stokta yok',
    },
  )
  assert.throws(() => planPurchaseOrderCancel({ status: 'draft' }, { reason: 'kıs' }), ZodError)
  for (const status of ['partially_received', 'completed', 'cancelled'] as const)
    assert.throws(
      () => planPurchaseOrderCancel({ status }, { reason: 'Gerekçe yazıldı' }),
      isDomainError('purchase_order_not_cancellable'),
    )
})

test('DOM-FIN-073: sipariş tutarı kalemlerden, KDV kalemde yuvarlanır (K-138)', () => {
  const { lines, totals } = purchaseOrderAmounts([
    { requestItemId: 'a', quantity: 3, unitPriceCents: 10_005, vatRate: 20 },
    { requestItemId: 'b', quantity: 7, unitPriceCents: 333, vatRate: 10 },
    { requestItemId: 'c', quantity: 1, unitPriceCents: 1_000, vatRate: 0 },
  ])
  assert.deepEqual(
    lines.map((line) => [line.netCents, line.vatCents, line.grossCents]),
    [
      [30_015, 6_003, 36_018],
      [2_331, 233, 2_564],
      [1_000, 0, 1_000],
    ],
  )
  assert.deepEqual(totals, { netCents: 33_346, vatCents: 6_236, grossCents: 39_582 })
})

test('DOM-FIN-073: beklenen teslim günü gönderim (yoksa açılış) günü artı teslim süresi', () => {
  assert.equal(
    expectedDeliveryDate({
      deliveryDays: 10,
      createdAt: '2026-10-06T08:00:00.000Z',
      sentAt: null,
    }),
    '2026-10-16',
  )
  assert.equal(
    expectedDeliveryDate({
      deliveryDays: 1,
      createdAt: '2026-10-06T08:00:00.000Z',
      sentAt: '2026-12-31T22:00:00.000Z',
    }),
    '2027-01-02',
  )
})

test('DOM-FIN-073: rol düğmeleri (K-141)', () => {
  assert.deepEqual(purchaseOrderActions({ status: 'draft' }, { role: 'onburo' }), {
    send: true,
    cancel: false,
  })
  assert.deepEqual(purchaseOrderActions({ status: 'sent' }, { role: 'yonetici' }), {
    send: false,
    cancel: true,
  })
  assert.deepEqual(purchaseOrderActions({ status: 'completed' }, { role: 'yonetici' }), {
    send: false,
    cancel: false,
  })
  assert.deepEqual(purchaseOrderActions({ status: 'draft' }, { role: 'ogretmen' }), {
    send: false,
    cancel: false,
  })
})
