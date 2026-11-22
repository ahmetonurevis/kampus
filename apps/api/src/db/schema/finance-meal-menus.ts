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
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  ALLERGENS,
  MEAL_CORRECTION_REASON_MAX,
  MEAL_CORRECTION_REASON_MIN,
  MEAL_ENERGY_MAX_KCAL,
  MEAL_GRAMS_MAX_DG,
  MEAL_ITEM_NAME_MAX,
  MEAL_ITEMS_PER_SLOT_MAX,
  MEAL_KINDS,
  MEAL_MENU_STATUSES,
  MEAL_SALT_MAX_DG,
  type Allergen,
  type MealKind,
  type MealMenuStatus,
} from '@kampus/school-core/lib/finance-meal-menus.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))
const list = (values: readonly string[]) =>
  sql.raw(`array[${values.map((value) => `'${value}'`).join(', ')}]::text[]`)
const ALLERGEN_LIST = list(ALLERGENS)
const MEAL_KIND_LIST = list(MEAL_KINDS)

/**
 * Haftalık yemek menüsü (DOM-FIN-157; ON-090, ON-149; K-526, K-527): kurumun (isteğe bağlı bir
 * kampüsün) pazartesiyle başlayan haftası. Aynı hafta ve kampüs için tek etkin menü (kampüssüz menü
 * bütün kampüslerindir). Taslak görünmez; yayımlanan menü veli ve öğrenciye görünür. Arşiv yalnız
 * taslakta.
 */
export const mealMenus = pgTable(
  'meal_menus',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    weekStart: date('week_start', { mode: 'string' }).notNull(),
    branchId: text('branch_id'),
    status: text('status').$type<MealMenuStatus>().notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    // kvkk: K
    publishedByUserId: text('published_by_user_id'),
    copiedFromMenuId: uuid('copied_from_menu_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'meal_menus_pkey', columns: [table.institutionId, table.id] }),
    check('meal_menus_status_check', oneOf(table.status, MEAL_MENU_STATUSES)),
    check('meal_menus_week_start_check', sql`extract(isodow from ${table.weekStart}) = 1`),
    check(
      'meal_menus_published_check',
      sql`(${table.status} = 'published') = (${table.publishedAt} is not null)
        and (${table.publishedAt} is null) = (${table.publishedByUserId} is null)`,
    ),
    check(
      'meal_menus_archive_check',
      sql`${table.archivedAt} is null or ${table.status} = 'draft'`,
    ),
    uniqueIndex('meal_menus_week_key')
      .on(table.institutionId, table.weekStart, sql`coalesce(${table.branchId}, '')`)
      .where(sql`${table.archivedAt} is null`),
  ],
)

/**
 * Menü kalemi (DOM-FIN-157; K-527, K-528): gün × öğün hücresinde sıralı yemek; 14 alerjen işareti
 * (TGK Ek-1) ve porsiyon besin değeri tamsayıdır (enerji kcal, gramlar gramın onda biri). Hücre
 * düzenlemesi eski kalemleri arşivler ve yenilerini ekler; arşivli kalem geçmiş menünün izidir.
 */
