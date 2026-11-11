// Tahsilat dekontu (kayıt/demo durumundan): tek sayfalık işlem özeti.
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import type { DocumentDataMap } from '@kampus/school-core/lib/document-data.ts'
import { COLORS, date, DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import { studentFields } from './finance-shared.ts'
import type { TemplateOptions } from './shared.ts'

/** Tahsilat dekontu: tek sayfalık işlem özeti. */
export function receiptDocument(
  measurer: TextMeasurer,
  data: DocumentDataMap['receipt'],
  options: TemplateOptions,
): PdfDocument {
  const { invoice } = data
  const doc = new DocumentLayout(measurer, {
    label: 'TAHSİLAT DEKONTU',
    badge: 'DEKONT',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: data.reference,
    footerNote:
      'Bu dekont Kampüs ödeme kaydından oluşturulmuştur; banka belgesi veya resmî makbuz yerine geçmez.',
  })
  doc.heading('Ödeme dekontu', 'Eğitim hizmeti tahsilatı · İşlem başarıyla tamamlandı')
  doc.highlight('TAHSİL EDİLEN TUTAR', money(invoice.amount), 'TRY / Türk lirası')
  doc.fields([
    ['İşlem / Referans no', invoice.id.toUpperCase()],
    [
      'İşlem tarihi ve saati',
      dateLabel(invoice.paidAt, { year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    ],
    ['Ödeme yöntemi', invoice.method],
    ['İşlem durumu', 'Tamamlandı'],
  ])
  doc.section('Ödeyen ve tahsil eden')
  doc.fields(studentFields(data))
  doc.section('İşlem açıklaması')
  doc.paragraph(
    `${data.student.name} adına düzenlenen eğitim ödeme planının ${invoice.installment}. taksiti. Vade tarihi: ${date(invoice.dueDate)}.`,
  )
  doc.fields([
    ['Alıcı kurum', options.institution],
    ['İşlem ücreti', money(0)],
  ])
  doc.paragraph(
    'Bu dekont, ödeme kaydındaki bilgilerden oluşturulmuştur. Banka veya ödeme kuruluşu tarafından düzenlenmiş bir belge değildir.',
    8,
    COLORS.muted,
  )
  return doc.finish()
}
