import assert from 'node:assert/strict'
import test from 'node:test'

import {
  availableOn,
  firstNegativeDay,
  foldName,
  isBelowMinimum,
  planReceiptStockCancel,
  planReceiptStockEntries,
  planStockEntry,
  planStockIssue,
  planStockItem,
  planStockItemUpdate,
  planStockMovementCancel,
  planStockTransfer,
  planStockWarehouse,
  planStockWarehouseUpdate,
  stockActions,
  stockBalances,
  type CancellableMovement,
  type StockItemRef,
  type StockMovementContext,
  type StockWarehouseRef,
} from '../packages/school-core/src/lib/finance-inventory.ts'
import { createPurchaseReceiptSchema } from '../packages/school-core/src/lib/finance-purchase-receipts.ts'

import { isDomainError } from './support/domain-error.ts'

// Stok kartı, depo ve stok hareketi (DOM-FIN-077, DOM-FIN-078; ON-228, ON-229).

const ZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'
const PAPER = '00000000-0000-4000-8000-0000000000b1'
const TONER = '00000000-0000-4000-8000-0000000000b2'
const MAIN = '00000000-0000-4000-8000-0000000000c1'
const ANNEX = '00000000-0000-4000-8000-0000000000c2'
const CLOSED = '00000000-0000-4000-8000-0000000000c3'
const MISSING = '00000000-0000-4000-8000-0000000000ff'

const ITEMS = new Map<string, StockItemRef>([
  [PAPER, { id: PAPER, code: 'KAG-A4', name: 'A4 kâğıt', unit: 'pack', isActive: true }],
  [TONER, { id: TONER, code: 'TONER', name: 'Toner', unit: 'piece', isActive: false }],
])
const WAREHOUSES = new Map<string, StockWarehouseRef>([
  [MAIN, { id: MAIN, name: 'Ana depo', campusId: 'b1', isActive: true }],
  [ANNEX, { id: ANNEX, name: 'Ek depo', campusId: 'b2', isActive: true }],
  [CLOSED, { id: CLOSED, name: 'Eski depo', campusId: 'b1', isActive: false }],
])

let sequence = 0
const movement = (
  type: CancellableMovement['type'],
  quantity: number,
  movementDate: string,
  extra: Partial<CancellableMovement> = {},
): CancellableMovement => ({
  id: `m${String((sequence += 1))}`,
  itemId: PAPER,
  warehouseId: MAIN,
  type,
  quantity,
  movementDate,
  cancelledAt: null,
  transferId: null,
  receiptId: null,
  ...extra,
})
const context = (movements: CancellableMovement[] = []): StockMovementContext => ({
  items: ITEMS,
  warehouses: WAREHOUSES,
  movements,
  today: '2026-10-06',
})

test('DOM-FIN-078: miktar iptal edilmemiş hareketlerden türetilir; giriş artırır, çıkış azaltır', () => {
  const balances = stockBalances([
    movement('in', 10, '2026-10-01'),
    movement('receipt', 5, '2026-10-02'),
    movement('out', 3, '2026-10-03'),
    movement('transfer_out', 2, '2026-10-03'),
    movement('transfer_in', 2, '2026-10-03', { warehouseId: ANNEX }),
    movement('in', 100, '2026-10-03', { cancelledAt: '2026-10-04T08:00:00.000Z' }),
  ])
  assert.equal(balances.get(`${PAPER}|${MAIN}`), 10)
  assert.equal(balances.get(`${PAPER}|${ANNEX}`), 2)
})

test('DOM-FIN-078, K-181: gün sonu miktarı; çıkılabilecek miktar o gün ve sonrasının en küçüğü', () => {
  const pair = [
    movement('in', 10, '2026-10-01'),
    movement('out', 8, '2026-10-05'),
    movement('in', 4, '2026-10-06'),
  ]
  assert.equal(availableOn(pair, '2026-10-06'), 6)
  // 3 Ekim'de 10 var ama 5 Ekim'deki çıkış 2 bırakıyor: geriye tarihli çıkış en çok 2.
  assert.equal(availableOn(pair, '2026-10-03'), 2)
  assert.equal(availableOn(pair, '2026-09-30'), 0)
  assert.equal(availableOn([], '2026-10-06'), 0)
  assert.equal(firstNegativeDay(pair), null)
  assert.deepEqual(firstNegativeDay(pair.slice(1)), { day: '2026-10-05', balance: -8 })
})

