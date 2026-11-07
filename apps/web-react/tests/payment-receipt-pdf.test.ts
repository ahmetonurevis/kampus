import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INSTITUTION_TYPES } from '@kampus/school-core/modules/collection-modules.ts'
import {
  paymentReceiptDocument,
  type ReceiptPayment,
} from '../src/lib/pdf/templates/payment-receipt.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

const OPTIONS = {
  institution: 'Kampüs Dil Akademisi',
  generatedAt: new Date('2026-10-15T09:00:00.000Z'),
}
const PAYMENT: ReceiptPayment = {
  id: 'p1',
  studentName: 'Deniz Yılmaz',
  amountCents: 123_456,
  creditCents: 0,
  method: 'Banka havalesi',
  reference: 'TR-0001',
  bankAccountLabel: null,
  paidAt: '2026-10-10T09:00:00.000Z',
  receiptYear: 2026,
  receiptNumber: 7,
  reversedAt: null,
  allocations: [{ invoiceId: 'i1', amountCents: 123_456 }],
}

test('ADR 0008, DOM-KAY-012: dil okulunda dekont ödeyen kişiyi "Kursiyer" diye yazar; okulda "Öğrenci"', () => {
  for (const options of [OPTIONS, { ...OPTIONS, institutionType: 'school' as const }]) {
    const school = allTexts(paymentReceiptDocument(measurer, PAYMENT, options))
    assert.ok(school.includes('Öğrenci'))
    assert.equal(school.includes('Kursiyer'), false)
  }
  for (const institutionType of INSTITUTION_TYPES.filter((type) => type !== 'school')) {
    const all = allTexts(paymentReceiptDocument(measurer, PAYMENT, { ...OPTIONS, institutionType }))
    assert.ok(all.includes('Kursiyer'), institutionType)
    assert.ok(all.includes('Deniz Yılmaz'), institutionType)
    assert.equal(all.includes('Öğrenci'), false, institutionType)
  }
})
