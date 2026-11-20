import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  VISITOR_ANONYMIZATION_REASONS,
  VISITOR_BADGE_RELEASES,
  VISITOR_ID_DOCUMENT_TYPES,
  VISITOR_PURPOSES,
} from '@kampus/school-core/lib/finance-visitors.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Ziyaretçi kaydı şemaları (DOM-FIN-141; ON-166). */

const purpose = z
  .enum(VISITOR_PURPOSES)
  .describe(
    '`parent_meeting` veli görüşmesi, `supplier` tedarikçi, `official` resmî, `job_applicant` iş başvurusu, `other` diğer',
  )
const documentType = z
  .enum(VISITOR_ID_DOCUMENT_TYPES)
  .describe(
    '`national_id` kimlik kartı, `driver_license` sürücü belgesi, `passport` pasaport, `other` diğer',
  )
const reason = z
  .enum(VISITOR_ANONYMIZATION_REASONS)
  .describe(
    '`retention_expired` saklama süresi doldu, `data_subject_request` ziyaretçinin silme talebi',
  )
const badgeStatus = z
  .enum(['none', 'out', ...VISITOR_BADGE_RELEASES])
  .describe('`none` kart verilmedi, `out` kart ziyaretçide, `returned` iade edildi, `lost` kayıp')

const visitorRowSchema = z.object({
  id: z.string(),
  visitorName: z.string().describe('Anonimleştirilmişte "Anonim ziyaretçi"'),
  identityVerified: z.boolean().describe('Kimlik belgesi görüldü mü (numara saklanmaz)'),
  identityDocumentType: documentType.nullable(),
  maskedPhone: z.string().nullable().describe('Maskeli telefon (`0532 *** ** 67`)'),
  purpose,
  hostMembershipId: z.string().nullable(),
  hostName: z.string().nullable().describe('Ziyaret edilen personelin adı'),
  studentId: z.string().nullable(),
  studentName: z.string().nullable(),
  visitOn: z.string().describe('Ziyaret günü (Europe/Istanbul, YYYY-MM-DD)'),
  checkedInAt: z.string(),
  checkedOutAt: z.string().nullable(),
  inside: z.boolean().describe('Çıkışı yapılmadı'),
  overdue: z.boolean().describe('Önceki günden içeride kaldı (gün sonu uyarısı)'),
  badgeNumber: z.string().nullable(),
  badgeStatus,
  anonymized: z.boolean(),
  retentionDueOn: z.string().describe('Saklama süresinin dolduğu gün (ziyaret günü + süre)'),
  version: z.number().int().describe('`If-Match` sürümü'),
})
export const visitorListResponse = z.object({
  data: z.array(visitorRowSchema),
  meta: pageMetaSchema,
})

const visitorDetailSchema = visitorRowSchema.extend({
  phone: z.string().nullable().describe('Tam telefon; okuma denetime düşer'),
  purposeNote: z.string().nullable(),
  privacyNoticeVersion: z.string().describe('Gösterilen aydınlatma metni sürümü'),
  badgeReleasedAt: z.string().nullable(),
  anonymizedAt: z.string().nullable(),
  anonymizationReason: reason.nullable(),
  checkedInByUserId: z.string(),
  checkedOutByUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export const visitorResponse = dataResponse(visitorDetailSchema)

export const visitorSummaryResponse = dataResponse(
  z.object({
    date: z.string().describe('Bugün (Europe/Istanbul)'),
    visitsToday: z.number().int(),
    inside: z.number().int().describe('Şu an içeride'),
    insideFromEarlier: z
      .number()
      .int()
      .describe('Önceki günlerden içeride kalan (çıkışı unutulmuş)'),
    badgesOut: z.number().int().describe('Ziyaretçide kalan kart'),
    privacyNoticeVersion: z.string().nullable().describe('Geçerli aydınlatma sürümü (öneri)'),
    badges: z
      .array(
        z.object({
          number: z.string(),
          visitorId: z.string().nullable().describe('Kart ziyaretçideyse kaydın kimliği'),
        }),
      )
      .describe('Kurumun kart havuzu, havuz sırasıyla'),
  }),
)

export const visitorHostListResponse = z.object({
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

export const visitorRetentionResponse = z.object({
  data: z.array(visitorRowSchema),
  meta: pageMetaSchema.extend({
    retentionDays: z.number().int().describe('Kurumun saklama süresi (gün)'),
  }),
})

export const visitorAnonymizationResponse = dataResponse(
  z.object({ anonymizedCount: z.number().int(), reason }),
)

export const visitorSettingsResponse = dataResponse(
  z.object({
    retentionDays: z.number().int(),
    privacyNoticeVersion: z.string().nullable(),
    badgeNumbers: z.array(z.string()),
    version: z.number().int().describe('`If-Match` sürümü; hiç kaydedilmediyse 1'),
  }),
)

const q = z.string().trim().min(2).max(100).optional()

export const visitorListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: q.describe('Ziyaretçi adında ve kart numarasında arama'),
  date: daySchema.optional().describe('Ziyaret günü (YYYY-MM-DD)'),
  status: z
    .enum(['inside', 'left'])
    .optional()
    .describe('`inside` içeridekiler (gün sonu listesi), `left` çıkanlar'),
  purpose: purpose.optional(),
  badge: z.enum(['outstanding']).optional().describe('`outstanding` kartı ziyaretçide kalanlar'),
})

export const visitorHostQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: q.describe('Personel adında arama'),
})

export const visitorRetentionQuery = z.strictObject({ ...pageQuerySchema.shape })

export const visitorParams = z.object({ visitorId: z.uuid('Ziyaret kaydı geçersiz.') })
