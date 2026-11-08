import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  signedQuantity,
  stockItemBody,
  stockItemDefaults,
  stockItemFormSchema,
  stockMovementBody,
  stockMovementDefaults,
  stockMovementFormField,
  stockMovementFormSchema,
  stockWarehouseBody,
} from '../src/pages/finance/finance-inventory-forms.ts'

// ON-228, ON-229 (DOM-FIN-077, DOM-FIN-078): stok formlarının gövdeleri ve alan eşlemesi.

const ITEM = '00000000-0000-4000-8000-0000000000b1'
const MAIN = '00000000-0000-4000-8000-0000000000c1'
const ANNEX = '00000000-0000-4000-8000-0000000000c2'

test('DOM-FIN-077: kart formu boş kritik seviyeyi null, sayıyı tam sayı gönderir', () => {
  const values = {
    ...stockItemDefaults(),
    code: ' kag-a4 ',
    name: ' A4 kâğıt ',
    unit: 'pack' as const,
  }
  assert.deepEqual(stockItemBody(values), {
    code: 'kag-a4',
    name: 'A4 kâğıt',
    category: 'stationery',
    unit: 'pack',
    minQuantity: null,
  })
  assert.equal(stockItemBody({ ...values, minQuantity: '12' }).minQuantity, 12)
  assert.equal(stockItemFormSchema.safeParse({ ...values, minQuantity: '-1' }).success, false)
  assert.equal(stockItemFormSchema.safeParse({ ...values, code: 'ğ' }).success, false)
})

test('DOM-FIN-077: depo formu boş notu null gönderir', () => {
  assert.deepEqual(stockWarehouseBody({ name: ' Ana depo ', campusId: 'b1', note: ' ' }), {
    name: 'Ana depo',
    campusId: 'b1',
    note: null,
  })
})

test('DOM-FIN-078: giriş, çıkış ve transfer gövdeleri; transferde çıkış deposu fromWarehouseId', () => {
  const entry = {
    ...stockMovementDefaults('entry', '2026-10-06', ITEM),
    warehouseId: MAIN,
    quantity: '20',
  }
  assert.deepEqual(stockMovementBody(entry), {
    kind: 'entry',
    body: {
      itemId: ITEM,
      warehouseId: MAIN,
      quantity: 20,
      movementDate: '2026-10-06',
      reason: 'opening',
      note: null,
    },
  })
  const issue = {
    ...stockMovementDefaults('issue', '2026-10-06', ITEM),
    warehouseId: MAIN,
    quantity: '3',
  }
  assert.equal(stockMovementBody(issue).kind, 'issue')
  assert.equal((stockMovementBody(issue).body as { reason: string }).reason, 'usage')
  const transfer = {
    ...stockMovementDefaults('transfer', '2026-10-06', ITEM),
    warehouseId: MAIN,
    toWarehouseId: ANNEX,
    quantity: '4',
    note: ' Yer değişikliği ',
  }
  assert.deepEqual(stockMovementBody(transfer), {
    kind: 'transfer',
    body: {
      itemId: ITEM,
      fromWarehouseId: MAIN,
      toWarehouseId: ANNEX,
      quantity: 4,
      movementDate: '2026-10-06',
      note: 'Yer değişikliği',
    },
  })
  assert.equal(stockMovementFormField('fromWarehouseId'), 'warehouseId')
  assert.equal(stockMovementFormField('quantity'), 'quantity')
  assert.equal(stockMovementFormField('unknown'), undefined)
})

test('DOM-FIN-078: form sıfır miktarı, aynı depoya transferi ve açıklamasız "Diğer"i reddeder', () => {
  const base = { ...stockMovementDefaults('issue', '2026-10-06', ITEM), warehouseId: MAIN }
  const paths = (values: unknown) => {
    const result = stockMovementFormSchema.safeParse(values)
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
  }
  assert.deepEqual(paths({ ...base, quantity: '0' }), ['quantity'])
  assert.deepEqual(paths({ ...base, quantity: '2', reason: 'other' }), ['note'])
  assert.deepEqual(paths({ ...base, quantity: '2', reason: 'other', note: 'Fuar' }), [])
  assert.deepEqual(
    paths({ ...base, kind: 'transfer', toWarehouseId: MAIN, quantity: '1', reason: '' }),
    ['toWarehouseId'],
  )
})

test('DOM-FIN-078: işaretli miktar girişte artı, çıkış ve transfer çıkışında eksi', () => {
  assert.equal(signedQuantity('receipt', 6, 'adet'), '+6 adet')
  assert.equal(signedQuantity('transfer_out', 2, 'paket'), '−2 paket')
})
