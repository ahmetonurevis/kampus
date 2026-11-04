import { z } from 'zod'

import { DomainError } from './errors.ts'
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_TOPICS,
  notificationSpec,
  type NotificationKind,
  type NotificationTopic,
} from './notifications.ts'

/**
 * Bildirim tercihi ve sessiz saatler (docs/domain/iletisim-ve-veli.md DOM-ILT-020, -021; acil
 * duyuru istisnası DOM-ILT-050). Saf kurallar: tercih şeması, zorunlu konuda kanal kapatma reddi,
 * sessiz saat şeması ve kurum sınırı, varsayılanlar, "şu an sessiz saatte mi" ve "bu bildirim
 * bu kanaldan gider mi". Web, mobil ve API aynı kuralları çalıştırır; zaman `now` parametresidir
 * ve sessiz saat Europe/Istanbul saatine göredir.
 *
 * - Kanallar: uygulama içi (`in_app`, her konuda zorunlu, kapatılamaz), anlık (`push`), e-posta,
 *   SMS. Kullanıcı konu başına kanal seçer.
 * - Zorunlu konu (türlerinden biri `mandatory`: devamsızlık, onay son tarihi) kapatılamaz: taban
 *   kanal kümesi `in_app` + `push` her zaman kalır, kullanıcı yalnız ek kanal (e-posta, SMS)
 *   ekleyebilir. Uygulama içi kayıt her zaman anında düşer.
 * - Veli için tercih çocuğa göre ayrılabilir (`children`): çocuk için tanımlı konu, genel konu
 *   tercihinin yerine geçer; tanımsız konu genel tercihi izler.
 * - Sessiz saat varsayılanı 21:00–08:00; gece yarısını aşabilir. Kurum, kullanıcı aralığının
 *   sığması gereken en geniş aralığı belirleyebilir (`institutionLimit`). Sessiz saatte `push` ve
 *   `sms` ertelenir; e-posta ve uygulama içi etkilenmez. Acil duyuru (`urgent`) sessiz saati deler.
 */

