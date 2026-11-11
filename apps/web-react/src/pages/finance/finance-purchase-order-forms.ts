// Satın alma teklifi ve siparişi formları (DOM-FIN-072, DOM-FIN-073; ON-224, ON-225). Alan kuralları
// core şemalarındandır; tutar formda `1.234,56` metnidir, gövdede kuruş. KDV önizlemesi core'un
// `pricedLine` kuralıyla hesaplanır; sunucu aynı hesabı yapar.
import { z } from 'zod'
import type {
  CreatePurchaseQuoteBody,
  PurchaseQuote,
  PurchaseQuoteBoard,
  UpdatePurchaseQuoteBody,
} from '@kampus/react-shared/use-finance-purchase-orders.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import { amountInputValue } from '@kampus/school-core/lib/payments.ts'
import {
  PURCHASE_ORDER_STATUS_LABELS,
  type PurchaseOrderStatus,
} from '@kampus/school-core/lib/finance-purchase-orders.ts'
import {
  amountTotals,
  pricedLine,
  QUOTE_DELIVERY_DAYS_MAX,
  QUOTE_NOTE_MAX,
  QUOTE_SELECTION_REASON_MAX,
  QUOTE_SELECTION_REASON_MIN,
  VAT_RATES,
  type AmountTotals,
  type VatRate,
} from '@kampus/school-core/lib/finance-purchase-quotes.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import { parseUnitPrice } from './finance-procurement-forms.ts'

const PRICE_MESSAGE = 'Birim fiyatı 1.234,56 biçiminde, sıfırdan büyük girin.'
const VAT_TEXT = VAT_RATES.map(String) as [string, ...string[]]

export const VAT_RATE_OPTIONS = VAT_RATES.map((rate) => ({
  value: String(rate),
  label: `%${String(rate)}`,
}))

export const quoteFormSchema = z.object({
  supplierId: z.string().min(1, 'Tedarikçiyi seçin.'),
  deliveryDays: z
    .string()
    .regex(/^\d{1,3}$/, 'Teslim süresini gün olarak tam sayı girin.')
    .refine((value) => Number(value) <= QUOTE_DELIVERY_DAYS_MAX, {
      message: `Teslim süresi en çok ${String(QUOTE_DELIVERY_DAYS_MAX)} gündür.`,
    }),
  validUntil: daySchema,
  note: z
    .string()
    .max(QUOTE_NOTE_MAX, `En fazla ${String(QUOTE_NOTE_MAX)} karakter girebilirsiniz.`),
  items: z.array(
    z.object({
      requestItemId: z.string(),
      price: z.string().refine((value) => parseUnitPrice(value) !== null, {
        message: PRICE_MESSAGE,
      }),
      vatRate: z.enum(VAT_TEXT, 'KDV oranını seçin.'),
    }),
  ),
})
export type QuoteFormValues = z.input<typeof quoteFormSchema>

/** Sunucu alan yolu (`items.0.unitPriceCents`) form alanına çevrilir. */
export function quoteFormField(
  name: string,
):
  | `items.${number}.${'price' | 'vatRate'}`
  | 'supplierId'
  | 'deliveryDays'
  | 'validUntil'
  | 'note'
  | undefined {
  const item = /^items\.(\d+)\.(unitPriceCents|vatRate|requestItemId)$/.exec(name)
  if (item) return `items.${Number(item[1])}.${item[2] === 'vatRate' ? 'vatRate' : 'price'}`
  if (name === 'supplierId' || name === 'deliveryDays' || name === 'validUntil' || name === 'note')
    return name
  return undefined
}

