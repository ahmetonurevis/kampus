import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isInbound,
  planStockMovementCancel,
  stockBalances,
  STOCK_MOVEMENT_TYPE_LABELS,
  type CancellableMovement,
  type StockItemRef,
  type StockWarehouseRef,
} from '../packages/school-core/src/lib/finance-inventory.ts'
import {
  movementDuringCount,
  planStockCountCancel,
  planStockCountComplete,
  planStockCountLineSet,
  planStockCountScan,
  planStockCountStart,
  stockCountActions,
  stockCountReport,
  stockCountReportCsv,
  type CountMovement,
  type StockCountLine,
} from '../packages/school-core/src/lib/finance-stock-counts.ts'

import { isDomainError } from './support/domain-error.ts'

// Stok sayımı ve fark raporu (DOM-FIN-081; ON-231; K-228…K-231).

const ZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'
const PAPER = '00000000-0000-4000-8000-0000000000b1'
const PEN = '00000000-0000-4000-8000-0000000000b2'
const TONER = '00000000-0000-4000-8000-0000000000b3'
const MAIN = '00000000-0000-4000-8000-0000000000c1'
const CLOSED = '00000000-0000-4000-8000-0000000000c3'
const MISSING = '00000000-0000-4000-8000-0000000000ff'
const STARTED = '2026-10-06T08:00:00.000Z'

const ITEMS = new Map<string, StockItemRef>([
  [PAPER, { id: PAPER, code: 'KAG-A4', name: 'A4 kâğıt', unit: 'pack', isActive: true }],
  [PEN, { id: PEN, code: '8690000000017', name: 'Kalem', unit: 'piece', isActive: true }],
  [TONER, { id: TONER, code: 'TONER', name: 'Toner', unit: 'piece', isActive: false }],
])
const WAREHOUSES = new Map<string, StockWarehouseRef>([
  [MAIN, { id: MAIN, name: 'Ana depo', campusId: 'b1', isActive: true }],
  [CLOSED, { id: CLOSED, name: 'Eski depo', campusId: 'b1', isActive: false }],
])
const OPEN = { status: 'open' as const, warehouseId: MAIN }

const line = (itemId: string, systemQuantity: number, counted?: [number, string]) =>
  ({
    itemId,
    systemQuantity,
    countedQuantity: counted?.[0] ?? null,
    countedAt: counted?.[1] ?? null,
    expectedQuantity: null,
    unitCostCents: null,
  }) satisfies StockCountLine
const at = (minute: number) => `2026-10-06T08:${String(minute).padStart(2, '0')}:00.000Z`
const moved = (
  type: CountMovement['type'],
  quantity: number,
  createdAt: string,
  extra: Partial<CountMovement> = {},
): CountMovement => ({ itemId: PAPER, type, quantity, createdAt, cancelledAt: null, ...extra })
const live = (movements: CountMovement[] = [], unitCosts = new Map<string, number>()) => ({
  kind: 'live' as const,
  startedAt: STARTED,
  movements,
  unitCosts,
})
const ruleCode = (code: string) => isDomainError(code)
const withMessage = (code: string, text: string) => (error: unknown) =>
  isDomainError(code)(error) && error instanceof Error && error.message.includes(text)

test('DOM-FIN-081, K-228: başlatma depodaki sıfırdan farklı miktarları anlık görüntü yapar', () => {
  const plan = planStockCountStart(
    { warehouseId: MAIN, note: '  ' },
    {
      warehouses: WAREHOUSES,
      openCountWarehouseIds: new Set(),
      balances: new Map([
        [PAPER, 12],
        [PEN, 0],
      ]),
    },
  )
  assert.deepEqual(plan, {
    warehouseId: MAIN,
    note: null,
    lines: [{ itemId: PAPER, systemQuantity: 12 }],
  })
})

test('DOM-FIN-081, K-228: aynı depoda açık sayım 409; pasif ya da olmayan depo 422; gövde doğrulanır', () => {
  const context = {
    warehouses: WAREHOUSES,
    openCountWarehouseIds: new Set([MAIN]),
    balances: new Map<string, number>(),
  }
  assert.throws(
    () => planStockCountStart({ warehouseId: MAIN }, context),
    isDomainError('stock_count_open_exists', 'conflict'),
  )
  const free = { ...context, openCountWarehouseIds: new Set<string>() }
  assert.throws(
    () => planStockCountStart({ warehouseId: CLOSED }, free),
    ruleCode('stock_warehouse_inactive'),
  )
  assert.throws(
    () => planStockCountStart({ warehouseId: MISSING }, free),
    ruleCode('stock_warehouse_not_found'),
  )
  assert.throws(() => planStockCountStart({ warehouseId: 'x' }, free), ZodError)
  assert.throws(
    () => planStockCountStart({ warehouseId: MAIN, institutionId: 'b' }, free),
    ZodError,
  )
})

