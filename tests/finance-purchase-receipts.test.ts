import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createPurchaseReceiptSchema,
  planPurchaseReceipt,
  planPurchaseReceiptCancel,
  purchaseReceiptActions,
  receiptExpenseActuals,
  receiptNetCents,
  receiptProgress,
  receivingStatus,
  type PurchaseReceiptContext,
  type ReceiptRecord,
} from '../packages/school-core/src/lib/finance-purchase-receipts.ts'
import { purchaseBudgetInfo } from '../packages/school-core/src/lib/finance-purchase-requests.ts'

import { isDomainError } from './support/domain-error.ts'

// Mal kabul (DOM-FIN-074; ON-226).

const ZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'
const KEYBOARD = '00000000-0000-4000-8000-0000000000a1'
const MOUSE = '00000000-0000-4000-8000-0000000000a2'
const OTHER = '00000000-0000-4000-8000-0000000000a9'
const ITEMS = [
  { id: KEYBOARD, quantity: 10, unitPriceCents: 19_000 },
  { id: MOUSE, quantity: 3, unitPriceCents: 12_000 },
]
const CONTEXT: PurchaseReceiptContext = {
  order: { status: 'sent', createdAt: '2026-10-01T07:00:00.000Z' },
  items: ITEMS,
  receipts: [],
  closedPeriods: [],
  today: '2026-10-06',
}
const receipt = (
  id: string,
  lines: ReceiptRecord['lines'],
  cancelledAt: string | null = null,
): ReceiptRecord => ({ id, receiptDate: '2026-10-05', cancelledAt, lines })
const body = (lines: unknown[], extra: Record<string, unknown> = {}) => ({
  receiptDate: '2026-10-05',
  receivedBy: '  Hasan Usta ',
  lines,
  ...extra,
})

test('DOM-FIN-074: kısmi kabul siparişi kısmen teslim, kalanın kabulü tamamlandı yapar (K-150)', () => {
  const first = planPurchaseReceipt(
    body(
      [{ orderItemId: KEYBOARD, acceptedQuantity: 6, rejectedQuantity: 2, rejectReason: 'Kırık' }],
      {
        inspectionNote: '  ',
      },
    ),
    CONTEXT,
  )
  assert.equal(first.status, 'partially_received')
  assert.deepEqual(first.data, {
    receiptDate: '2026-10-05',
    receivedBy: 'Hasan Usta',
    inspectionNote: null,
    lines: [
      { orderItemId: KEYBOARD, acceptedQuantity: 6, rejectedQuantity: 2, rejectReason: 'Kırık' },
    ],
  })
  const receipts = [receipt('r1', first.data.lines)]
  // Reddedilen 2 karşılanmış sayılmaz: klavyede kalan 4.
  const progress = receiptProgress(ITEMS, receipts)
  assert.deepEqual(progress.get(KEYBOARD), { ordered: 10, accepted: 6, rejected: 2, remaining: 4 })
  const second = planPurchaseReceipt(
    body([
      { orderItemId: KEYBOARD, acceptedQuantity: 4 },
      { orderItemId: MOUSE, acceptedQuantity: 3 },
    ]),
    { ...CONTEXT, order: { ...CONTEXT.order, status: 'partially_received' }, receipts },
  )
  assert.equal(second.status, 'completed')
})

test('DOM-FIN-074: kabul edilen toplam sipariş miktarını aşamaz; yalnız ret siparişi gönderildi bırakır', () => {
  const receipts = [
    receipt('r1', [{ orderItemId: KEYBOARD, acceptedQuantity: 8, rejectedQuantity: 0 }]),
  ]
  assert.throws(
    () =>
      planPurchaseReceipt(body([{ orderItemId: KEYBOARD, acceptedQuantity: 3 }]), {
        ...CONTEXT,
        receipts,
      }),
    (error: unknown) =>
      isDomainError('purchase_receipt_quantity_exceeded', 'rule')(error) &&
      /kalan 2/.test((error as Error).message),
  )
  // İptal edilen kabul sayılmaz.
  const cancelled = [{ ...receipts[0]!, cancelledAt: '2026-10-05T10:00:00.000Z' }]
  assert.equal(
    planPurchaseReceipt(body([{ orderItemId: KEYBOARD, acceptedQuantity: 10 }]), {
      ...CONTEXT,
      receipts: cancelled,
    }).status,
    'partially_received',
  )
  const rejectedOnly = planPurchaseReceipt(
    body([
      {
        orderItemId: MOUSE,
        acceptedQuantity: 0,
        rejectedQuantity: 3,
        rejectReason: 'Yanlış model',
      },
    ]),
    CONTEXT,
  )
  assert.equal(rejectedOnly.status, 'sent')
  assert.throws(
    () => planPurchaseReceipt(body([{ orderItemId: OTHER, acceptedQuantity: 1 }]), CONTEXT),
    isDomainError('purchase_receipt_item_not_found', 'rule'),
  )
})

