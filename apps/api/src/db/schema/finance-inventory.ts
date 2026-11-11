import { sql } from 'drizzle-orm'
import {
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
  STOCK_CANCEL_REASON_MAX,
  STOCK_CATEGORIES,
  STOCK_ENTRY_REASONS,
  STOCK_ISSUE_REASONS,
  STOCK_ITEM_NAME_MAX,
  STOCK_MOVEMENT_TYPES,
  STOCK_NOTE_MAX,
  STOCK_QUANTITY_MAX,
  STOCK_UNITS,
  STOCK_WAREHOUSE_NAME_MAX,
  type StockCategory,
  type StockMovementType,
  type StockUnit,
} from '@kampus/school-core/lib/finance-inventory.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { purchaseReceiptItems, purchaseReceipts } from './finance-purchase-receipts.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Stok kartı (DOM-FIN-077; ON-228): ürünün kodu, adı, kategorisi, birimi ve kritik seviyesi. Miktar
 * saklanmaz, hareketlerden türetilir. Kod kurumda tekil; kart silinmez, `is_active` ile pasifleşir.
 */
export const stockItems = pgTable(
  'stock_items',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    category: text('category').$type<StockCategory>().notNull(),
    unit: text('unit').$type<StockUnit>().notNull(),
    minQuantity: integer('min_quantity'),
    isActive: boolean('is_active').notNull().default(true),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'stock_items_pkey', columns: [table.institutionId, table.id] }),
    check(
      'stock_items_text_check',
      sql`${table.code} ~ '^[A-Z0-9][A-Z0-9._-]{0,19}$'
        and char_length(${table.name}) between 2 and ${n(STOCK_ITEM_NAME_MAX)}`,
    ),
    check('stock_items_category_check', oneOf(table.category, STOCK_CATEGORIES)),
    check('stock_items_unit_check', oneOf(table.unit, STOCK_UNITS)),
    check(
      'stock_items_min_quantity_check',
      sql`${table.minQuantity} is null or ${table.minQuantity} between 0 and ${n(STOCK_QUANTITY_MAX)}`,
    ),
    uniqueIndex('stock_items_code_key')
      .on(table.institutionId, table.code)
      .where(sql`${table.archivedAt} is null`),
  ],
)

/**
 * Depo (DOM-FIN-077; ON-228): kurumun bir kampüsüne (`records` `branches`) bağlıdır. Ad kurumda
 * tekil (core, Türkçe harf duyarsız); stoku olan depo pasifleşmez ve başka kampüse bağlanmaz.
 */
export const stockWarehouses = pgTable(
  'stock_warehouses',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    campusId: text('campus_id').notNull(),
    note: text('note'),
    isActive: boolean('is_active').notNull().default(true),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'stock_warehouses_pkey', columns: [table.institutionId, table.id] }),
    check(
      'stock_warehouses_text_check',
      sql`char_length(${table.name}) between 2 and ${n(STOCK_WAREHOUSE_NAME_MAX)}
        and char_length(${table.campusId}) between 1 and 100
        and (${table.note} is null or char_length(${table.note}) <= ${n(STOCK_NOTE_MAX)})`,
    ),
    index('stock_warehouses_campus_idx').on(table.institutionId, table.campusId),
  ],
)

/**
 * Stok hareketi (DOM-FIN-078; ON-229): bir ürünün bir depoya girişi ya da çıkışı. Transferin iki
 * hareketi aynı `transfer_id`'yi taşır; mal kabul girişi kabul kalemine bağlıdır (kalem başına bir
 * hareket); materyal seti teslimi çıkışı teslim kalemine (`material_delivery_items`), sayım
 * düzeltmesi sayım satırına (`stock_count_lines`), sarf talebi karşılama çıkışı talep kalemine
 * (`supply_request_issues`) bağlıdır. Miktar ürün × depo için hareketlerden türetilir ve hiçbir
 * gün eksiye düşemez (kurum kilidi altında core kuralı, K-181). Silinmez; yönetici gerekçeyle
 * iptal eder (K-183).
 */
