import { z } from 'zod'

import type {
  MealMenuDay,
  MealMenuDetail,
  MealMenuItem,
  MealMenuRow,
  MealMenuUpdateBody,
} from '@kampus/react-shared/use-finance-meal-menus.ts'
import {
  ALLERGEN_LABELS,
  ALLERGENS,
  decigramText,
  isoWeekday,
  MEAL_CORRECTION_REASON_MAX,
  MEAL_CORRECTION_REASON_MIN,
  MEAL_ENERGY_MAX_KCAL,
  MEAL_GRAMS_MAX_DG,
  MEAL_ITEM_NAME_MAX,
  MEAL_ITEMS_PER_SLOT_MAX,
  MEAL_KIND_LABELS,
  MEAL_KINDS,
  MEAL_MENU_STATUS_LABELS,
  MEAL_SALT_MAX_DG,
  mealWeekStartOf,
  orderedMealKinds,
  parseDecigrams,
  type Allergen,
  type MealKind,
  type MealMenuStatus,
} from '@kampus/school-core/lib/finance-meal-menus.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'

/**
 * Yemek menüsü sekmesinin saf mantığı (DOM-FIN-157; ON-090, ON-149; K-526…K-528): hücre formunun
 * şeması, gövdesi, gün ve toplam metinleri. Kural ayrıntısı sunucudadır; gramlar formda ondalık
 * (`12,5`) yazılır, API'ye gramın onda biri tamsayısıyla gider.
 */

const WEEKDAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']

export const weekdayText = (day: string) => WEEKDAYS[isoWeekday(day) - 1] ?? ''
/** `Pazartesi 5 Eki`. */
export const dayHeading = (day: string) =>
  `${weekdayText(day)} ${dateLabel(`${day}T09:00:00.000Z`)}`
/** `5 Eki – 11 Eki 2026`. */
export const weekText = (row: Pick<MealMenuRow, 'weekStart' | 'weekEnd'>) =>
  `${dateLabel(`${row.weekStart}T09:00:00.000Z`)} – ${dateLabel(`${row.weekEnd}T09:00:00.000Z`, { year: 'numeric' })}`
export const branchText = (row: Pick<MealMenuRow, 'branchName' | 'branchId'>) =>
  row.branchId === null ? 'Bütün kampüsler' : (row.branchName ?? '—')
export const statusText = (status: MealMenuStatus) => MEAL_MENU_STATUS_LABELS[status]
export const mealKindText = (kind: MealKind) => MEAL_KIND_LABELS[kind]
export const allergensText = (allergens: readonly Allergen[]) =>
  allergens.length === 0
    ? 'İşaretli alerjen yok'
    : allergens.map((a) => ALLERGEN_LABELS[a]).join(', ')

/** Izgaradaki öğün satırları: kurumun açık öğünleri ve kalemi kalmış kapalı öğünler. */
export function gridMealKinds(
  enabled: readonly MealKind[],
  days: readonly Pick<MealMenuDay, 'meals'>[],
): MealKind[] {
  const used = new Set(days.flatMap((day) => day.meals.map((meal) => meal.mealKind)))
  return orderedMealKinds(MEAL_KINDS.filter((kind) => enabled.includes(kind) || used.has(kind)))
}

/** Hücrenin kalemleri (sıra düzeninde). */
export const slotItems = (day: Pick<MealMenuDay, 'meals'>, kind: MealKind): MealMenuItem[] =>
  day.meals.find((meal) => meal.mealKind === kind)?.items ?? []

/**
 * Günlük toplam metni: `430 kcal · protein 17 g · yağ 8,4 g · karbonhidrat 52 g · tuz 1,8 g`.
 * Gün boşsa boş metin. Lif ya da tuz hiçbir kalemde bilinmiyorsa yazılmaz, bir kısmında
 * bilinmiyorsa "(eksik)" eklenir.
 */
