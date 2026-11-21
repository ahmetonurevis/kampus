import { sql } from 'drizzle-orm'
import {
  bigint,
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

import { CEFR_LEVELS, type CefrLevel } from '@kampus/school-core/content/taxonomy.ts'
import {
  PACKAGE_HOUR_KINDS,
  PACKAGE_HOUR_SOURCES,
  PACKAGE_HOURS_MAX,
  PACKAGE_KINDS,
  PACKAGE_VALIDITY_DAYS_MAX,
  type PackageHourKind,
  type PackageHourSource,
  type PackageKind,
} from '@kampus/school-core/lib/finance-packages.ts'

import { institutions } from './auth.ts'
import { keys, oneOf, requiredColumns } from './columns.ts'
import { contracts } from './contracts.ts'
import { courses } from './courses.ts'
import { feeTariffs } from './fee-tariffs.ts'

const max = (value: number) => sql.raw(String(value))

/**
 * Dil okulu paket tanımı ve satışı (IST-078; docs/domain/dil-okulu.md DOM-DIL-006, -050, -051; kural
 * core `lib/finance-packages.ts`). Paket tutar taşımaz; satış anında yayımlı tarifeden fiyatlanır.
 * Kur ücretinde saat ve seviye kurdan gelir, satış satırına kopyalanır. Taksit ve sözleşme ADR 0010
 * tablolarındadır; satış sözleşmeye bileşik yabancı anahtarla bağlanır.
 */
export const lessonPackages = pgTable(
  'lesson_packages',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    kind: text('kind').$type<PackageKind>().notNull(),
    name: text('name').notNull(),
    /** Ad tekilliği anahtarı: core `packageNameKey(name)`. */
    nameKey: text('name_key').notNull(),
    courseId: uuid('course_id'),
    level: text('level').$type<CefrLevel>(),
    lessonHours: integer('lesson_hours'),
    hourlyCents: bigint('hourly_cents', { mode: 'number' }),
    validityDays: integer('validity_days'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'lesson_packages_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'lesson_packages_course_fkey',
      columns: [table.institutionId, table.courseId],
      foreignColumns: [courses.institutionId, courses.id],
    }).onDelete('restrict'),
    check('lesson_packages_kind_check', oneOf(table.kind, PACKAGE_KINDS)),
    check(
      'lesson_packages_level_check',
      sql`${table.level} is null or ${oneOf(table.level, keys(CEFR_LEVELS))}`,
    ),
    check(
      'lesson_packages_hours_check',
      sql`${table.lessonHours} is null or ${table.lessonHours} between 1 and ${max(PACKAGE_HOURS_MAX)}`,
    ),
    check(
      'lesson_packages_course_kind_check',
      sql`${table.kind} <> 'course' or (${table.courseId} is not null and ${table.lessonHours} is null)`,
    ),
    check(
      'lesson_packages_hours_kind_check',
      sql`${table.kind} = 'course' or ${table.lessonHours} is not null`,
    ),
    check(
      'lesson_packages_hourly_check',
      sql`${table.hourlyCents} is null or ${table.hourlyCents} > 0`,
    ),
    check(
      'lesson_packages_validity_check',
      sql`${table.validityDays} is null or ${table.validityDays} between 1 and ${max(PACKAGE_VALIDITY_DAYS_MAX)}`,
    ),
    uniqueIndex('lesson_packages_name_key')
      .on(table.institutionId, table.nameKey)
      .where(sql`${table.archivedAt} is null`),
    index('lesson_packages_course_idx')
      .on(table.institutionId, table.courseId)
      .where(sql`${table.courseId} is not null`),
  ],
)

/**
 * Satış: paketin ve fiyatın karar anı kopyası (DOM-FIN-010). İndirim ve ek kalem dökümü sözleşmede,
 * taksitler ADR 0010 tablolarındadır. Bakiye saklanmaz (DOM-DIL-051); yalnız `expires_date`, `version`
 * ve `updated_at` süre uzatmayla, `version` ve `updated_at` kullanılan saat girişiyle değişir. Öğrenci `records`'tadır, yabancı anahtar değildir (ADR 0010
 * karar 6).
 */
