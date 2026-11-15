import { z } from 'zod'

import {
  SEVERANCE_EXIT_REASONS,
  SEVERANCE_WARNING_CODES,
} from '@kampus/school-core/lib/finance-severance.ts'

import { dataResponse } from './common.schemas.ts'

// Kıdem ve ihbar tazminatı tahmini (ON-205; DOM-FIN-094). Yanıt yalnız istekteki girdilerden
// hesaplanan döküm ve uyarılardır; kişi adı yok, hiçbir şey saklanmaz (K-273). Tutarlar kuruş.

const cents = z.number().int().min(0)
const count = z.number().int().min(0)
const day = z.string().describe('`YYYY-MM-DD`')

const taxes = {
  grossCents: cents,
  incomeTaxCents: cents,
  stampTaxCents: cents,
  netCents: cents,
}

export const severanceEstimateResponseSchema = dataResponse(
  z.object({
    exitReason: z.enum(SEVERANCE_EXIT_REASONS),
    noticeGiven: z.boolean(),
    service: z.object({
      startDate: day,
      endDate: day,
      totalDays: count.describe('Giriş ve çıkış günü dahil takvim günü'),
      years: count.describe('Tam hizmet yılı'),
      months: count.describe('Son yıl dönümünden sonraki tam ay (gösterim)'),
      days: count.describe('Son tam aydan sonraki gün (gösterim)'),
      remainderDays: count.describe('Son yıl dönümünden sonraki gün (kıdemde 365’te bir)'),
    }),
    wage: z.object({
      grossWageCents: cents,
      regularBenefitsCents: cents,
      dressedWageCents: cents.describe('Aylık giydirilmiş brüt: brüt + düzenli yan ödemeler'),
      dailyDressedWageCents: cents.describe('Aylık giydirilmiş brüt / 30'),
    }),
    severance: z.object({
      status: z.enum(['eligible', 'reason_not_entitled', 'under_one_year']),
      days: z.number().min(0).describe('Tazminata esas gün (iki ondalık)'),
      fullYears: count,
      remainderDays: count,
      ceiling: z.object({
        from: day.describe('Uygulanan tavan döneminin başlangıcı'),
        monthlyCents: cents,
        stale: z.boolean().describe('Çıkış günü tablonun son döneminden sonra'),
      }),
      ceilingApplied: z.boolean(),
      baseMonthlyCents: cents.describe('Giydirilmiş aylık ile tavanın küçüğü'),
      dailyWageCents: cents,
      ...taxes,
    }),
    notice: z.object({
      status: z.enum(['eligible', 'reason_not_entitled', 'notice_given']),
      weeks: z.union([z.literal(2), z.literal(4), z.literal(6), z.literal(8)]),
      days: count.describe('Ödenen gün: hak varsa hafta × 7, yoksa 0'),
      dailyWageCents: cents,
      incomeTaxMethod: z.enum(['first_bracket', 'cumulative_base', 'none']),
      taxYear: z.number().int(),
      taxTableStale: z.boolean(),
      incomeTaxRateBasisPoints: z.number().int().min(0).max(10_000),
      ...taxes,
    }),
    totals: z.object(taxes),
    warnings: z
      .array(z.enum(SEVERANCE_WARNING_CODES))
      .describe(
        'Uyarı kodları: `ceiling_stale` (tavan tabloda yok, son bilinen kullanıldı), `tax_table_stale` (tarife yılı yok), `resignation_notice_owed` (bildirimsiz istifada ihbarı çalışan öder)',
      ),
  }),
)
