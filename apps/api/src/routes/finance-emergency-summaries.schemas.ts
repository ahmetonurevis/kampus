import { z } from 'zod'

import {
  EMERGENCY_SUMMARY_STATES,
  emergencyCardPurposeSchema,
  emergencyContactPositionSchema,
} from '@kampus/school-core/lib/finance-emergency-summaries.ts'
import {
  HEALTH_ACCESS_NOTE_HEADER,
  HEALTH_ACCESS_REASON_CODES,
  HEALTH_ACCESS_REASON_HEADER,
} from '@kampus/school-core/lib/finance-health-access.ts'
import { GUARDIAN_RELATIONSHIP_KEYS } from '@kampus/school-core/lib/guardianship.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Acil durum özeti şemaları (DOM-FIN-155; ON-165; K-520…K-522). */

const state = z
  .enum(EMERGENCY_SUMMARY_STATES)
  .describe(
    '`draft` onay bekliyor (görünmez), `published` yayında, `pending_revision` yayında; değişiklik onay bekliyor',
  )
const recordId = (message: string) => z.string(message).trim().min(1, message).max(128)

const alerts = z
  .object({
    allergy: z.boolean(),
    chronic: z.boolean(),
    medication: z.boolean(),
  })
  .describe('Uyarı türü işaretleri (sağlık profilinden; ad ve tanı yok)')

const contact = z.object({
  position: z.number().int().describe('Kişi sırası (1 ya da 2); tam telefon açılışında kullanılır'),
  name: z.string().nullable(),
  relationship: z.enum(GUARDIAN_RELATIONSHIP_KEYS).nullable(),
  phoneMasked: z.string().nullable().describe('Maskeli telefon (`0532 *** ** 12`)'),
  hasPhone: z.boolean(),
})

const cardSchema = z.object({
  summaryId: z.string(),
  studentId: z.string(),
  studentName: z.string(),
  classId: z.string().nullable(),
  className: z.string().nullable(),
  actionText: z.string().describe('Onaylanmış acil eylem metni (özel nitelikli)'),
  alerts,
  medicationToday: z.boolean().describe('Bugün okulda verilecek onaylı revir ilacı var mı'),
  contacts: z.array(contact).describe('Acil iletişim (en çok iki kişi, telefon maskeli)'),
  needsReview: z.boolean().describe('Sağlık profili onaydan sonra değişti'),
  approvedAt: z.string().describe('Son onay anı (ISO 8601)'),
})

export const emergencyCardResponse = dataResponse(cardSchema)

export const emergencyClassCardsResponse = dataResponse(
  z.object({
    classId: z.string(),
    className: z.string(),
    listDate: z.string().describe('Liste günü (YYYY-MM-DD, Europe/Istanbul)'),
    purpose: z.enum(['view', 'print']),
    cards: z.array(cardSchema),
  }),
)

export const emergencyClassListResponse = z.object({
  data: z.array(
    z.object({
      classId: z.string(),
      className: z.string(),
      summaryCount: z.number().int().describe('Yayında özeti olan etkin öğrenci sayısı'),
    }),
  ),
})

const rowSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  studentName: z.string().nullable(),
  studentActive: z.boolean().describe('Öğrenci kayıtlı mı; ayrılan öğrencinin özeti görünmez'),
  classId: z.string().nullable(),
  className: z.string().nullable(),
  state,
  needsReview: z.boolean(),
  approvedAt: z.string().nullable(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` sürümü'),
})

export const emergencySummaryListResponse = z.object({
  data: z.array(rowSchema),
  meta: pageMetaSchema,
})

export const emergencySummaryResponse = dataResponse(
  rowSchema.omit({ updatedAt: true }).extend({
    draftText: z.string().nullable().describe('Onay bekleyen metin (özel nitelikli)'),
    publishedText: z.string().nullable().describe('Yayındaki metin (özel nitelikli)'),
    profileInstructions: z
      .string()
      .nullable()
      .describe('Sağlık profilindeki acil talimat (DOM-ILT-035; metne kaynak, kopyalanmaz)'),
    alerts,
    medicationToday: z.boolean(),
    contacts: z.array(contact),
    approvedByName: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
)

export const emergencySummaryArchiveResponse = dataResponse(
  z.object({ id: z.string(), archived: z.literal(true) }),
)

export const emergencyContactResponse = dataResponse(
  z.object({
    position: z.number().int(),
    name: z.string().nullable(),
    relationship: z.enum(GUARDIAN_RELATIONSHIP_KEYS).nullable(),
    phone: z.string().describe('Tam telefon; istemci yalnız bellekte tutar'),
  }),
)

export const emergencySummaryListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  state: state.optional(),
  classId: recordId('Sınıf geçersiz.').optional().describe('Öğrencinin güncel sınıfı'),
  q: z.string().trim().max(80).optional().describe('Öğrenci adında arama'),
})

export const emergencyCardQuery = z.strictObject({ purpose: emergencyCardPurposeSchema })

export const emergencySummaryParams = z.object({ summaryId: z.uuid('Özet geçersiz.') })
export const emergencyClassParams = z.object({ classId: recordId('Sınıf geçersiz.') })
export const emergencyStudentParams = z.object({ studentId: recordId('Öğrenci geçersiz.') })
export const emergencyContactParams = z.object({
  studentId: recordId('Öğrenci geçersiz.'),
  position: emergencyContactPositionSchema,
})

/**
 * Kart okumalarının isteğe bağlı erişim gerekçesi (K-521, DOM-FIN-156): gönderilmezse okuma
 * `emergency` koduyla kaydedilir; gönderilirse ON-164 kuralıyla doğrulanır.
 */
export const emergencyCardHeaders = z.looseObject({
  [HEALTH_ACCESS_REASON_HEADER]: z
    .enum(HEALTH_ACCESS_REASON_CODES)
    .optional()
    .describe(
      'İsteğe bağlı sağlık verisi erişim gerekçesi; gönderilmezse `emergency` (acil durum) yazılır. Geçersizse 400 `health_access_reason_invalid`.',
    ),
  [HEALTH_ACCESS_NOTE_HEADER]: z
    .string()
    .optional()
    .describe('Yalnız `other` gerekçede açıklama (5–200, yüzde kodlu UTF-8).'),
})
