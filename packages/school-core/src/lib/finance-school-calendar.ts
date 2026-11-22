import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { istanbulInstant } from './finance-infirmary-schedule.ts'
import { addDays, daysBetween } from './finance-opening-watch.ts'

/**
 * Okul etkinlik takvimi (docs/domain/finans.md DOM-FIN-163; ON-090; IST-099; K-544…K-546).
 * Etkinlik başlık, tür (tören, veli toplantısı, sınav haftası, tatil, gezi, gösteri, diğer),
 * başlangıç ve bitiş günü (Europe/Istanbul takvim günü), tüm gün değilse başlangıç ve bitiş saati
 * (`SS:DD`, İstanbul duvar saati), yer, açıklama ve hedef kitle (tüm kurum, kademe = sınıf düzeyi,
 * sınıf ya da dil okulu grubu) taşır. Taslak yalnız yönetici ve ön büroda görünür; yayımlanan
 * etkinlik hedef kitleye görünür. Etkinlik silinmez, gerekçeyle iptal edilir; yayımlanmışken iptal
 * edilen etkinlik hedef kitleye "İptal edildi" olarak görünmeye devam eder (K-544).
 *
 * Tatil günlerinin tek kaynağı bu takvimdir: yayımlanmış, tüm kurum hedefli `holiday` etkinlikleri
 * kurumun tatilidir; izin takvimi (DOM-FIN-123) tatili buradan okur (K-545). Gezi planı
 * (DOM-FIN-111) ve biletli etkinlik (DOM-FIN-103) takvime kopyalanmaz; okuma anında bağlantı olarak
 * eklenir (K-546). Eski iş akışı koleksiyonu (`schoolEvents`, `eventConsents`) bu modelden ayrıdır ve
 * değişmez; modül anahtarı (`calendar`) ortaktır. Fonksiyonlar saftır.
 */

/** Etkinlik yazma, yayım ve iptal: yönetici ve ön büro (K-544). */
export const SCHOOL_CALENDAR_MANAGE_ROLES = [
  'yonetici',
  'onburo',
] as const satisfies readonly Role[]
/** Kendi takvimini okuyan roller; kapsam sunucuda daralır (K-544). */
export const SCHOOL_CALENDAR_VIEWER_ROLES = [
  'ogretmen',
  'veli',
  'ogrenci',
] as const satisfies readonly Role[]
/** iCal dışa aktarımı: yönetim rolleri kurumun, diğerleri kendi takvimini indirir. */
export const SCHOOL_CALENDAR_ICAL_ROLES = [
  ...SCHOOL_CALENDAR_MANAGE_ROLES,
  ...SCHOOL_CALENDAR_VIEWER_ROLES,
] as const satisfies readonly Role[]

export const SCHOOL_EVENT_KINDS = [
  'ceremony',
  'parent_meeting',
  'exam_week',
  'holiday',
  'trip',
  'performance',
  'other',
] as const
export type SchoolEventKind = (typeof SCHOOL_EVENT_KINDS)[number]
export const SCHOOL_EVENT_KIND_LABELS = {
  ceremony: 'Tören',
  parent_meeting: 'Veli toplantısı',
  exam_week: 'Sınav haftası',
  holiday: 'Tatil',
  trip: 'Gezi',
  performance: 'Gösteri',
  other: 'Diğer',
} as const satisfies Record<SchoolEventKind, string>
/** Tüm gün süren türler (K-544): tatil ve sınav haftası saatle girilmez. */
export const ALL_DAY_SCHOOL_EVENT_KINDS: readonly SchoolEventKind[] = ['exam_week', 'holiday']

export const SCHOOL_EVENT_STATUSES = ['draft', 'published', 'cancelled'] as const
export type SchoolEventStatus = (typeof SCHOOL_EVENT_STATUSES)[number]
export const SCHOOL_EVENT_STATUS_LABELS = {
  draft: 'Taslak',
  published: 'Yayımlandı',
  cancelled: 'İptal edildi',
} as const satisfies Record<SchoolEventStatus, string>

