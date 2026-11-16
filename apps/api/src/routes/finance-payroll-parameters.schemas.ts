import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  PAYROLL_MAX_YEAR,
  PAYROLL_MIN_DATE,
  PAYROLL_MIN_YEAR,
  PAYROLL_PARAMETER_FIELDS,
} from '@kampus/school-core/lib/finance-payroll-parameters.ts'

import { dataResponse } from './common.schemas.ts'

/** Bordro parametreleri şemaları (DOM-FIN-100; ON-197). */

const valueShape = {
  effectiveFrom: z.string().describe('Yürürlük başlangıcı (ayın ilk günü, `YYYY-MM-DD`)'),
  minimumWageGrossCents: z.number().int().describe('Aylık brüt asgari ücret, kuruş'),
  incomeTaxBrackets: z
    .array(
      z.object({
        lowerBoundCents: z
          .number()
          .int()
          .describe('Dilim alt sınırı: yıllık kümülatif matrah, kuruş'),
        rateBasisPoints: z.number().int().describe('Dilim oranı, on binde bir'),
      }),
    )
    .describe('Ücret gelir vergisi dilimleri, alt sınıra göre artan; son dilim sınırsız'),
  sgkEmployeeRateBasisPoints: z.number().int().describe('SGK işçi payı, on binde bir'),
  sgkEmployerRateBasisPoints: z
    .number()
    .int()
    .describe('SGK işveren payı (indirimsiz), on binde bir'),
  sgkEmployerIncentiveBasisPoints: z
    .number()
    .int()
    .describe('İşveren prim indirimi (5510 md. 81/ı), on binde bir'),
  unemploymentEmployeeRateBasisPoints: z
    .number()
    .int()
    .describe('İşsizlik sigortası işçi payı, on binde bir'),
  unemploymentEmployerRateBasisPoints: z
    .number()
    .int()
    .describe('İşsizlik sigortası işveren payı, on binde bir'),
  sgkFloorMultiplierBasisPoints: z
    .number()
    .int()
    .describe('SGK taban çarpanı, on binde bir (10.000 = 1 kat)'),
  sgkCeilingMultiplierBasisPoints: z
    .number()
    .int()
    .describe('SGK tavan çarpanı, on binde bir (90.000 = 9 kat)'),
  stampTaxRatePer100k: z
    .number()
    .int()
    .describe('Damga vergisi oranı, yüz binde bir (759 = binde 7,59)'),
  minimumWageIncomeTaxExempt: z.boolean().describe('Asgari ücret gelir vergisi istisnası'),
  minimumWageStampTaxExempt: z.boolean().describe('Asgari ücret damga vergisi istisnası'),
  severanceCeilingCents: z.number().int().describe('Aylık kıdem tazminatı tavanı, kuruş'),
  source: z.string().describe('Değerlerin kaynağı'),
}

const derivedSchema = z
  .object({
    minimumWageEmployeeSgkCents: z.number().int(),
    minimumWageEmployeeUnemploymentCents: z.number().int(),
    minimumWageIncomeTaxCents: z.number().int().describe('İstisna açıksa 0'),
    minimumWageStampTaxCents: z.number().int().describe('İstisna açıksa 0'),
    minimumWageNetCents: z.number().int().describe('Net asgari ücret (saklanmaz, K-310)'),
    sgkFloorCents: z.number().int().describe('Prime esas kazanç tabanı, kuruş'),
    sgkCeilingCents: z.number().int().describe('Prime esas kazanç tavanı, kuruş'),
    sgkEmployerNetRateBasisPoints: z.number().int().describe('İndirimli işveren payı'),
  })
  .describe('Setten hesaplanan değerler; saklanmaz')

const resolvedShape = {
  id: z.string().describe('Kurum setinde kayıt kimliği; platform setinde `platform-<başlangıç>`'),
  origin: z
    .enum(['platform', 'institution'])
    .describe('`platform` varsayılan, `institution` kurumun kopyası'),
  overridesPlatform: z
    .boolean()
    .describe('Kurum kopyası aynı başlangıçlı platform setinin yerini aldı mı'),
  version: z.number().int().nullable().describe('Kurum setinde `If-Match` sürümü; platformda boş'),
  ...valueShape,
  unverifiedFields: z
    .array(z.enum(PAYROLL_PARAMETER_FIELDS))
    .describe('Platform setinde ayrıca doğrulanması gereken alanlar (M-40)'),
  derived: derivedSchema,
}

const periodSchema = z.object({
  ...resolvedShape,
  periodStart: z.string().describe('Dönemin yıl içindeki ilk günü'),
  periodEnd: z.string().describe('Dönemin yıl içindeki son günü'),
  carriedOver: z.boolean().describe('Set önceki yıldan sürüyor (yılın başında yeni set yok)'),
})

export const payrollYearResponse = dataResponse(
  z.object({
    year: z.number().int(),
    availableYears: z.array(z.number().int()).describe('Set bulunan yıllar, artan'),
    periods: z.array(periodSchema),
  }),
)

export const payrollEffectiveResponse = dataResponse(
  z.object({
    date: z.string(),
    stale: z
      .boolean()
      .describe('Günün yılı için set yok; son bilinen set kullanıldı, güncelliğini doğrulayın'),
    ...resolvedShape,
  }),
)

export const payrollSetResponse = dataResponse(
  z.object({
    id: z.uuid(),
    version: z.number().int(),
    ...valueShape,
  }),
)

export const payrollArchiveResponse = dataResponse(
  z.object({ id: z.uuid(), archivedAt: z.string() }),
)

export const payrollSetParams = z.object({ setId: z.uuid('Parametre seti geçersiz.') })

export const payrollYearQuery = z.strictObject({
  year: z.coerce
    .number('Yılı seçin.')
    .int('Yılı seçin.')
    .min(PAYROLL_MIN_YEAR, `Yıl ${String(PAYROLL_MIN_YEAR)}'den önce olamaz.`)
    .max(PAYROLL_MAX_YEAR, `Yıl ${String(PAYROLL_MAX_YEAR)}'dan sonra olamaz.`)
    .describe('Tablo yılı'),
})

export const payrollEffectiveQuery = z.strictObject({
  date: daySchema
    .refine((day) => day >= PAYROLL_MIN_DATE, '2020 yılından önceki gün sorgulanamaz.')
    .describe('Geçerli setin sorulduğu gün (`YYYY-MM-DD`)'),
})