test('DOM-FIN-077: kritik seviye tanımlıysa miktar ona eşit ya da altındaysa kritik', () => {
  assert.equal(isBelowMinimum(5, 5), true)
  assert.equal(isBelowMinimum(6, 5), false)
  assert.equal(isBelowMinimum(0, null), false)
})

test('DOM-FIN-077: stok kartı kodu büyük harfe çevrilir, kurumda tekildir', () => {
  const data = planStockItem(
    { code: ' kag-a3 ', name: 'A3 kâğıt', category: 'stationery', unit: 'pack' },
    { items: [...ITEMS.values()] },
  )
  assert.deepEqual(data, {
    code: 'KAG-A3',
    name: 'A3 kâğıt',
    category: 'stationery',
    unit: 'pack',
    minQuantity: null,
  })
  assert.throws(
    () =>
      planStockItem(
        { code: 'kag-a4', name: 'Kopya', category: 'stationery', unit: 'pack' },
        { items: [...ITEMS.values()] },
      ),
    isDomainError('stock_item_code_exists', 'conflict'),
  )
  // Saat ve hizmet stoklanmaz (K-182); kritik seviye eksi olamaz.
  assert.throws(
    () =>
      planStockItem(
        { code: 'X1', name: 'Danışmanlık', category: 'services', unit: 'hour' },
        { items: [] },
      ),
    ZodError,
  )
  assert.throws(
    () =>
      planStockItem(
        { code: 'X1', name: 'Kalem', category: 'stationery', unit: 'piece', minQuantity: -1 },
        { items: [] },
      ),
    ZodError,
  )
})

test('DOM-FIN-077: hareketi olan kartın birimi değişmez, miktarı olan kart pasifleşmez', () => {
  const current = { id: PAPER, unit: 'pack' as const }
  const items = [...ITEMS.values()]
  assert.deepEqual(
    planStockItemUpdate(
      current,
      { unit: 'box', minQuantity: 4 },
      {
        items,
        hasMovements: false,
        quantity: 0,
      },
    ),
    { unit: 'box', minQuantity: 4 },
  )
  assert.throws(
    () => planStockItemUpdate(current, { unit: 'box' }, { items, hasMovements: true, quantity: 0 }),
    isDomainError('stock_item_unit_locked'),
  )
  // Aynı birimi göndermek değişiklik sayılmaz.
  assert.deepEqual(
    planStockItemUpdate(current, { unit: 'pack' }, { items, hasMovements: true, quantity: 3 }),
    { unit: 'pack' },
  )
  assert.throws(
    () =>
      planStockItemUpdate(current, { isActive: false }, { items, hasMovements: true, quantity: 3 }),
    isDomainError('stock_item_has_stock'),
  )
  assert.throws(
    () =>
      planStockItemUpdate(current, { code: 'toner' }, { items, hasMovements: false, quantity: 0 }),
    isDomainError('stock_item_code_exists', 'conflict'),
  )
  assert.throws(
    () => planStockItemUpdate(current, {}, { items, hasMovements: false, quantity: 0 }),
    ZodError,
  )
})

test('DOM-FIN-077, K-180: depo etkin kampüse bağlıdır; ad Türkçe harf duyarsız tekildir', () => {
  const ctx = { activeCampusIds: new Set(['b1', 'b2']), warehouses: [...WAREHOUSES.values()] }
  assert.deepEqual(planStockWarehouse({ name: 'Kırtasiye dolabı', campusId: 'b2' }, ctx), {
    name: 'Kırtasiye dolabı',
    campusId: 'b2',
    note: null,
  })
  assert.throws(
    () => planStockWarehouse({ name: 'Depo', campusId: 'b3' }, ctx),
    isDomainError('stock_warehouse_campus_not_found'),
  )
  assert.throws(
    () => planStockWarehouse({ name: 'ANA  DEPO', campusId: 'b1' }, ctx),
    isDomainError('stock_warehouse_name_exists', 'conflict'),
  )
  assert.equal(foldName(' İĞNE  Şiş '), 'igne sis')
})

