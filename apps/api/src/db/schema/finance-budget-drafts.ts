import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { BUDGET_AMOUNT_MAX_CENTS } from '@kampus/school-core/lib/finance-budget.ts'
import {
  BUDGET_DRAFT_EVENTS,
  BUDGET_DRAFT_LINES_MAX,
  BUDGET_DRAFT_STATUSES,
  BUDGET_DRAFT_TEXT_MAX,
  type BudgetDraftChange,
  type BudgetDraftEvent,
  type BudgetDraftLineValue,
  type BudgetDraftStatus,
} from '@kampus/school-core/lib/finance-budget-drafts.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { budgetItems, budgetPeriods, costCenters } from './finance-budget.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Maliyet merkezinin bütçe sorumlusu (DOM-FIN-093; ON-243, K-257). Merkez başına tek satır;
 * `membership_id` boşsa sorumlu yoktur ve taslağı yalnız yönetici hazırlar.
 */
export const budgetCenterOwners = pgTable(
  'budget_center_owners',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    costCenterId: uuid('cost_center_id').notNull(),
    membershipId: text('membership_id'),
    assignedByUserId: text('assigned_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'budget_center_owners_pkey',
      columns: [table.institutionId, table.costCenterId],
    }),
    foreignKey({
      name: 'budget_center_owners_cost_center_fkey',
      columns: [table.institutionId, table.costCenterId],
      foreignColumns: [costCenters.institutionId, costCenters.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'budget_center_owners_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    index('budget_center_owners_membership_idx').on(table.institutionId, table.membershipId),
  ],
)

/**
 * Bütçe taslağı: dönem × maliyet merkezi (DOM-FIN-093; ON-243). Durum taslak → onay bekliyor →
 * onaylandı | revizyon istendi (→ yeniden gönderim) | reddedildi; onaylı taslak yeni revizyonla
 * yeniden taslak olur (K-258). `revision` son gönderimin sürüm numarasıdır.
 */
export const budgetDrafts = pgTable(
  'budget_drafts',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    periodId: uuid('period_id').notNull(),
    costCenterId: uuid('cost_center_id').notNull(),
    status: text('status').$type<BudgetDraftStatus>().notNull().default('draft'),
    revision: integer('revision').notNull().default(0),
    createdByUserId: text('created_by_user_id').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submittedByUserId: text('submitted_by_user_id'),
    approvedRevision: integer('approved_revision'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedByUserId: text('approved_by_user_id'),
    decisionNote: text('decision_note'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'budget_drafts_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'budget_drafts_period_fkey',
      columns: [table.institutionId, table.periodId],
      foreignColumns: [budgetPeriods.institutionId, budgetPeriods.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'budget_drafts_cost_center_fkey',
      columns: [table.institutionId, table.costCenterId],
      foreignColumns: [costCenters.institutionId, costCenters.id],
    }).onDelete('restrict'),
    check('budget_drafts_status_check', oneOf(table.status, BUDGET_DRAFT_STATUSES)),
    check(
      'budget_drafts_revision_check',
      sql`${table.revision} >= 0 and (${table.status} = 'draft' or ${table.revision} >= 1)
        and ((${table.submittedAt} is null) = (${table.revision} = 0))
        and ((${table.submittedAt} is null) = (${table.submittedByUserId} is null))`,
    ),
    check(
      'budget_drafts_approval_check',
      sql`((${table.approvedRevision} is null) = (${table.approvedAt} is null))
        and ((${table.approvedAt} is null) = (${table.approvedByUserId} is null))
        and (${table.approvedRevision} is null or ${table.approvedRevision} between 1 and ${table.revision})
        and (${table.status} <> 'approved' or ${table.approvedRevision} = ${table.revision})`,
    ),
    check(
      'budget_drafts_decision_note_check',
      sql`(${table.decisionNote} is null or char_length(${table.decisionNote}) between 1 and ${n(BUDGET_DRAFT_TEXT_MAX)})
        and (${table.status} not in ('revision_requested', 'rejected') or ${table.decisionNote} is not null)`,
    ),
    // Dönem × merkez için reddedilmemiş tek taslak; reddedilenden sonra yenisi açılır.
    uniqueIndex('budget_drafts_period_cost_center_key')
      .on(table.institutionId, table.periodId, table.costCenterId)
      .where(sql`${table.status} <> 'rejected' and ${table.archivedAt} is null`),
    index('budget_drafts_period_idx').on(table.institutionId, table.periodId),
    index('budget_drafts_status_idx').on(table.institutionId, table.status),
    index('budget_drafts_cost_center_idx').on(table.institutionId, table.costCenterId),
  ],
)

/** Taslak satırı: kalem, tutar (kuruş) ve gerekçe; kaldırılan satır arşivlenir. */
export const budgetDraftLines = pgTable(
  'budget_draft_lines',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    draftId: uuid('draft_id').notNull(),
    itemId: uuid('item_id').notNull(),
    position: integer('position').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    justification: text('justification'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'budget_draft_lines_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'budget_draft_lines_draft_fkey',
      columns: [table.institutionId, table.draftId],
      foreignColumns: [budgetDrafts.institutionId, budgetDrafts.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'budget_draft_lines_item_fkey',
      columns: [table.institutionId, table.itemId],
      foreignColumns: [budgetItems.institutionId, budgetItems.id],
    }).onDelete('restrict'),
    check(
      'budget_draft_lines_amount_check',
      sql`${table.amountCents} between 0 and ${n(BUDGET_AMOUNT_MAX_CENTS)}`,
    ),
    check(
      'budget_draft_lines_position_check',
      sql`${table.position} between 0 and ${n(BUDGET_DRAFT_LINES_MAX - 1)}`,
    ),
    check('budget_draft_lines_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'budget_draft_lines_justification_check',
      sql`${table.justification} is null or char_length(${table.justification}) between 1 and ${n(BUDGET_DRAFT_TEXT_MAX)}`,
    ),
    uniqueIndex('budget_draft_lines_item_key')
      .on(table.institutionId, table.draftId, table.itemId)
      .where(sql`${table.archivedAt} is null`),
    index('budget_draft_lines_draft_idx').on(table.institutionId, table.draftId),
    index('budget_draft_lines_item_idx').on(table.institutionId, table.itemId),
  ],
)

