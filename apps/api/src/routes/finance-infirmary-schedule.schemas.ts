import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  DOSE_CORRECTION_KINDS,
  DOSE_RECORD_KINDS,
  DOSE_SKIP_REASONS,
  DOSE_STATES,
} from '@kampus/school-core/lib/finance-infirmary-schedule.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** İlaç çizelgesi, atlama ve düzeltme şemaları (DOM-FIN-152; ON-161). */

const recordKind = z.enum(DOSE_RECORD_KINDS).describe('`administration` uygulama, `skip` atlama')
const skipReason = z
  .enum(DOSE_SKIP_REASONS)
  .nullable()
  .describe(
    'Atlama gerekçesi: `student_absent` öğrenci okulda yok, `refused` reddetti, `guardian_cancelled` veli iptal etti, `other` diğer; uygulamada boş',
  )

const correctionSchema = z.object({
  id: z.string(),
  kind: z.enum(DOSE_CORRECTION_KINDS).describe('`void` iptal, `amend` düzeltme'),
  reason: z.string().describe('Düzeltme gerekçesi (özel nitelikli)'),
  correctedByName: z.string().nullable(),
  createdAt: z.string(),
})

const doseRecordSchema = z.object({
  kind: recordKind,
  id: z.string(),
  consentId: z.string(),
  studentId: z.string(),
  doseDay: z.string().describe('Doz günü (Europe/Istanbul)'),
  scheduledTime: z.string(),
  voided: z.boolean().describe('Yönetici iptal ettiyse doğru; kayıt silinmez'),
  corrected: z.boolean().describe('Düzeltme ya da iptal kaydı var mı'),
  administeredAt: z.string().nullable().describe('Etkin uygulama anı; atlamada boş'),
  administeredByMembershipId: z.string().nullable(),
  administeredByName: z.string().nullable(),
  dose: z.string().nullable().describe('Verilen doz (özel nitelikli); atlamada boş'),
  skipReason,
  note: z.string().nullable().describe('Etkin not ya da açıklama (özel nitelikli)'),
  recordedByName: z.string().nullable(),
  createdAt: z.string(),
  corrections: z.array(correctionSchema).describe('Düzeltmeler, yazılış sırasıyla'),
})

export const doseRecordResponse = dataResponse(doseRecordSchema)

export const medicationChartResponse = dataResponse(
  z.object({
    date: z.string().describe('Çizelge günü (Europe/Istanbul)'),
    lateToleranceMinutes: z.number().int().describe('Kurumun gecikme payı (dk)'),
    items: z.array(
      z.object({
        consentId: z.string(),
        consentVersion: z.number().int(),
        studentId: z.string(),
        studentName: z.string().nullable(),
        medicationName: z.string(),
        dose: z.string().describe('Onaydaki doz'),
        scheduledTime: z.string(),
        dueAt: z.string().describe('Doz anı (UTC)'),
        state: z
          .enum(DOSE_STATES)
          .describe(
            '`overdue` gecikti, `pending` bekliyor, `administered` uygulandı, `skipped` atlandı',
          ),
        absent: z
          .boolean()
          .nullable()
          .describe('O günkü yoklamada yok ya da izinli; yoklama alınmadıysa ya da kapalıysa boş'),
        records: z
          .array(doseRecordSchema)
          .describe('Doz saatinin bütün kayıtları (iptal edilenler dahil), yazılış sırasıyla'),
      }),
    ),
  }),
)

export const guardianDoseListResponse = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      kind: recordKind,
      consentId: z.string(),
      studentId: z.string(),
      studentName: z.string().nullable(),
      medicationName: z.string().nullable(),
      doseDay: z.string(),
      scheduledTime: z.string(),
      administeredAt: z.string().nullable(),
      administeredByName: z.string().nullable(),
      dose: z.string().nullable(),
      skipReason,
      note: z.string().nullable(),
      corrected: z.boolean().describe('Okul kaydı düzeltti mi'),
    }),
  ),
  meta: pageMetaSchema,
})

export const medicationSettingsResponse = dataResponse(
  z.object({
    lateToleranceMinutes: z.number().int(),
    version: z.number().int().describe('`If-Match` sürümü; hiç kaydedilmediyse 1'),
  }),
)

export const chartQuery = z.strictObject({
  date: daySchema.optional().describe('Gün (YYYY-MM-DD, Europe/Istanbul); boşsa bugün'),
})

export const guardianDoseQuery = z.strictObject({
  ...pageQuerySchema.shape,
  studentId: z.string().trim().min(1).max(100).optional().describe('Çocuklardan biri'),
  from: daySchema.optional().describe('İlk gün (dahil); boşsa son günden 29 gün önce'),
  to: daySchema.optional().describe('Son gün (dahil); boşsa bugün'),
})

export const administrationParams = z.object({
  administrationId: z.uuid('Uygulama kaydı geçersiz.'),
})
export const skipParams = z.object({ skipId: z.uuid('Atlama kaydı geçersiz.') })
