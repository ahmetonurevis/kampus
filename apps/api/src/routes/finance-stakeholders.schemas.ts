import { z } from 'zod'

import {
  AGREEMENT_BENEFITS,
  AGREEMENT_EXPIRING_MAX_DAYS,
  AGREEMENT_VIEW_STATUSES,
  CONTRIBUTION_TYPES,
  STAKEHOLDER_TYPES,
} from '@kampus/school-core/lib/finance-stakeholders.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Paydaş ve sponsor anlaşması şemaları (DOM-FIN-102; ON-262). Anlaşmanın `status`, `daysLeft`,
 * `noticeDate` ve `renewalDue` alanları saklanmaz, her okumada hesaplanır (K-318, K-319).
 */

const version = z.number().int().describe('`If-Match` için kayıt sürümü')
const stakeholderType = z.enum(STAKEHOLDER_TYPES)

const stakeholderListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: stakeholderType,
  taxNumber: z.string().nullable().describe('VKN (tüzel kişi; kişisel veri değildir)'),
  contactName: z.string().nullable().describe('İletişim kişisinin adı'),
  contactEmail: z.string().nullable().describe('Maskeli e-posta (`a***@alan.com`, K-317)'),
  contactPhone: z.string().nullable().describe('Maskeli telefon (`0532 *** ** 12`, K-317)'),
  tags: z.array(z.string()),
  isActive: z.boolean(),
  activeAgreementCount: z.number().int().describe('Yürürlükte ve bitmemiş anlaşma sayısı'),
  renewalDueCount: z
    .number()
    .int()
    .describe('Yenileme uyarısındaki anlaşma sayısı (bitişe kalan gün ≤ bildirim günü, K-319)'),
  version,
})
export const stakeholderListResponse = z.object({
  data: z.array(stakeholderListItemSchema),
  meta: pageMetaSchema,
})

const stakeholderDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: stakeholderType,
  taxNumber: z.string().nullable(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable().describe('Tam e-posta (yalnız yönetici)'),
  contactPhone: z.string().nullable().describe('Tam telefon (yalnız yönetici)'),
  tags: z.array(z.string()),
  isActive: z.boolean(),
  createdAt: z.string(),
  version,
})
export const stakeholderResponse = dataResponse(stakeholderDetailSchema)

const agreementSchema = z.object({
  id: z.string(),
  stakeholder: z.object({ id: z.string(), name: z.string(), type: stakeholderType }),
  subject: z.string(),
  startDate: z.string(),
  endDate: z.string().describe('Bitiş günü (dahil)'),
  renewalNoticeDays: z.number().int(),
  contributionType: z.enum(CONTRIBUTION_TYPES),
  contributionAmountCents: z
    .number()
    .int()
    .nullable()
    .describe('Kuruş; nakdide tutar, ayni ve hizmette tahmini değer'),
  contributionDescription: z.string().nullable(),
  benefits: z.array(z.enum(AGREEMENT_BENEFITS)),
  benefitNote: z.string().nullable(),
  contractFileId: z.string().nullable(),
  status: z
    .enum(AGREEMENT_VIEW_STATUSES)
    .describe(
      '`draft`, `active`, `ended` (bitiş günü geçmiş yürürlükteki, hesaplanır), `terminated`',
    ),
  daysLeft: z.number().int().nullable().describe('Bitişe kalan gün; yalnız yürürlükteki anlaşmada'),
  noticeDate: z
    .string()
    .nullable()
    .describe('Yenileme bildirimi günü (bitiş − bildirim günü); yalnız yürürlükteki anlaşmada'),
  renewalDue: z.boolean().describe('Yenileme uyarısında mı (K-319)'),
  terminationDate: z.string().nullable(),
  version,
})
export const agreementListResponse = z.object({
  data: z.array(agreementSchema),
  meta: pageMetaSchema,
})
export const agreementResponse = dataResponse(
  agreementSchema.extend({
    contractFile: z
      .object({ id: z.string(), name: z.string(), byteSize: z.number().int() })
      .nullable()
      .describe('Sözleşme dosyası; bağlantısı `GET /files/{fileId}/url` ile alınır'),
    activatedAt: z.string().nullable(),
    terminationReason: z.string().nullable(),
    terminatedAt: z.string().nullable(),
    createdAt: z.string(),
  }),
)
export const agreementArchiveResponse = dataResponse(
  z.object({ id: z.string(), archivedAt: z.string() }),
)

export const stakeholderParams = z.object({ stakeholderId: z.uuid('Paydaş geçersiz.') })
export const agreementParams = z.object({ agreementId: z.uuid('Anlaşma geçersiz.') })

const trueOnly = z.enum(['true']).optional()

export const stakeholderListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe('Ad, VKN ve iletişim kişisinin adında arama, Türkçe harf duyarsız'),
  type: stakeholderType.optional().describe('Paydaş türü'),
  status: z.enum(['active', 'inactive']).optional().describe('`active` etkin, `inactive` pasif'),
  tag: z.string().trim().min(2).max(40).optional().describe('Etiket (tam eşleşme, küçük harf)'),
  renewalDue: trueOnly.describe('`true`: yenileme uyarısında anlaşması olan paydaşlar'),
})

export const agreementListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Konu ve paydaş adında arama'),
  stakeholderId: z.uuid().optional().describe('Paydaşın anlaşmaları'),
  status: z.enum(AGREEMENT_VIEW_STATUSES).optional().describe('Gösterilen durum'),
  expiringWithinDays: z.coerce
    .number()
    .int()
    .min(1)
    .max(AGREEMENT_EXPIRING_MAX_DAYS)
    .optional()
    .describe('Bitişi bugün dahil N gün içinde olan yürürlükteki anlaşmalar (1–365)'),
  renewalDue: trueOnly.describe('`true`: yenileme uyarısındaki anlaşmalar (K-319)'),
})
