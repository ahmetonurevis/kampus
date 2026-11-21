import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  OBSERVATION_PLAN_NOTICE_KINDS,
  OBSERVATION_PLAN_NOTICE_STATUSES,
  OBSERVATION_PLAN_STATUSES,
} from '@kampus/school-core/lib/finance-observation-plans.ts'
import { LESSON_OBSERVATION_STATUSES } from '@kampus/school-core/lib/finance-lesson-observations.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Ders gözlem planı şemaları (DOM-FIN-139; ON-207). */

const planSchema = z.object({
  id: z.string(),
  // kvkk: K
  teacherMembershipId: z.string().describe('Gözlenecek öğretmenin kurum üyeliği'),
  teacherName: z.string(),
  // kvkk: K
  observerMembershipId: z.string().describe('Gözlemcinin kurum üyeliği'),
  observerName: z.string(),
  templateId: z.string(),
  templateVersionId: z.string().describe('Plana yazılan form sürümü; gözlem bununla açılır'),
  templateName: z.string(),
  templateVersionNumber: z.number().int(),
  plannedDate: z.string().describe('Plan günü (YYYY-MM-DD)'),
  startTime: z.string().describe('Başlangıç saati SS:DD (Europe/Istanbul)'),
  endTime: z.string().describe('Bitiş saati SS:DD (başlangıç + süre; sunucu hesaplar)'),
  durationMinutes: z.number().int(),
  classId: z.string().nullable(),
  className: z.string().nullable(),
  subjectId: z.string().nullable(),
  subjectName: z.string().nullable(),
  performancePeriodId: z.string().nullable(),
  performancePeriodName: z.string().nullable(),
  // kvkk: K (serbest metin)
  note: z.string().nullable().describe('Gözlemin odağı'),
  status: z
    .enum(OBSERVATION_PLAN_STATUSES)
    .describe(
      '`planned` planlandı, `postponed` ertelendi (yeni gün ve saatte açık), `done` gerçekleşti, `cancelled` iptal',
    ),
  postponeCount: z.number().int(),
  // kvkk: K (serbest metin)
  postponeReason: z.string().nullable().describe('Son erteleme gerekçesi'),
  // kvkk: K (serbest metin)
  cancelReason: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  observationId: z.string().nullable().describe('Plandan açılan gözlem (DOM-FIN-130)'),
  observationStatus: z.enum(LESSON_OBSERVATION_STATUSES).nullable(),
  doneAt: z.string().nullable().describe('Bağlı gözlemin tamamlandığı an'),
  overdue: z
    .boolean()
    .describe('Geciken: günü (İstanbul) geçmiş, gerçekleşmemiş ve iptal edilmemiş (K-473)'),
  pendingNoticeCount: z
    .number()
    .int()
    .describe('Öğretmene gönderilecek bildirim sayısı (gönderim kanalı yok; K-474)'),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

const noticeSchema = z.object({
  id: z.string(),
  kind: z
    .enum(OBSERVATION_PLAN_NOTICE_KINDS)
    .describe('`scheduled` planlandı, `changed` değişti, `postponed` ertelendi, `cancelled` iptal'),
  status: z.enum(OBSERVATION_PLAN_NOTICE_STATUSES).describe('`pending` gönderilecek'),
  plannedDate: z.string().describe('Bildirim anındaki plan günü'),
  startTime: z.string().describe('Bildirim anındaki başlangıç saati'),
  createdAt: z.string(),
})

export const planResponse = dataResponse(planSchema)
export const planDetailResponse = dataResponse(
  planSchema.extend({
    notices: z.array(noticeSchema).describe('Öğretmene giden bildirimler, eskiden yeniye'),
  }),
)
export const planListResponse = z.object({ data: z.array(planSchema), meta: pageMetaSchema })

export const planListQuery = z
  .strictObject({
    ...pageQuerySchema.shape,
    from: daySchema.optional().describe('İlk gün (dahil; takvim aralığı)'),
    to: daySchema.optional().describe('Son gün (dahil)'),
    teacherMembershipId: z.string().trim().min(1).max(100).optional().describe('Öğretmen süzgeci'),
    observerMembershipId: z.string().trim().min(1).max(100).optional().describe('Gözlemci süzgeci'),
    status: z.enum(OBSERVATION_PLAN_STATUSES).optional().describe('Durum süzgeci'),
    overdue: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional()
      .describe('Yalnız geciken planlar'),
    performancePeriodId: z.uuid().optional().describe('Performans dönemi süzgeci'),
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: 'Son gün ilk günden önce olamaz.',
    path: ['to'],
  })

export const planParams = z.object({ planId: z.uuid('Plan geçersiz.') })
