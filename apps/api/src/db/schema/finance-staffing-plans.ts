import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  STAFFING_LINES_MAX,
  STAFFING_NORM_MAX,
  STAFFING_NORM_MIN,
  STAFFING_NOTE_MAX,
  STAFFING_POSITION_HOURS_MAX,
  STAFFING_POSITION_STATUSES,
  STAFFING_YEAR_MAX,
  STAFFING_YEAR_MIN,
  type StaffingLine,
  type StaffingPositionStatus,
} from '@kampus/school-core/lib/finance-staffing-plans.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { staffJobOffers } from './finance-staff-onboarding.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Kadro planı (DOM-FIN-126; ON-188; K-433…K-435). Kurum ve eğitim yılı başına bir satır; satır
 * yoksa varsayılan geçerlidir (norm 20, satır yok, sürüm 1). Branş satırları kısa bir listedir ve
 * bütün olarak yazılır; yazmadan önce core `staffingPlanInputSchema` ile doğrulanır. Kapasite,
 * açık ve öneri saklanmaz; okumada öğretmen kaydı, ücret tanımı ve ders programından hesaplanır.
 */
export const staffingPlans = pgTable(
  'staffing_plans',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    academicYear: integer('academic_year').notNull(),
    normHours: integer('norm_hours').notNull(),
    lines: jsonb('lines').$type<StaffingLine[]>().notNull().default([]),
    // kvkk: K
    updatedByUserId: text('updated_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'staffing_plans_pkey',
      columns: [table.institutionId, table.academicYear],
    }),
    check(
      'staffing_plans_year_check',
      sql`${table.academicYear} between ${n(STAFFING_YEAR_MIN)} and ${n(STAFFING_YEAR_MAX)}`,
    ),
    check(
      'staffing_plans_norm_check',
      sql`${table.normHours} between ${n(STAFFING_NORM_MIN)} and ${n(STAFFING_NORM_MAX)}`,
    ),
    check(
      'staffing_plans_lines_check',
      sql`jsonb_typeof(${table.lines}) = 'array' and jsonb_array_length(${table.lines}) <= ${n(STAFFING_LINES_MAX)}`,
    ),
  ],
)

/**
 * Açık pozisyon (DOM-FIN-126; ON-188; K-435). Branş ve haftalık saat; durum açık → ilanda →
 * dolduruldu ya da iptal (son durumlar değişmez). İş teklifine (DOM-FIN-121) isteğe bağlı bağ.
 * Satır silinmez.
 */
export const staffingPositions = pgTable(
  'staffing_positions',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    academicYear: integer('academic_year').notNull(),
    subjectId: text('subject_id').notNull(),
    hours: integer('hours').notNull(),
    status: text('status').$type<StaffingPositionStatus>().notNull(),
    jobOfferId: uuid('job_offer_id'),
    note: text('note'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staffing_positions_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'staffing_positions_job_offer_fkey',
      columns: [table.institutionId, table.jobOfferId],
      foreignColumns: [staffJobOffers.institutionId, staffJobOffers.id],
    }).onDelete('restrict'),
    check('staffing_positions_status_check', oneOf(table.status, STAFFING_POSITION_STATUSES)),
    check(
      'staffing_positions_year_check',
      sql`${table.academicYear} between ${n(STAFFING_YEAR_MIN)} and ${n(STAFFING_YEAR_MAX)}`,
    ),
    check(
      'staffing_positions_hours_check',
      sql`${table.hours} between 1 and ${n(STAFFING_POSITION_HOURS_MAX)}`,
    ),
    check(
      'staffing_positions_text_check',
      sql`char_length(${table.subjectId}) between 1 and 40
        and (${table.note} is null or char_length(${table.note}) between 1 and ${n(STAFFING_NOTE_MAX)})`,
    ),
    index('staffing_positions_year_idx').on(table.institutionId, table.academicYear),
    index('staffing_positions_job_offer_idx').on(table.institutionId, table.jobOfferId),
  ],
)
