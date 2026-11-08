// Kurumsal müşteri belgeleri (IST-089, DOM-FIN-060, DOM-DIL-093): toplu fatura dökümü ve şirket
// çalışanlarının katılım özeti. Rakamlar API yanıtından gelir, burada yeniden hesaplanmaz.
// Toplu fatura kurum içi dökümdür, vergi belgesi değildir (M-13 doğrulanmalı).
import type {
  CorporateAttendanceReport,
  CorporateInvoice,
} from '@kampus/react-shared/use-finance-corporate.ts'
import { FEE_ITEM_KIND_LABELS } from '@kampus/school-core/lib/fee-tariffs.ts'
import {
  CORPORATE_LINE_STATUS_LABELS,
  CORPORATE_MEMBER_STATUS_LABELS,
  eligibilityLabel,
  outcomeLabel,
  permilleLabel,
} from '@kampus/school-core/lib/finance-corporate.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const CORPORATE_INVOICE_TITLE = 'Toplu fatura dökümü'
export const CORPORATE_REPORT_TITLE = 'Katılım özeti'

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

const INVOICE_COLUMNS = [
  { header: 'Kursiyer', width: 50 },
  { header: 'Taksit', width: 14 },
  { header: 'Kalem', width: 28 },
  { header: 'Vade', width: 26 },
  { header: 'Durum', width: 28 },
  { header: 'Tutar', width: 28 },
] as const

const REPORT_COLUMNS = [
  { header: 'Kursiyer', width: 36 },
  { header: 'Kur / grup', width: 40 },
  { header: 'Saat (katılım / yoklama / toplam)', width: 34 },
  { header: 'Oran', width: 16 },
  { header: 'Devam şartı', width: 22 },
  { header: 'Kur sonucu', width: 26 },
] as const

export const corporateInvoiceFilename = (invoice: Pick<CorporateInvoice, 'number'>) =>
  `toplu-fatura-${invoice.number}.pdf`
export const corporateReportFilename = (customerName: string) =>
  `katilim-ozeti-${customerName
    .toLocaleLowerCase('tr')
    .replace(/[^a-z0-9ğüşıöç]+/g, '-')
    .replace(/^-|-$/g, '')}.pdf`

/** Toplu fatura dökümü: şirket bilgisi (kesim anı kopyası), satırlar ve toplam. */
export function corporateInvoiceDocument(
  measurer: TextMeasurer,
  invoice: CorporateInvoice,
  options: TemplateOptions,
): PdfDocument {
  const doc = new DocumentLayout(measurer, {
    label: 'TOPLU FATURA DÖKÜMÜ',
    badge: invoice.cancelledAt ? 'İPTAL' : 'KURUMSAL',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: invoice.number,
    footerNote: 'Kurum içi toplu dökümdür; resmi fatura veya e-Arşiv belgesi yerine geçmez.',
  })
  doc.heading(CORPORATE_INVOICE_TITLE, invoice.number)
  doc.fields([
    ['Şirket', invoice.customerName],
    ['Vergi dairesi / numarası', `${invoice.taxOffice} / ${invoice.taxNumber}`],
    ['Fatura adresi', invoice.billingAddress],
    ['Dönem', `${dayText(invoice.periodFrom)} – ${dayText(invoice.periodTo)}`],
    ['Kesim tarihi', dateLabel(invoice.issuedAt, { year: 'numeric' })],
  ])
  if (invoice.cancelledAt)
    doc.paragraph(
      `Bu döküm ${dateLabel(invoice.cancelledAt, { year: 'numeric' })} tarihinde iptal edildi. Gerekçe: ${invoice.cancelReason ?? '—'}`,
    )
  doc.metrics([
    ['TOPLAM', money(invoice.totalCents)],
    ['SATIR', String(invoice.lineCount)],
  ])
  doc.section('Taksitler')
  doc.table(
    INVOICE_COLUMNS,
    [
      ...invoice.lines.map((line) => [
        line.studentName ?? '—',
        String(line.installment),
        FEE_ITEM_KIND_LABELS[line.feeKind ?? 'tuition'],
        dayText(line.dueDate),
        CORPORATE_LINE_STATUS_LABELS[line.status],
        money(line.amountCents),
      ]),
      ['Toplam', '', '', '', '', money(invoice.totalCents)],
    ],
    true,
  )
  return doc.finish()
}

/**
 * Katılım özeti (DOM-DIL-093): yalnız devam saatleri, oran, devam şartı ve onaylı kur sonucu.
 * Yazma ürünü, ses kaydı, puan ve öğretmen yorumu belgeye girmez.
 */
export function corporateReportDocument(
  measurer: TextMeasurer,
  report: CorporateAttendanceReport,
  options: TemplateOptions,
): PdfDocument {
  const doc = new DocumentLayout(measurer, {
    label: 'KATILIM ÖZETİ',
    badge: 'KURUMSAL',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: `katilim-${report.customerId.slice(0, 8)}`,
    footerNote:
      'Yalnız devam ve kur sonucu içerir; kursiyere işveren raporu aydınlatması yapılmıştır.',
  })
  doc.heading(CORPORATE_REPORT_TITLE, report.customerName)
  doc.metrics([
    ['ÇALIŞAN', String(report.totals.employeeCount)],
    ['KUR KAYDI', String(report.totals.enrollmentCount)],
    [
      'KATILIM',
      report.totals.attendanceRatePermille === null
        ? '—'
        : `%${permilleLabel(report.totals.attendanceRatePermille)}`,
    ],
  ])
  doc.section('Kursiyerler')
  const rows = report.employees.flatMap((employee) => {
    const name = employee.studentName ?? '—'
    if (employee.enrollments.length === 0) return [[name, 'Kur kaydı yok', '—', '—', '—', '—']]
    return employee.enrollments.map((row) => [
      name,
      `${row.courseName} (${row.level}) / ${row.groupName} · ${CORPORATE_MEMBER_STATUS_LABELS[row.memberStatus]}`,
      `${String(row.attendedHours)} / ${String(row.recordedHours)} / ${String(row.totalHours)}`,
      row.attendanceRatePermille === null ? '—' : `%${permilleLabel(row.attendanceRatePermille)}`,
      eligibilityLabel(row),
      outcomeLabel(row.outcome),
    ])
  })
  if (rows.length === 0) doc.paragraph('Şirkete bağlı kursiyer yok.')
  else doc.table(REPORT_COLUMNS, rows, true)
  return doc.finish()
}
