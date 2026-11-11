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

import {
  DEPRECIATION_METHODS,
  FIXED_ASSET_CATEGORIES,
  FIXED_ASSET_LOCATION_MAX,
  FIXED_ASSET_NAME_MAX,
  FIXED_ASSET_SCRAP_REASON_MAX,
  FIXED_ASSET_STATUSES,
  FIXED_ASSET_VALUE_MAX_CENTS,
  USEFUL_LIFE_MAX,
  USEFUL_LIFE_MIN,
  type DepreciationMethod,
  type FixedAssetCategory,
  type FixedAssetStatus,
} from '@kampus/school-core/lib/finance-fixed-assets.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { purchaseReceiptItems } from './finance-purchase-receipts.ts'
import { suppliers } from './finance-suppliers.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Demirbaş (DOM-FIN-085; ON-235). Kurumda tekil etiketli tek varlık: kategori, kampüs (branches
 * kaydı) ve konum, KDV hariç alım değeri (kuruş), alım günü, isteğe bağlı tedarikçi ve mal kabul
 * kalemi. Silinmez; hurdaya ayırma gerekçe, gün ve kişi taşır, geri alınmaz (K-188). Amortisman
 * ön hesabının girdileri faydalı ömür ve yöntemdir (DOM-FIN-088); hesap saklanmaz.
 */
export const fixedAssets = pgTable(
  'fixed_assets',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    tagNumber: text('tag_number').notNull(),
    name: text('name').notNull(),
    category: text('category').$type<FixedAssetCategory>().notNull(),
    campusId: text('campus_id'),
    location: text('location').notNull(),
    acquisitionValueCents: bigint('acquisition_value_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    acquisitionDate: date('acquisition_date', { mode: 'string' }).notNull(),
    supplierId: uuid('supplier_id'),
    receiptItemId: uuid('receipt_item_id'),
    status: text('status').$type<FixedAssetStatus>().notNull().default('in_use'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    scrappedAt: timestamp('scrapped_at', { withTimezone: true }),
    scrapDate: date('scrap_date', { mode: 'string' }),
    // kvkk: K
    scrappedByUserId: text('scrapped_by_user_id'),
    scrapReason: text('scrap_reason'),
    usefulLifeYears: integer('useful_life_years').notNull(),
    depreciationMethod: text('depreciation_method')
      .$type<DepreciationMethod>()
      .notNull()
      .default('normal'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'fixed_assets_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'fixed_assets_supplier_fkey',
      columns: [table.institutionId, table.supplierId],
      foreignColumns: [suppliers.institutionId, suppliers.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fixed_assets_receipt_item_fkey',
      columns: [table.institutionId, table.receiptItemId],
      foreignColumns: [purchaseReceiptItems.institutionId, purchaseReceiptItems.id],
    }).onDelete('restrict'),
    check('fixed_assets_tag_number_check', sql`${table.tagNumber} ~ '^[A-Z0-9][A-Z0-9./-]{1,39}$'`),
    check(
      'fixed_assets_text_check',
      sql`char_length(${table.name}) between 2 and ${n(FIXED_ASSET_NAME_MAX)}
        and char_length(${table.location}) between 2 and ${n(FIXED_ASSET_LOCATION_MAX)}
        and (${table.scrapReason} is null or char_length(${table.scrapReason}) <= ${n(FIXED_ASSET_SCRAP_REASON_MAX)})`,
    ),
    check('fixed_assets_category_check', oneOf(table.category, FIXED_ASSET_CATEGORIES)),
    check('fixed_assets_status_check', oneOf(table.status, FIXED_ASSET_STATUSES)),
    check(
      'fixed_assets_value_check',
      sql`${table.acquisitionValueCents} between 1 and ${n(FIXED_ASSET_VALUE_MAX_CENTS)}`,
    ),
    check(
      'fixed_assets_useful_life_check',
      sql`${table.usefulLifeYears} between ${n(USEFUL_LIFE_MIN)} and ${n(USEFUL_LIFE_MAX)}`,
    ),
    check(
      'fixed_assets_depreciation_method_check',
      oneOf(table.depreciationMethod, DEPRECIATION_METHODS),
    ),
    check('fixed_assets_currency_check', sql`${table.currency} = 'TRY'`),
    // Hurdaya ayrılan kayıt zamanı, günü, kişiyi ve gerekçeyi birlikte taşır; öteki durumlar hiçbirini.
    check(
      'fixed_assets_scrap_check',
      sql`((${table.status} = 'scrapped') = (${table.scrappedAt} is not null))
        and ((${table.scrappedAt} is null) = (${table.scrapDate} is null))
        and ((${table.scrappedAt} is null) = (${table.scrappedByUserId} is null))
        and ((${table.scrappedAt} is null) = (${table.scrapReason} is null))
        and (${table.scrapDate} is null or ${table.scrapDate} >= ${table.acquisitionDate})`,
    ),
    uniqueIndex('fixed_assets_tag_number_key')
      .on(table.institutionId, table.tagNumber)
      .where(sql`${table.archivedAt} is null`),
    index('fixed_assets_status_idx').on(table.institutionId, table.status),
    index('fixed_assets_campus_idx').on(table.institutionId, table.campusId),
    index('fixed_assets_supplier_idx').on(table.institutionId, table.supplierId),
    index('fixed_assets_receipt_item_idx').on(table.institutionId, table.receiptItemId),
  ],
)