export const NOTIFICATION_CHANNELS = ['in_app', 'push', 'email', 'sms'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

/** Sessiz saatte ertelenen kanallar (DOM-ILT-021). */
export const QUIET_DEFERRED_CHANNELS: readonly NotificationChannel[] = ['push', 'sms']

const ALWAYS_ON: readonly NotificationChannel[] = ['in_app']
const MANDATORY_FLOOR: readonly NotificationChannel[] = ['in_app', 'push']

export const DEFAULT_QUIET_START = '21:00'
export const DEFAULT_QUIET_END = '08:00'

/** Çocuk kırılımı en çok bu kadar çocuk için tutulur. */
const MAX_CHILDREN = 20

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Saat SS:DD biçiminde olmalı')
const channelListSchema = z.array(z.enum(NOTIFICATION_CHANNELS)).max(NOTIFICATION_CHANNELS.length)
const identifier = z.string().trim().min(1).max(200)

export const quietHoursSchema = z.strictObject({
  enabled: z.boolean(),
  start: timeOfDay,
  end: timeOfDay,
})
export type QuietHours = z.infer<typeof quietHoursSchema>

/** Konu → kanal listesi; her konu tanımlıdır. */
export const topicChannelsSchema = z.strictObject(
  Object.fromEntries(NOTIFICATION_TOPICS.map((topic) => [topic, channelListSchema])) as Record<
    NotificationTopic,
    typeof channelListSchema
  >,
)
export type TopicChannels = z.infer<typeof topicChannelsSchema>
export const partialTopicChannelsSchema = topicChannelsSchema.partial()
export type PartialTopicChannels = z.infer<typeof partialTopicChannelsSchema>

export const notificationPreferencesSchema = z.strictObject({
  topics: topicChannelsSchema,
  quietHours: quietHoursSchema,
  /** Veli için çocuk kimliği → o çocuğa özel konu tercihi (DOM-ILT-020). */
  children: z.record(identifier, partialTopicChannelsSchema),
})
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>

/** Kısmi güncelleme: `topics` birleştirilir, `quietHours` ve `children` verilirse bütün olarak yerini alır. */
export const notificationPreferencesPatchSchema = z.strictObject({
  topics: partialTopicChannelsSchema.optional(),
  quietHours: quietHoursSchema.optional(),
  children: z.record(identifier, partialTopicChannelsSchema).optional(),
})
export type NotificationPreferencesPatch = z.infer<typeof notificationPreferencesPatchSchema>

/** Konunun türlerinden biri zorunluysa konu kapatılamaz (DOM-ILT-020). */
export function isMandatoryTopic(topic: NotificationTopic): boolean {
  return Object.values(NOTIFICATION_KINDS).some((spec) => spec.topic === topic && spec.mandatory)
}

/** Konuda her zaman açık kalan kanallar. */
export function requiredChannels(topic: NotificationTopic): readonly NotificationChannel[] {
  return isMandatoryTopic(topic) ? MANDATORY_FLOOR : ALWAYS_ON
}

/** Yinelenenleri atar ve sabit kanal sırasına koyar. */
const sorted = (channels: readonly NotificationChannel[]): NotificationChannel[] =>
  NOTIFICATION_CHANNELS.filter((channel) => channels.includes(channel))

/** Konu etiketleri (tek kaynak; web ve mobil bunu gösterir). */
export const TOPIC_LABELS: Readonly<Record<NotificationTopic, string>> = {
  homework: 'Ödev ve sınav',
  grade: 'Not',
  attendance: 'Devamsızlık',
  payment: 'Ödeme',
  announcement: 'Duyuru',
  message: 'Mesaj',
  appointment: 'Randevu',
  consent: 'Etkinlik onayı',
  bulletin: 'Bülten',
  enrollment: 'Kayıt',
}

/** Varsayılan kanallar: uygulama içi ve anlık bildirim; bülten yalnız uygulama içi. */
export function defaultTopicChannels(): TopicChannels {
  return Object.fromEntries(
    NOTIFICATION_TOPICS.map((topic) => [
      topic,
      topic === 'bulletin' ? ['in_app'] : ['in_app', 'push'],
    ]),
  ) as TopicChannels
}

export function defaultNotificationPreferences(): NotificationPreferences {
  return {
    topics: defaultTopicChannels(),
    quietHours: { enabled: true, start: DEFAULT_QUIET_START, end: DEFAULT_QUIET_END },
    children: {},
  }
}

function assertChannels(
  topic: NotificationTopic,
  channels: readonly NotificationChannel[],
  path: string[],
) {
  if (requiredChannels(topic).every((channel) => channels.includes(channel))) return
  throw new DomainError(
    'notification_channel_required',
    isMandatoryTopic(topic)
      ? `${TOPIC_LABELS[topic]} bildirimleri zorunludur; uygulama içi ve anlık bildirim kapatılamaz, yalnız e-posta veya SMS eklenebilir.`
      : `${TOPIC_LABELS[topic]} bildirimleri her zaman uygulama içinde görünür; bu kanal kapatılamaz.`,
    { path },
  )
}

const minutesOf = (time: string): number => {
  const [h = '0', m = '0'] = time.split(':')
  return Number(h) * 60 + Number(m)
}

/** Aralığın uzunluğu, dakika; gece yarısını aşan aralık sarılır. Eşit başlangıç ve bitiş 0'dır. */
const spanMinutes = (start: string, end: string): number =>
  (minutesOf(end) - minutesOf(start) + 1440) % 1440

/**
 * `inner` aralığı `outer` aralığının içinde mi (ikisi de gece yarısını aşabilir). Kurum sınırı
 * kullanıcının sessiz saatinin sığacağı en geniş aralıktır (DOM-ILT-021).
 */
export function quietWithin(
  inner: Pick<QuietHours, 'start' | 'end'>,
  outer: Pick<QuietHours, 'start' | 'end'>,
): boolean {
  const offset = (minutesOf(inner.start) - minutesOf(outer.start) + 1440) % 1440
  return offset + spanMinutes(inner.start, inner.end) <= spanMinutes(outer.start, outer.end)
}

/** Kurum sınırı: kullanıcının sessiz saati bu aralığa sığmalıdır; `null` sınır yok demektir. */
export type InstitutionQuietLimit = Pick<QuietHours, 'start' | 'end'> | null

function assertQuietHours(quiet: QuietHours, limit: InstitutionQuietLimit) {
  if (!quiet.enabled) return
  if (spanMinutes(quiet.start, quiet.end) === 0)
    throw new DomainError(
      'quiet_hours_invalid',
      'Sessiz saatin başlangıcı ile bitişi aynı olamaz.',
      {
        path: ['quietHours', 'end'],
      },
    )
  if (limit && !quietWithin(quiet, limit))
    throw new DomainError(
      'quiet_hours_over_limit',
      `Sessiz saat kurumun izin verdiği ${limit.start}–${limit.end} aralığını aşamaz.`,
      { path: ['quietHours'] },
    )
}

/**
 * Tercihi doğrular (zorunlu konu, çocuk kırılımı, sessiz saat ve kurum sınırı) ve normalize eder.
 * Kural ihlali `DomainError` (422).
 */
export function validateNotificationPreferences(
  input: NotificationPreferences,
  institutionLimit: InstitutionQuietLimit = null,
): NotificationPreferences {
  if (Object.keys(input.children).length > MAX_CHILDREN)
    throw new DomainError('notification_children_limit', 'Çok fazla çocuk için tercih girildi.', {
      path: ['children'],
    })
  const topics = {} as Record<NotificationTopic, NotificationChannel[]>
  for (const topic of NOTIFICATION_TOPICS) {
    assertChannels(topic, input.topics[topic], ['topics', topic])
    topics[topic] = sorted(input.topics[topic])
  }
  const children: Record<string, PartialTopicChannels> = {}
  for (const [childId, byTopic] of Object.entries(input.children)) {
    const own: PartialTopicChannels = {}
    for (const topic of NOTIFICATION_TOPICS) {
      const channels = byTopic[topic]
      if (!channels) continue
      assertChannels(topic, channels, ['children', childId, topic])
      own[topic] = sorted(channels)
    }
    children[childId] = own
  }
  assertQuietHours(input.quietHours, institutionLimit)
  return { topics, quietHours: input.quietHours, children }
}

/** Kısmi güncellemeyi mevcut tercihe uygular ve doğrular. */
export function applyNotificationPreferencesPatch(
  current: NotificationPreferences,
  patch: NotificationPreferencesPatch,
  institutionLimit: InstitutionQuietLimit = null,
): NotificationPreferences {
  return validateNotificationPreferences(
    {
      topics: { ...current.topics, ...patch.topics },
      quietHours: patch.quietHours ?? current.quietHours,
      children: patch.children ?? current.children,
    },
    institutionLimit,
  )
}

/**
 * Kurum sınırı sonradan daraldıysa saklı sessiz saati sınıra sığdırır: sığmıyorsa sınırın kendisi
 * geçerli olur. Okumada kullanılır, kayıt değişmez.
 */
export function effectiveQuietHours(
  quiet: QuietHours,
  institutionLimit: InstitutionQuietLimit = null,
): QuietHours {
  // TODO(bildirim-tercihleri-kurum-siniri): eşit uçlu kurum aralığının (span 0) anlamı belirsiz:
  // `quietWithin` yalnız 0 dakikalık kullanıcı aralığını sığdırır; kurum ayarı gelince karar verilir.
  if (!quiet.enabled || !institutionLimit || quietWithin(quiet, institutionLimit)) return quiet
  return { enabled: true, start: institutionLimit.start, end: institutionLimit.end }
}

const istanbulClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Istanbul',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** `now` anının Europe/Istanbul saatindeki gün dakikası (0–1439). */
export function istanbulMinuteOfDay(now: Date): number {
  const parts = istanbulClock.formatToParts(now)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0')
  return get('hour') * 60 + get('minute')
}

/** Şu an sessiz saatte mi (başlangıç dahil, bitiş hariç; gece yarısını aşan aralık sarılır). */
export function isQuietNow(quiet: QuietHours, now: Date): boolean {
  if (!quiet.enabled) return false
  const span = spanMinutes(quiet.start, quiet.end)
  return span > 0 && (istanbulMinuteOfDay(now) - minutesOf(quiet.start) + 1440) % 1440 < span
}

/** Çocuk tercihi tanımlıysa o, değilse genel konu tercihi; zorunlu taban her zaman eklenir. */
export function channelsFor(
  preferences: NotificationPreferences,
  topic: NotificationTopic,
  studentId?: string,
): NotificationChannel[] {
  const own = studentId ? preferences.children[studentId]?.[topic] : undefined
  return sorted([...(own ?? preferences.topics[topic]), ...requiredChannels(topic)])
}

export type DeliveryDecision = 'send' | 'defer' | 'skip'

/**
 * Bu bildirim bu kanaldan şimdi gider mi (DOM-ILT-020, -021). `send` şimdi, `defer` sessiz saat
 * bitince tek özet, `skip` kullanıcı kanalı seçmediği için gönderilmez. Uygulama içi her zaman
 * `send`'dir. `urgent` (acil durum duyurusu, DOM-ILT-050) sessiz saati deler; kanal tercihini
 * delmez.
 */
export function deliveryDecision(input: {
  preferences: NotificationPreferences
  kind: NotificationKind
  channel: NotificationChannel
  now: Date
  studentId?: string
  urgent?: boolean
  institutionLimit?: InstitutionQuietLimit
}): DeliveryDecision {
  if (input.channel === 'in_app') return 'send'
  // TODO(bildirim-tercihleri-teslim): acil duyuru (urgent) kanal tercihinden bağımsız push ile
  // gider (DOM-ILT-050); teslim katmanı yazılınca urgent için `skip` push'a çevrilir.
  const topic = notificationSpec(input.kind).topic
  if (!channelsFor(input.preferences, topic, input.studentId).includes(input.channel)) return 'skip'
  if (input.urgent === true || !QUIET_DEFERRED_CHANNELS.includes(input.channel)) return 'send'
  const quiet = effectiveQuietHours(input.preferences.quietHours, input.institutionLimit ?? null)
  return isQuietNow(quiet, input.now) ? 'defer' : 'send'
}
