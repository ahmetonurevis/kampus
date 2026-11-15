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

import { BUDGET_AMOUNT_MAX_CENTS } from '@kampus/school-core/lib/finance-budget.ts'
import {
  PURCHASE_APPROVAL_DECISIONS,
  PURCHASE_APPROVAL_NOTE_MAX,
  PURCHASE_APPROVAL_TIERS_MAX,
  PURCHASE_APPROVER_ROLES,
  type PurchaseApprovalDecision,
  type PurchaseApproverRole,
} from '@kampus/school-core/lib/finance-purchase-approvals.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { purchaseRequests } from './finance-purchase-requests.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Kademeli onay ayarının sürüm satırı (DOM-FIN-071; ON-223, K-260). Kurum başına bir satır; kademe
 * listesi bütün olarak yazılır ve `If-Match` bu sürümle denetlenir. Satır yoksa ayar hiç
 * değişmemiştir (sürüm 1, kademe yok: tek adımlı yönetici onayı, K-129).
 */
export const purchaseApprovalSettings = pgTable('purchase_approval_settings', {
  institutionId: text('institution_id')
    .primaryKey()
    .references(() => institutions.id),
  ...requiredColumns(),
})

/**
 * Kademe eşiği (K-260): talebin KDV dahil tahmini toplamı alt sınıra eşit ya da büyükse kademe
 * gerekir. Onaylayan ya herhangi bir yönetici (rol) ya da adlandırılmış yönetici üyesidir. Liste
 * yeniden yazılınca eski satırlar arşivlenir; açık talepler kendi dondurulmuş kademelerini taşır.
 */
export const purchaseApprovalTiers = pgTable(
  'purchase_approval_tiers',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    position: integer('position').notNull(),
    minTotalCents: bigint('min_total_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    approverRole: text('approver_role').$type<PurchaseApproverRole>(),
    approverUserId: text('approver_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'purchase_approval_tiers_pkey', columns: [table.institutionId, table.id] }),
    check(
      'purchase_approval_tiers_position_check',
      sql`${table.position} between 1 and ${n(PURCHASE_APPROVAL_TIERS_MAX)}`,
    ),
    check(
      'purchase_approval_tiers_amount_check',
      sql`${table.minTotalCents} between 0 and ${n(BUDGET_AMOUNT_MAX_CENTS)}`,
    ),
    check('purchase_approval_tiers_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'purchase_approval_tiers_approver_check',
      sql`(${table.approverRole} is null) <> (${table.approverUserId} is null)
        and (${table.approverRole} is null or ${oneOf(table.approverRole, PURCHASE_APPROVER_ROLES)})`,
    ),
    uniqueIndex('purchase_approval_tiers_position_key')
      .on(table.institutionId, table.position)
      .where(sql`${table.archivedAt} is null`),
  ],
)

/**
 * Talebe dondurulmuş onay kademesi (K-261): gönderimde tutarın eriştiği kademeler eşiğiyle ve
 * onaylayanıyla kopyalanır; sonradan ayar değişse de açık talep etkilenmez. Kademe sırayla karar
 * alır (K-262); karar, kişi ve zaman yazılır. Taslağa geri çekilen talebin kademeleri arşivlenir,
 * yeniden gönderimde yenileri yazılır.
 */
export const purchaseRequestApprovalSteps = pgTable(
  'purchase_request_approval_steps',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    requestId: uuid('request_id').notNull(),
    position: integer('position').notNull(),
    minTotalCents: bigint('min_total_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    approverRole: text('approver_role').$type<PurchaseApproverRole>(),
    approverUserId: text('approver_user_id'),
    decision: text('decision').$type<PurchaseApprovalDecision>(),
    decidedByUserId: text('decided_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    note: text('note'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'purchase_request_approval_steps_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'purchase_request_approval_steps_request_fkey',
      columns: [table.institutionId, table.requestId],
      foreignColumns: [purchaseRequests.institutionId, purchaseRequests.id],
    }).onDelete('restrict'),
    check(
      'purchase_request_approval_steps_position_check',
      sql`${table.position} between 1 and ${n(PURCHASE_APPROVAL_TIERS_MAX)}`,
    ),
    check(
      'purchase_request_approval_steps_amount_check',
      sql`${table.minTotalCents} between 0 and ${n(BUDGET_AMOUNT_MAX_CENTS)}`,
    ),
    check('purchase_request_approval_steps_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'purchase_request_approval_steps_approver_check',
      sql`(${table.approverRole} is null) <> (${table.approverUserId} is null)
        and (${table.approverRole} is null or ${oneOf(table.approverRole, PURCHASE_APPROVER_ROLES)})`,
    ),
    // Karar, kişi ve zaman birlikte dolar; ret gerekçe taşır.
    check(
      'purchase_request_approval_steps_decision_check',
      sql`(${table.decision} is null and ${table.decidedByUserId} is null and ${table.decidedAt} is null and ${table.note} is null)
        or (${oneOf(table.decision, PURCHASE_APPROVAL_DECISIONS)} and ${table.decidedByUserId} is not null and ${table.decidedAt} is not null
          and (${table.decision} <> 'rejected' or ${table.note} is not null))`,
    ),
    check(
      'purchase_request_approval_steps_note_check',
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${n(PURCHASE_APPROVAL_NOTE_MAX)}`,
    ),
    uniqueIndex('purchase_request_approval_steps_position_key')
      .on(table.institutionId, table.requestId, table.position)
      .where(sql`${table.archivedAt} is null`),
    index('purchase_request_approval_steps_request_idx').on(table.institutionId, table.requestId),
  ],
)
