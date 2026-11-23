// İş teklif mektubu (DOM-FIN-121; ON-179, K-412): veri mektup ucundan gelir (okuma denetimde),
// gövde metni core `jobOfferLetterParagraphs`'tandır. Kampüs mektubu e-postayla göndermez; PDF
// indirilir ya da yazdırılır. Taslak teklif "TASLAK" ibaresiyle basılır.
import type { JobOfferLetter } from '@kampus/react-shared/use-finance-staff-onboarding.ts'
import {
  JOB_OFFER_STATUS_LABELS,
  jobOfferLetterParagraphs,
  jobOfferWageText,
} from '@kampus/school-core/lib/finance-staff-onboarding.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { STAFF_ROLE_LABELS } from '@kampus/school-core/lib/staff-accounts.ts'
import { COLORS, DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'

export const JOB_OFFER_LETTER_TITLE = 'İş teklif mektubu'

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** Dosya adında aday adı yoktur; teklif kimliğinin başı ayırt etmeye yeter. */
export const jobOfferLetterFilename = (letter: Pick<JobOfferLetter, 'id'>) =>
  `is-teklifi-${letter.id.slice(0, 8)}.pdf`

export function jobOfferLetterDocument(
  measurer: TextMeasurer,
  letter: JobOfferLetter,
): PdfDocument {
  const draft = letter.status === 'draft'
  const reference = letter.id.slice(0, 8).toLocaleUpperCase('tr-TR')
  const doc = new DocumentLayout(measurer, {
    label: JOB_OFFER_LETTER_TITLE.toLocaleUpperCase('tr-TR'),
    badge: draft ? 'TASLAK' : 'İŞ TEKLİFİ',
    institution: letter.institutionName,
    generatedAt: letter.generatedAt,
    reference,
    footerNote: `${letter.institutionName} · iş teklifi · bilgilendirme amaçlıdır, iş sözleşmesi yerine geçmez`,
  })
  doc.heading(
    JOB_OFFER_LETTER_TITLE,
    letter.sentOn === null ? 'Taslak' : `Gönderim ${dayText(letter.sentOn)}`,
  )
  for (const paragraph of jobOfferLetterParagraphs(letter)) doc.paragraph(paragraph, 11)
  doc.section('Teklif koşulları')
  doc.fields([
    ['Aday', letter.candidateName],
    ['Pozisyon', letter.position],
    ['Rol', STAFF_ROLE_LABELS[letter.staffRole]],
    ['İşe başlama', dayText(letter.startDate)],
    ['Ücret önerisi', jobOfferWageText(letter)],
    ...(letter.respondBy === null ? [] : [['Son yanıt günü', dayText(letter.respondBy)] as const]),
    ['Durum', JOB_OFFER_STATUS_LABELS[letter.status]],
  ])
  if (letter.note !== null) {
    doc.section('Ek koşullar')
    doc.paragraph(letter.note, 10)
  }
  doc.paragraph(`Hazırlayan: ${letter.issuedByName}`, 9, COLORS.muted)
  doc.signatures(
    `${letter.institutionName} adına yetkili (ad, imza, kaşe)`,
    'Aday: okudum, kabul ediyorum (ad, imza, tarih)',
  )
  return doc.finish()
}
