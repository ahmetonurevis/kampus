// Yönetim kurulu raporu (DOM-FIN-064, ON-251): rakamlar API raporundan gelir, burada yeniden
// hesaplanmaz. Kişi adı yoktur; küçük grup hücresi sunucudan değersiz gelir ve "gizli" yazılır.
import type { FinanceBoardReport } from '@kampus/react-shared/use-finance-board-report.ts'
import { academicYearName } from '@kampus/school-core/lib/academic-years.ts'
import { funnelStepLabel } from '@kampus/school-core/lib/enrollment-funnel.ts'
import { learnerWords } from '@kampus/school-core/lib/enrollment-learner.ts'
import { BOARD_REPORT_AGING_BUCKETS } from '@kampus/school-core/lib/finance-board-report.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { PAYMENT_METHOD_LABELS } from '@kampus/school-core/lib/payments.ts'
import { WITHDRAWAL_REASON_LABELS } from '@kampus/school-core/lib/withdrawals.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import {
  ALL_BOARD_REPORT_SECTIONS,
  writeBoardReportSections,
  type BoardReportSections,
} from './finance-board-report-sections.ts'
import type { TemplateOptions } from './shared.ts'

export const BOARD_REPORT_TITLE = 'Yönetim kurulu raporu'

const dayLabel = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const hours = (value: number) => `${value.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} sa`

/** Yüzde, bir ondalık; payda yoksa tire. */
export const rateLabel = (rate: number | null) =>
  rate === null ? '—' : `%${rate.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`

/** Gizli hücre metni (K-77): eşik belgede yazar. */
export const suppressedLabel = (minGroupSize: number) => `Gizli (<${String(minGroupSize)})`

export function boardReportFilename(period: FinanceBoardReport['period']): string {
  return `yonetim-kurulu-raporu-${period.from}-${period.to}.pdf`
}

/** Dönemin adı: eğitim yılı, dönem adı ya da tarih aralığı; ardından gün aralığı. */
export function boardReportPeriodLabel(period: FinanceBoardReport['period']): string {
  const range = `${dayLabel(period.from)} – ${dayLabel(period.to)}`
  switch (period.kind) {
    case 'year':
      return `${academicYearName(period.year)} eğitim yılı · ${range}`
    case 'term':
      return `${academicYearName(period.year)} · ${period.termName ?? 'Dönem'} · ${range}`
    case 'custom':
      return `Tarih aralığı · ${range}`
    default:
      return period.kind satisfies never
  }
}

const AGING_LABELS = new Map<string, string>(
  BOARD_REPORT_AGING_BUCKETS.map((bucket) => [bucket.key, bucket.label]),
)

const AMOUNT_COLUMNS = [
  { header: 'Kalem', width: 124 },
  { header: 'Tutar', width: 50 },
] as const
const COUNT_COLUMNS = [
  { header: 'Kalem', width: 124 },
  { header: 'Sayı', width: 50 },
] as const
const METHOD_COLUMNS = [
  { header: 'Yöntem', width: 46 },
  { header: 'Kişi', width: 20 },
  { header: 'Tahsilat', width: 36 },
  { header: 'İptal', width: 36 },
  { header: 'Net', width: 36 },
] as const
const AGING_COLUMNS = [
  { header: 'Gecikme', width: 84 },
  { header: 'Kişi', width: 30 },
  { header: 'Tutar', width: 60 },
] as const
const FUNNEL_COLUMNS = [
  { header: 'Adım', width: 94 },
  { header: 'Aday', width: 30 },
  { header: 'Önceki adıma oran', width: 50 },
] as const

/**
 * Raporu yazar. Bölümler: finans özeti (mutabakat toplamı), yöntem kırılımı, yaşlandırma, dil
 * okulunda paket geliri, seçilen bütçe, maliyet ve tahmin bölümleri (ON-329), kayıt özeti, ayrılış
 * nedenleri, aday hunisi. Kayıtlı kişi kurum türüne göre "öğrenci" ya da "kursiyer" yazılır
 * (DOM-KAY-012).
 */
