import { desc, sql } from 'drizzle-orm'
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { institutions } from './auth.ts'

/**
 * Yalnız eklenen denetim kaydı (docs/muhendislik/veritabani.md §8). Parola, belirteç, çerez ve
 * ham IP tutulmaz; `changes` yalnız alan adlarını taşır. `reason` yalnız gerekçeli hassas okumada
 * (yöneticinin yazışma erişimi, DOM-YTK-052) dolar; DOM-YTK-053 maskesine tabidir.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Yalnız etkin kurumsuz kimlik olayında (ör. başarısız giriş) boş.
    institutionId: text('institution_id').references(() => institutions.id, {
      onDelete: 'set null',
    }),
    // kvkk: K
    actorUserId: text('actor_user_id'),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    requestId: text('request_id'),
    // kvkk: K (tuzlanmış SHA-256)
    ipHash: text('ip_hash'),
    // `reason` burada yalnız teknik hata kodudur (ör. giriş hatası); serbest metin gerekçe `reason` kolonundadır.
    // `studentId` yalnız veli iletişimi açılışında (DOM-YTK-055): hangi öğrencinin velisi açıldı.
    // `counts` yalnız toplu sistem eyleminde (yetim nesne temizliği, OG-093): adsız sayaçlar.
    changes: jsonb('changes').$type<{
      fields?: string[]
      reason?: string
      studentId?: string
      counts?: Record<string, number>
    }>(),
    // kvkk: K — serbest metin gerekçe; `changes`'e yazılmaz, görünürlüğü yalnız yöneticidir.
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'audit_log_reason_check',
      sql`${table.reason} is null or char_length(${table.reason}) <= 500`,
    ),
    index('audit_log_entity_idx').on(
      table.institutionId,
      table.entityType,
      table.entityId,
      desc(table.createdAt),
    ),
    index('audit_log_actor_idx').on(table.institutionId, table.actorUserId, desc(table.createdAt)),
  ],
)
