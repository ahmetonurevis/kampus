import {
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  check,
} from 'drizzle-orm/pg-core'

import { MEAL_KINDS, type MealKind } from '@kampus/school-core/lib/finance-meal-menus.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { mealMenus } from './finance-meal-menus.ts'

/**
 * Yemekhane alerji uyarısının görevli onayı (DOM-FIN-162; ON-151; K-543): "uyarı görüldü,
 * alternatif verildi" işareti. Öğrenci × servis günü × öğün başına bir satır; kim (üyelik) ve ne
 * zaman (`created_at`) ile kontrol edilen yayımlanmış menü. Uyarının içeriği (alerjen, şiddet)
 * saklanmaz: her okumada sağlık profilinden ve menüden yeniden hesaplanır. Satır yalnız eklenir
 * (`kampus_reject_immutable_change`, migration'da).
 */
export const mealAllergyChecks = pgTable(
  'meal_allergy_checks',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K — öğrenci kaydı (records students; yabancı anahtar yok); satırın varlığı öğrencinin
    // o öğünde alerji uyarısı olduğunu gösterir, içerik tutulmaz.
    studentId: text('student_id').notNull(),
    serviceDate: date('service_date', { mode: 'string' }).notNull(),
    mealKind: text('meal_kind').$type<MealKind>().notNull(),
    menuId: uuid('menu_id').notNull(),
    // kvkk: K — işareti koyan görevlinin kurum üyeliği
    acknowledgedByMembershipId: text('acknowledged_by_membership_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'meal_allergy_checks_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'meal_allergy_checks_menu_fkey',
      columns: [table.institutionId, table.menuId],
      foreignColumns: [mealMenus.institutionId, mealMenus.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'meal_allergy_checks_acknowledged_by_fkey',
      columns: [table.institutionId, table.acknowledgedByMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('meal_allergy_checks_meal_kind_check', oneOf(table.mealKind, MEAL_KINDS)),
    uniqueIndex('meal_allergy_checks_student_meal_key').on(
      table.institutionId,
      table.studentId,
      table.serviceDate,
      table.mealKind,
    ),
    index('meal_allergy_checks_menu_idx').on(table.institutionId, table.menuId),
    index('meal_allergy_checks_acknowledged_by_idx').on(
      table.institutionId,
      table.acknowledgedByMembershipId,
    ),
  ],
)
