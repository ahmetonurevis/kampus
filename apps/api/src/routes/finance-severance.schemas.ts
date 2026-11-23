import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  SEVERANCE_SUGGESTION_STATUSES,
  WAGE_TYPES,
} from '@kampus/school-core/lib/finance-pay-rates.ts'
import {
  SEVERANCE_EXIT_REASONS,
  SEVERANCE_PARAMETER_SOURCES,
  SEVERANCE_WARNING_CODES,
} from '@kampus/school-core/lib/finance-severance.ts'

import { dataResponse } from './common.schemas.ts'
import { payRateSchema } from './finance-pay-rates.schemas.ts'

// Kıdem ve ihbar tazminatı tahmini (ON-205, ON-341; DOM-FIN-094). Yanıt istekteki girdilerden ve
// kurumun çıkış günündeki bordro parametresinden hesaplanan döküm, uyarılar ve kaynaklardır; kişi
// adı yok, hiçbir şey saklanmaz (K-273, K-346). Tutarlar kuruş.

const suggestionStatus = z
  .enum(SEVERANCE_SUGGESTION_STATUSES)
  .describe(
    '`suggested` aylık brüt ana ücretten öneri yapıldı; `net_wage` ana ücret net, `non_monthly_wage` saatlik ya da ders saati, `no_wage` günde ana ücret yok: öneri yapılmaz (K-345)',
  )

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
    parameters: z
      .object({
        source: z
          .enum(SEVERANCE_PARAMETER_SOURCES)
          .describe(
            '`payroll_parameters` kurumun çıkış günündeki bordro parametre seti, `fallback_table` 2025 öncesi yedek tablo (K-344)',
          ),
        setId: z.string().nullable().describe('Parametre seti (`platform-…` ya da kurum kopyası)'),
        origin: z.enum(['platform', 'institution']).nullable(),
        version: z.number().int().nullable().describe('Kurum kopyasının sürümü'),
        effectiveFrom: day.describe('Setin ya da yedek tavan satırının yürürlük başlangıcı'),
        stampTaxRatePer100k: z
          .number()
          .int()
          .min(0)
          .describe('Damga vergisi oranı, yüz binde bir (759 = binde 7,59)'),
      })
      .describe('Tavan, dilim ve damga oranının kaynağı'),
    paySource: z
      .object({
        membershipId: z.string(),
        date: day.describe('Önerinin okunduğu gün (çıkış günü)'),
        status: suggestionStatus,
        wageRateId: z.string().nullable().describe('Günde yürürlükteki ana ücret tanımı'),
        wageRateType: z.enum(WAGE_TYPES).nullable(),
        wageStartDate: day.nullable(),
        benefitRateIds: z.array(z.string()).describe('Öneriye giren nakdi yan hak tanımları'),
        excludedBenefitCount: count.describe('Öneriye girmeyen ayni yan hak sayısı'),
        // kvkk: K (ücret)
        suggestedGrossWageCents: cents.nullable(),
        suggestedBenefitsCents: cents.nullable(),
        grossWageChanged: z.boolean().describe('Girilen brüt öneriden farklı ya da öneri yok'),
        benefitsChanged: z.boolean(),
      })
      .nullable()
      .describe('Personel seçildiyse ücret girdisinin kaynağı (K-346); seçilmediyse `null`'),
    warnings: z
      .array(z.enum(SEVERANCE_WARNING_CODES))
      .describe(
        'Uyarı kodları: `ceiling_stale` (çıkış yarıyılı için tavan yok, son bilinen kullanıldı), `tax_table_stale` (çıkış yılı dilimleri yok), `resignation_notice_owed` (bildirimsiz istifada ihbarı çalışan öder), `pay_suggestion_unavailable` (personel seçildi, ücret tanımından öneri yapılamadı)',
      ),
  }),
)

/** Personelin çıkış günündeki ücret önerisi (K-345). Yalnız yöneticiye döner (K-347). */
export const severancePaySuggestionQuery = z.strictObject({
  membershipId: z.string().trim().min(1).max(100).describe('Personelin kurum üyeliği'),
  date: daySchema
    .optional()
    .describe('Çıkış günü (YYYY-MM-DD); varsayılan bugün (Europe/Istanbul)'),
})

export const severancePaySuggestionResponse = dataResponse(
  z.object({
    membershipId: z.string(),
    name: z.string(),
    active: z.boolean().describe('Pasifleştirilmiş (ayrılan) personelde `false`'),
    date: day.describe('Önerinin hesaplandığı gün'),
    status: suggestionStatus,
    // kvkk: K (ücret)
    grossWageCents: cents.nullable().describe('Önerilen aylık brüt; öneri yoksa `null`'),
    regularBenefitsCents: cents
      .nullable()
      .describe('Önerilen düzenli yan ödeme (nakdi yan hakların toplamı); öneri yoksa `null`'),
    wage: payRateSchema.nullable().describe('Günde yürürlükteki ana ücret tanımı'),
    benefits: z
      .array(
        payRateSchema.extend({
          included: z.boolean().describe('Kıdeme esas mı: nakdi `true`, ayni `false` (K-345)'),
        }),
      )
      .describe('Günde yürürlükteki yan haklar'),
  }),
)
