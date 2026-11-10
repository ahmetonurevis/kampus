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
  PURCHASE_ORDER_NOTE_MAX,
  PURCHASE_ORDER_REASON_MAX,
  PURCHASE_ORDER_STATUSES,
  type PurchaseOrderStatus,
} from '@kampus/school-core/lib/finance-purchase-orders.ts'
import {
  QUOTE_DELIVERY_DAYS_MAX,
  QUOTE_NOTE_MAX,
  QUOTE_SELECTION_REASON_MAX,
  VAT_RATES,
  type VatRate,
} from '@kampus/school-core/lib/finance-purchase-quotes.ts'
import {
  PURCHASE_ITEM_NAME_MAX,
  PURCHASE_QUANTITY_MAX,
  PURCHASE_UNIT_PRICE_MAX_CENTS,
  PURCHASE_UNITS,
  type PurchaseUnit,
} from '@kampus/school-core/lib/finance-purchase-requests.ts'
import { SUPPLIER_TYPES, type SupplierType } from '@kampus/school-core/lib/finance-suppliers.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { stockItems } from './finance-inventory.ts'
import { purchaseRequestItems, purchaseRequests } from './finance-purchase-requests.ts'
import { suppliers } from './finance-suppliers.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Satın alma teklifi (DOM-FIN-072; ON-224). Onaylanmış talebe tedarikçi başına bir teklif;
 * geçerlilik günü ve teslim süresi taşır. Seçim teklif satırındadır: talepte tek seçili teklif olur
 * (`purchase_quotes_selected_key`). Silme arşivdir. Tutarlar kalemlerden hesaplanır, saklanmaz.
 */
export const purchaseQuotes = pgTable(
  'purchase_quotes',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    requestId: uuid('request_id').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    deliveryDays: integer('delivery_days').notNull(),
    validUntil: date('valid_until', { mode: 'string' }).notNull(),
    note: text('note'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    selectedAt: timestamp('selected_at', { withTimezone: true }),
    // kvkk: K
    selectedByUserId: text('selected_by_user_id'),
    selectionReason: text('selection_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'purchase_quotes_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'purchase_quotes_request_fkey',
      columns: [table.institutionId, table.requestId],
      foreignColumns: [purchaseRequests.institutionId, purchaseRequests.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'purchase_quotes_supplier_fkey',
      columns: [table.institutionId, table.supplierId],
      foreignColumns: [suppliers.institutionId, suppliers.id],
    }).onDelete('restrict'),
    check(
      'purchase_quotes_delivery_days_check',
      sql`${table.deliveryDays} between 0 and ${n(QUOTE_DELIVERY_DAYS_MAX)}`,
    ),
    check(
      'purchase_quotes_note_check',
      sql`(${table.note} is null or char_length(${table.note}) <= ${n(QUOTE_NOTE_MAX)})
        and (${table.selectionReason} is null or char_length(${table.selectionReason}) <= ${n(QUOTE_SELECTION_REASON_MAX)})`,
    ),
    // Seçim zamanı ve seçen birlikte; gerekçe yalnız seçili teklifte.
    check(
      'purchase_quotes_selection_check',
      sql`((${table.selectedAt} is null) = (${table.selectedByUserId} is null))
        and (${table.selectedAt} is not null or ${table.selectionReason} is null)`,
    ),
    uniqueIndex('purchase_quotes_supplier_key')
      .on(table.institutionId, table.requestId, table.supplierId)
      .where(sql`${table.archivedAt} is null`),
    uniqueIndex('purchase_quotes_selected_key')
      .on(table.institutionId, table.requestId)
      .where(sql`${table.archivedAt} is null and ${table.selectedAt} is not null`),
    index('purchase_quotes_request_idx').on(table.institutionId, table.requestId),
    index('purchase_quotes_supplier_idx').on(table.institutionId, table.supplierId),
  ],
)

/**
 * Teklif kalemi: talep kalemine KDV hariç birim fiyat ve KDV oranı (K-135, K-138). Teklif düzeltilince
 * eski kalemler arşivlenir, yenileri yazılır.
 */