export function financeBoardReportDocument(
  measurer: TextMeasurer,
  report: FinanceBoardReport,
  options: TemplateOptions & { sections?: BoardReportSections },
): PdfDocument {
  const { period, finance, enrollment, funnel, minGroupSize } = report
  const learner = learnerWords(report.institutionType)
  const hidden = suppressedLabel(minGroupSize)
  const count = (value: number | null) => (value === null ? hidden : String(value))
  const amount = (value: number | null) => (value === null ? hidden : money(value))
  const { totals } = finance
  const doc = new DocumentLayout(measurer, {
    label: 'YÖNETİM KURULU RAPORU',
    badge: period.complete ? 'DÖNEM SONU' : 'DÖNEM SÜRÜYOR',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: `kurul-raporu-${period.from}-${period.to}`,
    footerNote: 'Kurum içi yönetim özetidir; kişi verisi içermez, mali tablo yerine geçmez.',
  })
  doc.heading(BOARD_REPORT_TITLE, boardReportPeriodLabel(period))
  if (!period.complete)
    doc.paragraph(
      `Dönem sürüyor; rakamlar ${dayLabel(report.today)} itibarıyladır. Seçilen bitiş ${dayLabel(period.endDate)}.`,
    )
  doc.metrics([
    ['TAHAKKUK', money(totals.accruedCents)],
    ['NET TAHSİLAT', money(finance.methods.netCents)],
    ['GECİKMİŞ ALACAK', money(finance.aging.overdueCents)],
    [`DÖNEM SONU ${learner.title.toLocaleUpperCase('tr-TR')}`, String(enrollment.endCount)],
  ])

  doc.section('Finans özeti')
  doc.table(
    AMOUNT_COLUMNS,
    [
      ['Dönem başı bakiye (açık borç − alacak)', money(totals.openingCents)],
      ['Tahakkuk (vadesi dönemde olan taksitler)', money(totals.accruedCents)],
      ['Ayrılış düzeltmesi', money(totals.withdrawalAdjustmentCents)],
      ['Tahsilat', money(totals.collectedCents)],
      ['Tahsilat iptali', money(totals.reversedCents)],
      ['Açılış aktarımı (geçmiş ödeme, tahsilat değildir)', money(totals.openingImportCents)],
      ['Ödenen iade', money(totals.refundedCents)],
      ['Dönem sonu bakiye (açık borç − alacak)', money(totals.closingCents)],
      ['Burs (bilgi; taksitlerden düşülmüş)', money(totals.scholarshipCents)],
      ['İndirim (bilgi; taksitlerden düşülmüş)', money(totals.discountCents)],
    ],
    true,
  )
  doc.paragraph(
    finance.mismatchCount === 0
      ? 'Yıl sonu mutabakatı tutuyor: açılış + tahakkuk − ayrılış düzeltmesi − tahsilat − açılış aktarımı + iptal + iade = kapanış.'
      : `Yıl sonu mutabakatında ${String(finance.mismatchCount)} ${learner.noun} kaydı tutmuyor; ayrıntı Muhasebe aktarımı ekranındadır.`,
  )

  doc.section('Ödeme yöntemine göre tahsilat')
  doc.table(
    METHOD_COLUMNS,
    [
      ...finance.methods.rows.map((row) => [
        PAYMENT_METHOD_LABELS[row.method],
        count(row.studentCount),
        amount(row.collectedCents),
        amount(row.reversedCents),
        amount(row.netCents),
      ]),
      [
        'Toplam',
        '',
        money(finance.methods.collectedCents),
        money(finance.methods.reversedCents),
        money(finance.methods.netCents),
      ],
    ],
    true,
  )

  doc.section('Gecikmiş alacak yaşlandırması')
  doc.paragraph(
    `${dayLabel(finance.aging.asOf)} itibarıyla, vadesi dönem sonuna kadar gelmiş taksitlerin kalan kısmı.`,
  )
  doc.table(
    AGING_COLUMNS,
    [
      ...finance.aging.rows.map((row) => [
        AGING_LABELS.get(row.bucket) ?? row.bucket,
        count(row.studentCount),
        amount(row.amountCents),
      ]),
      ['Toplam', String(finance.aging.studentCount), money(finance.aging.overdueCents)],
    ],
    true,
  )

  if (finance.packages) {
    const packages = finance.packages
    doc.section('Paket saat geliri')
    doc.fields([
      ['Satış adedi', String(packages.saleCount)],
      ['Satış tutarı', money(packages.soldCents)],
      ['Satılan saat', hours(packages.soldHours)],
      ['Kullanılan saat', hours(packages.usedHours)],
      ['Tanınan gelir', money(packages.recognizedCents)],
      ['Dönem sonu ertelenmiş gelir', money(packages.closingDeferredCents)],
    ])
  }

  writeBoardReportSections(doc, report, options.sections ?? ALL_BOARD_REPORT_SECTIONS, learner.noun)

  doc.section('Kayıt özeti')
  doc.table(
    COUNT_COLUMNS,
    [
      [`Dönem başı ${learner.noun}`, String(enrollment.startCount)],
      ['Yeni kesin kayıt', String(enrollment.newCount)],
      ['Ayrılış', String(enrollment.withdrawnCount)],
      ['Mezuniyet', String(enrollment.graduatedCount)],
      [`Dönem sonu ${learner.noun}`, String(enrollment.endCount)],
      ...(enrollment.renewal
        ? [
            [
              `Yenileme oranı (${academicYearName(enrollment.renewal.targetYear)})`,
              `${rateLabel(enrollment.renewal.rate)} (${String(enrollment.renewal.renewedCount)} / ${String(enrollment.renewal.eligibleCount)})`,
            ],
          ]
        : []),
    ],
    true,
  )

  doc.section('Ayrılış nedenleri')
  doc.table(
    COUNT_COLUMNS,
    enrollment.reasons.map((row) => [WITHDRAWAL_REASON_LABELS[row.reason], count(row.count)]),
    true,
  )

  doc.section('Aday hunisi')
  if (funnel === null) doc.paragraph('Kayıt modülü kapalı olduğu için aday hunisi yok.')
  else {
    doc.table(
      FUNNEL_COLUMNS,
      funnel.steps.map((step) => [
        funnelStepLabel(step.step, report.institutionType),
        String(step.count),
        step.rate === null ? '—' : rateLabel(step.rate),
      ]),
      true,
    )
    doc.paragraph(
      `Dönemde açılan ${String(funnel.prospects)} adayın kesin kayda dönüşümü ${rateLabel(funnel.conversionRate)}.`,
    )
  }

  doc.paragraph(
    `${String(minGroupSize)} kişiden az olan kırılım hücreleri kişiyi belli etmemesi için gizlenmiştir; tek gizli hücre toplamdan bulunabileceği için en küçük ikinci hücre de gizlenir.`,
    9,
  )
  doc.signatures('Hazırlayan', 'Yönetim kurulu adına', true)
  return doc.finish()
}
