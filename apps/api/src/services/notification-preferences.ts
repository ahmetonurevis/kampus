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
import { ConflictError, NotFoundError, RuleViolationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { listMembershipLinks } from './memberships.ts'
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

/** Velinin etkin (velayetli, kısıtsız) bağlı çocukları; veli dışı rolde boş. */
async function linkedChildIds(db: ServiceContext['db'], ctx: ServiceContext): Promise<Set<string>> {
  if (ctx.actor.role !== 'veli') return new Set()
  const links = await listMembershipLinks(db, ctx.institutionId, ctx.actor.membershipId)
  return new Set(links.filter((link) => link.kind === 'child').map((link) => link.recordId))
}

/** Bağı kalkmış çocukların anahtarlarını ayıklar. */
function keepLinked(
  preferences: NotificationPreferences,
  linked: ReadonlySet<string>,
): NotificationPreferences {
  return {
    ...preferences,
    children: Object.fromEntries(
      Object.entries(preferences.children).filter(([childId]) => linked.has(childId)),
    ),
  }
}

export async function notificationPreferencesFor(
  ctx: ServiceContext,
): Promise<NotificationPreferencesView> {
  const stored = await loadNotificationPreferences(
    ctx.db,
    ctx.institutionId,
    ctx.actor.userId,
    ctx.log,
  )
  return {
    preferences: keepLinked(
      stored.preferences ?? defaultNotificationPreferences(),
      await linkedChildIds(ctx.db, ctx),
    ),
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
      // Atomiklik koşullu `UPDATE ... WHERE version` ve `onConflictDoNothing` ile sağlanır.
      const stored = await loadNotificationPreferences(
        tx,
        ctx.institutionId,
        ctx.actor.userId,
        ctx.log,
      )
      if (stored.version !== version) throw new ConflictError()
      const linked = await linkedChildIds(tx, ctx)
      // Bağlı olmayan çocuk kimliği 404: kimliğin varlığı sorgulanamaz.
      if (Object.keys(patch.children ?? {}).some((childId) => !linked.has(childId)))
        throw new NotFoundError()
      const next = applyNotificationPreferencesPatch(
        keepLinked(stored.preferences ?? defaultNotificationPreferences(), linked),
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