/**
 * Taslak geçmişi (DOM-FIN-093): her durum değişikliği bir satır. Gönderim satırı sürümün
 * satırlarını (`lines`) ve önceki sürüme göre değişen kalemleri (`changes`) taşır. Yalnız eklenir.
 */
export const budgetDraftEvents = pgTable(
  'budget_draft_events',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    draftId: uuid('draft_id').notNull(),
    event: text('event').$type<BudgetDraftEvent>().notNull(),
    fromStatus: text('from_status').$type<BudgetDraftStatus>(),
    toStatus: text('to_status').$type<BudgetDraftStatus>().notNull(),
    revision: integer('revision').notNull(),
    note: text('note'),
    lines: jsonb('lines').$type<BudgetDraftLineValue[]>(),
    changes: jsonb('changes').$type<BudgetDraftChange[]>(),
    actorUserId: text('actor_user_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'budget_draft_events_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'budget_draft_events_draft_fkey',
      columns: [table.institutionId, table.draftId],
      foreignColumns: [budgetDrafts.institutionId, budgetDrafts.id],
    }).onDelete('restrict'),
    check('budget_draft_events_event_check', oneOf(table.event, BUDGET_DRAFT_EVENTS)),
    check(
      'budget_draft_events_status_check',
      sql`${oneOf(table.toStatus, BUDGET_DRAFT_STATUSES)}
        and (${table.fromStatus} is null or ${oneOf(table.fromStatus, BUDGET_DRAFT_STATUSES)})
        and ((${table.event} = 'created') = (${table.fromStatus} is null))`,
    ),
    check(
      'budget_draft_events_snapshot_check',
      sql`(${table.event} = 'submitted') = (${table.lines} is not null)
        and (${table.lines} is null) = (${table.changes} is null)
        and (${table.lines} is null or jsonb_typeof(${table.lines}) = 'array')
        and (${table.changes} is null or jsonb_typeof(${table.changes}) = 'array')`,
    ),
    check('budget_draft_events_revision_check', sql`${table.revision} >= 0`),
    check(
      'budget_draft_events_note_check',
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${n(BUDGET_DRAFT_TEXT_MAX)}`,
    ),
    index('budget_draft_events_draft_idx').on(table.institutionId, table.draftId, table.occurredAt),
  ],
)
