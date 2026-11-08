import { z } from 'zod'

import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import type { BudgetExpenseActual } from './finance-budget-actuals.ts'
import type { PurchaseOrderStatus } from './finance-purchase-orders.ts'
import {
  PURCHASE_ITEMS_MAX,
  PURCHASE_QUANTITY_MAX,
  type PurchaseActor,
} from './finance-purchase-requests.ts'
import { dayKey } from './format.ts'

/**
 * Mal kabul (docs/domain/finans.md DOM-FIN-074; ON-226, K23). Gönderilmiş siparişin teslimatı kalem
 * bazında kabul kaydıyla alınır: kabul günü, teslim alan personel, isteğe bağlı muayene notu ve her
 * kalem için kabul edilen ve reddedilen miktar (ret nedeniyle). Bir siparişe birden çok kısmi kabul
 * yapılır; kalemde kabul edilen toplam sipariş miktarını aşamaz. Reddedilen miktar karşılanmış
 * sayılmaz, tedarikçi yeniden gönderir (K-150). Sipariş durumu kabul edilen toplamdan türetilir:
 * hiç kabul yoksa gönderildi, kısmen ise kısmen teslim alındı, bütün kalemler karşılanınca
 * tamamlandı. Kabul silinmez, yönetici gerekçeyle iptal eder; durum yeniden hesaplanır (K-153).
 *
 * Gider gerçekleşeni (DOM-FIN-066): kabul edilen miktar × sipariş birim fiyatı, KDV hariç, kabul
 * gününde tahakkuk eder; ödeme günü yoktur (tedarikçi ödemesi ON-143). Kalem talebin gider kalemi,
 * merkez talebin birimidir (K-151). Fonksiyonlar saftır; zaman `today` parametresiyle gelir.
 */

/** Kabulü kaydeden roller (K-153). */
export const PURCHASE_RECEIPT_ROLES = ['yonetici', 'onburo'] as const
/** Kabul iptali yönetimin kararıdır (K-153). */
export const PURCHASE_RECEIPT_CANCEL_ROLES = ['yonetici'] as const

export const RECEIPT_RECEIVED_BY_MIN = 2
export const RECEIPT_RECEIVED_BY_MAX = 120
export const RECEIPT_NOTE_MAX = 1000
export const RECEIPT_REJECT_REASON_MIN = 3
export const RECEIPT_REJECT_REASON_MAX = 300
export const RECEIPT_CANCEL_REASON_MIN = 5
export const RECEIPT_CANCEL_REASON_MAX = 500

/** Kabulün sipariş durumuna etkisi: taslak ve iptal kabul almaz. */
export type ReceivingStatus = Extract<
  PurchaseOrderStatus,
  'sent' | 'partially_received' | 'completed'
>

// --- Şemalar -------------------------------------------------------------------------------------

const quantity = z
  .number('Miktarı girin.')
  .int('Miktar tam sayı olmalıdır.')
  .min(0, 'Miktar eksi olamaz.')
  .max(PURCHASE_QUANTITY_MAX, 'Miktar çok büyük.')

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `En fazla ${String(max)} karakter girebilirsiniz.`)
    .nullable()
    .default(null)
    .transform((value) => (value === '' ? null : value))

export const purchaseReceiptLineSchema = z
  .strictObject({
    orderItemId: z.uuid('Kalemi seçin.'),
    acceptedQuantity: quantity,
    rejectedQuantity: quantity.default(0),
    rejectReason: optionalText(RECEIPT_REJECT_REASON_MAX),
  })
  .superRefine((line, ctx) => {
    if (line.acceptedQuantity + line.rejectedQuantity === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['acceptedQuantity'],
        message: 'Kabul edilen ya da reddedilen miktarı girin.',
      })
    if (
      line.rejectedQuantity > 0 &&
      (line.rejectReason === null || line.rejectReason.length < RECEIPT_REJECT_REASON_MIN)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['rejectReason'],
        message: 'Reddedilen miktar için nedeni en az 3 karakterle yazın.',
      })
    if (line.rejectedQuantity === 0 && line.rejectReason !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['rejectReason'],
        message: 'Ret nedeni yalnız reddedilen miktar varken yazılır.',
      })
  })