export const lessonPackageSales = pgTable(
  'lesson_package_sales',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    packageId: uuid('package_id').notNull(),
    packageName: text('package_name').notNull(),
    kind: text('kind').$type<PackageKind>().notNull(),
    courseId: uuid('course_id'),
    level: text('level').$type<CefrLevel>(),
    // kvkk: Ç
    studentId: text('student_id').notNull(),
    contractId: text('contract_id').notNull(),
    tariffId: uuid('tariff_id').notNull(),
    tariffVersion: integer('tariff_version').notNull(),
    purchasedHours: integer('purchased_hours').notNull(),
    // kvkk: Ç
    hourlyCents: bigint('hourly_cents', { mode: 'number' }).notNull(),
    // kvkk: Ç
    grossCents: bigint('gross_cents', { mode: 'number' }).notNull(),
    // kvkk: Ç
    netCents: bigint('net_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    expiresDate: date('expires_date', { mode: 'string' }),
    soldAt: timestamp('sold_at', { withTimezone: true }).notNull(),
    // kvkk: K
    soldByUserId: text('sold_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'lesson_package_sales_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'lesson_package_sales_package_fkey',
      columns: [table.institutionId, table.packageId],
      foreignColumns: [lessonPackages.institutionId, lessonPackages.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lesson_package_sales_course_fkey',
      columns: [table.institutionId, table.courseId],
      foreignColumns: [courses.institutionId, courses.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lesson_package_sales_contract_fkey',
      columns: [table.institutionId, table.contractId],
      foreignColumns: [contracts.institutionId, contracts.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lesson_package_sales_tariff_fkey',
      columns: [table.institutionId, table.tariffId],
      foreignColumns: [feeTariffs.institutionId, feeTariffs.id],
    }).onDelete('restrict'),
    check('lesson_package_sales_kind_check', oneOf(table.kind, PACKAGE_KINDS)),
    check(
      'lesson_package_sales_level_check',
      sql`${table.level} is null or ${oneOf(table.level, keys(CEFR_LEVELS))}`,
    ),
    check(
      'lesson_package_sales_hours_check',
      sql`${table.purchasedHours} between 1 and ${max(PACKAGE_HOURS_MAX)}`,
    ),
    check(
      'lesson_package_sales_amounts_check',
      sql`${table.hourlyCents} > 0 and ${table.grossCents} > 0 and ${table.netCents} > 0 and ${table.netCents} <= ${table.grossCents}`,
    ),
    check('lesson_package_sales_currency_check', sql`${table.currency} = 'TRY'`),
    uniqueIndex('lesson_package_sales_contract_key').on(table.institutionId, table.contractId),
    index('lesson_package_sales_student_idx').on(table.institutionId, table.studentId),
    index('lesson_package_sales_package_idx').on(table.institutionId, table.packageId),
    index('lesson_package_sales_tariff_idx').on(table.institutionId, table.tariffId),
    index('lesson_package_sales_course_idx')
      .on(table.institutionId, table.courseId)
      .where(sql`${table.courseId} is not null`),
  ],
)

/**
 * Saat hareketi: bakiyenin kaynağı (DOM-DIL-051). Bakiye bu satırlardan hesaplanır. Kaynak başına
 * tek satır: yoklama ya da ayrılış yeniden işlenince saat iki kez düşmez. Yanlış hareket arşivlenir.
 * `manual` satış başına tek etkin satırdır (K-21); sıfır saat yalnız onda geçerlidir: "kullanılmadı"
 * bilgisi "girilmedi"den ayrılsın.
 */
export const lessonPackageHourEntries = pgTable(
  'lesson_package_hour_entries',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    saleId: uuid('sale_id').notNull(),
    kind: text('kind').$type<PackageHourKind>().notNull(),
    hours: integer('hours').notNull(),
    occurredDate: date('occurred_date', { mode: 'string' }).notNull(),
    sourceType: text('source_type').$type<PackageHourSource>().notNull(),
    sourceId: text('source_id').notNull(),
    // kvkk: K
    recordedByUserId: text('recorded_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'lesson_package_hour_entries_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'lesson_package_hour_entries_sale_fkey',
      columns: [table.institutionId, table.saleId],
      foreignColumns: [lessonPackageSales.institutionId, lessonPackageSales.id],
    }).onDelete('restrict'),
    check('lesson_package_hour_entries_kind_check', oneOf(table.kind, PACKAGE_HOUR_KINDS)),
    check(
      'lesson_package_hour_entries_source_check',
      oneOf(table.sourceType, PACKAGE_HOUR_SOURCES),
    ),
    check(
      'lesson_package_hour_entries_hours_check',
      sql`(${table.hours} between 1 and ${max(PACKAGE_HOURS_MAX)}) or (${table.sourceType} = 'manual' and ${table.hours} = 0)`,
    ),
    uniqueIndex('lesson_package_hour_entries_source_key')
      .on(table.institutionId, table.saleId, table.sourceType, table.sourceId)
      .where(sql`${table.archivedAt} is null`),
    index('lesson_package_hour_entries_sale_idx').on(table.institutionId, table.saleId),
  ],
)
