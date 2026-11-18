import { z } from 'zod'

import { PAID_ACTIVITY_KINDS } from '@kampus/school-core/lib/finance-paid-activities.ts'
import {
  TRIP_PLAN_EVENTS,
  TRIP_PLAN_STATES,
  TRIP_PLAN_STATUSES,
  TRIP_STAFF_ROLES,
  TRIP_TRANSPORT_TYPES,
} from '@kampus/school-core/lib/finance-trip-plans.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Gezi planı şemaları (DOM-FIN-111; ON-155). Liste satırı kişisel veri (sürücü, acil iletişim)
 * taşımaz; ayrıntı planın bütün alanlarını, görevlileri, ulaşım belgesini, oranı ve geçmişi verir.
 */

const actionsSchema = z
  .object({
    edit: z.boolean(),
    submit: z.boolean(),
    approve: z.boolean(),
    reject: z.boolean(),
    complete: z.boolean(),
    cancel: z.boolean(),
    notify: z.boolean(),
  })
  .describe('Oturumdaki rolün bu planda yapabileceği işlemler (ekran düğmeleri)')

const rowSchema = z.object({
  id: z.string(),
  number: z.string().describe('Plan numarası (`GZ-0007`)'),
  name: z.string(),
  departureAt: z.string(),
  returnAt: z.string(),
  expectedStudentCount: z.number().int(),
  staffCount: z.number().int().describe('Görevli sayısı'),
  leadNames: z.array(z.string()).describe('Sorumlu öğretmenlerin adları'),
  ratioWarning: z
    .boolean()
    .describe('Görevli sayısı her 15 öğrenciye bir görevli önerisinin altında (K-366)'),
  paidActivity: z
    .object({ id: z.string(), name: z.string() })
    .nullable()
    .describe('Bağlı ücretli etkinlik (DOM-FIN-098)'),
  status: z.enum(TRIP_PLAN_STATUSES),
  authorityNotifiedOn: z
    .string()
    .nullable()
    .describe('Millî eğitim bildiriminin işaretlendiği gün (YYYY-MM-DD)'),
  actions: actionsSchema,
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

const stopSchema = z.object({ place: z.string(), note: z.string().nullable() })
const riskSchema = z.object({ risk: z.string(), measure: z.string() })
const contactSchema = z.object({
  name: z.string(),
  phone: z.string(),
  relation: z.string().nullable(),
})

const eventSchema = z.object({
  id: z.string(),
  event: z.enum(TRIP_PLAN_EVENTS),
  fromStatus: z.enum(TRIP_PLAN_STATUSES).nullable(),
  toStatus: z.enum(TRIP_PLAN_STATUSES),
  note: z.string().nullable().describe('Adımın notu; retta ve iptalde gerekçe'),
  actorName: z.string().nullable(),
  occurredAt: z.string(),
})

const detailSchema = rowSchema.extend({
  purpose: z.string(),
  stops: z.array(stopSchema).describe('Güzergâh, sırayla'),
  staff: z
    .array(
      z.object({
        membershipId: z.string(),
        name: z.string().nullable(),
        role: z.enum(TRIP_STAFF_ROLES),
      }),
    )
    .describe('Görevliler; sorumlu önce'),
  transport: z.object({
    type: z.enum(TRIP_TRANSPORT_TYPES),
    company: z.string().nullable(),
    plate: z.string().nullable().describe('Boşluksuz büyük harfle (`34ABC123`)'),
    driverName: z.string().nullable(),
    driverPhone: z.string().nullable(),
    documentFileId: z.string().nullable(),
    documentFile: z
      .object({ id: z.string(), name: z.string(), byteSize: z.number().int() })
      .nullable()
      .describe('Ulaşım belgesi; silinmiş dosyada boş'),
  }),
  risks: z.array(riskSchema).describe('Risk değerlendirmesi'),
  emergencyContacts: z.array(contactSchema).describe('Acil iletişim kişileri'),
  paidActivity: z
    .object({
      id: z.string(),
      name: z.string(),
      kind: z.enum(PAID_ACTIVITY_KINDS),
      activityDate: z.string(),
      status: z.enum(['open', 'cancelled']),
    })
    .nullable()
    .describe('Bağlı ücretli etkinlik (DOM-FIN-098)'),
  ratio: z
    .object({
      studentsPerStaff: z.number().int(),
      recommendedStaff: z.number().int(),
      warning: z.boolean(),
    })
    .describe('Öğrenci başına görevli oranı (K-366); uyarıdır, kaydı engellemez'),
  submittedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  approvedByName: z.string().nullable(),
  rejectedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  authorityReference: z.string().nullable().describe('Bildirimin evrak sayısı'),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  events: z.array(eventSchema).describe('Plan geçmişi, eskiden yeniye (K-367)'),
})

export const tripPlanResponse = dataResponse(detailSchema)
export const tripPlanListResponse = z.object({ data: z.array(rowSchema), meta: pageMetaSchema })

export const tripPlanOptionsResponse = dataResponse(
  z.object({
    staff: z
      .array(z.object({ membershipId: z.string(), name: z.string(), role: z.string() }))
      .describe('Kurumun etkin öğretmen ve yöneticileri, ada göre'),
    activities: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          kind: z.enum(PAID_ACTIVITY_KINDS),
          activityDate: z.string(),
          linkedPlanId: z.string().nullable().describe('Etkinliğe bağlı iptal edilmemiş plan'),
        }),
      )
      .describe('İptal edilmemiş, günü bugün ya da sonra olan ücretli etkinlikler'),
  }),
)

export const tripPlanParams = z.object({ planId: z.uuid('Plan geçersiz.') })

export const tripPlanListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Ad ya da plan numarasında arama'),
  status: z.enum(TRIP_PLAN_STATUSES).optional().describe('Durum'),
  state: z
    .enum(TRIP_PLAN_STATES)
    .optional()
    .describe('`active` sürenler, `done` tamamlanan ya da iptal edilenler'),
})
