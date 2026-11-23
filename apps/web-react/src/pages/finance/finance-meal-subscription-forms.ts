import { z } from 'zod'

import type {
  MealDailyCount,
  MealSubscriptionBody,
  MealSubscriptionDay,
  MealSubscriptionRow,
  MealSubscriptionUpdateBody,
} from '@kampus/react-shared/use-finance-meal-subscriptions.ts'
import { addDays } from '@kampus/school-core/lib/academic-years.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  MEAL_KIND_LABELS,
  MEAL_KINDS,
  type MealKind,
} from '@kampus/school-core/lib/finance-meal-menus.ts'
import {
  DEFAULT_MEAL_WEEKDAYS,
  MEAL_DAY_STATUS_LABELS,
  MEAL_DIET_NOTE_MAX,
  MEAL_DIET_TYPE_LABELS,
  MEAL_DIET_TYPES,
  MEAL_SUBSCRIPTION_STATUS_LABELS,
  MEAL_WEEKDAYS,
  mealSubscriptionIssues,
  mealSubscriptionStatus,
  mealWeekdaysText,
  type MealDietType,
} from '@kampus/school-core/lib/finance-meal-subscriptions.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'

/**
 * Yemek aboneliği sekmesinin saf mantığı (DOM-FIN-164; ON-150; K-547…K-549): abonelik formunun
 * şeması ve gövdesi, kesim formu, tablo ve sayım metinleri. Kural ayrıntısı sunucudadır.
 */

export const dietText = (row: { dietType: MealDietType; dietNote: string | null }) =>
  row.dietType === 'other' && row.dietNote !== null
    ? `${MEAL_DIET_TYPE_LABELS.other}: ${row.dietNote}`
    : MEAL_DIET_TYPE_LABELS[row.dietType]
export const mealKindText = (kind: MealKind) => MEAL_KIND_LABELS[kind]
export const shortDate = (day: string) => dateLabel(`${day}T09:00:00.000Z`)
export const longDate = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
/** `6 Eki – 31 Ara 2026 · Hafta içi`. */
export const periodText = (row: Pick<MealSubscriptionRow, 'startDate' | 'endDate' | 'weekdays'>) =>
  `${shortDate(row.startDate)} – ${longDate(row.endDate)} · ${mealWeekdaysText(row.weekdays)}`
export const subscriptionStatusText = (status: MealSubscriptionRow['status']) =>
  MEAL_SUBSCRIPTION_STATUS_LABELS[status]
export const dayStatusText = (day: Pick<MealSubscriptionDay, 'status' | 'holidayTitle'>) =>
  day.status === 'holiday' && day.holidayTitle !== null
    ? `Tatil: ${day.holidayTitle}`
    : MEAL_DAY_STATUS_LABELS[day.status]

const MONTHS = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
]
/** `2026-10` → `Ekim 2026`. */
export function monthText(month: string): string {
  const [year = '', index = '1'] = month.split('-')
  return `${MONTHS[Number(index) - 1] ?? ''} ${year}`
}
/** Ayı bir ileri ya da geri kaydırır. */
export function shiftMonth(month: string, step: number): string {
  const [year = 0, index = 1] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, index - 1 + step, 1))
  return date.toISOString().slice(0, 7)
}

// --- Abonelik formu ------------------------------------------------------------------------------

export const subscriptionFormSchema = z
  .object({
    studentId: z.string().min(1, 'Öğrenciyi seçin.'),
    mealKind: z.enum(MEAL_KINDS, 'Öğünü seçin.'),
    startDate: daySchema,
    endDate: daySchema,
    weekdays: z.array(z.number().int()).min(1, 'En az bir hafta günü seçin.'),
    dietType: z.enum(MEAL_DIET_TYPES, 'Diyet türünü seçin.'),
    dietNote: z
      .string()
      .max(MEAL_DIET_NOTE_MAX, `En çok ${String(MEAL_DIET_NOTE_MAX)} karakter girebilirsiniz.`),
  })
  .superRefine((value, context) => {
    for (const issue of mealSubscriptionIssues({
      ...value,
      dietNote: value.dietType === 'other' ? value.dietNote : null,
    }))
      context.addIssue({ code: 'custom', path: [issue.path], message: issue.message })
  })
export type SubscriptionFormValues = z.infer<typeof subscriptionFormSchema>

/** Yeni abonelikte yarından yıl sonuna (ya da 30 Haziran'a) hafta içi öğle yemeği. */
export function subscriptionDefaults(
  today: string,
  mealKinds: readonly MealKind[],
  row?: MealSubscriptionRow,
): SubscriptionFormValues {
  if (row !== undefined)
    return {
      studentId: row.studentId,
      mealKind: row.mealKind,
      startDate: row.startDate,
      endDate: row.endDate,
      weekdays: [...row.weekdays],
      dietType: row.dietType,
      dietNote: row.dietNote ?? '',
    }
  const start = addDays(today, 1)
  const [year = 0, month = 1] = start.split('-').map(Number)
  const schoolYearEnd = `${String(month >= 7 ? year + 1 : year)}-06-30`
  return {
    studentId: '',
    mealKind: mealKinds.includes('lunch') ? 'lunch' : (mealKinds[0] ?? 'lunch'),
    startDate: start,
    endDate: schoolYearEnd,
    weekdays: [...DEFAULT_MEAL_WEEKDAYS],
    dietType: 'standard',
    dietNote: '',
  }
}

