import { sql } from 'drizzle-orm'
import {
  check,
  date,
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

import type { FeeItem } from '@kampus/school-core/lib/fee-tariffs.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

/**
 * Ücret tarifesi (ADR 0006 karar 8; DOM-FIN-002). Yılda tek açık taslak ve tek yayındaki sürüm
 * kısmi benzersiz indekslerle korunur. Kalemler core `feeItemSchema` ile doğrulanır; yayımlanan
 * satırın kalemleri değişmez, servis reddeder.
 */
export const feeTariffs = pgTable(
  'fee_tariffs',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    academicYear: integer('academic_year').notNull(),
    versionNumber: integer('version_number').notNull(),
    status: text('status').notNull(),
    items: jsonb('items').$type<FeeItem[]>().notNull(),
    announcedDate: date('announced_date'),
    mebbisRecordedDate: date('mebbis_recorded_date'),
    // kvkk: K
    publishedByUserId: text('published_by_user_id'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'fee_tariffs_pkey', columns: [table.institutionId, table.id] }),
    check('fee_tariffs_status_check', oneOf(table.status, ['draft', 'published', 'superseded'])),
    check(
      'fee_tariffs_published_check',
      sql`${table.status} = 'draft' or (${table.announcedDate} is not null and ${table.publishedByUserId} is not null and ${table.publishedAt} is not null)`,
    ),
    uniqueIndex('fee_tariffs_year_version_key').on(
      table.institutionId,
      table.academicYear,
      table.versionNumber,
    ),
    uniqueIndex('fee_tariffs_draft_key')
      .on(table.institutionId, table.academicYear)
      .where(sql`${table.status} = 'draft'`),
    uniqueIndex('fee_tariffs_published_key')
      .on(table.institutionId, table.academicYear)
      .where(sql`${table.status} = 'published'`),
    index('fee_tariffs_year_idx').on(table.institutionId, table.academicYear),
  ],
)
