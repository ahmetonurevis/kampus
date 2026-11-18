import { z } from 'zod'

import {
  PAYROLL_EXPORT_FORMATS,
  PAYROLL_LINE_DIRECTIONS,
  PAYROLL_UNITS,
  PAYROLL_WARNINGS,
  payrollExportProfileSchema,
  payrollMonthSchema,
} from '@kampus/school-core/lib/finance-payroll-exports.ts'
import {
  BENEFIT_FORMS,
  LESSON_PAY_TYPES,
  PAY_RATE_COMPONENTS,
  PAY_RATE_TYPES,
} from '@kampus/school-core/lib/finance-pay-rates.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Bordro programına aktarım şemaları (DOM-FIN-105; ON-202). Yalnız yöneticiye döner (K-338). */

const lineSchema = z.object({
  key: z.string().describe('Satırın kimliği: `rate:<tanım>` ya da `hours:<saat kaydı>`'),
  month: z.string(),
  membershipId: z.string().describe('Personelin kurum üyeliği (dosyada "Personel no")'),
  staffName: z.string(),
  role: z.string().describe('Rol: `yonetici`, `ogretmen` ya da `onburo`'),
  staffActive: z.boolean().describe('Pasifleştirilmiş (ayrılan) personelde `false`'),
  component: z.enum(PAY_RATE_COMPONENTS),
  rateType: z.enum(PAY_RATE_TYPES),
  itemCode: z.string().describe('Kalem kodu `<bileşen>.<tür>`, ör. `wage.monthly_gross`'),
  direction: z
    .enum(PAYROLL_LINE_DIRECTIONS)
    .describe(
      '`earning` kazanç; `deduction` kesinti avans ve kesintiler (ON-199) için ayrılmıştır',
    ),
  unit: z.enum(PAYROLL_UNITS).describe('`month` aylık, `hour` saat, `lesson_hour` ders saati'),
  // kvkk: K (ücret)
  rateCents: z
    .number()
    .int()
    .nullable()
    .describe('Tanımın tutarı (birim ücret), kuruş; ek ders tanımı yoksa boş'),
  quantity: z.number().int().nullable().describe('Ek derste saat; diğerlerinde boş'),
  // kvkk: K (ücret)
  totalCents: z
    .number()
    .int()
    .nullable()
    .describe(
      'Tam ay aylık tutar ya da saat × birim ücret, kuruş; kısmi ay, saatlik ücret ve tanımsız ek derste boş (K-336)',
    ),
  taxable: z.boolean().nullable().describe('Yan hak vergiye tabi mi'),
  benefitForm: z.enum(BENEFIT_FORMS).nullable(),
  startDate: z.string().nullable().describe('Tanımın ay içindeki ilk günü (giriş); ek derste boş'),
  endDate: z.string().nullable().describe('Tanımın ay içindeki son günü (çıkış); ek derste boş'),
  days: z.number().int().nullable().describe('Ay içinde yürürlükte olduğu takvim günü'),
  monthDays: z.number().int().describe('Ayın takvim günü sayısı'),
  lessonHoursId: z.string().nullable().describe('Ek ders saati kaydı (düzeltme ve silme)'),
  lessonHoursVersion: z.number().int().nullable().describe('Ek ders saati kaydının sürümü'),
  note: z.string().nullable().describe('Ek ders saati kaydının notu; dosyaya girmez'),
  warnings: z.array(z.enum(PAYROLL_WARNINGS)).describe('Satır uyarı kodları'),
})

export const payrollPreviewResponse = dataResponse(
  z.object({
    month: z.string(),
    from: z.string().describe('Ayın ilk günü'),
    to: z.string().describe('Ayın son günü'),
    days: z.number().int(),
    lines: z.array(lineSchema),
    totals: z.object({
      lineCount: z.number().int(),
      staffCount: z.number().int(),
      earningCents: z.number().int().describe('Tutarı olan kazanç satırlarının toplamı, kuruş'),
      deductionCents: z.number().int().describe('Tutarı olan kesinti satırlarının toplamı, kuruş'),
      missingTotalCount: z.number().int().describe('Tutarı boş satır sayısı'),
    }),
  }),
)

export const payrollMonthQuery = z.strictObject({ month: payrollMonthSchema })
export const payrollExportBody = z.strictObject({ month: payrollMonthSchema })

export const payrollHistoryQuery = z.strictObject({
  ...pageQuerySchema.shape,
  month: payrollMonthSchema.optional(),
})
export const payrollHistoryResponse = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      month: z.string(),
      format: z
        .enum(PAYROLL_EXPORT_FORMATS)
        .describe('`standard` genel dosya, `profile` kurum şablonu'),
      lineCount: z.number().int(),
      staffCount: z.number().int(),
      earningCents: z.number().int(),
      deductionCents: z.number().int(),
      missingTotalCount: z.number().int(),
      contentSha256: z.string().describe('İndirilen dosyanın (BOM dahil) SHA-256 özeti'),
      createdByName: z.string().nullable().describe('Dosyayı üreten yönetici'),
      createdAt: z.string(),
    }),
  ),
  meta: pageMetaSchema,
})

const hoursSchema = z.object({
  id: z.string(),
  membershipId: z.string(),
  month: z.string(),
  lessonType: z.enum(LESSON_PAY_TYPES),
  hours: z.number().int(),
  note: z.string().nullable(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})
export const lessonHoursResponse = dataResponse(hoursSchema)
export const lessonHoursArchiveResponse = dataResponse(z.object({ id: z.string() }))
export const lessonHoursParams = z.object({ entryId: z.uuid('Ek ders saati kaydı geçersiz.') })

export const payrollProfileResponse = dataResponse(
  z.object({
    profile: payrollExportProfileSchema
      .nullable()
      .describe('Kurumun sütun eşleme şablonu; boşsa genel dosya iner'),
    version: z.number().int().describe('`If-Match` için şablon sürümü'),
  }),
)
