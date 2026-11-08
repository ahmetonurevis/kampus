import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FinanceDayReport } from '@kampus/react-shared/use-finance-day-closings.ts'
import { financeDaySummary } from '@kampus/school-core/lib/finance-day-closings.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import { INSTITUTION_TYPES } from '@kampus/school-core/modules/collection-modules.ts'
import {
  cashDifferenceLabel,
  dayClosingFilename,
  financeDayClosingDocument,
} from '../src/lib/pdf/templates/finance-day-closing.ts'
import { allTexts, measurer, texts, type Page } from './support/pdf-measurer.ts'

const OPTIONS = {
  institution: 'Akademi Özel Okulları',
  generatedAt: new Date('2026-10-06T15:00:00.000Z'),
}
const DAY = '2026-10-06'
const line = (index: number, overrides: Partial<FinanceDayReport['collected'][number]> = {}) => ({
  paymentId: `p${String(index)}`,
  receiptYear: 2026,
  receiptNumber: index,
  studentName: 'Deniz Yılmaz',
  amountCents: 30_000,
  method: 'Nakit' as const,
  reference: null,
  bankAccountLabel: null,
  paidAt: `${DAY}T09:00:00.000Z`,
  reversedAt: null,
  reversalReason: null,
  ...overrides,
})
const summaryOf = (count: number) =>
  financeDaySummary(
    Array.from({ length: count }, (_, index) => line(index)),
    DAY,
  )
const refund = (index: number) => ({
  withdrawalId: `w${String(index)}`,
  studentName: 'Ece Yılmaz',
  amountCents: 12_500,
  paidDate: DAY,
  bankAccountLabel: 'Örnek Bankası · 7890',
})
const supplierLine = (index: number) => ({
  paymentId: `s${String(index)}`,
  supplierName: 'Alfa Bilişim A.Ş.',
  invoiceNumber: `ABC${String(index)}`,
  amountCents: 8_000,
  paidDate: DAY,
})
const closing = (overrides: Partial<NonNullable<FinanceDayReport['closing']>> = {}) => ({
  id: 'k1',
  closingDate: DAY,
  summary: summaryOf(1),
  cash: {
    openingCents: 5_000,
    countedCents: 34_000,
    expectedCents: 35_000,
    differenceCents: -1_000,
  },
  note: 'Bozuk para eksik çıktı',
  closedAt: `${DAY}T14:00:00.000Z`,
  closedByName: 'Merve Ön Büro',
  reopenedAt: null,
  reopenedByName: null,
  reopenReason: null,
  version: 1,
  ...overrides,
})
const report = (overrides: Partial<FinanceDayReport> = {}): FinanceDayReport => ({
  closingDate: DAY,
  status: 'open',
  summary: summaryOf(1),
  reportStamp: '1:0:0:0:30000',
  cashNetCents: 30_000,
  cashCountRequired: true,
  suggestedOpeningCents: null,
  collected: [line(1)],
  reversed: [],
  refunds: [],
  supplierPayments: [],
  closing: null,
  history: [],
  ...overrides,
})

test('IST-113: açık gün rozetle ve kesinleşmedi notuyla yazılır, kasa bölümü yoktur', () => {
  const all = allTexts(financeDayClosingDocument(measurer, report(), OPTIONS))
  for (const text of [
    'GÜN SONU RAPORU',
    'AÇIK GÜN',
    'Ödeme yöntemine göre',
    'Deniz Yılmaz',
    'Nakit',
    money(30_000),
  ])
    assert.ok(all.includes(text), text)
  assert.ok(all.some((text) => text.includes('kesinleşmemiştir')))
  assert.ok(!all.includes('Kasa sayımı'))
})

test('DOM-FIN-036: kapalı gün kapatanı, kasa sayımını, farkı ve açıklamayı yazar', () => {
  const all = allTexts(
    financeDayClosingDocument(measurer, report({ status: 'closed', closing: closing() }), OPTIONS),
  )
  for (const text of [
    'KAPATILDI',
    'Kasa sayımı',
    'Merve Ön Büro',
    money(35_000),
    money(34_000),
    `${money(1_000)} eksik`,
    'Bozuk para eksik çıktı',
  ])
    assert.ok(all.includes(text), text)
})

test('DOM-FIN-036: iptal satırı gerekçeyi, önceki kapanış yeniden açma gerekçesini yazar', () => {
  const all = allTexts(
    financeDayClosingDocument(
      measurer,
      report({
        reversed: [line(2, { reversalReason: 'Yanlış öğrenci' })],
        history: [
          closing({
            reopenedAt: `${DAY}T15:00:00.000Z`,
            reopenedByName: 'Yönetici Ada',
            reopenReason: 'Sayım yanlış',
          }),
        ],
      }),
      OPTIONS,
    ),
  ).join(' ')
  for (const text of ['Yanlış öğrenci', 'Önceki kapanışlar', 'Sayım yanlış', 'Yönetici Ada'])
    assert.ok(all.includes(text), text)
})

