// SGK bildirge hazırlık listesi (DOM-FIN-107; ON-203): mali müşavire ya da bordrocuya aylık kontrol
// listesi. Veri `purpose=pdf` ile okunan liste yanıtıdır (okuma denetime düşer, K-355); burada
// yeniden hesaplanmaz. Kimlik numarası tutulmadığından sütun boştur. Resmî bildirge değildir.
import type { SgkPreparation } from '@kampus/react-shared/use-finance-sgk-preparation.ts'
import {
  SGK_PREPARATION_NOTE,
  SGK_WARNING_LABELS,
  sgkBaseText,
  sgkMonthLabel,
  sgkPreparationFilename,
  sgkReasonText,
} from '@kampus/school-core/lib/finance-sgk-preparation.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const SGK_PREPARATION_TITLE = 'SGK bildirge hazırlık listesi'

const COLUMNS = [
  { header: 'Personel', width: 36 },
  { header: 'T.C. kimlik', width: 18 },
  { header: 'Giriş / çıkış', width: 24 },
  { header: 'Prim günü', width: 14 },
  { header: 'Eksik', width: 12 },
  { header: 'Neden', width: 16 },
  { header: 'Tanımlı ücret', width: 26 },
  { header: 'SGK matrahı', width: 28 },
] as const

const shortDay = (day: string) => dateLabel(`${day}T09:00:00.000Z`)

export const sgkPreparationPdfFilename = (month: string) => sgkPreparationFilename(month, 'pdf')

/** "G 16 Eki · Ç 20 Eki"; ay içinde değilse tire. */
export function sgkEntryExitCell(row: SgkPreparation['rows'][number]): string {
  const parts = [
    row.entryDate === null ? null : `G ${shortDay(row.entryDate)}`,
    row.exitDate === null ? null : `Ç ${shortDay(row.exitDate)}`,
  ].filter((part) => part !== null)
  return parts.length === 0 ? '—' : parts.join(' · ')
}

export function sgkPreparationDocument(
  measurer: TextMeasurer,
  list: SgkPreparation,
  options: TemplateOptions,
): PdfDocument {
  const doc = new DocumentLayout(measurer, {
    label: 'SGK HAZIRLIK LİSTESİ',
    badge: 'KONTROL LİSTESİ',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: `sgk-hazirlik-${list.month}`,
    footerNote: 'Resmî bildirge değildir; hiçbir resmî sisteme gönderilmez.',
  })
  doc.heading(SGK_PREPARATION_TITLE, sgkMonthLabel(list.month))
  doc.paragraph(SGK_PREPARATION_NOTE)
  doc.metrics([
    ['PERSONEL', String(list.totals.staffCount)],
    ['PRİM GÜNÜ', String(list.totals.primDays)],
    ['EKSİK GÜN', String(list.totals.missingDays)],
    ['SGK MATRAHI', money(list.totals.sgkBaseCents)],
  ])
  doc.section('Parametreler')
  doc.fields([
    ['Kurum', options.institution],
    [
      'Ay',
      `${shortDay(list.firstDay)} – ${dateLabel(`${list.lastDay}T09:00:00.000Z`, { year: 'numeric' })}`,
    ],
    [
      'Bordro parametresi',
      `${dateLabel(`${list.parameters.effectiveFrom}T09:00:00.000Z`, { year: 'numeric' })} seti (${list.parameters.origin === 'institution' ? 'kurum' : 'platform'})${list.parameters.unverified ? ', doğrulanmalı' : ''}${list.parameters.stale ? ', güncel değil' : ''}`,
    ],
    ['Aylık SGK tabanı', money(list.parameters.floorCents)],
    ['Aylık SGK tavanı', money(list.parameters.ceilingCents)],
  ])
  doc.section('Personel')
  if (list.rows.length === 0) doc.paragraph('Bu ay için listede personel yok.')
  else
    doc.table(
      COLUMNS,
      list.rows.map((row) => [
        row.name,
        '',
        sgkEntryExitCell(row),
        String(row.primDays),
        String(row.missingDays),
        sgkReasonText(row.reasonCode),
        row.wage === null
          ? 'Tanım yok'
          : row.wage.rateType === 'monthly_gross'
            ? money(row.wage.amountCents)
            : `${money(row.wage.amountCents)} (aylık brüt değil)`,
        sgkBaseText(row),
      ]),
      true,
    )
  const warned = list.rows.filter((row) => row.warnings.length > 0)
  if (warned.length > 0) {
    doc.section('Uyarılar')
    for (const row of warned)
      doc.paragraph(
        `${row.name}: ${row.warnings.map((code) => SGK_WARNING_LABELS[code]).join('; ')}.`,
      )
  }
  if (list.totals.unestimatedCount > 0)
    doc.paragraph(
      `${String(list.totals.unestimatedCount)} personelin SGK matrahı tahmin edilmedi; toplam yalnız tahmin edilenleri içerir.`,
    )
  return doc.finish()
}
