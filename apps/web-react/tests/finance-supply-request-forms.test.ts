import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SupplyRequestDetail } from '@kampus/react-shared/use-finance-supply-requests.ts'
import {
  convertBody,
  convertDefaults,
  convertFormField,
  convertFormSchema,
  defaultWarehouse,
  fulfillBody,
  fulfillFormField,
  fulfillFormSchema,
  suggestedLines,
  supplyRequestBody,
  supplyRequestDefaults,
  supplyRequestFormField,
  supplyRequestFormSchema,
  type FulfillFormValues,
} from '../src/pages/finance/finance-supply-request-forms.ts'

// ON-233 (DOM-FIN-091): sarf talebi formlarının gövdeleri, önerileri ve alan eşlemesi.

const PAPER = '00000000-0000-4000-8000-0000000000b1'
const GLOVE = '00000000-0000-4000-8000-0000000000b2'
const MAIN = '00000000-0000-4000-8000-0000000000c1'
const ANNEX = '00000000-0000-4000-8000-0000000000c2'

type Item = SupplyRequestDetail['items'][number]
const item = (overrides: Partial<Item>): Item => ({
  id: 'line-paper',
  position: 0,
  stockItem: { id: PAPER, code: 'KAG-A4', name: 'A4 kâğıt', isActive: true },
  unit: 'pack',
  quantity: 4,
  fulfilledQuantity: 0,
  remainingQuantity: 4,
  stock: [
    { warehouseId: MAIN, warehouseName: 'Ana depo', quantity: 3 },
    { warehouseId: ANNEX, warehouseName: 'Ek depo', quantity: 10 },
  ],
  lastPriceCents: 12_050,
  ...overrides,
})
const ITEMS: Item[] = [
  item({}),
  item({
    id: 'line-glove',
    position: 1,
    stockItem: { id: GLOVE, code: 'ELD-M', name: 'Eldiven', isActive: true },
    unit: 'box',
    quantity: 2,
    remainingQuantity: 2,
    stock: [{ warehouseId: MAIN, warehouseName: 'Ana depo', quantity: 5 }],
    lastPriceCents: null,
  }),
  item({ id: 'line-done', quantity: 1, fulfilledQuantity: 1, remainingQuantity: 0 }),
]

test('DOM-FIN-091: talep formu miktarı tam sayı, gerekçeyi kırpılmış gönderir', () => {
  const values = {
    ...supplyRequestDefaults('2026-10-09'),
    justification: '  9-A fen deneyi  ',
    items: [
      { stockItemId: PAPER, quantity: '4' },
      { stockItemId: GLOVE, quantity: ' 2 ' },
    ],
  }
  assert.equal(supplyRequestFormSchema.safeParse(values).success, true)
  assert.deepEqual(supplyRequestBody(values), {
    neededDate: '2026-10-09',
    justification: '9-A fen deneyi',
    items: [
      { stockItemId: PAPER, quantity: 4 },
      { stockItemId: GLOVE, quantity: 2 },
    ],
  })
  for (const items of [
    [{ stockItemId: '', quantity: '1' }],
    [{ stockItemId: PAPER, quantity: '0' }],
    [{ stockItemId: PAPER, quantity: '1,5' }],
    [
      { stockItemId: PAPER, quantity: '1' },
      { stockItemId: PAPER, quantity: '2' },
    ],
  ])
    assert.equal(supplyRequestFormSchema.safeParse({ ...values, items }).success, false)
  assert.equal(supplyRequestFormField('items.1.stockItemId'), 'items.1.stockItemId')
  assert.equal(supplyRequestFormField('items.0.quantity'), 'items.0.quantity')
  assert.equal(supplyRequestFormField('items'), 'items')
  assert.equal(supplyRequestFormField('neededDate'), 'neededDate')
  assert.equal(supplyRequestFormField('other'), undefined)
})

