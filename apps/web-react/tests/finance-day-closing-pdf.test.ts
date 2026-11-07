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
import { allTexts, measurer, texts } from './support/pdf-measurer.ts'

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
  reportStamp: '1:0:30000',
  cashNetCents: 30_000,
  cashCountRequired: true,
  suggestedOpeningCents: null,
  collected: [line(1)],
  reversed: [],
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
  const day = report({ reversed: [line(2, { reversalReason: 'Yanlış kayıt' })] })
  for (const options of [OPTIONS, { ...OPTIONS, institutionType: 'school' as const }]) {
    const school = allTexts(financeDayClosingDocument(measurer, day, options))
    assert.equal(school.filter((text) => text === 'Öğrenci').length, 2)
    assert.equal(school.includes('Kursiyer'), false)
  }
  for (const institutionType of INSTITUTION_TYPES.filter((type) => type !== 'school')) {
    const all = allTexts(financeDayClosingDocument(measurer, day, { ...OPTIONS, institutionType }))
    assert.equal(all.filter((text) => text === 'Kursiyer').length, 2, institutionType)
    assert.equal(all.includes('Öğrenci'), false, institutionType)
  }
})
