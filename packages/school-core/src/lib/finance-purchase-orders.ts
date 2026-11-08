import { z } from 'zod'

import { DomainError } from './errors.ts'
import { dayKey } from './format.ts'
import type { PurchaseActor, PurchaseRequestStatus } from './finance-purchase-requests.ts'
import {
  amountTotals,
  isQuoteExpired,
  pricedLine,
  type QuotePrice,
} from './finance-purchase-quotes.ts'

/**
 * Satın alma siparişi (docs/domain/finans.md DOM-FIN-073; ON-225, K23). Sipariş onaylanmış talebin
 * seçili teklifinden açılır; kalemler, fiyatlar ve tedarikçi bilgisi açılış anının kopyasıdır.
 * Numara `SA-<yıl>-<sıra>`: yıl açılış gününün Europe/Istanbul yılı, sıra kurumda yıl içinde
 * ardışık, iptal edilen numara boşta kalır (K-139). Durum taslak → gönderildi → kısmen teslim →
 * tamamlandı; taslak ve gönderilmiş sipariş gerekçeyle iptal edilir. Teslim adımları mal kabulle
 * (ON-226) gelir. Onaylanmış talep yalnız siparişle kapanır: talepte en çok bir etkin (iptal
 * edilmemiş) sipariş olur; sipariş iptal edilirse talep yeniden teklif ve seçime açılır (K-140).
 */

/** Siparişi okuyan ve gönderildi olarak işaretleyen roller (K-141). */
export const PURCHASE_ORDER_ROLES = ['yonetici', 'onburo'] as const
/** Sipariş açma ve iptal yönetimin kararıdır (K-141). */
export const PURCHASE_ORDER_MANAGE_ROLES = ['yonetici'] as const

export const PURCHASE_ORDER_STATUSES = [
  'draft',
  'sent',
  'partially_received',
  'completed',
  'cancelled',
] as const
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number]
export const PURCHASE_ORDER_STATUS_LABELS = {
  draft: 'Taslak',
  sent: 'Gönderildi',
  partially_received: 'Kısmen teslim alındı',
  completed: 'Tamamlandı',
  cancelled: 'İptal edildi',
} as const satisfies Record<PurchaseOrderStatus, string>

export const PURCHASE_ORDER_NOTE_MAX = 500
export const PURCHASE_ORDER_REASON_MIN = 5
export const PURCHASE_ORDER_REASON_MAX = 500

/** Kurumda takvim yılı içinde ardışık numara; iptal edilen numara boşta kalır (K-139). */
export function purchaseOrderNumber(year: number, sequence: number): string {
  return `SA-${String(year)}-${String(sequence).padStart(4, '0')}`
}

/** Numaranın yılı: açılış anının Europe/Istanbul takvim yılı (31 Aralık 21.00 UTC sonrası yeni yıl). */
export const purchaseOrderYear = (now: Date | string) => Number(dayKey(now).slice(0, 4))

// --- Şemalar -------------------------------------------------------------------------------------

export const createPurchaseOrderSchema = z.strictObject({
  quoteId: z.uuid('Teklifi seçin.'),
  note: z
    .string()
    .trim()
    .max(
      PURCHASE_ORDER_NOTE_MAX,
      `En fazla ${String(PURCHASE_ORDER_NOTE_MAX)} karakter girebilirsiniz.`,
    )
    .nullable()
    .default(null)
    .transform((value) => (value === '' ? null : value)),
})
export type CreatePurchaseOrderInput = z.input<typeof createPurchaseOrderSchema>

