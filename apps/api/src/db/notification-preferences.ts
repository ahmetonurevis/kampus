import { and, eq, sql } from 'drizzle-orm'

import type { NotificationPreferences } from '@kampus/school-core/lib/notification-preferences.ts'

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

/** Kullanıcının kurumdaki tercihi; satır yoksa `null` ve sürüm 1. */
export async function loadNotificationPreferences(
  db: Database,
  institutionId: string,
  userId: string,
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
  return row ?? { preferences: null, version: 1 }
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
