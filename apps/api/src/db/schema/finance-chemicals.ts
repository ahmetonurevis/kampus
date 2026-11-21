import { sql } from 'drizzle-orm'
import { check, date, foreignKey, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core'

import {
  CHEMICAL_NOTE_MAX,
  CHEMICAL_SDS_NUMBER_MAX,
  CHEMICAL_SDS_URL_MAX,
  CHEMICAL_SIGNAL_WORDS,
  CHEMICAL_STORAGE_CLASS_MAX,
  GHS_PICTOGRAMS,
  type ChemicalSignalWord,
  type GhsPictogram,
} from '@kampus/school-core/lib/finance-chemicals.ts'
import { STOCK_LOT_NUMBER_MAX } from '@kampus/school-core/lib/finance-inventory.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { stockItems, stockMovements } from './finance-inventory.ts'

const n = (value: number) => sql.raw(String(value))
const PICTOGRAM_LIST = sql.raw(
  `array[${GHS_PICTOGRAMS.map((value) => `'${value}'`).join(', ')}]::text[]`,
)

/**
 * Stok kartının kimyasal bilgisi (DOM-FIN-090, K-240; ON-234): kart başına en çok bir satır. GHS
 * piktogramları, sinyal kelimesi, CAS numarası (sağlama basamağı core'da), depolama sınıfı,
 * uyumsuzluk notu ve güvenlik bilgi formu (GBF) bağlantısı, belge numarası ve revizyon günü. Satırın
 * varlığı kartı kimyasal yapar; kaldırılmaz, düzeltilir.
 */
export const stockChemicalProfiles = pgTable(
  'stock_chemical_profiles',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    itemId: uuid('item_id').notNull(),
    hazardPictograms: text('hazard_pictograms')
      .array()
      .$type<GhsPictogram[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    signalWord: text('signal_word').$type<ChemicalSignalWord>(),
    casNumber: text('cas_number'),
    storageClass: text('storage_class'),
    incompatibilityNote: text('incompatibility_note'),
    sdsUrl: text('sds_url'),
    sdsDocumentNumber: text('sds_document_number'),
    sdsRevisionDate: date('sds_revision_date', { mode: 'string' }),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'stock_chemical_profiles_pkey',
      columns: [table.institutionId, table.itemId],
    }),
    foreignKey({
      name: 'stock_chemical_profiles_item_fkey',
      columns: [table.institutionId, table.itemId],
      foreignColumns: [stockItems.institutionId, stockItems.id],
    }).onDelete('restrict'),
    check(
      'stock_chemical_profiles_pictograms_check',
      sql`${table.hazardPictograms} <@ ${PICTOGRAM_LIST}`,
    ),
    check(
      'stock_chemical_profiles_signal_word_check',
      sql`${table.signalWord} is null or ${oneOf(table.signalWord, CHEMICAL_SIGNAL_WORDS)}`,
    ),
    check(
      'stock_chemical_profiles_cas_check',
      sql`${table.casNumber} is null or ${table.casNumber} ~ '^[0-9]{2,7}-[0-9]{2}-[0-9]$'`,
    ),
    check(
      'stock_chemical_profiles_text_check',
      sql`(${table.storageClass} is null or char_length(${table.storageClass}) between 1 and ${n(CHEMICAL_STORAGE_CLASS_MAX)})
        and (${table.incompatibilityNote} is null or char_length(${table.incompatibilityNote}) between 1 and ${n(CHEMICAL_NOTE_MAX)})
        and (${table.sdsDocumentNumber} is null or char_length(${table.sdsDocumentNumber}) between 1 and ${n(CHEMICAL_SDS_NUMBER_MAX)})`,
    ),
    check(
      'stock_chemical_profiles_sds_url_check',
      sql`${table.sdsUrl} is null or (${table.sdsUrl} ~ '^https://' and char_length(${table.sdsUrl}) <= ${n(CHEMICAL_SDS_URL_MAX)})`,
    ),
  ],
)

/**
 * Kimyasal girişinin partisi (DOM-FIN-090, K-241): elle giriş hareketi başına en çok bir satır.
 * Parti miktarı saklanmaz; çıkışlar FEFO ile hareketlerden düşülür (K-242). Hareket iptal edilince
 * parti miktara girmez; satır değişmez. Partiler kartın hareketleriyle birlikte birincil anahtardan
 * okunur; son kullanma gününe ayrı indeks gerekmez.
 */
export const stockMovementLots = pgTable(
  'stock_movement_lots',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    movementId: uuid('movement_id').notNull(),
    lotNumber: text('lot_number').notNull(),
    expiryDate: date('expiry_date', { mode: 'string' }).notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'stock_movement_lots_pkey',
      columns: [table.institutionId, table.movementId],
    }),
    foreignKey({
      name: 'stock_movement_lots_movement_fkey',
      columns: [table.institutionId, table.movementId],
      foreignColumns: [stockMovements.institutionId, stockMovements.id],
    }).onDelete('restrict'),
    check(
      'stock_movement_lots_lot_number_check',
      sql`char_length(${table.lotNumber}) between 1 and ${n(STOCK_LOT_NUMBER_MAX)}`,
    ),
  ],
)
