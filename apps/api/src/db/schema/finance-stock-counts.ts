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
  STOCK_CANCEL_REASON_MAX,
  STOCK_NOTE_MAX,
  STOCK_QUANTITY_MAX,
} from '@kampus/school-core/lib/finance-inventory.ts'
import {
  STOCK_COUNT_STATUSES,
  type StockCountStatus,
} from '@kampus/school-core/lib/finance-stock-counts.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { stockItems, stockMovements, stockWarehouses } from './finance-inventory.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Stok sayımı (DOM-FIN-081; ON-231): bir depoda başlatılan sayım oturumu. Durum `open` →
 * `completed` ya da `cancelled`; aynı depoda tek açık sayım olur (`stock_counts_open_key`).
 * Tamamlama farkları düzeltme hareketiyle yazar (`stock_count_lines.stock_movement_id`); tamamlanan
 * ve iptal edilen sayım değişmez.
 */
export const stockCounts = pgTable(
  'stock_counts',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    status: text('status').$type<StockCountStatus>().notNull(),
    note: text('note'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    // kvkk: K
    startedByUserId: text('started_by_user_id').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // kvkk: K
    completedByUserId: text('completed_by_user_id'),
    adjustmentDate: date('adjustment_date', { mode: 'string' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    cancelReason: text('cancel_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'stock_counts_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'stock_counts_warehouse_fkey',
      columns: [table.institutionId, table.warehouseId],
      foreignColumns: [stockWarehouses.institutionId, stockWarehouses.id],
    }).onDelete('restrict'),
    check('stock_counts_status_check', oneOf(table.status, STOCK_COUNT_STATUSES)),
    // Açık sayımda kapanış izi yok; tamamlananda tamamlama izi ve düzeltme günü, iptalde iptal izi.
    check(
      'stock_counts_state_check',
      sql`(${table.status} = 'open' and ${table.completedAt} is null and ${table.completedByUserId} is null and ${table.adjustmentDate} is null and ${table.cancelledAt} is null and ${table.cancelledByUserId} is null and ${table.cancelReason} is null)
        or (${table.status} = 'completed' and ${table.completedAt} is not null and ${table.completedByUserId} is not null and ${table.adjustmentDate} is not null and ${table.cancelledAt} is null and ${table.cancelledByUserId} is null and ${table.cancelReason} is null)
        or (${table.status} = 'cancelled' and ${table.completedAt} is null and ${table.completedByUserId} is null and ${table.adjustmentDate} is null and ${table.cancelledAt} is not null and ${table.cancelledByUserId} is not null and ${table.cancelReason} is not null)`,
    ),
    check(
      'stock_counts_text_check',
      sql`(${table.note} is null or char_length(${table.note}) <= ${n(STOCK_NOTE_MAX)})
        and (${table.cancelReason} is null or char_length(${table.cancelReason}) <= ${n(STOCK_CANCEL_REASON_MAX)})`,
    ),
    uniqueIndex('stock_counts_open_key')
      .on(table.institutionId, table.warehouseId)
      .where(sql`${table.status} = 'open' and ${table.archivedAt} is null`),
    index('stock_counts_warehouse_idx').on(table.institutionId, table.warehouseId),
    index('stock_counts_started_idx').on(table.institutionId, table.startedAt),
  ],
)

/**
 * Sayım satırı (DOM-FIN-081): kart başına anlık görüntüdeki sistem miktarı ve sayılan miktar.
 * Tamamlamada beklenen miktar, birim maliyet ve (fark varsa) düzeltme hareketi yazılır; fark raporu
 * bu değerlerle sabit kalır.
 */
export const stockCountLines = pgTable(
  'stock_count_lines',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    countId: uuid('count_id').notNull(),
    itemId: uuid('item_id').notNull(),
    systemQuantity: integer('system_quantity').notNull(),
    countedQuantity: integer('counted_quantity'),
    countedAt: timestamp('counted_at', { withTimezone: true }),
    // kvkk: K
    countedByUserId: text('counted_by_user_id'),
    expectedQuantity: integer('expected_quantity'),
    unitCostCents: bigint('unit_cost_cents', { mode: 'number' }),
    currency: text('currency').notNull().default('TRY'),
    stockMovementId: uuid('stock_movement_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'stock_count_lines_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'stock_count_lines_count_fkey',
      columns: [table.institutionId, table.countId],
      foreignColumns: [stockCounts.institutionId, stockCounts.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stock_count_lines_item_fkey',
      columns: [table.institutionId, table.itemId],
      foreignColumns: [stockItems.institutionId, stockItems.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stock_count_lines_movement_fkey',
      columns: [table.institutionId, table.stockMovementId],
      foreignColumns: [stockMovements.institutionId, stockMovements.id],
    }).onDelete('restrict'),
    // Sayılan miktar, sayım anı ve sayan birlikte; düzeltme hareketi yalnız beklenen miktarla.
    check(
      'stock_count_lines_quantity_check',
      sql`${table.systemQuantity} >= 0
        and (${table.countedQuantity} is null or ${table.countedQuantity} between 0 and ${n(STOCK_QUANTITY_MAX)})
        and ((${table.countedQuantity} is null) = (${table.countedAt} is null))
        and ((${table.countedAt} is null) = (${table.countedByUserId} is null))
        and (${table.stockMovementId} is null or ${table.expectedQuantity} is not null)
        and (${table.unitCostCents} is null or ${table.unitCostCents} > 0)`,
    ),
    check('stock_count_lines_currency_check', sql`${table.currency} = 'TRY'`),
    uniqueIndex('stock_count_lines_count_item_key').on(
      table.institutionId,
      table.countId,
      table.itemId,
    ),
    index('stock_count_lines_item_idx').on(table.institutionId, table.itemId),
    uniqueIndex('stock_count_lines_movement_key')
      .on(table.institutionId, table.stockMovementId)
      .where(sql`${table.stockMovementId} is not null`),
  ],
)
