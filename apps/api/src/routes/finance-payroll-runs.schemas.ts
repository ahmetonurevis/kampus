import { z } from 'zod'

import { LESSON_SHEET_STATUSES } from '@kampus/school-core/lib/finance-lesson-hour-approvals.ts'
import { WAGE_TYPES } from '@kampus/school-core/lib/finance-pay-rates.ts'
import {
  PAYROLL_CALC_WARNINGS,
  PAYROLL_EARNING_KINDS,
  payrollCalcMonthSchema,
} from '@kampus/school-core/lib/finance-payroll-calc.ts'
import {
  MONTHLY_DEDUCTION_KINDS,
  MONTHLY_DEDUCTION_STATUSES,
} from '@kampus/school-core/lib/finance-staff-deductions.ts'

import { dataResponse } from './common.schemas.ts'

/** Bordro hesabı şemaları (DOM-FIN-115; ON-198). Yalnız yöneticiye döner (K-391). */

const cents = (description: string) => z.number().int().describe(`${description}, kuruş`)

export const payrollMonthParams = z.object({ month: payrollCalcMonthSchema })
export const carryoverParams = z.object({ carryoverId: z.uuid('Kayıt geçersiz.') })
export const carryoverListQuery = z.strictObject({
  year: z.coerce
    .number('Yılı girin.')
    .int('Yıl tam sayı olmalıdır.')
    .min(2020, 'Yıl 2020 ile 2099 arasında olmalıdır.')
    .max(2099, 'Yıl 2020 ile 2099 arasında olmalıdır.')
    .describe('Devir yılı'),
})

export const earningSchema = z.object({
  kind: z.enum(PAYROLL_EARNING_KINDS).describe('`wage`, `lesson`, `benefit`, `adjustment`'),
  code: z.string().describe('Ücret türü, ek ders türü, yan hak türü ya da düzeltme kalemi'),
  // kvkk: K (ücret)
  amountCents: cents('Tutar'),
  hours: z.number().int().nullable().describe('Ek derste saat'),
  rateCents: z.number().int().nullable().describe('Ek derste birim ücret, kuruş'),
  sgk: z.boolean().describe('SGK prime esas kazanca girer'),
  taxable: z.boolean().describe('Gelir ve damga vergisi matrahına girer'),
})

const deductionLineSchema = z.object({
  order: z.number().int(),
  kind: z.enum(MONTHLY_DEDUCTION_KINDS),
  sourceId: z.string().describe('Avans, icra ya da BES kaydının kimliği'),
  requestedCents: z.number().int().nullable(),
  amountCents: z.number().int().nullable(),
  status: z.enum(MONTHLY_DEDUCTION_STATUSES),
})

/** Personel satırı (school-core `PayrollCalcRow`). */
export const payrollCalcRowSchema = z.object({
  membershipId: z.string(),
  // kvkk: K
  name: z.string(),
  role: z.string().describe('Rol: `yonetici`, `ogretmen` ya da `onburo`'),
  active: z.boolean(),
  complete: z
    .boolean()
    .describe('Satır hesaplandı mı; saatlik ücret ya da ücret tanımı yoksa `false` (kayda girmez)'),
  entryDate: z.string().nullable(),
  exitDate: z.string().nullable(),
  primDays: z.number().int(),
  missingDays: z.number().int(),
  // kvkk: Ö (özet; tanı yok)
  medicalReportDays: z.number().int().describe('Aya düşen sağlık raporu günü (DOM-FIN-110)'),
  wageType: z.enum(WAGE_TYPES).nullable(),
  // kvkk: K
  netTargetCents: z.number().int().nullable().describe('Net tanımlı ücrette ayın hedef neti'),
  netDifferenceCents: z.number().int().nullable().describe('Ters hesaptan kalan kuruş farkı'),
  earnings: z.array(earningSchema),
  // kvkk: K (ücret)
  grossCents: cents('Brüt (SGK matrahına giren kalemler)'),
  sgkFloorCents: cents('Gün oranlı SGK tabanı'),
  sgkCeilingCents: cents('Gün oranlı SGK tavanı'),
  sgkBaseCents: cents('SGK prime esas kazanç'),
  sgkEmployeeCents: cents('SGK işçi payı'),
  unemploymentEmployeeCents: cents('İşsizlik sigortası işçi payı'),
  incomeTaxBaseCents: cents('Ayın gelir vergisi matrahı'),
  cumulativeIncomeTaxBaseBeforeCents: cents('Önceki kümülatif GV matrahı (kayıtlı aylar + devir)'),
  incomeTaxCents: cents('Hesaplanan gelir vergisi'),
  incomeTaxExemptionCents: cents('Asgari ücret gelir vergisi istisnası'),
  incomeTaxPayableCents: cents('Ödenecek gelir vergisi'),
  stampTaxBaseCents: cents('Damga vergisi matrahı'),
  stampTaxCents: cents('Hesaplanan damga vergisi'),
  stampTaxExemptionCents: cents('Asgari ücret damga vergisi istisnası'),
  stampTaxPayableCents: cents('Ödenecek damga vergisi'),
  netCents: cents('Net ücret (kesintilerden önce)'),
  netAdjustmentCents: cents('Kesinti kalemli düzeltmelerin işaretli toplamı'),
  deductions: z.array(deductionLineSchema).describe('Kesintiler (DOM-FIN-101 sırası)'),
  deductionCents: cents('Kesinti toplamı'),
  payableCents: cents('Ödenecek net'),
  sgkEmployerCents: cents('SGK işveren payı (prim indirimi düşülmüş)'),
  unemploymentEmployerCents: cents('İşsizlik sigortası işveren payı'),
  inKindBenefitsCents: cents('Ayni yan haklar (ödenmez, maliyete girer)'),
  employerCostCents: cents('İşveren maliyeti'),
  warnings: z.array(z.enum(PAYROLL_CALC_WARNINGS)).describe('Uyarı kodları'),
})

