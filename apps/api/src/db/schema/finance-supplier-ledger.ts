import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
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
  SUPPLIER_AMOUNT_MAX_CENTS,
  SUPPLIER_INVOICE_NOTE_MAX,
  SUPPLIER_INVOICE_NUMBER_MAX,
  SUPPLIER_PAYMENT_DESCRIPTION_MAX,
  SUPPLIER_PAYMENT_METHODS,
  SUPPLIER_REASON_MAX,
  type SupplierPaymentMethod,
} from '@kampus/school-core/lib/finance-supplier-ledger.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { purchaseOrders } from './finance-purchase-orders.ts'
import { suppliers } from './finance-suppliers.ts'
import { bankAccounts } from './payments.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Tedarikçi faturası (DOM-FIN-076; ON-143). Net, KDV ve KDV dahil tutar saklanır (fatura belgesinin
 * kopyası); ödenen ve kalan ödemelerden hesaplanır. Numara tedarikçide etkin faturalar arasında
 * tekildir (K-161). Silinmez, gerekçeyle iptal edilir.
 */
export const supplierInvoices = pgTable(
  'supplier_invoices',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    invoiceNumber: text('invoice_number').notNull(),
    invoiceDate: date('invoice_date', { mode: 'string' }).notNull(),
    netCents: bigint('net_cents', { mode: 'number' }).notNull(),
    vatCents: bigint('vat_cents', { mode: 'number' }).notNull(),
    grossCents: bigint('gross_cents', { mode: 'number' }).notNull(),
    amountIncludesVat: boolean('amount_includes_vat').notNull(),
    currency: text('currency').notNull().default('TRY'),
    purchaseOrderId: uuid('purchase_order_id'),
    note: text('note'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    cancelReason: text('cancel_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'supplier_invoices_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'supplier_invoices_supplier_fkey',
      columns: [table.institutionId, table.supplierId],
      foreignColumns: [suppliers.institutionId, suppliers.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'supplier_invoices_purchase_order_fkey',
      columns: [table.institutionId, table.purchaseOrderId],
      foreignColumns: [purchaseOrders.institutionId, purchaseOrders.id],
    }).onDelete('restrict'),
    check(
      'supplier_invoices_number_check',
      sql`char_length(${table.invoiceNumber}) between 1 and ${n(SUPPLIER_INVOICE_NUMBER_MAX)}`,
    ),
    check(
      'supplier_invoices_amount_check',
      sql`${table.netCents} >= 0 and ${table.vatCents} >= 0
        and ${table.grossCents} between 1 and ${n(SUPPLIER_AMOUNT_MAX_CENTS)}
        and ${table.grossCents} = ${table.netCents} + ${table.vatCents}`,
    ),
    check('supplier_invoices_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'supplier_invoices_text_check',
      sql`(${table.note} is null or char_length(${table.note}) <= ${n(SUPPLIER_INVOICE_NOTE_MAX)})
        and (${table.cancelReason} is null or char_length(${table.cancelReason}) <= ${n(SUPPLIER_REASON_MAX)})`,
    ),
    check(
      'supplier_invoices_cancel_check',
      sql`((${table.cancelledAt} is null) = (${table.cancelledByUserId} is null))
        and ((${table.cancelledAt} is null) = (${table.cancelReason} is null))`,
    ),
    uniqueIndex('supplier_invoices_number_key')
      .on(table.institutionId, table.supplierId, table.invoiceNumber)
      .where(sql`${table.cancelledAt} is null and ${table.archivedAt} is null`),
    index('supplier_invoices_supplier_idx').on(table.institutionId, table.supplierId),
    index('supplier_invoices_purchase_order_idx').on(table.institutionId, table.purchaseOrderId),
    index('supplier_invoices_date_idx').on(table.institutionId, table.invoiceDate),
  ],
)

/**
 * Faturanın ödeme planı taksiti. Etkin taksitlerin toplamı faturanın KDV dahil tutarıdır; plan
 * yeniden yazılınca eski taksitler arşivlenir (yalnız ödemesiz faturada).
 */