test('M-13, DOM-FIN-036: iade ödemesi özet ve yöntem tablosunda ayrı sütun, satırda kurum hesabıyla yazılır', () => {
  const summary = financeDaySummary([line(1, { method: 'Banka havalesi' })], DAY, [
    { amountCents: 12_500, paidDate: DAY },
  ])
  const all = allTexts(
    financeDayClosingDocument(
      measurer,
      report({ summary, collected: [line(1)], refunds: [refund(1)] }),
      OPTIONS,
    ),
  )
  for (const text of [
    'İADE ÖDEMESİ',
    'İade ödemeleri',
    'Ece Yılmaz',
    'Örnek Bankası · 7890',
    money(12_500),
    money(30_000 - 12_500),
    '1/0/1/0',
  ])
    assert.ok(all.includes(text), text)
  // İade ödenmeyen günde bölüm yoktur; tutar özette sıfır görünür.
  const empty = allTexts(financeDayClosingDocument(measurer, report(), OPTIONS))
  assert.ok(empty.includes('İADE ÖDEMESİ'))
  assert.equal(empty.includes('İade ödemeleri'), false)
})

test('K-166, DOM-FIN-036: nakit tedarikçi ödemesi özette ve nakit satırında ayrı sütun, satırda tedarikçi ve faturayla yazılır', () => {
  const summary = financeDaySummary(
    [line(1)],
    DAY,
    [],
    [{ amountCents: 8_000, paidDate: DAY, method: 'cash', cancelledAt: null }],
  )
  const all = allTexts(
    financeDayClosingDocument(
      measurer,
      report({ summary, supplierPayments: [supplierLine(1)] }),
      OPTIONS,
    ),
  )
  for (const text of [
    'TEDARİKÇİ ÖDEMESİ',
    'Tedarikçi',
    'Tedarikçi ödemeleri (nakit)',
    'Alfa Bilişim A.Ş.',
    'ABC1',
    money(8_000),
    money(30_000 - 8_000),
    '1/0/0/1',
  ])
    assert.ok(all.includes(text), text)
  // Ödemesiz günde bölüm yoktur; tutar özette sıfır görünür.
  const empty = allTexts(financeDayClosingDocument(measurer, report(), OPTIONS))
  assert.ok(empty.includes('TEDARİKÇİ ÖDEMESİ'))
  assert.equal(empty.includes('Tedarikçi ödemeleri (nakit)'), false)
})

test('K-191: tedarikçi satırı gelmeyen rolde PDF yalnız adedi yazar, tedarikçi adı yoktur', () => {
  const summary = financeDaySummary(
    [line(1)],
    DAY,
    [],
    [
      { amountCents: 8_000, paidDate: DAY, method: 'cash', cancelledAt: null },
      { amountCents: 2_000, paidDate: DAY, method: 'cash', cancelledAt: null },
    ],
  )
  const all = allTexts(
    financeDayClosingDocument(measurer, report({ summary, supplierPayments: null }), OPTIONS),
  ).join(' ')
  assert.ok(all.includes('Tedarikçi ödemeleri (nakit)'))
  assert.ok(all.includes('2 nakit tedarikçi ödemesi var'))
  assert.equal(all.includes('Alfa'), false)
})

test('DOM-FIN-032: nakit sayılmayan kapanış bunu açıkça yazar; boş gün bildirilir', () => {
  const all = allTexts(
    financeDayClosingDocument(
      measurer,
      report({ collected: [], status: 'closed', closing: closing({ cash: null, note: null }) }),
      OPTIONS,
    ),
  ).join(' ')
  for (const text of ['kasa sayılmadı', 'Bu gün tahsilat yok.', 'Bu gün iptal yok.'])
    assert.ok(all.includes(text), text)
})

test('IST-113: uzun gün sayfalanır; her sayfada belge numarası vardır', () => {
  const lines = Array.from({ length: 90 }, (_, index) => line(index))
  const document = financeDayClosingDocument(measurer, report({ collected: lines }), OPTIONS)
  assert.ok(document.pages.length > 1)
  document.pages.forEach((page, index) => {
    assert.ok(texts(page).includes(`${String(index + 1)} / ${String(document.pages.length)}`))
  })
})