test('DOM-FIN-081, K-229: okutma kart kodunu büyük harfe çevirip bulur, 1 ya da girilen miktarı ekler', () => {
  const lines = new Map([[PAPER, { countedQuantity: 3 }]])
  const items = ITEMS.values()
  assert.deepEqual(
    planStockCountScan(OPEN, { code: ' kag-a4 ' }, { items, lines }).countedQuantity,
    4,
  )
  const pen = planStockCountScan(
    OPEN,
    { code: '8690000000017', quantity: 10 },
    { items: ITEMS.values(), lines },
  )
  assert.equal(pen.itemId, PEN)
  assert.equal(pen.countedQuantity, 10)
  assert.equal(pen.isNew, true)
  assert.throws(
    () => planStockCountScan(OPEN, { code: 'YOK' }, { items: ITEMS.values(), lines }),
    withMessage('stock_count_item_not_found', 'YOK'),
  )
  assert.throws(
    () => planStockCountScan(OPEN, { code: 'TONER' }, { items: ITEMS.values(), lines }),
    ruleCode('stock_item_inactive'),
  )
  assert.throws(
    () => planStockCountScan(OPEN, { code: '' }, { items: ITEMS.values(), lines }),
    ZodError,
  )
  assert.throws(
    () =>
      planStockCountScan(OPEN, { code: 'KAG-A4', quantity: 0 }, { items: ITEMS.values(), lines }),
    ZodError,
  )
  assert.throws(
    () =>
      planStockCountScan(
        OPEN,
        { code: 'KAG-A4', quantity: 1_000_000 },
        { items: ITEMS.values(), lines },
      ),
    ruleCode('stock_count_quantity_too_large'),
  )
})

test('DOM-FIN-081, K-229: miktar doğrudan yazılır ya da geri alınır; anlık görüntü dışındaki pasif kart sayılmaz', () => {
  const lines = new Map([[TONER, { countedQuantity: null }]])
  const context = { items: ITEMS, lines }
  assert.deepEqual(planStockCountLineSet(OPEN, { itemId: PAPER, countedQuantity: 0 }, context), {
    itemId: PAPER,
    countedQuantity: 0,
    isNew: true,
  })
  // Anlık görüntüdeki satır kart pasif olsa da sayılır (miktarı olan kart pasifleşemez).
  assert.equal(
    planStockCountLineSet(OPEN, { itemId: TONER, countedQuantity: 2 }, context).isNew,
    false,
  )
  assert.equal(
    planStockCountLineSet(OPEN, { itemId: PEN, countedQuantity: null }, context).countedQuantity,
    null,
  )
  assert.throws(
    () =>
      planStockCountLineSet(
        OPEN,
        { itemId: TONER, countedQuantity: 1 },
        { items: ITEMS, lines: new Map() },
      ),
    ruleCode('stock_item_inactive'),
  )
  assert.throws(
    () => planStockCountLineSet(OPEN, { itemId: MISSING, countedQuantity: 1 }, context),
    ruleCode('stock_item_not_found'),
  )
  assert.throws(
    () => planStockCountLineSet(OPEN, { itemId: PAPER, countedQuantity: -1 }, context),
    ZodError,
  )
})

test('DOM-FIN-081: tamamlanan ve iptal edilen sayım değişmez (stock_count_closed)', () => {
  for (const status of ['completed', 'cancelled'] as const) {
    const count = { status, warehouseId: MAIN }
    assert.throws(
      () =>
        planStockCountScan(count, { code: 'KAG-A4' }, { items: ITEMS.values(), lines: new Map() }),
      ruleCode('stock_count_closed'),
    )
    assert.throws(
      () =>
        planStockCountLineSet(
          count,
          { itemId: PAPER, countedQuantity: 1 },
          { items: ITEMS, lines: new Map() },
        ),
      ruleCode('stock_count_closed'),
    )
    assert.throws(
      () => planStockCountCancel(count, { reason: 'Yanlış depo' }),
      ruleCode('stock_count_closed'),
    )
    const report = stockCountReport([line(PAPER, 1, [1, at(5)])], live())
    assert.throws(
      () =>
        planStockCountComplete(count, report, {
          items: ITEMS,
          warehouses: WAREHOUSES,
          movements: [],
          today: '2026-10-06',
        }),
      ruleCode('stock_count_closed'),
    )
  }
  assert.deepEqual(planStockCountCancel(OPEN, { reason: '  Yanlış depo  ' }), {
    reason: 'Yanlış depo',
  })
  assert.throws(() => planStockCountCancel(OPEN, { reason: 'kısa' }), ZodError)
})

