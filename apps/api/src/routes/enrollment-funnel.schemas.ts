import { z } from 'zod'

import { FUNNEL_STEPS } from '@kampus/school-core/lib/enrollment-funnel.ts'
import { PROSPECT_STAGES } from '@kampus/school-core/lib/prospects.ts'
import { INSTITUTION_TYPES } from '@kampus/school-core/modules/collection-modules.ts'

import { dataResponse } from './common.schemas.ts'

// Kayıt hunisi (`GET /api/v1/prospects/funnel`; DOM-KAY-040, IST-117). Yalnız sayı ve oran döner;
// aday adı, iletişim bilgisi ve aday kimliği yok.

const day = (edge: string) =>
  z.iso
    .date()
    .optional()
    .describe(`Adayın açılış günü (Europe/Istanbul) için ${edge} (\`YYYY-MM-DD\`, dahil)`)

export const enrollmentFunnelQuerySchema = z
  .object({
    dateFrom: day('başlangıç'),
    dateTo: day('bitiş'),
  })
  .strict()
  .refine((query) => !query.dateFrom || !query.dateTo || query.dateFrom <= query.dateTo, {
    path: ['dateTo'],
    message: 'Bitiş günü başlangıç gününden önce olamaz.',
  })

const count = z.number().int().min(0)
const percent = z.number().min(0).max(100)

const funnelRowSchema = z.object({
  prospects: count.describe('Aralıkta açılan aday sayısı'),
  steps: z
    .array(
      z
        .object({
          step: z.enum(FUNNEL_STEPS).describe('Huni adımı; `trial` yalnız dil okulunda'),
          count: count.describe('Bu adıma ulaşan aday (birikimli)'),
          rate: percent
            .nullable()
            .describe(
              'Önceki adıma göre yüzde (bir ondalık); ilk adımda ve önceki adım 0 iken `null`',
            ),
        })
        .meta({ id: 'EnrollmentFunnelStep' }),
    )
    .describe('Kurum türünün adımları sırasıyla'),
  stages: z
    .array(
      z.object({ stage: z.enum(PROSPECT_STAGES), count }).meta({ id: 'EnrollmentFunnelStage' }),
    )
    .describe('Güncel aşama sayıları, aşama sırasıyla; tanınmayan eski aşama burada yok'),
  conversionRate: percent
    .nullable()
    .describe('Kesin kaydın aday sayısına oranı, yüzde (bir ondalık); aday yoksa `null`'),
})

export const enrollmentFunnelSchema = z
  .object({
    institutionType: z.enum(INSTITUTION_TYPES).describe('Adımları belirleyen kurum türü'),
    total: funnelRowSchema.meta({ id: 'EnrollmentFunnelRow' }),
    bySource: z
      .array(
        funnelRowSchema
          .extend({
            source: z
              .string()
              .nullable()
              .describe('Aday kaynağı (DOM-KAY-007); kaynaksız eski aday `null`'),
          })
          .meta({ id: 'EnrollmentFunnelSourceRow' }),
      )
      .describe(
        'Bilinen kaynaklar sıfır olsa da liste sırasıyla, sonra tanınmayan eski kaynaklar, en son kaynaksız',
      ),
    byCounselor: z
      .array(
        funnelRowSchema
          .extend({
            counselorId: z
              .string()
              .nullable()
              .describe('Adayı açan personelin kullanıcı kimliği; bilinmiyorsa `null`'),
            counselorName: z
              .string()
              .nullable()
              .describe('Danışmanın görünen adı; kurum üyesi değilse ya da bilinmiyorsa `null`'),
          })
          .meta({ id: 'EnrollmentFunnelCounselorRow' }),
      )
      .describe('Adayı olan danışmanlar aday sayısına göre çoktan aza; bilinmeyen en sonda'),
  })
  .meta({ id: 'EnrollmentFunnel' })

export const enrollmentFunnelResponseSchema = dataResponse(enrollmentFunnelSchema)
