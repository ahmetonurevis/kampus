import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  ALLERGENS,
  MEAL_KINDS,
  MEAL_MENU_STATUSES,
} from '@kampus/school-core/lib/finance-meal-menus.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Yemek menüsü, besin değeri ve alerjen şemaları (DOM-FIN-157; ON-090, ON-149; K-526…K-528). */

const nutritionSchema = z
  .object({
    energyKcal: z.number().int().describe('Enerji (kcal)'),
    proteinDg: z.number().int().describe('Protein (gramın onda biri)'),
    fatDg: z.number().int().describe('Yağ (gramın onda biri)'),
    carbohydrateDg: z.number().int().describe('Karbonhidrat (gramın onda biri)'),
    fiberDg: z.number().int().nullable().describe('Lif (gramın onda biri); bilinmiyorsa `null`'),
    saltDg: z.number().int().nullable().describe('Tuz (gramın onda biri); bilinmiyorsa `null`'),
  })
  .nullable()
  .describe('Porsiyon besin değeri; girilmemişse `null`')

const itemSchema = z.object({
  id: z.string(),
  position: z.number().int().describe('Öğündeki sıra (0 tabanlı)'),
  name: z.string(),
  allergens: z.array(z.enum(ALLERGENS)).describe('Alerjen işaretleri, yönetmelik sırasıyla'),
  nutrition: nutritionSchema,
})

const totalsSchema = z
  .object({
    itemCount: z.number().int(),
    missingNutrition: z.number().int().describe('Besin değeri girilmemiş kalem sayısı'),
    energyKcal: z.number().int(),
    proteinDg: z.number().int(),
    fatDg: z.number().int(),
    carbohydrateDg: z.number().int(),
    fiberDg: z.number().int(),
    missingFiber: z.number().int().describe('Lif değeri bilinmeyen kalem sayısı'),
    saltDg: z.number().int(),
    missingSalt: z.number().int().describe('Tuz değeri bilinmeyen kalem sayısı'),
  })
  .describe('Günlük toplam (sunucuda core `mealDayTotals` ile hesaplanır, saklanmaz)')

const daySchemaOut = z.object({
  menuDate: z.string().describe('Gün (YYYY-MM-DD)'),
  meals: z
    .array(z.object({ mealKind: z.enum(MEAL_KINDS), items: z.array(itemSchema) }))
    .describe('Kalemi olan öğünler, kahvaltı → öğle → ikindi'),
  totals: totalsSchema,
})

const menuBase = {
  id: z.string(),
  weekStart: z.string().describe('Haftanın pazartesisi (YYYY-MM-DD)'),
  weekEnd: z.string().describe('Haftanın pazarı (YYYY-MM-DD)'),
  branchId: z.string().nullable().describe('Kampüs; `null` bütün kampüsler'),
  branchName: z.string().nullable(),
  status: z.enum(MEAL_MENU_STATUSES).describe('`draft` taslak, `published` yayımlandı'),
  publishedAt: z.string().nullable().describe('Son yayım anı (ISO 8601)'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
}

export const mealMenuRowSchema = z.object({
  ...menuBase,
  itemCount: z.number().int().describe('Etkin kalem sayısı'),
  dayCount: z.number().int().describe('Kalemi olan gün sayısı'),
})

export const mealMenuDetailSchema = z.object({
  ...menuBase,
  days: z.array(daySchemaOut).describe('Haftanın yedi günü, pazartesiden'),
  corrections: z
    .array(
      z.object({
        id: z.string(),
        menuDate: z.string(),
        mealKind: z.enum(MEAL_KINDS),
        // kvkk: K — serbest metin; yalnız yönetici ve ön büroya döner.
        reason: z.string(),
        correctedAt: z.string().describe('Düzeltme anı (ISO 8601)'),
      }),
    )
    .describe('Geçmiş gün düzeltmeleri, yeni önce'),
})

export const myMealMenusSchema = z.object({
  weekStart: z.string(),
  weekEnd: z.string(),
  menus: z
    .array(
      z.object({
        id: z.string(),
        branchId: z.string().nullable(),
        branchName: z.string().nullable(),
        publishedAt: z.string().nullable(),
        // kvkk: K (öğrenci adı)
        students: z
          .array(z.object({ studentId: z.string(), studentName: z.string() }))
          .describe('Bu menüyü gören kapsamdaki öğrenciler'),
        days: z.array(daySchemaOut),
      }),
    )
    .describe(
      'Kampüs başına yayımlanmış menü (kampüsün kendi menüsü, yoksa bütün kampüsler); yoksa boş',
    ),
})

export const mealSettingsSchema = z.object({
  mealKinds: z.array(z.enum(MEAL_KINDS)).describe('Kurumun kullandığı öğünler, gösterim sırasıyla'),
  version: z.number().int().describe('`If-Match` için ayar sürümü (hiç kaydedilmediyse 1)'),
})

export const mealMenuResponse = dataResponse(mealMenuDetailSchema)
export const mealMenuListResponse = z.object({
  data: z.array(mealMenuRowSchema),
  meta: pageMetaSchema,
})
export const mealMenuArchivedResponse = dataResponse(z.object({ id: z.string() }))
export const myMealMenusResponse = dataResponse(myMealMenusSchema)
export const mealSettingsResponse = dataResponse(mealSettingsSchema)

export const mealMenuListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  status: z.enum(MEAL_MENU_STATUSES).optional().describe('Durum süzgeci'),
  branchId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe('Kampüs süzgeci; `all` yalnız bütün kampüs menüleri'),
  from: daySchema.optional().describe('Bu günden başlayan ve sonraki haftalar (YYYY-MM-DD)'),
})

export const myMealMenusQuery = z.strictObject({
  weekStart: daySchema
    .optional()
    .describe('Haftanın herhangi bir günü (YYYY-MM-DD); verilmezse bu hafta (Europe/Istanbul)'),
})

export const mealMenuParams = z.object({ menuId: z.uuid('Menü geçersiz.') })