test('DOM-FIN-074: taslak, iptal edilmiş ve tamamlanmış siparişe kabul yok; gün ve kapalı dönem denetlenir (K-153)', () => {
  const ok = body([{ orderItemId: KEYBOARD, acceptedQuantity: 1 }])
  const withStatus = (status: PurchaseReceiptContext['order']['status']) => ({
    ...CONTEXT,
    order: { ...CONTEXT.order, status },
  })
  assert.throws(
    () => planPurchaseReceipt(ok, withStatus('draft')),
    isDomainError('purchase_receipt_order_not_sent', 'rule'),
  )
  assert.throws(
    () => planPurchaseReceipt(ok, withStatus('cancelled')),
    isDomainError('purchase_receipt_order_cancelled', 'rule'),
  )
  assert.throws(
    () => planPurchaseReceipt(ok, withStatus('completed')),
    isDomainError('purchase_receipt_order_completed', 'rule'),
  )
  assert.throws(
    () => planPurchaseReceipt({ ...ok, receiptDate: '2026-10-07' }, CONTEXT),
    isDomainError('purchase_receipt_date_future', 'rule'),
  )
  assert.throws(
    () => planPurchaseReceipt({ ...ok, receiptDate: '2026-09-30' }, CONTEXT),
    isDomainError('purchase_receipt_date_before_order', 'rule'),
  )
  // Sipariş 30 Eylül 21.30 UTC'de açıldıysa İstanbul günü 1 Ekim'dir.
  assert.equal(
    planPurchaseReceipt(
      { ...ok, receiptDate: '2026-10-01' },
      { ...CONTEXT, order: { status: 'sent', createdAt: '2026-09-30T21:30:00.000Z' } },
    ).status,
    'partially_received',
  )
  assert.throws(
    () =>
      planPurchaseReceipt(ok, {
        ...CONTEXT,
        closedPeriods: [{ startDate: '2025-09-01', endDate: '2026-10-05' }],
      }),
    isDomainError('purchase_receipt_period_closed', 'rule'),
  )
})

test('DOM-FIN-074: kabul gövdesi doğrulanır; ret nedeni yalnız reddedilen miktarla', () => {
  const parse = (lines: unknown[], extra: Record<string, unknown> = {}) =>
    createPurchaseReceiptSchema.safeParse(body(lines, extra))
  assert.equal(
    parse([{ orderItemId: KEYBOARD, acceptedQuantity: 0 }]).success,
    false,
    '0 / 0 kalem',
  )
  assert.equal(
    parse([{ orderItemId: KEYBOARD, acceptedQuantity: 1, rejectedQuantity: 1 }]).success,
    false,
    'ret nedeni zorunlu',
  )
  assert.equal(
    parse([{ orderItemId: KEYBOARD, acceptedQuantity: 1, rejectReason: 'Neden' }]).success,
    false,
    'ret yokken neden yazılmaz',
  )
  assert.equal(parse([{ orderItemId: KEYBOARD, acceptedQuantity: 1.5 }]).success, false)
  assert.equal(parse([{ orderItemId: KEYBOARD, acceptedQuantity: -1 }]).success, false)
  assert.equal(parse([]).success, false)
  const duplicate = parse([
    { orderItemId: KEYBOARD, acceptedQuantity: 1 },
    { orderItemId: KEYBOARD, acceptedQuantity: 1 },
  ])
  assert.equal(duplicate.success, false)
  assert.deepEqual(duplicate.error?.issues[0]?.path, ['lines', 1, 'orderItemId'])
  assert.equal(
    parse([{ orderItemId: KEYBOARD, acceptedQuantity: 1 }], { receivedBy: 'A' }).success,
    false,
  )
  assert.equal(
    parse([{ orderItemId: KEYBOARD, acceptedQuantity: 1 }], { receiptDate: '2026-02-30' }).success,
    false,
  )
  assert.equal(
    parse([{ orderItemId: KEYBOARD, acceptedQuantity: 1 }], { extra: true }).success,
    false,
  )
  assert.throws(() => planPurchaseReceipt({}, CONTEXT), ZodError)
})