test('DOM-FIN-091: karşılama önerisi kalan ile depodaki miktarın küçüğüdür; en çok karşılayan depo seçilir', () => {
  // Ana depo 3 kâğıt + 2 eldiven karşılar, ek depo 4 kâğıt: ana depo önerilir.
  assert.equal(defaultWarehouse(ITEMS), MAIN)
  assert.equal(defaultWarehouse([ITEMS[0] as Item]), ANNEX)
  assert.deepEqual(suggestedLines(ITEMS, MAIN), [
    { itemId: 'line-paper', quantity: '3' },
    { itemId: 'line-glove', quantity: '2' },
  ])
  assert.deepEqual(suggestedLines(ITEMS, ANNEX), [
    { itemId: 'line-paper', quantity: '4' },
    { itemId: 'line-glove', quantity: '' },
  ])
  assert.equal(defaultWarehouse([item({ stock: [] })]), '')
})

test('DOM-FIN-091: karşılama gövdesi boş kalemi göndermez; kapatma açıklama ister', () => {
  const values: FulfillFormValues = {
    warehouseId: MAIN,
    movementDate: '2026-10-06',
    lines: [
      { itemId: 'line-paper', quantity: '' },
      { itemId: 'line-glove', quantity: '2' },
    ],
    close: false,
    closeNote: 'yok sayılır',
  }
  assert.equal(fulfillFormSchema.safeParse(values).success, true)
  assert.deepEqual(fulfillBody(values), {
    warehouseId: MAIN,
    movementDate: '2026-10-06',
    lines: [{ itemId: 'line-glove', quantity: 2 }],
    close: false,
    closeNote: null,
  })
  const empty = { ...values, lines: values.lines.map((line) => ({ ...line, quantity: '' })) }
  assert.equal(fulfillFormSchema.safeParse(empty).success, false)
  assert.equal(
    fulfillFormSchema.safeParse({ ...empty, close: true, closeNote: 'yok' }).success,
    false,
  )
  const closing = { ...empty, close: true, closeNote: ' Eldiven alınmayacak ' }
  assert.equal(fulfillFormSchema.safeParse(closing).success, true)
  assert.deepEqual(fulfillBody(closing), {
    warehouseId: MAIN,
    movementDate: '2026-10-06',
    close: true,
    closeNote: 'Eldiven alınmayacak',
  })
  // Sunucu yolu gönderilen satır sırasıdır; formdaki satıra çevrilir.
  assert.equal(fulfillFormField('lines.0.quantity', values), 'lines.1.quantity')
  assert.equal(fulfillFormField('lines.5.quantity', values), 'lines')
  assert.equal(fulfillFormField('warehouseId', values), 'warehouseId')
  assert.equal(fulfillFormField('lines', values), 'lines')
  assert.equal(fulfillFormField('other', values), undefined)
})

test('DOM-FIN-091: dönüştürme formu kalanı olan kalemleri son alış fiyatıyla önerir', () => {
  const request = { items: ITEMS } as SupplyRequestDetail
  const defaults = convertDefaults(request)
  assert.deepEqual(defaults.prices, [
    { itemId: 'line-paper', price: '120,50' },
    { itemId: 'line-glove', price: '' },
  ])
  assert.equal(convertFormSchema.safeParse(defaults).success, false)
  const values = {
    ...defaults,
    costCenterId: 'merkez',
    periodId: 'donem',
    budgetItemId: 'kalem',
    prices: [
      { itemId: 'line-paper', price: '120,50' },
      { itemId: 'line-glove', price: '1.250' },
    ],
  }
  assert.equal(convertFormSchema.safeParse(values).success, true)
  assert.deepEqual(convertBody(values), {
    costCenterId: 'merkez',
    periodId: 'donem',
    budgetItemId: 'kalem',
    supplierId: null,
    prices: [
      { itemId: 'line-paper', estimatedUnitPriceCents: 12_050 },
      { itemId: 'line-glove', estimatedUnitPriceCents: 125_000 },
    ],
  })
  assert.equal(convertBody({ ...values, supplierId: 'tedarikci' }).supplierId, 'tedarikci')
  assert.equal(convertFormField('prices.1.estimatedUnitPriceCents'), 'prices.1.price')
  assert.equal(convertFormField('prices'), 'prices')
  assert.equal(convertFormField('periodId'), 'periodId')
  assert.equal(convertFormField('other'), undefined)
})
