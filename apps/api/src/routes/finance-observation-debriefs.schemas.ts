import { z } from 'zod'

import { LESSON_OBSERVATION_STATUSES } from '@kampus/school-core/lib/finance-lesson-observations.ts'
import {
  DEVELOPMENT_GOAL_SOURCES,
  DEVELOPMENT_GOAL_STATUSES,
  OBSERVATION_DEBRIEF_STATUSES,
} from '@kampus/school-core/lib/finance-observation-debriefs.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Gözlem sonrası görüşme ve gelişim hedefi şemaları (DOM-FIN-133; ON-209). */

const participantSchema = z.object({
  // kvkk: K
  membershipId: z.string().describe('Katılanın kurum üyeliği'),
  name: z.string(),
  role: z.string().describe('Üyelik rolü (`yonetici`, `ogretmen`)'),
  active: z.boolean().describe('Üyelik etkin mi; ayrılmış personel listede kalabilir'),
})

const debriefSchema = z.object({
  id: z.string(),
  observationId: z.string(),
  observedDate: z.string().describe('Gözlem günü (YYYY-MM-DD)'),
  observationStatus: z.enum(LESSON_OBSERVATION_STATUSES),
  // kvkk: K
  teacherMembershipId: z.string().describe('Gözlenen öğretmenin kurum üyeliği'),
  teacherName: z.string(),
  // kvkk: K
  observerMembershipId: z.string().describe('Gözlemcinin kurum üyeliği'),
  observerName: z.string(),
  debriefDate: z.string().describe('Görüşme günü (YYYY-MM-DD)'),
  participants: z.array(participantSchema).describe('Görüşmeye katılanlar, ada göre'),
  // kvkk: K (serbest metin)
  strengths: z.string().nullable().describe('Güçlü yönler'),
  // kvkk: K (serbest metin)
  developmentAreas: z.string().nullable().describe('Gelişim alanları'),
  // kvkk: K (serbest metin)
  teacherComment: z.string().nullable().describe('Öğretmenin görüşü'),
  status: z
    .enum(OBSERVATION_DEBRIEF_STATUSES)
    .describe('`draft` taslak (düzeltilebilir), `finalized` kesinleşti (değişmez)'),
  finalizedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

export const debriefResponse = dataResponse(debriefSchema)
export const debriefLookupResponse = dataResponse(
  debriefSchema
    .nullable()
    .describe('Gözlemin görüşmesi; görüşme yoksa ya da öğretmen henüz göremiyorsa boş'),
)

const goalSchema = z.object({
  id: z.string(),
  // kvkk: K
  teacherMembershipId: z.string().describe('Hedefin öğretmeni (kurum üyeliği)'),
  teacherName: z.string(),
  source: z
    .enum(DEVELOPMENT_GOAL_SOURCES)
    .describe('`observation_debrief` gözlem görüşmesinden, `direct` doğrudan'),
  debriefId: z.string().nullable().describe('Kaynak gözlem görüşmesi'),
  observationId: z.string().nullable().describe('Kaynak görüşmenin gözlemi'),
  observedDate: z.string().nullable().describe('Kaynak gözlemin günü'),
  // kvkk: K
  observerMembershipId: z.string().nullable().describe('Kaynak gözlemin gözlemcisi'),
  performancePeriodId: z.string().nullable().describe('Bağlı performans dönemi (DOM-FIN-124)'),
  performancePeriodName: z.string().nullable(),
  // kvkk: K
  title: z.string().describe('Hedef'),
  // kvkk: K
  successCriterion: z.string().describe('Ölçüt'),
  followUpDate: z.string().describe('Takip tarihi (YYYY-MM-DD)'),
  status: z
    .enum(DEVELOPMENT_GOAL_STATUSES)
    .describe('`open` açık, `in_progress` sürüyor, `achieved` ulaşıldı, `dropped` bırakıldı'),
  active: z.boolean().describe('Takip sürüyor mu (açık ya da sürüyor)'),
  overdue: z.boolean().describe('Takip tarihi İstanbul gününe göre geçmiş süren hedef (K-455)'),
  overdueDays: z.number().int().describe('Gecikme günü; gecikmemişse 0'),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

const goalNoteSchema = z.object({
  id: z.string(),
  // kvkk: K (serbest metin)
  note: z.string(),
  statusFrom: z.enum(DEVELOPMENT_GOAL_STATUSES).describe('Not yazıldığındaki durum'),
  statusTo: z
    .enum(DEVELOPMENT_GOAL_STATUSES)
    .nullable()
    .describe('Notla geçilen durum; değişmediyse boş'),
  nextFollowUpDate: z.string().nullable().describe('Notla verilen sonraki takip tarihi'),
  authorName: z.string().nullable(),
  createdAt: z.string(),
})

export const goalListResponse = z.object({ data: z.array(goalSchema), meta: pageMetaSchema })
export const goalDetailResponse = dataResponse(
  goalSchema.extend({
    notes: z.array(goalNoteSchema).describe('Takip geçmişi, eskiden yeniye; değişmez'),
  }),
)
export const goalListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Öğretmen adında arama'),
  status: z.enum(DEVELOPMENT_GOAL_STATUSES).optional().describe('Durum süzgeci'),
  teacherMembershipId: z.string().trim().min(1).max(100).optional().describe('Öğretmen süzgeci'),
  performancePeriodId: z.uuid().optional().describe('Performans dönemi süzgeci'),
  debriefId: z.uuid().optional().describe('Kaynak görüşme süzgeci'),
  overdue: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional()
    .describe('Yalnız takip tarihi geçmiş süren (açık ya da sürüyor) hedefler'),
})

export const observationParams = z.object({ observationId: z.uuid('Gözlem geçersiz.') })
export const debriefParams = z.object({ debriefId: z.uuid('Görüşme geçersiz.') })
export const goalParams = z.object({ goalId: z.uuid('Hedef geçersiz.') })