export function subscriptionCreateBody(values: SubscriptionFormValues): MealSubscriptionBody {
  return {
    studentId: values.studentId,
    mealKind: values.mealKind,
    startDate: values.startDate,
    endDate: values.endDate,
    weekdays: MEAL_WEEKDAYS.filter((day) => values.weekdays.includes(day)),
    dietType: values.dietType,
    dietNote: values.dietType === 'other' ? values.dietNote.trim() : null,
  }
}

/** Başlamış abonelik formunda yalnız bitiş günü düzenlenir. */
export const onlyEndDate = (row: MealSubscriptionRow, today: string) =>
  mealSubscriptionStatus(row, today) !== 'upcoming'

/**
 * Düzenleme gövdesi: yalnız değişen alanlar; başlamış abonelikte yalnız bitiş günü. Değişiklik
 * yoksa `null`.
 */
export function subscriptionUpdateBody(
  values: SubscriptionFormValues,
  row: MealSubscriptionRow,
  today: string,
): MealSubscriptionUpdateBody | null {
  const next = subscriptionCreateBody(values)
  const body: MealSubscriptionUpdateBody = {}
  if (next.endDate !== row.endDate) body.endDate = next.endDate
  if (!onlyEndDate(row, today)) {
    if (next.startDate !== row.startDate) body.startDate = next.startDate
    if (next.weekdays.join(',') !== row.weekdays.join(',')) body.weekdays = next.weekdays
    if (next.dietType !== row.dietType) body.dietType = next.dietType
    if ((next.dietNote ?? null) !== row.dietNote) body.dietNote = next.dietNote ?? null
  }
  return Object.keys(body).length === 0 ? null : body
}

const SUBSCRIPTION_FIELDS = [
  'studentId',
  'mealKind',
  'startDate',
  'endDate',
  'weekdays',
  'dietType',
  'dietNote',
] as const
export function subscriptionFormField(name: string): (typeof SUBSCRIPTION_FIELDS)[number] | null {
  const root = name.split('.')[0] ?? ''
  return SUBSCRIPTION_FIELDS.find((field) => field === root) ?? null
}

// --- Kesim formu ---------------------------------------------------------------------------------

export const cutoffFormSchema = z.object({
  cutoffDaysBefore: z
    .string()
    .refine((value) => /^[0-7]$/.test(value.trim()), '0 ile 7 arasında bir gün sayısı girin.'),
  cutoffTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Saati SS:DD biçiminde girin.'),
})
export type CutoffFormValues = z.infer<typeof cutoffFormSchema>
export const cutoffBody = (values: CutoffFormValues) => ({
  cutoffDaysBefore: Number(values.cutoffDaysBefore.trim()),
  cutoffTime: values.cutoffTime,
})

// --- Sayım ve özet -------------------------------------------------------------------------------

/** Sıfır olmayan diyetler: `Normal 12 · Vejetaryen 3`; hiç yoksa `—`. */
export function dietCountsText(diets: readonly { dietType: MealDietType; count: number }[]) {
  const shown = diets.filter((row) => row.count > 0)
  return shown.length === 0
    ? '—'
    : shown.map((row) => `${MEAL_DIET_TYPE_LABELS[row.dietType]} ${String(row.count)}`).join(' · ')
}

/** Sayım satırının iptal notu: `2 iptal · 1 geç iptal`; yoksa boş. */
export function cancelledText(row: { cancelled: number; lateCancelled: number }) {
  const parts = [
    row.cancelled > 0 ? `${String(row.cancelled)} iptal` : '',
    row.lateCancelled > 0 ? `${String(row.lateCancelled)} geç iptal` : '',
  ].filter((part) => part !== '')
  return parts.join(' · ')
}

/** Sınıf kırılımı tablosunun sütunları: sayımdaki öğünler. */
export const countMealKinds = (count: Pick<MealDailyCount, 'meals'>) =>
  count.meals.map((row) => row.mealKind)

/** Sınıfın öğün sayısı; öğünde yemeği yoksa 0. */
export function classMealTotal(
  entry: MealDailyCount['classes'][number],
  mealKind: MealKind,
): number {
  return entry.meals.find((row) => row.mealKind === mealKind)?.total ?? 0
}

/** Takvim penceresinde iptal edilebilecek ilk yemek günü (formun varsayılanı). */
export const firstCancellable = (days: readonly MealSubscriptionDay[]) =>
  days.find((day) => day.canCancel)?.mealDate ?? ''
