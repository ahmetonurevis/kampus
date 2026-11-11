// Sarf malzeme talebi formları (DOM-FIN-091; ON-233). Alan kuralları core şemalarından: talepte
// istenen gün, gerekçe ve stok kartı + miktar kalemleri; karşılamada depo, gün ve kalem miktarları
// (boş bırakılan kalem çıkmaz) ile kısmi kapatma; dönüştürmede birim, dönem, gider kalemi,
// tedarikçi ve kalan kalemlerin tahmini birim fiyatı. Formda sayılar metindir; gövdeye tam sayı ve
// kuruş gider. Stok yeterliliği ve satın alma kuralları sunucuda kurum kilidi altında denetlenir.
import { z } from 'zod'
import type {
  ConvertSupplyRequestBody,
  CreateSupplyRequestBody,
  FulfillSupplyRequestBody,
  SupplyRequestDetail,
} from '@kampus/react-shared/use-finance-supply-requests.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  SUPPLY_ITEMS_MAX,
  SUPPLY_JUSTIFICATION_MAX,
  SUPPLY_JUSTIFICATION_MIN,
  SUPPLY_QUANTITY_MAX,
  SUPPLY_REASON_MAX,
  SUPPLY_REASON_MIN,
  SUPPLY_REQUEST_STATUS_LABELS,
  type SupplyRequestStatus,
} from '@kampus/school-core/lib/finance-supply-requests.ts'
import { amountInputValue } from '@kampus/school-core/lib/payments.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import { parseUnitPrice } from './finance-procurement-forms.ts'

const COUNT = /^\d{1,5}$/
const quantityText = (allowEmpty: boolean) =>
  z
    .string()
    .trim()
    .refine(
      (value) =>
        (allowEmpty && value === '') ||
        (COUNT.test(value) && Number(value) >= 1 && Number(value) <= SUPPLY_QUANTITY_MAX),
      `Miktarı 1–${String(SUPPLY_QUANTITY_MAX)} arasında tam sayı girin.`,
    )

export const SUPPLY_STATUS_VIEW: Readonly<
  Record<SupplyRequestStatus, { label: string; tone: BadgeTone }>
> = {
  submitted: { label: SUPPLY_REQUEST_STATUS_LABELS.submitted, tone: 'amber' },
  approved: { label: SUPPLY_REQUEST_STATUS_LABELS.approved, tone: 'purple' },
  rejected: { label: SUPPLY_REQUEST_STATUS_LABELS.rejected, tone: 'red' },
  fulfilled: { label: SUPPLY_REQUEST_STATUS_LABELS.fulfilled, tone: 'green' },
  cancelled: { label: SUPPLY_REQUEST_STATUS_LABELS.cancelled, tone: 'gray' },
}

// --- Talep ---------------------------------------------------------------------------------------

export const supplyRequestFormSchema = z.object({
  neededDate: daySchema,
  justification: z
    .string()
    .trim()
    .min(SUPPLY_JUSTIFICATION_MIN, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(
      SUPPLY_JUSTIFICATION_MAX,
      `En fazla ${String(SUPPLY_JUSTIFICATION_MAX)} karakter girebilirsiniz.`,
    ),
  items: z
    .array(
      z.object({
        stockItemId: z.string().min(1, 'Stok kartını seçin.'),
        quantity: quantityText(false),
      }),
    )
    .min(1, 'En az bir kalem ekleyin.')
    .max(SUPPLY_ITEMS_MAX, `En fazla ${String(SUPPLY_ITEMS_MAX)} kalem eklenebilir.`)
    .superRefine((items, ctx) => {
      const seen = new Set<string>()
      items.forEach((item, index) => {
        if (item.stockItemId !== '' && seen.has(item.stockItemId))
          ctx.addIssue({
            code: 'custom',
            path: [index, 'stockItemId'],
            message: 'Aynı stok kartı talepte bir kez yer alır; miktarı artırın.',
          })
        seen.add(item.stockItemId)
      })
    }),
})
export type SupplyRequestFormValues = z.input<typeof supplyRequestFormSchema>

export const supplyRequestDefaults = (neededDate: string): SupplyRequestFormValues => ({
  neededDate,
  justification: '',
  items: [{ stockItemId: '', quantity: '1' }],
})

export function supplyRequestBody(values: SupplyRequestFormValues): CreateSupplyRequestBody {
  return {
    neededDate: values.neededDate,
    justification: values.justification.trim(),
    items: values.items.map((item) => ({
      stockItemId: item.stockItemId,
      quantity: Number(item.quantity),
    })),
  }
}

/** Sunucu alan yolu → form alanı (`items.0.stockItemId` dahil). */
export function supplyRequestFormField(
  name: string,
):
  | 'neededDate'
  | 'justification'
  | `items.${number}.stockItemId`
  | `items.${number}.quantity`
  | 'items'
  | undefined {
  if (name === 'neededDate' || name === 'justification') return name
  const item = /^items\.(\d+)\.(stockItemId|quantity)$/.exec(name)
  if (item) return `items.${Number(item[1])}.${item[2] as 'stockItemId' | 'quantity'}`
  return name.startsWith('items') ? 'items' : undefined
}

// --- Karşılama -----------------------------------------------------------------------------------

export const fulfillFormSchema = z
  .object({
    warehouseId: z.string().min(1, 'Depoyu seçin.'),
    movementDate: daySchema,
    /** Kalem kimliği → miktar metni; boş kalem çıkmaz. */
    lines: z.array(z.object({ itemId: z.string(), quantity: quantityText(true) })),
    close: z.boolean(),
    closeNote: z
      .string()
      .trim()
      .max(SUPPLY_REASON_MAX, `En fazla ${String(SUPPLY_REASON_MAX)} karakter girebilirsiniz.`),
  })
  .superRefine((value, ctx) => {
    if (!value.close && value.lines.every((line) => line.quantity.trim() === ''))
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'Çıkılacak miktar girin ya da talebi kalanıyla kapatın.',
      })
    if (value.close && value.closeNote.trim().length < SUPPLY_REASON_MIN)
      ctx.addIssue({
        code: 'custom',
        path: ['closeNote'],
        message: 'Kapatma açıklamasını en az 5 karakterle yazın.',
      })
  })