export function totalsText(totals: MealMenuDay['totals']): string {
  if (totals.itemCount === 0) return ''
  const known = totals.itemCount - totals.missingNutrition
  if (known === 0) return 'Besin değeri girilmemiş'
  const optional = (label: string, value: number, missing: number) =>
    missing === known ? [] : [`${label} ${decigramText(value)}${missing > 0 ? ' (eksik)' : ''}`]
  const parts = [
    `${String(totals.energyKcal)} kcal`,
    `protein ${decigramText(totals.proteinDg)}`,
    `yağ ${decigramText(totals.fatDg)}`,
    `karbonhidrat ${decigramText(totals.carbohydrateDg)}`,
    ...optional('lif', totals.fiberDg, totals.missingFiber),
    ...optional('tuz', totals.saltDg, totals.missingSalt),
  ]
  const missing =
    totals.missingNutrition > 0
      ? ` · ${String(totals.missingNutrition)} yemekte besin değeri yok`
      : ''
  return `${parts.join(' · ')}${missing}`
}

/** Kalemin kısa besin metni. */
export function nutritionText(item: Pick<MealMenuItem, 'nutrition'>): string {
  const value = item.nutrition
  if (value === null) return 'Besin değeri yok'
  return `${String(value.energyKcal)} kcal · P ${decigramText(value.proteinDg)} · Y ${decigramText(value.fatDg)} · K ${decigramText(value.carbohydrateDg)}`
}

// --- Menü açma -----------------------------------------------------------------------------------

export const createFormSchema = z.object({
  weekDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Haftayı seçin.'),
  branchId: z.string(),
  copyFromMenuId: z.string(),
})
export type CreateFormValues = z.infer<typeof createFormSchema>

/** Seçilen gün haftanın pazartesisine çevrilir; boş seçimler gönderilmez. */
export function createBody(values: CreateFormValues) {
  return {
    weekStart: mealWeekStartOf(values.weekDay),
    branchId: values.branchId === '' ? null : values.branchId,
    ...(values.copyFromMenuId === '' ? {} : { copyFromMenuId: values.copyFromMenuId }),
  }
}

// --- Hücre formu ---------------------------------------------------------------------------------

const gramField = (label: string, max: number, required: boolean) =>
  z.string().refine(
    (text) => {
      const value = parseDecigrams(text)
      if (value === null) return !required
      return value !== undefined && value <= max
    },
    `${label} 0 ile ${String(max / 10)} g arasında, en çok bir ondalıkla yazılmalı.`,
  )

export const itemFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Yemek adını en az 2 karakterle yazın.')
      .max(MEAL_ITEM_NAME_MAX, `En çok ${String(MEAL_ITEM_NAME_MAX)} karakter.`),
    allergens: z.array(z.enum(ALLERGENS)),
    energyKcal: z
      .string()
      .trim()
      .refine(
        (text) => text === '' || (/^\d{1,4}$/.test(text) && Number(text) <= MEAL_ENERGY_MAX_KCAL),
        `Enerji 0 ile ${String(MEAL_ENERGY_MAX_KCAL)} kcal arasında tam sayı olmalı.`,
      ),
    proteinG: gramField('Protein', MEAL_GRAMS_MAX_DG, false),
    fatG: gramField('Yağ', MEAL_GRAMS_MAX_DG, false),
    carbohydrateG: gramField('Karbonhidrat', MEAL_GRAMS_MAX_DG, false),
    fiberG: gramField('Lif', MEAL_GRAMS_MAX_DG, false),
    saltG: gramField('Tuz', MEAL_SALT_MAX_DG, false),
  })
  .superRefine((value, context) => {
    // Enerji, protein, yağ ve karbonhidrat birlikte girilir; lif ve tuz yalnız onlarla.
    const core = [
      ['energyKcal', value.energyKcal],
      ['proteinG', value.proteinG],
      ['fatG', value.fatG],
      ['carbohydrateG', value.carbohydrateG],
    ] as const
    const filled = core.filter(([, text]) => text.trim() !== '')
    const extras = [value.fiberG, value.saltG].some((text) => text.trim() !== '')
    if (filled.length === 0 && !extras) return
    for (const [key, text] of core)
      if (text.trim() === '')
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Besin değerinde enerji, protein, yağ ve karbonhidrat birlikte girilir.',
        })
  })
