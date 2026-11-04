import { foreignKey, index, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'

import { institutions } from './auth.ts'
import { requiredColumns } from './columns.ts'
import { contracts } from './contracts.ts'
import { invoices } from './invoices.ts'

/**
 * Sözleşme sürümü ↔ taksit bağı: core `invoiceIds` (ADR 0010 karar 1; DOM-FIN-012). Ek protokolde
 * korunan taksit iki sürüme bağlıdır, ayrılış onaylı sürümden taksit düşürür; bu yüzden bağ
 * `invoices.contract_id`'den türetilemez. Diziden düşmek satırı arşivlemektir, satır silinmez.
 */
export const contractInvoices = pgTable(
  'contract_invoices',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    contractId: text('contract_id').notNull(),
    invoiceId: text('invoice_id').notNull(),
    position: integer('position').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'contract_invoices_pkey',
      columns: [table.institutionId, table.contractId, table.invoiceId],
    }),
    foreignKey({
      name: 'contract_invoices_contract_fkey',
      columns: [table.institutionId, table.contractId],
      foreignColumns: [contracts.institutionId, contracts.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'contract_invoices_invoice_fkey',
      columns: [table.institutionId, table.invoiceId],
      foreignColumns: [invoices.institutionId, invoices.id],
    }).onDelete('restrict'),
    index('contract_invoices_invoice_idx').on(table.institutionId, table.invoiceId),
  ],
)
