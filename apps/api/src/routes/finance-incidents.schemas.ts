import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  INCIDENT_KINDS,
  INCIDENT_NOTIFICATION_CHANNELS,
  INCIDENT_REFERRALS,
  INCIDENT_STATUSES,
  INJURED_KINDS,
  INJURY_BODY_PARTS,
  INJURY_SEVERITIES,
} from '@kampus/school-core/lib/finance-incidents.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Kaza ve yaralanma tutanağı şemaları (DOM-FIN-146; ON-162). */

const status = z.enum(INCIDENT_STATUSES).describe('`draft` taslak, `finalized` kesinleşti')
const injuredKind = z.enum(INJURED_KINDS).describe('`student` öğrenci, `staff` personel')
const kind = z
  .enum(INCIDENT_KINDS)
  .describe('`fall` düşme, `collision` çarpma, `sports` spor, `play` oyun, `other` diğer')
const channel = z
  .enum(INCIDENT_NOTIFICATION_CHANNELS)
  .describe('`phone` telefon, `in_person` yüz yüze, `message` mesaj')
const severity = z.enum(INJURY_SEVERITIES).describe('`minor` hafif, `moderate` orta, `severe` ağır')
const referral = z
  .enum(INCIDENT_REFERRALS)
  .describe('`none` yok, `infirmary` revir, `hospital` hastane, `emergency_112` 112')

const incidentRowSchema = z.object({
  id: z.string(),
  status,
  injuredKind,
  studentId: z.string().nullable(),
  injuredMembershipId: z.string().nullable(),
  injuredName: z.string().nullable().describe('Yaralananın adı'),
  occurredAt: z.string().describe('Olay anı (ISO 8601)'),
  location: z.string(),
  kind,
  responsibleMembershipId: z.string(),
  responsibleName: z.string().nullable(),
  notificationCount: z.number().int().describe('Veli bildirimi kaydı sayısı'),
  lastNotifiedAt: z.string().nullable(),
  createdByUserId: z.string().describe('Tutanağı açan kullanıcı'),
  mine: z.boolean().describe('Tutanağı okuyan açtı mı'),
  finalizedAt: z.string().nullable(),
  version: z.number().int().describe('`If-Match` sürümü'),
})
export const incidentListResponse = z.object({
  data: z.array(incidentRowSchema),
  meta: pageMetaSchema,
})

const notificationSchema = z.object({
  id: z.string(),
  notifiedAt: z.string(),
  channel,
  notifiedByMembershipId: z.string(),
  notifiedByName: z.string().nullable(),
  createdAt: z.string(),
})

const incidentDetailSchema = incidentRowSchema.extend({
  description: z.string().describe('Olayın anlatımı (şifreli saklanır)'),
  witnesses: z.array(z.object({ membershipId: z.string(), name: z.string().nullable() })),
  notifications: z.array(notificationSchema),
  health: z
    .object({
      bodyParts: z.array(z.enum(INJURY_BODY_PARTS)),
      severity,
      injuryNote: z.string().nullable(),
      firstAid: z
        .object({
          byMembershipId: z.string().nullable(),
          byName: z.string().nullable(),
          action: z.string(),
        })
        .nullable(),
      referral,
    })
    .optional()
    .describe(
      'Sağlık grubu (özel nitelikli): yöneticiye her zaman, açana yalnız taslakta; yoksa anahtar yok (K-494)',
    ),
  addenda: z
    .array(
      z.object({
        id: z.string(),
        note: z.string(),
        createdByUserId: z.string(),
        createdByName: z.string().nullable(),
        createdAt: z.string(),
      }),
    )
    .optional()
    .describe('Kesinleşmiş tutanağın ek notları; yalnız yöneticide (K-494)'),
  access: z
    .object({
      health: z.boolean(),
      edit: z.boolean().describe('Taslağı düzeltir ve kesinleştirir'),
      notify: z.boolean().describe('Veli bildirimi kaydeder'),
      manage: z.boolean().describe('Ek not yazar ve tutanak PDF’ini basar'),
    })
    .describe('Okuyanın bu tutanaktaki izinleri'),
  finalizedByUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export const incidentResponse = dataResponse(incidentDetailSchema)

export const guardianIncidentListResponse = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      studentId: z.string(),
      studentName: z.string().nullable(),
      occurredAt: z.string(),
      location: z.string(),
      kind,
      bodyParts: z.array(z.enum(INJURY_BODY_PARTS)),
      severity,
      firstAidAction: z.string().nullable(),
      referral,
      finalizedAt: z.string(),
      notifications: z.array(z.object({ notifiedAt: z.string(), channel })),
    }),
  ),
  meta: pageMetaSchema,
})

export const incidentStaffListResponse = z.object({
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

export const incidentListQuery = z
  .strictObject({
    ...pageQuerySchema.shape,
    status: status.optional(),
    injuredKind: injuredKind.optional(),
    studentId: z.string().trim().min(1).max(100).optional().describe('Yaralanan öğrenci'),
    from: daySchema.optional().describe('Olay günü başlangıcı (YYYY-MM-DD, Europe/Istanbul)'),
    to: daySchema.optional().describe('Olay günü sonu (dahil)'),
  })
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, {
    message: 'Başlangıç günü bitişten sonra olamaz.',
    path: ['from'],
  })

export const guardianIncidentQuery = z.strictObject({
  ...pageQuerySchema.shape,
  studentId: z.string().trim().min(1).max(100).optional().describe('Çocuklardan biri'),
})

export const incidentStaffQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Personel adında arama'),
})

export const incidentParams = z.object({ incidentId: z.uuid('Tutanak geçersiz.') })
