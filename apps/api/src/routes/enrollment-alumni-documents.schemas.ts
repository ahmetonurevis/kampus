import { z } from 'zod'

import {
  ALUMNI_DELIVERY_METHODS,
  ALUMNI_DOCUMENT_TYPES,
  ALUMNI_FEE_PAYMENT_METHODS,
  ALUMNI_REQUEST_CHANNELS,
  ALUMNI_REQUEST_STATUSES,
  ALUMNI_REQUESTER_KINDS,
  alumniDocumentContentSchema,
} from '@kampus/school-core/lib/enrollment-alumni-documents.ts'
import { CUSTODY_KIND_KEYS } from '@kampus/school-core/lib/guardianship.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Mezun belge talebi şemaları (DOM-KAY-044; ON-260). */

const instant = z.string().nullable()

const requestSchema = z.object({
  id: z.string(),
  documentNumber: z
    .string()
    .nullable()
    .describe('Yıl bazlı sıralı belge numarası (`MB-2026-0001`); hazır olunca verilir'),
  studentId: z.string(),
  studentName: z.string().nullable(),
  documentType: z.enum(ALUMNI_DOCUMENT_TYPES),
  copies: z.number().int(),
  channel: z.enum(ALUMNI_REQUEST_CHANNELS).describe('Talebin geliş yolu'),
  requesterKind: z.enum(ALUMNI_REQUESTER_KINDS),
  requesterName: z.string().describe('Talep edenin adı (talep anının kopyası)'),
  guardianParentId: z.string().nullable(),
  authorizationFileId: z
    .string()
    .nullable()
    .describe('Vekâletname ya da yazılı rıza dosyası; `GET /files/{fileId}/url` ile açılır'),
  deliveryMethod: z.enum(ALUMNI_DELIVERY_METHODS),
  deliveryEmail: z.string().nullable(),
  deliveryAddress: z.string().nullable(),
  feeCents: z.number().int().describe('Dondurulmuş ücret (belge başı ücret × adet, kuruş)'),
  status: z.enum(ALUMNI_REQUEST_STATUSES),
  receivedAt: z.string(),
  receivedByName: z.string().nullable(),
  preparingAt: instant,
  preparingByName: z.string().nullable(),
  readyAt: instant,
  readyByName: z.string().nullable(),
  manualNote: z.string().nullable(),
  diplomaFileId: z.string().nullable().describe('Diploma örneğinin taranmış dosyası'),
  deliveredAt: instant,
  deliveredByName: z.string().nullable().describe('Teslim eden ve kimliği kontrol eden personel'),
  identityCheckNote: z.string().nullable(),
  paymentMethod: z.enum(ALUMNI_FEE_PAYMENT_METHODS).nullable(),
  paidAt: instant.describe('Ödendi işaretinin anı (ücretli teslim)'),
  rejectedAt: instant,
  rejectedByName: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  actions: z
    .array(z.enum(['start', 'ready', 'deliver', 'reject']))
    .describe('Talebin bu durumda yapılabilecek işlemleri'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

export const alumniRequestResponse = dataResponse(requestSchema)
export const alumniRequestListResponse = z.object({
  data: z.array(requestSchema),
  meta: pageMetaSchema,
})
export const alumniRequestParams = z.object({ requestId: z.uuid('Talep geçersiz.') })

export const alumniRequestListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe('Öğrencinin ya da talep edenin adında, belge numarasında (`MB-2026-0001`) arama'),
  status: z.enum(ALUMNI_REQUEST_STATUSES).optional(),
  documentType: z.enum(ALUMNI_DOCUMENT_TYPES).optional(),
  studentId: z.string().min(1).max(200).optional().describe('Bu öğrencinin talepleri'),
})

export const alumniStudentQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Adda ya da okul numarasında arama'),
})

export const alumniStudentListResponse = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      schoolNumber: z.string().nullable(),
      status: z.enum(['graduated', 'withdrawn']),
      leftDate: z.string().nullable().describe('Mezuniyet ya da ayrılış günü'),
      lastClassName: z.string().nullable(),
      adult: z
        .boolean()
        .nullable()
        .describe('Bugün reşit mi; doğum tarihi bilinmiyorsa `null` (reşit sayılır, K-328)'),
      guardians: z.array(
        z.object({
          parentId: z.string(),
          name: z.string().nullable(),
          custody: z.enum(CUSTODY_KIND_KEYS),
          contactRestricted: z.boolean(),
        }),
      ),
    }),
  ),
  meta: pageMetaSchema,
})

export const alumniFeesResponse = dataResponse(
  z.object({
    education_certificate: z.number().int(),
    transcript: z.number().int(),
    diploma_copy: z.number().int(),
    updatedAt: z.string().nullable(),
  }),
)

export const alumniDocumentResponse = dataResponse(
  z.object({
    requestId: z.string(),
    documentNumber: z.string(),
    documentType: z.enum(ALUMNI_DOCUMENT_TYPES),
    copies: z.number().int(),
    issuedAt: z.string().describe('Belgenin hazır olduğu an (UTC); belgede Europe/Istanbul günü'),
    manualNote: z.string().nullable(),
    content: alumniDocumentContentSchema,
  }),
)
