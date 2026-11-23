// Satın alma siparişi belgesi (DOM-FIN-073; ON-225): tedarikçi (açılış anı kopyası), kalemler, KDV
// dökümü ve toplam, teslim süresi ve not. Rakamlar API yanıtından gelir, burada yeniden hesaplanmaz.
// Sipariş kurum içi belgedir, fatura değildir; tedarikçiye kurum dışından iletilir (K-142).
import type { PurchaseOrderDetail } from '@kampus/react-shared/use-finance-purchase-orders.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { PURCHASE_ORDER_STATUS_LABELS } from '@kampus/school-core/lib/finance-purchase-orders.ts'
import { PURCHASE_UNIT_LABELS } from '@kampus/school-core/lib/finance-purchase-requests.ts'
import { SUPPLIER_TYPE_LABELS } from '@kampus/school-core/lib/finance-suppliers.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const PURCHASE_ORDER_TITLE = 'Satın alma siparişi'

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

const COLUMNS = [
  { header: 'Kalem', width: 54 },
  { header: 'Miktar', width: 22 },
  { header: 'Birim fiyat', width: 28 },
  { header: 'KDV', width: 14 },
  { header: 'KDV tutarı', width: 26 },
  { header: 'Tutar (KDV dahil)', width: 30 },
] as const

export const purchaseOrderFilename = (order: Pick<PurchaseOrderDetail, 'number'>) =>
  `satin-alma-siparisi-${order.number}.pdf`

/** Sipariş PDF'i: tedarikçi bilgisi, kalem tablosu, KDV dökümü, toplam ve imza alanı. */
export function purchaseOrderDocument(
  measurer: TextMeasurer,
  order: PurchaseOrderDetail,
  options: TemplateOptions,
): PdfDocument {
  const doc = new DocumentLayout(measurer, {
    label: 'SATIN ALMA SİPARİŞİ',
    badge: order.status === 'cancelled' ? 'İPTAL' : 'SİPARİŞ',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: order.number,
    footerNote: 'Kurum içi sipariş belgesidir; fatura veya e-Arşiv belgesi yerine geçmez.',
  })
  doc.heading(PURCHASE_ORDER_TITLE, order.number)
  doc.fields([
    ['Tedarikçi', order.supplier.name],
    [
      'Vergi dairesi / numarası',
      `${order.supplier.taxOffice} / ${order.supplier.taxNumber} (${SUPPLIER_TYPE_LABELS[order.supplier.type]})`,
    ],
    ['Sipariş tarihi', dateLabel(order.createdAt, { year: 'numeric' })],
    ['Talep', order.request.number],
    [
      'Teslim süresi',
      `${String(order.deliveryDays)} gün · beklenen ${dayText(order.expectedDeliveryDate)}`,
    ],
    ['Durum', PURCHASE_ORDER_STATUS_LABELS[order.status]],
  ])
  if (order.cancelledAt)
    doc.paragraph(
      `Bu sipariş ${dateLabel(order.cancelledAt, { year: 'numeric' })} tarihinde iptal edildi. Gerekçe: ${order.cancelReason ?? '—'}`,
    )
  doc.metrics([
    ['KDV HARİÇ', money(order.netCents)],
    ['KDV', money(order.vatCents)],
    ['TOPLAM', money(order.grossCents)],
  ])
  doc.section('Kalemler')
  doc.table(
    COLUMNS,
    [
      ...order.items.map((item) => [
        item.name,
        `${String(item.quantity)} ${PURCHASE_UNIT_LABELS[item.unit]}`,
        money(item.unitPriceCents),
        `%${String(item.vatRate)}`,
        money(item.vatCents),
        money(item.grossCents),
      ]),
      ['Toplam', '', money(order.netCents), '', money(order.vatCents), money(order.grossCents)],
    ],
    true,
  )
  if (order.note) {
    doc.section('Not')
    doc.paragraph(order.note)
  }
  doc.paragraph(
    'KDV her kalemde kuruşa yuvarlanmıştır; toplam KDV kalem KDV tutarlarının toplamıdır.',
    8,
  )
  doc.signatures('Kurum adına onay', 'Tedarikçi kabulü', true)
  return doc.finish()
}
