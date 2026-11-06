import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import type { PaymentFormValues } from '@kampus/school-core/lib/payments.ts'

import type { CollectionRow } from '../src/collections.ts'
import {
  invoiceRow,
  isInvoiceStatusKey,
  PARTIAL_STATUS,
  recordPaymentBody,
} from '../src/finance-model.ts'

const seed = createSeed(new Date('2026-09-01T09:00:00Z'))
const invoice = seed.invoices.find((item) => !item.paidAt)!
const row = (
  record: typeof invoice,
  joined?: CollectionRow<typeof invoice>['joined'],
): CollectionRow<typeof invoice> => ({
  id: record.id,
  version: 3,
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
  archivedAt: null,
  record,
  ...(joined ? { joined } : {}),
})
const target = { id: 'inv-1', studentId: 's1' }
const values: PaymentFormValues = {
  amount: '1.234,56',
  method: 'Banka havalesi',
  reference: 'DEK-1',
  paidDate: '2026-09-10',
  bankAccountId: 'hesap-1',
}

test('DOM-FIN-030 taksit satırı vadesi gelmemiş kısmi ödemeyi ayrı gösterir, gecikmişi korur', () => {
  const partial = { ...invoice, dueDate: '2026-12-01T09:00:00.000Z', paidCents: 1000 }
  assert.equal(invoiceRow(row(partial), '2026-09-10').status, PARTIAL_STATUS)
  const late = { ...invoice, dueDate: '2026-08-01T09:00:00.000Z', paidCents: 1000 }
  assert.equal(invoiceRow(row(late), '2026-09-10').status, 'Gecikmiş')
  assert.equal(invoiceRow(row(late), '2026-09-10').paidCents, 1000)
})

test('DOM-FIN-030 taksit satırı öğrenci bilgisini bağlı alandan alır, kapsam dışında tire yazar', () => {
  const joined = { studentName: 'Deniz Yılmaz', studentNumber: '101', className: '9-A' }
  const named = invoiceRow(row(invoice, joined), '2026-09-10')
  assert.equal(named.studentName, 'Deniz Yılmaz')
  assert.equal(named.version, 3)
  assert.equal(invoiceRow(row(invoice), '2026-09-10').studentName, '—')
})

test('DOM-FIN-030 durum anahtarı yalnız core anahtarlarını kabul eder', () => {
  assert.equal(isInvoiceStatusKey('gecikmis'), true)
  assert.equal(isInvoiceStatusKey('Gecikmiş'), false)
  assert.equal(isInvoiceStatusKey(undefined), false)
})

test('DOM-FIN-032 gövde tutarı kuruşa çevirir, geçmiş günü ve banka hesabını taşır', () => {
  assert.deepEqual(recordPaymentBody(target, values, '2026-09-11'), {
    studentId: 's1',
    invoiceId: 'inv-1',
    amountCents: 123456,
    method: 'Banka havalesi',
    reference: 'DEK-1',
    bankAccountId: 'hesap-1',
    paidDate: '2026-09-10',
  })
})

test('DOM-FIN-032 bugün için gün gönderilmez, nakitte referans ve hesap yoktur', () => {
  assert.deepEqual(recordPaymentBody(target, { ...values, method: 'Nakit' }, '2026-09-10'), {
    studentId: 's1',
    invoiceId: 'inv-1',
    amountCents: 123456,
    method: 'Nakit',
  })
})

test('DOM-FIN-032 senette banka hesabı gitmez; seçilmemiş hesap da gönderilmez', () => {
  const note = recordPaymentBody(target, { ...values, method: 'Senet' }, '2026-09-10')
  assert.equal(note?.reference, 'DEK-1')
  assert.equal('bankAccountId' in (note ?? {}), false)
  const noAccount = recordPaymentBody(target, { ...values, bankAccountId: '' }, '2026-09-10')
  assert.equal('bankAccountId' in (noAccount ?? {}), false)
})

test('DOM-FIN-030 geçersiz tutarda gövde kurulmaz', () => {
  assert.equal(recordPaymentBody(target, { ...values, amount: 'on lira' }, '2026-09-10'), null)
  assert.equal(recordPaymentBody(target, { ...values, amount: '0' }, '2026-09-10'), null)
})