const totalsSchema = z.object({
  staffCount: z.number().int(),
  completeCount: z.number().int(),
  incompleteCount: z.number().int(),
  grossCents: z.number().int(),
  sgkEmployeeCents: z.number().int(),
  unemploymentEmployeeCents: z.number().int(),
  incomeTaxPayableCents: z.number().int(),
  stampTaxPayableCents: z.number().int(),
  netCents: z.number().int(),
  deductionCents: z.number().int(),
  payableCents: z.number().int(),
  sgkEmployerCents: z.number().int(),
  unemploymentEmployerCents: z.number().int(),
  employerCostCents: z.number().int(),
})

const savedSummarySchema = z.object({
  id: z.uuid(),
  revision: z.number().int().describe('Ayın kaçıncı hesabı'),
  version: z.number().int(),
  calculatedAt: z.string(),
  // kvkk: K
  calculatedByName: z.string().nullable(),
  staffCount: z.number().int(),
  skippedCount: z.number().int(),
  payableTotalCents: z.number().int(),
})

export const payrollCalculationResponse = dataResponse(
  z.object({
    month: z.string(),
    locked: z.boolean().describe('Ay onaylı (kilitli) mı; kilitliyse kaydetme 409'),
    parameters: z.object({
      setId: z.string(),
      origin: z.enum(['platform', 'institution']),
      effectiveFrom: z.string(),
      stale: z.boolean().describe('Ayın yılı için set yok, son bilinen set kullanıldı'),
      unverified: z.boolean().describe('Platform setinde doğrulanmamış alan var'),
      minimumWageGrossCents: z.number().int(),
      minimumWageBaseBeforeCents: z
        .number()
        .int()
        .describe('Asgari ücretin yıl başından önceki aylara kümülatif GV matrahı'),
    }),
    lessonSheet: z
      .object({
        status: z
          .enum(LESSON_SHEET_STATUSES)
          .describe('Ayın ek ders çizelgesi: `draft`, `teacher_review`, `approved` (DOM-FIN-120)'),
        pendingStaffCount: z
          .number()
          .int()
          .describe('Müdür onayı beklediği için ek dersi hesaba girmeyen personel sayısı (K-423)'),
        pendingHours: z
          .number()
          .int()
          .describe('Müdür onayı beklediği için hesaba girmeyen toplam ek ders saati (K-423)'),
      })
      .describe('Ek ders çizelgesi; hesaba yalnız müdür onaylı çizelgenin saatleri girer'),
    rows: z.array(payrollCalcRowSchema),
    totals: totalsSchema,
    saved: savedSummarySchema.nullable().describe('Ayın etkin kayıtlı hesabı; yoksa `null`'),
  }),
)

export const payrollRunResponse = dataResponse(
  savedSummarySchema.extend({
    month: z.string(),
    locked: z.boolean(),
    parameterSetId: z.string(),
    parameterEffectiveFrom: z.string(),
    rows: z.array(payrollCalcRowSchema),
    totals: totalsSchema,
  }),
)

export const payrollRunSaveResponse = dataResponse(z.object({ id: z.uuid(), month: z.string() }))

const carryoverSchema = z.object({
  id: z.uuid(),
  membershipId: z.string(),
  // kvkk: K
  staffName: z.string(),
  year: z.number().int(),
  // kvkk: K (ücret)
  incomeTaxBaseCents: z.number().int(),
  note: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü (kaldırma)'),
})
export const carryoverResponse = dataResponse(carryoverSchema)
export const carryoverListResponse = dataResponse(z.array(carryoverSchema))
export const carryoverArchiveResponse = dataResponse(
  z.object({ id: z.uuid(), archivedAt: z.string() }),
)