test('DOM-FIN-081, K-230: fark raporu sistem, sayılan, fark ve fark tutarını verir; sayılmayan ayrı listelenir', () => {
  const report = stockCountReport(
    [
      line(PAPER, 10, [7, at(5)]),
      line(PEN, 4, [6, at(6)]),
      line(TONER, 2),
      // Anlık görüntüde olmayan, sonra "sayılmadı" yapılan kart listelenmez.
      line(MISSING, 0),
    ],
    live([], new Map([[PAPER, 12_550]])),
  )
  assert.deepEqual(report.counted, [
    {
      itemId: PAPER,
      systemQuantity: 10,
      movementQuantity: 0,
      expectedQuantity: 10,
      countedQuantity: 7,
      difference: -3,
      unitCostCents: 12_550,
      differenceCents: -37_650,
    },
    {
      itemId: PEN,
      systemQuantity: 4,
      movementQuantity: 0,
      expectedQuantity: 4,
      countedQuantity: 6,
      difference: 2,
      unitCostCents: null,
      differenceCents: null,
    },
  ])
  assert.deepEqual(report.uncounted, [{ itemId: TONER, systemQuantity: 2 }])
  assert.deepEqual(report.totals, {
    countedItems: 2,
    uncountedItems: 1,
    differenceItems: 2,
    surplusCents: 0,
    shortageCents: 37_650,
    netCents: -37_650,
    unpricedDifferenceItems: 1,
  })
})

test('DOM-FIN-081, K-231: sayım sırasındaki hareket kart sayılana kadar beklenen miktara girer', () => {
  const movements = [
    // Sayım başlamadan kaydedilmiş, sayım sırasında iptal edilmiş giriş: beklenenden düşer.
    moved('in', 5, at(0), { cancelledAt: at(3) }),
    // Sayım sırasında, kart sayılmadan önce çıkış: beklenenden düşer.
    moved('out', 2, at(2)),
    // Kart sayıldıktan sonra giriş: sayılanda yok, beklenene girmez.
    moved('receipt', 4, at(20)),
    // Sayım sırasında kaydedilip kart sayılmadan iptal edilen çıkış etkisizdir.
    moved('out', 1, at(4), { cancelledAt: at(6) }),
    // Başka kartın hareketi.
    moved('adjustment_in', 9, at(4), { itemId: PEN }),
  ]
  assert.equal(
    movementDuringCount(
      movements.filter((row) => row.itemId === PAPER),
      STARTED,
      at(10),
    ),
    -7,
  )
  const report = stockCountReport([line(PAPER, 15, [8, at(10)])], live(movements))
  assert.deepEqual(
    report.counted.map(({ systemQuantity, movementQuantity, expectedQuantity, difference }) => ({
      systemQuantity,
      movementQuantity,
      expectedQuantity,
      difference,
    })),
    [{ systemQuantity: 15, movementQuantity: -7, expectedQuantity: 8, difference: 0 }],
  )
})

test('DOM-FIN-081: tamamlanan sayımın raporu satırda saklanan beklenen miktar ve maliyetle sabittir', () => {
  const report = stockCountReport(
    [{ ...line(PAPER, 10, [12, at(5)]), expectedQuantity: 9, unitCostCents: 100 }],
    { kind: 'stored' },
  )
  assert.deepEqual(report.counted[0], {
    itemId: PAPER,
    systemQuantity: 10,
    movementQuantity: -1,
    expectedQuantity: 9,
    countedQuantity: 12,
    difference: 3,
    unitCostCents: 100,
    differenceCents: 300,
  })
  assert.equal(report.totals.surplusCents, 300)
  assert.equal(report.totals.netCents, 300)
})

test('DOM-FIN-081, K-230: tamamlama yalnız farkı olan kartlara fazla ve eksik düzeltmesi planlar', () => {
  const report = stockCountReport(
    [line(PAPER, 10, [7, at(5)]), line(PEN, 4, [6, at(6)]), line(TONER, 2, [2, at(7)])],
    live(),
  )
  const stock = (itemId: string, quantity: number) => ({
    id: `s-${itemId}`,
    itemId,
    warehouseId: MAIN,
    type: 'in' as const,
    quantity,
    movementDate: '2026-10-01',
    cancelledAt: null,
  })
  const adjustments = planStockCountComplete(OPEN, report, {
    items: ITEMS,
    warehouses: WAREHOUSES,
    movements: [stock(PAPER, 10)],
    today: '2026-10-06',
  })
  assert.deepEqual(adjustments, [
    { itemId: PAPER, type: 'adjustment_out', quantity: 3 },
    { itemId: PEN, type: 'adjustment_in', quantity: 2 },
  ])
})

