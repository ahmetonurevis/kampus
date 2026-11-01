import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { documentData } from '@kampus/school-core/lib/document-data.ts'
import {
  paymentReceiptDocument,
  receiptNumberLabel,
  refundStatementDocument,
  type ReceiptPayment,
  type RefundWithdrawal,
} from '../src/lib/pdf/finance-templates.ts'
import { contractDocument } from '../src/lib/pdf/templates.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

const NOW = new Date('2026-10-15T09:00:00.000Z')
const OPTIONS = { institution: 'Akademi Özel Okulları', generatedAt: NOW }
const PAYMENT: ReceiptPayment = {
  id: 'p1',
  studentName: 'Deniz Yılmaz',
  amountCents: 123_456,
  creditCents: 0,
  method: 'Banka havalesi',
  reference: 'TR-0001',
  bankAccountLabel: 'Örnek Bankası · 1326',
  paidAt: '2026-10-10T09:00:00.000Z',
  receiptYear: 2026,
  receiptNumber: 7,
  reversedAt: null,
  allocations: [{ invoiceId: 'i1', amountCents: 123_456 }],
}

test('DOM-FIN-050: dekont yıl içi numara, referans ve tutar taşır', () => {
  const all = allTexts(paymentReceiptDocument(measurer, PAYMENT, OPTIONS))
  assert.equal(receiptNumberLabel(PAYMENT), '2026-7')
  assert.ok(all.includes('2026-7'))
  assert.ok(all.includes('TR-0001'))
  assert.ok(all.includes('Örnek Bankası · 1326'))
  assert.ok(all.includes('Geçerli'))
  assert.ok(all.some((text) => text.includes('1.234,56')))
  assert.equal(all.includes('İPTAL EDİLDİ'), false)
})

test('DOM-FIN-033: iptal edilen tahsilatın dekontu ibareyle üretilir, numarası değişmez', () => {
  const all = allTexts(
    paymentReceiptDocument(
      measurer,
      { ...PAYMENT, reversedAt: '2026-10-12T09:00:00.000Z' },
      OPTIONS,
    ),
  )
  assert.ok(all.includes('İPTAL EDİLDİ'))
  assert.ok(all.includes('İptal edildi'))
  assert.ok(all.includes('2026-7'))
})

test('DOM-FIN-030: dağıtılmayan tutar dekontta iade alacağı olarak yazılır', () => {
  const all = allTexts(
    paymentReceiptDocument(measurer, { ...PAYMENT, creditCents: 5_000 }, OPTIONS),
  )
  assert.ok(all.some((text) => text.includes('iade alacağı')))
})

const WITHDRAWAL: RefundWithdrawal = {
  id: 'abcdef12-0000-4000-8000-000000000000',
  studentName: 'Deniz Yılmaz',
  withdrawalDate: '2026-10-01',
  reason: 'relocation',
  targetSchool: 'Örnek Lise',
  refundCents: 3_000_000,
  debtCents: 0,
  refundDueDate: '2026-11-01',
  refundPaidDate: null,
  maskedIban: null,
  refundAccountHolder: null,
  breakdown: {
    baseCents: 10_000_000,
    deductionBasisPoints: 1_000,
    deductionCents: 1_000_000,
    attendedUnits: 18,
    totalUnits: 180,
    usageCents: 1_000_000,
    entitledCents: 2_000_000,
    paidCents: 5_000_000,
    creditCents: 0,
    extras: [],
  },
}

test('IST-110: iade kırılımı kesinti, kullanım, hak edilen ve iadeyi yazar', () => {
  const all = allTexts(refundStatementDocument(measurer, WITHDRAWAL, OPTIONS))
  for (const expected of [
    'İADE HESAP KIRILIMI',
    'İADE TUTARI',
    'Kesinti (%10)',
    'Kullanım (18 / 180)',
    'Hak edilen',
    'Taşınma',
    'Örnek Lise',
    'Ödenmedi',
  ])
    assert.ok(all.includes(expected), expected)
})

test('IST-110: iade yoksa borç öne çıkar; ödenen iadede tarih ve maskeli IBAN görünür', () => {
  const debt = allTexts(
    refundStatementDocument(measurer, { ...WITHDRAWAL, refundCents: 0, debtCents: 500 }, OPTIONS),
  )
  assert.ok(debt.includes('KALAN BORÇ'))
  const paid = allTexts(
    refundStatementDocument(
      measurer,
      {
        ...WITHDRAWAL,
        refundPaidDate: '2026-10-20',
        maskedIban: 'TR** **** 1326',
        refundAccountHolder: 'Ayşe Yılmaz',
      },
      OPTIONS,
    ),
  )
  assert.ok(paid.includes('TR** **** 1326'))
  assert.ok(paid.includes('Ayşe Yılmaz'))
  assert.equal(paid.includes('Ödenmedi'), false)
})

test('DOM-FIN-010: tarifeli sözleşme brüt, indirim, net, ek hizmet ve ödeyiciyi gösterir', () => {
  const seed = createSeed(NOW)
  const contract = seed.contracts[0]!
  Object.assign(contract, {
    title: 'Dil kursu eğitim sözleşmesi',
    tariffId: 't1',
    tariffVersion: 3,
    grossCents: 20_000_000,
    netCents: 18_000_000,
    discounts: [{ kind: 'sibling', amountCents: 2_000_000 }],
    extras: [{ kind: 'meal', amountCents: 1_000_000 }],
    payer: 'student',
  })
  const all = allTexts(
    contractDocument(measurer, documentData(seed, 'contract', contract.id), OPTIONS),
  )
  for (const expected of [
    'Dil kursu eğitim sözleşmesi',
    'İlan ücreti',
    'Kardeş indirimi',
    'Net öğrenim ücreti',
    'Yemek',
    'Tarife sürümü',
    'Ödeyici',
    'Öğrenci',
  ])
    assert.ok(all.includes(expected), expected)
  assert.ok(all.some((text) => text.includes('180.000,00')))
})

test('DOM-FIN-010: tarifesiz eski sözleşmede ücret dökümü yazılmaz', () => {
  const seed = createSeed(NOW)
  const contract = seed.contracts[0]!
  const all = allTexts(
    contractDocument(measurer, documentData(seed, 'contract', contract.id), OPTIONS),
  )
  assert.equal(all.includes('İlan ücreti'), false)
  assert.ok(all.includes(contract.title))
})
