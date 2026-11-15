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

import { FIXED_ASSET_LOCATION_MAX } from '@kampus/school-core/lib/finance-fixed-assets.ts'
import {
  MAINTENANCE_DOCUMENT_NUMBER_MAX,
  MAINTENANCE_INSPECTION_NOTE_MAX,
  MAINTENANCE_INSPECTION_NOTE_MIN,
  MAINTENANCE_INSPECTION_REASON_MAX,
  MAINTENANCE_INSPECTION_REASON_MIN,
  MAINTENANCE_INSPECTION_RESULTS,
  MAINTENANCE_INSPECTOR_MAX,
  MAINTENANCE_INSPECTOR_MIN,
  MAINTENANCE_PLAN_LOCATION_MIN,
  MAINTENANCE_PLAN_NAME_MAX,
  MAINTENANCE_PLAN_NAME_MIN,
  MAINTENANCE_PLAN_PERIOD_MAX,
  MAINTENANCE_PLAN_PERIOD_MIN,
  MAINTENANCE_PLAN_RESPONSIBLE_TYPES,
  MAINTENANCE_PLAN_TYPES,
  type MaintenanceInspectionResult,
  type MaintenancePlanResponsibleType,
  type MaintenancePlanType,
} from '@kampus/school-core/lib/finance-maintenance-plans.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { fixedAssets } from './finance-fixed-assets.ts'
import { maintenanceRequests } from './finance-maintenance-requests.ts'
import { suppliers } from './finance-suppliers.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Periyodik bakım planı (DOM-FIN-092; ON-240). Düzenli denetlenmesi gereken donanım: tür, yer,
 * isteğe bağlı kampüs ve demirbaş, periyot (ay), sistemden önceki son denetim günü, sorumlu ve
 * yasal işaret (K-252). Sonraki denetim günü saklanmaz: son denetimden (bu gün ile iptal edilmemiş
 * denetimlerin en geç günü) periyotla hesaplanır (K-253). Plan silinmez, arşivlenir.
 */
export const maintenancePlans = pgTable(
  'maintenance_plans',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    type: text('type').$type<MaintenancePlanType>().notNull(),
    campusId: text('campus_id'),
    location: text('location').notNull(),
    assetId: uuid('asset_id'),
    periodMonths: integer('period_months').notNull(),
    isLegal: boolean('is_legal').notNull(),
    previousDoneDate: date('previous_done_date', { mode: 'string' }),
    responsibleType: text('responsible_type').$type<MaintenancePlanResponsibleType>(),
    // kvkk: K (personel üyeliği)
    responsibleMembershipId: text('responsible_membership_id'),
    responsibleSupplierId: uuid('responsible_supplier_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'maintenance_plans_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'maintenance_plans_asset_fkey',
      columns: [table.institutionId, table.assetId],
      foreignColumns: [fixedAssets.institutionId, fixedAssets.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'maintenance_plans_responsible_membership_fkey',
      columns: [table.institutionId, table.responsibleMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'maintenance_plans_responsible_supplier_fkey',
      columns: [table.institutionId, table.responsibleSupplierId],
      foreignColumns: [suppliers.institutionId, suppliers.id],
    }).onDelete('restrict'),
    check('maintenance_plans_type_check', oneOf(table.type, MAINTENANCE_PLAN_TYPES)),
    check(
      'maintenance_plans_period_check',
      sql`${table.periodMonths} between ${n(MAINTENANCE_PLAN_PERIOD_MIN)} and ${n(MAINTENANCE_PLAN_PERIOD_MAX)}`,
    ),
    check(
      'maintenance_plans_text_check',
      sql`char_length(${table.name}) between ${n(MAINTENANCE_PLAN_NAME_MIN)} and ${n(MAINTENANCE_PLAN_NAME_MAX)}
        and char_length(${table.location}) between ${n(MAINTENANCE_PLAN_LOCATION_MIN)} and ${n(FIXED_ASSET_LOCATION_MAX)}`,
    ),
    // Sorumlu türüne göre yalnız üyelik ya da yalnız tedarikçi; sorumlusuz planda ikisi de boş.
    check(
      'maintenance_plans_responsible_check',
      sql`(${table.responsibleType} is null and ${table.responsibleMembershipId} is null
          and ${table.responsibleSupplierId} is null)
        or (${oneOf(table.responsibleType, MAINTENANCE_PLAN_RESPONSIBLE_TYPES)}
          and (${table.responsibleType} = 'staff') = (${table.responsibleMembershipId} is not null)
          and (${table.responsibleType} = 'supplier') = (${table.responsibleSupplierId} is not null))`,
    ),
    index('maintenance_plans_name_idx').on(table.institutionId, table.name),
    index('maintenance_plans_asset_idx').on(table.institutionId, table.assetId),
    index('maintenance_plans_responsible_membership_idx').on(
      table.institutionId,
      table.responsibleMembershipId,
    ),
    index('maintenance_plans_responsible_supplier_idx').on(
      table.institutionId,
      table.responsibleSupplierId,
    ),
  ],
)

