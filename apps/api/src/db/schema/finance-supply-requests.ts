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
  SUPPLY_JUSTIFICATION_MAX,
  SUPPLY_QUANTITY_MAX,
  SUPPLY_REASON_MAX,
  SUPPLY_REQUEST_STATUSES,
  type SupplyRequestStatus,
} from '@kampus/school-core/lib/finance-supply-requests.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { stockItems, stockMovements } from './finance-inventory.ts'
import { purchaseRequests } from './finance-purchase-requests.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Sarf malzeme talebi (DOM-FIN-091; ON-233): kurum personelinin (öğretmen dahil) stok kartlarından
 * istediği malzeme. Durum gönderildi → onaylandı/reddedildi; onaylı talep karşılanınca (tam ya da
 * kısmi kapatma) karşılandı; talep eden onaydan önce iptal eder. Her geçiş zamanını ve kişisini
 * yazar. Numara kurumda sıradır (`SM-0001`). Kalanı satın alma talebine dönüşürse bağ
 * `purchase_request_id`'dedir (K-246).
 */
export const supplyRequests = pgTable(
  'supply_requests',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    sequence: integer('sequence').notNull(),
    status: text('status').$type<SupplyRequestStatus>().notNull().default('submitted'),
    // kvkk: K — talep eden personel
    requestedByUserId: text('requested_by_user_id').notNull(),
    neededDate: date('needed_date', { mode: 'string' }).notNull(),
    justification: text('justification').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    // kvkk: K
    decidedByUserId: text('decided_by_user_id'),
    decisionNote: text('decision_note'),
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
    // kvkk: K
    fulfilledByUserId: text('fulfilled_by_user_id'),
    fulfillmentNote: text('fulfillment_note'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    cancelReason: text('cancel_reason'),
    purchaseRequestId: uuid('purchase_request_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'supply_requests_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'supply_requests_purchase_request_fkey',
      columns: [table.institutionId, table.purchaseRequestId],
      foreignColumns: [purchaseRequests.institutionId, purchaseRequests.id],
    }).onDelete('restrict'),
    check('supply_requests_sequence_check', sql`${table.sequence} >= 1`),
    check('supply_requests_status_check', oneOf(table.status, SUPPLY_REQUEST_STATUSES)),
    check(
      'supply_requests_text_check',
      sql`char_length(${table.justification}) between 5 and ${n(SUPPLY_JUSTIFICATION_MAX)}
        and (${table.decisionNote} is null or char_length(${table.decisionNote}) <= ${n(SUPPLY_REASON_MAX)})
        and (${table.fulfillmentNote} is null or char_length(${table.fulfillmentNote}) <= ${n(SUPPLY_REASON_MAX)})
        and (${table.cancelReason} is null or char_length(${table.cancelReason}) <= ${n(SUPPLY_REASON_MAX)})`,
    ),
    // Durum ve iz birlikte tutarlı: kararsız talep karşılanmaz, reddin gerekçesi vardır.
    check(
      'supply_requests_lifecycle_check',
      sql`(${table.status} = 'submitted' and ${table.decidedAt} is null and ${table.fulfilledAt} is null and ${table.cancelledAt} is null)
        or (${table.status} = 'approved' and ${table.decidedAt} is not null and ${table.decidedByUserId} is not null and ${table.fulfilledAt} is null and ${table.cancelledAt} is null)
        or (${table.status} = 'rejected' and ${table.decidedAt} is not null and ${table.decidedByUserId} is not null and ${table.decisionNote} is not null and ${table.fulfilledAt} is null and ${table.cancelledAt} is null)
        or (${table.status} = 'fulfilled' and ${table.decidedAt} is not null and ${table.fulfilledAt} is not null and ${table.fulfilledByUserId} is not null and ${table.cancelledAt} is null)
        or (${table.status} = 'cancelled' and ${table.decidedAt} is null and ${table.fulfilledAt} is null and ${table.cancelledAt} is not null and ${table.cancelledByUserId} is not null and ${table.cancelReason} is not null)`,
    ),
    uniqueIndex('supply_requests_sequence_key').on(table.institutionId, table.sequence),
    index('supply_requests_status_idx').on(table.institutionId, table.status),
    // Öğretmen yalnız kendi taleplerini listeler (K-244).
    index('supply_requests_requested_by_idx').on(table.institutionId, table.requestedByUserId),
    index('supply_requests_purchase_request_idx')
      .on(table.institutionId, table.purchaseRequestId)
      .where(sql`${table.purchaseRequestId} is not null`),
  ],
)

/**
 * Sarf talebi kalemi (DOM-FIN-091): stok kartı ve istenen miktar (kartın biriminde). Bir kart
 * talepte bir kez yer alır. Karşılanan miktar saklanmaz, `supply_request_issues` üzerinden bağlı
 * iptal edilmemiş çıkışlardan toplanır.
 */
export const supplyRequestItems = pgTable(
  'supply_request_items',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    requestId: uuid('request_id').notNull(),
    position: integer('position').notNull(),
    stockItemId: uuid('stock_item_id').notNull(),
    quantity: integer('quantity').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'supply_request_items_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'supply_request_items_request_fkey',
      columns: [table.institutionId, table.requestId],
      foreignColumns: [supplyRequests.institutionId, supplyRequests.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'supply_request_items_stock_item_fkey',
      columns: [table.institutionId, table.stockItemId],
      foreignColumns: [stockItems.institutionId, stockItems.id],
    }).onDelete('restrict'),
    check('supply_request_items_position_check', sql`${table.position} >= 0`),
    check(
      'supply_request_items_quantity_check',
      sql`${table.quantity} between 1 and ${n(SUPPLY_QUANTITY_MAX)}`,
    ),
    uniqueIndex('supply_request_items_position_key').on(
      table.institutionId,
      table.requestId,
      table.position,
    ),
    uniqueIndex('supply_request_items_stock_item_key').on(
      table.institutionId,
      table.requestId,
      table.stockItemId,
    ),
    index('supply_request_items_stock_item_idx').on(table.institutionId, table.stockItemId),
  ],
)

/**
 * Sarf talebi karşılaması (DOM-FIN-091, K-245): talep kalemi için yazılan `supply` türündeki stok
 * çıkışı (DOM-FIN-078); bir hareket bir kaleme bağlıdır. Miktar, depo ve gün hareketin kendisindedir.
 */
export const supplyRequestIssues = pgTable(
  'supply_request_issues',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    requestId: uuid('request_id').notNull(),
    requestItemId: uuid('request_item_id').notNull(),
    stockMovementId: uuid('stock_movement_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'supply_request_issues_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'supply_request_issues_request_fkey',
      columns: [table.institutionId, table.requestId],
      foreignColumns: [supplyRequests.institutionId, supplyRequests.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'supply_request_issues_item_fkey',
      columns: [table.institutionId, table.requestItemId],
      foreignColumns: [supplyRequestItems.institutionId, supplyRequestItems.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'supply_request_issues_movement_fkey',
      columns: [table.institutionId, table.stockMovementId],
      foreignColumns: [stockMovements.institutionId, stockMovements.id],
    }).onDelete('restrict'),
    index('supply_request_issues_request_idx').on(table.institutionId, table.requestId),
    index('supply_request_issues_item_idx').on(table.institutionId, table.requestItemId),
    uniqueIndex('supply_request_issues_movement_key').on(
      table.institutionId,
      table.stockMovementId,
    ),
  ],
)