export const createPurchaseReceiptSchema = z
  .strictObject({
    receiptDate: daySchema,
    receivedBy: z
      .string('Teslim alan personeli yazın.')
      .trim()
      .min(RECEIPT_RECEIVED_BY_MIN, 'Teslim alan personeli yazın.')
      .max(
        RECEIPT_RECEIVED_BY_MAX,
        `En fazla ${String(RECEIPT_RECEIVED_BY_MAX)} karakter girebilirsiniz.`,
      ),
    inspectionNote: optionalText(RECEIPT_NOTE_MAX),
    lines: z
      .array(purchaseReceiptLineSchema, 'Teslim alınan kalemleri girin.')
      .min(1, 'En az bir kalem için miktar girin.')
      .max(PURCHASE_ITEMS_MAX, `En fazla ${String(PURCHASE_ITEMS_MAX)} kalem girilir.`),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>()
    value.lines.forEach((line, index) => {
      if (seen.has(line.orderItemId))
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'orderItemId'],
          message: 'Bu kalem kabulde iki kez girildi.',
        })
      seen.add(line.orderItemId)
    })
  })
export type CreatePurchaseReceiptInput = z.input<typeof createPurchaseReceiptSchema>
export type PurchaseReceiptData = z.output<typeof createPurchaseReceiptSchema>

