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

import { FIXED_ASSET_LOCATION_MAX } from '@kampus/school-core/lib/finance-fixed-assets.ts'
import {
  MAINTENANCE_ASSIGNEE_TYPES,
  MAINTENANCE_COST_MAX_CENTS,
  MAINTENANCE_DESCRIPTION_MAX,
  MAINTENANCE_DESCRIPTION_MIN,
  MAINTENANCE_EVENTS,
  MAINTENANCE_NOTE_MAX,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_REASON_MIN,
  MAINTENANCE_RESOLUTION_MAX,
  MAINTENANCE_RESOLUTION_MIN,
  MAINTENANCE_STATUSES,
  MAINTENANCE_TITLE_MAX,
  MAINTENANCE_TITLE_MIN,
  type MaintenanceAssigneeType,
  type MaintenanceEvent,
  type MaintenancePriority,
  type MaintenanceStatus,
} from '@kampus/school-core/lib/finance-maintenance-requests.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { fixedAssets } from './finance-fixed-assets.ts'
import { suppliers } from './finance-suppliers.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Arıza ve bakım talebi, iş emri (DOM-FIN-089; ON-239). Kurum üyesinin bildirdiği arıza; yönetici
 * personele ya da tedarikçiye atar, çözer ve kapatır (K-237). Talep silinmez, iptal edilir; her
 * geçiş `maintenance_request_events`'e yazılır. Numara kurum içi sıradır (`AT-<sıra>`). Maliyet
 * yalnız yöneticiye döner (K-238).
 */
