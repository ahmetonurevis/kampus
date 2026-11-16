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
  ORIGINAL_INVOICE_TYPES,
  REFUND_DOCUMENT_KINDS,
  REFUND_DOCUMENT_STATUSES,
  REFUND_VAT_RATES,
} from '@kampus/school-core/lib/finance-refund-invoices.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { studentWithdrawals } from './withdrawals.ts'

/**
 * İade faturası ve iptal isteği (DOM-FIN-096; ON-266; K-292…K-295). Ödenmiş ayrılış iadesine
 * (`student_withdrawals`) bağlı tek belge: asıl faturanın (Kampüs dışında kesilmiş) numarası,
 * tarihi, türü, KDV dahil tutarı ve KDV oranı elle girilir; belge tutarı, KDV hariç tutar ve KDV
 * taslak anında sabitlenir. Aynı iadeye arşivlenmemiş ikinci belge açılmaz (kısmi tekil indeks);
 * vazgeçilen belge arşivlenir, gerekçesi saklanır. Sonucu işlenmiş (gönderildi, iptal edildi)
 * belge değişmez ve arşivlenmez.
 */
export const refundInvoices = pgTable(
  'refund_invoices',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    withdrawalId: uuid('withdrawal_id').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('draft'),
    originalInvoiceNumber: text('original_invoice_number').notNull(),
    originalInvoiceDate: date('original_invoice_date').notNull(),
    originalInvoiceType: text('original_invoice_type').notNull(),
    // kvkk: Ç
    originalTotalCents: bigint('original_total_cents', { mode: 'number' }).notNull(),
    vatRateBasisPoints: integer('vat_rate_basis_points').notNull(),
    // kvkk: Ç
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    netCents: bigint('net_cents', { mode: 'number' }).notNull(),
    vatCents: bigint('vat_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    // kvkk: Ç
    note: text('note'),
    documentNumber: text('document_number'),
    completedDate: date('completed_date'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    // kvkk: K
    readyByUserId: text('ready_by_user_id'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // kvkk: K
    completedByUserId: text('completed_by_user_id'),
    // kvkk: Ç
    discardReason: text('discard_reason'),
    // kvkk: K
    discardedByUserId: text('discarded_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'refund_invoices_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'refund_invoices_withdrawal_fkey',
      columns: [table.institutionId, table.withdrawalId],
      foreignColumns: [studentWithdrawals.institutionId, studentWithdrawals.id],
    }).onDelete('restrict'),
    check('refund_invoices_kind_check', oneOf(table.kind, REFUND_DOCUMENT_KINDS)),
    check('refund_invoices_status_check', oneOf(table.status, REFUND_DOCUMENT_STATUSES)),
    check(
      'refund_invoices_original_type_check',
      oneOf(table.originalInvoiceType, ORIGINAL_INVOICE_TYPES),
    ),
    check('refund_invoices_vat_rate_check', oneOf(table.vatRateBasisPoints, REFUND_VAT_RATES)),
    check('refund_invoices_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'refund_invoices_amounts_check',
      sql`${table.originalTotalCents} > 0 and ${table.amountCents} > 0 and ${table.amountCents} <= ${table.originalTotalCents} and ${table.netCents} >= 0 and ${table.vatCents} >= 0 and ${table.netCents} + ${table.vatCents} = ${table.amountCents}`,
    ),
    // Gönderildi yalnız iade faturasının, iptal edildi yalnız iptal isteğinin sonucudur.
    check(
      'refund_invoices_kind_status_check',
      sql`(${table.kind} = 'return_invoice' and ${table.status} <> 'cancelled') or (${table.kind} = 'cancellation' and ${table.status} <> 'sent')`,
    ),
    check(
      'refund_invoices_completed_check',
      sql`(${table.status} in ('sent', 'cancelled')) = (${table.completedDate} is not null)`,
    ),
    check(
      'refund_invoices_document_number_check',
      sql`(${table.documentNumber} is not null) = (${table.status} = 'sent')`,
    ),
    check(
      'refund_invoices_discard_check',
      sql`(${table.discardReason} is null) = (${table.archivedAt} is null) and (${table.archivedAt} is null or ${table.status} in ('draft', 'ready'))`,
    ),
    uniqueIndex('refund_invoices_withdrawal_key')
      .on(table.institutionId, table.withdrawalId)
      .where(sql`${table.archivedAt} is null`),
    uniqueIndex('refund_invoices_document_number_key')
      .on(table.institutionId, table.documentNumber)
      .where(sql`${table.documentNumber} is not null`),
    index('refund_invoices_withdrawal_idx').on(table.institutionId, table.withdrawalId),
    index('refund_invoices_status_idx').on(table.institutionId, table.status),
  ],
)
