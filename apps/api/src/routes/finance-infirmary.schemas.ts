import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  CONSENT_STATUSES,
  VISIT_ACTIONS,
  VISIT_OUTCOMES,
  VISIT_PRESENCE_STATES,
  VISIT_STATUSES,
} from '@kampus/school-core/lib/finance-infirmary.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Revir ve ilaç onayı şemaları (DOM-FIN-151; ON-101). */

const visitStatus = z.enum(VISIT_STATUSES).describe('`open` revirde, `closed` ayrıldı')
const outcome = z
  .enum(VISIT_OUTCOMES)
  .describe('`returned_to_class` sınıfa döndü, `went_home` eve gitti, `referred` sevk')
const actions = z
  .array(z.enum(VISIT_ACTIONS))
  .describe(
    '`rest` dinlenme, `first_aid` ilk yardım, `medication` ilaç verildi, `guardian_called` veli çağrıldı, `sent_home` eve gönderildi, `emergency_112` 112',
  )
const consentStatus = z
  .enum(CONSENT_STATUSES)
  .describe(
    '`pending` onay bekliyor, `approved` onaylandı, `rejected` reddedildi, `withdrawn` geri çekildi',
  )

const visitRowSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  studentName: z.string().nullable(),
  status: visitStatus,
  arrivedAt: z.string().describe('Geliş anı (ISO 8601)'),
  returnedAt: z.string().nullable().describe('Ayrılış anı; açık ziyarette boş'),
  outcome: outcome.nullable(),
  referredByMembershipId: z.string().nullable(),
  referredByName: z.string().nullable(),
  incidentReportId: z.string().nullable().describe('Bağlı kaza tutanağı (DOM-FIN-146)'),
  createdByUserId: z.string(),
  version: z.number().int().describe('`If-Match` sürümü'),
})
export const visitListResponse = z.object({ data: z.array(visitRowSchema), meta: pageMetaSchema })

export const visitResponse = dataResponse(
  visitRowSchema.extend({
    complaint: z.string().describe('Şikâyet (özel nitelikli; şifreli saklanır)'),
    actions: actions.describe('Yapılanlar (özel nitelikli)'),
    note: z.string().nullable().describe('Revir notu (özel nitelikli; veliye gitmez)'),
    closedByUserId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
)

export const visitStateListResponse = z.object({
  data: z.array(
    z.object({
      visitId: z.string(),
      studentId: z.string(),
      studentName: z.string().nullable(),
      state: z.enum(VISIT_PRESENCE_STATES).describe('`in_infirmary` revirde, `returned` döndü'),
      arrivedAt: z.string(),
      returnedAt: z.string().nullable(),
    }),
  ),
})

export const guardianVisitListResponse = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      studentId: z.string(),
      studentName: z.string().nullable(),
      status: visitStatus,
      arrivedAt: z.string(),
      returnedAt: z.string().nullable(),
      outcome: outcome.nullable(),
      complaint: z.string(),
      actions,
    }),
  ),
  meta: pageMetaSchema,
})

const consentSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  studentName: z.string().nullable(),
  status: consentStatus,
  medicationName: z.string().describe('İlaç adı (özel nitelikli; şifreli saklanır)'),
  dose: z.string().describe('Bir seferlik doz (özel nitelikli)'),
  times: z.array(z.string()).describe('Doz saatleri (SS:DD, Europe/Istanbul)'),
  startDate: z.string(),
  endDate: z.string(),
  note: z.string().nullable().describe('Veli notu (özel nitelikli)'),
  requestedByName: z.string().nullable().describe('Talebi açan veli'),
  decidedAt: z.string().nullable(),
  decidedByName: z.string().nullable(),
  rejectionReason: z.string().nullable().describe('Ret gerekçesi; yalnız reddedilen talepte'),
  withdrawnAt: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int().describe('`If-Match` sürümü'),
})
export const consentListResponse = z.object({ data: z.array(consentSchema), meta: pageMetaSchema })

const administrationSchema = z.object({
  id: z.string(),
  doseDay: z.string().describe('Uygulama günü (Europe/Istanbul)'),
  scheduledTime: z.string(),
  administeredAt: z.string(),
  administeredByMembershipId: z.string(),
  administeredByName: z.string().nullable(),
  dose: z.string().describe('Verilen doz (özel nitelikli)'),
  note: z.string().nullable(),
  createdAt: z.string(),
})
export const consentResponse = dataResponse(
  consentSchema.extend({
    administrations: z.array(administrationSchema).describe('İlaç uygulamaları (en eski önce)'),
  }),
)

export const scheduleResponse = z.object({
  data: z.array(
    z.object({
      consentId: z.string(),
      consentVersion: z.number().int(),
      studentId: z.string(),
      studentName: z.string().nullable(),
      medicationName: z.string(),
      dose: z.string(),
      scheduledTime: z.string(),
      administration: z
        .object({
          id: z.string(),
          administeredAt: z.string(),
          administeredByName: z.string().nullable(),
        })
        .nullable()
        .describe('O günkü uygulama; verilmediyse boş'),
    }),
  ),
})

export const infirmaryStaffListResponse = z.object({
  data: z.array(
    z.object({
      membershipId: z.string(),
      name: z.string(),
      role: z.string().describe('`yonetici`, `ogretmen` ya da `onburo`'),
      active: z.boolean(),
    }),
  ),
  meta: pageMetaSchema,
})

const studentFilter = z.string().trim().min(1).max(100).optional()

export const visitListQuery = z
  .strictObject({
    ...pageQuerySchema.shape,
    status: visitStatus.optional(),
    studentId: studentFilter.describe('Öğrenci'),
    from: daySchema.optional().describe('Geliş günü başlangıcı (YYYY-MM-DD, Europe/Istanbul)'),
    to: daySchema.optional().describe('Geliş günü sonu (dahil)'),
  })
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, {
    message: 'Başlangıç günü bitişten sonra olamaz.',
    path: ['from'],
  })

export const dayQuery = z.strictObject({
  date: daySchema.optional().describe('Gün (YYYY-MM-DD, Europe/Istanbul); boşsa bugün'),
})

export const guardianVisitQuery = z.strictObject({
  ...pageQuerySchema.shape,
  studentId: studentFilter.describe('Çocuklardan biri'),
})

export const consentListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  status: consentStatus.optional(),
  studentId: studentFilter.describe('Öğrenci (velide çocuklardan biri)'),
})

export const infirmaryStaffQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Personel adında arama'),
})

export const visitParams = z.object({ visitId: z.uuid('Ziyaret geçersiz.') })
export const consentParams = z.object({ consentId: z.uuid('İlaç talebi geçersiz.') })
