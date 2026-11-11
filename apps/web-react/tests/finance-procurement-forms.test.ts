import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formTotalCents,
  requestBody,
  requestDefaults,
  requestFormField,
  requestFormSchema,
  stockItemLabel,
  supplierBody,
  supplierDefaults,
  supplierFormSchema,
} from '../src/pages/finance/finance-procurement-forms.ts'

// ON-221, ON-222 (DOM-FIN-070, DOM-FIN-071): tedarikçi ve satın alma talebi form modeli.

const SUPPLIER = {
  ...supplierDefaults(),
  name: 'Örnek Kırtasiye',
  taxNumber: '1234567890',
  taxOffice: 'Kadıköy',
  categories: ['stationery' as const],
}

test('DOM-FIN-070: tedarikçi formu türe göre vergi numarasını denetler; boş alanlar null olur', () => {
  assert.equal(supplierFormSchema.safeParse(SUPPLIER).success, true)
  const wrong = supplierFormSchema.safeParse({ ...SUPPLIER, type: 'individual' })
  assert.equal(wrong.success, false)
  assert.deepEqual(wrong.error?.issues[0]?.path, ['taxNumber'])
  assert.equal(supplierFormSchema.safeParse({ ...SUPPLIER, iban: 'TR12' }).success, false)
  assert.equal(supplierFormSchema.safeParse({ ...SUPPLIER, categories: [] }).success, false)
  const body = supplierBody({
    ...SUPPLIER,
    contactName: '  ',
    documents: [{ name: 'Vergi levhası', expiryDate: '', note: '' }],
  })
  assert.equal(body.contactName, null)
  assert.equal(body.iban, null)
  assert.deepEqual(body.documents, [{ name: 'Vergi levhası', expiryDate: null, note: null }])
})

test('DOM-FIN-071: talep formu tutarı kuruşa çevirir, tedarikçisiz talepte null gönderir', () => {
  const values = {
    ...requestDefaults(),
    costCenterId: 'c1',
    periodId: 'p1',
    budgetItemId: 'i1',
    justification: 'Laboratuvar için malzeme',
    items: [
      { name: 'Tüp', quantity: '40', unit: 'piece' as const, price: '25,50', stockItem: null },
    ],
  }
  assert.equal(requestFormSchema.safeParse(values).success, true)
  assert.deepEqual(requestBody(values), {
    costCenterId: 'c1',
    periodId: 'p1',
    budgetItemId: 'i1',
    supplierId: null,
    justification: 'Laboratuvar için malzeme',
    items: [
      {
        name: 'Tüp',
        quantity: 40,
        unit: 'piece',
        estimatedUnitPriceCents: 2_550,
        stockItemId: null,
      },
    ],
  })
  for (const item of [
    { name: 'Tüp', quantity: '1,5', unit: 'piece' as const, price: '1', stockItem: null },
    { name: 'Tüp', quantity: '0', unit: 'piece' as const, price: '1', stockItem: null },
    { name: 'Tüp', quantity: '1', unit: 'piece' as const, price: '0', stockItem: null },
  ])
    assert.equal(requestFormSchema.safeParse({ ...values, items: [item] }).success, false)
})

test('DOM-FIN-071: anlık toplam geçersiz satırı saymaz; sunucu alan yolu forma çevrilir', () => {
  assert.equal(
    formTotalCents([
      { quantity: '2', price: '1.000,00' },
      { quantity: 'x', price: '5' },
      { quantity: '3', price: '' },
    ]),
    200_000,
  )
  assert.equal(requestFormField('items.2.estimatedUnitPriceCents'), 'items.2.price')
  assert.equal(requestFormField('items.0.quantity'), 'items.0.quantity')
  assert.equal(requestFormField('periodId'), 'periodId')
  assert.equal(requestFormField('institutionId'), undefined)
  // ON-339: kart bağı hatası kalemin stok kartı alanına düşer.
  assert.equal(requestFormField('items.1.stockItemId'), 'items.1.stockItem')
})

test('ON-339, K-221: kalemin stok kartı bağı gövdeye kimlikle gider; kart birimi kalemin birimidir', () => {
  const card = { id: 'kart-1', label: 'Klavye (KLV)', unit: 'piece' as const }
  const values = {
    ...requestDefaults(),
    costCenterId: 'c1',
    periodId: 'p1',
    budgetItemId: 'i1',
    justification: 'Laboratuvar için malzeme',
    items: [
      { name: 'Klavye', quantity: '4', unit: 'piece' as const, price: '250,00', stockItem: card },
    ],
  }
  assert.equal(requestFormSchema.safeParse(values).success, true)
  assert.equal(requestBody(values).items[0]?.stockItemId, 'kart-1')
  const mismatch = requestFormSchema.safeParse({
    ...values,
    items: [{ ...values.items[0], unit: 'box' }],
  })
  assert.deepEqual(
    mismatch.error?.issues.map((issue) => [issue.path.join('.'), issue.message]),
    [['items.0.stockItem', 'Birim stok kartının birimiyle (adet) aynı olmalıdır.']],
  )
  assert.equal(stockItemLabel({ code: 'KLV', name: 'Klavye' }), 'Klavye (KLV)')
})
