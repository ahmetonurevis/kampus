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

import { FEE_ITEM_KINDS } from '@kampus/school-core/lib/fee-tariffs.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

/**
 * Kurumsal müşteri (DOM-FIN-060; IST-089). Yalnız dil okulunda açılır. Vergi numarası etkin
 * müşteriler arasında tekildir. Kesilmiş toplu fatura şirket bilgisinin kopyasını taşır; bu satırın
 * düzeltmesi geçmiş faturayı değiştirmez. Silme arşivdir.
 */
export const corporateCustomers = pgTable(
  'corporate_customers',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    // kvkk: K (şahıs şirketinde TCKN)
    taxNumber: text('tax_number').notNull(),
    taxOffice: text('tax_office').notNull(),
    billingAddress: text('billing_address').notNull(),
    // kvkk: K
    contactName: text('contact_name'),
    // kvkk: K
    contactEmail: text('contact_email'),
    // kvkk: K
    contactPhone: text('contact_phone'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'corporate_customers_pkey', columns: [table.institutionId, table.id] }),
    check('corporate_customers_tax_number_check', sql`${table.taxNumber} ~ '^[0-9]{10,11}$'`),
    uniqueIndex('corporate_customers_tax_number_key')
      .on(table.institutionId, table.taxNumber)
      .where(sql`${table.archivedAt} is null`),
  ],
)

/**
 * Kursiyerin şirket bağı (DOM-FIN-060, DOM-DIL-093). Bağ sözleşmenin ödeyicisini değiştirmez
 * (K-45); toplu fatura bağın günleri içinde vadesi gelen taksitleri seçer. Kursiyerin tek etkin
 * (bitişsiz) bağı olur; bitirilen bağ silinmez, geçmiş dönemin faturası için kalır. `student_id`
 * `records` kimliğidir, yabancı anahtar değildir.
 */
export const corporateCustomerEmployees = pgTable(
  'corporate_customer_employees',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    customerId: uuid('customer_id').notNull(),
    // kvkk: K
    studentId: text('student_id').notNull(),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }),
    noticeConfirmedAt: timestamp('notice_confirmed_at', { withTimezone: true }).notNull(),
    // kvkk: K
    noticeConfirmedByUserId: text('notice_confirmed_by_user_id').notNull(),
    // kvkk: K
    endedByUserId: text('ended_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'corporate_customer_employees_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'corporate_customer_employees_customer_fkey',
      columns: [table.institutionId, table.customerId],
      foreignColumns: [corporateCustomers.institutionId, corporateCustomers.id],
    }).onDelete('restrict'),
    check(
      'corporate_customer_employees_period_check',
      sql`${table.endsOn} is null or ${table.endsOn} >= ${table.startsOn}`,
    ),
    check(
      'corporate_customer_employees_ended_check',
      sql`(${table.endsOn} is null) = (${table.endedByUserId} is null)`,
    ),
    // Kursiyerin tek etkin bağı (core `corporate_employee_linked`).
    uniqueIndex('corporate_customer_employees_active_key')
      .on(table.institutionId, table.studentId)
      .where(sql`${table.endsOn} is null and ${table.archivedAt} is null`),
    index('corporate_customer_employees_customer_idx').on(table.institutionId, table.customerId),
    index('corporate_customer_employees_student_idx').on(table.institutionId, table.studentId),
  ],
)

/**
 * Toplu fatura (DOM-FIN-060). Şirket bilgisi, toplam ve satır sayısı kesildiği anın kopyasıdır.
 * Numara kurumda takvim yılı içinde ardışıktır (K-53). İptal satırları arşivler; fatura satırı
 * gerekçesiyle kalır.
 */
export const corporateInvoices = pgTable(
  'corporate_invoices',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    customerId: uuid('customer_id').notNull(),
    number: text('number').notNull(),
    numberYear: integer('number_year').notNull(),
    numberSequence: integer('number_sequence').notNull(),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    customerName: text('customer_name').notNull(),
    // kvkk: K (şahıs şirketinde TCKN)
    taxNumber: text('tax_number').notNull(),
    taxOffice: text('tax_office').notNull(),
    billingAddress: text('billing_address').notNull(),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull(),
    lineCount: integer('line_count').notNull(),
    currency: text('currency').notNull().default('TRY'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    // kvkk: K
    issuedByUserId: text('issued_by_user_id').notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    cancelReason: text('cancel_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'corporate_invoices_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'corporate_invoices_customer_fkey',
      columns: [table.institutionId, table.customerId],
      foreignColumns: [corporateCustomers.institutionId, corporateCustomers.id],
    }).onDelete('restrict'),
    check('corporate_invoices_total_check', sql`${table.totalCents} > 0`),
    check('corporate_invoices_line_count_check', sql`${table.lineCount} > 0`),
    check('corporate_invoices_currency_check', sql`${table.currency} = 'TRY'`),
    check('corporate_invoices_period_check', sql`${table.periodTo} >= ${table.periodFrom}`),
    check('corporate_invoices_sequence_check', sql`${table.numberSequence} > 0`),
    check(
      'corporate_invoices_cancel_check',
      sql`((${table.cancelledAt} is null) = (${table.cancelledByUserId} is null)) and ((${table.cancelledAt} is null) = (${table.cancelReason} is null))`,
    ),
    uniqueIndex('corporate_invoices_number_key').on(table.institutionId, table.number),
    uniqueIndex('corporate_invoices_sequence_key').on(
      table.institutionId,
      table.numberYear,
      table.numberSequence,
    ),
    index('corporate_invoices_customer_idx').on(table.institutionId, table.customerId),
  ],
)

/**
 * Toplu fatura satırı: bir taksitin kopyası. Bir taksit en çok bir geçerli faturada yer alır
 * (`corporate_invoice_lines_invoice_key`); ek protokolle yerine gelen taksit aynı zincir ve numarayla
 * de engellenir (`corporate_invoice_lines_chain_key`, K-52). Fatura iptali satırı arşivler ve taksiti
 * serbest bırakır. `invoice_id`, `student_id` ve `root_contract_id` `records` kimlikleridir.
 */
export const corporateInvoiceLines = pgTable(
  'corporate_invoice_lines',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    corporateInvoiceId: uuid('corporate_invoice_id').notNull(),
    invoiceId: text('invoice_id').notNull(),
    // kvkk: K
    studentId: text('student_id').notNull(),
    rootContractId: text('root_contract_id'),
    installment: integer('installment').notNull(),
    feeKind: text('fee_kind'),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    // kvkk: Ç
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'corporate_invoice_lines_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'corporate_invoice_lines_invoice_fkey',
      columns: [table.institutionId, table.corporateInvoiceId],
      foreignColumns: [corporateInvoices.institutionId, corporateInvoices.id],
    }).onDelete('restrict'),
    check('corporate_invoice_lines_amount_check', sql`${table.amountCents} > 0`),
    check('corporate_invoice_lines_installment_check', sql`${table.installment} > 0`),
    check('corporate_invoice_lines_fee_kind_check', oneOf(table.feeKind, FEE_ITEM_KINDS)),
    uniqueIndex('corporate_invoice_lines_invoice_key')
      .on(table.institutionId, table.invoiceId)
      .where(sql`${table.archivedAt} is null`),
    uniqueIndex('corporate_invoice_lines_chain_key')
      .on(table.institutionId, table.rootContractId, table.installment)
      .where(sql`${table.archivedAt} is null and ${table.rootContractId} is not null`),
    index('corporate_invoice_lines_corporate_invoice_idx').on(
      table.institutionId,
      table.corporateInvoiceId,
    ),
  ],
)
