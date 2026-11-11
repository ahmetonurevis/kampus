import assert from 'node:assert/strict'
import test from 'node:test'

import { STOCK_QUANTITY_MAX } from '../packages/school-core/src/lib/finance-inventory.ts'
import {
  PURCHASE_JUSTIFICATION_MAX,
  purchaseRequestItemSchema,
  purchaseRequestSchema,
} from '../packages/school-core/src/lib/finance-purchase-requests.ts'
import {
  criticalStockRows,
  OPEN_PURCHASE_REQUEST_STATUSES,
  openRequestWarning,
  stockPurchaseDraft,
  suggestedReorderQuantity,
  type CriticalStockItem,
  type StockSuggestionLine,
} from '../packages/school-core/src/lib/finance-stock-alerts.ts'

import { isDomainError } from './support/domain-error.ts'

// Kritik stok uyarısı ve satın alma talebi önerisi (DOM-FIN-079; ON-230; K-200…K-203).

const MAIN = 'w-main'
const ANNEX = 'w-annex'
const CLOSED = 'w-closed'
const WAREHOUSES = [
  { id: MAIN, isActive: true },
  { id: ANNEX, isActive: true },
  { id: CLOSED, isActive: false },
]

const item = (id: string, code: string, minQuantity: number | null, extra = {}) =>
  ({
    id,
    code,
    unit: 'pack',
    minQuantity,
    isActive: true,
    ...extra,
  }) satisfies CriticalStockItem

test('DOM-FIN-079, K-200: kritik seviye kurum toplamına uygulanır; eşit miktar kritiktir, depo kırılımı verilir', () => {
  const rows = criticalStockRows({
    items: [item('paper', 'KAG-A4', 10), item('toner', 'TONER', 4)],
    warehouses: WAREHOUSES,
    balances: [
      { itemId: 'paper', warehouseId: MAIN, quantity: 6 },
      { itemId: 'paper', warehouseId: ANNEX, quantity: 4 },
      { itemId: 'toner', warehouseId: MAIN, quantity: 3 },
      { itemId: 'toner', warehouseId: ANNEX, quantity: 2 },
    ],
  })
  // Kâğıt toplamı 10 = kritik seviye (kritik); toner 5 > 4 (kritik değil), depo başına 3 < 4 olsa da.
  assert.deepEqual(
    rows.map((row) => ({
      code: row.item.code,
      quantity: row.quantity,
      shortage: row.shortage,
      suggested: row.suggestedQuantity,
      warehouses: row.warehouses,
    })),
    [
      {
        code: 'KAG-A4',
        quantity: 10,
        shortage: 0,
        suggested: 10,
        warehouses: [
          { warehouseId: MAIN, quantity: 6 },
          { warehouseId: ANNEX, quantity: 4 },
        ],
      },
    ],
  )
})

test('DOM-FIN-079, K-200: pasif kart ve kritik seviyesi boş kart listelenmez; pasif depodaki miktar toplama girer', () => {
  const rows = criticalStockRows({
    items: [
      item('passive', 'PASIF', 5, { isActive: false }),
      item('free', 'SINIRSIZ', null),
      item('glue', 'YAPISTIRICI', 5),
      item('zero', 'SIFIR', 0),
    ],
    warehouses: WAREHOUSES,
    balances: [
      { itemId: 'glue', warehouseId: CLOSED, quantity: 3 },
      { itemId: 'glue', warehouseId: MAIN, quantity: 1 },
    ],
  })
  assert.deepEqual(
    rows.map((row) => row.item.code),
    ['SIFIR', 'YAPISTIRICI'],
  )
  const glue = rows.find((row) => row.item.code === 'YAPISTIRICI')
  assert.equal(glue?.quantity, 4)
  // Pasif depo yalnız miktarı varsa görünür.
  assert.deepEqual(glue?.warehouses, [
    { warehouseId: MAIN, quantity: 1 },
    { warehouseId: ANNEX, quantity: 0 },
    { warehouseId: CLOSED, quantity: 3 },
  ])
  const zero = rows.find((row) => row.item.code === 'SIFIR')
  assert.deepEqual(
    zero?.warehouses.map((warehouse) => warehouse.warehouseId),
    [MAIN, ANNEX],
  )
})

test('DOM-FIN-079, K-200: sıra önce tükenenler, sonra kritik seviyeye oranla en az miktar, eşitlikte kod', () => {
  const rows = criticalStockRows({
    items: [
      item('a', 'B-YARI', 10),
      item('b', 'A-YARI', 4),
      item('c', 'TUKENDI-2', 3),
      item('d', 'TUKENDI-1', 50),
      item('e', 'CEYREK', 8),
    ],
    warehouses: WAREHOUSES,
    balances: [
      { itemId: 'a', warehouseId: MAIN, quantity: 5 },
      { itemId: 'b', warehouseId: MAIN, quantity: 2 },
      { itemId: 'e', warehouseId: ANNEX, quantity: 2 },
    ],
  })
  assert.deepEqual(
    rows.map((row) => row.item.code),
    ['TUKENDI-1', 'TUKENDI-2', 'CEYREK', 'A-YARI', 'B-YARI'],
  )
})

