import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

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
    /** Core dizisindeki sıra; seyrek tamsayı, yalnız aynı koleksiyonda karşılaştırılır (`positions.ts`). */
    position: bigint('position', { mode: 'number' }).notNull(),
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
    // Koleksiyonun son sırası (`appendPositions`, arşivliler dahil) ve sıralı yükleme: en büyük
    // sıra geriye tek adımla bulunur, her eklemede koleksiyon taranmaz.
    index('records_institution_collection_position_idx').on(
      table.institutionId,
      table.collection,
      table.position,
    ),
    // Yazışmanın mesajları (ADR 0005): sayfa, özet ve okundu işareti yalnız bir yazışmanın
    // mesajlarını sırasıyla gezer. Sorgular aynı ifadeyi ve koşulu kullanmalı
    // (`db/conversation-messages.ts`, `services/communication.ts`).
    index('records_conversation_messages_idx')
      .on(table.institutionId, sql`(${table.data} ->> 'conversationId')`, table.position, table.id)
      .where(sql`${table.collection} = 'conversationMessages' and ${table.archivedAt} is null`),
    // Uygulama içi bildirimler (`db/notifications.ts`): görünürlük süzgeci öğrenci kimliğine
    // eşitlik, sıra `position desc, id desc`. Sorgu aynı ifadeyi (sabit anahtar adıyla) ve
    // koşulu kullanmalı.
    index('records_notifications_idx')
      .on(table.institutionId, sql`(${table.data} ->> 'studentId')`, table.position, table.id)
      .where(sql`${table.collection} = 'notifications' and ${table.archivedAt} is null`),
  ],
)