test('DOM-FIN-077, K-180: stoku olan depo başka kampüse bağlanmaz ve pasifleşmez', () => {
  const ctx = { activeCampusIds: new Set(['b1', 'b2']), warehouses: [...WAREHOUSES.values()] }
  const current = { id: MAIN, campusId: 'b1' }
  assert.deepEqual(
    planStockWarehouseUpdate(
      current,
      { name: 'Ana Depo', campusId: 'b2' },
      { ...ctx, quantity: 0 },
    ),
    { name: 'Ana Depo', campusId: 'b2' },
  )
  assert.throws(
    () => planStockWarehouseUpdate(current, { campusId: 'b2' }, { ...ctx, quantity: 1 }),
    isDomainError('stock_warehouse_has_stock'),
  )
  assert.throws(
    () => planStockWarehouseUpdate(current, { isActive: false }, { ...ctx, quantity: 1 }),
    isDomainError('stock_warehouse_has_stock'),
  )
  assert.throws(
    () => planStockWarehouseUpdate(current, { campusId: 'b9' }, { ...ctx, quantity: 0 }),
    isDomainError('stock_warehouse_campus_not_found'),
  )
  assert.throws(
    () => planStockWarehouseUpdate(current, { name: 'ek depo' }, { ...ctx, quantity: 0 }),
    isDomainError('stock_warehouse_name_exists', 'conflict'),
  )
  assert.deepEqual(
    planStockWarehouseUpdate(current, { isActive: false, note: '' }, { ...ctx, quantity: 0 }),
    { isActive: false, note: null },
  )
})

test('DOM-FIN-078: elle giriş etkin kart ve depo ister; gün bugünden sonra olamaz; "Diğer" açıklama ister', () => {
  const entry = {
    itemId: PAPER,
    warehouseId: MAIN,
    quantity: 20,
    movementDate: '2026-10-06',
    reason: 'opening',
  }
  assert.deepEqual(planStockEntry(entry, context()), {
    ...entry,
    note: null,
    lotNumber: null,
    expiryDate: null,
  })
  assert.throws(
    () => planStockEntry({ ...entry, itemId: TONER }, context()),
    isDomainError('stock_item_inactive'),
  )
  assert.throws(
    () => planStockEntry({ ...entry, itemId: MISSING }, context()),
    isDomainError('stock_item_not_found'),
  )
  assert.throws(
    () => planStockEntry({ ...entry, warehouseId: CLOSED }, context()),
    isDomainError('stock_warehouse_inactive'),
  )
  assert.throws(
    () => planStockEntry({ ...entry, warehouseId: MISSING }, context()),
    isDomainError('stock_warehouse_not_found'),
  )
  assert.throws(
    () => planStockEntry({ ...entry, movementDate: '2026-10-07' }, context()),
    isDomainError('stock_movement_date_future'),
  )
  assert.throws(() => planStockEntry({ ...entry, reason: 'other' }, context()), ZodError)
  assert.throws(() => planStockEntry({ ...entry, quantity: 0 }, context()), ZodError)
  assert.throws(() => planStockEntry({ ...entry, reason: 'usage' }, context()), ZodError)
  assert.equal(
    planStockEntry({ ...entry, reason: 'other', note: 'Fuar hediyesi' }, context()).note,
    'Fuar hediyesi',
  )
})

test('DOM-FIN-078, K-181: çıkış depodaki miktarı aşamaz; geriye tarihli çıkış sonraki günü eksiye düşüremez', () => {
  const history = [movement('in', 10, '2026-10-01'), movement('out', 8, '2026-10-05')]
  const issue = {
    itemId: PAPER,
    warehouseId: MAIN,
    quantity: 2,
    movementDate: '2026-10-06',
    reason: 'usage',
  }
  assert.equal(planStockIssue(issue, context(history)).quantity, 2)
  assert.throws(
    () => planStockIssue({ ...issue, quantity: 3 }, context(history)),
    (error: unknown) =>
      isDomainError('stock_insufficient')(error) &&
      (error as Error).message.includes('en çok 2 paket'),
  )
  assert.throws(
    () => planStockIssue({ ...issue, movementDate: '2026-10-03', quantity: 3 }, context(history)),
    isDomainError('stock_insufficient'),
  )
  // Başka deponun ya da ürünün hareketi sayılmaz.
  assert.throws(
    () => planStockIssue({ ...issue, warehouseId: ANNEX }, context(history)),
    isDomainError('stock_insufficient'),
  )
  assert.throws(() => planStockIssue({ ...issue, reason: 'opening' }, context(history)), ZodError)
})

