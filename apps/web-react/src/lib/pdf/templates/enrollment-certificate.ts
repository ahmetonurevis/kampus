// Öğrenci belgesi (DOM-KAY-027; ON-049): içerik sunucunun izin listesidir, burada veri eklenmez.
// Kurum belgesidir: resmî belge görünümü, mühür ve imza yoktur; "bilgilendirme amaçlıdır" ibaresi
// hem gövdede hem her sayfanın altbilgisinde yazar (DOM-AKD-050 ilkesi).
import {
  academicYearLabel,
  type EnrollmentCertificate,
} from '@kampus/school-core/lib/enrollment-certificate.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { date, DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import { learnerTerm } from './finance-shared.ts'

/** Resmî karşılığın kaynağı: okulda e-Okul, dil okulu ve kursta e-Özel. */
const OFFICIAL_SOURCE: Readonly<Record<InstitutionType, string>> = {
  school: 'e-Okul',
  language_school: 'e-Özel',
}

export function enrollmentCertificateTitle(type: InstitutionType | undefined): string {
  return `${learnerTerm(type)} belgesi`
}

/** Dosya adında kişi adı ve numara yoktur; belge kimliğinin başı ayırt etmeye yeter. */
export function enrollmentCertificateFilename(
  type: InstitutionType | undefined,
  documentId: string,
): string {
  const prefix = learnerTerm(type) === 'Öğrenci' ? 'ogrenci-belgesi' : 'kursiyer-belgesi'
  return `${prefix}-${documentId.slice(0, 8)}.pdf`
}

function statement(certificate: EnrollmentCertificate): string {
  const standing =
    learnerTerm(certificate.institutionType) === 'Öğrenci' ? 'öğrencisidir' : 'kursiyeridir'
  const year = academicYearLabel(certificate.academicYear)
  const period = year ? `${year} eğitim yılında ` : ''
  return `${certificate.learnerName}, düzenleme tarihi itibarıyla ${certificate.institutionName} kurumunun ${period}kayıtlı ${standing}.`
}

export function enrollmentCertificateDocument(
  measurer: TextMeasurer,
  certificate: EnrollmentCertificate,
): PdfDocument {
  const type = certificate.institutionType
  const learner = learnerTerm(type)
  const title = enrollmentCertificateTitle(type)
  const official = OFFICIAL_SOURCE[type]
  const doc = new DocumentLayout(measurer, {
    label: title.toLocaleUpperCase('tr-TR'),
    badge: 'KURUM BELGESİ',
    institution: certificate.institutionName,
    generatedAt: certificate.issuedAt,
    reference: certificate.documentId,
    footerNote: `Bilgilendirme amaçlıdır; ${official} ve MEB belgesi yerine geçmez.`,
  })
  doc.heading(title)
  doc.paragraph(statement(certificate), 12)
  doc.section('Kayıt bilgileri')
  doc.fields([
    ['Kurum', certificate.institutionName],
    [learner, certificate.learnerName],
    [
      learner === 'Öğrenci' ? 'Okul numarası' : 'Kursiyer numarası',
      certificate.schoolNumber ?? '—',
    ],
    certificate.courseNames.length > 0
      ? ['Kur', certificate.courseNames.join(', ')]
      : ['Sınıf', certificate.className ?? '—'],
    ['Eğitim yılı', academicYearLabel(certificate.academicYear) ?? '—'],
    ['Düzenleme tarihi', date(certificate.issuedAt)],
    ['Belge kimliği', certificate.documentId],
  ])
  doc.paragraph(
    `Bu belge kurumun kendi kayıtlarından bilgilendirme amacıyla üretilmiştir; ${official} veya MEB tarafından düzenlenen resmî belge yerine geçmez.`,
    9,
  )
  return doc.finish()
}
