import { z } from 'zod'

import {
  ORIGINAL_INVOICE_TYPES,
  REFUND_DOCUMENT_KINDS,
  REFUND_DOCUMENT_STATUSES,
  REFUND_VAT_RATES,
} from '@kampus/school-core/lib/finance-refund-invoices.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** İade faturası ve iptal isteği şemaları (DOM-FIN-096; ON-266). */

const cents = (description: string) => z.number().int().describe(description)

export const refundInvoiceSchema = z.object({
  id: z.string(),
  withdrawalId: z.string().describe('Belgenin dayandığı ayrılış iadesi'),
  studentName: z.string().nullable(),
  withdrawalDate: z.string().describe('Ayrılış günü `YYYY-MM-DD`'),
  refundCents: cents('İade tutarı, kuruş'),
  refundPaidDate: z.string().nullable().describe('İadenin ödendiği gün'),
  kind: z
    .enum(REFUND_DOCUMENT_KINDS)
    .describe('`cancellation` asıl faturanın iptal isteği, `return_invoice` iade faturası (K-292)'),
  status: z
    .enum(REFUND_DOCUMENT_STATUSES)
    .describe(
      '`draft` taslak, `ready` gönderime hazır, `sent` iade faturası gönderildi, `cancelled` asıl fatura iptal edildi (K-294)',
    ),
  originalInvoice: z
    .object({
      number: z.string().describe('GİB numarası'),
      date: z.string(),
      type: z.enum(ORIGINAL_INVOICE_TYPES),
      totalCents: cents('KDV dahil tutar, kuruş'),
      vatRateBasisPoints: z.union(REFUND_VAT_RATES.map((rate) => z.literal(rate))),
    })
    .describe('Kampüs dışında kesilmiş asıl fatura; elle girilir'),
  cancelWindowEndsOn: z
    .string()
    .describe('İptal penceresinin son günü (dahil): e-Arşivde fatura günü + 7, e-Faturada + 8'),
  amountCents: cents('Belge tutarı (KDV dahil), kuruş'),
  netCents: cents('KDV hariç tutar, kuruş'),
  vatCents: cents('KDV, kuruş'),
  partial: z.boolean().describe('Belge asıl faturanın tamamından az mı (kısmi iade)'),
  note: z.string().nullable(),
  documentNumber: z.string().nullable().describe('Gönderilen iade faturasının numarası'),
  completedDate: z.string().nullable().describe('Sonucun işlendiği gün'),
  createdAt: z.string(),
  readyAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  actions: z
    .object({ ready: z.boolean(), complete: z.boolean(), discard: z.boolean() })
    .describe('Oturumdaki kullanıcının yapabilecekleri'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

export const refundInvoiceResponse = dataResponse(refundInvoiceSchema)
export const refundInvoiceListResponse = z.object({
  data: z.array(refundInvoiceSchema),
  meta: pageMetaSchema,
})

export const refundInvoiceListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  status: z.enum(REFUND_DOCUMENT_STATUSES).optional().describe('Durum'),
  kind: z.enum(REFUND_DOCUMENT_KINDS).optional().describe('Belge türü'),
  withdrawalId: z.uuid('Ayrılış kaydı geçersiz.').optional().describe('Ayrılış iadesi'),
})

export const refundInvoiceParams = z.object({
  refundInvoiceId: z.uuid('Belge kimliği geçersiz.'),
})