export const stockMovements = pgTable(
  'stock_movements',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    itemId: uuid('item_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    type: text('type').$type<StockMovementType>().notNull(),
    quantity: integer('quantity').notNull(),
    movementDate: date('movement_date', { mode: 'string' }).notNull(),
    reason: text('reason'),
    note: text('note'),
    transferId: uuid('transfer_id'),
    receiptId: uuid('receipt_id'),
    receiptItemId: uuid('receipt_item_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    cancelReason: text('cancel_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'stock_movements_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'stock_movements_item_fkey',
      columns: [table.institutionId, table.itemId],
      foreignColumns: [stockItems.institutionId, stockItems.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stock_movements_warehouse_fkey',
      columns: [table.institutionId, table.warehouseId],
      foreignColumns: [stockWarehouses.institutionId, stockWarehouses.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stock_movements_receipt_fkey',
      columns: [table.institutionId, table.receiptId],
      foreignColumns: [purchaseReceipts.institutionId, purchaseReceipts.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stock_movements_receipt_item_fkey',
      columns: [table.institutionId, table.receiptItemId],
      foreignColumns: [purchaseReceiptItems.institutionId, purchaseReceiptItems.id],
    }).onDelete('restrict'),
    check('stock_movements_type_check', oneOf(table.type, STOCK_MOVEMENT_TYPES)),
    check(
      'stock_movements_quantity_check',
      sql`${table.quantity} between 1 and ${n(STOCK_QUANTITY_MAX)}`,
    ),
    // Neden yalnız elle giriş ve çıkışta, kendi kümesinden; transfer kimliği yalnız transferde,
    // kabul ve kabul kalemi yalnız mal kabul girişinde. Materyal seti teslimi (`delivery`,
    // DOM-FIN-080) kaynağını `material_delivery_items.stock_movement_id`, sayım düzeltmesi
    // (`adjustment_in`, `adjustment_out`; DOM-FIN-081) `stock_count_lines.stock_movement_id`, sarf
    // talebi karşılaması (`supply`, DOM-FIN-091) `supply_request_issues.stock_movement_id` ile taşır.
    check(
      'stock_movements_source_check',
      sql`(${table.type} = 'in' and ${table.reason} is not null and ${oneOf(table.reason, STOCK_ENTRY_REASONS)} and ${table.transferId} is null and ${table.receiptId} is null and ${table.receiptItemId} is null)
        or (${table.type} = 'out' and ${table.reason} is not null and ${oneOf(table.reason, STOCK_ISSUE_REASONS)} and ${table.transferId} is null and ${table.receiptId} is null and ${table.receiptItemId} is null)
        or (${table.type} in ('transfer_in', 'transfer_out') and ${table.reason} is null and ${table.transferId} is not null and ${table.receiptId} is null and ${table.receiptItemId} is null)
        or (${table.type} = 'receipt' and ${table.reason} is null and ${table.transferId} is null and ${table.receiptId} is not null and ${table.receiptItemId} is not null)
        or (${table.type} in ('delivery', 'supply') and ${table.reason} is null and ${table.transferId} is null and ${table.receiptId} is null and ${table.receiptItemId} is null)
        or (${table.type} in ('adjustment_in', 'adjustment_out') and ${table.reason} is null and ${table.transferId} is null and ${table.receiptId} is null and ${table.receiptItemId} is null)`,
    ),
    check(
      'stock_movements_text_check',
      sql`(${table.note} is null or char_length(${table.note}) <= ${n(STOCK_NOTE_MAX)})
        and (${table.cancelReason} is null or char_length(${table.cancelReason}) <= ${n(STOCK_CANCEL_REASON_MAX)})`,
    ),
    // İptal zamanı, kişi ve gerekçe birlikte.
    check(
      'stock_movements_cancel_check',
      sql`((${table.cancelledAt} is null) = (${table.cancelledByUserId} is null))
        and ((${table.cancelledAt} is null) = (${table.cancelReason} is null))`,
    ),
    index('stock_movements_item_warehouse_idx').on(
      table.institutionId,
      table.itemId,
      table.warehouseId,
      table.movementDate,
    ),
    index('stock_movements_warehouse_idx').on(table.institutionId, table.warehouseId),
    index('stock_movements_date_idx').on(table.institutionId, table.movementDate),
    index('stock_movements_transfer_idx')
      .on(table.institutionId, table.transferId)
      .where(sql`${table.transferId} is not null`),
    index('stock_movements_receipt_idx')
      .on(table.institutionId, table.receiptId)
      .where(sql`${table.receiptId} is not null`),
    uniqueIndex('stock_movements_receipt_item_key')
      .on(table.institutionId, table.receiptItemId)
      .where(sql`${table.receiptItemId} is not null`),
  ],
)