export const maintenanceRequests = pgTable(
  'maintenance_requests',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    sequence: integer('sequence').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    campusId: text('campus_id'),
    location: text('location').notNull(),
    assetId: uuid('asset_id'),
    priority: text('priority').$type<MaintenancePriority>().notNull(),
    status: text('status').$type<MaintenanceStatus>().notNull(),
    // kvkk: K
    reportedByUserId: text('reported_by_user_id').notNull(),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull(),
    assigneeType: text('assignee_type').$type<MaintenanceAssigneeType>(),
    // kvkk: K (personel üyeliği)
    assigneeMembershipId: text('assignee_membership_id'),
    assigneeSupplierId: uuid('assignee_supplier_id'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedDate: date('resolved_date', { mode: 'string' }),
    resolution: text('resolution'),
    resolutionCostCents: bigint('resolution_cost_cents', { mode: 'number' }),
    currency: text('currency').notNull().default('TRY'),
    resolutionSupplierId: uuid('resolution_supplier_id'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'maintenance_requests_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'maintenance_requests_asset_fkey',
      columns: [table.institutionId, table.assetId],
      foreignColumns: [fixedAssets.institutionId, fixedAssets.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'maintenance_requests_assignee_membership_fkey',
      columns: [table.institutionId, table.assigneeMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'maintenance_requests_assignee_supplier_fkey',
      columns: [table.institutionId, table.assigneeSupplierId],
      foreignColumns: [suppliers.institutionId, suppliers.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'maintenance_requests_resolution_supplier_fkey',
      columns: [table.institutionId, table.resolutionSupplierId],
      foreignColumns: [suppliers.institutionId, suppliers.id],
    }).onDelete('restrict'),
    check('maintenance_requests_sequence_check', sql`${table.sequence} >= 1`),
    check('maintenance_requests_priority_check', oneOf(table.priority, MAINTENANCE_PRIORITIES)),
    check('maintenance_requests_status_check', oneOf(table.status, MAINTENANCE_STATUSES)),
    check('maintenance_requests_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'maintenance_requests_text_check',
      sql`char_length(${table.title}) between ${n(MAINTENANCE_TITLE_MIN)} and ${n(MAINTENANCE_TITLE_MAX)}
        and char_length(${table.description}) between ${n(MAINTENANCE_DESCRIPTION_MIN)} and ${n(MAINTENANCE_DESCRIPTION_MAX)}
        and char_length(${table.location}) between 2 and ${n(FIXED_ASSET_LOCATION_MAX)}`,
    ),
    // Sorumlu türüne göre yalnız üyelik ya da yalnız tedarikçi; atanmamış talepte ikisi de boş.
    check(
      'maintenance_requests_assignee_check',
      sql`((${table.assigneeType} is null) = (${table.assignedAt} is null))
        and ((${table.assigneeType} is null and ${table.assigneeMembershipId} is null
            and ${table.assigneeSupplierId} is null)
          or (${table.assigneeType} = 'staff' and ${table.assigneeMembershipId} is not null
            and ${table.assigneeSupplierId} is null)
          or (${table.assigneeType} = 'supplier' and ${table.assigneeSupplierId} is not null
            and ${table.assigneeMembershipId} is null))
        and (${table.status} in ('open', 'cancelled') or ${table.assigneeType} is not null)
        and (${table.status} <> 'open' or ${table.assigneeType} is null)`,
    ),
    // Çözüm alanları birlikte bulunur; çözülmüş ya da kapatılmış talepte doludur.
    check(
      'maintenance_requests_resolution_check',
      sql`((${table.resolvedAt} is null) = (${table.resolvedDate} is null))
        and ((${table.resolvedAt} is null) = (${table.resolution} is null))
        and ((${table.status} in ('resolved', 'closed')) = (${table.resolvedAt} is not null))
        and (${table.resolution} is null
          or char_length(${table.resolution}) between ${n(MAINTENANCE_RESOLUTION_MIN)} and ${n(MAINTENANCE_RESOLUTION_MAX)})
        and (${table.resolutionCostCents} is null or (${table.resolvedAt} is not null
          and ${table.resolutionCostCents} between 1 and ${n(MAINTENANCE_COST_MAX_CENTS)}))
        and (${table.resolutionSupplierId} is null or ${table.resolvedAt} is not null)`,
    ),
    check(
      'maintenance_requests_close_check',
      sql`((${table.status} = 'closed') = (${table.closedAt} is not null))
        and ((${table.status} = 'cancelled') = (${table.cancelledAt} is not null))
        and ((${table.cancelledAt} is null) = (${table.cancelReason} is null))
        and (${table.cancelReason} is null
          or char_length(${table.cancelReason}) between ${n(MAINTENANCE_REASON_MIN)} and ${n(MAINTENANCE_NOTE_MAX)})
        and (${table.startedAt} is null or ${table.status} <> 'open')`,
    ),
    uniqueIndex('maintenance_requests_sequence_key').on(table.institutionId, table.sequence),
    index('maintenance_requests_status_idx').on(
      table.institutionId,
      table.status,
      table.reportedAt,
    ),
    index('maintenance_requests_asset_idx').on(table.institutionId, table.assetId),
    index('maintenance_requests_reported_by_idx').on(table.institutionId, table.reportedByUserId),
    index('maintenance_requests_assignee_membership_idx').on(
      table.institutionId,
      table.assigneeMembershipId,
    ),
    index('maintenance_requests_assignee_supplier_idx').on(
      table.institutionId,
      table.assigneeSupplierId,
    ),
    index('maintenance_requests_resolution_supplier_idx').on(
      table.institutionId,
      table.resolutionSupplierId,
    ),
  ],
)

/**
 * İş emri geçmişi (DOM-FIN-089, K-237): talebin her durum değişikliği bir satırdır (kim, ne zaman,
 * not). Satır yalnız eklenir; depo güncelleme ve silme sunmaz. Atama satırı o anki sorumluyu taşır
 * ki yeniden atamada önceki sorumlu kaybolmasın.
 */
export const maintenanceRequestEvents = pgTable(
  'maintenance_request_events',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    requestId: uuid('request_id').notNull(),
    event: text('event').$type<MaintenanceEvent>().notNull(),
    fromStatus: text('from_status').$type<MaintenanceStatus>(),
    toStatus: text('to_status').$type<MaintenanceStatus>().notNull(),
    note: text('note'),
    assigneeType: text('assignee_type').$type<MaintenanceAssigneeType>(),
    // kvkk: K (personel üyeliği)
    assigneeMembershipId: text('assignee_membership_id'),
    assigneeSupplierId: uuid('assignee_supplier_id'),
    // kvkk: K
    actorUserId: text('actor_user_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'maintenance_request_events_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'maintenance_request_events_request_fkey',
      columns: [table.institutionId, table.requestId],
      foreignColumns: [maintenanceRequests.institutionId, maintenanceRequests.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'maintenance_request_events_assignee_membership_fkey',
      columns: [table.institutionId, table.assigneeMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'maintenance_request_events_assignee_supplier_fkey',
      columns: [table.institutionId, table.assigneeSupplierId],
      foreignColumns: [suppliers.institutionId, suppliers.id],
    }).onDelete('restrict'),
    check('maintenance_request_events_event_check', oneOf(table.event, MAINTENANCE_EVENTS)),
    check(
      'maintenance_request_events_status_check',
      sql`${oneOf(table.toStatus, MAINTENANCE_STATUSES)}
        and (${table.fromStatus} is null or ${oneOf(table.fromStatus, MAINTENANCE_STATUSES)})
        and ((${table.event} = 'reported') = (${table.fromStatus} is null))`,
    ),
    check(
      'maintenance_request_events_assignee_check',
      sql`((${table.event} = 'assigned') = (${table.assigneeType} is not null))
        and (${table.assigneeType} is null or ${oneOf(table.assigneeType, MAINTENANCE_ASSIGNEE_TYPES)})
        and ((${table.assigneeType} = 'staff') = (${table.assigneeMembershipId} is not null))
        and ((${table.assigneeType} = 'supplier') = (${table.assigneeSupplierId} is not null))`,
    ),
    check(
      'maintenance_request_events_note_check',
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${n(MAINTENANCE_RESOLUTION_MAX)}`,
    ),
    index('maintenance_request_events_request_idx').on(
      table.institutionId,
      table.requestId,
      table.occurredAt,
    ),
    index('maintenance_request_events_assignee_membership_idx').on(
      table.institutionId,
      table.assigneeMembershipId,
    ),
    index('maintenance_request_events_assignee_supplier_idx').on(
      table.institutionId,
      table.assigneeSupplierId,
    ),
  ],
)
