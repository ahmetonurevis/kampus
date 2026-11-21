import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  PayrollPayslip,
  PayrollPayslips,
} from '@kampus/react-shared/use-finance-payroll-runs.ts'
import {
  payrollPayslipDocument,
  payrollPayslipFilename,
  payrollPayslipsDocument,
  payslipDeductionBlocks,
  payslipEarningBlocks,
} from '../src/lib/pdf/templates/finance-payroll-payslip.ts'
import { allTexts, measurer, texts } from './support/pdf-measurer.ts'

// Ücret hesap pusulası (DOM-FIN-119; ON-201, K-406…K-408). Tutarlar 2026 platform setiyle asgari
// ücretli personelin kayıtlı hesabıdır (`apps/api/test/finance-payroll-payslips.test.ts`).

const OPTIONS = {
  institution: 'Akademi Özel Okulları',
  generatedAt: new Date('2026-02-03T09:00:00.000Z'),
}

const slip = (overrides: Partial<PayrollPayslip> = {}): PayrollPayslip => ({
  membershipId: 'mem-deniz-0001',
  name: 'Deniz Yılmaz',
  role: 'onburo',
  entryDate: null,
  exitDate: null,
  primDays: 30,
  missingDays: 0,
  earnings: [
    {
      kind: 'wage',
      code: 'monthly_gross',
      amountCents: 3_303_000,
      hours: null,
      rateCents: null,
      sgk: true,
      taxable: true,
    },
  ],
  grossCents: 3_303_000,
  sgkBaseCents: 3_303_000,
  sgkEmployeeCents: 462_420,
  unemploymentEmployeeCents: 33_030,
  incomeTaxBaseCents: 2_807_550,
  cumulativeIncomeTaxBaseBeforeCents: 0,
  cumulativeIncomeTaxBaseCents: 2_807_550,
  incomeTaxCents: 421_133,
  incomeTaxExemptionCents: 421_133,
  incomeTaxPayableCents: 0,
  stampTaxBaseCents: 3_303_000,
  stampTaxCents: 25_070,
  stampTaxExemptionCents: 25_070,
  stampTaxPayableCents: 0,
  netCents: 2_807_550,
  netAdjustmentCents: 0,
  deductions: [{ kind: 'garnishment', amountCents: 701_887 }],
  deductionCents: 701_887,
  payableCents: 2_105_663,
  ...overrides,
})

const data = (payslips: PayrollPayslip[], locked = true): PayrollPayslips => ({
  month: '2026-01',
  runId: 'a1b2c3d4-0000-4000-8000-000000000001',
  revision: 2,
  calculatedAt: '2026-02-01T10:00:00.000Z',
  locked,
  institutionName: 'Akademi Özel Okulları',
  payslips,
})

test('DOM-FIN-119, K-407: pusula kurum, personel, dönem, gün, brüt, yasal kesinti, matrah, kesinti ve ödenecek neti taşır; işveren maliyeti yok', () => {
  const document = payrollPayslipsDocument(measurer, data([slip()]), OPTIONS)
  assert.equal(document.pages.length, 1)
  const text = allTexts(document).join(' ')
  for (const part of [
    'Ücret hesap pusulası',
    'AKADEMİ ÖZEL OKULLARI',
    'Deniz Yılmaz',
    'Ocak 2026',
    'ÇALIŞMA / PRİM GÜNÜ',
    'Ana ücret · Aylık brüt',
    '33.030,00 ₺',
    'SGK işçi payı',
    '−4.624,20 ₺',
    'İşsizlik sigortası işçi payı',
    'Kümülatif GV matrahı (bu ay dahil)',
    'Asgari ücret GV istisnası',
    'Asgari ücret DV istisnası',
    'İcra kesintisi',
    '−7.018,87 ₺',
    'ÖDENECEK NET',
    '21.056,63 ₺',
    'mali müşavir doğrulaması',
    'Teslim alan personel',
    'Onaylı',
  ])
    assert.ok(text.includes(part), part)
  for (const hidden of ['İşveren maliyeti', 'işveren payı', 'Sağlık raporu', 'Uyarı'])
    assert.ok(!text.includes(hidden), hidden)
  assert.ok(!text.includes('Dönem onaylanmadı'))
})

