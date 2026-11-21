import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  DEPARTMENT_DECISION_STATUSES,
  DEPARTMENT_MEETING_ATTENDANCE,
  DEPARTMENT_MEETING_KINDS,
  DEPARTMENT_MEETING_STATUSES,
  MEETING_BOARDS,
} from '@kampus/school-core/lib/finance-department-meetings.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Kurul ve zümre toplantısı tutanağı şemaları (DOM-FIN-132, DOM-FIN-135; ON-217, ON-218). */

const boardSchema = z
  .enum(MEETING_BOARDS)
  .describe('Kurul türü: `department` zümre, `teachers` öğretmenler kurulu, `class` şube kurulu')

const meetingFields = {
  id: z.string(),
  board: boardSchema,
  subjectId: z.string().nullable().describe('Zümrenin dersi; yalnız zümre toplantısında'),
  subjectName: z
    .string()
    .nullable()
    .describe('Ders adı (toplantı anındaki kopya); yalnız zümre toplantısında'),
  classId: z.string().nullable().describe('Şube kurulunun sınıfı; yalnız şube kurulunda'),
  className: z
    .string()
    .nullable()
    .describe('Sınıf adı (toplantı anındaki kopya); yalnız şube kurulunda'),
  agendaTemplateId: z.string().nullable().describe('Gündemin kopyalandığı şablon (iz)'),
  kind: z.enum(DEPARTMENT_MEETING_KINDS).describe('Toplantı zamanı'),
  meetingDate: z.string().describe('Toplantı günü (YYYY-MM-DD)'),
  location: z.string(),
  chairMembershipId: z.string().describe('Başkanın kurum üyeliği'),
  // kvkk: K
  chairName: z.string().describe('Başkanın adı (üyelikten)'),
  agendaCount: z.number().int().describe('Gündem maddesi sayısı'),
  status: z.enum(DEPARTMENT_MEETING_STATUSES),
  signedDate: z.string().nullable().describe('İmza günü; yalnız kesinleşmiş tutanakta'),
  finalizedAt: z.string().nullable(),
  attendeeCount: z.number().int(),
  attendedCount: z.number().int().describe('"Katıldı" işaretli katılımcı sayısı'),
  decisionCount: z.number().int(),
  openDecisionCount: z.number().int().describe('Açık karar sayısı'),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
}
const meetingSchema = z.object(meetingFields)

const decisionSchema = z.object({
  id: z.string(),
  number: z.string().describe('Karar numarası "madde.sıra" (saklanmaz, gündem sırasından)'),
  agendaItemId: z.string(),
  text: z.string(),
  responsibleMembershipId: z.string(),
  // kvkk: K
  responsibleName: z.string().describe('Sorumlunun adı (üyelikten)'),
  dueDate: z.string().nullable().describe('Termin günü (YYYY-MM-DD)'),
  status: z.enum(DEPARTMENT_DECISION_STATUSES),
  followUpNote: z.string().nullable(),
  overdue: z.boolean().describe('Termini geçmiş açık karar (İstanbul günü)'),
  statusChangedAt: z.string(),
  createdAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

const detailSchema = z.object({
  ...meetingFields,
  agenda: z
    .array(z.object({ id: z.string(), title: z.string(), discussion: z.string().nullable() }))
    .describe('Gündem maddeleri, sırasıyla'),
  attendees: z
    .array(
      z.object({
        membershipId: z.string(),
        // kvkk: K
        name: z.string(),
        role: z.string(),
        active: z.boolean().describe('Üyelik etkin mi (ayrılmış personel tutanakta kalır)'),
        status: z.enum(DEPARTMENT_MEETING_ATTENDANCE),
      }),
    )
    .describe('Katılımcılar, ada göre'),
  decisions: z.array(decisionSchema).describe('Kararlar, numara sırasıyla'),
})

export const meetingResponse = dataResponse(detailSchema)
export const meetingListResponse = z.object({ data: z.array(meetingSchema), meta: pageMetaSchema })
export const decisionResponse = dataResponse(decisionSchema)
export const decisionRemoveResponse = dataResponse(z.object({ id: z.string() }))

export const meetingListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe('Ders ya da sınıf adında ya da yerde arama'),
  board: z.enum(MEETING_BOARDS).optional().describe('Kurul türü'),
  subjectId: z.string().trim().min(1).max(60).optional().describe('Zümre (ders)'),
  classId: z.string().trim().min(1).max(100).optional().describe('Şube kurulunun sınıfı'),
  kind: z.enum(DEPARTMENT_MEETING_KINDS).optional().describe('Toplantı zamanı'),
  status: z.enum(DEPARTMENT_MEETING_STATUSES).optional().describe('Tutanak durumu'),
  from: daySchema.optional().describe('Bu günden itibaren (YYYY-MM-DD)'),
  to: daySchema.optional().describe('Bu güne kadar (YYYY-MM-DD); başlangıçtan önceyse liste boş'),
})

