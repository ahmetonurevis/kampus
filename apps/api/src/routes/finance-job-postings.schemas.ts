import { z } from 'zod'

import {
  JOB_APPLICATION_ANONYMIZATION_REASONS,
  JOB_APPLICATION_CHANNELS,
  JOB_APPLICATION_STAGES,
  JOB_EMPLOYMENT_TYPES,
  JOB_POSTING_STATUSES,
} from '@kampus/school-core/lib/finance-job-postings.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** İş ilanı ve başvuru havuzu şemaları (DOM-FIN-128; ON-177). */

const employmentType = z
  .enum(JOB_EMPLOYMENT_TYPES)
  .describe('`full_time` tam zamanlı, `part_time` yarı zamanlı, `extra_lessons` ek ders')
const postingStatus = z
  .enum(JOB_POSTING_STATUSES)
  .describe('`draft` taslak, `published` yayında, `closed` kapandı')
const channel = z
  .enum(JOB_APPLICATION_CHANNELS)
  .describe('`website` kurum sitesi, `email` e-posta, `in_person` elden, `referral` tavsiye')
const stage = z
  .enum(JOB_APPLICATION_STAGES)
  .describe(
    '`new` yeni, `screening` ön eleme, `interview` mülakat, `offer` teklif, `hired` işe alındı, `rejected` reddedildi',
  )
const reason = z
  .enum(JOB_APPLICATION_ANONYMIZATION_REASONS)
  .describe('`retention_expired` saklama süresi doldu, `data_subject_request` adayın silme talebi')

const postingSchema = z.object({
  id: z.string(),
  title: z.string(),
  position: z.string().describe('Pozisyon / branş'),
  employmentType,
  description: z.string(),
  requirements: z.string().nullable(),
  publishOn: z.string().describe('Yayın günü (YYYY-MM-DD)'),
  deadlineOn: z.string().describe('Son başvuru günü (YYYY-MM-DD)'),
  status: postingStatus,
  closedOn: z.string().nullable().describe('Kapanış günü; yalnız kapanan ilanda'),
  deadlinePassed: z
    .boolean()
    .describe('Yayındaki ilanın son başvuru günü geçti mi (kapatılması önerilir)'),
  applicationCount: z.number().int().describe('Bütün başvurular (anonimleştirilmişler dahil)'),
  openApplicationCount: z.number().int().describe('Süren başvurular (yeni → teklif)'),
  hiredCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` sürümü'),
})
export const jobPostingResponse = dataResponse(postingSchema)
export const jobPostingListResponse = z.object({
  data: z.array(postingSchema),
  meta: pageMetaSchema,
})

const applicationRowSchema = z.object({
  id: z.string(),
  jobPostingId: z.string(),
  postingTitle: z.string(),
  candidateName: z.string().describe('Anonimleştirilmişte "Anonim aday"'),
  channel,
  receivedOn: z.string(),
  stage,
  stageChangedOn: z.string().describe('Son aşama değişikliğinin günü'),
  hasCv: z.boolean(),
  anonymized: z.boolean(),
  retentionDueOn: z
    .string()
    .nullable()
    .describe('Saklama süresinin dolduğu gün; işe alınan ve süren başvuruda boş (K-441)'),
  version: z.number().int().describe('`If-Match` sürümü'),
})
export const jobApplicationListResponse = z.object({
  data: z.array(applicationRowSchema),
  meta: pageMetaSchema,
})

const applicationDetailSchema = applicationRowSchema.extend({
  email: z.string().nullable(),
  phone: z.string().nullable(),
  cvFileId: z.string().nullable().describe('Özgeçmiş; bağlantı `GET /files/{fileId}/url`'),
  privacyNoticeVersion: z.string().describe('Gösterilen aday aydınlatma metni sürümü'),
  privacyNoticeShownOn: z.string().describe('Aydınlatmanın gösterildiği gün'),
  note: z.string().nullable(),
  postingStatus,
  anonymizedAt: z.string().nullable(),
  anonymizationReason: reason.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  history: z
    .array(
      z.object({
        fromStage: stage.nullable(),
        toStage: stage,
        changedOn: z.string(),
        changedByUserId: z.string(),
      }),
    )
    .describe('Aşama geçmişi, eskiden yeniye; ilk satır kayıt'),
})
export const jobApplicationResponse = dataResponse(applicationDetailSchema)

export const jobApplicationRetentionResponse = z.object({
  data: z.array(applicationRowSchema),
  meta: pageMetaSchema.extend({
    retentionMonths: z.number().int().describe('Kurumun saklama süresi (ay)'),
  }),
})

export const jobApplicationAnonymizationResponse = dataResponse(
  z.object({
    anonymizedCount: z.number().int(),
    cvFileCount: z.number().int().describe('İmhaya işaretlenen özgeçmiş dosyası'),
    reason,
  }),
)

export const jobApplicationSettingsResponse = dataResponse(
  z.object({
    retentionMonths: z.number().int(),
    privacyNoticeVersion: z.string().nullable(),
    version: z.number().int().describe('`If-Match` sürümü; hiç kaydedilmediyse 1'),
  }),
)

const q = z.string().trim().min(2).max(100).optional()

export const jobPostingListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: q.describe('İlan başlığı ve pozisyonda arama'),
  status: postingStatus.optional(),
  employmentType: employmentType.optional(),
})

export const jobApplicationListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: q.describe('Aday adı ve ilan başlığında arama'),
  jobPostingId: z.uuid('İlan geçersiz.').optional(),
  stage: stage.optional(),
  channel: channel.optional(),
  open: z
    .enum(['true', 'false'])
    .optional()
    .describe('`true` yalnız süren (yeni → teklif, anonimleştirilmemiş) başvurular'),
})

export const jobApplicationRetentionQuery = z.strictObject({ ...pageQuerySchema.shape })

export const jobPostingParams = z.object({ postingId: z.uuid('İlan geçersiz.') })
export const jobApplicationParams = z.object({ applicationId: z.uuid('Başvuru geçersiz.') })
