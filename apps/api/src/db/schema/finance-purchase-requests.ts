import { sql } from 'drizzle-orm'
import {
  bigint,
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

import {
  PURCHASE_ITEM_NAME_MAX,
  PURCHASE_JUSTIFICATION_MAX,
  PURCHASE_QUANTITY_MAX,
  PURCHASE_REASON_MAX,
  PURCHASE_REQUEST_STATUSES,
  PURCHASE_UNIT_PRICE_MAX_CENTS,
  PURCHASE_UNITS,
  type PurchaseRequestStatus,
  type PurchaseUnit,
} from '@kampus/school-core/lib/finance-purchase-requests.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { budgetItems, budgetPeriods, costCenters } from './finance-budget.ts'
import { suppliers } from './finance-suppliers.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Satın alma talebi (DOM-FIN-071; ON-222). Talep eden birim maliyet merkezidir; dönem ve gider
 * kalemi bütçeye (DOM-FIN-062) bağlanır. Durum taslak → gönderildi → onaylandı/reddedildi, taslak
 * ve gönderilmiş talep iptal edilir; her geçiş zamanını ve kişisini yazar. Talep numarası kurumda
 * sıradır (`ST-0001`), tutar kalemlerden hesaplanır, saklanmaz.
 */
export const purchaseRequests = pgTable(
  'purchase_requests',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    sequence: integer('sequence').notNull(),
    status: text('status').$type<PurchaseRequestStatus>().notNull().default('draft'),
    costCenterId: uuid('cost_center_id').notNull(),
    periodId: uuid('period_id').notNull(),
    budgetItemId: uuid('budget_item_id').notNull(),
    supplierId: uuid('supplier_id'),
    justification: text('justification').notNull(),
    requestedByUserId: text('requested_by_user_id').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submittedByUserId: text('submitted_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedByUserId: text('decided_by_user_id'),
    decisionNote: text('decision_note'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByUserId: text('cancelled_by_user_id'),
    cancelReason: text('cancel_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'purchase_requests_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'purchase_requests_cost_center_fkey',
      columns: [table.institutionId, table.costCenterId],
      foreignColumns: [costCenters.institutionId, costCenters.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'purchase_requests_period_fkey',
      columns: [table.institutionId, table.periodId],
      foreignColumns: [budgetPeriods.institutionId, budgetPeriods.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'purchase_requests_budget_item_fkey',
      columns: [table.institutionId, table.budgetItemId],
      foreignColumns: [budgetItems.institutionId, budgetItems.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'purchase_requests_supplier_fkey',
      columns: [table.institutionId, table.supplierId],
      foreignColumns: [suppliers.institutionId, suppliers.id],
    }).onDelete('restrict'),
    check('purchase_requests_sequence_check', sql`${table.sequence} >= 1`),
    check('purchase_requests_status_check', oneOf(table.status, PURCHASE_REQUEST_STATUSES)),
    check(
      'purchase_requests_justification_check',
      sql`char_length(${table.justification}) between 10 and ${n(PURCHASE_JUSTIFICATION_MAX)}`,
    ),
    check(
      'purchase_requests_reason_check',
      sql`(${table.decisionNote} is null or char_length(${table.decisionNote}) <= ${n(PURCHASE_REASON_MAX)})
        and (${table.cancelReason} is null or char_length(${table.cancelReason}) <= ${n(PURCHASE_REASON_MAX)})`,
    ),
    // Durum ve iz birlikte tutarlı: gönderilmeyen talebin kararı olmaz, reddin gerekçesi vardır.
    check(
      'purchase_requests_lifecycle_check',
      sql`(${table.status} = 'draft' and ${table.submittedAt} is null and ${table.decidedAt} is null and ${table.cancelledAt} is null)
        or (${table.status} = 'submitted' and ${table.submittedAt} is not null and ${table.decidedAt} is null and ${table.cancelledAt} is null)
        or (${table.status} = 'approved' and ${table.submittedAt} is not null and ${table.decidedAt} is not null and ${table.decidedByUserId} is not null and ${table.cancelledAt} is null)
        or (${table.status} = 'rejected' and ${table.submittedAt} is not null and ${table.decidedAt} is not null and ${table.decidedByUserId} is not null and ${table.decisionNote} is not null and ${table.cancelledAt} is null)
        or (${table.status} = 'cancelled' and ${table.decidedAt} is null and ${table.cancelledAt} is not null and ${table.cancelledByUserId} is not null and ${table.cancelReason} is not null)`,
    ),
    uniqueIndex('purchase_requests_sequence_key').on(table.institutionId, table.sequence),
    index('purchase_requests_status_idx').on(table.institutionId, table.status),
    index('purchase_requests_cost_center_idx').on(table.institutionId, table.costCenterId),
    // Bütçe kalanı aynı dönem ve kalemdeki talepleri toplar (DOM-FIN-071, K-131).
    index('purchase_requests_period_idx').on(
      table.institutionId,
      table.periodId,
      table.budgetItemId,
    ),
    index('purchase_requests_budget_item_idx').on(table.institutionId, table.budgetItemId),
    index('purchase_requests_supplier_idx').on(table.institutionId, table.supplierId),
  ],
)

/**
 * Talep kalemi (DOM-FIN-071): ad, tam sayı miktar, birim ve tahmini birim fiyat (kuruş). Taslak
 * düzeltilince eski kalemler arşivlenir, yenileri yazılır; etkin kalemler `position` ile sıralanır.
 */
export const purchaseRequestItems = pgTable(
  'purchase_request_items',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    requestId: uuid('request_id').notNull(),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    quantity: integer('quantity').notNull(),
    unit: text('unit').$type<PurchaseUnit>().notNull(),
    estimatedUnitPriceCents: bigint('estimated_unit_price_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'purchase_request_items_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'purchase_request_items_request_fkey',
      columns: [table.institutionId, table.requestId],
      foreignColumns: [purchaseRequests.institutionId, purchaseRequests.id],
    }).onDelete('restrict'),
    check('purchase_request_items_position_check', sql`${table.position} >= 0`),
    check(
      'purchase_request_items_name_check',
      sql`char_length(${table.name}) between 2 and ${n(PURCHASE_ITEM_NAME_MAX)}`,
    ),
    check(
      'purchase_request_items_quantity_check',
      sql`${table.quantity} between 1 and ${n(PURCHASE_QUANTITY_MAX)}`,
    ),
    check('purchase_request_items_unit_check', oneOf(table.unit, PURCHASE_UNITS)),
    check(
      'purchase_request_items_price_check',
      sql`${table.estimatedUnitPriceCents} between 1 and ${n(PURCHASE_UNIT_PRICE_MAX_CENTS)}`,
    ),
    check('purchase_request_items_currency_check', sql`${table.currency} = 'TRY'`),
    uniqueIndex('purchase_request_items_position_key')
      .on(table.institutionId, table.requestId, table.position)
      .where(sql`${table.archivedAt} is null`),
    index('purchase_request_items_request_idx').on(table.institutionId, table.requestId),
  ],
)
