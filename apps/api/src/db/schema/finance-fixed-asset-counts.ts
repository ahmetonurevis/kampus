import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
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
  FIXED_ASSET_COUNT_ITEM_RESULTS,
  FIXED_ASSET_COUNT_NOTE_MAX,
  FIXED_ASSET_COUNT_SCOPE_TYPES,
  FIXED_ASSET_COUNT_STATUSES,
  type FixedAssetCountItemResult,
  type FixedAssetCountScopeType,
  type FixedAssetCountStatus,
} from '@kampus/school-core/lib/finance-fixed-asset-counts.ts'
import { FIXED_ASSET_LOCATION_MAX } from '@kampus/school-core/lib/finance-fixed-assets.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { fixedAssets } from './finance-fixed-assets.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Demirbaş sayımı (DOM-FIN-087; ON-237). Kapsam bütün kurum, bir kampüs ya da bir odadır; aynı
 * kapsamda tek açık sayım `fixed_asset_counts_open_key` ile güvencededir (K-234). Sayım silinmez,
 * tamamlanır ya da iptal edilir.
 */
export const fixedAssetCounts = pgTable(
  'fixed_asset_counts',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    scopeType: text('scope_type').$type<FixedAssetCountScopeType>().notNull(),
    campusId: text('campus_id'),
    location: text('location'),
    scopeKey: text('scope_key').notNull(),
    note: text('note'),
    status: text('status').$type<FixedAssetCountStatus>().notNull().default('open'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    // kvkk: K
    startedByUserId: text('started_by_user_id').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // kvkk: K
    completedByUserId: text('completed_by_user_id'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'fixed_asset_counts_pkey', columns: [table.institutionId, table.id] }),
    check(
      'fixed_asset_counts_scope_type_check',
      oneOf(table.scopeType, FIXED_ASSET_COUNT_SCOPE_TYPES),
    ),
    // Kurum sayımı kampüs ve oda taşımaz, kampüs sayımı yalnız kampüs, oda sayımı oda (ve kampüs).
    check(
      'fixed_asset_counts_scope_check',
      sql`(${table.scopeType} = 'institution' and ${table.campusId} is null and ${table.location} is null)
        or (${table.scopeType} = 'campus' and ${table.campusId} is not null and ${table.location} is null)
        or (${table.scopeType} = 'location' and ${table.location} is not null
          and char_length(${table.location}) between 2 and ${n(FIXED_ASSET_LOCATION_MAX)})`,
    ),
    check(
      'fixed_asset_counts_note_check',
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${n(FIXED_ASSET_COUNT_NOTE_MAX)}`,
    ),
    check('fixed_asset_counts_status_check', oneOf(table.status, FIXED_ASSET_COUNT_STATUSES)),
    // Tamamlanan sayım tamamlama izini, iptal edilen iptal izini taşır; açık sayım hiçbirini.
    check(
      'fixed_asset_counts_close_check',
      sql`((${table.status} = 'completed') = (${table.completedAt} is not null))
        and ((${table.completedAt} is null) = (${table.completedByUserId} is null))
        and ((${table.status} = 'cancelled') = (${table.cancelledAt} is not null))
        and ((${table.cancelledAt} is null) = (${table.cancelledByUserId} is null))`,
    ),
    uniqueIndex('fixed_asset_counts_open_key')
      .on(table.institutionId, table.scopeKey)
      .where(sql`${table.status} = 'open' and ${table.archivedAt} is null`),
    index('fixed_asset_counts_status_idx').on(table.institutionId, table.status, table.startedAt),
  ],
)

/**
 * Sayım satırı (DOM-FIN-087). Beklenen liste başlangıçta `in_scope = true` ve `pending` olarak
 * yazılır (K-232); listede olmayan kurum demirbaşı okutulunca `in_scope = false` satırı eklenir
 * (K-233). Etiket, ad ve kayıtlı yer o anın kopyasıdır: demirbaş sonradan düzeltilse de rapor
 * değişmez. Okutma bir kez yazılır; konum düzeltmesi yalnız yanlış konumdaki satırda (K-235).
 */
export const fixedAssetCountItems = pgTable(
  'fixed_asset_count_items',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    countId: uuid('count_id').notNull(),
    assetId: uuid('asset_id').notNull(),
    inScope: boolean('in_scope').notNull(),
    tagNumber: text('tag_number').notNull(),
    assetName: text('asset_name').notNull(),
    recordedCampusId: text('recorded_campus_id'),
    recordedLocation: text('recorded_location').notNull(),
    result: text('result').$type<FixedAssetCountItemResult>().notNull().default('pending'),
    observedCampusId: text('observed_campus_id'),
    observedLocation: text('observed_location'),
    scannedAt: timestamp('scanned_at', { withTimezone: true }),
    // kvkk: K
    scannedByUserId: text('scanned_by_user_id'),
    relocatedAt: timestamp('relocated_at', { withTimezone: true }),
    // kvkk: K
    relocatedByUserId: text('relocated_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'fixed_asset_count_items_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'fixed_asset_count_items_count_fkey',
      columns: [table.institutionId, table.countId],
      foreignColumns: [fixedAssetCounts.institutionId, fixedAssetCounts.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fixed_asset_count_items_asset_fkey',
      columns: [table.institutionId, table.assetId],
      foreignColumns: [fixedAssets.institutionId, fixedAssets.id],
    }).onDelete('restrict'),
    check(
      'fixed_asset_count_items_result_check',
      oneOf(table.result, FIXED_ASSET_COUNT_ITEM_RESULTS),
    ),
    // Okunan satır sayılan yeri, zamanı ve kişiyi taşır; okunmayan hiçbirini. Listede olmayan
    // demirbaş yalnız okutulunca eklenir. Konum düzeltmesi yalnız yanlış konumdaki satırda.
    check(
      'fixed_asset_count_items_scan_check',
      sql`((${table.result} = 'pending') = (${table.scannedAt} is null))
        and ((${table.scannedAt} is null) = (${table.scannedByUserId} is null))
        and ((${table.scannedAt} is null) = (${table.observedLocation} is null))
        and (${table.scannedAt} is not null or ${table.observedCampusId} is null)
        and (${table.inScope} or ${table.result} <> 'pending')
        and ((${table.relocatedAt} is null) = (${table.relocatedByUserId} is null))
        and (${table.relocatedAt} is null or ${table.result} = 'misplaced')`,
    ),
    check(
      'fixed_asset_count_items_text_check',
      sql`char_length(${table.recordedLocation}) between 2 and ${n(FIXED_ASSET_LOCATION_MAX)}
        and (${table.observedLocation} is null
          or char_length(${table.observedLocation}) between 2 and ${n(FIXED_ASSET_LOCATION_MAX)})`,
    ),
    uniqueIndex('fixed_asset_count_items_asset_key').on(
      table.institutionId,
      table.countId,
      table.assetId,
    ),
    index('fixed_asset_count_items_count_idx').on(
      table.institutionId,
      table.countId,
      table.result,
      table.tagNumber,
    ),
    index('fixed_asset_count_items_asset_idx').on(table.institutionId, table.assetId),
  ],
)
