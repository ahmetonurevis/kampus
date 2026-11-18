// Mezun belgeleri (DOM-KAY-044; ON-260): öğrenim belgesi ve not dökümü. İçerik sunucunun hazır
// anında dondurduğu izin listesidir, burada veri eklenmez. Kurum belgesidir: resmî belge görünümü,
// mühür ve imza yoktur; "bilgilendirme amaçlıdır" ibaresi gövdede ve her sayfanın altbilgisinde
// yazar (DOM-AKD-050 ilkesi). Diploma örneği PDF üretmez, taranmış dosyası açılır.
import type {
  AlumniDocumentContent,
  AlumniDocumentType,
} from '@kampus/school-core/lib/enrollment-alumni-documents.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { date, DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import { learnerTerm } from './finance-shared.ts'

export interface AlumniDocumentPdfData {
  documentNumber: string
  documentType: AlumniDocumentType
  copies: number
  issuedAt: string
  manualNote: string | null
  content: AlumniDocumentContent
}

const OFFICIAL_SOURCE: Readonly<Record<InstitutionType, string>> = {
  school: 'e-Okul',
  language_school: 'e-Özel',
}

export function alumniDocumentTitle(content: AlumniDocumentContent): string {
  if (content.kind === 'education_certificate') return 'Öğrenim belgesi'
  return content.institutionType === 'school' ? 'Not dökümü' : 'Kur dökümü'
}

/** Dosya adında kişi adı yoktur; belge numarası ayırt etmeye yeter. */
export function alumniDocumentFilename(data: AlumniDocumentPdfData): string {
  const prefix = data.content.kind === 'education_certificate' ? 'ogrenim-belgesi' : 'not-dokumu'
  return `${prefix}-${data.documentNumber.toLowerCase()}.pdf`
}

const day = (value: string | null) => (value === null ? '—' : date(`${value}T09:00:00.000Z`))

function statement(content: AlumniDocumentContent): string {
  const learner = learnerTerm(content.institutionType).toLocaleLowerCase('tr-TR')
  const since = content.enrolledDate === null ? '' : `${day(content.enrolledDate)} tarihinden `
  const until = content.leftDate === null ? '' : `${day(content.leftDate)} tarihine kadar `
  const outcome =
    content.outcome === 'graduated'
      ? 'öğrenim görmüş ve mezun olmuştur'
      : 'öğrenim görmüş ve kurumdan ayrılmıştır'
  return `${content.learnerName}, ${content.institutionName} kurumunda ${since}${until}${learner} olarak ${outcome}.`
}

export function alumniDocumentPdf(
  measurer: TextMeasurer,
  data: AlumniDocumentPdfData,
): PdfDocument {
  const { content } = data
  const title = alumniDocumentTitle(content)
  const learner = learnerTerm(content.institutionType)
  const official = OFFICIAL_SOURCE[content.institutionType]
  const doc = new DocumentLayout(measurer, {
    label: title.toLocaleUpperCase('tr-TR'),
    badge: 'KURUM BELGESİ',
    institution: content.institutionName,
    generatedAt: data.issuedAt,
    reference: data.documentNumber,
    footerNote: `Bilgilendirme amaçlıdır; ${official} ve MEB belgesi yerine geçmez.`,
  })
  doc.heading(title)
  doc.paragraph(statement(content), 12)
  doc.section('Kayıt bilgileri')
  doc.fields([
    ['Kurum', content.institutionName],
    [learner, content.learnerName],
    [learner === 'Öğrenci' ? 'Okul numarası' : 'Kursiyer numarası', content.schoolNumber ?? '—'],
    ['Kayıt tarihi', day(content.enrolledDate)],
    [
      content.outcome === 'graduated' ? 'Mezuniyet tarihi' : 'Ayrılış tarihi',
      day(content.leftDate),
    ],
    ['Durum', content.outcome === 'graduated' ? 'Mezun' : 'Ayrıldı'],
    ...(content.lastClassName === null ? [] : ([['Son sınıf', content.lastClassName]] as const)),
    ['Belge numarası', data.documentNumber],
    ['Düzenleme tarihi', date(data.issuedAt)],
  ])
  if (content.kind === 'transcript') {
    if (content.terms.length > 0) {
      doc.section('Ders ortalamaları')
      doc.table(
        [
          { header: 'Sınıf', width: 30 },
          { header: 'Dönem', width: 22 },
          { header: 'Ders', width: 78 },
          { header: 'Ortalama', width: 24 },
          { header: 'Not sayısı', width: 26 },
        ],
        content.terms.flatMap((term) =>
          term.subjects.map((subject) => [
            term.className,
            `${String(term.term)}. dönem`,
            subject.name,
            String(subject.average),
            String(subject.count),
          ]),
        ),
      )
    }
    if (content.courses.length > 0) {
      doc.section('Katıldığı kurlar')
      doc.table(
        [
          { header: 'Kur', width: 50 },
          { header: 'Seviye', width: 22 },
          { header: 'Grup', width: 50 },
          { header: 'Başlangıç', width: 29 },
          { header: 'Bitiş', width: 29 },
        ],
        content.courses.map((course) => [
          course.name,
          course.level,
          course.groupName,
          day(course.startDate),
          day(course.endDate),
        ]),
      )
    }
    if (content.terms.length === 0 && content.courses.length === 0)
      doc.paragraph('Kurum kayıtlarında not ya da kur bilgisi bulunmamaktadır.', 10)
  }
  if (data.manualNote !== null) {
    doc.section('Açıklama')
    doc.paragraph(data.manualNote, 10)
  }
  doc.paragraph(
    `Bu belge kurumun kendi kayıtlarından ilgilinin talebi üzerine bilgilendirme amacıyla üretilmiştir; ${official} veya MEB tarafından düzenlenen resmî belge yerine geçmez.`,
    9,
  )
  return doc.finish()
}
