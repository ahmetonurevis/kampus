import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import type { WithdrawalBreakdown } from '@kampus/school-core/lib/withdrawals.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { bankAccounts } from './payments.ts'

/**
 * Ayrılış ve iade kaydı (ADR 0006 karar 10; DOM-FIN-041, DOM-KAY-024). Hesap dökümü `breakdown`'da
 * karar anının kopyasıdır, sonradan değişmez; depo yalnız iade ödemesini günceller. `student_id` ve
 * `contract_id` `records` kimlikleridir, yabancı anahtar değildir. Hesaba birden çok sözleşme girerse
 * (K-06) `contract_id` en yenisidir, bütün kimlikler `breakdown.contracts`'tadır; ADR 0010 046h
 * yabancı anahtarı `contract_id`'ye eklenir, migration gerekmez. İade kurumun bildirilmiş banka
 * hesabından ödenir (`refund_bank_account_id`, M-13); bu kolondan önce ödenmiş iadede hesap boştur.
 */
export const studentWithdrawals = pgTable(
  'student_withdrawals',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: Ç
    studentId: text('student_id').notNull(),
    contractId: text('contract_id').notNull(),
    withdrawalDate: date('withdrawal_date').notNull(),
    reason: text('reason').notNull(),
    // kvkk: Ç
    targetSchool: text('target_school'),
    // kvkk: Ç
    breakdown: jsonb('breakdown').$type<WithdrawalBreakdown>().notNull(),
    // kvkk: Ç
    refundCents: bigint('refund_cents', { mode: 'number' }).notNull(),
    // kvkk: Ç
    debtCents: bigint('debt_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    refundDueDate: date('refund_due_date').notNull(),
    // kvkk: K
    approvedByUserId: text('approved_by_user_id').notNull(),
    refundPaidDate: date('refund_paid_date'),
    // kvkk: Ç
    refundIban: text('refund_iban'),
    // kvkk: K
    refundAccountHolder: text('refund_account_holder'),
    // kvkk: K
    refundPaidByUserId: text('refund_paid_by_user_id'),
    refundBankAccountId: uuid('refund_bank_account_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'student_withdrawals_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'student_withdrawals_refund_bank_account_fkey',
      columns: [table.institutionId, table.refundBankAccountId],
      foreignColumns: [bankAccounts.institutionId, bankAccounts.id],
    }).onDelete('restrict'),
    check(
      'student_withdrawals_refund_bank_account_check',
      sql`${table.refundBankAccountId} is null or ${table.refundPaidDate} is not null`,
    ),
    index('student_withdrawals_refund_bank_account_idx').on(
      table.institutionId,
      table.refundBankAccountId,
    ),
    index('student_withdrawals_refund_paid_idx').on(table.institutionId, table.refundPaidDate),
    check(
      'student_withdrawals_reason_check',
      oneOf(table.reason, [
        'transfer',
        'relocation',
        'documented',
        'financial',
        'dissatisfaction',
        'other',
      ]),
    ),
    check('student_withdrawals_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'student_withdrawals_amounts_check',
      sql`${table.refundCents} >= 0 and ${table.debtCents} >= 0`,
    ),
    uniqueIndex('student_withdrawals_contract_key').on(table.institutionId, table.contractId),
    index('student_withdrawals_due_idx').on(table.institutionId, table.refundDueDate),
    index('student_withdrawals_student_idx').on(table.institutionId, table.studentId),
  ],
)
