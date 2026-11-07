// Eğitim sözleşmesi ve Ek 1 ödeme planı; imza yetkilisi, ödeyici onayı ve ek protokol sürümüyle
// (IST-092; DOM-FIN-010, DOM-FIN-051). Yenileme sözleşmesi dönem geçişini Ek 1'de, plan anındaki
// ücret kararını (artış tavanı, oranlar, indirim kaybı) Ek 2'de yazar (IST-100; DOM-FIN-005, -023).
import {
  CONTRACT_APPROVAL_METHOD_LABELS,
  CONTRACT_STATUS_LABELS,
  contractPlanLines,
  contractStatus,
  SIGNATORY_ROLE_LABELS,
  type ContractPlanLine,
} from '@kampus/school-core/lib/contract-status.ts'
import { money, timeLabel } from '@kampus/school-core/lib/format.ts'
import type { DocumentDataMap } from '@kampus/school-core/lib/document-data.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { DISCOUNT_LINE_LABELS, FEE_ITEM_KIND_LABELS } from '@kampus/school-core/lib/fee-tariffs.ts'
import { contractPaymentTermLabel } from '@kampus/school-core/lib/payment-terms.ts'
import { COLORS, date, DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import { INSTALLMENT_COLUMNS, learnerTerm, studentFields } from './finance-shared.ts'
import {
  renewalAppendix,
  renewalPlanNote,
  renewalPlanSubtitle,
  type RenewalContractContext,
} from './renewal-contract.ts'
import type { TemplateOptions } from './shared.ts'

export type ContractTemplateOptions = TemplateOptions & {
  /** Yenileme ayrıntısından açıldıysa dönem geçişi ve plan anındaki ücret kararı (IST-100). */
  renewal?: RenewalContractContext
  /**
   * Etkin kurumun türü: metindeki kayıtlı kişi okulda "öğrenci", dil okulu ve kursta "kursiyer"dir
   * (ADR 0008 karar 1). Verilmezse okul metni kullanılır.
   */
  institutionType?: InstitutionType
}

const LABELS: Readonly<Record<string, string>> = { ...FEE_ITEM_KIND_LABELS }
const DISCOUNT_LABELS: Readonly<Record<string, string>> = { ...DISCOUNT_LINE_LABELS }
const extraLabel = (kind: string) => LABELS[kind] ?? kind
const discountLabel = (kind: string) => DISCOUNT_LABELS[kind] ?? kind

type ContractData = DocumentDataMap['contract']
type Contract = NonNullable<ContractData['contract']>

/**
 * Ek 1 satırları: onaylı sürümde onay anının kopyası, ek protokol taslağında önerilen plan
 * (DOM-FIN-051); onaysız sözleşmede güncel taksitler. Kopyadaki taksit güncel planda yoksa (ek
 * protokol ya da ayrılış) durum sütunu bunu söyler; tutar onaylanan tutardır.
 */
function planRows(contract: Contract, data: ContractData): (readonly string[])[] {
  const lines = contractPlanLines(contract)
  if (lines === null)
    return data.invoices.map((item) => [
      `${String(item.installment)}. taksit`,
      date(item.dueDate),
      money(item.amount),
      item.status,
    ])
  const live = new Map<string, string>(data.invoices.map((item) => [item.id, item.status]))
  const status = (line: ContractPlanLine) =>
    line.invoiceId === null ? 'Öneri' : (live.get(line.invoiceId) ?? 'Güncel planda yok')
  return lines.map((line) => [
    line.feeKind && line.feeKind !== 'tuition'
      ? extraLabel(line.feeKind)
      : `${String(line.installment)}. taksit`,
    date(line.dueDate),
    money(line.amount),
    status(line),
  ])
}

/** Sözleşmenin tarafı: veli ya da 18 yaş ve üstü kursiyer (DOM-KAY-012). */
function payerLabel(contract: Contract, data: ContractData): string {
  if (contract.payer === 'student') return `Kursiyer · ${data.student.name}`
  return `Veli · ${contract.approval?.payerName || data.parent?.name || 'Ad soyad'}`
}

/** İmza yetkilisi: kurucu ya da kurucu temsilcisi (ÖÖKY m.31/4); işlenmediyse boş imza yeri. */
function signatoryLabel(contract: Contract): string {
  const signatory = contract.signatory
  return signatory
    ? `${SIGNATORY_ROLE_LABELS[signatory.role]} · ${signatory.name}`
    : 'Kurum yetkilisi · Ad soyad / İmza'
}

/** Eğitim sözleşmesi: sözleşme metni ve Ek 1 ödeme planı (taksit tablosu sayfalara bölünür). */
export function contractDocument(
  measurer: TextMeasurer,
  data: ContractData,
  options: ContractTemplateOptions,
): PdfDocument {
  const { contract } = data
  const { renewal } = options
  const pricing = renewal?.pricing ?? null
  const learner = learnerTerm(options.institutionType)
  const learnerLower = learner.toLocaleLowerCase('tr')
  // Tamlayan eki ünlü uyumuyla değişir: öğrencinin / kursiyerin.
  const learnerGenitive = learner === 'Öğrenci' ? 'öğrencinin' : 'kursiyerin'
  if (!contract) throw new Error('Sözleşme kaydı bulunamadı.')
  // Belge yalnız kendi sürümünü bilir; yerini ek protokole bıraktığını sürüm listesi gösterir.
  const status = contractStatus(contract, [contract])
  const revision = contract.revision ?? 1
  const approval = contract.approval
  const doc = new DocumentLayout(measurer, {
    label: contract.amendsContractId
      ? 'EK PROTOKOL'
      : renewal
        ? 'YENİLEME SÖZLEŞMESİ'
        : 'EĞİTİM SÖZLEŞMESİ',
    badge: 'SÖZLEŞME',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: data.reference,
    footerNote:
      'Örnek sözleşme metnidir; kurumun imzalı sözleşmesi veya hukuki belge yerine geçmez.',
  })
  doc.heading(
    contract.title,
    `Sözleşme tarihi: ${date(contract.date)} · Sürüm ${String(revision)} · ${CONTRACT_STATUS_LABELS[status]}`,
  )
  doc.section(`01 / Taraflar ve ${learnerLower} bilgileri`)
  doc.fields(studentFields(data, learner))
  doc.paragraph(
    `Eğitim kurumu: ${options.institution} · ${data.branch?.address || data.branch?.name || 'Okul yönetimi'}`,
    9,
    COLORS.muted,
  )
  if (contract.amendsContractId) {
    // Ek protokol önceki sürümü değiştirmez; önceki sürümün belgesi ayrıca erişilebilir kalır.
    doc.section('Ek protokol')
    doc.fields([
      ['Değiştirdiği sürüm', String(revision - 1)],
      ['Gerekçe', contract.amendmentReason || '—'],
    ])
    doc.paragraph(
      'Bu ek protokol önceki sürümün ödeme planını onaylandığı andan itibaren değiştirir. Önceki sürüm ve onayı değişmeden saklanır.',
      9,
      COLORS.muted,
    )
  }
  doc.section('02 / Eğitim hizmetinin kapsamı')
  doc.paragraph(
    `Bu örnek sözleşme; ${learnerGenitive} kayıtlı olduğu sınıftaki eğitim programını, ders materyallerini, ölçme ve değerlendirme çalışmalarını ve ${learnerLower} / veli portalı erişimini kapsar.`,
  )
  doc.paragraph(
    'Ders programı ve akademik takvim okul yönetimi tarafından paylaşılır. Veli, duyuru ve gelişim raporlarını portal üzerinden takip eder. Yemek, servis ve ek etkinlikler bu eğitim bedeline dahil edilmemiştir.',
  )
  doc.section('03 / Eğitim bedeli ve bilgilendirme')
  // Tarifeli sözleşme karar anının kopyasını taşır (DOM-FIN-010); eski kayıtta yoktur.
  if (contract.grossCents !== undefined)
    doc.fields([
      // Yenilemede indirimsiz ücret ilan ile artış tavanının küçüğüdür (DOM-FIN-005); ilan Ek 2'de.
      // Metin sayfası büyümesin diye alan sayısı aynı kalır.
      [
        pricing ? 'Öğrenim ücreti (ilan ve tavana göre)' : 'İlan ücreti',
        money(contract.grossCents),
      ],
      ...(contract.discounts ?? []).map((line): [string, string] => [
        `${discountLabel(line.kind)} indirimi`,
        `-${money(line.amountCents)}`,
      ]),
      // Burs indirim değildir, ayrı kalemdir (DOM-FIN-025); net bursla düşülmüş tutardır.
      ...(contract.scholarship
        ? [['Burs', `-${money(contract.scholarship.amountCents)}`] as [string, string]]
        : []),
      ['Net öğrenim ücreti', money(contract.netCents ?? contract.amount)],
      ...(contract.extras ?? []).map((line): [string, string] => [
        extraLabel(line.kind),
        money(line.amountCents),
      ]),
      ['Tarife sürümü', String(contract.tariffVersion ?? '—')],
      ...(contract.paymentTerm
        ? [['Ödeme koşulu', contractPaymentTermLabel(contract.paymentTerm)] as [string, string]]
        : []),
      // Öğrenci ödeyici yalnız kursta olur (DOM-KAY-012); imza satırıyla aynı terim kullanılır.
      ['Ödeyici', contract.payer === 'student' ? 'Kursiyer' : 'Veli'],
    ])
  const rows = planRows(contract, data)
  doc.paragraph(
    `${
      rows.length === 0
        ? `Toplam eğitim bedeli ${money(contract.amount)} olarak kaydedilmiştir; tam bursta öğrenim taksiti açılmaz.`
        : `Toplam eğitim bedeli ${money(contract.amount)}; ${String(rows.length)} satırlık ödeme planı Ek 1'dedir.`
    }${pricing ? " Ücret kararı Ek 2'dedir." : ''}`,
  )
  // Bursluya burs belgeleri dışında maddi yükümlülük doğuran belge düzenlenmez (DOM-FIN-025).
  if (contract.scholarship)
    doc.paragraph(
      `Burslu ${learnerLower} için bu sözleşmeye bağlı senet veya taahhüt düzenlenmez.`,
      9,
      COLORS.muted,
    )
  // Metin sayfası tek sayfada kalır: imza ve onay bilgisi kısa satırdır, ayrı bölüm açılmaz.
  doc.paragraph(
    `İmza yetkilisi: ${contract.signatory ? signatoryLabel(contract) : 'Bekleniyor'} · Ödeyici onayı: ${
      approval
        ? `${CONTRACT_APPROVAL_METHOD_LABELS[approval.method]} · ${date(approval.approvedAt)} ${timeLabel(approval.approvedAt)}`
        : 'Bekleniyor'
    }`,
    9,
  )
  doc.paragraph(
    approval
      ? 'Bu sürümün tutarı ve ödeme planı onaylanmıştır; değişiklik yalnız ek protokolle yapılır.'
      : 'Bu metin kayıt sürecini tanıtan bir örnektir; onaylanana kadar imza veya ödeme yükümlülüğü oluşturmaz. Gerçek kayıt koşulları kurumun yürürlükteki sözleşmesiyle belirlenir.',
    9,
    COLORS.muted,
  )
  doc.signatures(payerLabel(contract, data), signatoryLabel(contract))
  doc.newPage()
  doc.heading(
    'Ek 1 / Ödeme planı',
    renewal
      ? renewalPlanSubtitle(data, renewal)
      : `${data.student.name} · ${data.classroom?.name || ''}`,
  )
  doc.highlight(
    'SÖZLEŞME EĞİTİM BEDELİ',
    money(contract.amount),
    rows.length === 0 ? 'Taksit yok' : `${String(rows.length)} taksit`,
  )
  if (rows.length > 0) doc.table(INSTALLMENT_COLUMNS, rows, true)
  else doc.paragraph('Bu sözleşmede ödeme planı satırı bulunmuyor.', 9)
  const snapshot = contractPlanLines(contract) !== null
  // Tahsilat ve bakiye güncel taksitlerden gelir; önerilen ve iptal edilen planda anlamı yoktur.
  if (status !== 'cancelled' && contract.proposedPlan === undefined)
    doc.fields([
      ['Tahsil edilen', money(data.paid)],
      ['Kalan bakiye', money(data.total - data.paid)],
    ])
  if (!snapshot && contract.amount !== data.total)
    doc.paragraph(
      `Güncel taksit toplamı: ${money(data.total)}. Sözleşme bedeli ile güncel plan arasında fark bulunmaktadır; okul muhasebesiyle kontrol edilmelidir.`,
      9,
    )
  doc.paragraph(
    snapshot
      ? 'Plan satırları onaylanan ya da önerilen sürümün kopyasıdır; durum sütunu belgenin oluşturulduğu andaki kayıtları gösterir.'
      : 'Ödeme durumu, belgenin oluşturulduğu andaki kayıtları gösterir. Tamamlanan her tahsilat için ayrı bir dekont alınabilir.',
    9,
    COLORS.muted,
  )
  if (renewal) renewalPlanNote(doc, renewal)
  if (renewal && pricing) renewalAppendix(doc, data, renewal, pricing)
  return doc.finish()
}
