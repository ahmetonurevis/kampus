import { sql } from 'drizzle-orm'
import { check, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

import { institutions, memberships } from './auth.ts'

export const MEMBERSHIP_LINK_KINDS = ['student', 'child', 'teacher'] as const
export type MembershipLinkKind = (typeof MEMBERSHIP_LINK_KINDS)[number]

/**
 * Üyeliğin school-core kayıtlarına bağlantısı: öğrenci → kendi öğrenci kaydı, veli → çocukları,
 * öğretmen → öğretmen kaydı. Kapsam fonksiyonları bu tablodan beslenir; kayıtlar `records`'tadır.
 */
export const membershipLinks = pgTable(
  'membership_links',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    membershipId: text('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: MEMBERSHIP_LINK_KINDS }).notNull(),
    // kvkk: K (school-core kayıt kimliği)
    recordId: text('record_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    primaryKey({
      name: 'membership_links_pkey',
      columns: [table.institutionId, table.membershipId, table.kind, table.recordId],
    }),
    check('membership_links_kind_check', sql`${table.kind} in ('student', 'child', 'teacher')`),
  ],
)
