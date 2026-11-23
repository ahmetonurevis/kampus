import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

import { institutions } from './auth.ts'

/** Anahtarın saklanma süresi (api-tasarimi.md §7, guvenlik-kvkk.md §10): 24 saat. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

/**
 * `Idempotency-Key` kayıtları (api-tasarimi.md §7). Yalnız eklenen teknik tablodur
 * (veritabani.md §2 istisnası: `archived_at`/`version` yok): satır, işlemle aynı transaction'da
 * ve yalnız başarılı yanıtla yazılır; 4xx/5xx'te işlem geri alındığı için anahtar saklanmaz ve
 * aynı anahtarla düzeltilmiş istek gönderilebilir. Süresi dolan satır kalıcı silinir.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    // kvkk: K
    userId: text('user_id').notNull(),
    key: text('key').notNull(),
    /** Metot + yol + kanonik gövdenin SHA-256 özeti (hex); gövdenin kendisi tutulmaz. */
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status').notNull(),
    // kvkk: K (yanıt zarfı; yalnız işlemin döndürdüğü kimlik ve değişiklik özeti)
    responseBody: jsonb('response_body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      name: 'idempotency_keys_pkey',
      columns: [table.institutionId, table.userId, table.key],
    }),
    // Temizlik işi kurumdan bağımsız, süreye göre tarar.
    index('idempotency_keys_expires_at_idx').on(table.expiresAt),
    check(
      'idempotency_keys_response_status_check',
      sql`${table.responseStatus} between 200 and 299`,
    ),
    check('idempotency_keys_key_check', sql`char_length(${table.key}) between 8 and 128`),
  ],
)
