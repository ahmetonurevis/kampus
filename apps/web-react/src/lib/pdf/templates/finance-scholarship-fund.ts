// Burs fonu raporu (DOM-FIN-068; ON-259): fon, bağışçı, toplamlar ve yürüyen bakiyeli hareket
// dökümü. Rakamlar API yanıtından gelir, burada yeniden hesaplanmaz. Öğrenci adı yalnız yetkili
// rolün yanıtında doludur (K-98). Bağış makbuzu ya da vergi belgesi değildir (M-21 doğrulanmalı).
import type {
  ScholarshipFundMovement,
  ScholarshipFundReport,
} from '@kampus/react-shared/use-finance-scholarship-funds.ts'
import {
  SCHOLARSHIP_FUND_CHANNEL_LABELS,
  SCHOLARSHIP_FUND_DONOR_KIND_LABELS,
  SCHOLARSHIP_FUND_MOVEMENT_LABELS,
  SCHOLARSHIP_FUND_STATUS_LABELS,
} from '@kampus/school-core/lib/finance-scholarship-funds.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const SCHOLARSHIP_FUND_REPORT_TITLE = 'Burs fonu raporu'

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** Hareketin açıklaması: bağışta kaynak ve not, atamada öğrenci ve eğitim yılı. */
export function movementDetail(row: ScholarshipFundMovement): string {
  if (row.kind === 'donation')
    return [row.channel === null ? null : SCHOLARSHIP_FUND_CHANNEL_LABELS[row.channel], row.note]
      .filter((part): part is string => part !== null && part !== '')
      .join(' · ')
  const year =
    row.academicYear === null ? '' : `${String(row.academicYear)}-${String(row.academicYear + 1)}`
  return [row.studentName ?? 'Öğrenci adı gizli', year].filter((part) => part !== '').join(' · ')
}

/** İşaretli tutar: bağış artı, atama eksi; iptal edilen satırda bakiye etkisi yoktur. */
export const signedAmount = (row: Pick<ScholarshipFundMovement, 'kind' | 'amountCents'>) =>
  `${row.kind === 'donation' ? '+' : '−'}${money(row.amountCents)}`

const COLUMNS = [
  { header: 'Tarih', width: 24 },
  { header: 'Hareket', width: 22 },
  { header: 'Kaynak / öğrenci', width: 50 },
  { header: 'Durum', width: 20 },
  { header: 'Tutar', width: 28 },
  { header: 'Bakiye', width: 30 },
] as const

export const scholarshipFundReportFilename = (fundName: string) =>
  `burs-fonu-${fundName
    .toLocaleLowerCase('tr')
    .replace(/[^a-z0-9ğüşıöç]+/g, '-')
    .replace(/^-|-$/g, '')}.pdf`

export function scholarshipFundReportDocument(
  measurer: TextMeasurer,
  report: ScholarshipFundReport,
  options: TemplateOptions,
): PdfDocument {
  const { fund, movements } = report
  const doc = new DocumentLayout(measurer, {
    label: 'BURS FONU RAPORU',
    badge: fund.status === 'closed' ? 'KAPALI' : 'BURS FONU',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: `fon-${fund.id.slice(0, 8)}`,
    footerNote: 'Kurum içi izleme dökümüdür; bağış makbuzu veya vergi belgesi yerine geçmez.',
  })
  doc.heading(SCHOLARSHIP_FUND_REPORT_TITLE, fund.name)
  doc.fields([
    [
      'Bağışçı',
      fund.donorName === null
        ? SCHOLARSHIP_FUND_DONOR_KIND_LABELS[fund.donorKind]
        : `${fund.donorName} (${SCHOLARSHIP_FUND_DONOR_KIND_LABELS[fund.donorKind]})`,
    ],
    ['Durum', SCHOLARSHIP_FUND_STATUS_LABELS[fund.status]],
    ['Açılış', dateLabel(fund.createdAt, { year: 'numeric' })],
    ...(fund.description === null ? [] : [['Açıklama', fund.description] as [string, string]]),
  ])
  doc.metrics([
    ['BAĞIŞ', money(fund.donatedCents)],
    ['ATAMA', money(fund.allocatedCents)],
    ['BAKİYE', money(fund.balanceCents)],
  ])
  doc.section('Hareketler')
  if (movements.length === 0) doc.paragraph('Henüz bağış ya da atama yok.')
  else
    doc.table(
      COLUMNS,
      [
        ...movements.map((row) => [
          dayText(row.day),
          SCHOLARSHIP_FUND_MOVEMENT_LABELS[row.kind],
          movementDetail(row),
          row.cancelledAt === null ? 'Geçerli' : 'İptal edildi',
          signedAmount(row),
          money(row.balanceAfterCents),
        ]),
        ['Bakiye', '', '', '', '', money(fund.balanceCents)],
      ],
      true,
    )
  return doc.finish()
}
