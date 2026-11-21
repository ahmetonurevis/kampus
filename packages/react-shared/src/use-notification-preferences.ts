import type { KampusClient } from '@kampus/api-client/client.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import {
  NOTIFICATION_PREFERENCES_MESSAGES,
  type NotificationPreferencesRecord,
} from './notification-preferences-model.ts'
import { notificationPreferencesKey } from './query-keys.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

/**
 * Bildirim tercihi kancaları (OG-107; DOM-ILT-020, -021): oturum sahibinin konu × kanal tercihi ve
 * sessiz saati. Kayıt yoksa sunucu varsayılanı ve `version: 1` döner. Güncelleme `version` ile
 * iyimser kilitlidir: tutmazsa 409 `version_conflict` olur, kanca güncel tercihi yeniden yükler ve
 * kullanıcıya "Tercihleriniz başka bir yerde değişti, güncel hâli yüklendi." der.
 */

type PatchBody =
  operations['patchNotificationPreferences']['requestBody']['content']['application/json']

export type NotificationPreferencesPatchBody = PatchBody

export function notificationPreferencesRequest(client: KampusClient, signal?: AbortSignal) {
  return client.GET('/api/v1/notification-preferences', signal ? { signal } : {})
}

/** PATCH gövdesinde `version` vardır; `If-Match` ve `Idempotency-Key` kullanılmaz. */
export function patchNotificationPreferencesRequest(client: KampusClient, body: PatchBody) {
  return client.PATCH('/api/v1/notification-preferences', { body })
}

export function useNotificationPreferences(options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: notificationPreferencesKey(),
    request: (client, signal) => notificationPreferencesRequest(client, signal),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  })
}

export function usePatchNotificationPreferences(
  options: { onSuccess?: (record: NotificationPreferencesRecord) => void } = {},
) {
  return useApiCommand({
    request: patchNotificationPreferencesRequest,
    invalidates: [notificationPreferencesKey()],
    messages: NOTIFICATION_PREFERENCES_MESSAGES,
    onSuccess: (data) => options.onSuccess?.(data.data),
  })
}