export const decisionListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  status: z.enum(DEPARTMENT_DECISION_STATUSES).optional().describe('Karar durumu'),
  overdue: z
    .enum(['true'])
    .optional()
    .describe('`true`: yalnız termini geçmiş açık kararlar (İstanbul günü)'),
  responsibleMembershipId: z.string().trim().min(1).max(100).optional().describe('Sorumlu'),
  subjectId: z.string().trim().min(1).max(60).optional().describe('Zümre (ders)'),
  board: z.enum(MEETING_BOARDS).optional().describe('Kurul türü (K-462)'),
})

const decisionListItem = z.object({
  id: z.string(),
  meetingId: z.string(),
  board: boardSchema,
  subjectName: z.string().nullable().describe('Zümre toplantısında ders adı'),
  className: z.string().nullable().describe('Şube kurulunda sınıf adı'),
  meetingDate: z.string(),
  meetingKind: z.enum(DEPARTMENT_MEETING_KINDS),
  agendaTitle: z.string().describe('Bağlı gündem maddesi'),
  text: z.string(),
  responsibleMembershipId: z.string(),
  // kvkk: K
  responsibleName: z.string(),
  dueDate: z.string().nullable(),
  status: z.enum(DEPARTMENT_DECISION_STATUSES),
  followUpNote: z.string().nullable(),
  overdue: z.boolean(),
  overdueDays: z.number().int().describe('Termin ertesinden bugüne gün; gecikmemişse 0'),
  statusChangedAt: z.string(),
  version: z.number().int(),
})
export const decisionListResponse = z.object({
  data: z.array(decisionListItem),
  meta: pageMetaSchema,
})

export const subjectListResponse = dataResponse(
  z.array(z.object({ id: z.string(), name: z.string() })).describe('Zümre (ders) seçenekleri'),
)

export const meetingParams = z.object({ meetingId: z.uuid('Toplantı geçersiz.') })
export const decisionParams = z.object({
  meetingId: z.uuid('Toplantı geçersiz.'),
  decisionId: z.uuid('Karar geçersiz.'),
})

const templateSchema = z.object({
  id: z.string(),
  board: boardSchema,
  name: z.string(),
  items: z.array(z.object({ title: z.string() })).describe('Gündem maddeleri, sırasıyla'),
  archivedAt: z.string().nullable().describe('Arşivlenme anı; etkin şablonda boş'),
  meetingCount: z.number().int().describe('Bu şablondan açılmış toplantı sayısı'),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
export const templateResponse = dataResponse(templateSchema)
export const templateListResponse = z.object({
  data: z.array(templateSchema),
  meta: pageMetaSchema,
})
export const templateListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  board: z.enum(MEETING_BOARDS).optional().describe('Kurul türü'),
  archived: z
    .enum(['true'])
    .optional()
    .describe('`true`: yalnız arşivlenmiş şablonlar; yoksa yalnız etkinler'),
})
export const templateParams = z.object({ templateId: z.uuid('Şablon geçersiz.') })