export const purchaseQuoteItems = pgTable(
  'purchase_quote_items',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    quoteId: uuid('quote_id').notNull(),
    requestItemId: uuid('request_item_id').notNull(),
    position: integer('position').notNull(),
    unitPriceCents: bigint('unit_price_cents', { mode: 'number' }).notNull(),
    vatRate: integer('vat_rate').$type<VatRate>().notNull(),
    currency: text('currency').notNull().default('TRY'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'purchase_quote_items_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'purchase_quote_items_quote_fkey',
      columns: [table.institutionId, table.quoteId],
      foreignColumns: [purchaseQuotes.institutionId, purchaseQuotes.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'purchase_quote_items_request_item_fkey',
      columns: [table.institutionId, table.requestItemId],
      foreignColumns: [purchaseRequestItems.institutionId, purchaseRequestItems.id],
    }).onDelete('restrict'),
    check('purchase_quote_items_position_check', sql`${table.position} >= 0`),
    check(
      'purchase_quote_items_price_check',
      sql`${table.unitPriceCents} between 1 and ${n(PURCHASE_UNIT_PRICE_MAX_CENTS)}`,
    ),
    check('purchase_quote_items_vat_rate_check', oneOf(table.vatRate, VAT_RATES)),
    check('purchase_quote_items_currency_check', sql`${table.currency} = 'TRY'`),
    uniqueIndex('purchase_quote_items_request_item_key')
      .on(table.institutionId, table.quoteId, table.requestItemId)
      .where(sql`${table.archivedAt} is null`),
    index('purchase_quote_items_quote_idx').on(table.institutionId, table.quoteId),
    index('purchase_quote_items_request_item_idx').on(table.institutionId, table.requestItemId),
  ],
)

