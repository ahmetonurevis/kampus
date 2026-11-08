import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CriticalStockRow } from '@kampus/react-shared/use-finance-inventory.ts'
import { stockPurchaseDraft } from '@kampus/school-core/lib/finance-stock-alerts.ts'
import {
  criticalQuantityText,
  suggestionLine,
  warehouseBreakdown,
} from '../src/pages/finance/finance-inventory-forms.ts'
import {
  formTotalCents,
  requestBody,
  requestDefaultsFromDraft,
  requestFormSchema,
} from '../src/pages/finance/finance-procurement-forms.ts'

// ON-230 (DOM-FIN-079): kritik stok satırları ve talep önerisinin form değerleri.

const COST_CENTER = '00000000-0000-4000-8000-0000000000a1'
const PERIOD = '00000000-0000-4000-8000-0000000000a2'
const BUDGET_ITEM = '00000000-0000-4000-8000-0000000000a3'

const row = (overrides: Partial<CriticalStockRow> = {}): CriticalStockRow => ({
  id: '00000000-0000-4000-8000-0000000000b1',
  code: 'KAG-A4',
  name: 'A4 kâğıt',
  category: 'stationery',
  unit: 'pack',
  minQuantity: 10,
  quantity: 2,
  shortage: 8,
  suggestedQuantity: 18,
  lastUnitPriceCents: 12_550,
  lastReceiptDate: '2026-10-01',
  lastOrderNumber: 'SP-0001',
  warehouses: [
    {
      warehouseId: 'w1',
      warehouseName: 'Ana depo',
      campusName: 'Kadıköy',
      isActive: true,
      quantity: 2,
    },
    {
      warehouseId: 'w2',
      warehouseName: 'Eski depo',
      campusName: null,
      isActive: false,
      quantity: 0,
    },
  ],
  ...overrides,
})

test('DOM-FIN-079: kritik satırın miktar ve depo kırılımı metni', () => {
  assert.equal(criticalQuantityText(row()), '2 / 10 paket')
  assert.equal(warehouseBreakdown(row()), 'Ana depo 2 · Eski depo 0 (pasif)')
  assert.equal(warehouseBreakdown(row({ warehouses: [] })), '—')
})

test('DOM-FIN-079, K-203: talep önerisi formu kalemleri, fiyatı ve gerekçeyi doldurur; birim, dönem ve gider kalemi boş kalır', () => {
  const draft = stockPurchaseDraft(
    [row(), row({ code: 'TONER', name: 'Toner', unit: 'piece', lastUnitPriceCents: null })].map(
      suggestionLine,
    ),
  )
  const values = requestDefaultsFromDraft(draft)
  assert.equal(values.costCenterId, '')
  assert.equal(values.periodId, '')
  assert.equal(values.budgetItemId, '')
  assert.equal(values.supplierId, '')
  assert.equal(values.justification, draft.justification)
  assert.deepEqual(values.items, [
    { name: 'A4 kâğıt (KAG-A4)', quantity: '18', unit: 'pack', price: '125,50' },
    { name: 'Toner (TONER)', quantity: '18', unit: 'piece', price: '' },
  ])
  // Fiyatı bilinmeyen kalem formu geçmez; kullanıcı fiyatı girince talep gövdesi oluşur.
  const filled = { costCenterId: COST_CENTER, periodId: PERIOD, budgetItemId: BUDGET_ITEM }
  assert.equal(requestFormSchema.safeParse({ ...values, ...filled }).success, false)
  const priced = {
    ...values,
    ...filled,
    items: values.items.map((item) => ({ ...item, price: item.price || '80,00' })),
  }
  assert.equal(requestFormSchema.safeParse(priced).success, true)
  assert.equal(formTotalCents(priced.items), 18 * 12_550 + 18 * 8_000)
  assert.deepEqual(
    requestBody(priced).items.map((item) => item.estimatedUnitPriceCents),
    [12_550, 8_000],
  )
})