export const cancelPurchaseReceiptSchema = z.strictObject({
  reason: z
    .string('İptal gerekçesini yazın.')
    .trim()
    .min(RECEIPT_CANCEL_REASON_MIN, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(
      RECEIPT_CANCEL_REASON_MAX,
      `En fazla ${String(RECEIPT_CANCEL_REASON_MAX)} karakter girebilirsiniz.`,
    ),
})
export type CancelPurchaseReceiptInput = z.input<typeof cancelPurchaseReceiptSchema>

// --- Hesap ---------------------------------------------------------------------------------------

export interface ReceiptOrderItem {
  id: string
  quantity: number
  /** KDV hariç birim fiyat, kuruş. */
  unitPriceCents: number
}

export interface ReceiptLineRecord {
  orderItemId: string
  acceptedQuantity: number
  rejectedQuantity: number
}

export interface ReceiptRecord {
  id: string
  receiptDate: string
  cancelledAt: string | null
  lines: readonly ReceiptLineRecord[]
}

export interface ReceiptItemProgress {
  ordered: number
  /** İptal edilmemiş kabullerde kabul edilen toplam. */
  accepted: number
  /** İptal edilmemiş kabullerde reddedilen toplam (bilgi; karşılanmış sayılmaz). */
  rejected: number
  /** Sipariş miktarı eksi kabul edilen. */
  remaining: number
}

/** Kalem başına sipariş, kabul, ret ve kalan miktar; iptal edilen kabul sayılmaz. */
export function receiptProgress(
  items: readonly ReceiptOrderItem[],
  receipts: readonly ReceiptRecord[],
): Map<string, ReceiptItemProgress> {
  const progress = new Map<string, ReceiptItemProgress>(
    items.map((item) => [
      item.id,
      { ordered: item.quantity, accepted: 0, rejected: 0, remaining: item.quantity },
    ]),
  )
  for (const receipt of receipts) {
    if (receipt.cancelledAt !== null) continue
    for (const line of receipt.lines) {
      const entry = progress.get(line.orderItemId)
      if (entry === undefined) continue
      entry.accepted += line.acceptedQuantity
      entry.rejected += line.rejectedQuantity
      entry.remaining = entry.ordered - entry.accepted
    }
  }
  return progress
}

/** Kabul edilen toplamdan sipariş durumu (K-150): hiç → gönderildi, kısmen → kısmen teslim, tamamı → tamamlandı. */
export function receivingStatus(
  progress: ReadonlyMap<string, ReceiptItemProgress>,
): ReceivingStatus {
  const entries = [...progress.values()]
  if (entries.length > 0 && entries.every((entry) => entry.remaining <= 0)) return 'completed'
  return entries.some((entry) => entry.accepted > 0) ? 'partially_received' : 'sent'
}

/** Kabulün KDV hariç tutarı: kabul edilen miktar × sipariş birim fiyatı (K-151). */
export function receiptNetCents(
  lines: readonly Pick<ReceiptLineRecord, 'orderItemId' | 'acceptedQuantity'>[],
  items: readonly ReceiptOrderItem[],
): number {
  const prices = new Map(items.map((item) => [item.id, item.unitPriceCents]))
  return lines.reduce(
    (total, line) => total + line.acceptedQuantity * (prices.get(line.orderItemId) ?? 0),
    0,
  )
}

export interface ReceiptExpenseRow {
  /** Talebin gider kalemi. */
  itemId: string
  /** Talebin birimi (maliyet merkezi). */
  costCenterId: string
  receiptDate: string
  acceptedQuantity: number
  unitPriceCents: number
}

/**
 * Gider gerçekleşeni satırları (DOM-FIN-066, K-151): iptal edilmemiş kabullerin kabul edilen
 * miktarı × sipariş birim fiyatı, KDV hariç, kabul gününde tahakkuk; ödeme günü yok. Aynı gün,
 * kalem ve merkezdeki satırlar birleştirilir; sıfır tutar yazılmaz.
 */
export function receiptExpenseActuals(rows: readonly ReceiptExpenseRow[]): BudgetExpenseActual[] {
  const byKey = new Map<string, BudgetExpenseActual>()
  for (const row of rows) {
    const amountCents = row.acceptedQuantity * row.unitPriceCents
    if (amountCents === 0) continue
    const key = `${row.itemId}|${row.costCenterId}|${row.receiptDate}`
    const entry = byKey.get(key)
    if (entry) entry.amountCents += amountCents
    else
      byKey.set(key, {
        itemId: row.itemId,
        costCenterId: row.costCenterId,
        accrualDate: row.receiptDate,
        paidDate: null,
        amountCents,
        source: 'purchase',
      })
  }
  return [...byKey.values()]
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: (string | number)[]) =>
  new DomainError(code, message, {
    kind: 'rule',
    ...(path ? { path: path.map(String) } : {}),
  })

export interface PeriodRange {
  startDate: string
  endDate: string
}

/** Gün kapalı bir bütçe döneminin içinde mi (kapalı dönemin gerçekleşeni değişmez; K-153). */
const inClosedPeriod = (day: string, closed: readonly PeriodRange[]) =>
  closed.some((period) => period.startDate <= day && day <= period.endDate)

function assertReceivable(status: PurchaseOrderStatus): asserts status is ReceivingStatus {
  if (status === 'draft')
    throw ruleError(
      'purchase_receipt_order_not_sent',
      'Mal kabul gönderilmiş siparişe yapılır; önce siparişi gönderildi olarak işaretleyin.',
    )
  if (status === 'cancelled')
    throw ruleError(
      'purchase_receipt_order_cancelled',
      'İptal edilmiş siparişe mal kabul yapılmaz.',
    )
}

export interface PurchaseReceiptContext {
  order: { status: PurchaseOrderStatus; createdAt: string }
  items: readonly ReceiptOrderItem[]
  /** Siparişin bütün kabulleri (iptal edilenler dahil). */
  receipts: readonly ReceiptRecord[]
  /** Kurumun kapalı bütçe dönemleri. */
  closedPeriods: readonly PeriodRange[]
  /** Europe/Istanbul günü. */
  today: string
}

/**
 * Yeni kabul (DOM-FIN-074): gönderilmiş ya da kısmen teslim alınmış sipariş; kabul günü sipariş
 * açılış gününden önce ve bugünden sonra olamaz, kapalı bütçe dönemine düşemez; kalem siparişte
 * olmalı ve kabul edilen miktar kalanı aşmamalı. Dönen durum siparişe yazılır.
 */
export function planPurchaseReceipt(
  input: unknown,
  context: PurchaseReceiptContext,
): { data: PurchaseReceiptData; status: ReceivingStatus } {
  const data = createPurchaseReceiptSchema.parse(input)
  assertReceivable(context.order.status)
  if (context.order.status === 'completed')
    throw ruleError(
      'purchase_receipt_order_completed',
      'Siparişin bütün kalemleri teslim alındı; yeni kabul yapılmaz.',
    )
  if (data.receiptDate > context.today)
    throw ruleError('purchase_receipt_date_future', 'Kabul günü bugünden sonra olamaz.', [
      'receiptDate',
    ])
  if (data.receiptDate < dayKey(context.order.createdAt))
    throw ruleError(
      'purchase_receipt_date_before_order',
      'Kabul günü siparişin açıldığı günden önce olamaz.',
      ['receiptDate'],
    )
  if (inClosedPeriod(data.receiptDate, context.closedPeriods))
    throw ruleError(
      'purchase_receipt_period_closed',
      'Kabul günü kapalı bir bütçe dönemine düşüyor; kapalı dönemin gerçekleşeni değişmez.',
      ['receiptDate'],
    )
  const progress = receiptProgress(context.items, context.receipts)
  data.lines.forEach((line, index) => {
    const entry = progress.get(line.orderItemId)
    if (entry === undefined)
      throw ruleError('purchase_receipt_item_not_found', 'Kalem bu siparişte yok.', [
        'lines',
        index,
        'orderItemId',
      ])
    if (line.acceptedQuantity > entry.remaining)
      throw ruleError(
        'purchase_receipt_quantity_exceeded',
        `Kabul edilen miktar kalan miktarı aşamaz (kalan ${String(entry.remaining)}).`,
        ['lines', index, 'acceptedQuantity'],
      )
  })
  const after = receiptProgress(context.items, [
    ...context.receipts,
    { id: '', receiptDate: data.receiptDate, cancelledAt: null, lines: data.lines },
  ])
  return { data, status: receivingStatus(after) }
}

/**
 * Kabul iptali (DOM-FIN-074, K-153): gerekçeyle, silinmez; iptal edilmiş kabul yeniden iptal
 * edilmez, kapalı bütçe dönemindeki kabul iptal edilmez. Sipariş durumu kalan kabullerden yeniden
 * hesaplanır.
 */
export function planPurchaseReceiptCancel(
  receipt: Pick<ReceiptRecord, 'id' | 'receiptDate' | 'cancelledAt'>,
  input: unknown,
  context: Omit<PurchaseReceiptContext, 'today'>,
): { reason: string; status: ReceivingStatus } {
  const { reason } = cancelPurchaseReceiptSchema.parse(input)
  if (receipt.cancelledAt !== null)
    throw ruleError('purchase_receipt_already_cancelled', 'Bu kabul zaten iptal edildi.')
  assertReceivable(context.order.status)
  if (inClosedPeriod(receipt.receiptDate, context.closedPeriods))
    throw ruleError(
      'purchase_receipt_period_closed',
      'Kabul günü kapalı bir bütçe dönemine düşüyor; kapalı dönemin gerçekleşeni değişmez.',
    )
  const remaining = context.receipts.filter((item) => item.id !== receipt.id)
  return { reason, status: receivingStatus(receiptProgress(context.items, remaining)) }
}

/** Rolün mal kabulde yapabileceği işlemler (ekran düğmeleri; sunucu aynı kuralları yeniden denetler). */
export function purchaseReceiptActions(
  order: { status: PurchaseOrderStatus },
  actor: Pick<PurchaseActor, 'role'>,
): { receive: boolean; cancel: boolean } {
  const staff = actor.role === 'yonetici' || actor.role === 'onburo'
  const receiving = order.status === 'sent' || order.status === 'partially_received'
  return {
    receive: staff && receiving,
    cancel: actor.role === 'yonetici' && order.status !== 'draft' && order.status !== 'cancelled',
  }
}
