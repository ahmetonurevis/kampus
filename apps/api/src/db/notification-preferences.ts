import { and, eq, sql } from 'drizzle-orm'

import {
  defaultNotificationPreferences,
  defaultTopicChannels,
  notificationPreferencesSchema,
  type NotificationPreferences,
} from '@kampus/school-core/lib/notification-preferences.ts'
import { NOTIFICATION_TOPICS } from '@kampus/school-core/lib/notifications.ts'

import type { Database } from './client.ts'
import { notificationPreferences } from './schema/notification-preferences.ts'

export type StoredNotificationPreferences = {
  /** `null`: kayıt yok, varsayılan geçerli. */
  preferences: NotificationPreferences | null
  version: number
}

const columns = {
  preferences: notificationPreferences.preferences,
  version: notificationPreferences.version,
}

/** Geçersiz satır uyarısı için en az günlükçü arayüzü; içerik ve kimlik loga yazılmaz. */
export type PreferenceLog = { warn(object: object, message: string): void }

/**
 * jsonb'yi core şemasıyla okur: eksik konular varsayılanla tamamlanır (yeni konu eklenince eski
 * satır bozulmaz), bilinmeyen konular atılır, geçersiz satır varsayılana düşer ve uyarı loglanır.
 */
export function parseStoredPreferences(raw: unknown, log: PreferenceLog): NotificationPreferences {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>
    const stored =
      typeof record.topics === 'object' && record.topics !== null
        ? (record.topics as Record<string, unknown>)
        : {}
    const defaults = defaultTopicChannels()
    const topics = Object.fromEntries(
      NOTIFICATION_TOPICS.map((topic) => [topic, stored[topic] ?? defaults[topic]]),
    )
    const parsed = notificationPreferencesSchema.safeParse({ ...record, topics })
    if (parsed.success) return parsed.data
  }
  log.warn({ event: 'notification_preferences.invalid_row' }, 'Bildirim tercihi satırı geçersiz')
  return defaultNotificationPreferences()
}

/** Kullanıcının kurumdaki tercihi; satır yoksa `null` ve sürüm 1. */
export async function loadNotificationPreferences(
  db: Database,
  institutionId: string,
  userId: string,
  log: PreferenceLog,
): Promise<StoredNotificationPreferences> {
  const [row] = await db
    .select(columns)
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.institutionId, institutionId),
        eq(notificationPreferences.userId, userId),
      ),
    )
    .limit(1)
  if (!row) return { preferences: null, version: 1 }
  return { preferences: parseStoredPreferences(row.preferences, log), version: row.version }
}

/**
 * Sürüm koşuluyla yazar; ilk yazımda satır açılır (beklenen sürüm 1). Sürüm tutmazsa `null` (409).
 */
export async function saveNotificationPreferences(
  tx: Database,
  institutionId: string,
  userId: string,
  input: { preferences: NotificationPreferences; expectedVersion: number; now: Date },
): Promise<StoredNotificationPreferences | null> {
  const [updated] = await tx
    .update(notificationPreferences)
    .set({
      preferences: input.preferences,
      version: sql`${notificationPreferences.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(notificationPreferences.institutionId, institutionId),
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.version, input.expectedVersion),
      ),
    )
    .returning(columns)
  if (updated) return updated
  if (input.expectedVersion !== 1) return null
  const [created] = await tx
    .insert(notificationPreferences)
    .values({
      institutionId,
      userId,
      preferences: input.preferences,
      version: 2,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing()
    .returning(columns)
  return created ?? null
}
