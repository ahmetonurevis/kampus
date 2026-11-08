import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  receiptBody,
  receiptDefaults,
  receiptFormField,
  receiptFormSchema,
} from '../src/pages/finance/finance-purchase-receipt-forms.ts'

// ON-226 (DOM-FIN-074): mal kabul formu modeli.

const item = (id: string, quantity: number, remaining: number) => ({
  id,
  position: 0,
  name: id,
  unit: 'piece' as const,
  quantity,
  unitPriceCents: 100,
  acceptedQuantity: quantity - remaining,
  rejectedQuantity: 0,
  remainingQuantity: remaining,
})
const BOARD = { items: [item('k1', 10, 4), item('k2', 3, 0), item('k3', 5, 5)] }

test('DOM-FIN-074: form yalnız kalanı olan kalemleri açar; gövdeye miktar girilen kalemler gider', () => {
  const defaults = receiptDefaults(BOARD, '2026-10-06')
  assert.deepEqual(
    defaults.lines.map((line) => [line.orderItemId, line.remaining]),
    [
      ['k1', 4],
      ['k3', 5],
    ],
  )
  const values = {
    ...defaults,
    receivedBy: ' Hasan Usta ',
    inspectionNote: ' ',
    lines: [
      { ...defaults.lines[0]!, accepted: '', rejected: '' },
      { ...defaults.lines[1]!, accepted: '3', rejected: '2', rejectReason: ' Kırık ' },
    ],
  }
  assert.equal(receiptFormSchema.safeParse(values).success, true)
  assert.deepEqual(receiptBody(values), {
    body: {
      receiptDate: '2026-10-06',
      receivedBy: 'Hasan Usta',
      inspectionNote: null,
      lines: [
        { orderItemId: 'k3', acceptedQuantity: 3, rejectedQuantity: 2, rejectReason: 'Kırık' },
      ],
    },
    formIndexes: [1],
  })
})

test('DOM-FIN-074: kalanı aşan, nedensiz ret ve boş kabul formda reddedilir (K-150)', () => {
  const defaults = receiptDefaults(BOARD, '2026-10-06')
  const withLine = (patch: Record<string, string>) => ({
    ...defaults,
    receivedBy: 'Hasan Usta',
    lines: [{ ...defaults.lines[0]!, ...patch }, defaults.lines[1]!],
  })
  const paths = (values: unknown) =>
    receiptFormSchema.safeParse(values).error?.issues.map((issue) => issue.path.join('.'))
  assert.deepEqual(paths(withLine({ accepted: '5' })), ['lines.0.accepted'])
  assert.deepEqual(paths(withLine({ rejected: '1' })), ['lines.0.rejectReason'])
  assert.deepEqual(paths(withLine({})), ['root.server'])
  assert.deepEqual(paths(withLine({ accepted: '1,5' })), ['lines.0.accepted', 'root.server'])
})

test('DOM-FIN-074: sunucu alan yolu gövde sırasından form satırına çevrilir', () => {
  assert.equal(receiptFormField('lines.0.acceptedQuantity', [1, 3]), 'lines.1.accepted')
  assert.equal(receiptFormField('lines.1.rejectReason', [1, 3]), 'lines.3.rejectReason')
  assert.equal(receiptFormField('lines.1.rejectedQuantity', [1, 3]), 'lines.3.rejected')
  assert.equal(receiptFormField('receivedBy', []), 'receivedBy')
  assert.equal(receiptFormField('lines.5.acceptedQuantity', [0]), undefined)
  assert.equal(receiptFormField('lines', [0]), undefined)
})
