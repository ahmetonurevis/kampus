import { DomainError } from '@kampus/school-core/lib/errors.ts'
import {
  NOTIFICATION_CHANNELS,
  isMandatoryTopic,
  notificationPreferencesSchema,
  requiredChannels,
  validateNotificationPreferences,
  type NotificationChannel,
  type NotificationPreferences,
  type NotificationPreferencesPatch,
  type PartialTopicChannels,
  type QuietHours,
} from '@kampus/school-core/lib/notification-preferences.ts'
import {
  NOTIFICATION_TOPICS,
  type NotificationTopic,
} from '@kampus/school-core/lib/notifications.ts'

/**
 * Bildirim tercihi formunun saf modeli (DOM-ILT-020, -021): API yanıtı ↔ form değeri, kanal
 * hücresinin kilitli gösterimi, çocuk kırılımı ve kayıt gövdesi. Kural kaynağı core'dur; burada
 * kural yeniden yazılmaz, yalnız ekrana çevrilir.
 */

export type { NotificationChannel, NotificationTopic, NotificationPreferences, QuietHours }
export { NOTIFICATION_CHANNELS, NOTIFICATION_TOPICS }

/** Kayıtlı tercih ve okunan sürüm (`GET`/`PATCH` yanıtı). */
export interface NotificationPreferencesRecord {
  preferences: NotificationPreferences
  version: number
}

/** Form değeri API'deki tercihle aynı biçimdedir; kopya alınır, kayıt nesnesi değişmez. */
export type NotificationPreferencesForm = NotificationPreferences

export const CHANNEL_LABELS: Readonly<Record<NotificationChannel, string>> = {
  in_app: 'Uygulama içi',
  push: 'Anlık bildirim',
  email: 'E-posta',
  sms: 'SMS',
}

export function toForm(record: NotificationPreferencesRecord): NotificationPreferencesForm {
  const { topics, quietHours, children } = record.preferences
  return {
    topics: Object.fromEntries(
      NOTIFICATION_TOPICS.map((topic) => [topic, [...topics[topic]]]),
    ) as NotificationPreferences['topics'],
    quietHours: { ...quietHours },
    children: Object.fromEntries(
      Object.entries(children).map(([id, own]) => [id, { ...own }]),
    ) as NotificationPreferences['children'],
  }
}

/**
 * Form şeması: core şeması + core kuralları (zorunlu taban kanal, sessiz saat). İhlal, kuralın yoluyla
 * alana yazılır; kurum sınırı sunucuda uygulanır (422 `quiet_hours_over_limit`).
 */
export const notificationPreferencesFormSchema = notificationPreferencesSchema.superRefine(
  (value, ctx) => {
    try {
      validateNotificationPreferences(value)
    } catch (error) {
      if (!(error instanceof DomainError)) throw error
      ctx.addIssue({ code: 'custom', message: error.message, path: [...(error.path ?? [])] })
    }
  },
)

export interface ChannelCell {
  topic: NotificationTopic
  channel: NotificationChannel
  checked: boolean
  /** Kapatılamaz: işaretli ve devre dışı gösterilir. */
  locked: boolean
  /** Onay kutusu etiketi: "Ödev ve sınav — e-posta". */
  label: string
}

/** Kanal hücresinin kilidi: zorunlu taban kanal her zaman işaretli ve kilitlidir. */
export function isChannelLocked(topic: NotificationTopic, channel: NotificationChannel): boolean {
  return requiredChannels(topic).includes(channel)
}

/** Konu kapatılamıyorsa kullanıcıya gösterilen açıklama (kilit sebebi); değilse `null`. */
export function lockedTopicNote(topic: NotificationTopic): string | null {
  return isMandatoryTopic(topic) ? 'Bu bildirim kapatılamaz' : null
}

/** Kapsama göre etkin kanallar: çocuk kapsamında çocuğa özel tercih, yoksa genel tercih. */
export function effectiveChannels(
  form: NotificationPreferencesForm,
  topic: NotificationTopic,
  childId: string | null,
): readonly NotificationChannel[] {
  const own = childId ? form.children[childId]?.[topic] : undefined
  return own ?? form.topics[topic]
}

