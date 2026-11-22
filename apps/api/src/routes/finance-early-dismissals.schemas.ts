import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  EARLY_DISMISSAL_PICKUP_KINDS,
  EARLY_DISMISSAL_REASONS,
  EARLY_DISMISSAL_SOURCES,
  EARLY_DISMISSAL_STATUSES,
  PICKUP_RELATIONSHIPS,
} from '@kampus/school-core/lib/finance-early-dismissals.ts'
import {
  CUSTODY_KIND_KEYS,
  GUARDIAN_RELATIONSHIP_KEYS,
} from '@kampus/school-core/lib/guardianship.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Erken çıkış şemaları (DOM-FIN-161; ON-168). */

const status = z
  .enum(EARLY_DISMISSAL_STATUSES)
  .describe(
    '`pending` onay bekliyor, `approved` onaylandı, `rejected` reddedildi, `cancelled` iptal edildi, `released` teslim edildi',
  )
const reason = z
  .enum(EARLY_DISMISSAL_REASONS)
  .describe('`health` sağlık, `appointment` randevu, `family` aile işi, `other` diğer')
const pickupKind = z
  .enum(EARLY_DISMISSAL_PICKUP_KINDS)
  .describe('`guardian` kayıtlı teslim yetkilisi, `other` kayıtlı olmayan, okulca onaylanan kişi')

const rowSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  studentName: z.string().nullable(),
  classId: z.string().nullable().describe('Talep açıldığındaki sınıf'),
  className: z.string().nullable(),
  dismissalOn: z.string().describe('Çıkış günü (Europe/Istanbul, YYYY-MM-DD)'),
  plannedAt: z.string().describe('Planlanan çıkış anı (ISO 8601)'),
  reason,
  pickupKind,
  pickupGuardianLinkId: z.string().nullable(),
  pickupName: z.string().nullable().describe('Teslim alacak kişinin adı; bağ kaldırıldıysa `null`'),
  pickupRelationship: z.enum(PICKUP_RELATIONSHIPS).nullable().describe('Yalnız `other` türünde'),
  status,
  source: z
    .enum(EARLY_DISMISSAL_SOURCES)
    .describe('`guardian` veli talebi, `school` okulun açtığı (acil) kayıt'),
  decidedAt: z.string().nullable(),
  releasedAt: z.string().nullable().describe('Gerçek çıkış anı'),
  releasedToName: z.string().nullable().describe('Teslim alanın teslim anındaki adı'),
  version: z.number().int().describe('`If-Match` sürümü'),
})
export const earlyDismissalListResponse = z.object({
  data: z.array(rowSchema),
  meta: pageMetaSchema,
})

const pickupOptionSchema = z.object({
  guardianLinkId: z.string(),
  name: z.string(),
  relationship: z.enum(GUARDIAN_RELATIONSHIP_KEYS),
  custody: z.enum(CUSTODY_KIND_KEYS),
  canPickUp: z.boolean().describe('Teslim alma yetkisi işaretli (velayetsiz yetkili)'),
  isSelf: z.boolean().describe('İsteyen velinin kendi bağı'),
})
export const pickupOptionsResponse = dataResponse(z.array(pickupOptionSchema))

const lessonEffectSchema = z.object({
  lessonId: z.string(),
  period: z.number().int().describe('Günün kaçıncı dersi (1’den)'),
  startsAt: z.string(),
  endsAt: z.string(),
  subjectId: z.string(),
  title: z.string().nullable(),
  partial: z.boolean().describe('Ders sürerken çıktı'),
})
const effectSchema = z.object({
  basis: z
    .enum(['released', 'planned'])
    .describe('`released` gerçek çıkış anı, `planned` onaylı talebin planlanan saati'),
  departureAt: z.string(),
  fromPeriod: z
    .number()
    .int()
    .nullable()
    .describe('İlk etkilenen dersin sırası ("4. dersten itibaren"); yoksa `null`'),
  lessons: z.array(lessonEffectSchema),
})

const detailSchema = rowSchema.extend({
  reasonNote: z.string().nullable(),
  pickupIdLast4: z.string().nullable().describe('Kayıtlı olmayan kişinin kimlik son dört hanesi'),
  maskedIdLast4: z.string().nullable().describe('`•••• 1234`'),
  rejectionReason: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  releasedToKind: pickupKind.nullable(),
  authorizedPickups: z
    .array(pickupOptionSchema)
    .describe('Öğrencinin şu anki teslim yetkilileri (teslim formundaki liste)'),
  effect: effectSchema.nullable().describe('Etkilenen dersler; onaylı ya da teslim edilmişte dolu'),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export const earlyDismissalResponse = dataResponse(detailSchema)

const guardianSchema = rowSchema.extend({
  reasonNote: z.string().nullable(),
  maskedIdLast4: z.string().nullable(),
  rejectionReason: z.string().nullable().describe('Ret gerekçesi'),
  cancelledAt: z.string().nullable(),
})
export const guardianEarlyDismissalResponse = dataResponse(guardianSchema)
export const guardianEarlyDismissalListResponse = z.object({
  data: z.array(guardianSchema),
  meta: pageMetaSchema,
})

const counts = z.object(
  Object.fromEntries(EARLY_DISMISSAL_STATUSES.map((key) => [key, z.number().int()])) as Record<
    (typeof EARLY_DISMISSAL_STATUSES)[number],
    z.ZodNumber
  >,
)
export const earlyDismissalSummaryResponse = dataResponse(
  z.object({ date: z.string(), counts: counts.describe('Günün durum sayıları') }),
)

export const attendanceEffectsResponse = dataResponse(
  z.object({
    date: z.string(),
    items: z.array(
      effectSchema.extend({
        dismissalId: z.string(),
        studentId: z.string(),
        studentName: z.string().nullable(),
        classId: z.string().nullable(),
        status: z.enum(['approved', 'released']),
      }),
    ),
  }),
)

const id = z.string().trim().min(1).max(200)

export const earlyDismissalListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  date: daySchema.optional().describe('Çıkış günü (YYYY-MM-DD)'),
  status: status.optional(),
  classId: id.optional().describe('Sınıf'),
})
export const earlyDismissalSummaryQuery = z.strictObject({
  date: daySchema.optional().describe('Gün (varsayılan bugün)'),
})
export const guardianEarlyDismissalQuery = z.strictObject({
  ...pageQuerySchema.shape,
  studentId: id.optional().describe('Çocuk (velayetli olduğu)'),
})
export const pickupOptionsQuery = z.strictObject({
  studentId: id.describe('Öğrenci'),
})
export const attendanceEffectsQuery = z.strictObject({
  date: daySchema.optional().describe('Gün (varsayılan bugün)'),
  classId: id.optional().describe('Sınıf'),
})

export const earlyDismissalParams = z.object({
  dismissalId: z.uuid('Erken çıkış kaydı geçersiz.'),
})
