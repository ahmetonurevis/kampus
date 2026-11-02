// Eğitim sözleşmesi ve Ek 1 ödeme planı.
import { money } from '@kampus/school-core/lib/format.ts'
import type { DocumentDataMap } from '@kampus/school-core/lib/document-data.ts'
import {
  FEE_DISCOUNT_KIND_LABELS,
  FEE_ITEM_KIND_LABELS,
} from '@kampus/school-core/lib/fee-tariffs.ts'
import { COLORS, date, DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import { INSTALLMENT_COLUMNS, studentFields } from './finance-shared.ts'
import type { TemplateOptions } from './shared.ts'

const LABELS: Readonly<Record<string, string>> = { ...FEE_ITEM_KIND_LABELS }
const DISCOUNT_LABELS: Readonly<Record<string, string>> = { ...FEE_DISCOUNT_KIND_LABELS }
const extraLabel = (kind: string) => LABELS[kind] ?? kind
const discountLabel = (kind: string) => DISCOUNT_LABELS[kind] ?? kind

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
  doc.heading(contract.title, `Sözleşme tarihi: ${date(contract.date)}`)
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
  // Tarifeli sözleşme karar anının kopyasını taşır (DOM-FIN-010); eski kayıtta yoktur.
  if (contract.grossCents !== undefined)
    doc.fields([
      ['İlan ücreti', money(contract.grossCents)],
      ...(contract.discounts ?? []).map((line): [string, string] => [
        `${discountLabel(line.kind)} indirimi`,
        `-${money(line.amountCents)}`,
      ]),
      ['Net öğrenim ücreti', money(contract.netCents ?? contract.amount)],
      ...(contract.extras ?? []).map((line): [string, string] => [
        extraLabel(line.kind),
        money(line.amountCents),
      ]),
      ['Tarife sürümü', String(contract.tariffVersion ?? '—')],
      ['Ödeyici', contract.payer === 'student' ? 'Öğrenci' : 'Veli'],
    ])
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
