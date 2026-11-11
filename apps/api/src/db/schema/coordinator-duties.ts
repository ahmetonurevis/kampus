import { sql } from 'drizzle-orm'
import { check, index, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import {
  COORDINATOR_DUTY_KINDS,
  type CoordinatorDutyKind,
} from '@kampus/school-core/lib/coordinator-duties.ts'

import { institutions, memberships } from './auth.ts'
import { keys, oneOf, requiredColumns } from './columns.ts'

/**
 * Öğretmen üyeliğinin ek görevi (DOM-YTK-027): `school`'da zümre başkanı (`subject_head`,
 * kapsam ders kimliği), `language_school`'da akademik koordinatör (`academic_coordinator`,
 * kapsam CEFR seviyesi). Rol modeli değişmez; görev üyeliğe bağlı ayrı satırdır. Yönetici atar,
 * kaldırma arşivdir. Kural core `lib/coordinator-duties.ts`'tedir.
 */
export const coordinatorDuties = pgTable(
  'coordinator_duties',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    membershipId: text('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<CoordinatorDutyKind>().notNull(),
    /** Ders kimliği (`subject_head`) veya CEFR seviyesi (`academic_coordinator`). */
    scopeId: text('scope_id').notNull(),
    // kvkk: K
    assignedByUserId: text('assigned_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'coordinator_duties_pkey', columns: [table.institutionId, table.id] }),
    check('coordinator_duties_kind_check', oneOf(table.kind, keys(COORDINATOR_DUTY_KINDS))),
    check(
      'coordinator_duties_scope_id_check',
      sql`char_length(${table.scopeId}) between 1 and 200`,
    ),
    // Aynı üyeliğe aynı kapsamda tek etkin görev (core `coordinator_duty_exists`).
    uniqueIndex('coordinator_duties_membership_kind_scope_key')
      .on(table.institutionId, table.membershipId, table.kind, table.scopeId)
      .where(sql`${table.archivedAt} is null`),
    // Üyeliğin görevleri (her istekte okunur) ve yabancı anahtar indeksi.
    index('coordinator_duties_membership_idx').on(table.institutionId, table.membershipId),
  ],
)
