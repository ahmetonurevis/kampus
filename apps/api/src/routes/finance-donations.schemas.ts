import { z } from 'zod'

import {
  DONATION_CAMPAIGN_STATUSES,
  DONATION_KINDS,
  DONATION_METHODS,
  DONOR_KINDS,
  DONOR_RELATIONS,
} from '@kampus/school-core/lib/finance-donations.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Bağış kampanyası, bağışçı ve makbuz şemaları (DOM-FIN-097; ON-258). Tutarlar kuruş tamsayı. */

const cents = (description: string) => z.number().int().describe(description)

const campaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.string(),
  targetCents: cents('Hedef tutar'),
  startsOn: z.string().describe('Başlangıç günü (YYYY-MM-DD)'),
  endsOn: z.string().describe('Bitiş günü (YYYY-MM-DD)'),
  bankAccountId: z.string().nullable(),
  bankAccountLabel: z.string().nullable().describe('Banka adı ve IBAN son dört hanesi'),
  status: z.enum(DONATION_CAMPAIGN_STATUSES).describe('`draft`, `open`, `closed` (K-296)'),
  openedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  collectedCents: cents('Geçerli nakdi bağışların toplamı (ilerleme tabanı)'),
  inKindDeclaredCents: cents('Geçerli ayni bağışların beyan edilen değer toplamı; hedefe sayılmaz'),
  donationCount: z.number().int().describe('Geçerli bağış sayısı (nakdi ve ayni)'),
  inKindCount: z.number().int().describe('Geçerli ayni bağış sayısı'),
  percent: z.number().int().describe('Toplanan / hedef, yüzde (aşağı yuvarlanır; 100’ü geçebilir)'),
  remainingCents: cents('Hedefe kalan; aşılınca 0'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

const donorSchema = z.object({
  id: z.string(),
  kind: z.enum(DONOR_KINDS),
  name: z.string(),
  maskedIdentityNumber: z
    .string()
    .nullable()
    .describe('Son dört hane dışında maskeli TCKN/VKN; tam değer yalnız makbuz ucunda (K-298)'),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  link: z
    .object({
      studentId: z.string(),
      relation: z.enum(DONOR_RELATIONS),
      studentName: z.string().nullable(),
    })
    .nullable()
    .describe('Veli ya da mezun bağı (isteğe bağlı)'),
  createdAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

const donationFields = {
  id: z.string(),
  campaignId: z.string(),
  donorId: z.string().nullable().describe('Anonim bağışta boş'),
  donorKind: z.enum(DONOR_KINDS).nullable(),
  donorName: z.string().nullable().describe('Makbuz anındaki bağışçı adı; anonimde boş'),
  maskedIdentityNumber: z.string().nullable(),
  kind: z.enum(DONATION_KINDS).describe('`cash` nakdi, `in_kind` ayni (K-297)'),
  amountCents: cents('Nakdi tutar').nullable(),
  method: z.enum(DONATION_METHODS).nullable(),
  bankAccountId: z.string().nullable(),
  bankAccountLabel: z.string().nullable(),
  reference: z.string().nullable().describe('Dekont ya da slip numarası'),
  description: z.string().nullable().describe('Ayni bağış açıklaması'),
  declaredValueCents: cents('Ayni bağışta beyan edilen değer').nullable(),
  donatedOn: z.string().describe('Bağış günü (YYYY-MM-DD)'),
  note: z.string().nullable(),
  receiptYear: z.number().int(),
  receiptNumber: z.number().int().describe('Kurum ve yıl içinde ardışık makbuz numarası'),
  hasTaxNotice: z.boolean().describe('Makbuzda vergi indirimi ibaresi var mı'),
  createdAt: z.string().describe('Kayıt (makbuz düzenleme) anı'),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü (iptal)'),
}
const donationSchema = z.object(donationFields)

export const campaignResponse = dataResponse(campaignSchema)
export const campaignListResponse = z.object({
  data: z.array(campaignSchema),
  meta: pageMetaSchema,
})
export const campaignListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Kampanya adında arama'),
  status: z.enum(DONATION_CAMPAIGN_STATUSES).optional().describe('Durum süzgeci'),
})
export const campaignParams = z.object({ campaignId: z.uuid('Kampanya geçersiz.') })

export const donorResponse = dataResponse(donorSchema)
export const donorListResponse = z.object({ data: z.array(donorSchema), meta: pageMetaSchema })
export const donorListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe('Adda arama; dört hane kimlik numarasının son haneleriyle, tam numara tam eşleşir'),
})
export const donorParams = z.object({ donorId: z.uuid('Bağışçı geçersiz.') })

export const donationResponse = dataResponse(donationSchema)
export const donationListResponse = z.object({
  data: z.array(donationSchema),
  meta: pageMetaSchema,
})
export const donationListQuery = z.strictObject({ ...pageQuerySchema.shape })
export const donationParams = z.object({ donationId: z.uuid('Bağış geçersiz.') })
export const receiptResponse = dataResponse(
  z.object({
    ...donationFields,
    identityNumber: z
      .string()
      .nullable()
      .describe('Makbuz anındaki bağışçının tam TCKN/VKN; okuma denetime yazılır'),
    taxNotice: z.string().nullable().describe('Makbuza kopyalanmış vergi indirimi ibaresi'),
    campaign: z.object({ id: z.string(), name: z.string(), purpose: z.string() }),
  }),
)

export const settingsResponse = dataResponse(
  z.object({
    taxNoticeEnabled: z.boolean(),
    taxNoticeText: z.string().nullable(),
    version: z.number().int().describe('`If-Match` için ayar sürümü; ayar hiç değişmediyse 1'),
  }),
)
