import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core'

import { PAYROLL_LESSON_HOURS_MAX } from '@kampus/school-core/lib/finance-payroll-exports.ts'
import {
  WEEKLY_CAP_MAX,
  WEEKLY_LOAD_MAX,
} from '@kampus/school-core/lib/finance-lesson-hour-suggestions.ts'
import {
  PAYROLL_REASON_MAX,
  PAYROLL_REASON_MIN,
} from '@kampus/school-core/lib/finance-payroll-periods.ts'

import { institutions, memberships } from './auth.ts'
import { requiredColumns } from './columns.ts'
import { payrollLessonHours } from './finance-payroll-exports.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Programdan ek ders önerisinin aktarımı (DOM-FIN-165; ON-195, K-552). Öneri saklanmaz (her
 * okumada ders programından hesaplanır); yalnız yöneticinin öneriyi elle girişe (`payroll_lesson_hours`)
 * aktardığı an saklanır: önerilen saat, girişteki önceki saat, yazılan saat, farkın gerekçesi ve
 * hesabın parametreleri. Satır değişmez (`kampus_reject_immutable_change()`, tetikleyici
 * migration'a elle yazılır); aynı ay ve personel için her aktarım yeni satırdır.
 */
export const lessonHourSuggestions = pgTable(
  'lesson_hour_suggestions',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    monthStart: date('month_start', { mode: 'string' }).notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    lessonHoursId: uuid('lesson_hours_id').notNull(),
    // kvkk: K (çalışma süresi)
    suggestedHours: integer('suggested_hours').notNull(),
    // kvkk: K (çalışma süresi)
    previousHours: integer('previous_hours'),
    // kvkk: K (çalışma süresi)
    hours: integer('hours').notNull(),
    // kvkk: Ç
    reason: text('reason'),
    weeklyLoad: integer('weekly_load').notNull(),
    weeklyCap: integer('weekly_cap').notNull(),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'lesson_hour_suggestions_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'lesson_hour_suggestions_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lesson_hour_suggestions_lesson_hours_fkey',
      columns: [table.institutionId, table.lessonHoursId],
      foreignColumns: [payrollLessonHours.institutionId, payrollLessonHours.id],
    }).onDelete('restrict'),
    check('lesson_hour_suggestions_month_check', sql`extract(day from ${table.monthStart}) = 1`),
    check(
      'lesson_hour_suggestions_hours_check',
      sql`${table.suggestedHours} between 0 and ${n(PAYROLL_LESSON_HOURS_MAX)}
        and ${table.hours} between 1 and ${n(PAYROLL_LESSON_HOURS_MAX)}
        and (${table.previousHours} is null
          or ${table.previousHours} between 1 and ${n(PAYROLL_LESSON_HOURS_MAX)})
        and (${table.previousHours} is null or ${table.previousHours} <> ${table.hours})`,
    ),
    check(
      'lesson_hour_suggestions_reason_check',
      sql`(${table.hours} = ${table.suggestedHours} or ${table.reason} is not null)
        and (${table.reason} is null or char_length(${table.reason})
          between ${n(PAYROLL_REASON_MIN)} and ${n(PAYROLL_REASON_MAX)})`,
    ),
    check(
      'lesson_hour_suggestions_params_check',
      sql`${table.weeklyLoad} between 0 and ${n(WEEKLY_LOAD_MAX)}
        and ${table.weeklyCap} between 1 and ${n(WEEKLY_CAP_MAX)}
        and ${table.weeklyCap} >= ${table.weeklyLoad}`,
    ),
    index('lesson_hour_suggestions_month_idx').on(
      table.institutionId,
      table.monthStart,
      table.membershipId,
    ),
    index('lesson_hour_suggestions_membership_idx').on(table.institutionId, table.membershipId),
    index('lesson_hour_suggestions_lesson_hours_idx').on(table.institutionId, table.lessonHoursId),
  ],
)
