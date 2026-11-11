import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { StockCountDetail } from '@kampus/react-shared/use-finance-stock-counts.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import {
  STOCK_COUNT_REPORT_TITLE,
  stockCountDocument,
  stockCountFilename,
  stockCountReference,
} from '../src/lib/pdf/templates/finance-stock-count.ts'
import {
  completionSummary,
  hasMovementsDuringCount,
  quantityDefaults,
  quantityFormSchema,
  scanBody,
  scanFormSchema,
  signedDifference,
  startCountBody,
  startCountFormField,
  startCountFormSchema,
  stockCountCsvFilename,
  stockCountCsvItems,
} from '../src/pages/finance/finance-stock-count-forms.ts'
import { allTexts, measurer, texts } from './support/pdf-measurer.ts'

// ON-231 (DOM-FIN-081): sayım formları, ekran özetleri ve fark raporu PDF şablonu. Rakamlar API
// yanıtından gelir; şablon ve model yalnız gösterimi belirler.

const OPTIONS = {
  institution: 'Akademi Özel Okulları',
  generatedAt: new Date('2026-10-06T15:00:00.000Z'),
}
const COUNT_ID = '3f2a9c1e-0000-4000-8000-000000000001'

type Counted = StockCountDetail['counted'][number]
const counted = (overrides: Partial<Counted> = {}): Counted => ({
  itemId: 'i1',
  itemCode: 'KAG-A4',
  itemName: 'A4 kâğıt',
  unit: 'pack',
  systemQuantity: 20,
  movementQuantity: 0,
  expectedQuantity: 20,
  countedQuantity: 17,
  difference: -3,
  unitCostCents: 12_550,
  differenceCents: -37_650,
  countedAt: '2026-10-06T09:10:00.000Z',
  movementId: null,
  ...overrides,
})

const count = (overrides: Partial<StockCountDetail> = {}): StockCountDetail => ({
  id: COUNT_ID,
  warehouseId: 'w1',
  warehouseName: 'Ana depo',
  campusName: 'Kadıköy',
  status: 'completed',
  note: 'Yıl sonu sayımı',
  startedAt: '2026-10-06T09:00:00.000Z',
  startedByName: 'Okul Yöneticisi',
  completedAt: '2026-10-06T10:00:00.000Z',
  completedByName: 'Okul Yöneticisi',
  adjustmentDate: '2026-10-06',
  cancelledAt: null,
  cancelledByName: null,
  cancelReason: null,
  counted: [
    counted(),
    counted({
      itemId: 'i2',
      itemCode: 'KALEM',
      itemName: 'Tükenmez kalem',
      unit: 'piece',
      systemQuantity: 6,
      expectedQuantity: 5,
      movementQuantity: -1,
      countedQuantity: 8,
      difference: 3,
      unitCostCents: null,
      differenceCents: null,
    }),
  ],
  uncounted: [
    { itemId: 'i3', itemCode: 'TONER', itemName: 'Toner', unit: 'piece', systemQuantity: 2 },
  ],
  totals: {
    countedItems: 2,
    uncountedItems: 1,
    differenceItems: 2,
    surplusCents: 0,
    shortageCents: 37_650,
    netCents: -37_650,
    unpricedDifferenceItems: 1,
  },
  actions: { count: false, complete: false, cancel: false },
  version: 2,
  ...overrides,
})

test('DOM-FIN-081, K-229: okutma formu kodu zorunlu tutar, boş miktarı 1 sayar', () => {
  assert.deepEqual(scanBody(scanFormSchema.parse({ code: ' kag-a4 ', quantity: '' })), {
    code: 'kag-a4',
    quantity: 1,
  })
  assert.deepEqual(scanBody({ code: '8690000000017', quantity: ' 12 ' }), {
    code: '8690000000017',
    quantity: 12,
  })
  assert.equal(scanFormSchema.safeParse({ code: '  ', quantity: '1' }).success, false)
  assert.equal(scanFormSchema.safeParse({ code: 'A', quantity: '0' }).success, false)
  assert.equal(scanFormSchema.safeParse({ code: 'A', quantity: '1,5' }).success, false)
})