export const mealMenuItems = pgTable(
  'meal_menu_items',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    menuId: uuid('menu_id').notNull(),
    menuDate: date('menu_date', { mode: 'string' }).notNull(),
    mealKind: text('meal_kind').$type<MealKind>().notNull(),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    allergens: text('allergens')
      .array()
      .$type<Allergen[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    energyKcal: integer('energy_kcal'),
    proteinDg: integer('protein_dg'),
    fatDg: integer('fat_dg'),
    carbohydrateDg: integer('carbohydrate_dg'),
    fiberDg: integer('fiber_dg'),
    saltDg: integer('salt_dg'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'meal_menu_items_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'meal_menu_items_menu_fkey',
      columns: [table.institutionId, table.menuId],
      foreignColumns: [mealMenus.institutionId, mealMenus.id],
    }).onDelete('restrict'),
    check('meal_menu_items_meal_kind_check', oneOf(table.mealKind, MEAL_KINDS)),
    check(
      'meal_menu_items_position_check',
      sql`${table.position} between 0 and ${n(MEAL_ITEMS_PER_SLOT_MAX - 1)}`,
    ),
    check(
      'meal_menu_items_name_check',
      sql`char_length(${table.name}) between 2 and ${n(MEAL_ITEM_NAME_MAX)}`,
    ),
    check('meal_menu_items_allergens_check', sql`${table.allergens} <@ ${ALLERGEN_LIST}`),
    check(
      'meal_menu_items_nutrition_check',
      sql`((${table.energyKcal} is null) = (${table.proteinDg} is null)
        and (${table.energyKcal} is null) = (${table.fatDg} is null)
        and (${table.energyKcal} is null) = (${table.carbohydrateDg} is null)
        and (${table.energyKcal} is not null or (${table.fiberDg} is null and ${table.saltDg} is null)))
        and (${table.energyKcal} is null or ${table.energyKcal} between 0 and ${n(MEAL_ENERGY_MAX_KCAL)})
        and (${table.proteinDg} is null or ${table.proteinDg} between 0 and ${n(MEAL_GRAMS_MAX_DG)})
        and (${table.fatDg} is null or ${table.fatDg} between 0 and ${n(MEAL_GRAMS_MAX_DG)})
        and (${table.carbohydrateDg} is null or ${table.carbohydrateDg} between 0 and ${n(MEAL_GRAMS_MAX_DG)})
        and (${table.fiberDg} is null or ${table.fiberDg} between 0 and ${n(MEAL_GRAMS_MAX_DG)})
        and (${table.saltDg} is null or ${table.saltDg} between 0 and ${n(MEAL_SALT_MAX_DG)})`,
    ),
    uniqueIndex('meal_menu_items_slot_key')
      .on(table.institutionId, table.menuId, table.menuDate, table.mealKind, table.position)
      .where(sql`${table.archivedAt} is null`),
    index('meal_menu_items_menu_idx').on(table.institutionId, table.menuId, table.menuDate),
  ],
)

/**
 * Yayımlanmış menünün geçmiş gününün gerekçeli düzeltmesi (DOM-FIN-157; K-527): hangi gün × öğün,
 * kim, ne zaman ve neden. Önceki kalemler arşivli satırlarda kalır. Satır yalnız eklenir
 * (`kampus_reject_immutable_change` tetikleyicisi, migration'da).
 */
export const mealMenuCorrections = pgTable(
  'meal_menu_corrections',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    menuId: uuid('menu_id').notNull(),
    menuDate: date('menu_date', { mode: 'string' }).notNull(),
    mealKind: text('meal_kind').$type<MealKind>().notNull(),
    // kvkk: K — serbest metin; loglanmaz, denetime yazılmaz.
    reason: text('reason').notNull(),
    // kvkk: K
    correctedByUserId: text('corrected_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'meal_menu_corrections_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'meal_menu_corrections_menu_fkey',
      columns: [table.institutionId, table.menuId],
      foreignColumns: [mealMenus.institutionId, mealMenus.id],
    }).onDelete('restrict'),
    check('meal_menu_corrections_meal_kind_check', oneOf(table.mealKind, MEAL_KINDS)),
    check(
      'meal_menu_corrections_reason_check',
      sql`char_length(${table.reason}) between ${n(MEAL_CORRECTION_REASON_MIN)} and ${n(MEAL_CORRECTION_REASON_MAX)}`,
    ),
    index('meal_menu_corrections_menu_idx').on(table.institutionId, table.menuId),
  ],
)

/** Kurumun kullandığı öğünler (DOM-FIN-157; K-526); satır yoksa yalnız öğle yemeği. */
export const mealMenuSettings = pgTable(
  'meal_menu_settings',
  {
    institutionId: text('institution_id')
      .primaryKey()
      .references(() => institutions.id),
    mealKinds: text('meal_kinds').array().$type<MealKind[]>().notNull(),
    ...requiredColumns(),
  },
  (table) => [
    check(
      'meal_menu_settings_meal_kinds_check',
      sql`cardinality(${table.mealKinds}) >= 1 and ${table.mealKinds} <@ ${MEAL_KIND_LIST}`,
    ),
  ],
)
