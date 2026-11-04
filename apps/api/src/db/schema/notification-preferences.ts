import { index, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'

import type { NotificationPreferences } from '@kampus/school-core/lib/notification-preferences.ts'

import { institutions, users } from './auth.ts'
import { requiredColumns } from './columns.ts'

/**
 * Kullanıcının kurum başına bildirim tercihi ve sessiz saati (DOM-ILT-020, -021). Satır yoksa
 * core varsayılanı geçerlidir. Tercih yazmadan önce core `validateNotificationPreferences` ile
 * doğrulanır; `version` iyimser kilittir. Çocuk kimliği kişiye bağlı bir tercihtir, kişisel veri
 * (K) sayılır.
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    // kvkk: K
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    preferences: jsonb('preferences').$type<NotificationPreferences>().notNull(),
    ...requiredColumns(),
  },
  (table) => [
    // Kullanıcı silinince cascade için yabancı anahtar indeksi.
    index('notification_preferences_user_idx').on(table.userId),
    primaryKey({
      name: 'notification_preferences_pkey',
      columns: [table.institutionId, table.userId],
    }),
  ],
)