export function channelCell(
  form: NotificationPreferencesForm,
  topic: NotificationTopic,
  channel: NotificationChannel,
  childId: string | null,
  topicLabel: string,
): ChannelCell {
  const locked = isChannelLocked(topic, channel)
  return {
    topic,
    channel,
    locked,
    checked: locked || effectiveChannels(form, topic, childId).includes(channel),
    label: `${topicLabel} — ${CHANNEL_LABELS[channel].toLocaleLowerCase('tr-TR')}`,
  }
}

/** Kanalı açar ya da kapatır; kilitli kanal değişmez, sonuç sabit kanal sırasındadır. */
export function toggleChannel(
  current: readonly NotificationChannel[],
  topic: NotificationTopic,
  channel: NotificationChannel,
  on: boolean,
): NotificationChannel[] {
  const next = new Set(current)
  if (on) next.add(channel)
  else if (!isChannelLocked(topic, channel)) next.delete(channel)
  for (const required of requiredChannels(topic)) next.add(required)
  return NOTIFICATION_CHANNELS.filter((item) => next.has(item))
}

/** Formda kanalı değiştirir (genel ya da çocuk kapsamında); yeni form döner. */
export function setChannel(
  form: NotificationPreferencesForm,
  topic: NotificationTopic,
  channel: NotificationChannel,
  on: boolean,
  childId: string | null,
): NotificationPreferencesForm {
  const next = toggleChannel(effectiveChannels(form, topic, childId), topic, channel, on)
  if (!childId) return { ...form, topics: { ...form.topics, [topic]: next } }
  return {
    ...form,
    children: { ...form.children, [childId]: { ...form.children[childId], [topic]: next } },
  }
}

/** Çocuğa özel tercihleri kaldırır; çocuk genel tercihi izler. */
export function clearChildOverrides(
  form: NotificationPreferencesForm,
  childId: string,
): NotificationPreferencesForm {
  const children = { ...form.children }
  delete children[childId]
  return { ...form, children }
}

/** Çocuğun genel tercihten ayrışan konusu var mı. */
export function hasChildOverrides(form: NotificationPreferencesForm, childId: string): boolean {
  return Object.keys(form.children[childId] ?? {}).length > 0
}

const sameChannels = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((channel, index) => channel === b[index])

/**
 * Kayıt gövdesi. Çocuk kırılımı yalnız veli içindir (`includeChildren`); diğer rollerde `children`
 * hiç gönderilmez (422 `notification_children_parent_only`). Boş çocuk kaydı atılır. Değişmeyen
 * kısım gönderilmez.
 */
export function toPatch(
  form: NotificationPreferencesForm,
  saved: NotificationPreferencesRecord,
  includeChildren: boolean,
): NotificationPreferencesPatch & { version: number } {
  const base = saved.preferences
  const topics: PartialTopicChannels = {}
  for (const topic of NOTIFICATION_TOPICS)
    if (!sameChannels(form.topics[topic], base.topics[topic])) topics[topic] = form.topics[topic]
  const patch: NotificationPreferencesPatch & { version: number } = { version: saved.version }
  if (Object.keys(topics).length > 0) patch.topics = topics
  const quiet = form.quietHours
  const baseQuiet = base.quietHours
  if (
    quiet.enabled !== baseQuiet.enabled ||
    quiet.start !== baseQuiet.start ||
    quiet.end !== baseQuiet.end
  )
    patch.quietHours = quiet
  if (includeChildren) {
    const children = Object.fromEntries(
      Object.entries(form.children).filter(([, own]) => Object.keys(own).length > 0),
    )
    if (JSON.stringify(children) !== JSON.stringify(base.children)) patch.children = children
  }
  return patch
}

/** Kaydedilecek değişiklik var mı (kaydet düğmesi). */
export function isDirty(
  form: NotificationPreferencesForm,
  saved: NotificationPreferencesRecord,
  includeChildren: boolean,
): boolean {
  return Object.keys(toPatch(form, saved, includeChildren)).length > 1
}

export const NOTIFICATION_PREFERENCES_MESSAGES = {
  version_conflict: 'Tercihleriniz başka bir yerde değişti, güncel hâli yüklendi.',
  notification_children_parent_only: 'Çocuğa göre tercih yalnız veli hesabında ayarlanır.',
} as const