export type FulfillFormValues = z.input<typeof fulfillFormSchema>

type DetailItem = SupplyRequestDetail['items'][number]

/** Kalemin seçilen depodaki miktarı (ayrıntı yanıtındaki depo kırılımından). */
export const stockIn = (item: DetailItem, warehouseId: string) =>
  item.stock?.find((row) => row.warehouseId === warehouseId)?.quantity ?? 0

/**
 * Seçilen depo için öneri: her kalemde kalan ile depodaki miktarın küçüğü (sıfırsa boş). Sunucu
 * aynı öneriyi `lines` verilmeyince kendisi de hesaplar (K-245).
 */
export function suggestedLines(
  items: readonly DetailItem[],
  warehouseId: string,
): FulfillFormValues['lines'] {
  return items
    .filter((item) => item.remainingQuantity > 0)
    .map((item) => {
      const quantity = Math.min(item.remainingQuantity, stockIn(item, warehouseId))
      return { itemId: item.id, quantity: quantity > 0 ? String(quantity) : '' }
    })
}

/** Varsayılan depo: kalanı en çok karşılayan etkin depo. */
export function defaultWarehouse(items: readonly DetailItem[]): string {
  const totals = new Map<string, number>()
  for (const item of items)
    for (const row of item.stock ?? [])
      totals.set(
        row.warehouseId,
        (totals.get(row.warehouseId) ?? 0) + Math.min(row.quantity, item.remainingQuantity),
      )
  let best = ''
  let bestTotal = 0
  for (const [warehouseId, total] of totals)
    if (total > bestTotal) {
      best = warehouseId
      bestTotal = total
    }
  return best
}

export function fulfillBody(values: FulfillFormValues): FulfillSupplyRequestBody {
  const lines = values.lines
    .filter((line) => line.quantity.trim() !== '')
    .map((line) => ({ itemId: line.itemId, quantity: Number(line.quantity) }))
  const note = values.closeNote.trim()
  return {
    warehouseId: values.warehouseId,
    movementDate: values.movementDate,
    ...(lines.length > 0 ? { lines } : {}),
    close: values.close,
    closeNote: values.close && note !== '' ? note : null,
  }
}

/** Sunucu alan yolu → form alanı; kalem yolu `lines.<n>.quantity` gövde sırasından çevrilir. */
export function fulfillFormField(
  name: string,
  values: FulfillFormValues,
): 'warehouseId' | 'movementDate' | 'closeNote' | `lines.${number}.quantity` | 'lines' | undefined {
  if (name === 'warehouseId' || name === 'movementDate' || name === 'closeNote') return name
  const line = /^lines\.(\d+)\./.exec(name)
  if (line) {
    const sent = values.lines.filter((item) => item.quantity.trim() !== '')[Number(line[1])]
    const index = values.lines.findIndex((item) => item.itemId === sent?.itemId)
    return index >= 0 ? `lines.${index}.quantity` : 'lines'
  }
  return name.startsWith('lines') ? 'lines' : undefined
}

// --- Satın almaya dönüştürme ---------------------------------------------------------------------

export const convertFormSchema = z.object({
  costCenterId: z.string().min(1, 'Talep eden birimi seçin.'),
  periodId: z.string().min(1, 'Bütçe dönemini seçin.'),
  budgetItemId: z.string().min(1, 'Gider kalemini seçin.'),
  supplierId: z.string(),
  prices: z.array(
    z.object({
      itemId: z.string(),
      price: z.string().refine((value) => parseUnitPrice(value) !== null, {
        message: 'Birim fiyatı 1.234,56 biçiminde, sıfırdan büyük girin.',
      }),
    }),
  ),
})
export type ConvertFormValues = z.input<typeof convertFormSchema>

/** Kalanı olan kalemler; fiyat son alış fiyatından (K-202) önerilir, yoksa boş. */
export function convertDefaults(request: SupplyRequestDetail): ConvertFormValues {
  return {
    costCenterId: '',
    periodId: '',
    budgetItemId: '',
    supplierId: '',
    prices: request.items
      .filter((item) => item.remainingQuantity > 0)
      .map((item) => ({
        itemId: item.id,
        price: item.lastPriceCents === null ? '' : amountInputValue(item.lastPriceCents),
      })),
  }
}

export function convertBody(values: ConvertFormValues): ConvertSupplyRequestBody {
  return {
    costCenterId: values.costCenterId,
    periodId: values.periodId,
    budgetItemId: values.budgetItemId,
    supplierId: values.supplierId === '' ? null : values.supplierId,
    prices: values.prices.map((line) => ({
      itemId: line.itemId,
      estimatedUnitPriceCents: parseUnitPrice(line.price) ?? 0,
    })),
  }
}

export function convertFormField(
  name: string,
):
  | 'costCenterId'
  | 'periodId'
  | 'budgetItemId'
  | 'supplierId'
  | `prices.${number}.price`
  | 'prices'
  | undefined {
  if (
    name === 'costCenterId' ||
    name === 'periodId' ||
    name === 'budgetItemId' ||
    name === 'supplierId'
  )
    return name
  const line = /^prices\.(\d+)\./.exec(name)
  if (line) return `prices.${Number(line[1])}.price`
  return name.startsWith('prices') ? 'prices' : undefined
}
