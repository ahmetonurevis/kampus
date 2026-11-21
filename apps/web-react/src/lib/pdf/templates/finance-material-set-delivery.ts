// Materyal seti teslim tutanağı ve toplu teslim listesi (DOM-FIN-080; ON-338). Tutanak tek teslimin
// kurumunu, setini, kalemlerini, öğrencisini (sınıf ya da kur grubu), teslim alanını, teslim eden
// personeli, teslim gününü ve iki imza alanını yazar. Ücret yalnız "tahakkuk edildi/edilmedi"
// olarak geçer; tutar ve ödeme durumu belgeye girmez (K-207, K-218). İptal edilmiş teslimin
// tutanağı arşiv için "İPTAL" işaretiyle üretilir. Liste, ekrandaki süzgeçle eşleşen öğrencileri
// kâğıtta imzalatmak için boş imza sütunuyla verir (K-219).
import type {
  MaterialDeliveryDetail,
  MaterialSetDetail,
  MaterialStudentRow,
} from '@kampus/react-shared/use-finance-material-sets.ts'
import { academicYearName } from '@kampus/school-core/lib/academic-years.ts'
import { STOCK_UNIT_LABELS } from '@kampus/school-core/lib/finance-inventory.ts'
import {
  MATERIAL_RECIPIENT_KIND_LABELS,
  materialSetTargetLabel,
} from '@kampus/school-core/lib/finance-material-sets.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import { COLORS, DocumentLayout, PAGE, type PdfDocument, type TextMeasurer } from '../layout.ts'
import { learnerTerm, type LearnerTermOptions } from './finance-shared.ts'
import type { TemplateOptions } from './shared.ts'

export const MATERIAL_DELIVERY_TITLE = 'Materyal teslim tutanağı'
export const MATERIAL_DELIVERY_LIST_TITLE = 'Materyal teslim listesi'
export const DELIVERY_CANCELLED_MARK = 'İPTAL EDİLDİ'
export const FEE_CHARGED_TEXT = 'Tahakkuk edildi'
export const FEE_NOT_CHARGED_TEXT = 'Tahakkuk edilmedi'

type Options = TemplateOptions & LearnerTermOptions

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const timeText = (value: string) =>
  dateLabel(value, { year: 'numeric', hour: '2-digit', minute: '2-digit' })
const shortId = (id: string) => id.replace(/-/g, '').slice(0, 8).toUpperCase()

/** Tutanak numarası: teslim kimliğinin ilk sekiz karakteri (K-218), ör. `MT-3F2A9C1D`. */
export const materialDeliveryNumber = (delivery: Pick<MaterialDeliveryDetail, 'id'>) =>
  `MT-${shortId(delivery.id)}`

export const materialDeliveryFilename = (delivery: Pick<MaterialDeliveryDetail, 'id'>) =>
  `materyal-teslim-tutanagi-${materialDeliveryNumber(delivery)}.pdf`

/** Liste numarası: setin kimliği (liste her üretimde yeniden çizilir, numara set başınadır). */
export const materialDeliveryListNumber = (set: Pick<MaterialSetDetail, 'id'>) =>
  `ML-${shortId(set.id)}`

export const materialDeliveryListFilename = (
  set: Pick<MaterialSetDetail, 'id'>,
  generatedAt: Date,
) => `materyal-teslim-listesi-${materialDeliveryListNumber(set)}-${dayKey(generatedAt)}.pdf`

/** Teslim alan: öğrencinin kendisi ya da yazılı ad ve türü (kayıtlı veli, başka kişi). */
export function materialRecipientText(
  delivery: Pick<MaterialDeliveryDetail, 'recipientKind' | 'recipientName'> & {
    studentName?: string
  },
): string {
  if (delivery.recipientKind === 'student') {
    const label = MATERIAL_RECIPIENT_KIND_LABELS.student
    return delivery.studentName
      ? `${delivery.studentName} (${label.toLocaleLowerCase('tr')})`
      : label
  }
  const kind = MATERIAL_RECIPIENT_KIND_LABELS[delivery.recipientKind].toLocaleLowerCase('tr')
  return `${delivery.recipientName ?? '—'} (${kind})`
}

const itemsText = (items: MaterialSetDetail['items']) =>
  items
    .map((item) => `${item.name} × ${String(item.quantity)} ${STOCK_UNIT_LABELS[item.unit]}`)
    .join('; ')

function cancelledBand(doc: DocumentLayout, delivery: MaterialDeliveryDetail) {
  doc.ensure(16)
  doc.box(PAGE.left, doc.y, PAGE.contentWidth, 11, COLORS.orangeSoft, 3)
  doc.text(DELIVERY_CANCELLED_MARK, PAGE.left + 5, doc.y + 7.5, 12, COLORS.orangeInk)
  doc.text(
    'Bu teslim iptal edilmiştir; tutanak geçerli değildir.',
    PAGE.right - 5,
    doc.y + 7,
    9,
    COLORS.orangeInk,
    'right',
  )
  doc.y += 16
  doc.paragraph(
    `İptal: ${delivery.cancelledByName ?? '—'} · ${timeText(delivery.cancelledAt ?? '')} · Gerekçe: ${delivery.cancelReason ?? '—'}`,
    9,
    COLORS.orangeInk,
  )
}

const ITEM_COLUMNS = [
  { header: 'Sıra', width: 14 },
  { header: 'Kod', width: 32 },
  { header: 'Ürün', width: 88 },
  { header: 'Miktar', width: 40 },
] as const