test('DOM-FIN-081: başlatma ve elle miktar formları gövdeye çevrilir, alan eşlemesi yapılır', () => {
  assert.equal(startCountFormSchema.safeParse({ warehouseId: '', note: '' }).success, false)
  assert.deepEqual(startCountBody({ warehouseId: 'w1', note: '  ' }), {
    warehouseId: 'w1',
    note: null,
  })
  assert.deepEqual(startCountBody({ warehouseId: 'w1', note: ' Raf 3 ' }), {
    warehouseId: 'w1',
    note: 'Raf 3',
  })
  assert.equal(startCountFormField('warehouseId'), 'warehouseId')
  assert.equal(startCountFormField('institutionId'), undefined)
  assert.deepEqual(quantityDefaults(null), { countedQuantity: '' })
  assert.deepEqual(quantityDefaults(7), { countedQuantity: '7' })
  assert.equal(quantityFormSchema.safeParse({ countedQuantity: '0' }).success, true)
  assert.equal(quantityFormSchema.safeParse({ countedQuantity: '-1' }).success, false)
  assert.equal(quantityFormSchema.safeParse({ countedQuantity: '' }).success, false)
})

test('DOM-FIN-081, K-230, K-231: ekran özetleri fark, hareket ve tamamlama etkisini anlatır', () => {
  assert.equal(signedDifference(3), '+3')
  assert.equal(signedDifference(-3), '−3')
  assert.equal(signedDifference(0), '0')
  assert.equal(hasMovementsDuringCount(count()), true)
  assert.equal(hasMovementsDuringCount(count({ counted: [counted()] })), false)
  assert.equal(
    completionSummary(count()),
    '1 kalem için fazla, 1 kalem için eksik düzeltmesi yazılacak. 1 sayılmayan kalem değişmeyecek.',
  )
  assert.equal(
    completionSummary(count({ counted: [counted({ difference: 0 })], uncounted: [] })),
    'Sayılan kalemlerde fark yok; düzeltme hareketi yazılmayacak.',
  )
  assert.equal(stockCountCsvFilename(count()), 'stok-sayimi-Ana depo-2026-10-06.csv')
  assert.deepEqual(stockCountCsvItems(count()).get('i3'), {
    code: 'TONER',
    name: 'Toner',
    unit: 'piece',
  })
})

test('DOM-FIN-081: fark raporu PDF sayım bilgileri, sayılan ve sayılmayan kalemler, toplam ve imzaları yazar', () => {
  const document = stockCountDocument(measurer, count(), OPTIONS)
  const all = allTexts(document)
  for (const text of [
    'STOK SAYIMI',
    'TAMAMLANDI',
    STOCK_COUNT_REPORT_TITLE,
    'Akademi Özel Okulları',
    'Ana depo · Kadıköy',
    'Tamamlandı',
    'Yıl sonu sayımı',
    '20 paket',
    '17',
    '-3',
    money(-37_650),
    '-1',
    '+3',
    'Sayılmayan kalemler',
    '2 adet',
    'Sayımı yapan',
    'Depo sorumlusu',
  ])
    assert.ok(all.includes(text), text)
  assert.ok(all.join(' ').includes('KAG-A4 · A4 kâğıt'))
  assert.ok(!all.includes('TASLAK'))
  assert.equal(stockCountReference(count()), 'SAY-20261006-3F2A9C1E')
  assert.equal(stockCountFilename(count()), 'stok-sayimi-SAY-20261006-3F2A9C1E.pdf')
})

test('DOM-FIN-081: açık sayımın raporu TASLAK, iptal edilenin raporu İPTAL EDİLDİ işaretlidir', () => {
  const open = texts(
    stockCountDocument(
      measurer,
      count({ status: 'open', completedAt: null, completedByName: null, adjustmentDate: null }),
      OPTIONS,
    ).pages[0] ?? { ops: [] },
  )
  assert.ok(open.includes('TASLAK'))
  const cancelled = allTexts(
    stockCountDocument(
      measurer,
      count({
        status: 'cancelled',
        completedAt: null,
        completedByName: null,
        adjustmentDate: null,
        cancelledAt: '2026-10-06T11:00:00.000Z',
        cancelledByName: 'Okul Yöneticisi',
        cancelReason: 'Yanlış depo seçildi',
      }),
      OPTIONS,
    ),
  )
  assert.ok(cancelled.includes('İPTAL EDİLDİ'))
  assert.ok(cancelled.includes('Yanlış depo seçildi'))
})
