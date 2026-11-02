import { z } from 'zod'

import { CEFR_LEVELS, enumKeys } from '@kampus/school-core/content/taxonomy.ts'
import {
  cancelGroupSchema,
  createGroupSchema,
  GROUP_AGE_BANDS,
  GROUP_DELIVERIES,
  GROUP_MEMBER_STATUSES,
  GROUP_STATUSES,
  mergeGroupSchema,
  updateGroupSchema,
  WAITLIST_STATUSES,
} from '@kampus/school-core/lib/language-groups.ts'

import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * Dil okulu grupları (IST-077; DOM-DIL-008, -040…043). Gövdeler core şemalarıdır (katı). Yanıtta
 * personel alanları (öğretmen, kapasite, doluluk, iptal ve birleştirme bilgisi, işlem anları,
 * `rowVersion`, `updatedAt`) isteğe bağlıdır: öğrenci ve veli yalnız takvim alanlarını alır
 * (`groupView`).
 */

const instant = z.iso.datetime()
const day = z.iso.date()
const staffOnly = 'Yalnız personele döner'

export const groupParamsSchema = z.object({ groupId: z.uuid().describe('Grup kimliği') })

export const groupListQuerySchema = pageQuerySchema
  .extend({
    courseId: z.uuid().optional().describe('Kur süzgeci'),
    status: z
      .enum(GROUP_STATUSES)
      .optional()
      .describe('Durum süzgeci; verilmezse iptal edilenler dışındakiler'),
    teacherMembershipId: z.string().min(1).max(100).optional().describe('Öğretmen üyeliği süzgeci'),
  })
  .strict()

export const createGroupBodySchema = createGroupSchema
export const updateGroupBodySchema = updateGroupSchema
export const cancelGroupBodySchema = cancelGroupSchema
export const mergeGroupBodySchema = mergeGroupSchema

export const groupSlotResponseSchema = z
  .object({
    weekday: z.number().int().min(1).max(7).describe('ISO hafta günü: 1 Pazartesi … 7 Pazar'),
    startTime: z.string().describe('Başlangıç saati SS:DD (Europe/Istanbul)'),
  })
  .meta({ id: 'GroupSlot' })

export const groupMemberSchema = z
  .object({
    studentId: z.string(),
    status: z.enum(GROUP_MEMBER_STATUSES).describe('Dondurulan kursiyer kapasiteye sayılmaz'),
    joinedAt: instant,
  })
  .meta({ id: 'GroupMember' })

export const groupSchema = z
  .object({
    id: z.uuid(),
    courseId: z.uuid(),
    courseName: z.string(),
    level: z.enum(enumKeys(CEFR_LEVELS)).describe('Kurun seviyesi'),
    name: z.string(),
    ageBand: z.enum(GROUP_AGE_BANDS),
    delivery: z.enum(GROUP_DELIVERIES),
    room: z.string().nullable().describe('Derslik; çevrim içi grupta `null`'),
    schedule: z.array(groupSlotResponseSchema).describe('Haftalık kalıp, gün ve saate göre sıralı'),
    sessionMinutes: z.number().int().describe('Oturum uzunluğu (kurdan)'),
    startDate: day,
    endDate: day.describe('Son oturumun günü; kurun toplam saatinden hesaplanır'),
    status: z
      .enum(GROUP_STATUSES)
      .describe('`running` ve `completed` açık grubun tarihlerinden türetilir'),
    teacherMembershipId: z.string().nullable().optional().describe(staffOnly),
    capacity: z.number().int().min(1).max(18).optional().describe(staffOnly),
    activeLearners: z.number().int().min(0).optional().describe(staffOnly),
    frozenLearners: z.number().int().min(0).optional().describe(staffOnly),
    openOffers: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Süresi dolmamış bekleme listesi teklifi (kapasiteye sayılır). ' + staffOnly),
    freeSeats: z.number().int().min(0).optional().describe(staffOnly),
    openedAt: instant.nullable().optional().describe(staffOnly),
    cancelledAt: instant.nullable().optional().describe(staffOnly),
    cancelReason: z.string().nullable().optional().describe(staffOnly),
    mergedIntoGroupId: z.uuid().nullable().optional().describe(staffOnly),
    members: z
      .array(groupMemberSchema)
      .optional()
      .describe('Kursiyerler; yalnız tek grup okumasında ve personele döner'),
    rowVersion: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Yazmada `If-Match`. ' + staffOnly),
    updatedAt: instant.optional().describe(staffOnly),
  })
  .meta({ id: 'LanguageGroup' })

export const groupResponseSchema = dataResponse(groupSchema)
export const groupListResponseSchema = pageResponse(groupSchema)

export const waitlistItemSchema = z
  .object({
    id: z.uuid(),
    courseId: z.uuid(),
    groupId: z.uuid().nullable().describe('`null`: kurun herhangi bir grubu için bekliyor'),
    studentId: z.string().nullable(),
    prospectId: z.string().nullable(),
    requestedAt: instant,
    status: z.enum(WAITLIST_STATUSES),
    position: z.number().int().min(1).nullable().describe('Bekleyenin sıradaki yeri'),
    offerGroupId: z.uuid().nullable(),
    offeredAt: instant.nullable(),
    offerExpiresAt: instant.nullable(),
  })
  .meta({ id: 'GroupWaitlistItem' })

export const waitlistResponseSchema = dataResponse(
  z.object({
    entries: z.array(waitlistItemSchema).describe('Bekleyenler sırayla, sonra açık teklifler'),
    suggestion: z
      .object({
        expire: z.array(z.uuid()).describe('Süresi dolmuş, sonuçlandırılacak teklifler'),
        offers: z
          .array(z.object({ entryId: z.uuid(), offerExpiresAt: instant }))
          .describe('Boş yer kadar sıradakine 48 saatlik teklif önerisi (DOM-DIL-043)'),
      })
      .describe('Core `suggestWaitlistOffers`; yazma kayıt akışındadır (ON-058)'),
  }),
)
