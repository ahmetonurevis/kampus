import { z } from 'zod'

import { WAGE_TYPES } from '@kampus/school-core/lib/finance-pay-rates.ts'
import { STAFF_DOCUMENT_TYPES } from '@kampus/school-core/lib/finance-staff-documents.ts'
import {
  EVIDENCE_STATES,
  JOB_OFFER_STATUSES,
  ONBOARDING_STATES,
  ONBOARDING_STEP_KINDS,
} from '@kampus/school-core/lib/finance-staff-onboarding.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** İş teklifi ve işe başlama listesi şemaları (DOM-FIN-121; ON-179). Yalnız yöneticiye döner. */

const statusSchema = z
  .enum(JOB_OFFER_STATUSES)
  .describe(
    '`draft` taslak, `sent` gönderildi, `accepted` kabul edildi, `rejected` reddedildi, `withdrawn` geri çekildi',
  )

const onboardingSchema = z
  .object({
    state: z
      .enum(ONBOARDING_STATES)
      .describe(
        '`none` liste yok (kabul edilmedi), `open` sürüyor, `completed` zorunlu adımlar bitti, `closed` kabulden sonra geri çekildi',
      ),
    total: z.number().int(),
    done: z.number().int(),
    requiredTotal: z.number().int(),
    requiredDone: z.number().int(),
    completedAt: z
      .string()
      .nullable()
      .describe('Liste tamamlandıysa son zorunlu adımın işaret anı (hesaplanır)'),
  })
  .describe('İşe başlama listesinin ilerlemesi (K-414; saklanmaz)')

const offerRowSchema = z.object({
  id: z.string(),
  name: z.string().describe('Adayın adı ya da bağlı personelin adı'),
  isStaff: z.boolean().describe('Personel üyeliğine bağlı mı (iç aday ya da hesap bağlandı)'),
  position: z.string(),
  staffRole: z.enum(STAFF_ROLES),
  startDate: z.string().describe('İşe başlama günü (YYYY-MM-DD)'),
  status: statusSchema,
  sentOn: z.string().nullable(),
  acceptedOn: z.string().nullable(),
  closedOn: z.string().nullable().describe('Ret ya da geri çekme günü'),
  onboarding: onboardingSchema,
  version: z.number().int().describe('`If-Match` için teklif sürümü (adım değişiklikleri dahil)'),
})

const memberRef = z.object({ membershipId: z.string(), name: z.string() })

const stepSchema = z.object({
  id: z.string(),
  kind: z
    .enum(ONBOARDING_STEP_KINDS)
    .describe(
      '`account` hesap, `document` özlük belgesi, `work_permit` çalışma onayı, `pay_rate` ücret tanımı, `seniority` kıdem başlangıcı, `asset_handover` zimmet, `orientation` oryantasyon',
    ),
  documentType: z.enum(STAFF_DOCUMENT_TYPES).nullable(),
  label: z.string(),
  required: z.boolean(),
  responsible: memberRef.nullable(),
  dueDate: z.string().nullable(),
  completedOn: z.string().nullable(),
  completedAt: z.string().nullable(),
  note: z.string().nullable(),
  evidence: z
    .object({
      state: z
        .enum(EVIDENCE_STATES)
        .describe('`met` kaynak var, `missing` kaynak yok (işaretlenemez), `manual` elle'),
      detail: z.string(),
      warning: z.string().nullable().describe('Kaynak tekliften farklı (engel değil)'),
    })
    .describe('Kaynak durumu, her okumada hesaplanır (K-413)'),
})

const offerDetailSchema = offerRowSchema.extend({
  membershipId: z.string().nullable(),
  candidateName: z.string().nullable(),
  candidateEmail: z.string().nullable(),
  candidatePhone: z.string().nullable(),
  wageType: z.enum(WAGE_TYPES),
  offeredAmountCents: z.number().int().describe('Ücret önerisi, kuruş'),
  currency: z.literal('TRY'),
  respondBy: z.string().nullable(),
  note: z.string().nullable(),
  closeReason: z.string().nullable(),
  createdAt: z.string(),
  member: memberRef
    .extend({ role: z.string(), active: z.boolean() })
    .nullable()
    .describe('Bağlı personel hesabı'),
  steps: z.array(stepSchema).describe('İşe başlama listesi; kabulden önce boş'),
})

export const offerResponse = dataResponse(offerDetailSchema)
export const offerListResponse = z.object({ data: z.array(offerRowSchema), meta: pageMetaSchema })

export const offerListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Aday/personel adında ve pozisyonda'),
  status: statusSchema.optional(),
})

export const offerParams = z.object({ offerId: z.uuid('Teklif geçersiz.') })
export const stepParams = offerParams.extend({ stepId: z.uuid('Adım geçersiz.') })

export const letterResponse = dataResponse(
  z.object({
    id: z.string(),
    status: statusSchema,
    institutionName: z.string(),
    candidateName: z.string(),
    position: z.string(),
    staffRole: z.enum(STAFF_ROLES),
    startDate: z.string(),
    wageType: z.enum(WAGE_TYPES),
    offeredAmountCents: z.number().int(),
    currency: z.literal('TRY'),
    respondBy: z.string().nullable(),
    note: z.string().nullable(),
    sentOn: z.string().nullable(),
    createdAt: z.string(),
    issuedByName: z.string().describe('Mektubu üreten kullanıcı'),
    generatedAt: z.string(),
  }),
)

export const settingsResponse = dataResponse(
  z.object({
    orientationSteps: z.array(z.object({ label: z.string(), required: z.boolean() })),
    isDefault: z.boolean().describe('Kurum ayarı yazılmadı; varsayılan adımlar'),
    updatedAt: z.string().nullable(),
    version: z
      .number()
      .int()
      .nullable()
      .describe('`If-Match` için sürüm; varsayılanda boş (ilk yazma `If-Match` almaz)'),
  }),
)

export const staffOptionsResponse = dataResponse(
  z.array(z.object({ membershipId: z.string(), name: z.string(), role: z.enum(STAFF_ROLES) })),
)
