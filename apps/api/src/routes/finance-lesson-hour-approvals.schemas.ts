import { z } from 'zod'

import {
  LESSON_CONFIRMATION_CHANNELS,
  LESSON_CONFIRMATION_OUTCOMES,
  LESSON_SHEET_STATUSES,
  LESSON_TEACHER_STATES,
} from '@kampus/school-core/lib/finance-lesson-hour-approvals.ts'
import { LESSON_PAY_TYPES } from '@kampus/school-core/lib/finance-pay-rates.ts'
import { payrollMonthSchema } from '@kampus/school-core/lib/finance-payroll-exports.ts'

import { dataResponse } from './common.schemas.ts'

/**
 * Ek ders çizelgesi onayı şemaları (DOM-FIN-120; ON-196). Yanıt tutar taşımaz; saat, durum ve
 * öğretmen yanıtları döner (K-409).
 */

export const lessonSheetParams = z.object({
  month: payrollMonthSchema.describe('Çizelge ayı (YYYY-AA)'),
})

const entrySchema = z.object({
  id: z.string(),
  membershipId: z.string(),
  staffName: z.string(),
  role: z.string().describe('Rol: `yonetici`, `ogretmen` ya da `onburo`'),
  staffActive: z.boolean(),
  lessonType: z.enum(LESSON_PAY_TYPES),
  hours: z.number().int(),
  note: z.string().nullable(),
  version: z.number().int().describe('`If-Match` için saat kaydı sürümü'),
})

const staffSchema = z.object({
  membershipId: z.string(),
  staffName: z.string(),
  role: z.string(),
  staffActive: z.boolean(),
  state: z
    .enum(LESSON_TEACHER_STATES)
    .describe(
      '`pending` teyit bekleniyor (yanıt yok ya da saat sonradan değişti), `confirmed` teyit edildi, `disputed` itiraz etti',
    ),
  totalHours: z.number().int().describe('Personelin ayın toplam saati (ek ders ve nöbet)'),
  entryCount: z.number().int(),
  lastResponse: z
    .object({
      outcome: z.enum(LESSON_CONFIRMATION_OUTCOMES),
      channel: z.enum(LESSON_CONFIRMATION_CHANNELS),
      reason: z.string().nullable().describe('İtiraz gerekçesi'),
      recordedAt: z.string(),
      recordedByName: z.string().nullable().describe('Yanıtı öğretmen adına işleyen kullanıcı'),
      current: z.boolean().describe('Yanıt bugünkü saat kayıtlarına mı verildi'),
    })
    .nullable(),
})

export const lessonSheetResponse = dataResponse(
  z.object({
    month: z.string(),
    status: z
      .enum(LESSON_SHEET_STATUSES)
      .describe('`draft` taslak, `teacher_review` öğretmen kontrolünde, `approved` müdür onaylı'),
    version: z.number().int().nullable().describe('Çizelge sürümü; hiç gönderilmemiş ayda boş'),
    payrollLocked: z.boolean().describe('Bordro dönemi kilitli mi (DOM-FIN-108)'),
    entriesHash: z
      .string()
      .describe('Ayın saat kayıtlarının SHA-256 damgası; müdür onayı bunu gönderir'),
    submittedAt: z.string().nullable(),
    submittedByName: z.string().nullable(),
    approvedAt: z.string().nullable().describe('Son müdür onayı'),
    approvedByName: z.string().nullable(),
    approvalCount: z.number().int(),
    reopenedAt: z.string().nullable(),
    reopenedByName: z.string().nullable(),
    reopenReason: z.string().nullable(),
    entries: z.array(entrySchema),
    staff: z.array(staffSchema).describe('Saati girilmiş personel ve teyit durumu, ada göre'),
  }),
)
