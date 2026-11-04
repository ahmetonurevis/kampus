import {
  applyNotificationPreferencesPatch,
  defaultNotificationPreferences,
  type InstitutionQuietLimit,
  type NotificationPreferences,
  type NotificationPreferencesPatch,
} from '@kampus/school-core/lib/notification-preferences.ts'

import {
  loadNotificationPreferences,
  saveNotificationPreferences,
} from '../db/notification-preferences.ts'
import { lockInstitution } from '../db/records.ts'
import { ConflictError, RuleViolationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { mapOperationError } from './operation-runner.ts'

/**
 * Oturum sahibinin bildirim tercihi (DOM-ILT-020, -021). Kimlik yalnız oturumdan gelir; başka
 * kullanıcının tercihi okunmaz ya da yazılmaz. Tercih içeriği (çocuk kimlikleri dahil) loglanmaz.
 */

export type NotificationPreferencesView = {
  preferences: NotificationPreferences
  version: number
}

// TODO(bildirim-tercihleri-kurum-siniri): kurumun en geniş sessiz saat aralığı ayarı henüz yok;
// kurum ayarı gelince buradan okunur (core `InstitutionQuietLimit`).
const institutionLimit: InstitutionQuietLimit = null

export async function notificationPreferencesFor(
  ctx: ServiceContext,
): Promise<NotificationPreferencesView> {
  const stored = await loadNotificationPreferences(ctx.db, ctx.institutionId, ctx.actor.userId)
  return {
    preferences: stored.preferences ?? defaultNotificationPreferences(),
    version: stored.version,
  }
}

/** Kısmi güncelleme; kural ihlali 422, sürüm tutmazsa 409, hiçbir durumda kayıt yarım yazılmaz. */
export async function patchNotificationPreferences(
  ctx: ServiceContext,
  input: NotificationPreferencesPatch & { version: number },
): Promise<NotificationPreferencesView> {
  const { version, ...patch } = input
  if (patch.children && Object.keys(patch.children).length > 0 && ctx.actor.role !== 'veli')
    throw new RuleViolationError(
      'notification_children_parent_only',
      'Çocuğa göre bildirim tercihi yalnız veliler için tanımlanır.',
    )
  try {
    return await ctx.db.transaction(async (tx) => {
      await lockInstitution(tx, ctx.institutionId)
      const stored = await loadNotificationPreferences(tx, ctx.institutionId, ctx.actor.userId)
      if (stored.version !== version) throw new ConflictError()
      const next = applyNotificationPreferencesPatch(
        stored.preferences ?? defaultNotificationPreferences(),
        patch,
        institutionLimit,
      )
      const saved = await saveNotificationPreferences(tx, ctx.institutionId, ctx.actor.userId, {
        preferences: next,
        expectedVersion: version,
        now: ctx.now,
      })
      if (saved === null) throw new ConflictError()
      return { preferences: next, version: saved.version }
    })
  } catch (error) {
    throw mapOperationError(error)
  }
}
