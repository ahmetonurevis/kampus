import { z } from 'zod'

import {
  DOCUMENT_CONSENT_GRANTORS,
  PROSPECT_DOCUMENT_STAGES,
} from '@kampus/school-core/lib/prospect-documents.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Kayıt belgeleri şemaları (DOM-KAY-045; ON-344). Yanıt iletişim ve kimlik bilgisi taşımaz. */

const instant = z.iso.datetime()

const missingSchema = z.object({
  id: z.string(),
  label: z.string(),
  stage: z.enum(PROSPECT_DOCUMENT_STAGES),
})

const gapsSchema = z.object({
  missing: z
    .array(missingSchema)
    .describe('Eksik zorunlu türler (kesin kayıtta iki aşamanın türleri de istenir; K-321)'),
  awaitingReview: z.number().int().min(0).describe('İncelemesi bekleyen güncel aday belgesi'),
})

const listRowSchema = z
  .object({
    studentId: z.string(),
    prospectId: z.string().describe('Belgelerin yüklendiği aday kaydı (aday detayı bağlantısı)'),
    name: z.string(),
    documentCount: z.number().int().min(0).describe('Öğrenciye bağlı, dosyası duran belge sayısı'),
    ...gapsSchema.shape,
  })
  .meta({ id: 'EnrollmentDocumentRow' })

export const enrollmentDocumentListResponse = z.object({
  data: z.array(listRowSchema),
  meta: pageMetaSchema,
})

export const enrollmentDocumentListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().max(100).optional().describe('Ada göre arama'),
  missingOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true')
    .describe('`true`: yalnız eksik zorunlu belgesi olan öğrenciler'),
})

const documentSchema = z
  .object({
    id: z.uuid().describe('Aday belgesinin kimliği (açılış aday belge ucundan)'),
    prospectId: z.string(),
    documentTypeId: z.string(),
    typeLabel: z.string(),
    specialCategory: z.boolean(),
    canOpen: z
      .boolean()
      .describe('Oturumdaki kişi dosyayı açabilir mi (özel nitelikli belgede yalnız yönetici)'),
    file: z.object({
      available: z.boolean().describe('Dosya imha edilmemiş mi'),
      name: z
        .string()
        .nullable()
        .describe('Özgün dosya adı; özel nitelikli belgeyi açamayana `null`'),
      contentType: z.string(),
      byteSize: z.number().int().min(0),
    }),
    reviewedAt: instant.nullable(),
    linkedAt: instant.nullable().describe('Öğrenciye bağlandığı an'),
  })
  .meta({ id: 'EnrollmentDocument' })

export const enrollmentDocumentsResponse = dataResponse(
  z
    .object({
      studentId: z.string(),
      name: z.string(),
      prospectId: z
        .string()
        .nullable()
        .describe('Kesin kaydın adayı; aday kaydından gelmeyen öğrencide `null`'),
      documents: z.array(documentSchema).describe('Bağlı belgeler, en yeni bağ önce'),
      gaps: gapsSchema,
      consent: z
        .object({
          grantor: z.enum(DOCUMENT_CONSENT_GRANTORS),
          grantedAt: instant,
          linkedAt: instant.nullable(),
        })
        .nullable()
        .describe('Öğrenciye bağlı etkin özel nitelikli belge rızası (K-385)'),
    })
    .meta({ id: 'EnrollmentDocuments' }),
)

export const enrollmentDocumentParams = z.object({
  studentId: z.string().min(1).max(200).describe('Öğrenci kimliği'),
})
