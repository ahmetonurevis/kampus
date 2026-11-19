import { z } from 'zod'

import {
  POLICY_ACK_CHANNELS,
  POLICY_AUDIENCES,
  POLICY_TYPES,
} from '@kampus/school-core/lib/finance-policy-acknowledgements.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Politika belgesi okundu onayı şemaları (DOM-FIN-127; ON-190). */

const policyType = z
  .enum(POLICY_TYPES)
  .describe(
    '`staff_regulation` personel yönetmeliği, `kvkk_commitment` KVKK taahhüdü, `occupational_safety` iş güvenliği, `discipline` disiplin, `other` diğer',
  )
const audience = z
  .enum(POLICY_AUDIENCES)
  .describe(
    '`all_staff` tüm personel, `teachers` öğretmenler, `administrative` yönetici ve ön büro',
  )
const channel = z
  .enum(POLICY_ACK_CHANNELS)
  .describe(
    '`self_service` personelin kendi ekranı, `wet_signature` ıslak imzalı form, `email` e-posta, `in_person` yüz yüze',
  )

const documentSchema = z.object({
  id: z.string().describe('Sürüm kimliği'),
  seriesId: z.string().describe('Aynı belgenin sürümlerini bağlayan kimlik'),
  version: z.number().int().describe('Sürüm numarası (1’den başlar)'),
  title: z.string(),
  policyType,
  audience,
  publishedOn: z.string().describe('Yayın günü (YYYY-MM-DD)'),
  fileId: z.string().describe('PDF dosyası; bağlantı `GET /files/{fileId}/url`'),
  replacesId: z.string().nullable().describe('Yerine geçtiği önceki sürüm'),
  supersededAt: z.string().nullable().describe('Yerine yeni sürüm yayımlandığı an'),
  createdAt: z.string(),
  current: z.boolean().describe('Geçerli sürüm mü (yerine geçilmemiş)'),
  targetCount: z.number().int().describe('Hedef kitledeki etkin personel sayısı'),
  acknowledgedCount: z.number().int().describe('Bu sürümü onaylayan etkin hedef personel'),
  pendingCount: z.number().int().describe('Onaylamayan etkin hedef personel'),
  rate: z
    .number()
    .int()
    .nullable()
    .describe('Onay oranı (yüzde, yuvarlanmış); hedef kitlede personel yoksa `null`'),
})

export const policyDocumentResponse = dataResponse(documentSchema)
export const policyDocumentDetailResponse = dataResponse(
  documentSchema.extend({
    versions: z.array(documentSchema).describe('Aynı belgenin bütün sürümleri, en yeni önce'),
  }),
)
export const policyDocumentListResponse = z.object({
  data: z.array(documentSchema),
  meta: pageMetaSchema,
})

const acknowledgementSchema = z.object({
  id: z.string(),
  policyDocumentId: z.string(),
  membershipId: z.string(),
  acknowledgedOn: z.string().describe('Onay günü (YYYY-MM-DD)'),
  channel,
  scanFileId: z
    .string()
    .nullable()
    .describe('Islak imza taraması; bağlantı `GET /files/{fileId}/url`'),
  recordedByUserId: z.string().describe('Kaydı giren kullanıcı'),
  createdAt: z.string(),
})
export const policyAcknowledgementResponse = dataResponse(acknowledgementSchema)

export const policyDocumentStaffListResponse = z.object({
  data: z.array(
    z.object({
      membershipId: z.string(),
      name: z.string(),
      role: z.string().describe('`yonetici`, `ogretmen` ya da `onburo`'),
      acknowledgement: z
        .object({
          id: z.string(),
          acknowledgedOn: z.string(),
          channel,
          scanFileId: z.string().nullable(),
        })
        .nullable()
        .describe('Onay bilgisi; onaylamayanda `null`'),
    }),
  ),
  meta: pageMetaSchema,
})

export const policyStaffListResponse = z.object({
  data: z.array(
    z.object({
      membershipId: z.string(),
      name: z.string(),
      role: z.string(),
      requiredCount: z.number().int().describe('Hedef kitlesinde olduğu geçerli sürüm sayısı'),
      acknowledgedCount: z.number().int(),
      missingDocuments: z
        .array(
          z.object({
            id: z.string(),
            title: z.string(),
            policyType,
            version: z.number().int(),
            publishedOn: z.string(),
          }),
        )
        .describe('Onaylanmamış geçerli sürümler'),
    }),
  ),
  meta: pageMetaSchema,
})

const q = z.string().trim().min(2).max(100).optional()

export const policyDocumentListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: q.describe('Belge adında arama'),
  policyType: policyType.optional(),
  status: z
    .enum(['current', 'all'])
    .default('current')
    .describe('`current` yalnız geçerli sürümler (varsayılan), `all` geçmiş sürümler dahil'),
})

export const policyDocumentStaffQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: q.describe('Personel adında arama'),
  status: z
    .enum(['pending', 'acknowledged'])
    .default('pending')
    .describe('`pending` onaylamayan (varsayılan), `acknowledged` onaylayan etkin hedef personel'),
})

export const policyStaffQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: q.describe('Personel adında arama'),
  missing: z
    .enum(['true', 'false'])
    .optional()
    .describe('`true` yalnız eksik onayı olan etkin personel'),
})

export const policyDocumentParams = z.object({ documentId: z.uuid('Belge geçersiz.') })
