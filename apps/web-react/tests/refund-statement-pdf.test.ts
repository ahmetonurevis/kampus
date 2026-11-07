import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INSTITUTION_TYPES } from '@kampus/school-core/modules/collection-modules.ts'
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
  payer: 'guardian' as const,
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

test('K-12: iadeyi alacak ödeyici belgede yazılır, gerekçe yazılmaz', () => {
  const texts = allTexts(
    refundStatementDocument(
      measurer,
      {
        ...WITHDRAWAL,
        breakdown: {
          ...WITHDRAWAL.breakdown,
          contracts: [CONTRACT_LINE, { ...CONTRACT_LINE, contractId: 'c2', payer: 'student' }],
          payerDecision: { payer: 'student', reason: 'Gizli gerekçe' } as { payer: 'student' },
        },
      },
      OPTIONS,
    ),
  )
  assert.ok(texts.includes('İadeyi alacak ödeyici'))
  assert.ok(texts.includes('Öğrenci veya kursiyer'))
  assert.equal(texts.includes('Gizli gerekçe'), false)
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

test('ADR 0008, DOM-KAY-012: dil okulunda iade dökümü ayrılanı "Kursiyer" diye yazar; okulda "Öğrenci"', () => {
  for (const options of [OPTIONS, { ...OPTIONS, institutionType: 'school' as const }]) {
    const school = allTexts(refundStatementDocument(measurer, WITHDRAWAL, options))
    assert.ok(school.includes('Öğrenci'))
    assert.equal(school.includes('Kursiyer'), false)
  }
  for (const institutionType of INSTITUTION_TYPES.filter((type) => type !== 'school')) {
    const all = allTexts(
      refundStatementDocument(measurer, WITHDRAWAL, { ...OPTIONS, institutionType }),
    )
    assert.ok(all.includes('Kursiyer'), institutionType)
    assert.ok(all.includes('Deniz Yılmaz'), institutionType)
    assert.equal(all.includes('Öğrenci'), false, institutionType)
  }
})

test('ON-322, DOM-KAY-012: okul dışı kurumda iade dökümü "Gittiği kurum" ve "Ödenen kurs ücreti" yazar', () => {
  const contracts = {
    ...WITHDRAWAL,
    breakdown: {
      ...WITHDRAWAL.breakdown,
      contracts: [CONTRACT_LINE, { ...CONTRACT_LINE, contractId: 'c2' }],
    },
  }
  // Tek sözleşmeli "Hesap" bölümü ve çok sözleşmeli bölümler aynı terimi kullanır.
  for (const withdrawal of [WITHDRAWAL, contracts]) {
    for (const options of [OPTIONS, { ...OPTIONS, institutionType: 'school' as const }]) {
      const school = allTexts(refundStatementDocument(measurer, withdrawal, options))
      assert.ok(school.includes('Gittiği okul'))
      assert.ok(school.includes('Ödenen öğrenim ücreti'))
      assert.equal(school.includes('Gittiği kurum'), false)
      assert.equal(school.includes('Ödenen kurs ücreti'), false)
    }
    for (const institutionType of INSTITUTION_TYPES.filter((type) => type !== 'school')) {
      const all = allTexts(
        refundStatementDocument(measurer, withdrawal, { ...OPTIONS, institutionType }),
      )
      assert.ok(all.includes('Gittiği kurum'), institutionType)
      assert.ok(all.includes('Ödenen kurs ücreti'), institutionType)
      assert.equal(all.includes('Gittiği okul'), false, institutionType)
      assert.equal(all.includes('Ödenen öğrenim ücreti'), false, institutionType)
    }
  }
})
