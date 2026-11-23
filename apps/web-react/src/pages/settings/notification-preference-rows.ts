import { TOPIC_LABELS } from '@kampus/school-core/lib/notification-preferences.ts'
import {
  CHANNEL_LABELS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TOPICS,
  channelCell,
  lockedTopicNote,
  type ChannelCell,
  type NotificationChannel,
  type NotificationPreferencesForm,
  type NotificationTopic,
} from '@kampus/react-shared/notification-preferences-model.ts'

/**
 * Bildirim tercihi tablosunun satırları (DOM-ILT-020): konu etiketi core'dan (`TOPIC_LABELS`),
 * kanal sütunları sabit sırada, her hücre işaretli/kilitli durumu ve erişilebilir etiketiyle.
 */

export const CHANNEL_COLUMNS: ReadonlyArray<{ channel: NotificationChannel; label: string }> =
  NOTIFICATION_CHANNELS.map((channel) => ({ channel, label: CHANNEL_LABELS[channel] }))

export interface PreferenceRow {
  topic: NotificationTopic
  label: string
  /** Zorunlu konuda "Bu bildirim kapatılamaz"; değilse `null`. */
  note: string | null
  cells: ChannelCell[]
}

/** `childId` verilirse çocuk kapsamı (çocuğa özel tercih yoksa genel tercih görünür). */
export function preferenceRows(
  form: NotificationPreferencesForm,
  childId: string | null,
): PreferenceRow[] {
  return NOTIFICATION_TOPICS.map((topic) => ({
    topic,
    label: TOPIC_LABELS[topic],
    note: lockedTopicNote(topic),
    cells: NOTIFICATION_CHANNELS.map((channel) =>
      channelCell(form, topic, channel, childId, TOPIC_LABELS[topic]),
    ),
  }))
}

export const GENERAL_SCOPE = ''

/** Kapsam seçeneklerinin adı gelmeyen çocuğu atılır (ad uydurulmaz). */
export function scopeOptions(
  children: ReadonlyArray<{ id: string; name?: string | undefined }>,
): Array<{ value: string; label: string }> {
  return [
    { value: GENERAL_SCOPE, label: 'Tüm çocuklarım (genel tercih)' },
    ...children.flatMap((child) => (child.name ? [{ value: child.id, label: child.name }] : [])),
  ]
}

export const QUIET_HOURS_NOTE =
  'Saatler Türkiye saatine (Europe/Istanbul) göredir. Sessiz saatte anlık bildirim ve SMS sabaha ertelenir; uygulama içi bildirimler ve e-posta etkilenmez.'

export const DELIVERY_NOTE =
  'Uygulama içi bildirimler her zaman görünür. Anlık bildirim, e-posta ve SMS kanalları kurumunuz bu kanalları açtığında kullanılır; seçiminiz şimdiden kaydedilir.'
