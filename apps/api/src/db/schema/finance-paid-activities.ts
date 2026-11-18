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
  LATE_REFUND_RULES,
  PAID_ACTIVITY_KINDS,
  PAID_ACTIVITY_STATUSES,
  PARTICIPATION_CANCEL_KINDS,
  PARTICIPATION_STATUSES,
} from '@kampus/school-core/lib/finance-paid-activities.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { bankAccounts } from './payments.ts'

/**
 * Gezi ve etkinlik ücreti (DOM-FIN-098; ON-142; K-300…K-303): ücretli etkinlik ve katılımcıları.
 * Katılımın taksiti `invoices`'tadır (`fee_kind = 'activity'`); `student_id` ve taksit kimlikleri
 * `records` kimlikleridir, yabancı anahtar değildir. `external_ref` gezi planına (ON-155) bağlanacak
 * boş alandır.
 */
export const paidActivities = pgTable(
  'paid_activities',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    activityDate: date('activity_date').notNull(),
    feeCents: bigint('fee_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    joinDeadline: date('join_deadline').notNull(),
    cancelDeadline: date('cancel_deadline').notNull(),
    capacity: integer('capacity').notNull(),
    lateRefundRule: text('late_refund_rule').notNull(),
    lateRefundPercent: integer('late_refund_percent'),
    lateCostCents: bigint('late_cost_cents', { mode: 'number' }),
    externalRef: text('external_ref'),
    status: text('status').notNull().default('open'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'paid_activities_pkey', columns: [table.institutionId, table.id] }),
    check('paid_activities_kind_check', oneOf(table.kind, PAID_ACTIVITY_KINDS)),
    check('paid_activities_status_check', oneOf(table.status, PAID_ACTIVITY_STATUSES)),
    check('paid_activities_rule_check', oneOf(table.lateRefundRule, LATE_REFUND_RULES)),
    check('paid_activities_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'paid_activities_amounts_check',
      sql`${table.feeCents} > 0 and ${table.capacity} > 0
        and (${table.lateCostCents} is null or ${table.lateCostCents} between 0 and ${table.feeCents})
        and (${table.lateRefundPercent} is null or ${table.lateRefundPercent} between 0 and 100)`,
    ),
    check(
      'paid_activities_rule_terms_check',
      sql`(${table.lateRefundRule} = 'percent') = (${table.lateRefundPercent} is not null)
        and (${table.lateRefundRule} = 'cost') = (${table.lateCostCents} is not null)`,
    ),
    check(
      'paid_activities_dates_check',
      sql`${table.joinDeadline} <= ${table.activityDate} and ${table.cancelDeadline} <= ${table.activityDate}`,
    ),
    check(
      'paid_activities_cancel_check',
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null)
        and (${table.cancelledAt} is null) = (${table.cancelReason} is null)
        and (${table.cancelledAt} is null) = (${table.cancelledByUserId} is null)`,
    ),
    index('paid_activities_date_idx').on(table.institutionId, table.activityDate),
  ],
)

export const paidActivityParticipants = pgTable(
  'paid_activity_participants',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    activityId: uuid('activity_id').notNull(),
    // kvkk: K
    studentId: text('student_id').notNull(),
    invoiceId: text('invoice_id').notNull(),
    // kvkk: Ç
    feeCents: bigint('fee_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    joinedDate: date('joined_date').notNull(),
    status: text('status').notNull().default('active'),
    cancelKind: text('cancel_kind'),
    cancelledDate: date('cancelled_date'),
    // kvkk: Ç
    paidCents: bigint('paid_cents', { mode: 'number' }),
    // kvkk: Ç
    retainedCents: bigint('retained_cents', { mode: 'number' }),
    // kvkk: Ç
    refundCents: bigint('refund_cents', { mode: 'number' }).notNull().default(0),
    closedInvoiceId: text('closed_invoice_id'),
    debtInvoiceId: text('debt_invoice_id'),
    refundPaidDate: date('refund_paid_date'),
    // kvkk: Ç
    refundIban: text('refund_iban'),
    // kvkk: K
    refundAccountHolder: text('refund_account_holder'),
    // kvkk: K
    refundPaidByUserId: text('refund_paid_by_user_id'),
    refundBankAccountId: uuid('refund_bank_account_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'paid_activity_participants_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'paid_activity_participants_activity_fkey',
      columns: [table.institutionId, table.activityId],
      foreignColumns: [paidActivities.institutionId, paidActivities.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'paid_activity_participants_refund_bank_account_fkey',
      columns: [table.institutionId, table.refundBankAccountId],
      foreignColumns: [bankAccounts.institutionId, bankAccounts.id],
    }).onDelete('restrict'),
    check('paid_activity_participants_status_check', oneOf(table.status, PARTICIPATION_STATUSES)),
    check(
      'paid_activity_participants_cancel_kind_check',
      oneOf(table.cancelKind, PARTICIPATION_CANCEL_KINDS),
    ),
    check('paid_activity_participants_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'paid_activity_participants_cancel_check',
      sql`(${table.status} = 'cancelled') = (${table.cancelledDate} is not null)
        and (${table.cancelledDate} is null) = (${table.cancelKind} is null)
        and (${table.cancelledDate} is null) = (${table.paidCents} is null)
        and (${table.cancelledDate} is null) = (${table.retainedCents} is null)
        and (${table.cancelledDate} is null) = (${table.cancelledByUserId} is null)
        and (${table.cancelledDate} is not null or ${table.refundCents} = 0)`,
    ),
    check(
      'paid_activity_participants_amounts_check',
      sql`${table.feeCents} > 0 and ${table.refundCents} >= 0
        and (${table.paidCents} is null or ${table.paidCents} >= 0)
        and (${table.retainedCents} is null or ${table.retainedCents} between 0 and ${table.feeCents})`,
    ),
    check(
      'paid_activity_participants_refund_paid_check',
      sql`(${table.refundPaidDate} is null) = (${table.refundIban} is null)
        and (${table.refundPaidDate} is null) = (${table.refundAccountHolder} is null)
        and (${table.refundPaidDate} is null) = (${table.refundPaidByUserId} is null)
        and (${table.refundPaidDate} is null) = (${table.refundBankAccountId} is null)
        and (${table.refundPaidDate} is null or ${table.refundCents} > 0)`,
    ),
    // Öğrencinin bir etkinlikte tek iptal edilmemiş katılımı olur (K-301).
    uniqueIndex('paid_activity_participants_student_key')
      .on(table.institutionId, table.activityId, table.studentId)
      .where(sql`${table.status} = 'active' and ${table.archivedAt} is null`),
    index('paid_activity_participants_activity_idx').on(table.institutionId, table.activityId),
    index('paid_activity_participants_student_idx').on(table.institutionId, table.studentId),
    index('paid_activity_participants_refund_bank_account_idx')
      .on(table.institutionId, table.refundBankAccountId)
      .where(sql`${table.refundBankAccountId} is not null`),
    index('paid_activity_participants_refund_paid_idx')
      .on(table.institutionId, table.refundPaidDate)
      .where(sql`${table.refundPaidDate} is not null`),
  ],
)