test('DOM-FIN-036: fark etiketi ve dosya adı', () => {
  assert.equal(cashDifferenceLabel(0), 'Fark yok')
  assert.equal(cashDifferenceLabel(500), `${money(500)} fazla`)
  assert.equal(cashDifferenceLabel(-500), `${money(500)} eksik`)
  assert.equal(dayClosingFilename(DAY), 'gun-sonu-2026-10-06.pdf')
})

test('ADR 0008, DOM-KAY-012: dil okulunda gün sonu tablolarının sütunu "Kursiyer"; okulda "Öğrenci"', () => {
  const day = report({
    reversed: [line(2, { reversalReason: 'Yanlış kayıt' })],
    refunds: [refund(1)],
  })
  for (const options of [OPTIONS, { ...OPTIONS, institutionType: 'school' as const }]) {
    const school = allTexts(financeDayClosingDocument(measurer, day, options))
    assert.equal(school.filter((text) => text === 'Öğrenci').length, 3)
    assert.equal(school.includes('Kursiyer'), false)
  }
  for (const institutionType of INSTITUTION_TYPES.filter((type) => type !== 'school')) {
    const all = allTexts(financeDayClosingDocument(measurer, day, { ...OPTIONS, institutionType }))
    assert.equal(all.filter((text) => text === 'Kursiyer').length, 3, institutionType)
    assert.equal(all.includes('Öğrenci'), false, institutionType)
  }
})

/** Sayfa gövdesinin metinleri: üst bilgi (y ≤ 41) ve alt bilgi (y ≥ 276) dışı. */
const bodyTexts = (page: Page) =>
  page.ops.flatMap((op) => (op.kind === 'text' && op.y > 41 && op.y < 276 ? [op.text] : []))
const SIGNATURE = ['Kapatan', 'Yönetici']

test('ON-322, IST-113: tek tahsilatlı açık günde imza alanı son bölümle birlikte ikinci sayfadadır', () => {
  const document = financeDayClosingDocument(measurer, report(), OPTIONS)
  assert.equal(document.pages.length, 2)
  const [first, second] = document.pages.map(bodyTexts)
  assert.ok(first?.includes('Deniz Yılmaz'))
  assert.deepEqual(second, ['İptaller', 'Bu gün iptal yok.', ...SIGNATURE])
})

test('ON-322, IST-113: tahsilatsız açık gün tek sayfadır, imza alanı aynı sayfadadır', () => {
  const document = financeDayClosingDocument(measurer, report({ collected: [] }), OPTIONS)
  assert.equal(document.pages.length, 1)
  assert.deepEqual(document.pages[0] && bodyTexts(document.pages[0]).slice(-2), SIGNATURE)
})

test('ON-322, IST-113, DOM-FIN-036: imza alanı hiçbir gün sonunda tek başına sayfaya düşmez', () => {
  const history = closing({
    reopenedAt: `${DAY}T15:00:00.000Z`,
    reopenedByName: 'Yönetici Ada',
    reopenReason: 'Sayım yanlış',
  })
  const variants: Partial<FinanceDayReport>[] = [
    {},
    { status: 'closed', closing: closing() },
    { status: 'closed', closing: closing({ cash: null, note: null }) },
    { history: [history] },
    { history: [history, history, history] },
  ]
  for (const variant of variants)
    for (let collected = 0; collected <= 45; collected += 1)
      for (const reversed of [0, 1, 2, 6])
        for (const [refunds, suppliers] of [
          [0, 0],
          [1, 0],
          [3, 0],
          [0, 1],
          [1, 3],
        ] as const) {
          const day = report({
            ...variant,
            collected: Array.from({ length: collected }, (_, index) => line(index)),
            reversed: Array.from({ length: reversed }, (_, index) =>
              line(100 + index, { reversalReason: 'Yanlış kayıt' }),
            ),
            refunds: Array.from({ length: refunds }, (_, index) => refund(index)),
            supplierPayments: Array.from({ length: suppliers }, (_, index) => supplierLine(index)),
          })
          const document = financeDayClosingDocument(measurer, day, OPTIONS)
          const last = bodyTexts(document.pages.at(-1)!)
          const name = `${JSON.stringify(Object.keys(variant))} ${String(collected)}/${String(reversed)}/${String(refunds)}/${String(suppliers)}`
          assert.deepEqual(last.slice(-2), SIGNATURE, name)
          assert.ok(last.length > SIGNATURE.length, name)
          // Belge içeriği kaybolmaz: her tahsilat, iptal ve iade satırı yazılır.
          const all = allTexts(document)
          assert.equal(
            all.filter((text) => text === 'Deniz Yılmaz').length,
            collected + reversed,
            name,
          )
          assert.equal(all.filter((text) => text === 'Ece Yılmaz').length, refunds, name)
          assert.equal(all.filter((text) => text === 'Alfa Bilişim A.Ş.').length, suppliers, name)
        }
})
