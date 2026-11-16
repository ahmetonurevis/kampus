import { z } from 'zod'

import {
  LATE_REFUND_RULES,
  PAID_ACTIVITY_KINDS,
  PAID_ACTIVITY_STATUSES,
  PARTICIPATION_CANCEL_KINDS,
  PARTICIPATION_PAYMENT_STATUSES,
  PARTICIPATION_REFUND_STATUSES,
  PARTICIPATION_STATUSES,
} from '@kampus/school-core/lib/finance-paid-activities.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Gezi ve etkinlik ücreti yanıt ve sorgu şemaları (DOM-FIN-098; K-300…K-303). */

export const paidActivitySchema = z.object({
  id: z.string(),
  kind: z.enum(PAID_ACTIVITY_KINDS).describe('`trip` gezi, `event` etkinlik'),
  name: z.string(),
  activityDate: z.string().describe('Etkinlik günü (YYYY-MM-DD)'),
  feeCents: z.number().int().describe('Kişi başı ücret, kuruş'),
  joinDeadline: z.string().describe('Son katılım günü (dahil); katılım taksitinin vadesi'),
  cancelDeadline: z.string().describe('Son iptal günü (dahil); bu güne kadar tam iade'),
  capacity: z.number().int(),
  lateRefundRule: z
    .enum(LATE_REFUND_RULES)
    .describe('Geç iptal: `percent` oran kadar iade, `cost` masraf düşülür'),
  lateRefundPercent: z.number().int().nullable(),
  lateCostCents: z.number().int().nullable(),
  externalRef: z.string().nullable().describe('Gezi planı ya da başka kaynak kaydı (ON-155)'),
  status: z.enum(PAID_ACTIVITY_STATUSES),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  participantCount: z.number().int().describe('İptal edilmemiş katılımcı sayısı'),
  pendingRefundCount: z.number().int().describe('Ödenmemiş iade sayısı'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
export const paidActivityResponse = dataResponse(paidActivitySchema)
export const paidActivityListResponse = z.object({
  data: z.array(paidActivitySchema),
  meta: pageMetaSchema,
})
export const paidActivityQuery = z.strictObject({
  ...pageQuerySchema.shape,
  status: z.enum(PAID_ACTIVITY_STATUSES).optional().describe('Etkinlik durumu'),
})

export const participantSchema = z.object({
  id: z.string(),
  activityId: z.string(),
  studentId: z.string(),
  studentName: z.string().nullable(),
  invoiceId: z.string().describe('Katılım taksiti (`feeKind: activity`)'),
  feeCents: z.number().int(),
  joinedDate: z.string(),
  status: z.enum(PARTICIPATION_STATUSES),
  amountCents: z.number().int().describe('Katılım taksitinin tutarı'),
  collectedCents: z
    .number()
    .int()
    .describe('Taksite alınan tutar; iptal edilmişte iptal anındaki değer'),
  paymentStatus: z.enum(PARTICIPATION_PAYMENT_STATUSES),
  cancelKind: z
    .enum(PARTICIPATION_CANCEL_KINDS)
    .nullable()
    .describe('`participant` katılımcı iptali, `activity` kurum etkinliği iptal etti'),
  cancelledDate: z.string().nullable(),
  paidCents: z.number().int().nullable().describe('İptal anında alınmış tutar'),
  retainedCents: z.number().int().nullable().describe('Katılımcıda kalan kesinti'),
  refundCents: z.number().int().describe('İade edilecek tutar'),
  closedInvoiceId: z.string().nullable().describe('İptalde kapanan taksit'),
  debtInvoiceId: z.string().nullable().describe('Kesinti alınandan fazlaysa açılan taksit'),
  refundStatus: z.enum(PARTICIPATION_REFUND_STATUSES),
  refundPaidDate: z.string().nullable(),
  maskedIban: z.string().nullable().describe('Yalnız son dört hane'),
  refundAccountHolder: z.string().nullable(),
  refundBankAccountId: z.string().nullable(),
  refundBankAccountLabel: z.string().nullable(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
export const participantResponse = dataResponse(participantSchema)
export const participantListResponse = z.object({
  data: z.array(participantSchema),
  meta: pageMetaSchema,
})
export const participantQuery = z.strictObject({
  ...pageQuerySchema.shape,
  status: z.enum(PARTICIPATION_STATUSES).optional().describe('Katılım durumu'),
  refundStatus: z.enum(PARTICIPATION_REFUND_STATUSES).optional().describe('İade durumu'),
})

export const paidActivityParams = z.object({ activityId: z.uuid('Etkinlik kimliği geçersiz.') })
export const participantParams = z.object({
  participantId: z.uuid('Katılım kimliği geçersiz.'),
})
