import { sql } from 'drizzle-orm'
import {
  bigint,
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

import { institutions } from './auth.ts'
import { requiredColumns } from './columns.ts'

/**
 * Burs programı ve ataması (DOM-FIN-025). Program eğitim yılına bağlıdır; il millî eğitim
 * müdürlüğüne bildirilmemiş program kullanılamaz. Öğrenci bir eğitim yılında en çok bir burs alır.
 */
export const scholarshipPrograms = pgTable(
  'scholarship_programs',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    academicYear: integer('academic_year').notNull(),
    name: text('name').notNull(),
    conditions: text('conditions').notNull(),
    terminationConditions: text('termination_conditions').notNull(),
    durationNote: text('duration_note').notNull(),
    percentBasisPoints: integer('percent_basis_points'),
    amountCents: bigint('amount_cents', { mode: 'number' }),
    capacity: integer('capacity').notNull(),
    notifiedDate: date('notified_date'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'scholarship_programs_pkey', columns: [table.institutionId, table.id] }),
    check(
      'scholarship_programs_value_check',
      sql`(${table.percentBasisPoints} is null) <> (${table.amountCents} is null)`,
    ),
    check(
      'scholarship_programs_percent_check',
      sql`${table.percentBasisPoints} is null or ${table.percentBasisPoints} between 1 and 10000`,
    ),
    check(
      'scholarship_programs_amount_check',
      sql`${table.amountCents} is null or ${table.amountCents} > 0`,
    ),
    check('scholarship_programs_capacity_check', sql`${table.capacity} > 0`),
    uniqueIndex('scholarship_programs_year_name_key')
      .on(table.institutionId, table.academicYear, table.name)
      .where(sql`${table.archivedAt} is null`),
  ],
)

export const scholarshipAwards = pgTable(
  'scholarship_awards',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    programId: uuid('program_id').notNull(),
    // kvkk: K
    studentId: text('student_id').notNull(),
    academicYear: integer('academic_year').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    // kvkk: K
    awardedByUserId: text('awarded_by_user_id').notNull(),
    mebbisRecordedDate: date('mebbis_recorded_date'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'scholarship_awards_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'scholarship_awards_program_fkey',
      columns: [table.institutionId, table.programId],
      foreignColumns: [scholarshipPrograms.institutionId, scholarshipPrograms.id],
    }),
    check('scholarship_awards_amount_check', sql`${table.amountCents} > 0`),
    uniqueIndex('scholarship_awards_student_year_key')
      .on(table.institutionId, table.studentId, table.academicYear)
      .where(sql`${table.archivedAt} is null`),
    index('scholarship_awards_program_idx').on(table.institutionId, table.programId),
  ],
)
