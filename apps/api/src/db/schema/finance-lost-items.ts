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
  LOST_ITEM_CATEGORIES,
  LOST_ITEM_DESCRIPTION_MAX,
  LOST_ITEM_DISPOSAL_REASON_MAX,
  LOST_ITEM_LOCATION_MAX,
  LOST_ITEM_RECIPIENT_NAME_MAX,
  LOST_ITEM_RECIPIENT_TYPES,
  LOST_ITEM_RETENTION_DEFAULT_DAYS,
  LOST_ITEM_RETENTION_MAX_DAYS,
  LOST_ITEM_RETENTION_MIN_DAYS,
  LOST_ITEM_STATUSES,
  LOST_REPORT_STATUSES,
  type LostItemCategory,
  type LostItemRecipientType,
  type LostItemStatus,
  type LostReportStatus,
} from '@kampus/school-core/lib/finance-lost-items.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Bulunan eşya (DOM-FIN-145; ON-171, K-490…K-492). Tanım, kategori, bulunduğu yer ve gün, isteğe
 * bağlı bulan personel üyeliği, saklama yeri ve durum. Fotoğraflar `files` satırlarıdır
 * (`attached_type = 'lost_item'`, `attached_id` eşya kimliği). Teslimde teslim alan (öğrenci
 * `records` kimliği, veli bağı `student_guardians` kimliği ya da serbest ad) ve adın o anki kopyası,
 * teslim eden üyelik ve an; bağış/imhada sonuç, gerekçe, yapan üyelik ve an yazılır. Bekleyen
 * dışındaki satır değişmez; satır silinmez.
 */