/** Formun başlangıç değerleri: talebin her kalemi için bir fiyat satırı, KDV %20. */
export function quoteDefaults(
  board: Pick<PurchaseQuoteBoard, 'items'>,
  quote?: PurchaseQuote,
): QuoteFormValues {
  const prices = new Map(quote?.lines.map((line) => [line.requestItemId, line]) ?? [])
  return {
    supplierId: quote?.supplier.id ?? '',
    deliveryDays: quote ? String(quote.deliveryDays) : '7',
    validUntil: quote?.validUntil ?? '',
    note: quote?.note ?? '',
    items: board.items.map((item) => {
      const line = prices.get(item.id)
      return {
        requestItemId: item.id,
        price: line ? amountInputValue(line.unitPriceCents) : '',
        vatRate: String(line?.vatRate ?? 20),
      }
    }),
  }
}

const vatOf = (text: string): VatRate =>
  VAT_RATES.find((rate) => String(rate) === text) ?? VAT_RATES[VAT_RATES.length - 1] ?? 20

export function quoteUpdateBody(values: QuoteFormValues): UpdatePurchaseQuoteBody {
  const note = values.note.trim()
  return {
    deliveryDays: Number(values.deliveryDays),
    validUntil: values.validUntil,
    note: note === '' ? null : note,
    items: values.items.map((item) => ({
      requestItemId: item.requestItemId,
      unitPriceCents: parseUnitPrice(item.price) ?? 0,
      vatRate: vatOf(item.vatRate),
    })),
  }
}

export function quoteCreateBody(values: QuoteFormValues): CreatePurchaseQuoteBody {
  const { deliveryDays, validUntil, note, items } = quoteUpdateBody(values)
  return {
    supplierId: values.supplierId,
    deliveryDays: deliveryDays ?? 0,
    validUntil: validUntil ?? '',
    note: note ?? null,
    items: items ?? [],
  }
}

/** Formdaki fiyatların anlık KDV hariç, KDV ve KDV dahil toplamı; geçersiz satır sayılmaz. */
export function quoteFormTotals(
  items: readonly Partial<QuoteFormValues['items'][number]>[],
  quantities: ReadonlyMap<string, number>,
): AmountTotals {
  return amountTotals(
    items.flatMap((item) => {
      const price = parseUnitPrice(item.price ?? '')
      const quantity = quantities.get(item.requestItemId ?? '')
      if (price === null || quantity === undefined) return []
      return [
        pricedLine(
          {
            requestItemId: item.requestItemId ?? '',
            unitPriceCents: price,
            vatRate: vatOf(item.vatRate ?? ''),
          },
          quantity,
        ),
      ]
    }),
  )
}

/** Seçim gerekçesi: en düşük geçerli teklif değilse en az 10 karakter (K-137). */
export function selectionFormSchema(lowest: boolean) {
  return z.object({
    reason: z
      .string()
      .trim()
      .max(
        QUOTE_SELECTION_REASON_MAX,
        `En fazla ${String(QUOTE_SELECTION_REASON_MAX)} karakter girebilirsiniz.`,
      )
      .refine((value) => lowest || value.length >= QUOTE_SELECTION_REASON_MIN, {
        message: 'En düşük teklif seçilmediği için gerekçeyi en az 10 karakterle yazın.',
      }),
  })
}
export type SelectionFormValues = z.input<ReturnType<typeof selectionFormSchema>>

export const orderNoteFormSchema = z.object({
  note: z.string().trim().max(500, 'En fazla 500 karakter girebilirsiniz.'),
})
export type OrderNoteFormValues = z.input<typeof orderNoteFormSchema>

export const ORDER_STATUS_VIEW: Readonly<
  Record<PurchaseOrderStatus, { label: string; tone: BadgeTone }>
> = {
  draft: { label: PURCHASE_ORDER_STATUS_LABELS.draft, tone: 'gray' },
  sent: { label: PURCHASE_ORDER_STATUS_LABELS.sent, tone: 'purple' },
  partially_received: { label: PURCHASE_ORDER_STATUS_LABELS.partially_received, tone: 'amber' },
  completed: { label: PURCHASE_ORDER_STATUS_LABELS.completed, tone: 'green' },
  cancelled: { label: PURCHASE_ORDER_STATUS_LABELS.cancelled, tone: 'red' },
}
