import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  quoteCreateBody,
  quoteDefaults,
  quoteFormField,
  quoteFormSchema,
  quoteFormTotals,
  quoteUpdateBody,
  selectionFormSchema,
} from '../src/pages/finance/finance-purchase-order-forms.ts'

// ON-224, ON-225 (DOM-FIN-072, DOM-FIN-073): teklif formu ve seçim gerekçesi modeli.

const BOARD = {
  items: [
    { id: 'k1', name: 'Klavye', quantity: 10, unit: 'piece' as const },
    { id: 'k2', name: 'Fare', quantity: 3, unit: 'piece' as const },
  ],
}

test('DOM-FIN-072: teklif formu her talep kalemine fiyat satırı açar, gövde kuruş ve KDV oranı taşır', () => {
  const defaults = quoteDefaults(BOARD)
  assert.deepEqual(
    defaults.items.map((item) => [item.requestItemId, item.price, item.vatRate]),
    [
      ['k1', '', '20'],
      ['k2', '', '20'],
    ],
  )
  const values = {
    ...defaults,
    supplierId: 's1',
    deliveryDays: '5',
    validUntil: '2026-10-20',
    note: '  ',
    items: [
      { requestItemId: 'k1', price: '200,00', vatRate: '20' },
      { requestItemId: 'k2', price: '100,05', vatRate: '10' },
    ],
  }
  assert.equal(quoteFormSchema.safeParse(values).success, true)
  assert.deepEqual(quoteCreateBody(values), {
    supplierId: 's1',
    deliveryDays: 5,
    validUntil: '2026-10-20',
    note: null,
    items: [
      { requestItemId: 'k1', unitPriceCents: 20_000, vatRate: 20 },
      { requestItemId: 'k2', unitPriceCents: 10_005, vatRate: 10 },
    ],
  })
  assert.equal('supplierId' in quoteUpdateBody(values), false)
  const quantities = new Map(BOARD.items.map((item) => [item.id, item.quantity]))
  // 3 × 100,05 = 300,15; %10 KDV 30,015 → 30,02 (kalemde yarım kuruş yukarı).
  assert.deepEqual(quoteFormTotals(values.items, quantities), {
    netCents: 230_015,
    vatCents: 43_002,
    grossCents: 273_017,
  })
  assert.equal(
    quoteFormSchema.safeParse({ ...values, deliveryDays: '400' }).success,
    false,
    'teslim süresi en çok 365 gün',
  )
  assert.equal(
    quoteFormSchema.safeParse({ ...values, items: [{ ...values.items[0], price: '0' }] }).success,
    false,
  )
})

test('DOM-FIN-072: sunucu alan yolu form alanına çevrilir', () => {
  assert.equal(quoteFormField('items.1.unitPriceCents'), 'items.1.price')
  assert.equal(quoteFormField('items.0.vatRate'), 'items.0.vatRate')
  assert.equal(quoteFormField('validUntil'), 'validUntil')
  assert.equal(quoteFormField('items'), undefined)
})

test('DOM-FIN-072: en düşük olmayan teklif gerekçesiz seçilmez (K-137)', () => {
  assert.equal(selectionFormSchema(true).safeParse({ reason: '' }).success, true)
  assert.equal(selectionFormSchema(false).safeParse({ reason: 'kısa' }).success, false)
  assert.equal(
    selectionFormSchema(false).safeParse({ reason: 'Teslim süresi daha kısa' }).success,
    true,
  )
})
