import { z } from 'zod'

import { COST_CENTER_TYPES } from '@kampus/school-core/lib/finance-cost-centers.ts'
import { STAFF_COST_FLAGS } from '@kampus/school-core/lib/finance-staff-cost-report.ts'
import {
  staffCostMonthSchema,
  staffCostRangeIssue,
} from '@kampus/school-core/lib/finance-staff-costs.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Personel maliyet ataması ve raporu şemaları (DOM-FIN-104; ON-204). Yalnız yöneticiye döner (K-334). */

const allocationSchema = z.object({
  id: z.string(),
  membershipId: z.string(),
  startMonth: z.string().describe('Yürürlük başlangıç ayı (YYYY-MM)'),
  endMonth: z
    .string()
    .nullable()
    .describe('Son ay (YYYY-MM): sonraki atamanın başlangıcından bir önceki ay; yoksa süresiz'),
  shares: z.array(
    z.object({
      costCenterId: z.string(),
      code: z.string(),
      name: z.string(),
      isActive: z.boolean().describe('Merkez bugün etkin mi'),
      shareBasisPoints: z.number().int().describe('Pay, on binde bir'),
    }),
  ),
  wageHours: z.number().int().nullable().describe('Saatli ana ücretin tahmini aylık saati'),
  extraLessonHours: z.number().int().nullable().describe('Tahmini aylık ek ders saati'),
  dutyHours: z.number().int().nullable().describe('Tahmini aylık nöbet saati'),
  createdAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü (iptal)'),
})

export const allocationResponse = dataResponse(allocationSchema)
export const allocationCancelResponse = dataResponse(z.object({ id: z.string() }))

const staffRowSchema = z.object({
  membershipId: z.string(),
  name: z.string(),
  role: z.string().describe('Rol: `yonetici`, `ogretmen` ya da `onburo`'),
  active: z.boolean().describe('Pasifleştirilmiş (ayrılan) personelde `false`'),
  allocation: allocationSchema.nullable().describe('`month` ayındaki atama; yoksa boş'),
  allocationCount: z.number().int().describe('İptal edilmemiş atama sayısı'),
})
export const staffListResponse = z.object({ data: z.array(staffRowSchema), meta: pageMetaSchema })

export const staffDetailResponse = dataResponse(
  z.object({
    membershipId: z.string(),
    name: z.string(),
    role: z.string(),
    active: z.boolean(),
    month: z.string().describe('Bugünün ayı (YYYY-MM)'),
    currentId: z.string().nullable().describe('Bu ay yürürlükteki atama'),
    allocations: z.array(allocationSchema).describe('İptal edilmemiş atamalar, başlangıca göre'),
  }),
)

export const staffListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Personel adında arama'),
  status: z
    .enum(['active', 'passive'])
    .optional()
    .describe('`active` etkin, `passive` pasifleştirilmiş (ayrılan) personel'),
  month: staffCostMonthSchema
    .optional()
    .describe('Atamanın gösterileceği ay (YYYY-MM); varsayılan bu ay (Europe/Istanbul)'),
})

export const staffParams = z.object({
  membershipId: z.string().trim().min(1).max(100).describe('Personelin kurum üyeliği'),
})
export const allocationParams = z.object({ allocationId: z.uuid('Atama geçersiz.') })

export const staffCostQuery = z
  .strictObject({
    from: staffCostMonthSchema
      .optional()
      .describe('Başlangıç ayı (YYYY-MM); varsayılan `to` ya da bu ay'),
    to: staffCostMonthSchema.optional().describe('Bitiş ayı (YYYY-MM, dahil); varsayılan `from`'),
    people: z
      .enum(['true', 'false'])
      .optional()
      .describe('`true` kişi satırlarını verir ve küçük grup bastırmasını kaldırır (K-334)'),
  })
  .superRefine((value, context) => {
    if (value.from === undefined || value.to === undefined) return
    const issue = staffCostRangeIssue(value.from, value.to)
    if (issue !== null) context.addIssue({ code: 'custom', path: ['to'], message: issue })
  })

const cents = (description: string) => z.number().int().describe(description)
const hiddenCents = (description: string) =>
  z.number().int().nullable().describe(`${description}; küçük grupta boş`)
const amountFields = {
  grossCents: cents('Tahmini brüt ücret (ana ücret ve ek ders), kuruş'),
  employerSgkCents: cents('SGK işveren payı (prim indirimi düşülmüş, tavanlı)'),
  unemploymentCents: cents('İşsizlik sigortası işveren payı (tavanlı)'),
  benefitsCents: cents('Yan haklar'),
  totalCents: cents('Tahmini toplam işveren maliyeti'),
}

export const staffCostResponse = dataResponse(
  z.object({
    from: z.string(),
    to: z.string(),
    people: z.boolean(),
    minGroupSize: z.number().int().describe('Tutarların gösterildiği en küçük personel grubu'),
    centers: z.array(
      z.object({
        id: z.string().nullable().describe('Atanmamış satırında boş'),
        code: z.string().nullable(),
        name: z.string(),
        type: z.enum(COST_CENTER_TYPES).nullable(),
        path: z.string().nullable().describe('Kökten merkeze kod yolu'),
        isActive: z.boolean(),
        staffCount: z.number().int().describe('Dönemde merkeze payı düşen farklı personel'),
        grossCents: hiddenCents('Brüt'),
        employerSgkCents: hiddenCents('SGK işveren payı'),
        unemploymentCents: hiddenCents('İşsizlik işveren payı'),
        benefitsCents: hiddenCents('Yan haklar'),
        totalCents: hiddenCents('Toplam'),
        suppressed: z.boolean().describe('Küçük grup: tutarlar gizlendi'),
      }),
    ),
    persons: z
      .array(
        z.object({
          membershipId: z.string(),
          name: z.string(),
          role: z.string(),
          centerId: z.string().nullable(),
          centerName: z.string(),
          shareBasisPoints: z
            .number()
            .int()
            .nullable()
            .describe('Dönem boyunca aynı pay; değiştiyse boş'),
          monthCount: z.number().int(),
          flags: z.array(z.enum(STAFF_COST_FLAGS)),
          ...amountFields,
        }),
      )
      .nullable()
      .describe('Kişi satırları; yalnız `people=true` iken'),
    months: z.array(
      z.object({
        month: z.string(),
        staffCount: z.number().int(),
        ...amountFields,
        parameterSetId: z.string(),
        parameterOrigin: z.enum(['platform', 'institution']),
        stale: z.boolean(),
      }),
    ),
    totals: z.object({ ...amountFields, staffCount: z.number().int() }),
    warnings: z.object({
      netWageStaffCount: z.number().int(),
      missingHoursStaffCount: z.number().int(),
      assignedWithoutRateCount: z.number().int(),
      unassignedStaffCount: z.number().int(),
      staleMonths: z.array(z.string()),
      unverifiedParameters: z.boolean(),
    }),
  }),
)
