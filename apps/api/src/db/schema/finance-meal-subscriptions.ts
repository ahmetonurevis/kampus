import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { MEAL_KINDS, type MealKind } from '@kampus/school-core/lib/finance-meal-menus.ts'
import {
  MEAL_CANCELLED_BY,
  MEAL_CUTOFF_DAYS_MAX,
  MEAL_DIET_NOTE_MAX,
  MEAL_DIET_NOTE_MIN,
  MEAL_DIET_TYPES,
  MEAL_SUBSCRIPTION_DAYS_MAX,
  type MealCancelledBy,
  type MealDietType,
  type MealWeekday,
} from '@kampus/school-core/lib/finance-meal-subscriptions.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Yemek aboneliği (DOM-FIN-164; ON-150; K-547): öğrencinin bir öğüne başlangıç–bitiş günleri
 * arasında, seçili hafta günlerinde katılması ve diyet türü. Aynı öğrenci ve öğünde tarihleri değen
 * iki etkin abonelik olmaz (kurum kilidi altında core denetler). Başlamış abonelikte yalnız bitiş
 * günü değişir; arşiv yalnız başlamamış abonelikte. Ücret bağı ek hizmet kalemiyle (ON-087) gelir.
 */
export const mealSubscriptions = pgTable(
  'meal_subscriptions',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: Ç
    studentId: text('student_id').notNull(),
    mealKind: text('meal_kind').$type<MealKind>().notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    weekdays: integer('weekdays').array().$type<MealWeekday[]>().notNull(),
    // kvkk: Ç — diyet türü; tıbbi gerekçe sağlık profilinde kalır (K-547).
    dietType: text('diet_type').$type<MealDietType>().notNull(),
    // kvkk: Ç — "diğer" diyetin kısa açıklaması; serbest metin, loglanmaz, denetime yazılmaz.
    dietNote: text('diet_note'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'meal_subscriptions_pkey', columns: [table.institutionId, table.id] }),
    check('meal_subscriptions_meal_kind_check', oneOf(table.mealKind, MEAL_KINDS)),
    check('meal_subscriptions_diet_type_check', oneOf(table.dietType, MEAL_DIET_TYPES)),
    check(
      'meal_subscriptions_dates_check',
      sql`${table.endDate} >= ${table.startDate}
        and ${table.endDate} - ${table.startDate} < ${n(MEAL_SUBSCRIPTION_DAYS_MAX)}`,
    ),
    check(
      'meal_subscriptions_weekdays_check',
      sql`cardinality(${table.weekdays}) between 1 and 7
        and ${table.weekdays} <@ array[1, 2, 3, 4, 5, 6, 7]::integer[]`,
    ),
    check(
      'meal_subscriptions_diet_note_check',
      sql`(${table.dietType} = 'other') = (${table.dietNote} is not null)
        and (${table.dietNote} is null
          or char_length(${table.dietNote}) between ${n(MEAL_DIET_NOTE_MIN)} and ${n(MEAL_DIET_NOTE_MAX)})`,
    ),
    index('meal_subscriptions_student_idx').on(table.institutionId, table.studentId),
    index('meal_subscriptions_dates_idx').on(table.institutionId, table.endDate, table.startDate),
  ],
)

/**
 * Gün iptali (DOM-FIN-164; K-548): aboneliğin bir yemek günü. Kesimden sonra okulun yaptığı iptal
 * `late` işaretlidir ve iade/mahsup gününe girmez. Geri alma satırı arşivler (geri alanla); aynı
 * gün yeniden iptal edilebilir. Etkin iptal abonelik ve gün başına tektir.
 */
export const mealSubscriptionCancellations = pgTable(
  'meal_subscription_cancellations',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    subscriptionId: uuid('subscription_id').notNull(),
    mealDate: date('meal_date', { mode: 'string' }).notNull(),
    late: boolean('late').notNull().default(false),
    cancelledBy: text('cancelled_by').$type<MealCancelledBy>().notNull(),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id').notNull(),
    // kvkk: K
    restoredByUserId: text('restored_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'meal_subscription_cancellations_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'meal_subscription_cancellations_subscription_fkey',
      columns: [table.institutionId, table.subscriptionId],
      foreignColumns: [mealSubscriptions.institutionId, mealSubscriptions.id],
    }).onDelete('restrict'),
    check(
      'meal_subscription_cancellations_cancelled_by_check',
      oneOf(table.cancelledBy, MEAL_CANCELLED_BY),
    ),
    check(
      'meal_subscription_cancellations_late_check',
      sql`not ${table.late} or ${table.cancelledBy} = 'school'`,
    ),
    check(
      'meal_subscription_cancellations_restored_check',
      sql`(${table.archivedAt} is null) = (${table.restoredByUserId} is null)`,
    ),
    uniqueIndex('meal_subscription_cancellations_day_key')
      .on(table.institutionId, table.subscriptionId, table.mealDate)
      .where(sql`${table.archivedAt} is null`),
    index('meal_subscription_cancellations_subscription_idx').on(
      table.institutionId,
      table.subscriptionId,
    ),
    index('meal_subscription_cancellations_date_idx').on(table.institutionId, table.mealDate),
  ],
)

/** Gün iptali kesimi (DOM-FIN-164; K-548); satır yoksa bir gün önce 15:00. */
export const mealSubscriptionSettings = pgTable(
  'meal_subscription_settings',
  {
    institutionId: text('institution_id')
      .primaryKey()
      .references(() => institutions.id),
    cutoffDaysBefore: integer('cutoff_days_before').notNull(),
    cutoffTime: text('cutoff_time').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    check(
      'meal_subscription_settings_cutoff_check',
      sql`${table.cutoffDaysBefore} between 0 and ${n(MEAL_CUTOFF_DAYS_MAX)}
        and ${table.cutoffTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
  ],
)
