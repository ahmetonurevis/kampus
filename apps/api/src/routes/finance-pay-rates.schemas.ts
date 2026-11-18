import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  BENEFIT_FORMS,
  PAY_RATE_COMPONENTS,
  PAY_RATE_STATES,
  PAY_RATE_TYPES,
} from '@kampus/school-core/lib/finance-pay-rates.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Personel ücret tanımı şemaları (DOM-FIN-099; ON-194). Yalnız yöneticiye döner (K-306). */

const payRateSchema = z.object({
  id: z.string(),
  membershipId: z.string(),
  component: z
    .enum(PAY_RATE_COMPONENTS)
    .describe('`wage` ana ücret, `lesson` ek ders, `benefit` yan hak'),
  rateType: z.enum(PAY_RATE_TYPES).describe('Bileşenin türü'),
  // kvkk: K (ücret)
  amountCents: z.number().int().describe('Tutar, kuruş'),
  currency: z.literal('TRY'),
  benefitForm: z.enum(BENEFIT_FORMS).nullable().describe('Yan hakta nakdi ya da ayni'),
  taxable: z.boolean().nullable().describe('Yan hak vergiye tabi mi'),
  startDate: z.string().describe('Yürürlük başlangıcı (YYYY-MM-DD)'),
  endDate: z.string().nullable().describe('Yürürlük bitişi (dahil); boşsa süresiz'),
  note: z.string().nullable(),
  autoClosed: z.boolean().describe('Bitiş sonraki tanımla kendiliğinden çekildiyse `true` (K-304)'),
  state: z
    .enum(PAY_RATE_STATES)
    .describe('Bugüne göre: `scheduled` ileri tarihli, `active` yürürlükte, `ended` sona erdi'),
  createdAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü (bitiş ve iptal)'),
})

export const payRateResponse = dataResponse(payRateSchema)
export const payRateCreateResponse = dataResponse(
  z.object({
    rate: payRateSchema,
    closedRate: payRateSchema.nullable().describe('Kendiliğinden kapanan önceki tanım (K-304)'),
  }),
)
export const payRateCancelResponse = dataResponse(
  z.object({
    id: z.string(),
    reopenedRate: payRateSchema
      .nullable()
      .describe('İptal edilen tanımın kapattığı, eski bitişi geri yazılan tanım'),
  }),
)

const staffRowSchema = z.object({
  membershipId: z.string(),
  name: z.string(),
  role: z.string().describe('Rol: `yonetici`, `ogretmen` ya da `onburo`'),
  active: z.boolean().describe('Pasifleştirilmiş (ayrılan) personelde `false`'),
  wage: z
    .object({
      rateType: z
        .enum(PAY_RATE_TYPES)
        .describe('Ana ücret türü (aylık brüt, aylık net, saatlik, ders saati)'),
      amountCents: z
        .number()
        .int()
        .nullable()
        .describe('Tutar, kuruş; maskeli listede (`showAmounts` yok) `null` (K-306)'),
      startDate: z.string(),
    })
    .nullable()
    .describe('Gündeki ana ücret; tanım yoksa boş'),
  lessonRateCount: z.number().int().describe('Gündeki ek ders ücreti tanımı sayısı'),
  benefitCount: z.number().int().describe('Gündeki yan hak sayısı'),
  rateCount: z.number().int().describe('İptal edilmemiş bütün tanımların sayısı'),
})
export const staffListResponse = z.object({ data: z.array(staffRowSchema), meta: pageMetaSchema })

export const staffDetailResponse = dataResponse(
  z.object({
    membershipId: z.string(),
    name: z.string(),
    role: z.string(),
    active: z.boolean(),
    date: z.string().describe('Geçerli ücretin hesaplandığı gün'),
    rates: z
      .array(payRateSchema)
      .describe('İptal edilmemiş bütün tanımlar (yuva ve başlangıca göre)'),
    effective: z.array(payRateSchema).describe('`date` gününde yürürlükteki tanımlar'),
  }),
)

const dateQuery = daySchema
  .optional()
  .describe('Geçerli ücretin hesaplanacağı gün (YYYY-MM-DD); varsayılan bugün (Europe/Istanbul)')

export const staffListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Personel adında arama'),
  status: z
    .enum(['active', 'passive'])
    .optional()
    .describe('`active` etkin, `passive` pasifleştirilmiş (ayrılan) personel'),
  date: dateQuery,
  showAmounts: z
    .enum(['true', 'false'])
    .optional()
    .describe('`true` tutarları verir ve okuma denetim kaydına düşer (K-307); varsayılan maskeli'),
})
export const staffDetailQuery = z.strictObject({ date: dateQuery })

export const staffParams = z.object({
  membershipId: z.string().trim().min(1).max(100).describe('Personelin kurum üyeliği'),
})
export const payRateParams = z.object({ rateId: z.uuid('Ücret tanımı geçersiz.') })
