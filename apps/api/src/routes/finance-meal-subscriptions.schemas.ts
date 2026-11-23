import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import { MEAL_KINDS } from '@kampus/school-core/lib/finance-meal-menus.ts'
import {
  MEAL_CANCELLED_BY,
  MEAL_DAY_STATUSES,
  MEAL_DIET_TYPES,
  MEAL_SUBSCRIPTION_STATUSES,
  mealMonthSchema,
} from '@kampus/school-core/lib/finance-meal-subscriptions.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Yemek aboneliği, gün iptali, günlük sayım ve aylık özet şemaları (DOM-FIN-164; K-547…K-549). */

const cutoffSchema = z
  .object({
    cutoffDaysBefore: z.number().int().describe('Kesim yemek gününden kaç gün önce (0 aynı gün)'),
    cutoffTime: z.string().describe('Kesim saati (SS:DD, Europe/Istanbul)'),
  })
  .describe('Gün iptali kesimi')

const cancellationSchema = z.object({
  id: z.string(),
  mealDate: z.string().describe('İptal edilen gün (YYYY-MM-DD)'),
  late: z.boolean().describe('Kesimden sonra okulun iptali; iade/mahsup gününe girmez'),
  cancelledBy: z.enum(MEAL_CANCELLED_BY).describe('`family` veli, `school` okul'),
  cancelledAt: z.string().describe('İptal anı (ISO 8601)'),
  version: z.number().int().describe('Geri alma için `If-Match` sürümü'),
})

const daySchemaOut = z.object({
  mealDate: z.string().describe('Yemek günü (YYYY-MM-DD)'),
  status: z
    .enum(MEAL_DAY_STATUSES)
    .describe(
      '`scheduled` yemek var, `cancelled` iptal, `late_cancelled` geç iptal, `holiday` tatil',
    ),
  holidayTitle: z.string().nullable().describe('Okul takvimindeki tatilin adı'),
  deadline: z.string().describe('İptalin son anı (kesim, ISO 8601)'),
  canCancel: z.boolean().describe('İsteği yapan bu günü iptal edebilir mi'),
  canRestore: z.boolean().describe('İsteği yapan bu günün iptalini geri alabilir mi'),
  cancellation: cancellationSchema.nullable(),
})

const subscriptionBase = {
  id: z.string(),
  studentId: z.string(),
  // kvkk: Ç (öğrenci adı)
  studentName: z.string(),
  mealKind: z.enum(MEAL_KINDS),
  startDate: z.string().describe('İlk yemek günü (YYYY-MM-DD)'),
  endDate: z.string().describe('Son yemek günü (YYYY-MM-DD, dahil)'),
  weekdays: z.array(z.number().int()).describe('Yemek günleri (1 pazartesi … 7 pazar)'),
  // kvkk: Ç
  dietType: z.enum(MEAL_DIET_TYPES),
  // kvkk: Ç — yalnız "diğer" diyette dolu; yönetici, ön büro ve veliye döner.
  dietNote: z.string().nullable(),
  status: z
    .enum(MEAL_SUBSCRIPTION_STATUSES)
    .describe('`upcoming` başlamadı, `active` sürüyor, `ended` bitti (bugüne göre)'),
}

