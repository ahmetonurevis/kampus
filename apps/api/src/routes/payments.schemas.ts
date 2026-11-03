import { z } from 'zod'

import { PAYMENT_METHODS } from '@kampus/school-core/lib/payments.ts'
import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Tahsilat uçlarının yol, sorgu ve yanıt şemaları; gövde şemaları core'dadır (`lib/payments.ts`). */

export const paymentParamsSchema = z.object({
  paymentId: z.uuid('Tahsilat kimliği geçersiz.').describe('Tahsilat kimliği'),
})

export const paymentListQuerySchema = z.strictObject({
  ...pageQuerySchema.shape,
  studentId: z.string().min(1).max(200).optional().describe('Yalnız bu öğrencinin tahsilatları'),
  q: z.string().trim().min(2).max(100).optional().describe('Öğrenci adı veya işlem referansı'),
  mebbis: z
    .enum(['pending'])
    .optional()
    .describe("Yalnız MEBBİS'e işlenmemiş geçerli tahsilatlar (personel)"),
  method: z.enum(PAYMENT_METHODS).optional().describe('Yalnız bu ödeme yöntemiyle alınanlar'),
})

const paymentSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  studentName: z.string().nullable(),
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
  bankAccountLabel: z.string().nullable().describe('Tahsilatın yapıldığı hesabın kısa adı'),
  mebbisRecordedAt: z
    .string()
    .nullable()
    .describe("MEBBİS'e işlendiği an (ISO 8601 UTC); yalnız personele döner"),
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

export const bankAccountParamsSchema = z.object({
  bankAccountId: z.uuid('Hesap kimliği geçersiz.').describe('Banka hesabı kimliği'),
})

const bankAccountViewSchema = z.object({
  id: z.string(),
  bankName: z.string().describe('Banka adı'),
  iban: z.string().describe('Kurum hesabının IBAN numarası'),
  accountHolder: z.string().describe('Hesap sahibi'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

export const bankAccountResponseSchema = dataResponse(bankAccountViewSchema)
export const bankAccountListResponseSchema = dataResponse(z.array(bankAccountViewSchema))
export const bankAccountArchiveResponseSchema = dataResponse(z.object({ id: z.string() }))
