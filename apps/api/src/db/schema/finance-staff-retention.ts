import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  STAFF_RETENTION_CATEGORIES,
  STAFF_RETENTION_METHODS,
  STAFF_RETENTION_MONTHS_MAX,
  STAFF_RETENTION_START_EVENTS,
  type StaffRetentionCategory,
  type StaffRetentionMethod,
  type StaffRetentionStartEvent,
} from '@kampus/school-core/lib/finance-staff-retention.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Özlük verisi saklama süresi kurum ayarı (DOM-FIN-122; ON-176, K-415). Kurum ve veri kategorisi
 * başına tek satır; satırı olmayan ya da süresi boş kategori yasal en az süreyi (platform
 * varsayılanı) kullanır. Yasal alt sınır kodda denetlenir (alt sınır mevzuatla değişebilir);
 * kayıtlı süre alt sınırın altına düşerse alt sınır geçerlidir.
 */
export const staffRetentionSettings = pgTable(
  'staff_retention_settings',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    category: text('category').$type<StaffRetentionCategory>().notNull(),
    retentionMonths: integer('retention_months'),
    // kvkk: K
    updatedByUserId: text('updated_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'staff_retention_settings_pkey',
      columns: [table.institutionId, table.category],
    }),
    check(
      'staff_retention_settings_category_check',
      oneOf(table.category, STAFF_RETENTION_CATEGORIES),
    ),
    check(
      'staff_retention_settings_months_check',
      sql`${table.retentionMonths} is null or ${table.retentionMonths} between 1 and ${n(STAFF_RETENTION_MONTHS_MAX)}`,
    ),
  ],
)

/**
 * İmha kaydı (DOM-FIN-122; ON-176, K-417). Her onaylı imha bir satırdır: kategori, yöntem, imha
 * edilen kayıt ve dosya sayısı, uygulanan süre ve başlangıç olayı, imha eden ve an. İmha edilen
 * personelin kimliği, adı ya da ayrılış günü yazılmaz (kişisel veri içermez). Satır değişmez ve
 * silinmez (`kampus_reject_immutable_change`, migration 0013).
 */
export const staffDataDestructions = pgTable(
  'staff_data_destructions',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    category: text('category').$type<StaffRetentionCategory>().notNull(),
    method: text('method').$type<StaffRetentionMethod>().notNull(),
    recordCount: integer('record_count').notNull(),
    fileCount: integer('file_count').notNull(),
    retentionMonths: integer('retention_months').notNull(),
    startEvent: text('start_event').$type<StaffRetentionStartEvent>().notNull(),
    destroyedAt: timestamp('destroyed_at', { withTimezone: true }).notNull(),
    // kvkk: K (imhayı onaylayan yönetici)
    destroyedByUserId: text('destroyed_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staff_data_destructions_pkey', columns: [table.institutionId, table.id] }),
    check(
      'staff_data_destructions_category_check',
      oneOf(table.category, STAFF_RETENTION_CATEGORIES),
    ),
    check('staff_data_destructions_method_check', oneOf(table.method, STAFF_RETENTION_METHODS)),
    check(
      'staff_data_destructions_start_event_check',
      oneOf(table.startEvent, STAFF_RETENTION_START_EVENTS),
    ),
    check(
      'staff_data_destructions_counts_check',
      sql`${table.recordCount} > 0 and ${table.fileCount} >= 0`,
    ),
    check(
      'staff_data_destructions_months_check',
      sql`${table.retentionMonths} between 1 and ${n(STAFF_RETENTION_MONTHS_MAX)}`,
    ),
    index('staff_data_destructions_destroyed_idx').on(
      table.institutionId,
      table.destroyedAt,
      table.id,
    ),
  ],
)