export type ItemFormValues = z.infer<typeof itemFormSchema>

export const slotFormSchema = z.object({
  items: z
    .array(itemFormSchema)
    .max(
      MEAL_ITEMS_PER_SLOT_MAX,
      `Bir öğüne en çok ${String(MEAL_ITEMS_PER_SLOT_MAX)} yemek yazılır.`,
    ),
  correctionReason: z.string().max(MEAL_CORRECTION_REASON_MAX),
})
export type SlotFormValues = z.infer<typeof slotFormSchema>

const gramInput = (value: number | null) =>
  value === null ? '' : decigramText(value).replace(' g', '')

export const emptyItem = (): ItemFormValues => ({
  name: '',
  allergens: [],
  energyKcal: '',
  proteinG: '',
  fatG: '',
  carbohydrateG: '',
  fiberG: '',
  saltG: '',
})

export function slotDefaults(items: readonly MealMenuItem[]): SlotFormValues {
  return {
    items: items.map((item) => ({
      name: item.name,
      allergens: [...item.allergens],
      energyKcal: item.nutrition === null ? '' : String(item.nutrition.energyKcal),
      proteinG: gramInput(item.nutrition?.proteinDg ?? null),
      fatG: gramInput(item.nutrition?.fatDg ?? null),
      carbohydrateG: gramInput(item.nutrition?.carbohydrateDg ?? null),
      fiberG: gramInput(item.nutrition?.fiberDg ?? null),
      saltG: gramInput(item.nutrition?.saltDg ?? null),
    })),
    correctionReason: '',
  }
}

const grams = (text: string) => parseDecigrams(text) ?? null

/** Hücre formu → `PATCH` gövdesi; gerekçe yalnız geçmiş gün düzeltmesinde. */
export function slotBody(
  menuDate: string,
  mealKind: MealKind,
  values: SlotFormValues,
  correcting: boolean,
): MealMenuUpdateBody {
  return {
    slots: [
      {
        menuDate,
        mealKind,
        items: values.items.map((item) => ({
          name: item.name.trim(),
          allergens: ALLERGENS.filter((allergen) => item.allergens.includes(allergen)),
          nutrition:
            item.energyKcal.trim() === ''
              ? null
              : {
                  energyKcal: Number(item.energyKcal.trim()),
                  proteinDg: grams(item.proteinG) ?? 0,
                  fatDg: grams(item.fatG) ?? 0,
                  carbohydrateDg: grams(item.carbohydrateG) ?? 0,
                  fiberDg: grams(item.fiberG),
                  saltDg: grams(item.saltG),
                },
        })),
      },
    ],
    ...(correcting ? { correctionReason: values.correctionReason.trim() } : {}),
  }
}

/** Geçmiş gün düzeltmesinde gerekçe uzunluğu (formda ayrıca denetlenir). */
export function correctionReasonError(reason: string): string | undefined {
  const length = reason.trim().length
  if (length < MEAL_CORRECTION_REASON_MIN)
    return `Düzeltme gerekçesini en az ${String(MEAL_CORRECTION_REASON_MIN)} karakterle yazın.`
  return undefined
}

/** Sunucu hata yolu → form alanı (`slots.0.items.1.name` → `items.1.name`). */
export function slotFormField(path: string): `items.${number}.name` | 'correctionReason' | null {
  if (path === 'correctionReason') return 'correctionReason'
  const match = /^slots\.0\.items\.(\d+)\.name$/.exec(path)
  return match ? (`items.${Number(match[1])}.name` as const) : null
}

/**
 * Yayımlanmış menünün geçmiş günü mü (K-527): düzenleme gerekçe ister ve yalnız yöneticidedir.
 */
export const isPastPublished = (
  menu: Pick<MealMenuDetail, 'status'>,
  menuDate: string,
  today: string,
) => menu.status === 'published' && menuDate < today
