import { sql } from 'drizzle-orm'
import {
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
  RECEIPT_CANCEL_REASON_MAX,
  RECEIPT_NOTE_MAX,
  RECEIPT_RECEIVED_BY_MAX,
  RECEIPT_RECEIVED_BY_MIN,
  RECEIPT_REJECT_REASON_MAX,
} from '@kampus/school-core/lib/finance-purchase-receipts.ts'
import { PURCHASE_QUANTITY_MAX } from '@kampus/school-core/lib/finance-purchase-requests.ts'

import { institutions } from './auth.ts'
import { requiredColumns } from './columns.ts'
import { purchaseOrderItems, purchaseOrders } from './finance-purchase-orders.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Mal kabul (DOM-FIN-074; ON-226). Gönderilmiş siparişin teslimatı: kabul günü, teslim alan personel
 * (serbest metin; sistem kullanıcısı olmayabilir, K-152), muayene notu ve kaydı giren kullanıcı.
 * Silinmez; yönetici gerekçeyle iptal eder (K-153). Tutar kalemlerden hesaplanır, saklanmaz.
 */
export const purchaseReceipts = pgTable(
  'purchase_receipts',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    orderId: uuid('order_id').notNull(),
    receiptDate: date('receipt_date', { mode: 'string' }).notNull(),
    // kvkk: K
    receivedBy: text('received_by').notNull(),
    inspectionNote: text('inspection_note'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    cancelReason: text('cancel_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'purchase_receipts_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'purchase_receipts_order_fkey',
      columns: [table.institutionId, table.orderId],
      foreignColumns: [purchaseOrders.institutionId, purchaseOrders.id],
    }).onDelete('restrict'),
    check(
      'purchase_receipts_text_check',
      sql`char_length(${table.receivedBy}) between ${n(RECEIPT_RECEIVED_BY_MIN)} and ${n(RECEIPT_RECEIVED_BY_MAX)}
        and (${table.inspectionNote} is null or char_length(${table.inspectionNote}) <= ${n(RECEIPT_NOTE_MAX)})
        and (${table.cancelReason} is null or char_length(${table.cancelReason}) <= ${n(RECEIPT_CANCEL_REASON_MAX)})`,
    ),
    // İptal zamanı, kişi ve gerekçe birlikte.
    check(
      'purchase_receipts_cancel_check',
      sql`((${table.cancelledAt} is null) = (${table.cancelledByUserId} is null))
        and ((${table.cancelledAt} is null) = (${table.cancelReason} is null))`,
    ),
    index('purchase_receipts_order_idx').on(table.institutionId, table.orderId),
    index('purchase_receipts_date_idx').on(table.institutionId, table.receiptDate),
  ],
)

/**
 * Kabul kalemi: sipariş kalemine kabul edilen ve reddedilen miktar, ret nedeni. Kabul edilen toplamın
 * sipariş miktarını aşmaması kurum kilidi altında core kuralıyla denetlenir (K-150).
 */
export const purchaseReceiptItems = pgTable(
  'purchase_receipt_items',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    receiptId: uuid('receipt_id').notNull(),
    orderItemId: uuid('order_item_id').notNull(),
    acceptedQuantity: integer('accepted_quantity').notNull(),
    rejectedQuantity: integer('rejected_quantity').notNull().default(0),
    rejectReason: text('reject_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'purchase_receipt_items_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'purchase_receipt_items_receipt_fkey',
      columns: [table.institutionId, table.receiptId],
      foreignColumns: [purchaseReceipts.institutionId, purchaseReceipts.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'purchase_receipt_items_order_item_fkey',
      columns: [table.institutionId, table.orderItemId],
      foreignColumns: [purchaseOrderItems.institutionId, purchaseOrderItems.id],
    }).onDelete('restrict'),
    check(
      'purchase_receipt_items_quantity_check',
      sql`${table.acceptedQuantity} between 0 and ${n(PURCHASE_QUANTITY_MAX)}
        and ${table.rejectedQuantity} between 0 and ${n(PURCHASE_QUANTITY_MAX)}
        and ${table.acceptedQuantity} + ${table.rejectedQuantity} > 0`,
    ),
    // Ret nedeni yalnız reddedilen miktar varken ve o zaman zorunlu.
    check(
      'purchase_receipt_items_reject_check',
      sql`((${table.rejectedQuantity} > 0) = (${table.rejectReason} is not null))
        and (${table.rejectReason} is null or char_length(${table.rejectReason}) <= ${n(RECEIPT_REJECT_REASON_MAX)})`,
    ),
    uniqueIndex('purchase_receipt_items_order_item_key').on(
      table.institutionId,
      table.receiptId,
      table.orderItemId,
    ),
    index('purchase_receipt_items_receipt_idx').on(table.institutionId, table.receiptId),
    index('purchase_receipt_items_order_item_idx').on(table.institutionId, table.orderItemId),
  ],
)