test('DOM-FIN-074: kabul iptali gerekçe ister, durumu geri alır; iptal edilmiş kabul yeniden iptal edilmez (K-153)', () => {
  const r1 = receipt('r1', [{ orderItemId: KEYBOARD, acceptedQuantity: 10, rejectedQuantity: 0 }])
  const r2 = receipt('r2', [{ orderItemId: MOUSE, acceptedQuantity: 3, rejectedQuantity: 0 }])
  const context = {
    ...CONTEXT,
    order: { ...CONTEXT.order, status: 'completed' as const },
    receipts: [r1, r2],
  }
  assert.deepEqual(planPurchaseReceiptCancel(r2, { reason: ' Yanlış sipariş ' }, context), {
    reason: 'Yanlış sipariş',
    status: 'partially_received',
  })
  assert.equal(
    planPurchaseReceiptCancel(r1, { reason: 'Hatalı kayıt' }, { ...context, receipts: [r1] })
      .status,
    'sent',
  )
  assert.throws(() => planPurchaseReceiptCancel(r1, { reason: 'kısa' }, context), ZodError)
  assert.throws(
    () =>
      planPurchaseReceiptCancel(
        { ...r1, cancelledAt: '2026-10-05T10:00:00.000Z' },
        { reason: 'Hatalı kayıt' },
        context,
      ),
    isDomainError('purchase_receipt_already_cancelled', 'rule'),
  )
  assert.throws(
    () =>
      planPurchaseReceiptCancel(
        r1,
        { reason: 'Hatalı kayıt' },
        {
          ...context,
          closedPeriods: [{ startDate: '2026-09-01', endDate: '2026-10-31' }],
        },
      ),
    isDomainError('purchase_receipt_period_closed', 'rule'),
  )
  assert.throws(
    () =>
      planPurchaseReceiptCancel(
        r1,
        { reason: 'Hatalı kayıt' },
        {
          ...context,
          order: { ...context.order, status: 'cancelled' },
        },
      ),
    isDomainError('purchase_receipt_order_cancelled', 'rule'),
  )
})

test('DOM-FIN-074: kabulü yönetici ve ön büro kaydeder, iptali yalnız yönetici (K-153)', () => {
  for (const status of ['sent', 'partially_received'] as const) {
    assert.deepEqual(purchaseReceiptActions({ status }, { role: 'yonetici' }), {
      receive: true,
      cancel: true,
    })
    assert.deepEqual(purchaseReceiptActions({ status }, { role: 'onburo' }), {
      receive: true,
      cancel: false,
    })
  }
  assert.deepEqual(purchaseReceiptActions({ status: 'completed' }, { role: 'yonetici' }), {
    receive: false,
    cancel: true,
  })
  for (const status of ['draft', 'cancelled'] as const)
    assert.deepEqual(purchaseReceiptActions({ status }, { role: 'yonetici' }), {
      receive: false,
      cancel: false,
    })
  assert.deepEqual(purchaseReceiptActions({ status: 'sent' }, { role: 'ogretmen' }), {
    receive: false,
    cancel: false,
  })
  assert.equal(receivingStatus(new Map()), 'sent')
})

test('DOM-FIN-074, DOM-FIN-066: gerçekleşen kabul edilen miktar × birim fiyat, KDV hariç, kabul gününde (K-151)', () => {
  assert.equal(
    receiptNetCents(
      [
        { orderItemId: KEYBOARD, acceptedQuantity: 6 },
        { orderItemId: MOUSE, acceptedQuantity: 0 },
        { orderItemId: OTHER, acceptedQuantity: 5 },
      ],
      ITEMS,
    ),
    114_000,
  )
  const row = { itemId: 'g1', costCenterId: 'm1', receiptDate: '2026-10-05' }
  assert.deepEqual(
    receiptExpenseActuals([
      { ...row, acceptedQuantity: 6, unitPriceCents: 19_000 },
      { ...row, acceptedQuantity: 3, unitPriceCents: 12_000 },
      { ...row, acceptedQuantity: 0, unitPriceCents: 12_000 },
      { ...row, receiptDate: '2026-10-06', acceptedQuantity: 1, unitPriceCents: 100 },
    ]),
    [
      {
        itemId: 'g1',
        costCenterId: 'm1',
        accrualDate: '2026-10-05',
        paidDate: null,
        amountCents: 150_000,
        source: 'purchase',
      },
      {
        itemId: 'g1',
        costCenterId: 'm1',
        accrualDate: '2026-10-06',
        paidDate: null,
        amountCents: 100,
        source: 'purchase',
      },
    ],
  )
})

test('DOM-FIN-071, DOM-FIN-074: siparişli talep sipariş tutarıyla sayılır; kabul edilen kısım gerçekleşen, çift sayım yok (K-145, K-154)', () => {
  // Plan 10.000 TL; bekleyen 1.000, siparişsiz onaylı 2.000; sipariş 3.000 (1.200'ü kabul edildi).
  const info = purchaseBudgetInfo(
    {
      plannedCents: 1_000_000,
      approvedCents: 200_000,
      pendingCents: 100_000,
      orderedCents: 180_000,
      receivedCents: 120_000,
    },
    500_000,
  )
  assert.equal(info.committedCents, 480_000)
  assert.equal(info.remainingCents, 400_000, 'plan − taahhüt − gerçekleşen')
  assert.equal(info.overrunCents, 100_000)
  const legacy = purchaseBudgetInfo({ plannedCents: 100, approvedCents: 0, pendingCents: 0 }, 0)
  assert.equal(legacy.orderedCents, 0)
  assert.equal(legacy.receivedCents, 0)
})
