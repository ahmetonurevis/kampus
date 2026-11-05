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
} from 'drizzle-orm/pg-core'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { contracts } from './contracts.ts'
import { PAYMENT_METHOD_KEYS } from './payments.ts'

/**
 * Taksit (ADR 0010 karar 1; DOM-FIN-011, -012, -030). Kimlik `records` kimliğidir. `paid_at` ve
 * `payment_method` geçiş önbelleğidir (ADR 0006 karar 3, ADR 0010 karar 5); tahsilatın kaynağı
 * `payment_allocations`'tır. Onaylı sözleşme sürümüne bağlı taksitin koşulları tetikleyiciyle donar;
 * onaylanmamış sürümün taksiti düzeltilebilir (ADR 0010 cevap 6). `student_id` `records`
 * kimliğidir, yabancı anahtar değildir. ON-046e'den beri `records`'un aynasıdır (migration 0063,
 * `db/finance-mirror-store.ts`); okuma geçişine (046f) kadar uygulama bu tablodan okumaz.
 */
export const invoices = pgTable(
  'invoices',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: text('id').notNull(),
    // kvkk: Ç
    studentId: text('student_id').notNull(),
    contractId: text('contract_id'),
    rootContractId: text('root_contract_id'),
    academicYear: integer('academic_year'),
    installment: integer('installment').notNull(),
    feeKind: text('fee_kind'),
    // kvkk: Ç
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    dueDate: date('due_date').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paymentMethod: text('payment_method'),
    reminderAt: timestamp('reminder_at', { withTimezone: true }),
    coreCreatedAt: timestamp('core_created_at', { withTimezone: true }),
    coreUpdatedAt: timestamp('core_updated_at', { withTimezone: true }),
    position: bigint('position', { mode: 'number' }).notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'invoices_pkey', columns: [table.institutionId, table.id] }),
    // Kök kopyası sürümün köküyle aynı olmak zorundadır (`contracts_id_root_key`); ayrı kök
    // yabancı anahtarı gerekmez, çünkü sürümün kökü zaten `contracts_root_contract_fkey`'le vardır.
    foreignKey({
      name: 'invoices_contract_fkey',
      columns: [table.institutionId, table.contractId, table.rootContractId],
      foreignColumns: [contracts.institutionId, contracts.id, contracts.rootContractId],
    }).onDelete('restrict'),
    check('invoices_amount_cents_check', sql`${table.amountCents} > 0`),
    check('invoices_installment_check', sql`${table.installment} > 0`),
    check('invoices_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'invoices_payment_method_check',
      oneOf(table.paymentMethod, Object.values(PAYMENT_METHOD_KEYS)),
    ),
    check('invoices_paid_check', sql`(${table.paidAt} is null) = (${table.paymentMethod} is null)`),
    check(
      'invoices_contract_root_check',
      sql`(${table.contractId} is null) = (${table.rootContractId} is null)`,
    ),
    // Sözleşme zincirinde taksit numarası tekildir; arşivlenen (yerine gelen) taksit numarasını bırakır.
    uniqueIndex('invoices_installment_key')
      .on(table.institutionId, table.rootContractId, table.installment)
      .where(sql`${table.archivedAt} is null and ${table.rootContractId} is not null`),
    index('invoices_student_due_idx').on(table.institutionId, table.studentId, table.dueDate),
    index('invoices_contract_idx')
      .on(table.institutionId, table.contractId, table.rootContractId)
      .where(sql`${table.contractId} is not null`),
    index('invoices_open_due_idx')
      .on(table.institutionId, table.dueDate)
      .where(sql`${table.archivedAt} is null and ${table.paidAt} is null`),
    index('invoices_position_idx').on(table.institutionId, table.position),
  ],
)
