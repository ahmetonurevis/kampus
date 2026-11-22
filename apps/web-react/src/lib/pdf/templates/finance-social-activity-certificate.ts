// Sosyal etkinlik ve gönüllülük belgesi (DOM-FIN-160; ON-170; K-537; DOM-AKD-021): lise
// öğrencisinin onaylı ve ters kayıtla düzeltilmemiş saatleri, gün sırasıyla; öğretim yılı
// toplamları ve ortaöğrenim hedefi. Veri belge ucundan gelir (her basım denetimde), burada yeniden
// hesaplanmaz. Belgenin resmî biçimi ve e-Okul aktarımı doğrulanmalıdır (H-115).
import type { SocialCertificate } from '@kampus/react-shared/use-finance-social-activities.ts'
import {
  hoursLabel,
  SOCIAL_ACTIVITY_KIND_LABELS,
  SOCIAL_ACTIVITY_SCOPE_LABELS,
  SOCIAL_PROGRESS_STATUS_LABELS,
  socialAcademicYearLabel,
} from '@kampus/school-core/lib/finance-social-activities.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { COLORS, DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const SOCIAL_ACTIVITY_CERTIFICATE_TITLE = 'Sosyal etkinlik ve gönüllülük belgesi'

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** Belge numarası: düzenleme günü ve öğrenci kaydı; kişi adı yok. */
export const socialCertificateReference = (
  certificate: Pick<SocialCertificate, 'issuedOn' | 'studentId'>,
) =>
  `SEG-${certificate.issuedOn.replaceAll('-', '')}-${certificate.studentId.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}`

export const socialCertificateFilename = (
  certificate: Pick<SocialCertificate, 'issuedOn' | 'studentId'>,
) => `sosyal-etkinlik-belgesi-${socialCertificateReference(certificate)}.pdf`

export function socialActivityCertificateDocument(
  measurer: TextMeasurer,
  certificate: SocialCertificate,
  options: TemplateOptions,
): PdfDocument {
  const reference = socialCertificateReference(certificate)
  const doc = new DocumentLayout(measurer, {
    label: 'SOSYAL ETKİNLİK BELGESİ',
    badge: SOCIAL_PROGRESS_STATUS_LABELS[certificate.status].toLocaleUpperCase('tr-TR'),
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference,
    footerNote: `${options.institution} sosyal etkinlik kayıtlarından düzenlenmiştir · ${reference}`,
  })
  doc.heading(SOCIAL_ACTIVITY_CERTIFICATE_TITLE, `Belge no ${reference}`)
  doc.fields([
    ['Öğrenci', certificate.studentName],
    ['Sınıf', certificate.className ?? '—'],
    ['Düzenleme', dayText(certificate.issuedOn)],
  ])
  doc.metrics([
    ['ONAYLI SAAT', hoursLabel(certificate.totalMinutes)],
    ['HEDEF', `${String(certificate.totalTargetHours)} saat`],
    ['DURUM', SOCIAL_PROGRESS_STATUS_LABELS[certificate.status]],
  ])
  if (certificate.years.length > 0) {
    doc.section('Öğretim yılına göre')
    doc.fields(
      certificate.years.map(
        (year) => [socialAcademicYearLabel(year.academicYear), hoursLabel(year.minutes)] as const,
      ),
    )
  }
  doc.section('Etkinlikler')
  if (certificate.rows.length === 0)
    doc.paragraph('Onaylanmış sosyal etkinlik ya da gönüllülük saati yok.', 10, COLORS.muted)
  else
    doc.table(
      [
        { header: 'Gün', width: 24 },
        { header: 'Etkinlik', width: 52 },
        { header: 'Tür', width: 34 },
        { header: 'Kuruluş', width: 40 },
        { header: 'Saat', width: 18 },
      ],
      certificate.rows.map((row) => [
        dayText(row.activityDate),
        row.activityName,
        SOCIAL_ACTIVITY_KIND_LABELS[row.activityKind],
        row.organizationName ?? SOCIAL_ACTIVITY_SCOPE_LABELS[row.organizationScope],
        hoursLabel(row.minutes),
      ]),
    )
  doc.paragraph(
    'Yalnız sorumlu öğretmen ya da okul yönetimince onaylanmış saatler yer alır; ters kayıtla düzeltilen saatler belgeye girmez. Sosyal sorumluluk çalışmaları puanlanmaz.',
    8,
    COLORS.muted,
  )
  doc.signatures('Sınıf rehber öğretmeni (ad, imza)', `${options.institution} adına okul müdürü`)
  return doc.finish()
}
