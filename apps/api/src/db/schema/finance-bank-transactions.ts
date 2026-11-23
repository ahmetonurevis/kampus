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

import { BANK_TRANSACTION_STATUSES } from '@kampus/school-core/lib/finance-bank-matching.ts'
import { BANK_STATEMENT_FORMATS } from '@kampus/school-core/lib/finance-bank-statement.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { bankAccounts, payments } from './payments.ts'

/**
 * Banka ekstresinden aktarılan gelen hareket (IST-115, ON-099; DOM-FIN-069). Dosya saklanmaz; yalnız
 * gelen (alacak) hareket satırı yazılır (K-106). Tutar, gün, açıklama ve referans değişmez; yalnız
 * durum değişir: `unmatched` → `matched` (onayla aynı transaction'da tahsilat yazılır) ya da
 * `ignored` (gerekçeli). Eşleşme tahsilat iptaliyle geri açılır (K-111). Parmak izi hesap, gün,
 * tutar ile banka referansının, referans yoksa normalleştirilmiş açıklamanın sha256 özetidir
 * (K-107, K-120); aynı hareket ikinci kez yazılmaz. Aynı havalenin biçimden biçime farklı açıklamalı
 * ikizi onayda olası mükerrer denetimine takılır (K-121).
 */
export const bankTransactions = pgTable(
  'bank_transactions',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    bankAccountId: uuid('bank_account_id').notNull(),
    bookingDate: date('booking_date').notNull(),
    // kvkk: Ç
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    // kvkk: Ç — gönderenin yazdığı metin; ad, kimlik no ve IBAN içerebilir, yanıtta maskelenir.
    statementDescription: text('statement_description').notNull(),
    // kvkk: K
    counterpartyName: text('counterparty_name'),
    // kvkk: Ç
    bankReference: text('bank_reference'),
    balanceCents: bigint('balance_cents', { mode: 'number' }),
    fingerprint: text('fingerprint').notNull(),
    sourceFormat: text('source_format').notNull(),
    importBatchId: uuid('import_batch_id').notNull(),
    sourceLine: integer('source_line').notNull(),
    // kvkk: K
    importedByUserId: text('imported_by_user_id').notNull(),
    status: text('status').notNull().default('unmatched'),
    paymentId: uuid('payment_id'),
    matchedAt: timestamp('matched_at', { withTimezone: true }),
    // kvkk: K
    matchedByUserId: text('matched_by_user_id'),
    ignoredAt: timestamp('ignored_at', { withTimezone: true }),
    // kvkk: K
    ignoredByUserId: text('ignored_by_user_id'),
    // kvkk: Ç
    ignoreReason: text('ignore_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'bank_transactions_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'bank_transactions_bank_account_fkey',
      columns: [table.institutionId, table.bankAccountId],
      foreignColumns: [bankAccounts.institutionId, bankAccounts.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'bank_transactions_payment_fkey',
      columns: [table.institutionId, table.paymentId],
      foreignColumns: [payments.institutionId, payments.id],
    }).onDelete('restrict'),
    check('bank_transactions_amount_check', sql`${table.amountCents} > 0`),
    check('bank_transactions_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'bank_transactions_description_check',
      sql`char_length(${table.statementDescription}) <= 1000`,
    ),
    check('bank_transactions_fingerprint_check', sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
    check(
      'bank_transactions_source_format_check',
      oneOf(table.sourceFormat, BANK_STATEMENT_FORMATS),
    ),
    check('bank_transactions_status_check', oneOf(table.status, BANK_TRANSACTION_STATUSES)),
    check(
      'bank_transactions_lifecycle_check',
      sql`(${table.status} = 'unmatched' and ${table.paymentId} is null and ${table.matchedAt} is null and ${table.matchedByUserId} is null and ${table.ignoredAt} is null and ${table.ignoredByUserId} is null and ${table.ignoreReason} is null)
        or (${table.status} = 'matched' and ${table.paymentId} is not null and ${table.matchedAt} is not null and ${table.matchedByUserId} is not null and ${table.ignoredAt} is null and ${table.ignoreReason} is null)
        or (${table.status} = 'ignored' and ${table.paymentId} is null and ${table.ignoredAt} is not null and ${table.ignoredByUserId} is not null and ${table.ignoreReason} is not null)`,
    ),
    // Aynı hareket hesapta bir kez (DOM-FIN-031); hesap kimliği yabancı anahtar indeksini de taşır.
    uniqueIndex('bank_transactions_fingerprint_key')
      .on(table.institutionId, table.bankAccountId, table.fingerprint)
      .where(sql`${table.archivedAt} is null`),
    // Bir tahsilat tek harekete bağlanır; ikinci onay veritabanında da durur.
    uniqueIndex('bank_transactions_payment_key')
      .on(table.institutionId, table.paymentId)
      .where(sql`${table.paymentId} is not null`),
    index('bank_transactions_status_date_idx').on(
      table.institutionId,
      table.status,
      table.bookingDate,
    ),
  ],
)