export const SCHOOL_EVENT_AUDIENCES = ['institution', 'grade', 'class', 'group'] as const
export type SchoolEventAudience = (typeof SCHOOL_EVENT_AUDIENCES)[number]
export const SCHOOL_EVENT_AUDIENCE_LABELS = {
  institution: 'Tüm kurum',
  grade: 'Kademe',
  class: 'Sınıf',
  group: 'Grup',
} as const satisfies Record<SchoolEventAudience, string>

/** Takvime bağlantı olarak eklenen kayıtlar (K-546); kopya değildir. */
export const SCHOOL_CALENDAR_LINK_SOURCES = ['trip_plan', 'ticketed_event'] as const
export type SchoolCalendarLinkSource = (typeof SCHOOL_CALENDAR_LINK_SOURCES)[number]
export const SCHOOL_CALENDAR_LINK_LABELS = {
  trip_plan: 'Gezi planı',
  ticketed_event: 'Biletli etkinlik',
} as const satisfies Record<SchoolCalendarLinkSource, string>

export const SCHOOL_EVENT_TITLE_MIN = 2
export const SCHOOL_EVENT_TITLE_MAX = 120
export const SCHOOL_EVENT_LOCATION_MAX = 160
export const SCHOOL_EVENT_DESCRIPTION_MAX = 2000
export const SCHOOL_EVENT_CANCEL_REASON_MIN = 10
export const SCHOOL_EVENT_CANCEL_REASON_MAX = 500
/** Bir etkinliğe en çok bu kadar kademe, sınıf ya da grup seçilir. */
export const SCHOOL_EVENT_AUDIENCE_IDS_MAX = 40
/** Kademe (sınıf düzeyi) aralığı. */
export const SCHOOL_EVENT_GRADE_MIN = 1
export const SCHOOL_EVENT_GRADE_MAX = 12
/** Bir etkinlik en çok bu kadar takvim günü sürer (uçlar dahil; yaz tatili sığar). */
export const SCHOOL_EVENT_DAYS_MAX = 120
/** Ay ve hafta görünümünün en uzun aralığı (takvim günü, uçlar dahil; ay görünümü 6 hafta). */
export const SCHOOL_CALENDAR_RANGE_MAX_DAYS = 62
/** Liste ve iCal dışa aktarımının en uzun aralığı (takvim günü, uçlar dahil). */
export const SCHOOL_CALENDAR_LIST_RANGE_MAX_DAYS = 366

