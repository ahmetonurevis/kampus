import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FinanceBoardReport } from '@kampus/react-shared/use-finance-board-report.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import {
  boardReportFilename,
  boardReportPeriodLabel,
  financeBoardReportDocument,
  rateLabel,
  suppressedLabel,
} from '../src/lib/pdf/templates/finance-board-report.ts'
import {
  boardReportQuery,
  boardYearOptions,
  CUSTOM_RANGE,
  periodOptions,
  WHOLE_YEAR,
} from '../src/pages/finance/finance-board-report.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// Yönetim kurulu raporu ekranı ve PDF şablonu (DOM-FIN-064, ON-251).

const OPTIONS = {
  institution: 'Akademi Özel Okulları',
  generatedAt: new Date('2026-10-06T15:00:00.000Z'),
}
const ZERO = {
  openingCents: 0,
  accruedCents: 0,
  withdrawalAdjustmentCents: 0,
  collectedCents: 0,
  openingImportCents: 0,
  reversedCents: 0,
  refundedCents: 0,
  scholarshipCents: 0,
  discountCents: 0,
  closingCents: 0,
  expectedClosingCents: 0,
  differenceCents: 0,
  openDebtCents: 0,
  creditCents: 0,
}

const report = (overrides: Partial<FinanceBoardReport> = {}): FinanceBoardReport => ({
  period: {
    kind: 'year',
    year: 2026,
    from: '2026-09-01',
    to: '2026-10-06',
    endDate: '2027-08-31',
    complete: false,
    termId: null,
    termName: null,
  },
  today: '2026-10-06',
  institutionType: 'school',
  minGroupSize: 5,
  terms: [],
  finance: {
    totals: { ...ZERO, accruedCents: 5_000_000, collectedCents: 1_200_000 },
    mismatchCount: 0,
    methods: {
      rows: [
        {
          method: 'Banka havalesi',
          studentCount: 7,
          collectedCents: 1_000_000,
          reversedCents: 0,
          netCents: 1_000_000,
          suppressed: false,
        },
        {
          method: 'Nakit',
          studentCount: null,
          collectedCents: null,
          reversedCents: null,
          netCents: null,
          suppressed: true,
        },
      ],
      collectedCents: 1_200_000,
      reversedCents: 0,
      netCents: 1_200_000,
    },
    aging: {
      asOf: '2026-10-06',
      overdueCents: 400_000,
      studentCount: 6,
      rows: [
        { bucket: 'days_1_30', studentCount: 6, amountCents: 400_000, suppressed: false },
        { bucket: 'days_31_60', studentCount: 0, amountCents: 0, suppressed: false },
        { bucket: 'days_61_90', studentCount: 0, amountCents: 0, suppressed: false },
        { bucket: 'days_91_plus', studentCount: 0, amountCents: 0, suppressed: false },
      ],
    },
    packages: null,
  },
  enrollment: {
    startCount: 40,
    endCount: 42,
    newCount: 3,
    withdrawnCount: 1,
    graduatedCount: 0,
    reasons: [{ reason: 'documented', count: null, suppressed: true }],
    renewal: { targetYear: 2027, eligibleCount: 42, renewedCount: 21, rate: 50 },
  },
  funnel: {
    prospects: 10,
    steps: [
      { step: 'prospect', count: 10, rate: null },
      { step: 'meeting', count: 6, rate: 60 },
      { step: 'enrolled', count: 3, rate: 50 },
    ],
    conversionRate: 30,
  },
  ...overrides,
})

