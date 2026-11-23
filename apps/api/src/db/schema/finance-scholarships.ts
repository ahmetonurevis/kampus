import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  SCHOLARSHIP_END_KINDS,
  SCHOLARSHIP_TERMINATION_REASONS,
  type ScholarshipEndLine,
} from '@kampus/school-core/lib/finance-scholarship-revocation.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

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

/**
 * Burs kesmesi ve gerçek dışı beyanla iptali (DOM-FIN-025; ON-283, K-264…K-267). Atama başına en
 * çok bir kesme ve bir iptal; kesmeden sonra iptal yapılabilir, iptalden sonra işlem yoktur. Tutarlar
 * yazma anının hesabıdır (geri isteme yazısı yeniden hesaplamaz); yeni taksitlerin kimlikleri
 * `invoice_ids`'tedir. `contract_id` ve `invoice_ids` `records` kimlikleridir, yabancı anahtar değildir
 * (ayrılış kaydıyla aynı, ADR 0010 046h). Gerekçe açıklaması serbest metindir, loglanmaz.
 */
export const scholarshipTerminations = pgTable(
  'scholarship_terminations',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    awardId: uuid('award_id').notNull(),
    contractId: text('contract_id').notNull(),
    kind: text('kind').$type<(typeof SCHOLARSHIP_END_KINDS)[number]>().notNull(),
    reason: text('reason').notNull(),
    // kvkk: K
    note: text('note').notNull(),
    effectiveDate: date('effective_date').notNull(),
    keptCents: bigint('kept_cents', { mode: 'number' }).notNull(),
    reinstatedCents: bigint('reinstated_cents', { mode: 'number' }).notNull(),
    principalCents: bigint('principal_cents', { mode: 'number' }).notNull(),
    interestCents: bigint('interest_cents', { mode: 'number' }).notNull(),
    clawbackDueDate: date('clawback_due_date'),
    invoiceIds: text('invoice_ids').array().notNull(),
    lines: jsonb('lines').$type<ScholarshipEndLine[]>().notNull(),
    // kvkk: K
    decidedByUserId: text('decided_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'scholarship_terminations_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'scholarship_terminations_award_fkey',
      columns: [table.institutionId, table.awardId],
      foreignColumns: [scholarshipAwards.institutionId, scholarshipAwards.id],
    }),
    check('scholarship_terminations_kind_check', oneOf(table.kind, SCHOLARSHIP_END_KINDS)),
    check(
      'scholarship_terminations_reason_check',
      sql`(${table.kind} = 'revoke' and ${table.reason} = 'false_declaration') or (${table.kind} = 'terminate' and ${oneOf(table.reason, SCHOLARSHIP_TERMINATION_REASONS)})`,
    ),
    check(
      'scholarship_terminations_amounts_check',
      sql`${table.keptCents} >= 0 and ${table.reinstatedCents} >= 0 and ${table.principalCents} >= 0 and ${table.interestCents} >= 0`,
    ),
    check(
      'scholarship_terminations_clawback_check',
      sql`(${table.kind} = 'revoke') or (${table.principalCents} = 0 and ${table.interestCents} = 0 and ${table.clawbackDueDate} is null)`,
    ),
    uniqueIndex('scholarship_terminations_award_kind_key')
      .on(table.institutionId, table.awardId, table.kind)
      .where(sql`${table.archivedAt} is null`),
    index('scholarship_terminations_contract_idx').on(table.institutionId, table.contractId),
  ],
)
