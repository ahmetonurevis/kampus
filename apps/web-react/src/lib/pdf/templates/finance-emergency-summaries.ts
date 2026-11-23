// Sınıf acil durum özetleri PDF'i (DOM-FIN-155; ON-165; K-521, K-522): öğretmen masası için sınıfın
// yayındaki özetleri; öğrenci başına acil eylem, uyarı türleri (tanısız), bugünkü ilaç ve maskeli
// acil iletişim. Tam telefon PDF'e yazılmaz. A4 dikey; veri API'den `purpose=print` ile gelir ve
// her öğrencinin basımı denetime düşer.
import type { EmergencyClassCards } from '@kampus/react-shared/use-finance-emergency-summaries.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  alertText,
  contactsText,
  medicationTodayText,
} from '../../finance-emergency-summary-text.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const EMERGENCY_SUMMARIES_TITLE = 'Acil durum özetleri'

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** Belge numarası: liste günü ve sınıf kimliği; kişi adı yok. */
export const emergencySummariesReference = (
  list: Pick<EmergencyClassCards, 'listDate' | 'classId'>,
) =>
  `ACL-${list.listDate.replaceAll('-', '')}-${list.classId.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}`

export const emergencySummariesFilename = (
  list: Pick<EmergencyClassCards, 'listDate' | 'classId'>,
) => `acil-durum-ozetleri-${emergencySummariesReference(list)}.pdf`

export function emergencySummariesDocument(
  measurer: TextMeasurer,
  list: EmergencyClassCards,
  options: TemplateOptions & { learnerTitle?: string },
): PdfDocument {
  const doc = new DocumentLayout(measurer, {
    label: 'ACİL DURUM ÖZETİ',
    badge: list.className.toLocaleUpperCase('tr'),
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: emergencySummariesReference(list),
    footerNote:
      'Öğretmen masasında kalır, çoğaltılmaz. Sağlık bilgisi özel niteliklidir; güncel olmayan sayfa imha edilir.',
  })
  doc.heading(EMERGENCY_SUMMARIES_TITLE, list.className)
  doc.fields([
    ['Kurum', options.institution],
    ['Sınıf', list.className],
    ['Gün', dayText(list.listDate)],
  ])
  doc.metrics([
    [
      `ÖZETİ OLAN ${(options.learnerTitle ?? 'Öğrenci').toLocaleUpperCase('tr')}`,
      String(list.cards.length),
    ],
  ])
  if (list.cards.length === 0) doc.paragraph('Bu sınıfta onaylanmış acil durum özeti yok.', 9)
  for (const card of list.cards) {
    doc.section(card.studentName)
    doc.fields([
      ['Acil eylem', card.actionText],
      ['Uyarı', alertText(card)],
      ['İlaç', medicationTodayText(card)],
      ['Acil iletişim', contactsText(card)],
      ...(card.needsReview
        ? ([['Not', 'Sağlık bilgisi değişti; özet yönetimce gözden geçiriliyor.']] as [
            string,
            string,
          ][])
        : []),
    ])
  }
  doc.paragraph(
    'Yalnız yönetimin onayladığı özetler yer alır. Tanı ve ilaç adı yazılmaz; ayrıntı için okul yönetimine başvurun. Acil durumda 112 aranır.',
    8,
  )
  return doc.finish()
}
