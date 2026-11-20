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
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

import {
  ORG_HEADCOUNT_MAX,
  ORG_NAME_MAX,
  ORG_NAME_MIN,
  ORG_UNIT_KINDS,
  type OrgUnitKind,
} from '@kampus/school-core/lib/finance-org-chart.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))
const nameLength = (column: AnyPgColumn) =>
  sql`char_length(${column}) between ${n(ORG_NAME_MIN)} and ${n(ORG_NAME_MAX)}`

/**
 * Organizasyon birimi (DOM-FIN-129; ON-187; K-442). Üst birimle ağaç; döngü ve derinlik sınırı
 * core `assertUnitPlacement` ile kurum kilidi altında denetlenir (veritabanı yalnız kendine
 * bağlanmayı engeller). Birim silinmez, pasife alınır.
 */
export const orgUnits = pgTable(
  'org_units',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    parentId: uuid('parent_id'),
    kind: text('kind').$type<OrgUnitKind>().notNull(),
    isActive: boolean('is_active').notNull().default(true),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'org_units_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'org_units_parent_fkey',
      columns: [table.institutionId, table.parentId],
      foreignColumns: [table.institutionId, table.id],
    }).onDelete('restrict'),
    check('org_units_kind_check', oneOf(table.kind, ORG_UNIT_KINDS)),
    check('org_units_name_check', nameLength(table.name)),
    check(
      'org_units_parent_check',
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`,
    ),
    index('org_units_parent_idx').on(table.institutionId, table.parentId),
  ],
)

/**
 * Pozisyon (DOM-FIN-129; K-443): birimde unvan ve kadro sayısı, raporladığı pozisyon (raporlama
 * hattı; döngü core `assertReportingLine` ile). Kaldırılan pozisyon arşivlenir; geçmiş atamalar
 * kalır.
 */
export const orgPositions = pgTable(
  'org_positions',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    unitId: uuid('unit_id').notNull(),
    title: text('title').notNull(),
    headcount: integer('headcount').notNull(),
    reportsToPositionId: uuid('reports_to_position_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'org_positions_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'org_positions_unit_fkey',
      columns: [table.institutionId, table.unitId],
      foreignColumns: [orgUnits.institutionId, orgUnits.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'org_positions_reports_to_fkey',
      columns: [table.institutionId, table.reportsToPositionId],
      foreignColumns: [table.institutionId, table.id],
    }).onDelete('restrict'),
    check('org_positions_title_check', nameLength(table.title)),
    check(
      'org_positions_headcount_check',
      sql`${table.headcount} between 1 and ${n(ORG_HEADCOUNT_MAX)}`,
    ),
    check(
      'org_positions_reports_to_check',
      sql`${table.reportsToPositionId} is null or ${table.reportsToPositionId} <> ${table.id}`,
    ),
    index('org_positions_unit_idx').on(table.institutionId, table.unitId),
    index('org_positions_reports_to_idx').on(table.institutionId, table.reportsToPositionId),
  ],
)

/**
 * Personelin pozisyona ataması (DOM-FIN-129; K-444). Personel kurum üyeliğidir (ayrı personel
 * tablosu yok). Gün aralığı uçlar dahil; çakışma ve kadro sınırı kurum kilidi altında core
 * `assertAssignmentRange` ile. Yanlış girilen atama arşivlenir.
 */
export const orgAssignments = pgTable(
  'org_assignments',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    positionId: uuid('position_id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'org_assignments_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'org_assignments_position_fkey',
      columns: [table.institutionId, table.positionId],
      foreignColumns: [orgPositions.institutionId, orgPositions.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'org_assignments_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check(
      'org_assignments_dates_check',
      sql`${table.endDate} is null or ${table.endDate} >= ${table.startDate}`,
    ),
    index('org_assignments_position_idx').on(
      table.institutionId,
      table.positionId,
      table.startDate,
    ),
    index('org_assignments_membership_idx').on(table.institutionId, table.membershipId),
  ],
)
