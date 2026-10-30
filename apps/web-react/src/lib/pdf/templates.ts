// Belge türüne özel şablonlar: veri core `documentData`'dan gelir (hesap burada yeniden
// yazılmaz), burada yalnız hangi bilginin hangi blokta, hangi sırayla yazılacağı vardır.
// Dekont ve sözleşme ayrı şablondur; ortak olan yalnız sayfa iskeleti (`DocumentLayout`).
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import type { DocumentDataMap } from '@kampus/school-core/lib/document-data.ts'
import { COLORS, date, DocumentLayout, type PdfDocument, type TextMeasurer } from './layout.ts'

/** Web'de PDF olarak üretilen belge türleri. */
export type PdfDocumentType = 'receipt' | 'contract' | 'material' | 'payment-plan'

export type TemplateOptions = {
  institution: string
  generatedAt?: Date
}

type Fields = Parameters<DocumentLayout['fields']>[0]

/** Önizleme başlığında kullanılan Türkçe adlar. */
export const DOCUMENT_TITLES = {
  receipt: 'Tahsilat dekontu',
  contract: 'Eğitim sözleşmesi',
  material: 'Ders çalışma kâğıdı',
  'payment-plan': 'Taksit taahhütnamesi',
} as const satisfies Record<PdfDocumentType, string>

const FILE_PREFIXES = {
  receipt: 'dekont',
  contract: 'sozlesme',
  material: 'materyal',
  'payment-plan': 'taksit-plani',
} as const satisfies Record<PdfDocumentType, string>

/** İndirilen dosya adı: kayıt kimliği güvenli karakterlere indirilir, `.pdf` ile biter. */
export function documentFilename(type: PdfDocumentType, recordId: string): string {
  const safe = recordId.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120)
  return `${FILE_PREFIXES[type]}-${safe}.pdf`
}

function studentFields(
  data: DocumentDataMap['receipt'] | DocumentDataMap['contract'] | DocumentDataMap['payment-plan'],
): Fields {
  return [
    ['Öğrenci', data.student.name],
    [
      'Okul numarası / Sınıf',
      `${data.student.number || data.student.id} / ${data.classroom?.name || '—'}`,
    ],
    ['Veli', data.parent?.name || '—'],
    ['Kampüs', data.branch?.name || '—'],
  ]
}

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

const INSTALLMENT_COLUMNS = [
  { header: 'Taksit', width: 25 },
  { header: 'Vade tarihi', width: 45 },
  { header: 'Tutar', width: 56 },
  { header: 'Durum', width: 48 },
] as const

/** Eğitim sözleşmesi: sözleşme metni ve Ek 1 ödeme planı (taksit tablosu sayfalara bölünür). */
export function contractDocument(
  measurer: TextMeasurer,
  data: DocumentDataMap['contract'],
  options: TemplateOptions,
): PdfDocument {
  const { contract } = data
  if (!contract) throw new Error('Sözleşme kaydı bulunamadı.')
  const doc = new DocumentLayout(measurer, {
    label: 'EĞİTİM SÖZLEŞMESİ',
    badge: 'SÖZLEŞME',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: data.reference,
    footerNote:
      'Örnek sözleşme metnidir; kurumun imzalı sözleşmesi veya hukuki belge yerine geçmez.',
  })
  doc.heading('Özel okul eğitim sözleşmesi', `Sözleşme tarihi: ${date(contract.date)}`)
  doc.section('01 / Taraflar ve öğrenci bilgileri')
  doc.fields(studentFields(data))
  doc.paragraph(
    `Eğitim kurumu: ${options.institution} · ${data.branch?.address || data.branch?.name || 'Okul yönetimi'}`,
    9,
    COLORS.muted,
  )
  doc.section('02 / Eğitim hizmetinin kapsamı')
  doc.paragraph(
    'Bu örnek sözleşme; öğrencinin kayıtlı olduğu sınıftaki eğitim programını, ders materyallerini, ölçme ve değerlendirme çalışmalarını ve öğrenci / veli portalı erişimini kapsar.',
  )
  doc.paragraph(
    'Ders programı ve akademik takvim okul yönetimi tarafından paylaşılır. Veli, duyuru ve gelişim raporlarını portal üzerinden takip eder. Yemek, servis ve ek etkinlikler bu eğitim bedeline dahil edilmemiştir.',
  )
  doc.section('03 / Eğitim bedeli ve bilgilendirme')
  doc.paragraph(
    `Toplam eğitim bedeli ${money(contract.amount)} olarak kaydedilmiştir. ${data.invoices.length} taksitlik güncel ödeme takvimi bu belgenin Ek 1 bölümünde yer alır.`,
  )
  doc.paragraph(
    'Bu metin kayıt sürecini tanıtan bir örnektir; imza veya ödeme yükümlülüğü oluşturmaz. Gerçek kayıt koşulları kurumun yürürlükteki sözleşmesiyle belirlenir.',
    9,
    COLORS.muted,
  )
  doc.signatures(`Veli · ${data.parent?.name || 'Ad soyad'}`, 'Kurum yetkilisi · Ad soyad / İmza')
  doc.newPage()
  doc.heading('Ek 1 / Ödeme planı', `${data.student.name} · ${data.classroom?.name || ''}`)
  doc.highlight('SÖZLEŞME EĞİTİM BEDELİ', money(contract.amount), `${data.invoices.length} taksit`)
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
  doc.fields([
    ['Tahsil edilen', money(data.paid)],
    ['Kalan bakiye', money(data.total - data.paid)],
  ])
  if (contract.amount !== data.total)
    doc.paragraph(
      `Güncel taksit toplamı: ${money(data.total)}. Sözleşme bedeli ile güncel plan arasında fark bulunmaktadır; okul muhasebesiyle kontrol edilmelidir.`,
      9,
    )
  doc.paragraph(
    'Ödeme durumu, belgenin oluşturulduğu andaki kayıtları gösterir. Tamamlanan her tahsilat için ayrı bir dekont alınabilir.',
    9,
    COLORS.muted,
  )
  return doc.finish()
}

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

const BLANK = '................................................'

/** Ders çalışma kâğıdı: materyal içeriği ve öğrencinin dolduracağı çözüm alanı. */
export function materialDocument(
  measurer: TextMeasurer,
  data: DocumentDataMap['material'],
  options: TemplateOptions,
): PdfDocument {
  const doc = new DocumentLayout(measurer, {
    label: 'DERS ÇALIŞMA KÂĞIDI',
    badge: 'ÇALIŞMA',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: data.reference,
    footerNote: `${options.institution} · Çalışma belgesidir; resmî belge değildir.`,
  })
  doc.heading(data.title, `${data.subject} · ${data.level}`)
  doc.fields([
    ['Hazırlayan öğretmen', data.teacher?.name],
    ['Yayın tarihi', date(data.createdAt)],
  ])
  doc.fields([
    ['Öğrenci adı soyadı', BLANK],
    ['Sınıf / Numara', BLANK],
  ])
  doc.section('01 / Konuyu hatırlayalım')
  data.content.forEach((text, index) => {
    if (index === 1) doc.section('02 / Uygulama ve yönergeler')
    doc.paragraph(text)
  })
  doc.writingArea('03 / Çözüm ve çalışma alanı', 5)
  return doc.finish()
}
