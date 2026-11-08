import assert from 'node:assert/strict'
import { test } from 'node:test'
import { money } from '@kampus/school-core/lib/format.ts'
import { DocumentLayout } from '../src/lib/pdf/layout.ts'
import {
  ALL_BOARD_REPORT_SECTIONS,
  basisPointsLabel,
  boardMonthLabel,
  budgetPeriodLabel,
  NO_BUDGET_PERIOD,
  NO_EXPENSE_DATA,
  NO_EXPENSE_DATA_NOTE,
  writeBoardReportSections,
  type BoardReportSectionData,
  type BoardReportSections,
} from '../src/lib/pdf/templates/finance-board-report-sections.ts'
import {
  boardReportQuery,
  budgetPeriodOptions,
  CUSTOM_RANGE,
  MATCHED_BUDGET_PERIOD,
  WHOLE_YEAR,
} from '../src/pages/finance/finance-board-report.ts'
import { BUDGET_SECTIONS, NO_BUDGET_SECTIONS } from './finance-board-report-fixture.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// Yönetim kurulu raporunun bütçe, maliyet ve tahmin bölümleri (DOM-FIN-064, ON-329).

function render(data: BoardReportSectionData, sections: BoardReportSections) {
  const doc = new DocumentLayout(measurer, {
    label: 'YÖNETİM KURULU RAPORU',
    badge: 'DÖNEM SÜRÜYOR',
    institution: 'Akademi Özel Okulları',
    generatedAt: new Date('2026-10-06T15:00:00.000Z'),
    reference: 'kurul-raporu',
    footerNote: 'Not',
  })
  writeBoardReportSections(doc, data, sections, 'öğrenci')
  return allTexts(doc.finish())
}
const has = (lines: readonly string[], text: string) => lines.some((line) => line.includes(text))

test('DOM-FIN-064 bütçe dönemi seçimi: boş değer rapor dönemine uyan dönemdir (K-113)', () => {
  assert.deepEqual(budgetPeriodOptions(BUDGET_SECTIONS.budgetPeriods), [
    { value: MATCHED_BUDGET_PERIOD, label: 'Otomatik (döneme göre)' },
    { value: '6b0b1e2c-1c35-4c6a-9d77-0f4f1d8a0001', label: '2026–2027 bütçesi (Açık)' },
  ])
  const empty = { from: '', to: '' }
  assert.deepEqual(boardReportQuery(2026, WHOLE_YEAR, empty, MATCHED_BUDGET_PERIOD), {
    year: 2026,
  })
  assert.deepEqual(boardReportQuery(2026, 'donem:t1', empty, 'b1'), {
    year: 2026,
    termId: 't1',
    budgetPeriodId: 'b1',
  })
  assert.deepEqual(
    boardReportQuery(2026, CUSTOM_RANGE, { from: '2026-09-01', to: '2026-09-30' }, 'b1'),
    { year: 2026, from: '2026-09-01', to: '2026-09-30', budgetPeriodId: 'b1' },
  )
  assert.equal(boardReportQuery(2026, CUSTOM_RANGE, empty, 'b1'), null)
})

test('DOM-FIN-064 PDF: bütçe, maliyet ve tahmin bölümleri; gider verisi yok, küçük kampüs gizli', () => {
  const lines = render(BUDGET_SECTIONS, ALL_BOARD_REPORT_SECTIONS)
  for (const text of [
    'Bütçe–gerçekleşen',
    '2026–2027 bütçesi (Açık)',
    'rapor dönemine göre seçildi',
    money(12_000_000),
    money(1_400_000),
    NO_EXPENSE_DATA,
    NO_EXPENSE_DATA_NOTE.slice(0, 20),
    'G-100 Öğrenim geliri',
    money(-600_000),
    '%70',
    `Bütçe kalemine eşlenmemiş gelir: ${money(50_000)}.`,
    'Kampüs ve öğrenci başı maliyet',
    'Kadıköy Kampüsü',
    money(233_333),
    'Gizli (<5)',
    'Gelir ve nakit akışı tahmini',
    '2027–2028 kesin gelir',
    money(9_500_000),
    boardMonthLabel('2026-10'),
    boardMonthLabel('2027-09'),
    money(1_180_000),
  ])
    assert.ok(has(lines, text), text)
  assert.equal(has(lines, NO_BUDGET_PERIOD), false)
})