test('DOM-FIN-079, K-201: öneri stoku kritik seviyenin iki katına tamamlar, en az 1, üst sınırı aşmaz', () => {
  assert.equal(suggestedReorderQuantity(2, 10), 18)
  assert.equal(suggestedReorderQuantity(10, 10), 10)
  assert.equal(suggestedReorderQuantity(0, 5), 10)
  // Kritik seviye 0: tükenince en az 1 önerilir.
  assert.equal(suggestedReorderQuantity(0, 0), 1)
  // Eksi toplam (olmaması gerekir) öneriyi büyütmez.
  assert.equal(suggestedReorderQuantity(-3, 4), 8)
  assert.equal(suggestedReorderQuantity(0, STOCK_QUANTITY_MAX), STOCK_QUANTITY_MAX)
})

const PAPER_ID = '00000000-0000-4000-8000-0000000000c1'
const TONER_ID = '00000000-0000-4000-8000-0000000000c2'
const line = (overrides: Partial<StockSuggestionLine> = {}): StockSuggestionLine => ({
  id: PAPER_ID,
  code: 'KAG-A4',
  name: 'A4 kâğıt',
  unit: 'pack',
  quantity: 2,
  minQuantity: 10,
  suggestedQuantity: 18,
  lastUnitPriceCents: 12_500,
  ...overrides,
})

test('DOM-FIN-079, K-202, K-203: öneri kalemleri ad (kod), öneri miktarı, kart birimi ve son alış fiyatıdır; talep şemasına uyar', () => {
  const draft = stockPurchaseDraft([
    line(),
    line({
      id: TONER_ID,
      code: 'TONER',
      name: 'Toner',
      unit: 'piece',
      quantity: 0,
      minQuantity: 2,
      suggestedQuantity: 4,
      lastUnitPriceCents: null,
    }),
  ])
  // ON-339, K-221: öneri kalemi stok kartına bağlıdır.
  assert.deepEqual(draft.items, [
    {
      name: 'A4 kâğıt (KAG-A4)',
      quantity: 18,
      unit: 'pack',
      estimatedUnitPriceCents: 12_500,
      stockItemId: PAPER_ID,
    },
    {
      name: 'Toner (TONER)',
      quantity: 4,
      unit: 'piece',
      estimatedUnitPriceCents: null,
      stockItemId: TONER_ID,
    },
  ])
  assert.equal(
    draft.justification,
    'Kritik seviyedeki stok için talep önerisi: KAG-A4 A4 kâğıt 2 paket (kritik seviye 10); TONER Toner 0 adet (kritik seviye 2).',
  )
  // Fiyatı bilinen kalem talep kalemi şemasından geçer; fiyatsız kalemi kullanıcı tamamlar.
  assert.equal(purchaseRequestItemSchema.safeParse({ ...draft.items[0] }).success, true)
  assert.equal(
    purchaseRequestSchema.shape.justification.safeParse(draft.justification).success,
    true,
  )
})

test('DOM-FIN-079, K-203: sıfır ya da eksi son fiyat önerilmez', () => {
  const draft = stockPurchaseDraft([line({ lastUnitPriceCents: 0 })])
  assert.equal(draft.items[0]?.estimatedUnitPriceCents, null)
})

test('DOM-FIN-079, K-203: seçim boşsa ya da 50 kalemi aşarsa öneri reddedilir', () => {
  assert.throws(() => stockPurchaseDraft([]), isDomainError('stock_suggestion_empty'))
  const many = Array.from({ length: 51 }, (_, index) => line({ code: `K-${String(index)}` }))
  assert.throws(() => stockPurchaseDraft(many), isDomainError('stock_suggestion_too_many'))
  assert.equal(stockPurchaseDraft(many.slice(0, 50)).items.length, 50)
})

test('DOM-FIN-079, K-203: uzun gerekçe üst sınıra sığdırılır, sığmayan kalemler sayıyla özetlenir', () => {
  const long = Array.from({ length: 50 }, (_, index) =>
    line({ code: `KOD-${String(index).padStart(14, '0')}`, name: 'Ü'.repeat(60) }),
  )
  const draft = stockPurchaseDraft(long)
  assert.ok(draft.justification.length <= PURCHASE_JUSTIFICATION_MAX)
  const summary = /ve (\d+) ürün daha\.$/.exec(draft.justification)
  assert.ok(summary, draft.justification)
  const listed = draft.justification.split('; ').filter((part) => part.includes('KOD-')).length
  assert.equal(listed + Number(summary[1]), 50)
  assert.equal(draft.items.length, 50)
})

test('ON-339, K-222: açık talep uyarısı yalnız açık talepte miktarı olan seçili kartları sayar; engellemez', () => {
  assert.deepEqual([...OPEN_PURCHASE_REQUEST_STATUSES], ['draft', 'submitted', 'approved'])
  assert.equal(openRequestWarning([]), null)
  assert.equal(openRequestWarning([{ code: 'KAG-A4', unit: 'pack', openRequestQuantity: 0 }]), null)
  assert.equal(
    openRequestWarning([
      { code: 'KAG-A4', unit: 'pack', openRequestQuantity: 20 },
      { code: 'KALEM', unit: 'piece', openRequestQuantity: 0 },
      { code: 'TONER', unit: 'piece', openRequestQuantity: 4 },
    ]),
    'Seçilen 2 ürünün siparişe dönmemiş açık talebi var (KAG-A4 20 paket, TONER 4 adet). Yeni talep mükerrer alıma yol açabilir; yine de açabilirsiniz.',
  )
})
