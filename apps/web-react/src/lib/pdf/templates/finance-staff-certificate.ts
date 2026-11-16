// Personel çalışma ve hizmet belgesi (DOM-FIN-106; ON-175): veri belge ucunun dondurulmuş
// içeriğidir (K-341), burada yeniden hesaplanmaz; kurum başlığı da üretim anındaki addır. Gövde
// metni core `staffCertificateParagraphs`'tandır. İptal edilen belge "İptal edildi" ibaresiyle
// basılır. İçerik kuralı doğrulanmalıdır (H-59, H-60).
import type { StaffCertificateDocument } from '@kampus/react-shared/use-finance-staff-certificates.ts'
import {
  STAFF_CERTIFICATE_KIND_LABELS,
  staffCertificateLabel,
  staffCertificateParagraphs,
  staffCertificateServiceText,
  staffCertificateWageText,
} from '@kampus/school-core/lib/finance-staff-certificates.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { COLORS, DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'

export const STAFF_CERTIFICATE_TITLE = 'Personel belgesi'

const AT = { year: 'numeric', hour: '2-digit', minute: '2-digit' } as const
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** Dosya adında kişi adı yoktur; tür ve belge numarası ayırt etmeye yeter. */
export function staffCertificateFilename(
  certificate: Pick<StaffCertificateDocument, 'kind' | 'certificateYear' | 'certificateNumber'>,
): string {
  const prefix = certificate.kind === 'service' ? 'hizmet-belgesi' : 'calisma-belgesi'
  return `${prefix}-${staffCertificateLabel(certificate)}.pdf`
}

export function staffCertificateDocument(
  measurer: TextMeasurer,
  certificate: StaffCertificateDocument,
): PdfDocument {
  const title = STAFF_CERTIFICATE_KIND_LABELS[certificate.kind]
  const number = staffCertificateLabel(certificate)
  const cancelled = certificate.cancelledAt !== null
  const doc = new DocumentLayout(measurer, {
    label: title.toLocaleUpperCase('tr-TR'),
    badge: cancelled ? 'İPTAL EDİLDİ' : 'PERSONEL BELGESİ',
    institution: certificate.institutionName,
    generatedAt: certificate.createdAt,
    reference: number,
    footerNote: `${certificate.institutionName} personel kayıtlarından düzenlenmiştir · ${number}`,
  })
  doc.heading(
    title,
    cancelled
      ? `İptal edildi · ${dateLabel(certificate.cancelledAt ?? '', AT)}`
      : `Belge no ${number} · ${dateLabel(certificate.createdAt, { year: 'numeric' })}`,
  )
  doc.paragraph(certificate.addressee.toLocaleUpperCase('tr-TR'), 11)
  for (const paragraph of staffCertificateParagraphs(certificate)) doc.paragraph(paragraph, 11)
  doc.section('Belge bilgileri')
  const wage = staffCertificateWageText(certificate)
  const period = staffCertificateServiceText(certificate)
  doc.fields([
    ['Belge no', number],
    ['Düzenleme', dateLabel(certificate.createdAt, AT)],
    ['Personel', certificate.staffName],
    ...(certificate.identityNumber === null
      ? []
      : [['T.C. kimlik no', certificate.identityNumber] as const]),
    ['Görev', certificate.position],
    ['İşe giriş', dayText(certificate.hireDate)],
    ...(certificate.exitDate === null
      ? []
      : [['İşten ayrılış', dayText(certificate.exitDate)] as const]),
    ...(period === null ? [] : [['Hizmet süresi', period] as const]),
    ...(wage === null ? [] : [['Ücret', wage] as const]),
    ['Durum', cancelled ? 'İptal edildi' : 'Geçerli'],
  ])
  if (cancelled && certificate.cancelReason !== null)
    doc.paragraph(`İptal gerekçesi: ${certificate.cancelReason}`, 9, COLORS.muted)
  doc.signatures(
    `Düzenleyen: ${certificate.issuedByName}`,
    `${certificate.institutionName} adına yetkili (ad, imza, kaşe)`,
  )
  return doc.finish()
}
