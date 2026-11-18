import { z } from 'zod'

import { PAYROLL_ADJUSTMENT_ITEMS } from '@kampus/school-core/lib/finance-payroll-periods.ts'
import {
  PAYROLL_DEDUCTION_BASES,
  PAYROLL_EXPORT_FORMATS,
  PAYROLL_LINE_DIRECTIONS,
  PAYROLL_LINE_KINDS,
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
import { MONTHLY_DEDUCTION_KINDS } from '@kampus/school-core/lib/finance-staff-deductions.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Bordro programına aktarım şemaları (DOM-FIN-105; ON-202, ON-343). Yalnız yöneticiye döner
 * (K-338).
 */

const lineSchema = z.object({
  key: z
    .string()
    .describe(
      'Satırın kimliği: `rate:<tanım>`, `hours:<saat kaydı>`, `deduction:<tür>:<kayıt>` ya da `adjustment:<düzeltme>`',
    ),
  kind: z
    .enum(PAYROLL_LINE_KINDS)
    .describe(
      '`rate` ücret tanımı, `lesson_hours` ek ders saati, `deduction` avans ya da kesinti (DOM-FIN-101), `adjustment` kilitli aydan aktarılan düzeltme (DOM-FIN-108)',
    ),
  month: z.string(),
  membershipId: z.string().describe('Personelin kurum üyeliği (dosyada "Personel no")'),
  staffName: z.string(),
  role: z.string().describe('Rol: `yonetici`, `ogretmen` ya da `onburo`'),
  staffActive: z.boolean().describe('Pasifleştirilmiş (ayrılan) personelde `false`'),
  component: z
    .enum(PAY_RATE_COMPONENTS)
    .nullable()
    .describe('Ücret tanımı ve ek derste bileşen; kesinti ve düzeltmede boş'),
  rateType: z
    .enum(PAY_RATE_TYPES)
    .nullable()
    .describe('Ücret tanımı ve ek derste tür; kesinti ve düzeltmede boş'),
  itemCode: z
    .string()
    .describe(
      'Kalem kodu: `<bileşen>.<tür>` (`wage.monthly_gross`), `deduction.<tür>` (`deduction.advance`) ya da `adjustment.<kalem>` (`adjustment.lesson`)',
    ),
  direction: z
    .enum(PAYROLL_LINE_DIRECTIONS)
    .describe('`earning` kazanç; `deduction` kesinti (avans, icra, BES ve eksi düzeltme)'),
  unit: z
    .enum(PAYROLL_UNITS)
    .describe('`month` aylık, `hour` saat, `lesson_hour` ders saati, `once` tek sefer (düzeltme)'),
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
      'Tam ay aylık tutar, saat × birim ücret, avans taksiti ya da düzeltmenin mutlak tutarı, kuruş; kısmi ay, saatlik ücret, tanımsız ek ders, icra ve BES satırında boş (K-336, K-392)',
    ),
  deductionKind: z
    .enum(MONTHLY_DEDUCTION_KINDS)
    .nullable()
    .describe('Kesinti türü: `advance` avans taksiti, `garnishment` icra, `pension` BES'),
  deductionOrder: z
    .number()
    .int()
    .nullable()
    .describe('Personelin ayki kesinti sırası (1’den; avans, nafaka, sıradaki icra, BES)'),
  rateBasisPoints: z.number().int().nullable().describe('İcra ve BES oranı, onbinde (2500 = %25)'),
  deductionBase: z
    .enum(PAYROLL_DEDUCTION_BASES)
    .nullable()
    .describe('Oranlı kesintinin matrahı: `net_wage` net ücret (icra), `pension_base` BES matrahı'),
  // kvkk: Ç (icra alacağı)
  capCents: z
    .number()
    .int()
    .nullable()
    .describe('İcrada kalan alacak, kuruş; kesintinin üst sınırı'),
  installmentNo: z.number().int().nullable().describe('Avans taksitinin sırası'),
  installmentCount: z.number().int().nullable().describe('Avansın taksit sayısı'),
  adjustmentItem: z
    .enum(PAYROLL_ADJUSTMENT_ITEMS)
    .nullable()
    .describe('Düzeltme kalemi (DOM-FIN-108)'),
  sourceMonth: z.string().nullable().describe('Düzeltmenin ait olduğu (kilitli) ay, YYYY-AA'),
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
      deductionCents: z
        .number()
        .int()
        .describe('Tutarı olan kesinti satırlarının (avans taksiti, eksi düzeltme) toplamı, kuruş'),
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
