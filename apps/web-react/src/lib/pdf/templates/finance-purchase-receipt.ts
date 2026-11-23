// Mal kabul tutanağı (DOM-FIN-074; ON-337): sipariş, tedarikçi (sipariş anı kopyası), kabul günü,
// teslim alan, kalem bazında sipariş/kabul/ret miktarı, ret nedeni, KDV hariç birim fiyat ve tutar,
// stok deposu, toplam ve iki imza alanı. Rakamlar API yanıtından gelir, burada yeniden hesaplanmaz.
// Şahıs tedarikçide vergi numarası yanıtta yoktur, tutanağa da girmez (K-215); numara kayıt
// sırasıdır (K-216). İptal edilmiş kabulün tutanağı arşiv için "İPTAL EDİLDİ" işaretiyle üretilir.
import type {
  PurchaseReceipt,
  PurchaseReceiptBoard,
} from '@kampus/react-shared/use-finance-purchase-receipts.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { PURCHASE_UNIT_LABELS } from '@kampus/school-core/lib/finance-purchase-requests.ts'
import { SUPPLIER_TYPE_LABELS } from '@kampus/school-core/lib/finance-suppliers.ts'
import { COLORS, DocumentLayout, PAGE, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const PURCHASE_RECEIPT_TITLE = 'Mal kabul tutanağı'
export const RECEIPT_CANCELLED_MARK = 'İPTAL EDİLDİ'

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const timeText = (value: string) =>
  dateLabel(value, { year: 'numeric', hour: '2-digit', minute: '2-digit' })

const COLUMNS = [
  { header: 'Kalem', width: 40 },
  { header: 'Sipariş', width: 20 },
  { header: 'Kabul', width: 20 },
  { header: 'Ret', width: 16 },
  { header: 'Ret nedeni', width: 32 },
  { header: 'Birim fiyat', width: 22 },
  { header: 'Tutar', width: 24 },
] as const

type ReceiptOrder = PurchaseReceiptBoard['order']

/** Tutanak numarası: sipariş numarası ve kabulün kayıt sırası (K-216), ör. `SA-2026-0007-MK2`. */
export const purchaseReceiptNumber = (
  order: Pick<ReceiptOrder, 'number'>,
  receipt: Pick<PurchaseReceipt, 'sequence'>,
) => `${order.number}-MK${String(receipt.sequence)}`

export const purchaseReceiptFilename = (
  order: Pick<ReceiptOrder, 'number'>,
  receipt: Pick<PurchaseReceipt, 'sequence'>,
) => `mal-kabul-tutanagi-${purchaseReceiptNumber(order, receipt)}.pdf`

type Field = readonly [label: string, value: string]

function supplierFields(supplier: ReceiptOrder['supplier']): Field[] {
  const name: Field = ['Tedarikçi', `${supplier.name} (${SUPPLIER_TYPE_LABELS[supplier.type]})`]
  // Şahıs tedarikçide vergi dairesi ve TCKN gelmez (K-215).
  if (supplier.taxNumber === null) return [name]
  return [
    name,
    ['Vergi dairesi / numarası', `${supplier.taxOffice ?? '—'} / ${supplier.taxNumber}`],
  ]
}

function cancelledBand(doc: DocumentLayout, receipt: PurchaseReceipt) {
  doc.ensure(16)
  doc.box(PAGE.left, doc.y, PAGE.contentWidth, 11, COLORS.orangeSoft, 3)
  doc.text(RECEIPT_CANCELLED_MARK, PAGE.left + 5, doc.y + 7.5, 12, COLORS.orangeInk)
  doc.text(
    'Bu kabul iptal edilmiştir; tutanak geçerli değildir.',
    PAGE.right - 5,
    doc.y + 7,
    9,
    COLORS.orangeInk,
    'right',
  )
  doc.y += 16
  doc.paragraph(
    `İptal: ${receipt.cancelledByName ?? '—'} · ${timeText(receipt.cancelledAt ?? '')} · Gerekçe: ${receipt.cancelReason ?? '—'}`,
    9,
    COLORS.orangeInk,
  )
}

/** Mal kabul tutanağı PDF'i: tek kabul kaydı, kalem tablosu, toplam ve teslim imzaları. */
export function purchaseReceiptDocument(
  measurer: TextMeasurer,
  order: ReceiptOrder,
  receipt: PurchaseReceipt,
  options: TemplateOptions,
): PdfDocument {
  const cancelled = receipt.cancelledAt !== null
  const number = purchaseReceiptNumber(order, receipt)
  const doc = new DocumentLayout(measurer, {
    label: 'MAL KABUL TUTANAĞI',
    badge: cancelled ? 'İPTAL' : 'MAL KABUL',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: number,
    footerNote: 'Kurum içi teslim tutanağıdır; fatura veya irsaliye yerine geçmez.',
  })
  doc.heading(PURCHASE_RECEIPT_TITLE, number)
  if (cancelled) cancelledBand(doc, receipt)
  doc.fields([
    ['Kurum', options.institution],
    ['Sipariş no', order.number],
    ...supplierFields(order.supplier),
    ['Kabul günü', dayText(receipt.receiptDate)],
    ['Teslim alan', receipt.receivedBy],
    ...(receipt.warehouseName ? ([['Stok deposu', receipt.warehouseName]] satisfies Field[]) : []),
    ['Kaydeden', `${receipt.createdByName ?? '—'} · ${timeText(receipt.createdAt)}`],
    // Not alanlarla birlikte yazılır ki kısa tutanak imzalarıyla tek sayfaya sığsın.
    ...(receipt.inspectionNote
      ? ([['Muayene notu', receipt.inspectionNote]] satisfies Field[])
      : []),
  ])
  doc.metrics([
    ['KALEM', String(receipt.lines.length)],
    ['REDDEDİLEN KALEM', String(receipt.lines.filter((line) => line.rejectedQuantity > 0).length)],
    ['TUTAR (KDV HARİÇ)', money(receipt.netCents)],
  ])
  doc.section('Kalemler')
  doc.table(
    COLUMNS,
    [
      ...receipt.lines.map((line) => {
        const unit = PURCHASE_UNIT_LABELS[line.unit]
        const stock =
          line.stockItemName && receipt.warehouseName ? ` · stok: ${line.stockItemName}` : ''
        return [
          `${line.name}${stock}`,
          `${String(line.orderedQuantity)} ${unit}`,
          `${String(line.acceptedQuantity)} ${unit}`,
          String(line.rejectedQuantity),
          line.rejectedQuantity > 0 ? (line.rejectReason ?? '—') : '',
          money(line.unitPriceCents),
          money(line.netCents),
        ]
      }),
      ['Toplam', '', '', '', '', '', money(receipt.netCents)],
    ],
    true,
  )
  doc.paragraph(
    'Birim fiyat ve tutarlar KDV hariçtir; tutar kabul edilen miktar × sipariş birim fiyatıdır. Reddedilen miktar teslim alınmış sayılmaz.',
    8,
  )
  doc.signatures('Teslim eden (tedarikçi adına)', `Teslim alan · ${receipt.receivedBy}`, true)
  return doc.finish()
}