export const mealSubscriptionRowSchema = z.object({
  ...subscriptionBase,
  classId: z.string().nullable(),
  className: z.string().nullable(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

export const mealSubscriptionDetailSchema = mealSubscriptionRowSchema.extend({
  cutoff: cutoffSchema,
  days: z.array(daySchemaOut).describe('Bugünden 28 günlük yemek takvimi (yalnız yemek günleri)'),
  cancellations: z.array(cancellationSchema).describe('Etkin iptaller, yeni gün önce'),
})

export const myMealSubscriptionsSchema = z.object({
  today: z.string().describe('Bugün (YYYY-MM-DD, Europe/Istanbul)'),
  cutoff: cutoffSchema,
  subscriptions: z
    .array(z.object({ ...subscriptionBase, days: z.array(daySchemaOut) }))
    .describe('Kapsamdaki öğrencilerin sürmekte ve başlamamış abonelikleri'),
})

export const mealCancellationsCreatedSchema = z.object({
  subscriptionId: z.string(),
  cancellations: z.array(cancellationSchema),
})

const dietCountsSchema = z
  .array(z.object({ dietType: z.enum(MEAL_DIET_TYPES), count: z.number().int() }))
  .describe('Diyet türü başına yemek sayısı (beş tür, sıfırlar dahil)')

export const mealDailyCountSchema = z.object({
  date: z.string(),
  holidayTitle: z
    .string()
    .nullable()
    .describe('Gün okul takviminde kurum tatiliyse adı; sayılar sıfır'),
  meals: z
    .array(
      z.object({
        mealKind: z.enum(MEAL_KINDS),
        total: z.number().int().describe('Yemek verilecek öğrenci (iptaller düşülmüş)'),
        cancelled: z.number().int().describe('Kesimden önce iptal'),
        lateCancelled: z.number().int().describe('Kesimden sonra okulun iptali'),
        diets: dietCountsSchema,
      }),
    )
    .describe('Öğün başına sayım (kurumun açık öğünleri ve aboneliği olan öğünler)'),
  classes: z
    .array(
      z.object({
        classId: z.string().nullable().describe('Sınıf; sınıfsız öğrenci `null`'),
        className: z.string().nullable(),
        meals: z.array(
          z.object({
            mealKind: z.enum(MEAL_KINDS),
            total: z.number().int(),
            diets: dietCountsSchema,
          }),
        ),
      }),
    )
    .describe('Sınıf kırılımı; yalnız yemeği olan sınıflar'),
})

export const mealMonthlyRowSchema = z.object({
  subscriptionId: z.string(),
  studentId: z.string(),
  // kvkk: Ç (öğrenci adı)
  studentName: z.string(),
  classId: z.string().nullable(),
  className: z.string().nullable(),
  mealKind: z.enum(MEAL_KINDS),
  dietType: z.enum(MEAL_DIET_TYPES),
  subscribedDays: z.number().int().describe('Ayda yemek günü (tatil hariç; gelecek günler planlı)'),
  holidayDays: z.number().int().describe('Yemek gününe denk gelen kurum tatili'),
  cancelledDays: z.number().int().describe('Kesimden önce iptal edilen gün'),
  lateCancelledDays: z.number().int().describe('Kesimden sonra okulun iptal ettiği gün'),
  mealDays: z.number().int().describe('Yemek verilen ya da verilecek gün'),
  refundableDays: z
    .number()
    .int()
    .describe('İade ya da mahsup için gün sayısı (= kesimden önce iptal); tutar ON-087 ile'),
})

export const mealCutoffSettingsSchema = cutoffSchema.extend({
  version: z.number().int().describe('`If-Match` için ayar sürümü (hiç kaydedilmediyse 1)'),
})

export const mealSubscriptionResponse = dataResponse(mealSubscriptionDetailSchema)
export const mealSubscriptionListResponse = z.object({
  data: z.array(mealSubscriptionRowSchema),
  meta: pageMetaSchema,
})
export const mealSubscriptionArchivedResponse = dataResponse(z.object({ id: z.string() }))
export const myMealSubscriptionsResponse = dataResponse(myMealSubscriptionsSchema)
export const mealCancellationsResponse = dataResponse(mealCancellationsCreatedSchema)
export const mealCancellationRestoredResponse = dataResponse(z.object({ id: z.string() }))
export const mealDailyCountResponse = dataResponse(mealDailyCountSchema)
export const mealMonthlySummaryResponse = z.object({
  data: z.array(mealMonthlyRowSchema),
  meta: pageMetaSchema,
})
export const mealCutoffSettingsResponse = dataResponse(mealCutoffSettingsSchema)

const searchSchema = z
  .string()
  .trim()
  .min(2, 'En az 2 karakter yazın.')
  .max(100)
  .optional()
  .describe('Öğrenci adında arama (en az 2 karakter)')
const classIdSchema = z.string().trim().min(1).max(100).optional().describe('Sınıf süzgeci')

export const mealSubscriptionListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: searchSchema,
  status: z.enum(MEAL_SUBSCRIPTION_STATUSES).optional().describe('Durum süzgeci (bugüne göre)'),
  mealKind: z.enum(MEAL_KINDS).optional().describe('Öğün süzgeci'),
  dietType: z.enum(MEAL_DIET_TYPES).optional().describe('Diyet türü süzgeci'),
  classId: classIdSchema,
})

export const mealDailyCountQuery = z.strictObject({
  date: daySchema.optional().describe('Gün (YYYY-MM-DD); verilmezse bugün (Europe/Istanbul)'),
})

export const mealMonthlySummaryQuery = z.strictObject({
  ...pageQuerySchema.shape,
  month: mealMonthSchema.optional().describe('Ay (YYYY-AA); verilmezse bu ay'),
  q: searchSchema,
  mealKind: z.enum(MEAL_KINDS).optional().describe('Öğün süzgeci'),
  classId: classIdSchema,
})

export const mealSubscriptionParams = z.object({
  subscriptionId: z.uuid('Abonelik geçersiz.'),
})
export const mealCancellationParams = z.object({
  subscriptionId: z.uuid('Abonelik geçersiz.'),
  cancellationId: z.uuid('İptal geçersiz.'),
})