/**
 * Periyodik denetim kaydı (DOM-FIN-092, K-254): gün, yapan, sonuç, belge no ve not. Kayıt
 * değiştirilmez; yanlış giriş gerekçeyle iptal edilir ve takvime sayılmaz. Uygunsuz ya da kısmen
 * uygun denetimden açılan arıza talebi (`maintenance_requests`) burada bağlanır.
 */
export const maintenanceInspections = pgTable(
  'maintenance_inspections',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    planId: uuid('plan_id').notNull(),
    doneDate: date('done_date', { mode: 'string' }).notNull(),
    // kvkk: K (denetimi yapan kişi adı olabilir)
    performedBy: text('performed_by').notNull(),
    result: text('result').$type<MaintenanceInspectionResult>().notNull(),
    documentNumber: text('document_number'),
    note: text('note'),
    // kvkk: K
    recordedByUserId: text('recorded_by_user_id').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    maintenanceRequestId: uuid('maintenance_request_id'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'maintenance_inspections_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'maintenance_inspections_plan_fkey',
      columns: [table.institutionId, table.planId],
      foreignColumns: [maintenancePlans.institutionId, maintenancePlans.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'maintenance_inspections_request_fkey',
      columns: [table.institutionId, table.maintenanceRequestId],
      foreignColumns: [maintenanceRequests.institutionId, maintenanceRequests.id],
    }).onDelete('restrict'),
    check(
      'maintenance_inspections_result_check',
      oneOf(table.result, MAINTENANCE_INSPECTION_RESULTS),
    ),
    check(
      'maintenance_inspections_text_check',
      sql`char_length(${table.performedBy}) between ${n(MAINTENANCE_INSPECTOR_MIN)} and ${n(MAINTENANCE_INSPECTOR_MAX)}
        and (${table.documentNumber} is null
          or char_length(${table.documentNumber}) between 1 and ${n(MAINTENANCE_DOCUMENT_NUMBER_MAX)})
        and (${table.note} is null
          or char_length(${table.note}) between 1 and ${n(MAINTENANCE_INSPECTION_NOTE_MAX)})
        and (${table.result} = 'pass' or char_length(coalesce(${table.note}, '')) >= ${n(MAINTENANCE_INSPECTION_NOTE_MIN)})`,
    ),
    // Arıza talebi yalnız uygunsuz ya da kısmen uygun denetimden açılır.
    check(
      'maintenance_inspections_request_check',
      sql`${table.maintenanceRequestId} is null or ${table.result} <> 'pass'`,
    ),
    check(
      'maintenance_inspections_cancel_check',
      sql`((${table.cancelledAt} is null) = (${table.cancelReason} is null))
        and ((${table.cancelledAt} is null) = (${table.cancelledByUserId} is null))
        and (${table.cancelReason} is null
          or char_length(${table.cancelReason}) between ${n(MAINTENANCE_INSPECTION_REASON_MIN)} and ${n(MAINTENANCE_INSPECTION_REASON_MAX)})`,
    ),
    // Aynı planda aynı güne iptal edilmemiş tek denetim (mükerrer kayıt).
    uniqueIndex('maintenance_inspections_plan_day_key')
      .on(table.institutionId, table.planId, table.doneDate)
      .where(sql`${table.cancelledAt} is null`),
    index('maintenance_inspections_plan_idx').on(table.institutionId, table.planId, table.doneDate),
    // Bir arıza talebi tek denetime bağlanır; boş değerler birbirine eşit sayılmaz.
    uniqueIndex('maintenance_inspections_request_key').on(
      table.institutionId,
      table.maintenanceRequestId,
    ),
  ],
)