export const lostItems = pgTable(
  'lost_items',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (serbest metin; eşyada ad yazılı olabilir)
    description: text('description').notNull(),
    category: text('category').$type<LostItemCategory>().notNull(),
    foundLocation: text('found_location').notNull(),
    foundOn: date('found_on', { mode: 'string' }).notNull(),
    // kvkk: K (bulan personelin üyeliği)
    finderMembershipId: text('finder_membership_id'),
    storageLocation: text('storage_location').notNull(),
    status: text('status').$type<LostItemStatus>().notNull().default('pending'),
    recipientType: text('recipient_type').$type<LostItemRecipientType>(),
    // kvkk: K (records öğrenci kimliği)
    recipientStudentId: text('recipient_student_id'),
    // kvkk: K (veli bağı kimliği)
    recipientGuardianLinkId: text('recipient_guardian_link_id'),
    // kvkk: K (teslim alanın adı; teslim anındaki kopya)
    recipientName: text('recipient_name'),
    handedOverAt: timestamp('handed_over_at', { withTimezone: true }),
    // kvkk: K (teslim eden personel üyeliği)
    handedOverByMembershipId: text('handed_over_by_membership_id'),
    disposedAt: timestamp('disposed_at', { withTimezone: true }),
    // kvkk: K (serbest metin)
    disposalReason: text('disposal_reason'),
    // kvkk: K (bağış/imhayı yapan üyelik)
    disposedByMembershipId: text('disposed_by_membership_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'lost_items_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'lost_items_finder_membership_fkey',
      columns: [table.institutionId, table.finderMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lost_items_handed_over_by_fkey',
      columns: [table.institutionId, table.handedOverByMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lost_items_disposed_by_fkey',
      columns: [table.institutionId, table.disposedByMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('lost_items_category_check', oneOf(table.category, LOST_ITEM_CATEGORIES)),
    check('lost_items_status_check', oneOf(table.status, LOST_ITEM_STATUSES)),
    check(
      'lost_items_description_check',
      sql`char_length(${table.description}) between 2 and ${n(LOST_ITEM_DESCRIPTION_MAX)}`,
    ),
    check(
      'lost_items_location_check',
      sql`char_length(${table.foundLocation}) between 1 and ${n(LOST_ITEM_LOCATION_MAX)} and char_length(${table.storageLocation}) between 1 and ${n(LOST_ITEM_LOCATION_MAX)}`,
    ),
    check(
      'lost_items_handover_check',
      sql`(${table.status} = 'handed_over') = (${table.handedOverAt} is not null) and (${table.handedOverAt} is null) = (${table.recipientType} is null) and (${table.handedOverAt} is null) = (${table.handedOverByMembershipId} is null) and (${table.handedOverAt} is null) = (${table.recipientName} is null)`,
    ),
    check(
      'lost_items_recipient_check',
      sql`${table.recipientType} is null or (${oneOf(table.recipientType, LOST_ITEM_RECIPIENT_TYPES)} and (${table.recipientType} = 'other') = (${table.recipientStudentId} is null) and (${table.recipientType} = 'guardian') = (${table.recipientGuardianLinkId} is not null) and char_length(${table.recipientName}) between 1 and ${n(LOST_ITEM_RECIPIENT_NAME_MAX)})`,
    ),
    check(
      'lost_items_disposal_check',
      sql`(${table.status} in ('donated', 'destroyed')) = (${table.disposedAt} is not null) and (${table.disposedAt} is null) = (${table.disposalReason} is null) and (${table.disposedAt} is null) = (${table.disposedByMembershipId} is null) and (${table.disposalReason} is null or char_length(${table.disposalReason}) between 2 and ${n(LOST_ITEM_DISPOSAL_REASON_MAX)})`,
    ),
    index('lost_items_status_found_idx').on(table.institutionId, table.status, table.foundOn),
    index('lost_items_finder_idx').on(table.institutionId, table.finderMembershipId),
    index('lost_items_handed_over_by_idx').on(table.institutionId, table.handedOverByMembershipId),
    index('lost_items_disposed_by_idx').on(table.institutionId, table.disposedByMembershipId),
  ],
)

/**
 * Kayıp bildirimi (DOM-FIN-145; K-491). Veli çocuğu, öğrenci kendisi için açar: öğrenci
 * (`records` kimliği), tanım, isteğe bağlı kategori, kaybolma günü, bildiren kullanıcı ve rolü.
 * Ön büro bildirimi bekleyen eşyayla eşler; eşya teslim edilince bildirim `returned` olur. Bir eşya
 * aynı anda en çok bir eşlenmiş bildirimde bulunur (kısmi tekil indeks).
 */
export const lostItemReports = pgTable(
  'lost_item_reports',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (records öğrenci kimliği)
    studentId: text('student_id').notNull(),
    // kvkk: K (serbest metin)
    description: text('description').notNull(),
    category: text('category').$type<LostItemCategory>(),
    lostOn: date('lost_on', { mode: 'string' }).notNull(),
    status: text('status').$type<LostReportStatus>().notNull().default('open'),
    matchedItemId: uuid('matched_item_id'),
    matchedAt: timestamp('matched_at', { withTimezone: true }),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    // kvkk: K
    closedByUserId: text('closed_by_user_id'),
    // kvkk: K
    reportedByUserId: text('reported_by_user_id').notNull(),
    reporterRole: text('reporter_role').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'lost_item_reports_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'lost_item_reports_item_fkey',
      columns: [table.institutionId, table.matchedItemId],
      foreignColumns: [lostItems.institutionId, lostItems.id],
    }).onDelete('restrict'),
    check('lost_item_reports_status_check', oneOf(table.status, LOST_REPORT_STATUSES)),
    check(
      'lost_item_reports_category_check',
      sql`${table.category} is null or ${oneOf(table.category, LOST_ITEM_CATEGORIES)}`,
    ),
    check(
      'lost_item_reports_description_check',
      sql`char_length(${table.description}) between 2 and ${n(LOST_ITEM_DESCRIPTION_MAX)}`,
    ),
    check('lost_item_reports_role_check', sql`${table.reporterRole} in ('veli', 'ogrenci')`),
    check(
      'lost_item_reports_match_check',
      sql`(${table.status} in ('matched', 'returned')) = (${table.matchedItemId} is not null) and (${table.matchedItemId} is null) = (${table.matchedAt} is null) and (${table.status} = 'returned') = (${table.returnedAt} is not null) and (${table.status} = 'closed') = (${table.closedAt} is not null) and (${table.closedAt} is null) = (${table.closedByUserId} is null)`,
    ),
    index('lost_item_reports_status_idx').on(table.institutionId, table.status, table.lostOn),
    index('lost_item_reports_student_idx').on(table.institutionId, table.studentId),
    index('lost_item_reports_item_idx').on(table.institutionId, table.matchedItemId),
    uniqueIndex('lost_item_reports_matched_item_key')
      .on(table.institutionId, table.matchedItemId)
      .where(sql`${table.status} = 'matched'`),
  ],
)

/**
 * Kayıp eşya ayarı (DOM-FIN-145; K-491, K-492). Kurum başına bir satır; satır yoksa varsayılan
 * (30 gün, aile galerisi açık, ayar sürümü 1).
 */
export const lostItemSettings = pgTable(
  'lost_item_settings',
  {
    institutionId: text('institution_id')
      .primaryKey()
      .references(() => institutions.id),
    retentionDays: integer('retention_days').notNull().default(LOST_ITEM_RETENTION_DEFAULT_DAYS),
    familyGalleryEnabled: boolean('family_gallery_enabled').notNull().default(true),
    ...requiredColumns(),
  },
  (table) => [
    check(
      'lost_item_settings_retention_check',
      sql`${table.retentionDays} between ${n(LOST_ITEM_RETENTION_MIN_DAYS)} and ${n(LOST_ITEM_RETENTION_MAX_DAYS)}`,
    ),
  ],
)
