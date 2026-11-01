import { z } from 'zod'

import { PAYMENT_METHODS } from '@kampus/school-core/lib/domain.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Tahsilat uçlarının yol, sorgu ve yanıt şemaları; gövde şemaları core'dadır (`lib/payments.ts`). */

export const paymentParamsSchema = z.object({
  paymentId: z.uuid('Tahsilat kimliği geçersiz.').describe('Tahsilat kimliği'),
})

export const paymentListQuerySchema = z.strictObject({
  ...pageQuerySchema.shape,
  studentId: z.string().min(1).max(200).optional().describe('Yalnız bu öğrencinin tahsilatları'),
})

const paymentSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  amountCents: z.number().int().describe('Tahsilat tutarı (kuruş)'),
  creditCents: z
    .number()
    .int()
    .describe('Taksitlere dağıtılmayan, iade alacağı olan tutar (kuruş)'),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().nullable().describe('Banka veya POS işlem referansı'),
  paidAt: z.string().describe('Ödeme anı (ISO 8601 UTC)'),
  receiptYear: z.number().int().describe('Dekont yılı'),
  receiptNumber: z.number().int().describe('Kurum ve yıl içinde ardışık dekont numarası'),
  reversedAt: z.string().nullable().describe('İptal anı; iptal edilmediyse boş'),
  reversalReason: z.string().nullable().describe('İptal gerekçesi; yalnız personele döner'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
  allocations: z.array(
    z.object({
      invoiceId: z.string(),
      amountCents: z.number().int().describe('Taksite dağıtılan tutar (kuruş)'),
    }),
  ),
})

export const paymentResponseSchema = dataResponse(paymentSchema)
export const paymentListResponseSchema = z.object({
  data: z.array(paymentSchema),
  meta: pageMetaSchema,
})

export const paymentSettingsResponseSchema = dataResponse(
  z.object({
    cashPaymentsEnabled: z.boolean().describe('Bu kurumda nakit tahsilat açık mı'),
    version: z.number().int().describe('`If-Match` için ayar sürümü; hiç değişmediyse 1'),
  }),
)