test('DOM-FIN-064 PDF: bütçe dönemi yoksa bölümler "bütçe dönemi yok" der, tahmin yine yazar', () => {
  const lines = render(NO_BUDGET_SECTIONS, ALL_BOARD_REPORT_SECTIONS)
  assert.equal(lines.filter((line) => line.includes(NO_BUDGET_PERIOD)).length, 2)
  assert.ok(has(lines, 'Gelir ve nakit akışı tahmini'))
})

test('DOM-FIN-064 PDF: yönetici bölümleri tek tek çıkarabilir', () => {
  const lines = render(BUDGET_SECTIONS, { budget: false, costs: true, forecast: false })
  assert.equal(has(lines, 'Bütçe–gerçekleşen'), false)
  assert.equal(has(lines, 'Gelir ve nakit akışı tahmini'), false)
  assert.ok(has(lines, 'Kampüs ve öğrenci başı maliyet'))
  const none = render(BUDGET_SECTIONS, { budget: false, costs: false, forecast: false })
  for (const heading of [
    'Bütçe–gerçekleşen',
    'Kampüs ve öğrenci',
    'Gelir ve nakit',
    NO_BUDGET_PERIOD,
  ])
    assert.equal(has(none, heading), false, heading)
})

test('DOM-FIN-064 PDF: başlamamış bütçe dönemi ve kapalı huni notu', () => {
  const budget = BUDGET_SECTIONS.budget
  assert.ok(budget)
  const lines = render(
    {
      ...BUDGET_SECTIONS,
      budget: { ...budget, asOfDate: null },
      forecast: {
        ...BUDGET_SECTIONS.forecast,
        revenue: {
          ...BUDGET_SECTIONS.forecast.revenue,
          pipelineNetCents: null,
          pipelineStatus: 'crm_disabled',
        },
      },
    },
    ALL_BOARD_REPORT_SECTIONS,
  )
  assert.ok(has(lines, 'Bütçe dönemi henüz başlamadı'))
  assert.ok(has(lines, 'Kayıt modülü kapalı; aday beklentisi tahmine girmedi.'))
})

test('DOM-FIN-064 etiketler: oran on binde birden yüzde, bütçe dönemi seçimi', () => {
  assert.equal(basisPointsLabel(null), '—')
  assert.equal(basisPointsLabel(10_333), '%103,33')
  const period = BUDGET_SECTIONS.budgetPeriod
  assert.ok(period)
  assert.equal(
    budgetPeriodLabel({ ...period, selection: 'chosen' }).includes('rapor dönemine göre'),
    false,
  )
})

test('DOM-FIN-064 PDF: gizli kampüsün sayısı ve tutarları "Gizli" yazar, tamamı gizliyse not düşer (K-116)', () => {
  const costs = BUDGET_SECTIONS.costs
  assert.ok(costs)
  const hiddenRow = {
    studentCount: null,
    accruedCents: null,
    netCollectedCents: null,
    budgetExpenseCents: null,
    accruedPerStudentCents: null,
    budgetExpensePerStudentCents: null,
    suppressed: true,
  }
  const lines = render(
    {
      ...BUDGET_SECTIONS,
      costs: {
        ...costs,
        campuses: costs.campuses.map((row) => ({ ...row, ...hiddenRow })),
      },
    },
    { budget: false, costs: true, forecast: false },
  )
  assert.equal(
    lines.filter((line) => line.startsWith('Gizli')).length,
    10,
    'iki kampüs × beş hücre',
  )
  assert.equal(has(lines, money(1_000_000)), false, 'Kadıköy tahakkuku yazılmaz')
  assert.ok(has(lines, 'tamamen gizlidir'))
  assert.ok(has(lines, money(1_400_000)), 'kurum toplamı yazar')
})
