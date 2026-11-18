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
  PAYROLL_CARRYOVER_MAX_CENTS,
  PAYROLL_CARRYOVER_NOTE_MAX,
  type PayrollCalcRow,
} from '@kampus/school-core/lib/finance-payroll-calc.ts'

import { institutions, memberships } from './auth.ts'
import { requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))
const MONTH = sql.raw(`'^20[2-9][0-9]-(0[1-9]|1[0-2])$'`)

/**
 * Kayıtlı bordro hesabı (DOM-FIN-115; ON-198, K-391). Ay başına tek etkin hesap; yeniden hesaplama
 * eski hesabı arşivler (`archived_at`) ve revizyonu artırılmış yeni hesap yazar. Onaylı (kilitli)
 * ayda yazma yoktur (ON-200): onay hesabı dondurur. Kümülatif gelir vergisi matrahı etkin
 * hesapların satırlarından okunur.
 */
export const payrollRuns = pgTable(
  'payroll_runs',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    month: text('month').notNull(),
    revision: integer('revision').notNull(),
    parameterSetId: text('parameter_set_id').notNull(),
    parameterEffectiveFrom: date('parameter_effective_from', { mode: 'string' }).notNull(),
    staffCount: integer('staff_count').notNull(),
    skippedCount: integer('skipped_count').notNull(),
    grossTotalCents: bigint('gross_total_cents', { mode: 'number' }).notNull(),
    netTotalCents: bigint('net_total_cents', { mode: 'number' }).notNull(),
    payableTotalCents: bigint('payable_total_cents', { mode: 'number' }).notNull(),
    employerCostTotalCents: bigint('employer_cost_total_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    // kvkk: K
    calculatedByUserId: text('calculated_by_user_id').notNull(),
    // kvkk: K
    archivedByUserId: text('archived_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'payroll_runs_pkey', columns: [table.institutionId, table.id] }),
    check('payroll_runs_month_check', sql`${table.month} ~ ${MONTH}`),
    check(
      'payroll_runs_counts_check',
      sql`${table.revision} >= 1 and ${table.staffCount} >= 1 and ${table.skippedCount} >= 0
        and ${table.grossTotalCents} >= 0 and ${table.employerCostTotalCents} >= 0`,
    ),
    check('payroll_runs_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'payroll_runs_archive_check',
      sql`(${table.archivedAt} is null) = (${table.archivedByUserId} is null)`,
    ),
    uniqueIndex('payroll_runs_month_key')
      .on(table.institutionId, table.month)
      .where(sql`${table.archivedAt} is null`),
    uniqueIndex('payroll_runs_revision_key').on(table.institutionId, table.month, table.revision),
  ],
)

/**
 * Kayıtlı hesabın personel satırı (DOM-FIN-115; K-391). Satır değişmez
 * (`kampus_reject_immutable_change`); hesabın bütün ayrıntısı `line` içinde, sorgu ve rapor için
 * ana tutarlar ayrıca kolondadır. Yalnız hesaplanabilen (eksik olmayan) satırlar yazılır.
 */
export const payrollRunLines = pgTable(
  'payroll_run_lines',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    runId: uuid('run_id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    month: text('month').notNull(),
    // kvkk: K (ücret)
    grossCents: bigint('gross_cents', { mode: 'number' }).notNull(),
    // kvkk: K
    incomeTaxBaseCents: bigint('income_tax_base_cents', { mode: 'number' }).notNull(),
    // kvkk: K
    netCents: bigint('net_cents', { mode: 'number' }).notNull(),
    // kvkk: K
    payableCents: bigint('payable_cents', { mode: 'number' }).notNull(),
    // kvkk: K
    employerCostCents: bigint('employer_cost_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    // kvkk: K (ücret, kesinti; icra satırı kaynak kimliği ve tutar taşır)
    line: jsonb('line').$type<PayrollCalcRow>().notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'payroll_run_lines_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'payroll_run_lines_run_fkey',
      columns: [table.institutionId, table.runId],
      foreignColumns: [payrollRuns.institutionId, payrollRuns.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'payroll_run_lines_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('payroll_run_lines_month_check', sql`${table.month} ~ ${MONTH}`),
    check(
      'payroll_run_lines_amounts_check',
      sql`${table.grossCents} >= 0 and ${table.incomeTaxBaseCents} >= 0
        and ${table.employerCostCents} >= 0`,
    ),
    check('payroll_run_lines_currency_check', sql`${table.currency} = 'TRY'`),
    uniqueIndex('payroll_run_lines_member_key').on(
      table.institutionId,
      table.runId,
      table.membershipId,
    ),
    index('payroll_run_lines_membership_idx').on(
      table.institutionId,
      table.membershipId,
      table.month,
    ),
  ],
)

/**
 * Kümülatif gelir vergisi matrahı devri (DOM-FIN-115; K-388): personelin yıl içinde başka işyerinde
 * ya da Kampüs öncesinde oluşan kümülatif matrahı. Personel × yıl başına tek etkin kayıt; düzeltilmez,
 * kaldırılır (arşiv) ve yeniden girilir.
 */
export const payrollTaxCarryovers = pgTable(
  'payroll_tax_carryovers',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    year: integer('year').notNull(),
    // kvkk: K (ücret)
    incomeTaxBaseCents: bigint('income_tax_base_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    note: text('note'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    // kvkk: K
    archivedByUserId: text('archived_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'payroll_tax_carryovers_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'payroll_tax_carryovers_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('payroll_tax_carryovers_year_check', sql`${table.year} between 2020 and 2099`),
    check(
      'payroll_tax_carryovers_amount_check',
      sql`${table.incomeTaxBaseCents} between 1 and ${n(PAYROLL_CARRYOVER_MAX_CENTS)}`,
    ),
    check('payroll_tax_carryovers_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'payroll_tax_carryovers_note_check',
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${n(PAYROLL_CARRYOVER_NOTE_MAX)}`,
    ),
    check(
      'payroll_tax_carryovers_archive_check',
      sql`(${table.archivedAt} is null) = (${table.archivedByUserId} is null)`,
    ),
    uniqueIndex('payroll_tax_carryovers_member_year_key')
      .on(table.institutionId, table.membershipId, table.year)
      .where(sql`${table.archivedAt} is null`),
    index('payroll_tax_carryovers_year_idx').on(table.institutionId, table.year),
  ],
)
