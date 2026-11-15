import { z } from 'zod'

import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES } from '@kampus/school-core/lib/prospect-campaigns.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Kampanya kodu şemaları (DOM-KAY-041; ON-134). Yanıt kişi verisi taşımaz. */

const day = z.string().describe('`YYYY-MM-DD`, Europe/Istanbul günü (dahil)')

const campaignSchema = z
  .object({
    id: z.string(),
    code: z.string().describe('Büyük harf kod; kurumda tekil, değişmez'),
    name: z.string(),
    channel: z.enum(CAMPAIGN_CHANNELS),
    startDate: day,
    endDate: day,
    costCents: z.number().int().nullable().describe('Toplam maliyet, kuruş; girilmediyse `null`'),
    isActive: z.boolean(),
    status: z
      .enum(CAMPAIGN_STATUSES)
      .describe(
        'Bugüne göre durum: `usable` (adaya bağlanabilir), `inactive`, `not_started`, `ended`',
      ),
    version: z.number().int().describe('`If-Match` için kayıt sürümü'),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'CampaignCode' })

export const campaignResponse = dataResponse(campaignSchema)
export const campaignListResponse = z.object({
  data: z.array(campaignSchema),
  meta: pageMetaSchema,
})
export const campaignArchiveResponse = dataResponse(z.object({ id: z.string() }))

export const campaignParams = z.object({ campaignId: z.uuid('Kampanya geçersiz.') })
export const campaignListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe('Kod ya da adda arama, Türkçe harf duyarsız'),
  status: z
    .enum(['usable', 'active', 'inactive'])
    .optional()
    .describe('`usable`: etkin ve bugün tarih aralığında (aday formu); `active`/`inactive` bayrak'),
  channel: z.enum(CAMPAIGN_CHANNELS).optional(),
})

// --- Huni kırılımı -------------------------------------------------------------------------

const dayQuery = (edge: string) =>
  z.iso
    .date()
    .optional()
    .describe(`Adayın açılış günü (Europe/Istanbul) için ${edge} (\`YYYY-MM-DD\`, dahil)`)

export const campaignFunnelQuery = z
  .strictObject({ dateFrom: dayQuery('başlangıç'), dateTo: dayQuery('bitiş') })
  .refine((query) => !query.dateFrom || !query.dateTo || query.dateFrom <= query.dateTo, {
    path: ['dateTo'],
    message: 'Bitiş günü başlangıç gününden önce olamaz.',
  })

const count = z.number().int().min(0)
const countsShape = {
  prospects: count.describe('Aralıkta açılan aday'),
  meetings: count.describe('Görüşmeye (dil okulunda deneme dersine de) ulaşan aday, birikimli'),
  offers: count.describe('Teklif aşamasına ulaşan aday, birikimli'),
  enrolled: count.describe('Kesin kayıt'),
  conversionRate: z
    .number()
    .min(0)
    .max(100)
    .nullable()
    .describe('Kesin kaydın aday sayısına oranı, yüzde (bir ondalık); aday yoksa `null`'),
}
const countsSchema = z.object(countsShape).meta({ id: 'CampaignFunnelCounts' })

const campaignFunnelSchema = z
  .object({
    dateFrom: z.string().nullable(),
    dateTo: z.string().nullable(),
    total: countsSchema,
    uncoded: countsSchema.describe('Kampanya koduyla açılmamış adaylar'),
    rows: z.array(
      z
        .object({
          campaign: z.object({
            id: z.string(),
            code: z.string(),
            name: z.string(),
            channel: z.enum(CAMPAIGN_CHANNELS),
            startDate: day,
            endDate: day,
            costCents: z.number().int().nullable(),
            isActive: z.boolean(),
            archived: z.boolean(),
          }),
          ...countsShape,
          costPerProspectCents: z
            .number()
            .int()
            .nullable()
            .describe(
              'Aday başı maliyet, kuruş; maliyet ya da aday yoksa ya da aralık kısmiyse `null`',
            ),
          costPerEnrollmentCents: z
            .number()
            .int()
            .nullable()
            .describe('Kesin kayıt başı maliyet, kuruş; aynı koşullarla `null`'),
          costPartial: z
            .boolean()
            .describe('Rapor aralığı kampanyanın bütün günlerini kapsamıyor (K-290)'),
        })
        .meta({ id: 'CampaignFunnelRow' }),
    ),
  })
  .meta({ id: 'CampaignFunnel' })

export const campaignFunnelResponse = dataResponse(campaignFunnelSchema)
