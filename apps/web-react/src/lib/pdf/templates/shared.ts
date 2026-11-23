// Belge şablonlarının ortak türleri: belge türü listesi, önizleme başlığı ve dosya adı.
// Belge türüne özel içerik kendi dosyasındadır; burada yalnız hepsinin kullandığı tanımlar bulunur.
/** Web'de PDF olarak üretilen belge türleri. */
export type PdfDocumentType =
  | 'receipt'
  | 'contract'
  | 'material'
  | 'payment-plan'
  | 'homework'
  | 'submission'
  | 'payment-receipt'
  | 'refund-statement'
  | 'student-statement'
  | 'course-certificate'

export type TemplateOptions = {
  institution: string
  generatedAt?: Date
}

/** Önizleme başlığında kullanılan Türkçe adlar. */
export const DOCUMENT_TITLES = {
  receipt: 'Tahsilat dekontu',
  contract: 'Eğitim sözleşmesi',
  material: 'Ders çalışma kâğıdı',
  'payment-plan': 'Taksit taahhütnamesi',
  homework: 'Ödev çalışma kâğıdı',
  submission: 'Ödev değerlendirme formu',
  'payment-receipt': 'Tahsilat dekontu',
  'refund-statement': 'İade hesap kırılımı',
  'student-statement': 'Cari ekstre',
  'course-certificate': 'Kurum başarı belgesi',
} as const satisfies Record<PdfDocumentType, string>

const FILE_PREFIXES = {
  receipt: 'dekont',
  contract: 'sozlesme',
  material: 'materyal',
  'payment-plan': 'taksit-plani',
  homework: 'odev',
  submission: 'odev-degerlendirme',
  'payment-receipt': 'dekont',
  'refund-statement': 'iade-kirilimi',
  'student-statement': 'cari-ekstre',
  'course-certificate': 'basari-belgesi',
} as const satisfies Record<PdfDocumentType, string>

/** İndirilen dosya adı: kayıt kimliği güvenli karakterlere indirilir, `.pdf` ile biter. */
export function documentFilename(type: PdfDocumentType, recordId: string): string {
  const safe = recordId.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120)
  return `${FILE_PREFIXES[type]}-${safe}.pdf`
}

export const BLANK = '................................................'
