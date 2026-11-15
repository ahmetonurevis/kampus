import { z } from 'zod'

import {
  INVOICE_MATCH_APPROVAL_FILTERS,
  INVOICE_MATCH_FILTERS,
  INVOICE_MATCH_STATUSES,
  INVOICE_MISMATCH_STATUSES,
} from '@kampus/school-core/lib/finance-invoice-matching.ts'
import { PURCHASE_ORDER_STATUSES } from '@kampus/school-core/lib/finance-purchase-orders.ts'
import { PURCHASE_UNITS } from '@kampus/school-core/lib/finance-purchase-requests.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Tedarikçi faturası üçlü eşleştirme şemaları (DOM-FIN-095; ON-277). */

const cents = (description: string) => z.number().int().describe(description)
const quantity = (description: string) => z.number().int().describe(description)
const status = z
  .enum(INVOICE_MATCH_STATUSES)
  .describe(
    '`matched` eşleşti, `quantity_mismatch` faturalanan kabul edileni aşıyor, `price_mismatch` birim fiyat farkı toleransı aşıyor, `unmatched` siparişte olmayan kalem ya da kalemsiz fatura',
  )

const matchLineSchema = z.object({
  orderItemId: z.string().nullable().describe('Sipariş kalemi; siparişte olmayan kalemde boş'),
  name: z.string().describe('Sipariş kaleminin adı ya da siparişte olmayan kalemin adı'),
  unit: z.enum(PURCHASE_UNITS).nullable(),
  orderedQuantity: quantity('Sipariş miktarı').nullable(),
  orderUnitPriceCents: cents('Siparişteki KDV hariç birim fiyat').nullable(),
  acceptedQuantity: quantity('İptal edilmemiş kabullerde kabul edilen').nullable(),
  previouslyInvoicedQuantity: quantity(
    'Bu faturadan önceki etkin faturalarda aynı kaleme faturalanan',
  ).nullable(),
  invoicedQuantity: quantity('Bu faturada faturalanan'),
  invoiceUnitPriceCents: cents('Faturadaki KDV hariç birim fiyat'),
  quantityExcess: quantity(
    'Önceki ve bu faturada faturalanan toplamın kabul edileni aştığı miktar',
  ),
  unitPriceDifferenceCents: cents('Birim fiyat farkı (fatura − sipariş)'),
  lineDifferenceCents: cents('Fiyat farkının kalem tutarına etkisi'),
  status,
})

/** Fatura ayrıntısındaki eşleştirme; siparişsiz faturada `null`. */
export const invoiceMatchingSchema = z
  .object({
    status,
    lines: z.array(matchLineSchema),
    approved: z.boolean().describe('Bugünkü sapma gerekçeyle onaylanmış'),
    approvalRequired: z.boolean().describe('Ödeme fark onayı istiyor (K-282)'),
    toleranceCents: cents('Fiyat toleransı: kalem etkisi bu tutarı aşmazsa eşleşir (K-281)'),
    approval: z
      .object({
        status: z.enum(INVOICE_MISMATCH_STATUSES).describe('Onaylanan sapma'),
        approvedAt: z.string(),
        approvedByName: z.string().nullable(),
        reason: z.string(),
      })
      .nullable()
      .describe('Son fark onayı; onaylanan sapma bugünküyle aynı değilse geçersizdir'),
  })
  .nullable()
  .describe('Üçlü eşleştirme (DOM-FIN-095); siparişe bağlı olmayan faturada boş')

export const invoiceMatchListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  status: z
    .enum(INVOICE_MATCH_FILTERS)
    .default('mismatched')
    .describe('Eşleştirme durumu; `mismatched` (varsayılan) eşleşme dışındaki bütün durumlar'),
  approval: z
    .enum(INVOICE_MATCH_APPROVAL_FILTERS)
    .optional()
    .describe('`pending` onay bekleyen, `approved` farkı onaylanmış'),
  supplierId: z.uuid('Tedarikçi geçersiz.').optional(),
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe('Fatura numarası, tedarikçi adı ya da sipariş numarasında arama'),
})

export const invoiceMatchListResponse = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      invoiceNumber: z.string(),
      invoiceDate: z.string().describe('Fatura tarihi `YYYY-MM-DD`'),
      supplier: z.object({ id: z.string(), name: z.string() }),
      purchaseOrder: z.object({ id: z.string(), number: z.string() }),
      grossCents: cents('KDV dahil tutar'),
      remainingCents: cents('Ödenmemiş kalan (KDV dahil)'),
      status,
      approved: z.boolean(),
      approvalRequired: z.boolean(),
      approvedAt: z.string().nullable().describe('Geçerli fark onayının anı'),
      quantityLines: quantity('Miktar farkı olan kalem sayısı'),
      priceLines: quantity('Fiyat farkı olan kalem sayısı'),
      unmatchedLines: quantity('Siparişte olmayan kalem sayısı'),
      priceDifferenceCents: cents('Fiyat farkı olan kalemlerin fark toplamı (KDV hariç)'),
    }),
  ),
  meta: pageMetaSchema,
})

export const purchaseOrderMatchingParams = z.object({ orderId: z.uuid('Sipariş geçersiz.') })

export const purchaseOrderMatchingResponse = dataResponse(
  z.object({
    order: z.object({
      id: z.string(),
      number: z.string(),
      status: z.enum(PURCHASE_ORDER_STATUSES),
    }),
    status: status.nullable().describe('Etkin faturaların en ağır durumu; fatura yoksa boş'),
    items: z.array(
      z.object({
        orderItemId: z.string(),
        name: z.string(),
        unit: z.enum(PURCHASE_UNITS),
        orderedQuantity: quantity('Sipariş miktarı'),
        acceptedQuantity: quantity('Kabul edilen'),
        invoicedQuantity: quantity('Etkin faturalarda faturalanan'),
        unitPriceCents: cents('Siparişteki KDV hariç birim fiyat'),
        differenceQuantity: quantity('Faturalanan − kabul edilen; eksi faturası beklenen kabuldür'),
      }),
    ),
    invoices: z
      .array(
        z.object({
          id: z.string(),
          invoiceNumber: z.string(),
          invoiceDate: z.string(),
          grossCents: cents('KDV dahil tutar'),
          cancelled: z.boolean(),
          status,
          approved: z.boolean(),
          approvalRequired: z.boolean(),
        }),
      )
      .describe('Siparişe bağlı faturalar (iptal edilenler dahil), fatura tarihi sırasıyla'),
  }),
)
