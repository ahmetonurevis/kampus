// Gün sonu raporu (IST-113, DOM-FIN-036): rakamlar API raporundan gelir, burada yeniden hesaplanmaz.
// Kapalı günde kapanış anının özeti yazılır; belge kurum içi özettir.
import type { FinanceDayReport } from '@kampus/react-shared/use-finance-day-closings.ts'
import { dateLabel, money, timeLabel } from '@kampus/school-core/lib/format.ts'
import { PAYMENT_METHOD_LABELS } from '@kampus/school-core/lib/payments.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const DAY_CLOSING_TITLE = 'Gün sonu raporu'

const METHOD_COLUMNS = [
  { header: 'Yöntem', width: 54 },
  { header: 'Adet', width: 18 },
  { header: 'Tahsilat', width: 34 },
  { header: 'İptal', width: 34 },
  { header: 'Net', width: 34 },
] as const
const LINE_COLUMNS = [
  { header: 'Dekont', width: 24 },
  { header: 'Öğrenci', width: 46 },
  { header: 'Yöntem', width: 30 },
  { header: 'Referans', width: 44 },
  { header: 'Tutar', width: 30 },
] as const
const REVERSAL_COLUMNS = [
  { header: 'Dekont', width: 24 },
  { header: 'Öğrenci', width: 36 },
  { header: 'Ödeme günü', width: 26 },
  { header: 'Gerekçe', width: 58 },
  { header: 'Tutar', width: 30 },
] as const

const dayLabelOf = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const stampOf = (at: string) => `${dateLabel(at, { year: 'numeric' })} ${timeLabel(at)}`

/** Fark işaretiyle yazılır: artı fazla, eksi eksik. */
export function cashDifferenceLabel(cents: number): string {
  if (cents === 0) return 'Fark yok'
  return cents > 0 ? `${money(cents)} fazla` : `${money(-cents)} eksik`
}

export function dayClosingFilename(closingDate: string): string {
  return `gun-sonu-${closingDate}.pdf`
}

export function financeDayClosingDocument(
  measurer: TextMeasurer,
  report: FinanceDayReport,
  options: TemplateOptions,
): PdfDocument {
  const { summary, closing } = report
  const doc = new DocumentLayout(measurer, {
    label: 'GÜN SONU RAPORU',
    badge: closing ? 'KAPATILDI' : 'AÇIK GÜN',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: `gun-sonu-${report.closingDate}`,
    footerNote: 'Kurum içi gün sonu özetidir; kasa defteri, makbuz veya fatura yerine geçmez.',
  })
  doc.heading(DAY_CLOSING_TITLE, dayLabelOf(report.closingDate))
  doc.metrics([
    ['TAHSİLAT', money(summary.collectedCents)],
    ['İPTAL', money(summary.reversedCents)],
    ['NET', money(summary.netCents)],
  ])
  if (!closing) doc.paragraph('Bu gün henüz kapatılmadı; rakamlar kesinleşmemiştir.')

  doc.section('Ödeme yöntemine göre')
  doc.table(
    METHOD_COLUMNS,
    [
      ...summary.methods.map((item) => [
        PAYMENT_METHOD_LABELS[item.method],
        `${String(item.collectedCount)} / ${String(item.reversedCount)}`,
        money(item.collectedCents),
        money(item.reversedCents),
        money(item.netCents),
      ]),
      [
        'Toplam',
        `${String(summary.collectedCount)} / ${String(summary.reversedCount)}`,
        money(summary.collectedCents),
        money(summary.reversedCents),
        money(summary.netCents),
      ],
    ],
    true,
  )

  doc.section('Tahsilatlar')
  if (report.collected.length === 0) doc.paragraph('Bu gün tahsilat yok.')
  else
    doc.table(
      LINE_COLUMNS,
      report.collected.map((line) => [
        `${String(line.receiptYear)}-${String(line.receiptNumber)}`,
        line.studentName ?? '—',
        PAYMENT_METHOD_LABELS[line.method],
        line.reference ?? '—',
        money(line.amountCents),
      ]),
      true,
    )

  doc.section('İptaller')
  if (report.reversed.length === 0) doc.paragraph('Bu gün iptal yok.')
  else
    doc.table(
      REVERSAL_COLUMNS,
      report.reversed.map((line) => [
        `${String(line.receiptYear)}-${String(line.receiptNumber)}`,
        line.studentName ?? '—',
        dateLabel(line.paidAt, { year: 'numeric' }),
        line.reversalReason ?? '—',
        money(line.amountCents),
      ]),
      true,
    )

  if (closing) {
    doc.section('Kasa sayımı')
    if (closing.cash)
      doc.fields([
        ['Açılış kasası', money(closing.cash.openingCents)],
        ['Günün net nakdi', money(report.cashNetCents)],
        ['Beklenen nakit', money(closing.cash.expectedCents)],
        ['Sayılan nakit', money(closing.cash.countedCents)],
        ['Kasa farkı', cashDifferenceLabel(closing.cash.differenceCents)],
      ])
    else doc.paragraph('Nakit tahsilat kapalı ve hareket olmadığı için kasa sayılmadı.')
    doc.section('Kapanış')
    doc.fields([
      ['Kapatan', closing.closedByName ?? '—'],
      ['Kapanış anı', stampOf(closing.closedAt)],
      ...(closing.note ? ([['Açıklama', closing.note]] as const) : []),
    ])
  }

  if (report.history.length > 0) {
    doc.section('Önceki kapanışlar')
    for (const item of report.history)
      doc.paragraph(
        `${item.closedByName ?? '—'} ${stampOf(item.closedAt)} tarihinde kapattı (net ${money(item.summary.netCents)}); ${item.reopenedByName ?? '—'} ${item.reopenedAt ? stampOf(item.reopenedAt) : '—'} tarihinde yeniden açtı. Gerekçe: ${item.reopenReason ?? '—'}`,
      )
  }

  doc.signatures('Kapatan', 'Yönetici', true)
  return doc.finish()
}
