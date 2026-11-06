import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  refundStatementDocument,
  type RefundWithdrawal,
} from '../src/lib/pdf/templates/refund-statement.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

const WITHDRAWAL: RefundWithdrawal = {
  id: 'w1',
  studentName: 'Deniz Yılmaz',
  withdrawalDate: '2026-10-01',
  reason: 'transfer',
  targetSchool: null,
  refundCents: 0,
  debtCents: 0,
  refundDueDate: '2026-11-01',
  refundPaidDate: null,
  maskedIban: null,
  refundAccountHolder: null,
  breakdown: {
    baseCents: 100_000,
    deductionBasisPoints: 1_000,
    deductionCents: 10_000,
    attendedUnits: 1,
    totalUnits: 10,
    usageCents: 10_000,
    entitledCents: 0,
    paidCents: 0,
    creditCents: 0,
    extras: [],
  },
}
const OPTIONS = { institution: 'Akademi', generatedAt: new Date('2026-10-02T09:00:00.000Z') }

test('DOM-FIN-025: burslu istisnası iade dökümünde yazılır, bursuz ayrılışta yazılmaz', () => {
  const exempt = {
    ...WITHDRAWAL,
    breakdown: { ...WITHDRAWAL.breakdown, scholarshipExempt: true },
  }
  assert.ok(
    allTexts(refundStatementDocument(measurer, exempt, OPTIONS)).includes('Burslu istisnası'),
  )
  assert.equal(
    allTexts(refundStatementDocument(measurer, WITHDRAWAL, OPTIONS)).includes('Burslu istisnası'),
    false,
  )
})

const CONTRACT_LINE = {
  contractId: 'c1',
  title: 'Öğrenim sözleşmesi',
  attendedUnits: 18,
  totalUnits: 180,
  scholarshipExempt: false,
  baseCents: 200_000,
  deductionCents: 20_000,
  usageCents: 50_000,
  entitledCents: 70_000,
  paidCents: 200_000,
  extraBalanceCents: 0,
  balanceCents: 130_000,
}

test('DOM-FIN-040, K-06: birden çok sözleşmede her sözleşme ayrı bölümde, toplam sonda yazılır', () => {
  const texts = allTexts(
    refundStatementDocument(
      measurer,
      {
        ...WITHDRAWAL,
        refundCents: 130_000,
        breakdown: {
          ...WITHDRAWAL.breakdown,
          contracts: [
            CONTRACT_LINE,
            {
              ...CONTRACT_LINE,
              contractId: 'c2',
              title: 'Dil kursu paket sözleşmesi: 40 saat',
              packageSaleId: 's1',
              attendedUnits: 10,
              totalUnits: 40,
              returnedHours: 30,
              balanceCents: -5_000,
            },
          ],
        },
      },
      OPTIONS,
    ),
  )
  for (const text of [
    'Öğrenim sözleşmesi',
    'Dil kursu paket sözleşmesi: 40 saat',
    'Kullanım (18 / 180)',
    'Kullanım (10 / 40 ders saati, kayıttan)',
    'İade edilen kalan saat',
    'Bu sözleşmeden iade',
    'Bu sözleşmeden borç',
    'Toplam',
  ])
    assert.ok(texts.includes(text), text)
})

test('DOM-FIN-040: tek öğrenim sözleşmesinde belge toplam satırlarıyla kalır', () => {
  const texts = allTexts(
    refundStatementDocument(
      measurer,
      {
        ...WITHDRAWAL,
        breakdown: { ...WITHDRAWAL.breakdown, contracts: [CONTRACT_LINE] },
      },
      OPTIONS,
    ),
  )
  assert.ok(texts.includes('Kullanım (1 / 10)'))
  assert.equal(texts.includes('Öğrenim sözleşmesi'), false)
  assert.equal(texts.includes('Bu sözleşmeden iade'), false)
})
