import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { institutions } from './auth.ts'
import { requiredColumns } from './columns.ts'

/**
 * Yöntem özeti satırı; `method` `payments.method` anahtarıdır (core etiketi depoda çevrilir).
 * İade alanları migration 0083'ten, tedarikçi ödemesi alanları 0086'dan önceki kapanışta yoktur ve
 * sıfır okunur (M-13, K-166).
 */
export interface StoredDayMethodTotal {
  method: string
  collectedCount: number
  collectedCents: number
  reversedCount: number
  reversedCents: number
  refundPaidCount?: number
  refundPaidCents?: number
  supplierPaidCount?: number
  supplierPaidCents?: number
  netCents: number
}

/**
 * Gün kapanışı (IST-113, DOM-FIN-036). Satır kapanış anının özetini taşır ve silinmez: yeniden açma
 * aynı satıra gerekçeyle yazılır, yeni kapanış yeni satırdır; tetikleyici bunun dışındaki değişikliği
 * reddeder (migration). Günde en çok bir geçerli kapanış vardır. O gün ödenen ayrılış iadesi (M-13)
 * ve kasadan ödenen tedarikçi ödemesi (K-166) ayrı sayılır ve netten düşer.
 */
export const financeDayClosings = pgTable(
  'finance_day_closings',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    closingDate: date('closing_date', { mode: 'string' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    methodTotals: jsonb('method_totals').$type<StoredDayMethodTotal[]>().notNull(),
    collectedCount: integer('collected_count').notNull(),
    collectedCents: bigint('collected_cents', { mode: 'number' }).notNull(),
    reversedCount: integer('reversed_count').notNull(),
    reversedCents: bigint('reversed_cents', { mode: 'number' }).notNull(),
    refundPaidCount: integer('refund_paid_count').notNull().default(0),
    refundPaidCents: bigint('refund_paid_cents', { mode: 'number' }).notNull().default(0),
    supplierPaidCount: integer('supplier_paid_count').notNull().default(0),
    supplierPaidCents: bigint('supplier_paid_cents', { mode: 'number' }).notNull().default(0),
    netCents: bigint('net_cents', { mode: 'number' }).notNull(),
    openingCashCents: bigint('opening_cash_cents', { mode: 'number' }),
    countedCashCents: bigint('counted_cash_cents', { mode: 'number' }),
    expectedCashCents: bigint('expected_cash_cents', { mode: 'number' }),
    cashDifferenceCents: bigint('cash_difference_cents', { mode: 'number' }),
    // kvkk: Ç
    note: text('note'),
    closedAt: timestamp('closed_at', { withTimezone: true }).notNull(),
    // kvkk: K
    closedByUserId: text('closed_by_user_id').notNull(),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    // kvkk: K
    reopenedByUserId: text('reopened_by_user_id'),
    // kvkk: Ç
    reopenReason: text('reopen_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'finance_day_closings_pkey', columns: [table.institutionId, table.id] }),
    uniqueIndex('finance_day_closings_closing_date_key')
      .on(table.institutionId, table.closingDate)
      .where(sql`${table.reopenedAt} is null`),
    index('finance_day_closings_closing_date_idx').on(
      table.institutionId,
      table.closingDate,
      table.closedAt,
    ),
    check('finance_day_closings_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'finance_day_closings_net_check',
      sql`${table.netCents} = ${table.collectedCents} - ${table.reversedCents} - ${table.refundPaidCents} - ${table.supplierPaidCents}`,
    ),
    check(
      'finance_day_closings_cash_check',
      sql`(${table.countedCashCents} is null and ${table.openingCashCents} is null and ${table.expectedCashCents} is null and ${table.cashDifferenceCents} is null) or (${table.countedCashCents} is not null and ${table.openingCashCents} is not null and ${table.expectedCashCents} is not null and ${table.cashDifferenceCents} = ${table.countedCashCents} - ${table.expectedCashCents})`,
    ),
    check(
      'finance_day_closings_reopen_check',
      sql`(${table.reopenedAt} is null and ${table.reopenedByUserId} is null and ${table.reopenReason} is null) or (${table.reopenedAt} is not null and ${table.reopenedByUserId} is not null and ${table.reopenReason} is not null)`,
    ),
  ],
)
