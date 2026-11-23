import { z } from 'zod'

import {
  CERTIFICATE_STATUSES,
  certificateCancelInputSchema,
  certificateContentSchema,
  certificateIssueInputSchema,
  mebbisRecordInputSchema,
} from '@kampus/school-core/cefr/certificates.ts'
import { enumKeys } from '@kampus/school-core/content/taxonomy.ts'

import { errorResponseSchema } from '../errors.ts'
import { dataResponse, pageResponse } from './common.schemas.ts'

/**
 * Kurum başarı belgesi ve MEBBİS belge izi (OG-088; IST-081; DOM-DIL-080, 081, 082). Gövdeler core
 * şemalarıdır (katı); iptalde sürüm `If-Match` başlığındadır. Belge içeriği düzenleme anının
 * kopyasıdır. Kimliksiz doğrulama yanıtı yalnız baş harf, kur, gün, durum ve kurum adıdır.
 */

const instant = z.iso.datetime()
const id = (description: string) => z.string().min(1).max(200).describe(description)
const status = z.enum(enumKeys(CERTIFICATE_STATUSES))

export const issueCertificateBodySchema = certificateIssueInputSchema.strict()
export const cancelCertificateBodySchema = certificateCancelInputSchema.strict()
export const mebbisRecordBodySchema = mebbisRecordInputSchema.strict()

export const certificateParamsSchema = z.object({ certificateId: id('Belge kimliği') })
export const mebbisGroupParamsSchema = z.object({ groupId: id('Dil grubu kimliği') })
export const mebbisDecisionParamsSchema = z.object({ decisionId: id('Kur sonu kararı kimliği') })
/** Kod sınırsız metindir: biçimi bozuk kod 400 değil, bulunamayan kodla aynı 404'tür. */
export const certificateVerificationParamsSchema = z.object({
  code: z.string().describe('Belgedeki doğrulama kodu (büyük/küçük harf ve tire fark etmez)'),
})

export const certificateListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1).describe('Sayfa numarası'),
  pageSize: z.coerce.number().int().min(1).max(100).default(25).describe('Sayfa boyutu (≤ 100)'),
  status: status.optional().describe('Belge durumu süzgeci'),
  studentId: id('Kursiyer süzgeci').optional(),
  courseId: id('Kur süzgeci').optional(),
})

const staffCertificateSchema = z.object({
  id: z.string(),
  number: z.string().describe('Belge numarası `KB-<yıl>-<sıra>`; kurum içinde tekil'),
  status,
  verificationCode: z.string().describe('Doğrulama kodu (7×4 Crockford base32)'),
  enrollmentId: z.string(),
  groupId: z.string(),
  learnerId: z.string(),
  courseId: z.string(),
  decisionId: z.string(),
  content: certificateContentSchema,
  replacesCertificateId: z.string().nullable(),
  issuedByUserId: z.string(),
  issuedAt: instant,
  cancelledByUserId: z.string().nullable(),
  cancelledAt: instant.nullable(),
  cancellationReason: z.string().nullable(),
  rowVersion: z.number().int().min(1).describe('Belgenin satır sürümü (`If-Match`)'),
})

const learnerCertificateSchema = z.object({
  id: z.string(),
  number: z.string(),
  status,
  verificationCode: z.string(),
  courseId: z.string(),
  content: certificateContentSchema,
  issuedAt: instant,
})

const certificateSchema = z.union([staffCertificateSchema, learnerCertificateSchema])

export const certificateResponseSchema = dataResponse(staffCertificateSchema)
export const certificateDetailResponseSchema = dataResponse(certificateSchema)
export const certificateListResponseSchema = pageResponse(certificateSchema)

export const certificateVerificationResponseSchema = dataResponse(
  z.object({
    status,
    learnerInitials: z.string().describe('Kursiyerin ad-soyad baş harfleri'),
    courseName: z.string(),
    issuedDate: z.iso.date().describe('Düzenleme günü (Europe/Istanbul)'),
    institutionName: z.string(),
  }),
)

/** Kimliksiz doğrulama hataları: biçimi bozuk ya da bulunamayan kod 404, hız sınırı 429. */
export const verificationErrors = {
  404: errorResponseSchema,
  429: errorResponseSchema,
  500: errorResponseSchema,
} as const

const mebbisRecordSchema = z.object({
  id: z.string(),
  decisionId: z.string(),
  certificateNumber: z.string().describe('MEBBİS Kurs Bitirme Belgesi numarası'),
  issuedDate: z.iso.date(),
  recordedByUserId: z.string(),
  recordedAt: instant,
})

export const mebbisRecordResponseSchema = dataResponse(
  mebbisRecordSchema.extend({ enrollmentId: z.string() }),
)

export const groupMebbisResponseSchema = dataResponse(
  z.object({
    groupId: z.string(),
    courseId: z.string(),
    canRecord: z
      .boolean()
      .describe('Oturumdaki kişi belgeyi işaretleyebilir mi (yönetici ya da koordinatör)'),
    learners: z.array(
      z.object({
        enrollmentId: z.string(),
        studentId: z.string(),
        decisionId: z.string(),
        record: mebbisRecordSchema.nullable(),
      }),
    ),
  }),
)
