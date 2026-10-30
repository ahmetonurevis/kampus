import { sql } from 'drizzle-orm'
import { check, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

import type { RecordData } from '../collections.ts'
import { institutions } from './auth.ts'

/** Belge başına üst sınır (veritabani.md §3); uygulama da yazmadan önce denetler. */
export const RECORD_MAX_BYTES = 262_144

/**
 * school-core kayıtları (ADR 0001 karar 6). `collection` State anahtarı, `data` kaydın kendisi.
 * Kurum silinirse kayıtlar kendiliğinden silinmez (cascade yok): okul verisi yanlışlıkla
 * kurum silmeyle kaybolmasın; imha ayrı iştir.
 */
export const records = pgTable(
  'records',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    collection: text('collection').notNull(),
    id: text('id').notNull(),
    // kvkk: K|Ç (koleksiyona göre; Ö veri buraya yazılmaz)
    data: jsonb('data').$type<RecordData>().notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      name: 'records_pkey',
      columns: [table.institutionId, table.collection, table.id],
    }),
    // Sınır RECORD_MAX_BYTES ile aynıdır; kısıt ifadesi sabit metin olmalı.
    check('records_data_size_check', sql`pg_column_size(${table.data}) <= 262144`),
  ],
)