test('DOM-FIN-064: dönem seçenekleri yıl, dönemler ve tarih aralığıdır; sorgu seçimden kurulur', () => {
  assert.deepEqual(
    boardYearOptions(2026).map((option) => option.label),
    ['2026–2027', '2025–2026', '2024–2025', '2023–2024', '2022–2023'],
  )
  assert.deepEqual(periodOptions([{ id: 't1', name: 'Güz' }]), [
    { value: WHOLE_YEAR, label: 'Eğitim yılının tamamı' },
    { value: 'donem:t1', label: 'Dönem: Güz' },
    { value: CUSTOM_RANGE, label: 'Tarih aralığı' },
  ])
  const empty = { from: '', to: '' }
  assert.deepEqual(boardReportQuery(2026, WHOLE_YEAR, empty), { year: 2026 })
  assert.deepEqual(boardReportQuery(2026, 'donem:t1', empty), { year: 2026, termId: 't1' })
  assert.equal(boardReportQuery(2026, CUSTOM_RANGE, { from: '2026-09-01', to: '' }), null)
  assert.deepEqual(boardReportQuery(2026, CUSTOM_RANGE, { from: '2026-09-01', to: '2026-09-30' }), {
    year: 2026,
    from: '2026-09-01',
    to: '2026-09-30',
  })
})

test('DOM-FIN-064: PDF dönem, finans, kayıt ve huni bölümlerini yazar; gizli hücre "Gizli (<5)"', () => {
  const all = allTexts(financeBoardReportDocument(measurer, report(), OPTIONS))
  for (const text of [
    'YÖNETİM KURULU RAPORU',
    'DÖNEM SÜRÜYOR',
    'Finans özeti',
    'Ödeme yöntemine göre tahsilat',
    'Gecikmiş alacak yaşlandırması',
    'Kayıt özeti',
    'Ayrılış nedenleri',
    'Aday hunisi',
    'Belgeli neden',
    'Banka havalesi',
    money(5_000_000),
    suppressedLabel(5),
    '1–30 gün',
    'Tanışma görüşmesi',
  ])
    assert.ok(
      all.some((line) => line.includes(text)),
      text,
    )
  assert.equal(
    all.some((line) => line.includes('Paket saat geliri')),
    false,
  )
  assert.ok(all.some((line) => line.includes('%50')))
})

test('DOM-FIN-064: dil okulunda kursiyer, paket geliri ve dönem adı; crm kapalıysa huni notu', () => {
  const data = report({
    institutionType: 'language_school',
    period: {
      kind: 'term',
      year: 2026,
      from: '2026-09-07',
      to: '2026-12-20',
      endDate: '2026-12-20',
      complete: true,
      termId: 't1',
      termName: 'Güz',
    },
    funnel: null,
    finance: {
      ...report().finance,
      packages: {
        saleCount: 2,
        soldHours: 80,
        usedHours: 20,
        refundedHours: 0,
        expiredHours: 0,
        soldCents: 3_600_000,
        recognizedCents: 900_000,
        returnedCents: 0,
        openingDeferredCents: 0,
        closingDeferredCents: 2_700_000,
      },
    },
    enrollment: { ...report().enrollment, renewal: null },
  })
  const all = allTexts(financeBoardReportDocument(measurer, data, OPTIONS))
  for (const text of [
    'DÖNEM SONU',
    'Paket saat geliri',
    money(900_000),
    'Dönem sonu kursiyer',
    'Kayıt modülü kapalı',
  ])
    assert.ok(
      all.some((line) => line.includes(text)),
      text,
    )
  assert.equal(
    all.some((line) => line.includes('Yenileme oranı')),
    false,
  )
  assert.ok(boardReportPeriodLabel(data.period).includes('Güz'))
  assert.equal(boardReportFilename(data.period), 'yonetim-kurulu-raporu-2026-09-07-2026-12-20.pdf')
})

test('DOM-FIN-064: oran etiketi Türkçe ondalıkla, payda yoksa tire', () => {
  assert.equal(rateLabel(null), '—')
  assert.equal(rateLabel(12.5), '%12,5')
  assert.equal(
    boardReportPeriodLabel({ ...report().period, kind: 'custom' }).startsWith('Tarih aralığı'),
    true,
  )
})
