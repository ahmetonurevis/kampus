import { z } from 'zod'

import { MENTORSHIP_STATUSES } from '@kampus/school-core/lib/finance-teacher-mentorships.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Yeni öğretmen mentorluğu şemaları (DOM-FIN-136; ON-219). */

const checklistTemplateItem = z.object({ label: z.string(), required: z.boolean() })

export const settingsResponse = dataResponse(
  z.object({
    maxActivePerMentor: z.number().int().describe('Mentor başına süren en çok eşleşme (1–10)'),
    checklistItems: z
      .array(checklistTemplateItem)
      .describe('Yeni eşleşmelere kopyalanan kontrol listesi maddeleri'),
    isDefault: z.boolean().describe('Ayar yazılmadı; varsayılan değerler'),
    updatedAt: z.string().nullable(),
    version: z
      .number()
      .int()
      .nullable()
      .describe('`If-Match` için ayar sürümü; ayar yoksa boş (ilk yazma `If-Match` almaz)'),
  }),
)

const progressSchema = z
  .object({
    total: z.number().int(),
    done: z.number().int(),
    requiredTotal: z.number().int(),
    requiredDone: z.number().int(),
    percent: z
      .number()
      .int()
      .nullable()
      .describe('Tamamlanan madde / toplam madde, yüzde; madde yoksa boş'),
  })
  .describe('Kontrol listesi ilerlemesi (hesaplanır, saklanmaz)')

const mentorshipSchema = z.object({
  id: z.string(),
  // kvkk: K
  mentorMembershipId: z.string().describe('Mentorun kurum üyeliği'),
  mentorName: z.string(),
  // kvkk: K
  menteeMembershipId: z.string().describe('Yeni öğretmenin kurum üyeliği'),
  menteeName: z.string(),
  onboardingOfferId: z.string().nullable().describe('Bağlı işe başlama listesi (iş teklifi)'),
  onboardingPosition: z.string().nullable().describe('Bağlı teklifin pozisyonu'),
  startDate: z.string().describe('Başlangıç günü (YYYY-MM-DD)'),
  endDate: z.string().describe('Planlanan bitiş günü (YYYY-MM-DD)'),
  status: z
    .enum(MENTORSHIP_STATUSES)
    .describe('`active` sürüyor, `completed` tamamlandı, `ended_early` erken sonlandı'),
  closedOn: z.string().nullable().describe('Tamamlanma ya da sonlanma günü'),
  // kvkk: K (serbest metin)
  endReason: z.string().nullable().describe('Erken sonlanma gerekçesi'),
  meetingCount: z.number().int().describe('Görüşme sayısı (arşivliler hariç)'),
  lastMeetingDate: z.string().nullable().describe('Son görüşme günü'),
  daysSinceContact: z
    .number()
    .int()
    .nullable()
    .describe('Süren eşleşmede son görüşmeden (yoksa başlangıçtan) bu yana gün'),
  overdue: z.boolean().describe('Süren eşleşmede görüşmesizlik 30 günü aştı (K-465)'),
  checklist: progressSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` için eşleşme sürümü'),
})

export const mentorshipListResponse = z.object({
  data: z.array(mentorshipSchema),
  meta: pageMetaSchema,
})
export const mentorshipListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Mentor ya da yeni öğretmen adında'),
  status: z.enum(MENTORSHIP_STATUSES).optional().describe('Durum süzgeci'),
  overdue: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional()
    .describe('`true`: yalnız görüşmesi 30 günü aşan süren eşleşmeler'),
})

const meetingSchema = z.object({
  id: z.string(),
  meetingDate: z.string().describe('Görüşme günü (YYYY-MM-DD)'),
  durationMinutes: z.number().int().describe('Süre, dakika'),
  topic: z.string(),
  // kvkk: K (serbest metin)
  note: z.string().nullable(),
  // kvkk: K (serbest metin)
  nextStep: z.string().nullable(),
  createdAt: z.string(),
})

const checklistItemSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  label: z.string(),
  required: z.boolean(),
  completedAt: z.string().nullable().describe('Tamamlanma anı (ISO 8601 UTC)'),
  // kvkk: K
  completedByName: z.string().nullable().describe('Maddeyi işaretleyen'),
})

export const mentorshipResponse = dataResponse(
  mentorshipSchema.extend({
    meetings: z.array(meetingSchema).describe('Görüşmeler, yeni gün önce'),
    checklistItems: z.array(checklistItemSchema).describe('Kontrol listesi, sırasıyla'),
  }),
)

export const summaryResponse = dataResponse(
  z.object({
    active: z.number().int().describe('Süren eşleşme'),
    overdue: z.number().int().describe('Görüşmesi 30 günü aşan süren eşleşme'),
    completed: z.number().int(),
    endedEarly: z.number().int(),
    activeChecklistPercent: z
      .number()
      .int()
      .nullable()
      .describe('Süren eşleşmelerin bütün maddelerinde tamamlanma oranı, yüzde'),
  }),
)

export const mentorshipParams = z.object({ mentorshipId: z.uuid('Eşleşme geçersiz.') })
export const meetingParams = mentorshipParams.extend({
  meetingId: z.uuid('Görüşme geçersiz.'),
})
export const itemParams = mentorshipParams.extend({ itemId: z.uuid('Madde geçersiz.') })
