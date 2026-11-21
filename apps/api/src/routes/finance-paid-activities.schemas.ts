import { z } from 'zod'

import {
  CONSENT_CHANNELS,
  CONSENT_STATUSES,
  LATE_REFUND_RULES,
  PAID_ACTIVITY_KINDS,
  PAID_ACTIVITY_STATUSES,
  PARTICIPATION_CANCEL_KINDS,
  PARTICIPATION_PAYMENT_STATUSES,
  PARTICIPATION_REFUND_STATUSES,
  PARTICIPATION_STATUSES,
} from '@kampus/school-core/lib/finance-paid-activities.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Gezi ve etkinlik ücreti yanıt ve sorgu şemaları (DOM-FIN-098; K-300…K-303); yedek listesi, veli
 * izni, toplu katılım ve katılım listesi DOM-FIN-112 (K-369…K-371).
 */

const FORM_STATUSES = ['pending', 'approved', 'rejected', 'not_targeted'] as const

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
  requiresConsent: z.boolean().describe('Katılım veli izni ister (K-370)'),
  permissionFormId: z
    .string()
    .nullable()
    .describe('İznin okunduğu dijital izin formu (IST-067, `permissionForms`)'),
  status: z.enum(PAID_ACTIVITY_STATUSES),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  participantCount: z
    .number()
    .int()
    .describe('Kontenjandan yer tutan katılım: asil ve izin bekleyen (K-369)'),
  awaitingConsentCount: z.number().int().describe('Veli izni bekleyen asil sayısı (K-370)'),
  waitlistCount: z.number().int().describe('İptal edilmemiş yedek sayısı (K-369)'),
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
  classId: z.string().nullable(),
  className: z.string().nullable(),
  invoiceId: z
    .string()
    .nullable()
    .describe('Katılım taksiti (`feeKind: activity`); yedek ve izin bekleyende yok'),
  feeCents: z.number().int(),
  joinedDate: z.string(),
  status: z
    .enum(PARTICIPATION_STATUSES)
    .describe(
      '`active` asil, `awaiting_consent` asil ama veli izni bekleniyor (taksit yok), `waitlisted` yedek, `cancelled` iptal',
    ),
  waitlistPosition: z.number().int().nullable().describe('Yedek sıra numarası (değişmez)'),
  waitlistRank: z.number().int().nullable().describe('Yedeğin güncel sırası (1’den)'),
  promotedAt: z.string().nullable().describe('Yedekten asile geçiş anı'),
  consentStatus: z.enum(CONSENT_STATUSES).describe('Veli izni (K-370)'),
  consentChannel: z.enum(CONSENT_CHANNELS).nullable(),
  consentGrantorName: z.string().nullable().describe('Elle girilen izinde izni veren kişi'),
  consentAt: z.string().nullable(),
  consentWithdrawnAt: z.string().nullable(),
  consentWithdrawalChannel: z.enum(CONSENT_CHANNELS).nullable(),
  permissionStatus: z
    .enum(FORM_STATUSES)
    .nullable()
    .describe('Bağlı izin formundaki durum; form bağlı değil ya da kullanılamıyorsa `null`'),
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
  consentStatus: z.enum(CONSENT_STATUSES).optional().describe('Veli izni durumu'),
  refundStatus: z.enum(PARTICIPATION_REFUND_STATUSES).optional().describe('İade durumu'),
})

export const paidActivityParams = z.object({ activityId: z.uuid('Etkinlik kimliği geçersiz.') })
export const participantParams = z.object({
  participantId: z.uuid('Katılım kimliği geçersiz.'),
})

export const bulkJoinResponse = dataResponse(
  z.object({
    activity: paidActivitySchema,
    participantIds: z.array(z.string()),
    activeCount: z.number().int().describe('Asil yazılan (taksit açılan)'),
    awaitingConsentCount: z.number().int().describe('Asil, veli izni bekleyen'),
    waitlistedCount: z.number().int().describe('Yedeğe yazılan'),
    skippedStudentIds: z.array(z.string()).describe('Zaten katılımı olduğu için atlanan'),
  }),
)

export const consentSyncResponse = dataResponse(
  z.object({
    activity: paidActivitySchema,
    grantedCount: z.number().int(),
    withdrawnCount: z.number().int(),
    inactiveCancelledCount: z
      .number()
      .int()
      .describe(
        'Etkin olmayan (ayrılmış ya da mezun) öğrencinin parasız iptal edilen yedek ve izin bekleyen katılımı (K-418)',
      ),
    promotedCount: z.number().int(),
  }),
)

export const withdrawnLeftoverSchema = z.object({
  id: z.string().describe('Katılım kimliği'),
  activityId: z.string(),
  activityName: z.string(),
  activityDate: z.string().describe('Etkinlik günü (YYYY-MM-DD)'),
  studentId: z.string(),
  studentName: z.string().nullable(),
  status: z.enum(['waitlisted', 'awaiting_consent']).describe('Yedek ya da izin bekleyen'),
  withdrawalDate: z.string().describe('Öğrencinin son ayrılış günü (YYYY-MM-DD)'),
  version: z.number().int(),
})
export const withdrawnLeftoverListResponse = z.object({
  data: z.array(withdrawnLeftoverSchema),
  meta: pageMetaSchema,
})
export const withdrawnLeftoverQuery = z.strictObject({ ...pageQuerySchema.shape })
export const withdrawnLeftoverCancelResponse = dataResponse(
  z.object({
    cancelledIds: z.array(z.string()).describe('Parasız iptal edilen katılımlar'),
    promotedCount: z.number().int().describe('Boşalan yere asile geçen yedek'),
  }),
)

export const rosterResponse = dataResponse(
  z.object({
    activity: paidActivitySchema,
    items: z.array(
      z.object({
        id: z.string(),
        studentId: z.string(),
        studentName: z.string(),
        className: z.string().nullable(),
        guardianPhoneMasked: z.string().nullable().describe('Veli telefonu yalnız maskeli (KVKK)'),
        status: z.enum(['active', 'awaiting_consent', 'waitlisted']),
        waitlistRank: z.number().int().nullable(),
        consentStatus: z.enum(CONSENT_STATUSES),
        consentChannel: z.enum(CONSENT_CHANNELS).nullable(),
        paymentStatus: z.enum(PARTICIPATION_PAYMENT_STATUSES),
        amountCents: z.number().int(),
        collectedCents: z.number().int(),
      }),
    ),
  }),
)