export const supplierInvoiceInstallments = pgTable(
  'supplier_invoice_installments',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    position: integer('position').notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'supplier_invoice_installments_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'supplier_invoice_installments_invoice_fkey',
      columns: [table.institutionId, table.invoiceId],
      foreignColumns: [supplierInvoices.institutionId, supplierInvoices.id],
    }).onDelete('restrict'),
    check('supplier_invoice_installments_position_check', sql`${table.position} >= 0`),
    check(
      'supplier_invoice_installments_amount_check',
      sql`${table.amountCents} between 1 and ${n(SUPPLIER_AMOUNT_MAX_CENTS)}`,
    ),
    check('supplier_invoice_installments_currency_check', sql`${table.currency} = 'TRY'`),
    uniqueIndex('supplier_invoice_installments_position_key')
      .on(table.institutionId, table.invoiceId, table.position)
      .where(sql`${table.archivedAt} is null`),
    index('supplier_invoice_installments_invoice_idx').on(table.institutionId, table.invoiceId),
  ],
)

/**
 * Tedarikçi ödemesi: bir taksite yazılır, kısmi olabilir; taksitin kalanını aşmaz (kurum kilidi
 * altında). Silinmez, gerekçeyle iptal edilir. Talimat dosyasına alınması işaretlenir (K-165).
 */
export const supplierPayments = pgTable(
  'supplier_payments',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    installmentId: uuid('installment_id').notNull(),
    paidDate: date('paid_date', { mode: 'string' }).notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    method: text('method').$type<SupplierPaymentMethod>().notNull(),
    bankAccountId: uuid('bank_account_id'),
    description: text('description'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    cancelReason: text('cancel_reason'),
    instructionExportedAt: timestamp('instruction_exported_at', { withTimezone: true }),
    // kvkk: K
    instructionExportedByUserId: text('instruction_exported_by_user_id'),
    instructionExportCount: integer('instruction_export_count').notNull().default(0),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'supplier_payments_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'supplier_payments_supplier_fkey',
      columns: [table.institutionId, table.supplierId],
      foreignColumns: [suppliers.institutionId, suppliers.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'supplier_payments_invoice_fkey',
      columns: [table.institutionId, table.invoiceId],
      foreignColumns: [supplierInvoices.institutionId, supplierInvoices.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'supplier_payments_installment_fkey',
      columns: [table.institutionId, table.installmentId],
      foreignColumns: [supplierInvoiceInstallments.institutionId, supplierInvoiceInstallments.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'supplier_payments_bank_account_fkey',
      columns: [table.institutionId, table.bankAccountId],
      foreignColumns: [bankAccounts.institutionId, bankAccounts.id],
    }).onDelete('restrict'),
    check(
      'supplier_payments_amount_check',
      sql`${table.amountCents} between 1 and ${n(SUPPLIER_AMOUNT_MAX_CENTS)}`,
    ),
    check('supplier_payments_currency_check', sql`${table.currency} = 'TRY'`),
    check('supplier_payments_method_check', oneOf(table.method, SUPPLIER_PAYMENT_METHODS)),
    // Nakit kasadan çıkar, hesabı yoktur; öteki yöntemler kurum hesabından (DOM-FIN-032).
    check(
      'supplier_payments_bank_account_check',
      sql`(${table.method} = 'cash') = (${table.bankAccountId} is null)`,
    ),
    check(
      'supplier_payments_text_check',
      sql`(${table.description} is null or char_length(${table.description}) <= ${n(SUPPLIER_PAYMENT_DESCRIPTION_MAX)})
        and (${table.cancelReason} is null or char_length(${table.cancelReason}) <= ${n(SUPPLIER_REASON_MAX)})`,
    ),
    check(
      'supplier_payments_lifecycle_check',
      sql`((${table.cancelledAt} is null) = (${table.cancelledByUserId} is null))
        and ((${table.cancelledAt} is null) = (${table.cancelReason} is null))
        and ((${table.instructionExportedAt} is null) = (${table.instructionExportedByUserId} is null))
        and ((${table.instructionExportedAt} is null) = (${table.instructionExportCount} = 0))`,
    ),
    index('supplier_payments_supplier_idx').on(table.institutionId, table.supplierId),
    index('supplier_payments_invoice_idx').on(table.institutionId, table.invoiceId),
    index('supplier_payments_installment_idx').on(table.institutionId, table.installmentId),
    index('supplier_payments_bank_account_idx').on(table.institutionId, table.bankAccountId),
    index('supplier_payments_paid_date_idx').on(table.institutionId, table.paidDate),
  ],
)