test('DOM-FIN-078: transfer çıkış deposunun miktarını aşamaz; iki depo farklı ve etkin', () => {
  const history = [movement('in', 5, '2026-10-01')]
  const transfer = {
    itemId: PAPER,
    fromWarehouseId: MAIN,
    toWarehouseId: ANNEX,
    quantity: 5,
    movementDate: '2026-10-06',
  }
  assert.deepEqual(planStockTransfer(transfer, context(history)), { ...transfer, note: null })
  assert.throws(
    () => planStockTransfer({ ...transfer, quantity: 6 }, context(history)),
    isDomainError('stock_insufficient'),
  )
  assert.throws(
    () => planStockTransfer({ ...transfer, toWarehouseId: MAIN }, context(history)),
    ZodError,
  )
  assert.throws(
    () => planStockTransfer({ ...transfer, toWarehouseId: CLOSED }, context(history)),
    isDomainError('stock_warehouse_inactive'),
  )
})

test('DOM-FIN-078, K-183: transfer iptali iki hareketi birlikte iptal eder; giriş iptali stoku eksiye düşüremez', () => {
  const entry = movement('in', 10, '2026-10-01')
  const out = movement('transfer_out', 4, '2026-10-02', { transferId: 't1' })
  const inLeg = movement('transfer_in', 4, '2026-10-02', { warehouseId: ANNEX, transferId: 't1' })
  const issue = movement('out', 3, '2026-10-03', { warehouseId: ANNEX })
  const all = [entry, out, inLeg, issue]
  const ctx = { items: ITEMS, warehouses: WAREHOUSES, movements: all }
  // Ek depodaki 4'ün 3'ü çıkıldı: transfer iptali ek depoyu eksiye düşürür.
  assert.throws(
    () => planStockMovementCancel(out, { reason: 'Yanlış depo seçildi' }, ctx),
    (error: unknown) =>
      isDomainError('stock_cancel_negative')(error) && (error as Error).message.includes('Ek depo'),
  )
  assert.deepEqual(planStockMovementCancel(issue, { reason: 'Yanlış kayıt' }, ctx), {
    reason: 'Yanlış kayıt',
    ids: [issue.id],
  })
  const withoutIssue = { ...ctx, movements: [entry, out, inLeg, { ...issue, cancelledAt: 'x' }] }
  assert.deepEqual(planStockMovementCancel(inLeg, { reason: 'Yanlış depo' }, withoutIssue).ids, [
    out.id,
    inLeg.id,
  ])
  // Ana depodan transfer çıkmışken giriş iptali ana depoyu eksiye düşürür.
  assert.throws(
    () => planStockMovementCancel(entry, { reason: 'Sayım hatası' }, ctx),
    isDomainError('stock_cancel_negative'),
  )
  assert.throws(
    () => planStockMovementCancel({ ...issue, cancelledAt: 'x' }, { reason: 'Yeniden iptal' }, ctx),
    isDomainError('stock_movement_already_cancelled'),
  )
  assert.throws(
    () =>
      planStockMovementCancel(
        movement('receipt', 2, '2026-10-01', { receiptId: 'r1' }),
        { reason: 'Kabul hatası' },
        ctx,
      ),
    isDomainError('stock_movement_from_receipt'),
  )
  assert.throws(() => planStockMovementCancel(issue, { reason: 'kısa' }, ctx), ZodError)
})

