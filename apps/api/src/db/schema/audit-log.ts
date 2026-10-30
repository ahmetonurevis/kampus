import { desc } from 'drizzle-orm'
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { institutions } from './auth.ts'

/**
 * Yalnız eklenen denetim kaydı (docs/muhendislik/veritabani.md §8). Parola, belirteç, çerez ve
 * ham IP tutulmaz; `changes` yalnız alan adlarını taşır.
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
    changes: jsonb('changes').$type<{ fields?: string[]; reason?: string }>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_entity_idx').on(
      table.institutionId,
      table.entityType,
      table.entityId,
      desc(table.createdAt),
    ),
    index('audit_log_actor_idx').on(table.institutionId, table.actorUserId, desc(table.createdAt)),
  ],
)