/**
 * Satın alma siparişi (DOM-FIN-073; ON-225). Seçili tekliften açılır; tedarikçi ve kalemler açılış
 * anının kopyasıdır. Numara `SA-<yıl>-<sıra>` (K-139). Talepte en çok bir etkin (iptal edilmemiş)
 * sipariş olur (`purchase_orders_active_request_key`, K-140). Tutar kalemlerden hesaplanır.
 */
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    number: text('number').notNull(),
    numberYear: integer('number_year').notNull(),
    numberSequence: integer('number_sequence').notNull(),
    status: text('status').$type<PurchaseOrderStatus>().notNull().default('draft'),
    requestId: uuid('request_id').notNull(),
    quoteId: uuid('quote_id').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    supplierName: text('supplier_name').notNull(),
    supplierType: text('supplier_type').$type<SupplierType>().notNull(),
    // kvkk: K (şahıs tedarikçide TCKN; ön büroya maskeli)
    supplierTaxNumber: text('supplier_tax_number').notNull(),
    supplierTaxOffice: text('supplier_tax_office').notNull(),
    deliveryDays: integer('delivery_days').notNull(),
    note: text('note'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    // kvkk: K
    sentByUserId: text('sent_by_user_id'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    cancelReason: text('cancel_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'purchase_orders_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'purchase_orders_request_fkey',
      columns: [table.institutionId, table.requestId],
      foreignColumns: [purchaseRequests.institutionId, purchaseRequests.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'purchase_orders_quote_fkey',
      columns: [table.institutionId, table.quoteId],
      foreignColumns: [purchaseQuotes.institutionId, purchaseQuotes.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'purchase_orders_supplier_fkey',
      columns: [table.institutionId, table.supplierId],
      foreignColumns: [suppliers.institutionId, suppliers.id],
    }).onDelete('restrict'),
    check('purchase_orders_sequence_check', sql`${table.numberSequence} > 0`),
    check('purchase_orders_status_check', oneOf(table.status, PURCHASE_ORDER_STATUSES)),
    check('purchase_orders_supplier_type_check', oneOf(table.supplierType, SUPPLIER_TYPES)),
    check(
      'purchase_orders_delivery_days_check',
      sql`${table.deliveryDays} between 0 and ${n(QUOTE_DELIVERY_DAYS_MAX)}`,
    ),
    check(
      'purchase_orders_text_check',
      sql`(${table.note} is null or char_length(${table.note}) <= ${n(PURCHASE_ORDER_NOTE_MAX)})
        and (${table.cancelReason} is null or char_length(${table.cancelReason}) <= ${n(PURCHASE_ORDER_REASON_MAX)})`,
    ),
    // Durum ve iz birlikte tutarlı: taslak gönderilmemiştir, iptal gerekçe ve kişi taşır.
    check(
      'purchase_orders_lifecycle_check',
      sql`((${table.sentAt} is null) = (${table.sentByUserId} is null))
        and ((${table.cancelledAt} is null) = (${table.cancelledByUserId} is null))
        and ((${table.cancelledAt} is null) = (${table.cancelReason} is null))
        and ((${table.status} = 'cancelled') = (${table.cancelledAt} is not null))
        and (${table.status} <> 'draft' or ${table.sentAt} is null)
        and (${table.status} not in ('sent', 'partially_received', 'completed') or ${table.sentAt} is not null)`,
    ),
    uniqueIndex('purchase_orders_number_key').on(table.institutionId, table.number),
    uniqueIndex('purchase_orders_sequence_key').on(
      table.institutionId,
      table.numberYear,
      table.numberSequence,
    ),
    uniqueIndex('purchase_orders_active_request_key')
      .on(table.institutionId, table.requestId)
      .where(sql`${table.status} <> 'cancelled' and ${table.archivedAt} is null`),
    index('purchase_orders_status_idx').on(table.institutionId, table.status),
    index('purchase_orders_request_idx').on(table.institutionId, table.requestId),
    index('purchase_orders_quote_idx').on(table.institutionId, table.quoteId),
    index('purchase_orders_supplier_idx').on(table.institutionId, table.supplierId),
  ],
)

/**
 * Sipariş kalemi: talep kalemi ve teklif fiyatının açılış anındaki kopyası; talep kaleminin stok
 * kartı bağı da kopyalanır ve mal kabul formunu doldurur (ON-339).
 */
export const purchaseOrderItems = pgTable(
  'purchase_order_items',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    orderId: uuid('order_id').notNull(),
    requestItemId: uuid('request_item_id').notNull(),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    quantity: integer('quantity').notNull(),
    unit: text('unit').$type<PurchaseUnit>().notNull(),
    unitPriceCents: bigint('unit_price_cents', { mode: 'number' }).notNull(),
    vatRate: integer('vat_rate').$type<VatRate>().notNull(),
    currency: text('currency').notNull().default('TRY'),
    stockItemId: uuid('stock_item_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'purchase_order_items_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'purchase_order_items_stock_item_fkey',
      columns: [table.institutionId, table.stockItemId],
      foreignColumns: [stockItems.institutionId, stockItems.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'purchase_order_items_order_fkey',
      columns: [table.institutionId, table.orderId],
      foreignColumns: [purchaseOrders.institutionId, purchaseOrders.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'purchase_order_items_request_item_fkey',
      columns: [table.institutionId, table.requestItemId],
      foreignColumns: [purchaseRequestItems.institutionId, purchaseRequestItems.id],
    }).onDelete('restrict'),
    check('purchase_order_items_position_check', sql`${table.position} >= 0`),
    check(
      'purchase_order_items_name_check',
      sql`char_length(${table.name}) between 2 and ${n(PURCHASE_ITEM_NAME_MAX)}`,
    ),
    check(
      'purchase_order_items_quantity_check',
      sql`${table.quantity} between 1 and ${n(PURCHASE_QUANTITY_MAX)}`,
    ),
    check('purchase_order_items_unit_check', oneOf(table.unit, PURCHASE_UNITS)),
    check(
      'purchase_order_items_price_check',
      sql`${table.unitPriceCents} between 1 and ${n(PURCHASE_UNIT_PRICE_MAX_CENTS)}`,
    ),
    check('purchase_order_items_vat_rate_check', oneOf(table.vatRate, VAT_RATES)),
    check('purchase_order_items_currency_check', sql`${table.currency} = 'TRY'`),
    uniqueIndex('purchase_order_items_position_key').on(
      table.institutionId,
      table.orderId,
      table.position,
    ),
    index('purchase_order_items_order_idx').on(table.institutionId, table.orderId),
    index('purchase_order_items_request_item_idx').on(table.institutionId, table.requestItemId),
    index('purchase_order_items_stock_item_idx').on(table.institutionId, table.stockItemId),
  ],
)