test('DOM-FIN-119, K-406: onaysız ayın pusulası "dönem onaylanmadı" ibaresi ve hesap revizyonunu taşır', () => {
  const text = allTexts(payrollPayslipsDocument(measurer, data([slip()], false), OPTIONS)).join(' ')
  assert.ok(text.includes('Dönem onaylanmadı'))
  assert.ok(text.includes('Onaylanmadı'))
  assert.ok(text.includes('2. revizyon'))
})

test('DOM-FIN-119: toplu belgede her personel kendi sayfasında başlar; sayfa no pusulaya aittir', () => {
  const other = slip({ membershipId: 'mem-selin-0002', name: 'Selin Kaya', role: 'ogretmen' })
  const document = payrollPayslipsDocument(measurer, data([slip(), other]), OPTIONS)
  assert.equal(document.pages.length, 2)
  const [first, second] = document.pages
  assert.ok(texts(first!).includes('Deniz Yılmaz'))
  assert.ok(!texts(first!).includes('Selin Kaya'))
  assert.ok(texts(second!).includes('Selin Kaya'))
  assert.ok(texts(second!).includes('Ücret hesap pusulası'))
  assert.ok(texts(second!).includes('1 / 1'))
  assert.equal(document.metadata.title, 'Ücret hesap pusulası · Ocak 2026')
  assert.equal(payrollPayslipFilename(data([slip(), other])), 'bordro-pusulalari-2026-01.pdf')
  assert.equal(payrollPayslipFilename(data([other])), 'bordro-pusulasi-2026-01-selin-kaya.pdf')
  assert.equal(
    payrollPayslipFilename(data([slip({ name: 'Işıl Çağrı Öztürk' })])),
    'bordro-pusulasi-2026-01-isil-cagri-ozturk.pdf',
  )
})

test('DOM-FIN-119: ek ders, yan hak, düzeltme, net düzeltme, giriş/çıkış ve birden çok kesinti satırı', () => {
  const rich = slip({
    entryDate: '2026-01-12',
    primDays: 20,
    missingDays: 0,
    earnings: [
      ...slip().earnings,
      {
        kind: 'lesson',
        code: 'extra',
        amountCents: 250_000,
        hours: 10,
        rateCents: 25_000,
        sgk: true,
        taxable: true,
      },
      {
        kind: 'benefit',
        code: 'meal',
        amountCents: 100_000,
        hours: null,
        rateCents: null,
        sgk: true,
        taxable: false,
      },
      {
        kind: 'adjustment',
        code: 'wage',
        amountCents: -5_000,
        hours: null,
        rateCents: null,
        sgk: true,
        taxable: true,
      },
    ],
    netAdjustmentCents: -10_000,
    deductions: [
      { kind: 'advance', amountCents: 100_000 },
      { kind: 'garnishment', amountCents: 500_000 },
      { kind: 'garnishment', amountCents: 200_000 },
      { kind: 'pension', amountCents: 99_090 },
    ],
  })
  const left = payslipEarningBlocks(rich)
  assert.deepEqual(
    left[0]?.lines.map((line) => line.value),
    ['33.030,00 ₺', '2.500,00 ₺', '1.000,00 ₺', '−50,00 ₺', '33.030,00 ₺'],
  )
  assert.ok(left[0]?.lines[1]?.label.includes('10 saat'))
  assert.ok(left[0]?.lines[2]?.label.includes('vergisiz'))
  const right = payslipDeductionBlocks(rich)
  assert.deepEqual(
    right[1]?.lines.map((line) => line.label),
    [
      'Net ücret',
      'Net düzeltme',
      'Avans taksiti',
      'İcra kesintisi 1',
      'İcra kesintisi 2',
      'BES katkısı',
      'Kesinti toplamı',
    ],
  )
  assert.equal(right[1]?.lines[1]?.value, '−100,00 ₺')
  const document = payrollPayslipDocument(measurer, data([rich]), rich, OPTIONS)
  assert.equal(document.pages.length, 1)
  assert.ok(allTexts(document).join(' ').includes('Giriş 12 Oca 2026'))
})

test('DOM-FIN-119: kesintisi olmayan pusulada boş kesinti satırı yazılır, toplam satırı yazılmaz', () => {
  const plain = slip({ deductions: [], deductionCents: 0, payableCents: 2_807_550 })
  const right = payslipDeductionBlocks(plain)
  assert.deepEqual(
    right[1]?.lines.map((line) => line.label),
    ['Net ücret', 'Avans, icra ve BES kesintisi yok'],
  )
})
