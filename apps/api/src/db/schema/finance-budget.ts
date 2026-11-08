import { sql } from 'drizzle-orm'
import {
  bigint,
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

import { ACADEMIC_YEAR_MAX, ACADEMIC_YEAR_MIN } from '@kampus/school-core/lib/academic-years.ts'
import { FEE_ITEM_KINDS, type FeeItemKind } from '@kampus/school-core/lib/fee-tariffs.ts'
import {
  BUDGET_AMOUNT_MAX_CENTS,
  BUDGET_ITEM_KINDS,
  BUDGET_PERIOD_MAX_DAYS,
  BUDGET_PERIOD_STATUSES,
  type BudgetItemKind,
  type BudgetPeriodStatus,
} from '@kampus/school-core/lib/finance-budget.ts'
import {
  COST_CENTER_GRADE_MAX,
  COST_CENTER_GRADE_MIN,
  COST_CENTER_TYPES,
  FINANCE_CODE_MAX,
  FINANCE_NAME_MAX,
  type CostCenterType,
} from '@kampus/school-core/lib/finance-cost-centers.ts'

import { institutions } from './auth.ts'
import { courses } from './courses.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))
/** Kod biçimi core `financeCodeSchema` ile aynı: büyük harfe çevrilmiş ASCII. */
const CODE_PATTERN = `^[A-Z0-9][A-Z0-9._-]{0,${String(FINANCE_CODE_MAX - 1)}}$`

/**
 * Maliyet merkezi (DOM-FIN-062; ON-242, IST-010). Kampüs merkezi kampüse (`branches` kaydı) bağlanır,
 * program merkezi okulda sınıf düzeyine, dil okulunda kura; birim bağsızdır. Hiyerarşi aynı
 * kurumun merkezine bileşik yabancı anahtardır; döngü ve düzey sınırı core'da kurum kilidi
 * altında denetlenir. Silinmez, `is_active` ile pasifleşir.
 */
export const costCenters = pgTable(
  'cost_centers',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type').$type<CostCenterType>().notNull(),
    parentId: uuid('parent_id'),
    campusId: text('campus_id'),
    gradeLevel: integer('grade_level'),
    courseId: uuid('course_id'),
    isActive: boolean('is_active').notNull().default(true),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'cost_centers_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'cost_centers_parent_fkey',
      columns: [table.institutionId, table.parentId],
      foreignColumns: [table.institutionId, table.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'cost_centers_course_fkey',
      columns: [table.institutionId, table.courseId],
      foreignColumns: [courses.institutionId, courses.id],
    }).onDelete('restrict'),
    check('cost_centers_code_check', sql`${table.code} ~ ${sql.raw(`'${CODE_PATTERN}'`)}`),
    check(
      'cost_centers_name_check',
      sql`char_length(${table.name}) between 2 and ${n(FINANCE_NAME_MAX)}`,
    ),
    check('cost_centers_type_check', oneOf(table.type, COST_CENTER_TYPES)),
    check(
      'cost_centers_parent_check',
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`,
    ),
    check(
      'cost_centers_grade_level_check',
      sql`${table.gradeLevel} is null or ${table.gradeLevel} between ${n(COST_CENTER_GRADE_MIN)} and ${n(COST_CENTER_GRADE_MAX)}`,
    ),
    // Bağ türe uyar (core `costCenterSchema`): kampüs zorunlu kampüs, birim bağsız, program düzey ya da kur.
    check(
      'cost_centers_link_check',
      sql`(${table.type} = 'campus' and ${table.campusId} is not null and ${table.gradeLevel} is null and ${table.courseId} is null)
        or (${table.type} = 'unit' and ${table.campusId} is null and ${table.gradeLevel} is null and ${table.courseId} is null)
        or (${table.type} = 'program' and ${table.campusId} is null and (${table.gradeLevel} is null or ${table.courseId} is null))`,
    ),
    uniqueIndex('cost_centers_code_key')
      .on(table.institutionId, table.code)
      .where(sql`${table.archivedAt} is null`),
    // Kampüse tek etkin merkez (core `cost_center_campus_taken`).
    uniqueIndex('cost_centers_campus_key')
      .on(table.institutionId, table.campusId)
      .where(
        sql`${table.campusId} is not null and ${table.isActive} and ${table.archivedAt} is null`,
      ),
    index('cost_centers_parent_idx').on(table.institutionId, table.parentId),
    index('cost_centers_course_idx').on(table.institutionId, table.courseId),
  ],
)

/**
 * Bütçe kalemi (DOM-FIN-062; ON-241). Gelir kalemi isteğe bağlı olarak bir ücret türüne eşlenir;
 * bir ücret türüne tek etkin gelir kalemi (K-72). Silinmez, pasifleşir.
 */
export const budgetItems = pgTable(
  'budget_items',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind').$type<BudgetItemKind>().notNull(),
    feeKind: text('fee_kind').$type<FeeItemKind>(),
    isActive: boolean('is_active').notNull().default(true),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'budget_items_pkey', columns: [table.institutionId, table.id] }),
    check('budget_items_code_check', sql`${table.code} ~ ${sql.raw(`'${CODE_PATTERN}'`)}`),
    check(
      'budget_items_name_check',
      sql`char_length(${table.name}) between 2 and ${n(FINANCE_NAME_MAX)}`,
    ),
    check('budget_items_kind_check', oneOf(table.kind, BUDGET_ITEM_KINDS)),
    check(
      'budget_items_fee_kind_check',
      sql`${table.feeKind} is null or (${table.kind} = 'income' and ${oneOf(table.feeKind, FEE_ITEM_KINDS)})`,
    ),
    uniqueIndex('budget_items_code_key')
      .on(table.institutionId, table.code)
      .where(sql`${table.archivedAt} is null`),
    uniqueIndex('budget_items_fee_kind_key')
      .on(table.institutionId, table.feeKind)
      .where(
        sql`${table.feeKind} is not null and ${table.isActive} and ${table.archivedAt} is null`,
      ),
  ],
)

/**
 * Bütçe dönemi (DOM-FIN-062; ON-241, IST-011). Eğitim yılına bağlı dönemde günler oluşturulurken
 * yılın kaydından kopyalanır (K-63). Durum taslak → açık → kapalı; açan ve kapatan iz bırakır.
 * Açık dönemlerin örtüşmemesi core'da kurum kilidi altında denetlenir (K-62).
 */
export const budgetPeriods = pgTable(
  'budget_periods',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    academicYear: integer('academic_year'),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    status: text('status').$type<BudgetPeriodStatus>().notNull().default('draft'),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    openedByUserId: text('opened_by_user_id'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedByUserId: text('closed_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'budget_periods_pkey', columns: [table.institutionId, table.id] }),
    check(
      'budget_periods_name_check',
      sql`char_length(${table.name}) between 2 and ${n(FINANCE_NAME_MAX)}`,
    ),
    check(
      'budget_periods_academic_year_check',
      sql`${table.academicYear} is null or ${table.academicYear} between ${n(ACADEMIC_YEAR_MIN)} and ${n(ACADEMIC_YEAR_MAX)}`,
    ),
    check(
      'budget_periods_dates_check',
      sql`${table.endDate} >= ${table.startDate} and ${table.endDate} - ${table.startDate} < ${n(BUDGET_PERIOD_MAX_DAYS)}`,
    ),
    check('budget_periods_status_check', oneOf(table.status, BUDGET_PERIOD_STATUSES)),
    check(
      'budget_periods_lifecycle_check',
      sql`(${table.status} = 'draft' and ${table.openedAt} is null and ${table.closedAt} is null)
        or (${table.status} = 'open' and ${table.openedAt} is not null and ${table.openedByUserId} is not null and ${table.closedAt} is null)
        or (${table.status} = 'closed' and ${table.openedAt} is not null and ${table.closedAt} is not null and ${table.closedByUserId} is not null)`,
    ),
    uniqueIndex('budget_periods_name_key')
      .on(table.institutionId, table.name)
      .where(sql`${table.archivedAt} is null`),
  ],
)

/**
 * Bütçe satırı: dönem × maliyet merkezi × kalem için planlanan tutar (DOM-FIN-062). Aylık dağılım
 * dönemin değdiği takvim aylarının sırasıyla tutar listesidir; toplamın tutara eşitliği core'da
 * denetlenir (K-64). Kaldırma arşivdir; aynı üçlü için tek etkin satır.
 */
export const budgetLines = pgTable(
  'budget_lines',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    periodId: uuid('period_id').notNull(),
    costCenterId: uuid('cost_center_id').notNull(),
    itemId: uuid('item_id').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    monthlyCents: bigint('monthly_cents', { mode: 'number' }).array(),
    currency: text('currency').notNull().default('TRY'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'budget_lines_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'budget_lines_period_fkey',
      columns: [table.institutionId, table.periodId],
      foreignColumns: [budgetPeriods.institutionId, budgetPeriods.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'budget_lines_cost_center_fkey',
      columns: [table.institutionId, table.costCenterId],
      foreignColumns: [costCenters.institutionId, costCenters.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'budget_lines_item_fkey',
      columns: [table.institutionId, table.itemId],
      foreignColumns: [budgetItems.institutionId, budgetItems.id],
    }).onDelete('restrict'),
    check(
      'budget_lines_amount_check',
      sql`${table.amountCents} between 0 and ${n(BUDGET_AMOUNT_MAX_CENTS)}`,
    ),
    check(
      'budget_lines_monthly_check',
      sql`${table.monthlyCents} is null or (cardinality(${table.monthlyCents}) between 1 and 24 and 0 <= all(${table.monthlyCents}))`,
    ),
    check('budget_lines_currency_check', sql`${table.currency} = 'TRY'`),
    uniqueIndex('budget_lines_key')
      .on(table.institutionId, table.periodId, table.costCenterId, table.itemId)
      .where(sql`${table.archivedAt} is null`),
    index('budget_lines_cost_center_idx').on(table.institutionId, table.costCenterId),
    index('budget_lines_item_idx').on(table.institutionId, table.itemId),
  ],
)
