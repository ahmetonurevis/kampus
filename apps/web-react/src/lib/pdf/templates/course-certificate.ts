// Kurum başarı belgesi (OG-088; IST-081; DOM-DIL-081, 082): belge düzenleme anının kopyasından
// (`content`) üretilir; sunucu metni yeniden hesaplanmaz. Belge "kurum başarı belgesi"dir, seviye
// ifadesi core `certificateLevelStatement` biçimindedir; "CEFR sertifikası", "Avrupa Konseyi" gibi
// ifadeler ve MEB amblemi kullanılmaz. Doğrulama kodu ve QR (kimliksiz doğrulama sayfasının adresi)
// belgede yer alır. İptal edilmiş belge "İPTAL EDİLDİ" işaretiyle üretilir: personel arşiv için
// görür; öğrenci ve veli iptal edilmiş belgeyi API'den hiç almaz.
import type { CourseCertificate } from '@kampus/react-shared/use-course-certificates.ts'
import {
  CERTIFICATE_TITLE,
  containsForbiddenPhrase,
} from '@kampus/school-core/cefr/certificates.ts'
import { SKILLS } from '@kampus/school-core/content/taxonomy.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import {
  COLORS,
  date,
  DocumentLayout,
  PAGE,
  type PdfDocument,
  type QrModules,
  type TextMeasurer,
} from '../layout.ts'

export type CourseCertificateOptions = {
  /** Kimliksiz doğrulama sayfasının tam adresi (QR bunu taşır). */
  verificationUrl: string
  /** QR matrisi (`qr.ts`, tembel yüklenir). */
  qr: QrModules
}

/** Devam oranı binde tamsayıdan: "%91,6". */
export function attendanceLabel(permille: number): string {
  return `%${(permille / 10).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`
}

/** Belgenin bütün metni; yasak ifade denetimi (DOM-DIL-081) bu metinler üzerinde yapılır. */
export function documentTexts(document: PdfDocument): string[] {
  return document.pages.flatMap((page) =>
    page.ops.flatMap((op) => (op.kind === 'text' ? [op.text] : [])),
  )
}

const CANCELLED_MARK = 'İPTAL EDİLDİ'

export function courseCertificateDocument(
  measurer: TextMeasurer,
  certificate: CourseCertificate,
  options: CourseCertificateOptions,
): PdfDocument {
  const { content } = certificate
  const cancelled = certificate.status === 'cancelled'
  const doc = new DocumentLayout(measurer, {
    label: CERTIFICATE_TITLE.toLocaleUpperCase('tr-TR'),
    badge: cancelled ? CANCELLED_MARK : 'BAŞARI BELGESİ',
    institution: content.institutionName,
    generatedAt: certificate.issuedAt,
    reference: certificate.number,
    footerNote: `${content.institutionName} · Kurum değerlendirmesine dayanır; resmî Kurs Bitirme Belgesi yerine geçmez.`,
  })
  doc.heading(CERTIFICATE_TITLE)

  if (cancelled) {
    const cancelledAt = 'cancelledAt' in certificate ? certificate.cancelledAt : null
    doc.ensure(16)
    doc.box(PAGE.left, doc.y, PAGE.contentWidth, 11, COLORS.orangeSoft, 3)
    doc.text(CANCELLED_MARK, PAGE.left + 5, doc.y + 7.5, 12, COLORS.orangeInk)
    doc.text(
      `Bu belge ${cancelledAt ? `${date(cancelledAt)} tarihinde ` : ''}iptal edilmiştir; geçerli değildir.`,
      PAGE.right - 5,
      doc.y + 7,
      9,
      COLORS.orangeInk,
      'right',
    )
    doc.y += 16
  }

  doc.paragraph(
    `${content.learnerName}, ${content.courseName} kurunu tamamlamış ve ${content.levelStatement} başarı göstermiştir.`,
    12,
  )
  doc.fields([
    ['Kursiyer', content.learnerName],
    ['Kur', content.courseName],
    ['Toplam ders saati', `${content.totalHours} saat`],
    [
      'Devam oranı',
      `${attendanceLabel(content.attendance.permille)} (${content.attendance.attendedHours} / ${content.attendance.totalHours} saat)`,
    ],
    ['Seviye', content.levelStatement],
    ['Kur sonu değerlendirmesi', `${content.finalScore} / 100`],
  ])

  doc.section('Beceri profili (kur sonu, 100 üzerinden)')
  doc.metrics(content.skills.map(({ skill, score }) => [SKILLS[skill].label, String(score)]))

  // Belge bilgisi ve doğrulama bloğu bölünmez: QR, numara, tarih, kod ve adres aynı sayfada kalır.
  const qrSize = 34
  const textX = PAGE.left + qrSize + 8
  const urlLines = doc.wrap(options.verificationUrl, PAGE.right - textX, 8)
  const blockHeight = Math.max(qrSize, 32 + urlLines.length * 4)
  doc.ensure(24 + blockHeight + 14)
  doc.section('Belge bilgisi ve doğrulama')
  const top = doc.y
  doc.qrCode(options.qr, PAGE.left, top, qrSize)
  const pairs = [
    ['Belge numarası', certificate.number, 10, COLORS.ink],
    ['Düzenlenme tarihi', date(certificate.issuedAt), 10, COLORS.ink],
    ['Doğrulama kodu', certificate.verificationCode, 11, COLORS.sapphire],
  ] as const
  pairs.forEach(([label, value, size, color], index) => {
    const y = top + 2 + index * 10
    doc.text(label, textX, y, 8, COLORS.muted)
    doc.text(value, textX, y + 5, size, color)
  })
  urlLines.forEach((part, index) => doc.text(part, textX, top + 33 + index * 4, 8, COLORS.muted))
  doc.y = top + blockHeight + 5
  doc.paragraph(
    'Geçerliliği QR kodu okutarak ya da doğrulama kodunu yukarıdaki adrese girerek denetleyin.',
    8,
    COLORS.muted,
  )

  const document = doc.finish()
  // Kur ya da kurum adı yasak ifade taşıyorsa sunucu belgeyi zaten düzenlemez (DOM-DIL-081);
  // şablon metni de aynı denetimden geçer, sonradan eklenen metin yasak ifadeyi belgeye sokamaz.
  // Satırlar birleştirilerek de bakılır: ifade iki satıra bölünmüş olabilir.
  const texts = documentTexts(document)
  if (texts.some(containsForbiddenPhrase) || containsForbiddenPhrase(texts.join(' '))) {
    throw new DomainError(
      'certificate_wording_forbidden',
      'Belgede “CEFR sertifikası” ya da “Avrupa Konseyi” gibi ifadeler yer alamaz.',
    )
  }
  return document
}
