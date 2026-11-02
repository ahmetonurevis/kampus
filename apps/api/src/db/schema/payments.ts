import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
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

import type { PaymentMethod } from '@kampus/school-core/lib/payments.ts'
import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

/**
 * Kurumun bildirilmiş banka hesapları (DOM-FIN-032). Arşivlenen hesap yeni tahsilatta seçilmez,
 * geçmiş tahsilat bağını korur.
 */
export const bankAccounts = pgTable(
  'bank_accounts',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    bankName: text('bank_name').notNull(),
    iban: text('iban').notNull(),
    accountHolder: text('account_holder').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'bank_accounts_pkey', columns: [table.institutionId, table.id] }),
    uniqueIndex('bank_accounts_iban_key')
      .on(table.institutionId, table.iban)
      .where(sql`${table.archivedAt} is null`),
  ],
)

/**
 * Tahsilat (ADR 0006; DOM-FIN-030…033, DOM-FIN-050). Satır silinmez, tutarı değişmez; iptal aynı
 * satıra gerekçeyle yazılır. `student_id` `records` kimliğidir, yabancı anahtar değildir.
 */
export const payments = pgTable(
  'payments',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: Ç
    studentId: text('student_id').notNull(),
    // kvkk: Ç
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    method: text('method').notNull(),
    // kvkk: Ç
    reference: text('reference'),
    bankAccountId: uuid('bank_account_id'),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
    receiptYear: integer('receipt_year').notNull(),
    receiptNumber: integer('receipt_number').notNull(),
    // kvkk: K
    recordedByUserId: text('recorded_by_user_id').notNull(),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    // kvkk: K
    reversedByUserId: text('reversed_by_user_id'),
    // kvkk: Ç
    reversalReason: text('reversal_reason'),
    mebbisRecordedAt: timestamp('mebbis_recorded_at', { withTimezone: true }),
    // kvkk: K
    mebbisRecordedByUserId: text('mebbis_recorded_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'payments_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'payments_bank_account_fkey',
      columns: [table.institutionId, table.bankAccountId],
      foreignColumns: [bankAccounts.institutionId, bankAccounts.id],
    }).onDelete('restrict'),
    check(
      'payments_mebbis_check',
      sql`(${table.mebbisRecordedAt} is null) = (${table.mebbisRecordedByUserId} is null)`,
    ),
    index('payments_bank_account_idx').on(table.institutionId, table.bankAccountId),
    check('payments_amount_cents_check', sql`${table.amountCents} > 0`),
    check('payments_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'payments_method_check',
      oneOf(table.method, ['bank_transfer', 'cash', 'card', 'promissory_note']),
    ),
    check(
      'payments_reversal_check',
      sql`(${table.reversedAt} is null and ${table.reversedByUserId} is null and ${table.reversalReason} is null) or (${table.reversedAt} is not null and ${table.reversedByUserId} is not null and ${table.reversalReason} is not null)`,
    ),
    // İptal edilen tahsilatın referansı doğru kayıtta yeniden kullanılabilir (DOM-FIN-033).
    uniqueIndex('payments_reference_key')
      .on(table.institutionId, table.reference)
      .where(sql`${table.reference} is not null and ${table.reversedAt} is null`),
    uniqueIndex('payments_receipt_key').on(
      table.institutionId,
      table.receiptYear,
      table.receiptNumber,
    ),
    index('payments_student_paid_at_idx').on(table.institutionId, table.studentId, table.paidAt),
    index('payments_paid_at_idx').on(table.institutionId, table.paidAt),
  ],
)

/** Tahsilatın taksitlere dağılımı. `invoice_id` `records` kimliğidir (ADR 0006 karar 2). */
export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    institutionId: text('institution_id').notNull(),
    paymentId: uuid('payment_id').notNull(),
    invoiceId: text('invoice_id').notNull(),
    // kvkk: Ç
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'payment_allocations_pkey',
      columns: [table.institutionId, table.paymentId, table.invoiceId],
    }),
    foreignKey({
      name: 'payment_allocations_payment_fkey',
      columns: [table.institutionId, table.paymentId],
      foreignColumns: [payments.institutionId, payments.id],
    }).onDelete('restrict'),
    check('payment_allocations_amount_cents_check', sql`${table.amountCents} > 0`),
    index('payment_allocations_invoice_idx').on(table.institutionId, table.invoiceId),
  ],
)

/**
 * Kurumun tahsilat ayarı (ADR 0006 karar 7, DOM-FIN-032). Satır yoksa nakit kapalı, sürüm 1
 * sayılır; ilk değişiklik satırı sürüm 2 ile açar.
 */
export const paymentSettings = pgTable('payment_settings', {
  institutionId: text('institution_id')
    .primaryKey()
    .references(() => institutions.id),
  cashPaymentsEnabled: boolean('cash_payments_enabled').notNull().default(false),
  ...requiredColumns(),
})

/** Saklanan yöntem anahtarı ↔ core etiketi; core değerleri Türkçe etikettir, `check` ASCII ister. */
export const PAYMENT_METHOD_KEYS = {
  'Banka havalesi': 'bank_transfer',
  Nakit: 'cash',
  'Kredi kartı': 'card',
  Senet: 'promissory_note',
} as const satisfies Record<PaymentMethod, string>