/** Tek teslimin tutanağı: kalem tablosu ve teslim eden/teslim alan imzaları. */
export function materialDeliveryDocument(
  measurer: TextMeasurer,
  delivery: MaterialDeliveryDetail,
  options: Options,
): PdfDocument {
  const cancelled = delivery.cancelledAt !== null
  const number = materialDeliveryNumber(delivery)
  const learner = learnerTerm(options.institutionType)
  const recipient = materialRecipientText(delivery)
  const staff = delivery.createdByName ?? '—'
  const doc = new DocumentLayout(measurer, {
    label: 'MATERYAL TESLİM TUTANAĞI',
    badge: cancelled ? 'İPTAL' : 'TESLİM',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: number,
    footerNote: 'Kurum içi teslim tutanağıdır; imzalı nüshası kurumda saklanır.',
  })
  doc.heading(MATERIAL_DELIVERY_TITLE, number)
  if (cancelled) cancelledBand(doc, delivery)
  doc.fields([
    ['Kurum', options.institution],
    ['Set', `${delivery.setName} · ${academicYearName(delivery.academicYear)}`],
    [learner, delivery.studentName],
    [`${learner} numarası`, delivery.studentNumber ?? '—'],
    ['Sınıf / grup', delivery.className ?? '—'],
    ['Teslim günü', dayText(delivery.deliveryDate)],
    ['Teslim alan', recipient],
    ['Teslim eden (personel)', staff],
    ['Çıkış deposu', delivery.warehouseName],
    ['Materyal ücreti', delivery.hasMaterialFee ? FEE_CHARGED_TEXT : FEE_NOT_CHARGED_TEXT],
  ])
  doc.section('Kalemler')
  doc.table(
    ITEM_COLUMNS,
    delivery.items.map((item, index) => [
      String(index + 1),
      item.code,
      item.name,
      `${String(item.quantity)} ${STOCK_UNIT_LABELS[item.unit]}`,
    ]),
    true,
  )
  doc.paragraph(
    'Tutanak ödeme belgesi değildir: materyal ücretinin yalnız tahakkuk edilip edilmediği yazılır, tutar ve ödeme durumu yazılmaz. Teslim alan, yukarıdaki kalemleri eksiksiz teslim aldığını imzasıyla onaylar.',
    8,
  )
  doc.signatures(`Teslim eden · ${staff}`, `Teslim alan · ${recipient}`, true)
  return doc.finish()
}

const LIST_COLUMNS = [
  { header: 'Sıra', width: 12 },
  { header: 'Öğrenci', width: 42 },
  { header: 'No', width: 18 },
  { header: 'Sınıf / grup', width: 26 },
  { header: 'Teslim günü', width: 24 },
  { header: 'Teslim alan', width: 28 },
  { header: 'İmza', width: 24 },
] as const

export type MaterialDeliveryListInput = {
  set: MaterialSetDetail
  rows: readonly MaterialStudentRow[]
  /** Ekrandaki süzgecin kısa açıklaması; süzgeç yoksa "Bütün öğrenciler". */
  filter: string
}

/**
 * Setin toplu teslim listesi: ekrandaki süzgeçle eşleşen öğrenciler ada göre, teslim edilmişte
 * teslim günü ve teslim alan, edilmemişte boş (kâğıtta doldurulur); imza sütunu her satırda boştur.
 * Ücret işareti listeye girmez (K-219).
 */
export function materialDeliveryListDocument(
  measurer: TextMeasurer,
  { set, rows, filter }: MaterialDeliveryListInput,
  options: Options,
): PdfDocument {
  const learner = learnerTerm(options.institutionType)
  const delivered = rows.filter((row) => row.delivery !== null).length
  const doc = new DocumentLayout(measurer, {
    label: 'MATERYAL TESLİM LİSTESİ',
    badge: 'TESLİM LİSTESİ',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: materialDeliveryListNumber(set),
    footerNote: 'Kurum içi teslim listesidir; imzalı nüshası kurumda saklanır.',
  })
  doc.heading(MATERIAL_DELIVERY_LIST_TITLE, set.name)
  doc.fields([
    ['Kurum', options.institution],
    ['Set', `${set.name} · ${academicYearName(set.academicYear)}`],
    ['Hedef', materialSetTargetLabel(set)],
    ['Liste', filter],
    ['Kalemler (kişi başına)', itemsText(set.items)],
  ])
  doc.metrics([
    [learner.toLocaleUpperCase('tr'), String(rows.length)],
    ['TESLİM EDİLEN', String(delivered)],
    ['BEKLEYEN', String(rows.length - delivered)],
  ])
  doc.section('Teslim listesi')
  doc.table(
    LIST_COLUMNS.map((column) =>
      column.header === 'Öğrenci' ? { ...column, header: learner } : column,
    ),
    rows.map((row, index) => [
      String(index + 1),
      row.studentName,
      row.studentNumber ?? '',
      row.className ?? '',
      row.delivery === null ? '' : dayText(row.delivery.deliveryDate),
      row.delivery === null ? '' : materialRecipientText(row.delivery),
      '',
    ]),
  )
  doc.paragraph(
    'Teslim edilmemiş satırda teslim günü ve teslim alan kâğıtta doldurulur; teslim ekrandan ayrıca kaydedilir.',
    8,
  )
  doc.signatures('Dağıtımı yapan personel', 'Kurum yetkilisi', true)
  return doc.finish()
}
