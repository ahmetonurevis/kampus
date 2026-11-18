import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  STAFF_COST_CANCEL_REASON_MAX,
  STAFF_COST_CANCEL_REASON_MIN,
  STAFF_COST_HOURS_MAX,
  STAFF_COST_SHARE_SCALE,
} from '@kampus/school-core/lib/finance-staff-costs.ts'

import { institutions, memberships } from './auth.ts'
import { requiredColumns } from './columns.ts'
import { costCenters } from './finance-budget.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Personelin maliyet merkezi ataması (DOM-FIN-104; ON-204, K-332). Bir personel üyeliğine ay
 * başından yürürlüğe giren atama: merkez payları (`staff_cost_allocation_shares`, toplam %100) ve
 * saatli ücretlerin tahmini aylık saatleri. Atama sonraki atamanın başlangıç ayına kadar sürer;
 * bitiş saklanmaz. Personelde aynı ay için iptal edilmemiş tek atama kısmi tekil indeksle
 * güvencededir. Atama düzeltilmez, gerekçeyle iptal (arşiv) edilir. Ücret tutarı taşımaz.
 */
export const staffCostAllocations = pgTable(
  'staff_cost_allocations',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    startMonth: date('start_month', { mode: 'string' }).notNull(),
    wageHours: integer('wage_hours'),
    extraLessonHours: integer('extra_lesson_hours'),
    dutyHours: integer('duty_hours'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    cancelReason: text('cancel_reason'),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staff_cost_allocations_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'staff_cost_allocations_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check(
      'staff_cost_allocations_start_month_check',
      sql`extract(day from ${table.startMonth}) = 1 and ${table.startMonth} between '2020-01-01' and '2099-12-01'`,
    ),
    check(
      'staff_cost_allocations_hours_check',
      sql`(${table.wageHours} is null or ${table.wageHours} between 0 and ${n(STAFF_COST_HOURS_MAX)})
        and (${table.extraLessonHours} is null or ${table.extraLessonHours} between 0 and ${n(STAFF_COST_HOURS_MAX)})
        and (${table.dutyHours} is null or ${table.dutyHours} between 0 and ${n(STAFF_COST_HOURS_MAX)})`,
    ),
    // İptal (arşiv) gerekçe ve iptal edeni birlikte taşır.
    check(
      'staff_cost_allocations_cancel_check',
      sql`((${table.archivedAt} is null) = (${table.cancelReason} is null))
        and ((${table.archivedAt} is null) = (${table.cancelledByUserId} is null))
        and (${table.cancelReason} is null or char_length(${table.cancelReason})
          between ${n(STAFF_COST_CANCEL_REASON_MIN)} and ${n(STAFF_COST_CANCEL_REASON_MAX)})`,
    ),
    uniqueIndex('staff_cost_allocations_month_key')
      .on(table.institutionId, table.membershipId, table.startMonth)
      .where(sql`${table.archivedAt} is null`),
    index('staff_cost_allocations_membership_idx').on(
      table.institutionId,
      table.membershipId,
      table.startMonth,
    ),
  ],
)

/**
 * Atamanın merkez payı (DOM-FIN-104). Pay on binde birdir; bir atamada merkez bir kez geçer, toplam
 * 10.000'dir (servis kurum kilidi altında denetler). Pay satırı atamayla birlikte yazılır, değişmez;
 * atama iptal edilince satırlar yerinde kalır, okunmaz.
 */
export const staffCostAllocationShares = pgTable(
  'staff_cost_allocation_shares',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    allocationId: uuid('allocation_id').notNull(),
    costCenterId: uuid('cost_center_id').notNull(),
    shareBasisPoints: integer('share_basis_points').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'staff_cost_allocation_shares_pkey',
      columns: [table.institutionId, table.allocationId, table.costCenterId],
    }),
    foreignKey({
      name: 'staff_cost_allocation_shares_allocation_fkey',
      columns: [table.institutionId, table.allocationId],
      foreignColumns: [staffCostAllocations.institutionId, staffCostAllocations.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'staff_cost_allocation_shares_cost_center_fkey',
      columns: [table.institutionId, table.costCenterId],
      foreignColumns: [costCenters.institutionId, costCenters.id],
    }).onDelete('restrict'),
    check(
      'staff_cost_allocation_shares_share_check',
      sql`${table.shareBasisPoints} between 1 and ${n(STAFF_COST_SHARE_SCALE)}`,
    ),
    index('staff_cost_allocation_shares_cost_center_idx').on(
      table.institutionId,
      table.costCenterId,
    ),
  ],
)