export const cancelPurchaseOrderSchema = z.strictObject({
  reason: z
    .string('İptal gerekçesini yazın.')
    .trim()
    .min(PURCHASE_ORDER_REASON_MIN, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(
      PURCHASE_ORDER_REASON_MAX,
      `En fazla ${String(PURCHASE_ORDER_REASON_MAX)} karakter girebilirsiniz.`,
    ),
})
export type CancelPurchaseOrderInput = z.input<typeof cancelPurchaseOrderSchema>

// --- Hesap ---------------------------------------------------------------------------------------

export interface OrderLineInput extends QuotePrice {
  quantity: number
}

/** Sipariş kalemleri ve toplamı; KDV teklifteki kuralla kalemde yuvarlanır (K-138). */
export function purchaseOrderAmounts(lines: readonly OrderLineInput[]) {
  const priced = lines.map((line) => pricedLine(line, line.quantity))
  return { lines: priced, totals: amountTotals(priced) }
}

function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * Beklenen teslim günü: gönderim günü (gönderilmediyse açılış günü; Europe/Istanbul) artı teklifteki
 * teslim süresi. Saklanmaz, hesaplanır.
 */
export function expectedDeliveryDate(order: {
  deliveryDays: number
  createdAt: string
  sentAt: string | null
}): string {
  return shiftDay(dayKey(order.sentAt ?? order.createdAt), order.deliveryDays)
}

// --- Kurallar ------------------------------------------------------------------------------------

export interface PurchaseOrderContext {
  request: { status: PurchaseRequestStatus }
  /** Gövdedeki teklif; talepte yoksa `null`. */
  quote: { selected: boolean; validUntil: string } | null
  supplier: { isActive: boolean } | null
  /** Talebin iptal edilmemiş siparişi var mı. */
  orderActive: boolean
  /** Europe/Istanbul günü. */
  today: string
}

const ruleError = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path ? { path: [path] } : {}) })

/**
 * Yeni sipariş (DOM-FIN-073): onaylanmış talebin seçili ve süresi geçmemiş teklifi, etkin tedarikçi,
 * talepte etkin sipariş yok (409 `purchase_order_exists`).
 */
export function planPurchaseOrder(
  input: unknown,
  context: PurchaseOrderContext,
): z.output<typeof createPurchaseOrderSchema> {
  const data = createPurchaseOrderSchema.parse(input)
  if (context.quote === null)
    throw ruleError('purchase_order_quote_not_found', 'Teklif bulunamadı.', 'quoteId')
  if (context.request.status !== 'approved')
    throw ruleError(
      'purchase_order_request_not_approved',
      'Sipariş yalnız onaylanmış talepten açılır.',
    )
  if (context.orderActive)
    throw new DomainError('purchase_order_exists', 'Bu talebin siparişi zaten açıldı.', {
      kind: 'conflict',
    })
  if (!context.quote.selected)
    throw ruleError(
      'purchase_order_quote_not_selected',
      'Sipariş yalnız seçilmiş tekliften açılır; önce teklifi seçin.',
      'quoteId',
    )
  if (isQuoteExpired(context.quote, context.today))
    throw ruleError(
      'purchase_quote_expired',
      'Teklifin geçerlilik süresi geçti; tedarikçiden güncel teklif alıp teklifi düzeltin.',
      'quoteId',
    )
  if (context.supplier === null || !context.supplier.isActive)
    throw ruleError(
      'purchase_order_supplier_inactive',
      'Tedarikçi pasif; siparişten önce tedarikçi kaydını kontrol edin.',
      'quoteId',
    )
  return data
}

/** Gönderildi işareti: yalnız taslak sipariş (PDF tedarikçiye kurum dışından iletilir; K-142). */
export function planPurchaseOrderSend(order: { status: PurchaseOrderStatus }): void {
  if (order.status !== 'draft')
    throw ruleError('purchase_order_not_draft', 'Yalnız taslak sipariş gönderildi işaretlenir.')
}

/** İptal: taslak ya da gönderilmiş sipariş, gerekçeyle; teslim alınmaya başlanan sipariş iptal edilmez. */
export function planPurchaseOrderCancel(
  order: { status: PurchaseOrderStatus },
  input: unknown,
): z.output<typeof cancelPurchaseOrderSchema> {
  const data = cancelPurchaseOrderSchema.parse(input)
  if (order.status !== 'draft' && order.status !== 'sent')
    throw ruleError(
      'purchase_order_not_cancellable',
      'Yalnız taslak ya da gönderilmiş sipariş iptal edilir.',
    )
  return data
}

/** Rolün siparişte yapabileceği işlemler (ekran düğmeleri; sunucu aynı kuralları yeniden denetler). */
export function purchaseOrderActions(
  order: { status: PurchaseOrderStatus },
  actor: Pick<PurchaseActor, 'role'>,
): { send: boolean; cancel: boolean } {
  const staff = actor.role === 'yonetici' || actor.role === 'onburo'
  return {
    send: staff && order.status === 'draft',
    cancel: actor.role === 'yonetici' && (order.status === 'draft' || order.status === 'sent'),
  }
}