test('DOM-FIN-081, K-231: eksik düzeltmesi stoku eksiye düşürecekse, sayım boşsa, kart ya da depo pasifse reddedilir', () => {
  const context = { items: ITEMS, warehouses: WAREHOUSES, movements: [], today: '2026-10-06' }
  assert.throws(
    () => planStockCountComplete(OPEN, stockCountReport([line(PAPER, 3)], live()), context),
    ruleCode('stock_count_empty'),
  )
  // Kart 10 sayıldı, sistem 10; sonra 8 çıkış yazıldı (depoda 2 kaldı). Sayılan 4 → eksik 6 > 2.
  const shortage = stockCountReport([line(PAPER, 10, [4, at(5)])], live())
  assert.throws(
    () =>
      planStockCountComplete(OPEN, shortage, {
        ...context,
        movements: [
          {
            id: 'a',
            itemId: PAPER,
            warehouseId: MAIN,
            type: 'in',
            quantity: 10,
            movementDate: '2026-10-01',
            cancelledAt: null,
          },
          {
            id: 'b',
            itemId: PAPER,
            warehouseId: MAIN,
            type: 'out',
            quantity: 8,
            movementDate: '2026-10-06',
            cancelledAt: null,
          },
        ],
      }),
    withMessage('stock_count_negative', 'en çok 2'),
  )
  const surplus = stockCountReport([line(TONER, 0, [1, at(5)])], live())
  assert.throws(
    () => planStockCountComplete(OPEN, surplus, context),
    ruleCode('stock_item_inactive'),
  )
  assert.throws(
    () => planStockCountComplete({ status: 'open', warehouseId: CLOSED }, surplus, context),
    ruleCode('stock_warehouse_inactive'),
  )
})

test('DOM-FIN-081: sayım düzeltmesi giriş/çıkış yönünde sayılır ve hareket listesinden iptal edilmez', () => {
  assert.equal(isInbound('adjustment_in'), true)
  assert.equal(isInbound('adjustment_out'), false)
  assert.equal(STOCK_MOVEMENT_TYPE_LABELS.adjustment_out, 'Sayım eksiği düzeltmesi')
  const base = {
    itemId: PAPER,
    warehouseId: MAIN,
    movementDate: '2026-10-06',
    cancelledAt: null,
    transferId: null,
    receiptId: null,
  }
  const movements: CancellableMovement[] = [
    { ...base, id: 'a', type: 'in', quantity: 10 },
    { ...base, id: 'b', type: 'adjustment_out', quantity: 3 },
    { ...base, id: 'c', type: 'adjustment_in', quantity: 1 },
  ]
  assert.equal(stockBalances(movements).get(`${PAPER}|${MAIN}`), 8)
  for (const movement of movements.slice(1))
    assert.throws(
      () =>
        planStockMovementCancel(
          movement,
          { reason: 'Yanlış sayım' },
          { items: ITEMS, warehouses: WAREHOUSES, movements },
        ),
      ruleCode('stock_movement_from_count'),
    )
})

test('K-228: yönetici başlatır, tamamlar, iptal eder; ön büro okutur; diğer roller hiçbirini yapmaz', () => {
  assert.deepEqual(stockCountActions('yonetici'), {
    start: true,
    count: true,
    complete: true,
    cancel: true,
  })
  assert.deepEqual(stockCountActions('onburo'), {
    start: false,
    count: true,
    complete: false,
    cancel: false,
  })
  for (const role of ['ogretmen', 'veli', 'ogrenci'])
    assert.deepEqual(Object.values(stockCountActions(role)), [false, false, false, false])
})

test('DOM-FIN-081: fark raporu CSV sayılan ve sayılmayan kalemleri kaçışlı yazar', () => {
  const report = stockCountReport(
    [line(PAPER, 10, [7, at(5)]), line(PEN, 2)],
    live([], new Map([[PAPER, 1_250]])),
  )
  const csv = stockCountReportCsv(
    report,
    new Map([
      [PAPER, { code: 'KAG-A4', name: '=A4 kâğıt', unit: 'pack' as const }],
      [PEN, { code: 'KALEM', name: 'Kalem', unit: 'piece' as const }],
    ]),
  )
  const rows = csv.split('\r\n')
  assert.equal(rows.length, 3)
  assert.ok(rows[0]?.startsWith('"Kod";"Ürün";"Birim";"Sistem (anlık görüntü)"'))
  assert.equal(rows[1], `"KAG-A4";"'=A4 kâğıt";"paket";10;0;10;7;-3;12,50;-37,50;"Eksik"`)
  assert.equal(rows[2], `"KALEM";"Kalem";"adet";2;;;;;;;"Sayılmadı"`)
})