test('DOM-FIN-078, K-184: mal kabulde kart seçilen kalem kabul edilen miktarla depoya girer', () => {
  const orderUnits = new Map([
    ['o1', 'pack'],
    ['o2', 'piece'],
    ['o3', 'pack'],
  ])
  const ctx = { items: ITEMS, warehouses: WAREHOUSES, orderUnits }
  assert.deepEqual(
    planReceiptStockEntries(
      {
        warehouseId: MAIN,
        lines: [
          { orderItemId: 'o1', acceptedQuantity: 7, stockItemId: PAPER },
          { orderItemId: 'o2', acceptedQuantity: 3, stockItemId: null },
          // Yalnız ret: giriş yok.
          { orderItemId: 'o3', acceptedQuantity: 0, stockItemId: PAPER },
        ],
      },
      ctx,
    ),
    [{ orderItemId: 'o1', itemId: PAPER, warehouseId: MAIN, quantity: 7 }],
  )
  assert.deepEqual(
    planReceiptStockEntries(
      { warehouseId: null, lines: [{ orderItemId: 'o2', acceptedQuantity: 3, stockItemId: null }] },
      ctx,
    ),
    [],
  )
  assert.throws(
    () =>
      planReceiptStockEntries(
        {
          warehouseId: null,
          lines: [{ orderItemId: 'o1', acceptedQuantity: 1, stockItemId: PAPER }],
        },
        ctx,
      ),
    isDomainError('stock_warehouse_required'),
  )
  assert.throws(
    () =>
      planReceiptStockEntries(
        {
          warehouseId: MAIN,
          lines: [{ orderItemId: 'o2', acceptedQuantity: 1, stockItemId: PAPER }],
        },
        ctx,
      ),
    (error: unknown) =>
      isDomainError('stock_unit_mismatch')(error) &&
      JSON.stringify((error as { path?: unknown }).path) === '["lines","0","stockItemId"]',
  )
  assert.throws(
    () =>
      planReceiptStockEntries(
        {
          warehouseId: CLOSED,
          lines: [{ orderItemId: 'o1', acceptedQuantity: 1, stockItemId: PAPER }],
        },
        ctx,
      ),
    isDomainError('stock_warehouse_inactive'),
  )
  assert.throws(
    () =>
      planReceiptStockEntries(
        {
          warehouseId: MAIN,
          lines: [{ orderItemId: 'o1', acceptedQuantity: 1, stockItemId: TONER }],
        },
        ctx,
      ),
    isDomainError('stock_item_inactive'),
  )
})

test('DOM-FIN-074, K-184: kabul şeması stok kartı seçilince depo ister; kart ve depo isteğe bağlı', () => {
  const base = {
    receiptDate: '2026-10-06',
    receivedBy: 'Hasan Usta',
    lines: [{ orderItemId: PAPER, acceptedQuantity: 1 }],
  }
  const parsed = createPurchaseReceiptSchema.parse(base)
  assert.equal(parsed.warehouseId, null)
  assert.equal(parsed.lines[0]?.stockItemId, null)
  assert.throws(
    () =>
      createPurchaseReceiptSchema.parse({
        ...base,
        lines: [{ orderItemId: PAPER, acceptedQuantity: 1, stockItemId: TONER }],
      }),
    ZodError,
  )
  assert.equal(
    createPurchaseReceiptSchema.parse({
      ...base,
      warehouseId: MAIN,
      lines: [{ orderItemId: PAPER, acceptedQuantity: 1, stockItemId: TONER }],
    }).warehouseId,
    MAIN,
  )
})

test('DOM-FIN-078, K-184: kabul iptali girişleri geri alır; girişi kullanılmışsa reddedilir', () => {
  const received = movement('receipt', 6, '2026-10-02', { receiptId: 'r1' })
  const issue = movement('out', 5, '2026-10-04')
  const ctx = { items: ITEMS, warehouses: WAREHOUSES, movements: [received, issue] }
  assert.throws(
    () => planReceiptStockCancel([received.id], ctx),
    isDomainError('stock_cancel_negative'),
  )
  assert.deepEqual(planReceiptStockCancel([received.id], { ...ctx, movements: [received] }), [
    received.id,
  ])
  assert.deepEqual(planReceiptStockCancel([], ctx), [])
})

test('K-180: yönetici her işlemi yapar, ön büro yalnız çıkış yazar, öteki roller hiçbirini', () => {
  assert.deepEqual(stockActions('yonetici'), {
    manage: true,
    entry: true,
    issue: true,
    transfer: true,
    cancel: true,
  })
  assert.deepEqual(stockActions('onburo'), {
    manage: false,
    entry: false,
    issue: true,
    transfer: false,
    cancel: false,
  })
  assert.equal(Object.values(stockActions('ogretmen')).some(Boolean), false)
})
