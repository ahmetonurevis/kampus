import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  PERFORMANCE_NAME_MAX,
  PERFORMANCE_NAME_MIN,
  PERFORMANCE_NOTE_MAX,
  PERFORMANCE_PERIOD_STATUSES,
  type PerformanceGoal,
  type PerformancePeriodStatus,
} from '@kampus/school-core/lib/finance-performance.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Performans dönemi (DOM-FIN-124; ON-211). Aşama yalnız ileri gider (K-427); kapanınca dönemin
 * kayıtları kilitlenir (K-428). Kapanış anı ve kapatan aşama `closed` iken doludur.
 */
export const performancePeriods = pgTable(
  'performance_periods',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    status: text('status').$type<PerformancePeriodStatus>().notNull().default('planning'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    // kvkk: K
    closedByUserId: text('closed_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'performance_periods_pkey', columns: [table.institutionId, table.id] }),
    check('performance_periods_status_check', oneOf(table.status, PERFORMANCE_PERIOD_STATUSES)),
    check(
      'performance_periods_name_check',
      sql`char_length(${table.name}) between ${n(PERFORMANCE_NAME_MIN)} and ${n(PERFORMANCE_NAME_MAX)}`,
    ),
    check('performance_periods_dates_check', sql`${table.endDate} >= ${table.startDate}`),
    check(
      'performance_periods_closed_check',
      sql`((${table.status} = 'closed') = (${table.closedAt} is not null))
        and ((${table.closedAt} is null) = (${table.closedByUserId} is null))`,
    ),
    index('performance_periods_start_idx').on(table.institutionId, table.startDate),
  ],
)

/**
 * Personel × dönem performans kaydı (DOM-FIN-124; ON-211). Hedefler (başlık, ölçüt, ağırlık,
 * puan) sıralı jsonb dizisidir; genel puan saklanmaz, hedeflerden hesaplanır (core
 * `performanceOverallScore`). Dönemde personel başına tek kayıt. Performans verisi kişiseldir:
 * yalnız yönetici okur, okuma denetime düşer (K-429). Personel kaydı ayrı tablo değildir; kayıt
 * üyeliğe bağlanır.
 */
export const performanceReviews = pgTable(
  'performance_reviews',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    periodId: uuid('period_id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    // kvkk: K (hedefler ve puanlar)
    goals: jsonb('goals').$type<PerformanceGoal[]>().notNull(),
    // kvkk: K (serbest metin; loglanmaz)
    interimNote: text('interim_note'),
    interimDate: date('interim_date', { mode: 'string' }),
    // kvkk: K
    evaluatorUserId: text('evaluator_user_id'),
    // kvkk: K
    evaluatorName: text('evaluator_name'),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }),
    // kvkk: K (serbest metin; loglanmaz)
    staffComment: text('staff_comment'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'performance_reviews_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'performance_reviews_period_fkey',
      columns: [table.institutionId, table.periodId],
      foreignColumns: [performancePeriods.institutionId, performancePeriods.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'performance_reviews_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check(
      'performance_reviews_goals_check',
      sql`jsonb_typeof(${table.goals}) = 'array' and jsonb_array_length(${table.goals}) between 1 and 10`,
    ),
    check(
      'performance_reviews_notes_check',
      sql`(${table.interimNote} is null or char_length(${table.interimNote}) between 1 and ${n(PERFORMANCE_NOTE_MAX)})
        and (${table.staffComment} is null or char_length(${table.staffComment}) between 1 and ${n(PERFORMANCE_NOTE_MAX)})`,
    ),
    check(
      'performance_reviews_evaluator_check',
      sql`((${table.evaluatorUserId} is null) = (${table.evaluatedAt} is null))
        and ((${table.evaluatorUserId} is null) = (${table.evaluatorName} is null))`,
    ),
    uniqueIndex('performance_reviews_member_key').on(
      table.institutionId,
      table.periodId,
      table.membershipId,
    ),
    index('performance_reviews_membership_idx').on(table.institutionId, table.membershipId),
  ],
)
