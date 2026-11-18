import { z } from 'zod'

import {
  PAYROLL_ADJUSTMENT_ITEMS,
  PAYROLL_MAX_MONTH,
  PAYROLL_MIN_MONTH,
  PAYROLL_PERIOD_STATES,
  payrollMonthSchema,
} from '@kampus/school-core/lib/finance-payroll-periods.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Bordro dönemi şemaları (DOM-FIN-108; ON-200). Yalnız yöneticiye döner (K-359). */

const summarySchema = z.object({
  staffCount: z.number().int().describe('Ayda en az bir günü yürürlükte tanımı olan personel'),
  rateCount: z.number().int().describe('Ayla kesişen ücret tanımı sayısı'),
  monthlyGrossTotalCents: z
    .number()
    .int()
    .describe('Personel başına ayda son başlayan aylık brüt ana ücretin toplamı, kuruş'),
  adjustmentCount: z.number().int().describe('Bu aya aktarılan düzeltme sayısı'),
  adjustmentTotalCents: z.number().int().describe('Bu aya aktarılan düzeltmelerin toplamı, kuruş'),
  parameterSetId: z.string().nullable().describe('Ayın ilk günü geçerli bordro parametre seti'),
  parameterEffectiveFrom: z.string().nullable().describe('Geçerli setin yürürlük başlangıcı'),
  inputsHash: z.string().describe('Girdi damgası (SHA-256, onaltılık)'),
})

const periodSchema = z.object({
  month: z.string().describe('Bordro ayı (YYYY-AA)'),
  state: z
    .enum(PAYROLL_PERIOD_STATES)
    .describe('`open` açık, `approved` onaylı (kilitli), `reopened` yeniden açılmış'),
  version: z
    .number()
    .int()
    .nullable()
    .describe('Dönem kaydının sürümü (yeniden açmada `If-Match`); açık ayda boş'),
  approvedAt: z.string().nullable().describe('Son onay anı'),
  approvedByName: z.string().nullable().describe('Son onaylayan'),
  approvalCount: z.number().int().describe('Onay sayısı (yeniden açıp onaylamada artar)'),
  approved: summarySchema.nullable().describe('Son onay anının girdi özeti'),
  current: summarySchema
    .nullable()
    .describe(
      'Onaylanmamış, başlamış ayın güncel girdi özeti; onay isteği `current.inputsHash` taşır',
    ),
  reopenedAt: z.string().nullable(),
  reopenedByName: z.string().nullable(),
  reopenReason: z.string().nullable().describe('Son yeniden açma gerekçesi'),
  adjustmentCount: z.number().int().describe('Bu aydan çıkan iptal edilmemiş düzeltme sayısı'),
})

export const periodYearResponse = dataResponse(
  z.object({
    year: z.number().int(),
    currentMonth: z.string().describe('Bugünün ayı (Europe/Istanbul)'),
    lockedMonths: z.array(z.string()).describe('Kurumun bütün onaylı (kilitli) ayları, artan'),
    months: z.array(periodSchema).describe('Yılın 12 ayı'),
  }),
)
export const periodResponse = dataResponse(periodSchema)

const adjustmentSchema = z.object({
  id: z.string(),
  sourceMonth: z.string().describe('Düzeltilen (kilitli) ay'),
  targetMonth: z.string().describe('Farkın aktarılacağı ilk kilitsiz ay'),
  membershipId: z.string(),
  staffName: z.string(),
  item: z.enum(PAYROLL_ADJUSTMENT_ITEMS),
  // kvkk: K (ücret farkı)
  amountCents: z.number().int().describe('İşaretli fark, kuruş'),
  currency: z.literal('TRY'),
  reason: z.string(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int().describe('İptalde `If-Match` için sürüm'),
})
export const adjustmentResponse = dataResponse(adjustmentSchema)
export const adjustmentListResponse = z.object({
  data: z.array(adjustmentSchema),
  meta: pageMetaSchema,
})
export const adjustmentCancelResponse = dataResponse(
  z.object({ id: z.string(), archivedAt: z.string() }),
)

export const yearQuery = z.strictObject({
  year: z.coerce
    .number()
    .int()
    .min(Number(PAYROLL_MIN_MONTH.slice(0, 4)))
    .max(Number(PAYROLL_MAX_MONTH.slice(0, 4)))
    .optional()
    .describe('Yıl; varsayılan bu yıl (Europe/Istanbul)'),
})
export const adjustmentListQuery = z.strictObject({ ...pageQuerySchema.shape })

export const monthParams = z.object({
  month: payrollMonthSchema.describe('Bordro ayı (YYYY-AA)'),
})
export const adjustmentParams = z.object({
  adjustmentId: z.uuid('Düzeltme kaydı geçersiz.'),
})
