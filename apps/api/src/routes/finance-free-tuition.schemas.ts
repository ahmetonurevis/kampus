import { z } from 'zod'

import {
  FREE_TUITION_DECISIONS,
  FREE_TUITION_DOCUMENTS,
  FREE_TUITION_REASONS,
  FREE_TUITION_STATUSES,
} from '@kampus/school-core/lib/finance-free-tuition.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Ücretsiz okutma yanıt ve sorgu şemaları (DOM-FIN-026; K-268…K-271). */

export const roundSchema = z.object({
  id: z.string(),
  academicYear: z.number().int().describe('Eğitim yılının başlangıç yılı'),
  teachingStartDate: z.string().describe('Öğretimin başladığı gün (YYYY-MM-DD)'),
  currentStudentCount: z.number().int().describe('Bugünkü etkin öğrenci sayısı'),
  currentMinimumQuota: z
    .number()
    .int()
    .describe('Bugünkü öğrenci sayısına göre en az kontenjan (%3, 0,5 yukarı)'),
  studentCount: z.number().int().nullable().describe('Kesinleşmedeki öğrenci sayısı'),
  computedQuota: z.number().int().nullable().describe('Kesinleşmedeki en az kontenjan'),
  confirmedQuota: z.number().int().nullable().describe('Kesinleşen kontenjan; boşsa kesinleşmedi'),
  quotaConfirmedAt: z.string().nullable(),
  applicationCount: z.number().int(),
  acceptedCount: z.number().int(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
export const roundResponse = dataResponse(roundSchema)
export const roundListResponse = z.object({ data: z.array(roundSchema) })

export const applicationSchema = z.object({
  id: z.string(),
  roundId: z.string(),
  studentId: z.string(),
  studentName: z.string().nullable(),
  reason: z.enum(FREE_TUITION_REASONS).describe('Gerekçe kodu (sabit liste)'),
  documents: z.array(z.enum(FREE_TUITION_DOCUMENTS)).describe('Teslim edilen belge kodları'),
  status: z.enum(FREE_TUITION_STATUSES),
  boardMeetingId: z.string().nullable(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
export const applicationResponse = dataResponse(applicationSchema)
export const applicationListResponse = z.object({
  data: z.array(applicationSchema),
  meta: pageMetaSchema,
})
export const applicationQuerySchema = z.strictObject({
  ...pageQuerySchema.shape,
  status: z.enum(FREE_TUITION_STATUSES).optional().describe('Aday durumu'),
})

export const meetingSummarySchema = z.object({
  id: z.string(),
  meetingDate: z.string(),
  memberCount: z.number().int(),
  acceptedCount: z.number().int(),
  reserveCount: z.number().int(),
  rejectedCount: z.number().int(),
})
export const meetingListResponse = z.object({ data: z.array(meetingSummarySchema) })

export const meetingSchema = z.object({
  id: z.string(),
  roundId: z.string(),
  academicYear: z.number().int(),
  meetingDate: z.string(),
  members: z.array(z.object({ name: z.string(), title: z.string() })),
  decisions: z.array(
    z.object({
      applicationId: z.string(),
      studentId: z.string(),
      studentName: z.string().nullable(),
      reason: z.enum(FREE_TUITION_REASONS),
      documents: z.array(z.enum(FREE_TUITION_DOCUMENTS)),
      decision: z.enum(FREE_TUITION_DECISIONS),
    }),
  ),
})
export const meetingResponse = dataResponse(meetingSchema)

export const awardSchema = z.object({
  id: z.string(),
  roundId: z.string(),
  applicationId: z.string(),
  boardMeetingId: z.string(),
  studentId: z.string(),
  studentName: z.string().nullable(),
  academicYear: z.number().int(),
  acceptedDate: z.string().describe('Kabul günü (kurul toplantısı)'),
  contractId: z.string().describe('İadenin ödeyicisini veren sözleşme'),
  contractIds: z.array(z.string()).describe('Hakkın kapsadığı sözleşmeler'),
  cancelledInvoiceIds: z.array(z.string()),
  refundedInvoiceIds: z.array(z.string()),
  waivedCents: z.number().int().describe('Kapanan taksitlerin tahsil edilmemiş kısmı, kuruş'),
  refundCents: z.number().int().describe('İade edilecek öğrenim tahsilatı, kuruş'),
  refundDueDate: z.string().describe('İadenin son günü'),
  refundStatus: z.enum(['none', 'pending', 'paid']),
  refundPaidDate: z.string().nullable(),
  maskedIban: z.string().nullable().describe('Yalnız son dört hane'),
  refundAccountHolder: z.string().nullable(),
  refundBankAccountId: z.string().nullable(),
  refundBankAccountLabel: z.string().nullable(),
  mebbisRecordedDate: z.string().nullable().describe("MEBBİS'e işlendiği gün"),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
export const awardResponse = dataResponse(awardSchema)
export const awardListResponse = z.object({ data: z.array(awardSchema), meta: pageMetaSchema })
export const awardQuerySchema = z.strictObject({
  ...pageQuerySchema.shape,
  roundId: z.uuid('Dönem kimliği geçersiz.').optional(),
  mebbis: z
    .enum(['recorded', 'unrecorded'])
    .optional()
    .describe("`unrecorded`: MEBBİS'e işlenmemiş haklar"),
  refundStatus: z.enum(['none', 'pending', 'paid']).optional().describe('İade durumu'),
})

export const roundParams = z.object({ roundId: z.uuid('Dönem kimliği geçersiz.') })
export const applicationParams = z.object({ applicationId: z.uuid('Aday kimliği geçersiz.') })
export const meetingParams = z.object({ meetingId: z.uuid('Toplantı kimliği geçersiz.') })
export const awardParams = z.object({ awardId: z.uuid('Hak kimliği geçersiz.') })
