import { z } from 'zod'

import { FILE_STATUSES } from '@kampus/school-core/content/taxonomy.ts'
import {
  DOCUMENT_CONSENT_GRANTORS,
  DOCUMENT_CONSENT_METHODS,
  PROSPECT_DOCUMENT_KINDS,
  PROSPECT_DOCUMENT_STAGES,
  PROSPECT_DOCUMENT_STATUSES,
} from '@kampus/school-core/lib/prospect-documents.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Aday belgeleri şemaları (DOM-KAY-043; ON-263). Yanıt iletişim bilgisi taşımaz. */

const instant = z.iso.datetime()

const documentTypeSchema = z
  .object({
    id: z.string().describe('Tür kimliği: varsayılan türde türün kendisi, eklenen türde UUID'),
    kind: z.enum(PROSPECT_DOCUMENT_KINDS),
    label: z.string(),
    required: z.boolean(),
    stage: z
      .enum(PROSPECT_DOCUMENT_STAGES)
      .describe('`application` ön başvuru, `enrollment` kesin kayıt (K-321)'),
    specialCategory: z
      .boolean()
      .describe('Özel nitelikli kişisel veri (sağlık raporunda her zaman `true`; K-322)'),
    archived: z.boolean().describe('Arşivlenmiş tür; yalnız belge geçmişinde görünür'),
    version: z.number().int().describe('`If-Match` için kayıt sürümü'),
  })
  .meta({ id: 'ProspectDocumentType' })

export const documentTypeResponse = dataResponse(documentTypeSchema)
export const documentTypeListResponse = dataResponse(z.array(documentTypeSchema))
export const documentTypeArchiveResponse = dataResponse(z.object({ id: z.string() }))

const documentSchema = z
  .object({
    id: z.uuid(),
    documentTypeId: z.string(),
    status: z
      .enum(PROSPECT_DOCUMENT_STATUSES)
      .describe(
        '`uploaded` inceleme bekliyor, `accepted`, `rejected`, `superseded` yerine yenisi yüklendi',
      ),
    specialCategory: z.boolean(),
    canOpen: z
      .boolean()
      .describe('Oturumdaki kişi dosyayı açabilir mi (özel nitelikli belgede yalnız yönetici)'),
    file: z.object({
      status: z.enum(FILE_STATUSES),
      available: z.boolean().describe('Dosya imha edilmemiş mi'),
      name: z
        .string()
        .nullable()
        .describe('Özgün dosya adı; özel nitelikli belgeyi açamayana `null`'),
      contentType: z.string(),
      byteSize: z.number().int().min(0),
      purgeAt: instant
        .nullable()
        .describe(
          'Dosyanın imhaya işaretlendiği an (K-323); öğrenciye bağlı belgede `null` (K-386)',
        ),
    }),
    linkedToStudent: z
      .boolean()
      .describe('Kesin kayıtla öğrenci dosyasına bağlandı mı (DOM-KAY-045, K-384)'),
    linkedAt: instant.nullable().describe('Öğrenciye bağlandığı an'),
    rejectionReason: z
      .string()
      .nullable()
      .describe('Ret gerekçesi; özel nitelikli belgeyi açamayana `null`'),
    uploadedAt: instant,
    reviewedAt: instant.nullable(),
    supersededAt: instant.nullable(),
    version: z.number().int().describe('`If-Match` için belge sürümü'),
  })
  .meta({ id: 'ProspectDocument' })

const consentSchema = z
  .object({
    id: z.uuid(),
    grantor: z.enum(DOCUMENT_CONSENT_GRANTORS),
    method: z.enum(DOCUMENT_CONSENT_METHODS),
    grantedAt: instant,
    withdrawnAt: instant.nullable(),
    version: z.number().int().describe('Geri çekmede `If-Match` sürümü'),
  })
  .meta({ id: 'ProspectDocumentConsent' })

const missingSchema = z.object({
  id: z.string(),
  label: z.string(),
  stage: z.enum(PROSPECT_DOCUMENT_STAGES),
})

export const prospectDocumentsResponse = dataResponse(
  z
    .object({
      prospectId: z.string(),
      accepting: z
        .boolean()
        .describe('Belge eklenir ve incelenir mi (açık ya da kayda dönmüş aday)'),
      types: z.array(documentTypeSchema).describe('Arşivliler dahil türler, sırayla'),
      documents: z.array(documentSchema).describe('Belgeler, en yeni önce (geçmiş dahil)'),
      gaps: z.object({
        missing: z.array(missingSchema).describe('Aşaması gelmiş eksik zorunlu türler'),
        awaitingReview: z.number().int().min(0),
      }),
      consent: z.object({
        grantor: z
          .enum(DOCUMENT_CONSENT_GRANTORS)
          .describe('Rızayı verecek kişi: `guardian` veli, `self` aday'),
        active: consentSchema.nullable(),
        history: z.array(consentSchema),
      }),
    })
    .meta({ id: 'ProspectDocuments' }),
)

export const documentUrlResponse = dataResponse(
  z.object({
    url: z.url().describe('Kısa ömürlü imzalı GET bağlantısı'),
    expiresAt: instant,
  }),
)

const gapRowSchema = z
  .object({
    prospectId: z.string(),
    name: z.string(),
    stage: z.string(),
    branchId: z.string().nullable(),
    missing: z.array(missingSchema),
    awaitingReview: z.number().int().min(0),
  })
  .meta({ id: 'ProspectDocumentGap' })

export const documentGapListResponse = z.object({
  data: z.array(gapRowSchema),
  meta: pageMetaSchema,
})

export const documentGapQuery = z.strictObject({
  ...pageQuerySchema.shape,
  prospectId: z
    .union([z.string().min(1).max(200), z.array(z.string().min(1).max(200)).min(1).max(100)])
    .optional()
    .describe('Yalnız bu adaylar (en çok 100; parametre tekrarıyla); aday listesinin rozeti'),
})

export const prospectParams = z.object({
  prospectId: z.string().min(1).max(200).describe('Aday kimliği'),
})
export const documentParams = prospectParams.extend({
  documentId: z.uuid('Belge geçersiz.'),
})
export const documentTypeParams = z.object({
  typeId: z.string().min(1).max(64).describe('Belge türü kimliği'),
})
