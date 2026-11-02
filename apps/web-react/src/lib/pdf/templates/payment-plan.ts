// Taksit taahhütnamesi: güncel ödeme planı, tahsilat özeti ve imza alanı.
import { money } from '@kampus/school-core/lib/format.ts'
import type { DocumentDataMap } from '@kampus/school-core/lib/document-data.ts'
import { COLORS, date, DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import { INSTALLMENT_COLUMNS, studentFields } from './finance-shared.ts'
import type { TemplateOptions } from './shared.ts'

/** Taksit taahhütnamesi: öğrencinin güncel ödeme planı, tahsilat özeti ve imza alanı. */
export function paymentPlanDocument(
  measurer: TextMeasurer,
  data: DocumentDataMap['payment-plan'],
  options: TemplateOptions,
): PdfDocument {
  const doc = new DocumentLayout(measurer, {
    label: 'TAKSİT TAAHHÜTNAMESİ',
    badge: 'TAAHHÜT',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: data.reference,
    footerNote: 'Ödeme planı özetidir; kurumun imzalı sözleşmesi veya resmî makbuz yerine geçmez.',
  })
  doc.heading('Taksit taahhütnamesi', 'Öğrenciye ait güncel ödeme planı ve tahsilat özeti')
  doc.fields(studentFields(data))
  doc.metrics([
    ['TOPLAM BEDEL', money(data.total)],
    ['TAHSİL EDİLEN', money(data.paid)],
    ['KALAN BAKİYE', money(data.total - data.paid)],
  ])
  doc.section('Taksit takvimi')
  doc.table(
    INSTALLMENT_COLUMNS,
    data.invoices.map((item) => [
      `${item.installment}. taksit`,
      date(item.dueDate),
      money(item.amount),
      item.status,
    ]),
    true,
  )
  doc.paragraph(
    'Bu plan, belgenin oluşturulduğu andaki tahsilat durumunu gösterir. Tamamlanan her tahsilat için ayrı bir dekont alınabilir.',
    8,
    COLORS.muted,
  )
  doc.signatures(
    `Veli · ${data.parent?.name || 'Ad soyad'}`,
    'Okul muhasebesi · Kontrol / Tarih',
    true,
  )
  return doc.finish()
}
