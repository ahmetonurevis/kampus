import { z } from 'zod'

import { PURCHASE_ORDER_STATUSES } from '@kampus/school-core/lib/finance-purchase-orders.ts'
import { VAT_RATES } from '@kampus/school-core/lib/finance-purchase-quotes.ts'
import {
  PURCHASE_REQUEST_STATUSES,
  PURCHASE_UNITS,
} from '@kampus/school-core/lib/finance-purchase-requests.ts'
import { SUPPLIER_TYPES } from '@kampus/school-core/lib/finance-suppliers.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Satın alma teklifi ve siparişi şemaları (DOM-FIN-072, DOM-FIN-073; ON-224, ON-225). */

const cents = (description: string) => z.number().int().describe(description)
const version = z.number().int().describe('`If-Match` için kayıt sürümü')
const vatRate = z.literal(VAT_RATES).describe('KDV oranı, yüzde (K-138)')
const amounts = {
  netCents: cents('KDV hariç tutar, kuruş'),
  vatCents: cents('KDV, kuruş; kalemde yarım kuruş yukarı yuvarlanır (K-138)'),
  grossCents: cents('KDV dahil tutar, kuruş'),
}

// --- Teklif --------------------------------------------------------------------------------------

const quoteBoardSchema = z.object({
  request: z.object({
    id: z.string(),
    number: z.string().describe('Talep numarası, ör. `ST-0001`'),
    status: z.enum(PURCHASE_REQUEST_STATUSES),
  }),
  items: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        quantity: z.number().int(),
        unit: z.enum(PURCHASE_UNITS),
      }),
    )
    .describe('Talep kalemleri (karşılaştırma satırları)'),
  quotes: z
    .array(
      z.object({
        id: z.string(),
        supplier: z.object({ id: z.string(), name: z.string(), isActive: z.boolean() }),
        deliveryDays: z.number().int().describe('Teslim süresi, gün'),
        validUntil: z.string().describe('Son geçerlilik günü `YYYY-MM-DD`'),
        note: z.string().nullable(),
        expired: z.boolean().describe('Geçerlilik günü geçti mi (Europe/Istanbul)'),
        lowest: z.boolean().describe('Geçerli teklifler arasında en düşük KDV dahil toplam mı'),
        ...amounts,
        selected: z.boolean(),
        selectedAt: z.string().nullable(),
        selectedByName: z.string().nullable(),
        selectionReason: z.string().nullable(),
        createdByUserId: z.string(),
        createdByName: z.string().nullable(),
        createdAt: z.string(),
        lines: z.array(
          z.object({
            requestItemId: z.string(),
            unitPriceCents: cents('KDV hariç birim fiyat, kuruş'),
            vatRate,
            ...amounts,
            lowest: z.boolean().describe('Satırda en düşük KDV dahil tutar mı'),
          }),
        ),
        actions: z
          .object({ edit: z.boolean(), remove: z.boolean(), select: z.boolean() })
          .describe('Oturumdaki kullanıcının bu teklifte yapabileceği işlemler'),
        version,
      }),
    )
    .describe('Silinmemiş teklifler, giriş sırasıyla'),
  lowestGrossCents: cents('Geçerli tekliflerin en düşük KDV dahil toplamı').nullable(),
  orders: z
    .array(
      z.object({
        id: z.string(),
        number: z.string(),
        status: z.enum(PURCHASE_ORDER_STATUSES),
      }),
    )
    .describe('Talebin siparişleri (iptal edilenler dahil), yeni önce'),
  actions: z
    .object({ add: z.boolean(), order: z.boolean() })
    .describe('Yeni teklif girişi ve seçili tekliften sipariş açma'),
})
export const quoteBoardResponse = dataResponse(quoteBoardSchema)

export const quoteRequestParams = z.object({ requestId: z.uuid('Talep geçersiz.') })
export const quoteParams = z.object({
  requestId: z.uuid('Talep geçersiz.'),
  quoteId: z.uuid('Teklif geçersiz.'),
})

// --- Sipariş -------------------------------------------------------------------------------------

const orderSummaryShape = {
  id: z.string(),
  number: z.string().describe('Sipariş numarası `SA-<yıl>-<sıra>` (K-139)'),
  status: z.enum(PURCHASE_ORDER_STATUSES),
  request: z.object({ id: z.string(), number: z.string() }).describe('Siparişin talebi'),
  supplier: z.object({ id: z.string(), name: z.string() }),
  itemCount: z.number().int(),
  ...amounts,
  deliveryDays: z.number().int(),
  expectedDeliveryDate: z
    .string()
    .describe('Gönderim (yoksa açılış) günü artı teslim süresi, `YYYY-MM-DD`; hesaplanır'),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  actions: z
    .object({ send: z.boolean(), cancel: z.boolean() })
    .describe('Oturumdaki kullanıcının bu siparişte yapabileceği işlemler'),
  version,
}

export const purchaseOrderListResponse = z.object({
  data: z.array(z.object(orderSummaryShape)),
  meta: pageMetaSchema,
})

const orderDetailSchema = z.object({
  ...orderSummaryShape,
  quoteId: z.string(),
  supplier: z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(SUPPLIER_TYPES),
    taxNumber: z.string().describe('VKN ya da TCKN; şahıs TCKN’si ön büroya maskeli (K-141)'),
    taxOffice: z.string(),
  }),
  note: z.string().nullable(),
  items: z.array(
    z.object({
      id: z.string(),
      position: z.number().int(),
      name: z.string(),
      quantity: z.number().int(),
      unit: z.enum(PURCHASE_UNITS),
      unitPriceCents: cents('KDV hariç birim fiyat, kuruş'),
      vatRate,
      ...amounts,
      stockItem: z
        .object({ id: z.string(), code: z.string(), name: z.string() })
        .nullable()
        .describe('Talep kaleminden kopyalanan stok kartı bağı (ON-339, K-221); yoksa boş'),
    }),
  ),
  createdByName: z.string().nullable(),
  sentByName: z.string().nullable(),
  cancelledByName: z.string().nullable(),
  cancelReason: z.string().nullable(),
})
export const purchaseOrderResponse = dataResponse(orderDetailSchema)

export const purchaseOrderParams = z.object({ orderId: z.uuid('Sipariş geçersiz.') })
export const purchaseOrderListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe('Sipariş numarasında (`SA-2026-0001`) ya da tedarikçi adında arama'),
  status: z.enum(PURCHASE_ORDER_STATUSES).optional().describe('Durum'),
  supplierId: z.uuid('Tedarikçi geçersiz.').optional().describe('Tedarikçi'),
  requestId: z.uuid('Talep geçersiz.').optional().describe('Satın alma talebi'),
})
