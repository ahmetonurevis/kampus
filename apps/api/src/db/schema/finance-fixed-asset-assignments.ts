import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  FIXED_ASSET_ASSIGNEE_TYPES,
  FIXED_ASSET_ASSIGNMENT_NOTE_MAX,
  FIXED_ASSET_DAMAGE_NOTE_MIN,
  FIXED_ASSET_RETURN_CONDITIONS,
  type FixedAssetAssigneeType,
  type FixedAssetReturnCondition,
} from '@kampus/school-core/lib/finance-fixed-asset-assignments.ts'
import { FIXED_ASSET_LOCATION_MAX } from '@kampus/school-core/lib/finance-fixed-assets.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { fixedAssets } from './finance-fixed-assets.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Demirbaş zimmeti (DOM-FIN-086; ON-236). Demirbaş bir personel üyeliğine ya da bir konuma (kampüs
 * ve oda) teslim edilir; iade gün, durum ve not taşır. Satır silinmez ve düzeltilmez, iade bir
 * kez yazılır (K-212). Demirbaş başına tek açık zimmet `fixed_asset_assignments_open_key` ile
 * güvencededir (K-211). Üyelik silinirse geçmiş korunur: yabancı anahtar `restrict`.
 */
export const fixedAssetAssignments = pgTable(
  'fixed_asset_assignments',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    assetId: uuid('asset_id').notNull(),
    assigneeType: text('assignee_type').$type<FixedAssetAssigneeType>().notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id'),
    campusId: text('campus_id'),
    location: text('location'),
    assignedDate: date('assigned_date', { mode: 'string' }).notNull(),
    note: text('note'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull(),
    // kvkk: K
    assignedByUserId: text('assigned_by_user_id').notNull(),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    returnDate: date('return_date', { mode: 'string' }),
    returnCondition: text('return_condition').$type<FixedAssetReturnCondition>(),
    returnNote: text('return_note'),
    // kvkk: K
    returnedByUserId: text('returned_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'fixed_asset_assignments_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'fixed_asset_assignments_asset_fkey',
      columns: [table.institutionId, table.assetId],
      foreignColumns: [fixedAssets.institutionId, fixedAssets.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fixed_asset_assignments_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check(
      'fixed_asset_assignments_assignee_type_check',
      oneOf(table.assigneeType, FIXED_ASSET_ASSIGNEE_TYPES),
    ),
    // Personel zimmeti yalnız üyelik, konum zimmeti yalnız kampüs ve oda taşır.
    check(
      'fixed_asset_assignments_assignee_check',
      sql`(${table.assigneeType} = 'staff' and ${table.membershipId} is not null
          and ${table.campusId} is null and ${table.location} is null)
        or (${table.assigneeType} = 'location' and ${table.membershipId} is null
          and ${table.location} is not null
          and char_length(${table.location}) between 2 and ${n(FIXED_ASSET_LOCATION_MAX)})`,
    ),
    check(
      'fixed_asset_assignments_note_check',
      sql`(${table.note} is null or char_length(${table.note}) between 1 and ${n(FIXED_ASSET_ASSIGNMENT_NOTE_MAX)})
        and (${table.returnNote} is null or char_length(${table.returnNote}) between 1 and ${n(FIXED_ASSET_ASSIGNMENT_NOTE_MAX)})`,
    ),
    check(
      'fixed_asset_assignments_return_condition_check',
      sql`${table.returnCondition} is null or ${oneOf(table.returnCondition, FIXED_ASSET_RETURN_CONDITIONS)}`,
    ),
    // İade zamanı, günü, durumu ve kişisi birlikte bulunur; hasarlı iade not taşır.
    check(
      'fixed_asset_assignments_return_check',
      sql`((${table.returnedAt} is null) = (${table.returnDate} is null))
        and ((${table.returnedAt} is null) = (${table.returnCondition} is null))
        and ((${table.returnedAt} is null) = (${table.returnedByUserId} is null))
        and (${table.returnedAt} is not null or ${table.returnNote} is null)
        and (${table.returnDate} is null or ${table.returnDate} >= ${table.assignedDate})
        and (${table.returnCondition} is distinct from 'damaged'
          or coalesce(char_length(${table.returnNote}), 0) >= ${n(FIXED_ASSET_DAMAGE_NOTE_MIN)})`,
    ),
    uniqueIndex('fixed_asset_assignments_open_key')
      .on(table.institutionId, table.assetId)
      .where(sql`${table.returnedAt} is null and ${table.archivedAt} is null`),
    index('fixed_asset_assignments_asset_idx').on(
      table.institutionId,
      table.assetId,
      table.assignedDate,
    ),
    index('fixed_asset_assignments_membership_idx').on(table.institutionId, table.membershipId),
  ],
)
