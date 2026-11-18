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
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  PAYROLL_ADJUSTMENT_ITEMS,
  PAYROLL_ADJUSTMENT_MAX_CENTS,
  PAYROLL_REASON_MAX,
  PAYROLL_REASON_MIN,
  STORED_PAYROLL_PERIOD_STATUSES,
  type PayrollAdjustmentItem,
  type StoredPayrollPeriodStatus,
} from '@kampus/school-core/lib/finance-payroll-periods.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))
const MONTH = sql.raw(`'^20[2-9][0-9]-(0[1-9]|1[0-2])$'`)

/**
 * Bordro dönemi (DOM-FIN-108; ON-200). Kaydı olmayan ay açıktır; onaylanan ay `approved` (kilitli),
 * yeniden açılan ay `reopened` olur ve yeniden onaylanabilir (K-356). Onay anının girdi özeti ve
 * SHA-256 damgası saklanır; yeniden onayda üzerine yazılır, önceki onaylar denetim kaydındadır.
 * Kurumda ay başına tek kayıt.
 */
export const payrollPeriods = pgTable(
  'payroll_periods',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    month: text('month').notNull(),
    status: text('status').$type<StoredPayrollPeriodStatus>().notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
    // kvkk: K
    approvedByUserId: text('approved_by_user_id').notNull(),
    approvalCount: integer('approval_count').notNull().default(1),
    staffCount: integer('staff_count').notNull(),
    rateCount: integer('rate_count').notNull(),
    monthlyGrossTotalCents: bigint('monthly_gross_total_cents', { mode: 'number' }).notNull(),
    adjustmentCount: integer('adjustment_count').notNull(),
    adjustmentTotalCents: bigint('adjustment_total_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    parameterSetId: text('parameter_set_id'),
    parameterEffectiveFrom: date('parameter_effective_from', { mode: 'string' }),
    inputsHash: text('inputs_hash').notNull(),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    // kvkk: K
    reopenedByUserId: text('reopened_by_user_id'),
    // kvkk: Ç
    reopenReason: text('reopen_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'payroll_periods_pkey', columns: [table.institutionId, table.id] }),
    check('payroll_periods_month_check', sql`${table.month} ~ ${MONTH}`),
    check('payroll_periods_status_check', oneOf(table.status, STORED_PAYROLL_PERIOD_STATUSES)),
    check(
      'payroll_periods_counts_check',
      sql`${table.approvalCount} >= 1 and ${table.staffCount} >= 0 and ${table.rateCount} >= 0
        and ${table.monthlyGrossTotalCents} >= 0 and ${table.adjustmentCount} >= 0`,
    ),
    check('payroll_periods_currency_check', sql`${table.currency} = 'TRY'`),
    check('payroll_periods_hash_check', sql`${table.inputsHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'payroll_periods_parameter_check',
      sql`(${table.parameterSetId} is null) = (${table.parameterEffectiveFrom} is null)`,
    ),
    // Yeniden açma üçlüsü birlikte dolar; yeniden açık ayda zorunlu, yeniden onayda son açma kalır.
    check(
      'payroll_periods_reopen_check',
      sql`((${table.reopenedAt} is null) = (${table.reopenedByUserId} is null))
        and ((${table.reopenedAt} is null) = (${table.reopenReason} is null))
        and (${table.status} <> 'reopened' or ${table.reopenedAt} is not null)
        and (${table.reopenReason} is null or char_length(${table.reopenReason})
          between ${n(PAYROLL_REASON_MIN)} and ${n(PAYROLL_REASON_MAX)})`,
    ),
    uniqueIndex('payroll_periods_month_key')
      .on(table.institutionId, table.month)
      .where(sql`${table.archivedAt} is null`),
  ],
)

/**
 * Bordro düzeltme kaydı (DOM-FIN-108; ON-200, K-358). Kilitli ayın farkı: personel, kalem,
 * işaretli fark tutarı ve gerekçe; kaynak aydan sonraki ilk kilitsiz aya (`target_month`)
 * aktarılacak girdi olarak saklanır, asıl dönem değişmez. Düzeltilmez; gerekçeyle iptal (arşiv)
 * edilir. Tutar kişisel veridir (K-306).
 */
export const payrollAdjustments = pgTable(
  'payroll_adjustments',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    periodId: uuid('period_id').notNull(),
    sourceMonth: text('source_month').notNull(),
    targetMonth: text('target_month').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    item: text('item').$type<PayrollAdjustmentItem>().notNull(),
    // kvkk: K (ücret farkı)
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    // kvkk: Ç
    reason: text('reason').notNull(),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    // kvkk: Ç
    cancelReason: text('cancel_reason'),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'payroll_adjustments_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'payroll_adjustments_period_fkey',
      columns: [table.institutionId, table.periodId],
      foreignColumns: [payrollPeriods.institutionId, payrollPeriods.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'payroll_adjustments_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('payroll_adjustments_item_check', oneOf(table.item, PAYROLL_ADJUSTMENT_ITEMS)),
    check(
      'payroll_adjustments_amount_check',
      sql`${table.amountCents} <> 0
        and abs(${table.amountCents}) <= ${n(PAYROLL_ADJUSTMENT_MAX_CENTS)}`,
    ),
    check('payroll_adjustments_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'payroll_adjustments_months_check',
      sql`${table.sourceMonth} ~ ${MONTH} and ${table.targetMonth} ~ ${MONTH}
        and ${table.targetMonth} > ${table.sourceMonth}`,
    ),
    check(
      'payroll_adjustments_reason_check',
      sql`char_length(${table.reason}) between ${n(PAYROLL_REASON_MIN)} and ${n(PAYROLL_REASON_MAX)}`,
    ),
    check(
      'payroll_adjustments_cancel_check',
      sql`((${table.archivedAt} is null) = (${table.cancelReason} is null))
        and ((${table.archivedAt} is null) = (${table.cancelledByUserId} is null))
        and (${table.cancelReason} is null or char_length(${table.cancelReason})
          between ${n(PAYROLL_REASON_MIN)} and ${n(PAYROLL_REASON_MAX)})`,
    ),
    index('payroll_adjustments_period_idx').on(table.institutionId, table.periodId),
    index('payroll_adjustments_membership_idx').on(table.institutionId, table.membershipId),
    index('payroll_adjustments_target_idx')
      .on(table.institutionId, table.targetMonth)
      .where(sql`${table.archivedAt} is null`),
  ],
)