// --- Şemalar -------------------------------------------------------------------------------------

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const GRADE_PATTERN = /^(1[0-2]|[1-9])$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const timeSchema = (label: string) =>
  z
    .string(`${label} saatini girin.`)
    .regex(TIME_PATTERN, `${label} saatini SS:DD biçiminde girin.`)
    .describe(`${label} saati (SS:DD, Europe/Istanbul)`)

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} en çok ${String(max)} karakter olabilir.`)
    .nullable()
    .optional()

const fields = {
  title: z
    .string('Başlığı yazın.')
    .trim()
    .min(SCHOOL_EVENT_TITLE_MIN, 'Başlığı en az 2 karakterle yazın.')
    .max(
      SCHOOL_EVENT_TITLE_MAX,
      `En çok ${String(SCHOOL_EVENT_TITLE_MAX)} karakter girebilirsiniz.`,
    )
    .describe('Etkinlik başlığı (2–120)'),
  kind: z.enum(SCHOOL_EVENT_KINDS, 'Etkinlik türünü seçin.').describe('Etkinlik türü'),
  allDay: z
    .boolean('Tüm gün mü, seçin.')
    .describe('Tüm gün; tatil ve sınav haftası her zaman tüm gündür'),
  startDate: daySchema.describe('Başlangıç günü (YYYY-MM-DD, Europe/Istanbul)'),
  endDate: daySchema.describe('Bitiş günü (YYYY-MM-DD, dahil); tek günlükte başlangıçla aynı'),
  startTime: timeSchema('Başlangıç')
    .nullable()
    .optional()
    .describe('Başlangıç saati (SS:DD); tüm gün değilse zorunlu, tüm günde yok sayılır'),
  endTime: timeSchema('Bitiş')
    .nullable()
    .optional()
    .describe('Bitiş saati (SS:DD); tüm gün değilse zorunlu, tüm günde yok sayılır'),
  location: optionalText(SCHOOL_EVENT_LOCATION_MAX, 'Yer').describe('Yer (en çok 160); boş yok'),
  description: optionalText(SCHOOL_EVENT_DESCRIPTION_MAX, 'Açıklama').describe(
    'Açıklama (en çok 2000); boş yok',
  ),
  audienceKind: z
    .enum(SCHOOL_EVENT_AUDIENCES, 'Hedef kitleyi seçin.')
    .describe('Hedef kitle: tüm kurum, kademe (sınıf düzeyi), sınıf ya da grup'),
  audienceIds: z
    .array(z.string().trim().min(1).max(100), 'Hedefleri seçin.')
    .max(
      SCHOOL_EVENT_AUDIENCE_IDS_MAX,
      `En çok ${String(SCHOOL_EVENT_AUDIENCE_IDS_MAX)} hedef seçilebilir.`,
    )
    .describe(
      'Kademe için sınıf düzeyleri ("7"), sınıf için sınıf kimlikleri, grup için dil okulu grubu kimlikleri; tüm kurumda boş',
    ),
}

/** Saklanan etkinlik alanları (normalleştirilmiş). */
export interface SchoolEventFields {
  title: string
  kind: SchoolEventKind
  allDay: boolean
  startDate: string
  endDate: string
  startTime: string | null
  endTime: string | null
  location: string | null
  description: string | null
  audienceKind: SchoolEventAudience
  audienceIds: string[]
}

type SchoolEventDraft = Omit<
  SchoolEventFields,
  'startTime' | 'endTime' | 'location' | 'description'
> & {
  startTime?: string | null | undefined
  endTime?: string | null | undefined
  location?: string | null | undefined
  description?: string | null | undefined
}

const blankToNull = (value: string | null | undefined) =>
  value === undefined || value === null || value.trim() === '' ? null : value.trim()

/**
 * Normalleştirme: tüm gün etkinliğinde saat yok; boş yer ve açıklama `null`; tüm kurum hedefinde
 * kimlik yok, diğerlerinde kimlikler tekil ve sıralı.
 */
export function normalizeSchoolEvent(input: SchoolEventDraft): SchoolEventFields {
  const ids =
    input.audienceKind === 'institution'
      ? []
      : [...new Set(input.audienceIds.map((id) => id.trim()))].sort((a, b) =>
          input.audienceKind === 'grade' ? Number(a) - Number(b) : a.localeCompare(b),
        )
  return {
    title: input.title.trim(),
    kind: input.kind,
    allDay: input.allDay,
    startDate: input.startDate,
    endDate: input.endDate,
    startTime: input.allDay ? null : (input.startTime ?? null),
    endTime: input.allDay ? null : (input.endTime ?? null),
    location: blankToNull(input.location),
    description: blankToNull(input.description),
    audienceKind: input.audienceKind,
    audienceIds: ids,
  }
}

export interface SchoolEventIssue {
  path: keyof SchoolEventFields
  message: string
}

/**
 * Etkinliğin bütün hâlinin kuralları (K-544): bitiş başlangıçtan önce olamaz ve etkinlik en çok
 * 120 gün sürer; tatil ve sınav haftası tüm gündür; tüm gün değilse iki saat de girilir ve tek
 * günlükte bitiş saati başlangıçtan sonradır; tüm kurum dışındaki hedefte en az bir hedef seçilir,
 * kademe 1–12, grup kimliği UUID'dir.
 */
export function schoolEventIssues(event: SchoolEventFields): SchoolEventIssue[] {
  const issues: SchoolEventIssue[] = []
  if (event.endDate < event.startDate)
    issues.push({ path: 'endDate', message: 'Bitiş günü başlangıç gününden önce olamaz.' })
  else if (daysBetween(event.startDate, event.endDate) + 1 > SCHOOL_EVENT_DAYS_MAX)
    issues.push({
      path: 'endDate',
      message: `Bir etkinlik en çok ${String(SCHOOL_EVENT_DAYS_MAX)} gün sürebilir.`,
    })
  if (!event.allDay && ALL_DAY_SCHOOL_EVENT_KINDS.includes(event.kind))
    issues.push({ path: 'allDay', message: 'Tatil ve sınav haftası tüm gün sürer.' })
  if (!event.allDay) {
    if (event.startTime === null)
      issues.push({ path: 'startTime', message: 'Başlangıç saatini girin.' })
    if (event.endTime === null) issues.push({ path: 'endTime', message: 'Bitiş saatini girin.' })
    if (
      event.startTime !== null &&
      event.endTime !== null &&
      // Biçimi bozuk saat alan şemasında zaten hata verir; ikinci hata üretilmez.
      TIME_PATTERN.test(event.startTime) &&
      TIME_PATTERN.test(event.endTime) &&
      event.startDate === event.endDate &&
      event.endTime <= event.startTime
    )
      issues.push({
        path: 'endTime',
        message: 'Bitiş saati başlangıç saatinden sonra olmalı.',
      })
  }
  if (event.audienceKind !== 'institution') {
    if (event.audienceIds.length === 0)
      issues.push({ path: 'audienceIds', message: 'En az bir hedef seçin.' })
    else if (
      event.audienceKind === 'grade' &&
      !event.audienceIds.every((id) => GRADE_PATTERN.test(id))
    )
      issues.push({
        path: 'audienceIds',
        message: `Kademe ${String(SCHOOL_EVENT_GRADE_MIN)}–${String(SCHOOL_EVENT_GRADE_MAX)} arasında olmalı.`,
      })
    else if (
      event.audienceKind === 'group' &&
      !event.audienceIds.every((id) => UUID_PATTERN.test(id))
    )
      issues.push({ path: 'audienceIds', message: 'Grup geçersiz.' })
  }
  return issues
}

export const schoolEventCreateSchema = z
  .strictObject({
    ...fields,
    audienceIds: fields.audienceIds.default([]),
  })
  .superRefine((value, context) => {
    for (const issue of schoolEventIssues(normalizeSchoolEvent(value)))
      context.addIssue({ code: 'custom', path: [issue.path], message: issue.message })
  })
  .describe('Yeni etkinlik (taslak açılır)')
export type SchoolEventCreateInput = z.input<typeof schoolEventCreateSchema>
export type SchoolEventCreateFields = z.output<typeof schoolEventCreateSchema>

export const schoolEventUpdateSchema = z
  .strictObject({
    title: fields.title.optional(),
    kind: fields.kind.optional(),
    allDay: fields.allDay.optional(),
    startDate: fields.startDate.optional(),
    endDate: fields.endDate.optional(),
    startTime: fields.startTime,
    endTime: fields.endTime,
    location: fields.location,
    description: fields.description,
    audienceKind: fields.audienceKind.optional(),
    audienceIds: fields.audienceIds.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Değiştirilecek bir alan girin.')
  .describe('Değişen alanlar; gönderilmeyen alan değişmez, sonuç bütün olarak doğrulanır')
export type SchoolEventUpdateFields = z.output<typeof schoolEventUpdateSchema>

export const schoolEventCancelSchema = z
  .strictObject({
    reason: z
      .string('İptal gerekçesini yazın.')
      .trim()
      .min(
        SCHOOL_EVENT_CANCEL_REASON_MIN,
        `İptal gerekçesini en az ${String(SCHOOL_EVENT_CANCEL_REASON_MIN)} karakterle yazın.`,
      )
      .max(
        SCHOOL_EVENT_CANCEL_REASON_MAX,
        `En çok ${String(SCHOOL_EVENT_CANCEL_REASON_MAX)} karakter girebilirsiniz.`,
      )
      .describe('İptal gerekçesi (10–500); hedef kitle de görür'),
  })
  .describe('Etkinlik iptali')
export type SchoolEventCancelFields = z.output<typeof schoolEventCancelSchema>

/** Tarih aralığı denetimi (ay/hafta 62, liste ve iCal 366 gün). */
export function calendarRangeIssue(from: string, to: string, maxDays: number): string | null {
  if (to < from) return 'Bitiş günü başlangıç gününden önce olamaz.'
  if (daysBetween(from, to) + 1 > maxDays) return `Aralık en çok ${String(maxDays)} gün olabilir.`
  return null
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'rule', path })

/** Hedef kimliklerinin kurumda varlığı: sınıflar ve gruplar (kademe sabit aralıktır). */
export interface AudienceCheck {
  classIds: ReadonlySet<string>
  groupIds: ReadonlySet<string>
}

function assertAudienceExists(event: SchoolEventFields, checks: AudienceCheck) {
  const known =
    event.audienceKind === 'class'
      ? checks.classIds
      : event.audienceKind === 'group'
        ? checks.groupIds
        : null
  if (known === null) return
  if (event.audienceIds.some((id) => !known.has(id)))
    throw ruleError(
      'school_event_audience_not_found',
      event.audienceKind === 'class' ? 'Sınıf bulunamadı.' : 'Grup bulunamadı.',
      ['audienceIds'],
    )
}

/** Yeni etkinlik (K-544): taslak açılır; sınıf ve grup hedefi kurumda olmalı. */
export function planSchoolEventCreate(
  input: SchoolEventCreateFields,
  checks: AudienceCheck,
): SchoolEventFields {
  const event = normalizeSchoolEvent(input)
  assertAudienceExists(event, checks)
  return event
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index])

const FIELD_KEYS = [
  'title',
  'kind',
  'allDay',
  'startDate',
  'endDate',
  'startTime',
  'endTime',
  'location',
  'description',
  'audienceKind',
  'audienceIds',
] as const satisfies readonly (keyof SchoolEventFields)[]

/**
 * Düzenleme (K-544): iptal edilmiş etkinlik değişmez. Gönderilen alanlar mevcutla birleşir, sonuç
 * bütün olarak doğrulanır (kural ihlali 422 `school_event_invalid`); hedef değiştiyse yeni sınıf ve
 * gruplar kurumda olmalı. Hiçbir alan değişmediyse 422. Yayımlanmış etkinlik de düzenlenir; değişiklik
 * hedef kitleye hemen görünür.
 */
export function planSchoolEventUpdate(
  current: SchoolEventFields & { status: SchoolEventStatus },
  input: SchoolEventUpdateFields,
  checks: AudienceCheck,
): { values: SchoolEventFields; changed: (keyof SchoolEventFields)[] } {
  if (current.status === 'cancelled')
    throw ruleError('school_event_cancelled', 'İptal edilmiş etkinlik değiştirilemez.', ['status'])
  const merged: SchoolEventDraft = { ...current }
  for (const key of FIELD_KEYS) {
    const value = input[key]
    if (value !== undefined) Object.assign(merged, { [key]: value })
  }
  const values = normalizeSchoolEvent(merged)
  const [issue] = schoolEventIssues(values)
  if (issue !== undefined) throw ruleError('school_event_invalid', issue.message, [issue.path])
  const changed = FIELD_KEYS.filter((key) =>
    key === 'audienceIds'
      ? !sameList(values.audienceIds, current.audienceIds)
      : values[key] !== current[key],
  )
  if (changed.length === 0) throw ruleError('school_event_unchanged', 'Etkinlikte değişiklik yok.')
  if (changed.includes('audienceKind') || changed.includes('audienceIds'))
    assertAudienceExists(values, checks)
  return { values, changed }
}

/** Yayım (K-544): yalnız taslak. */
export function assertSchoolEventPublishable(status: SchoolEventStatus): void {
  if (status === 'cancelled')
    throw ruleError('school_event_cancelled', 'İptal edilmiş etkinlik yayımlanamaz.', ['status'])
  if (status !== 'draft')
    throw ruleError('school_event_not_draft', 'Etkinlik zaten yayımlanmış.', ['status'])
}

/**
 * İptal (K-544): gerekçe zorunlu, silme yok. İptal edilmiş etkinlik ikinci kez iptal edilmez;
 * bitmiş etkinlik (bitiş günü bugünden önce, Europe/Istanbul) iptal edilmez.
 */
export function assertSchoolEventCancellable(
  event: { status: SchoolEventStatus; endDate: string },
  today: string,
): void {
  if (event.status === 'cancelled')
    throw ruleError('school_event_cancelled', 'Etkinlik zaten iptal edilmiş.', ['status'])
  if (event.endDate < today)
    throw ruleError('school_event_ended', 'Bitmiş etkinlik iptal edilemez.', ['status'])
}

// --- Görünürlük ----------------------------------------------------------------------------------

/** Okuyanın takvim kapsamı: kademeleri, sınıfları ve grupları. */
export interface CalendarViewer {
  grades: ReadonlySet<number>
  classIds: ReadonlySet<string>
  groupIds: ReadonlySet<string>
}

/**
 * Hedef kitle görünürlüğü (K-544): taslak görünmez; yayımlanmış etkinlik ve yayımlandıktan sonra
 * iptal edilen etkinlik hedefe görünür. Tüm kurum herkese; kademe, sınıf ya da grup yalnız kapsamda
 * kesişen okuyana.
 */
export function schoolEventVisibleTo(
  event: {
    status: SchoolEventStatus
    publishedAt: unknown
    audienceKind: SchoolEventAudience
    audienceIds: readonly string[]
  },
  viewer: CalendarViewer,
): boolean {
  const shown =
    event.status === 'published' ||
    (event.status === 'cancelled' && event.publishedAt !== null && event.publishedAt !== undefined)
  if (!shown) return false
  switch (event.audienceKind) {
    case 'institution':
      return true
    case 'grade':
      return event.audienceIds.some((id) => viewer.grades.has(Number(id)))
    case 'class':
      return event.audienceIds.some((id) => viewer.classIds.has(id))
    case 'group':
      return event.audienceIds.some((id) => viewer.groupIds.has(id))
    default:
      return event.audienceKind satisfies never
  }
}

/** Etkinlik aralığa değiyor mu (günler dahil). */
export const overlapsRange = (
  event: { startDate: string; endDate: string },
  from: string,
  to: string,
) => event.startDate <= to && from <= event.endDate

/**
 * Kurumun tatil günleri (K-545): yayımlanmış, tüm kurum hedefli `holiday` etkinlikleri. Kademe ya
 * da sınıfa özel tatil kurumun tatili sayılmaz. Başlangıç sırasıyla.
 */
export function institutionHolidays<
  T extends {
    kind: SchoolEventKind
    status: SchoolEventStatus
    audienceKind: SchoolEventAudience
    title: string
    startDate: string
    endDate: string
  },
>(events: readonly T[]): { title: string; startDate: string; endDate: string }[] {
  return events
    .filter(
      (event) =>
        event.kind === 'holiday' &&
        event.status === 'published' &&
        event.audienceKind === 'institution',
    )
    .map(({ title, startDate, endDate }) => ({ title, startDate, endDate }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title, 'tr'))
}

/** Gösterim sırası: başlangıç günü, tüm gün önce, saat, başlık. */
export function compareSchoolEvents(
  a: Pick<SchoolEventFields, 'startDate' | 'allDay' | 'startTime' | 'title'>,
  b: Pick<SchoolEventFields, 'startDate' | 'allDay' | 'startTime' | 'title'>,
): number {
  return (
    a.startDate.localeCompare(b.startDate) ||
    Number(b.allDay) - Number(a.allDay) ||
    (a.startTime ?? '').localeCompare(b.startTime ?? '') ||
    a.title.localeCompare(b.title, 'tr')
  )
}

/**
 * Etkinliğin UTC anları: tüm günde başlangıç gününün İstanbul gece yarısı ve bitiş gününden sonraki
 * günün gece yarısı (bitiş hariç), saatlide İstanbul duvar saatinin anı.
 */
export function schoolEventInstants(
  event: Pick<SchoolEventFields, 'allDay' | 'startDate' | 'endDate' | 'startTime' | 'endTime'>,
): { startsAt: string; endsAt: string } {
  if (event.allDay || event.startTime === null || event.endTime === null)
    return {
      startsAt: istanbulInstant(event.startDate, '00:00'),
      endsAt: istanbulInstant(addDays(event.endDate, 1), '00:00'),
    }
  return {
    startsAt: istanbulInstant(event.startDate, event.startTime),
    endsAt: istanbulInstant(event.endDate, event.endTime),
  }
}

// --- iCal (RFC 5545) -----------------------------------------------------------------------------

export type IcsTiming =
  | { allDay: true; startDate: string; endDate: string }
  | { allDay: false; startsAt: string; endsAt: string | null }

export interface IcsEvent {
  uid: string
  summary: string
  category: string
  location: string | null
  description: string | null
  cancelled: boolean
  /** Kayıt sürümü; takvim uygulaması değişikliği bununla tanır. */
  sequence: number
  lastModifiedAt: string
  timing: IcsTiming
}

/** Metin değeri kaçışı (RFC 5545 §3.3.11). */
export function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

const encoder = new TextEncoder()

/** Satırı 75 sekizliyi aşmayacak biçimde katlar; çok baytlı karakter bölünmez (RFC 5545 §3.1). */
export function foldIcsLine(line: string): string {
  const parts: string[] = []
  let current = ''
  let size = 0
  for (const char of line) {
    const bytes = encoder.encode(char).length
    const limit = parts.length === 0 ? 75 : 74
    if (size + bytes > limit) {
      parts.push(current)
      current = ''
      size = 0
    }
    current += char
    size += bytes
  }
  parts.push(current)
  return parts.join('\r\n ')
}

const icsDate = (day: string) => day.replace(/-/g, '')
const icsInstant = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')

/**
 * Takvim dosyası (RFC 5545): `VCALENDAR` + etkinlik başına `VEVENT`. Tüm gün etkinlik `VALUE=DATE`
 * (bitiş hariç, son günden sonraki gün), saatli etkinlik UTC anıdır. İptal edilen etkinlik
 * `STATUS:CANCELLED` ile gider ki takvim uygulaması eski kaydı silsin. Satırlar CRLF ve katlıdır.
 */
export function schoolCalendarIcs(input: {
  calendarName: string
  now: Date
  events: readonly IcsEvent[]
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kampus//Okul Takvimi//TR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(input.calendarName)}`,
    'X-WR-TIMEZONE:Europe/Istanbul',
  ]
  const stamp = icsInstant(input.now.toISOString())
  for (const event of input.events) {
    lines.push('BEGIN:VEVENT', `UID:${event.uid}`, `DTSTAMP:${stamp}`)
    if (event.timing.allDay) {
      lines.push(
        `DTSTART;VALUE=DATE:${icsDate(event.timing.startDate)}`,
        `DTEND;VALUE=DATE:${icsDate(addDays(event.timing.endDate, 1))}`,
      )
    } else {
      lines.push(`DTSTART:${icsInstant(event.timing.startsAt)}`)
      if (event.timing.endsAt !== null) lines.push(`DTEND:${icsInstant(event.timing.endsAt)}`)
    }
    lines.push(`SUMMARY:${icsText(event.summary)}`, `CATEGORIES:${icsText(event.category)}`)
    if (event.location !== null) lines.push(`LOCATION:${icsText(event.location)}`)
    if (event.description !== null) lines.push(`DESCRIPTION:${icsText(event.description)}`)
    lines.push(
      `STATUS:${event.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
      `SEQUENCE:${String(event.sequence)}`,
      `LAST-MODIFIED:${icsInstant(event.lastModifiedAt)}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`
}
