import { z } from 'zod'

import type {
  SchoolCalendarLink,
  SchoolEvent,
  SchoolEventCreateBody,
  SchoolEventUpdateBody,
} from '@kampus/react-shared/use-finance-school-calendar.ts'
import { dateLabel, dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import {
  normalizeSchoolEvent,
  SCHOOL_CALENDAR_LINK_LABELS,
  SCHOOL_EVENT_AUDIENCE_LABELS,
  SCHOOL_EVENT_AUDIENCES,
  SCHOOL_EVENT_CANCEL_REASON_MAX,
  SCHOOL_EVENT_CANCEL_REASON_MIN,
  SCHOOL_EVENT_DESCRIPTION_MAX,
  SCHOOL_EVENT_KIND_LABELS,
  SCHOOL_EVENT_KINDS,
  SCHOOL_EVENT_LOCATION_MAX,
  SCHOOL_EVENT_STATUS_LABELS,
  SCHOOL_EVENT_TITLE_MAX,
  schoolEventCancelSchema,
  schoolEventIssues,
  type SchoolEventFields,
  type SchoolEventStatus,
} from '@kampus/school-core/lib/finance-school-calendar.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import { dayText } from './finance-leave-calendar-view.ts'

/**
 * Okul takvimi sekmesinin saf mantığı (DOM-FIN-163; ON-090; K-544…K-546): etkinlik formunun şeması
 * ve gövdesi, gün hücresi seçimleri ve metinler. Kural core `lib/finance-school-calendar.ts`'tedir;
 * form aynı bütün hâl kurallarını (`schoolEventIssues`) çalıştırır, sunucu yeniden denetler.
 */

export type CalendarView = 'month' | 'week' | 'list'
export const CALENDAR_VIEWS = [
  { value: 'month', label: 'Ay' },
  { value: 'week', label: 'Hafta' },
  { value: 'list', label: 'Liste' },
] as const satisfies readonly { value: CalendarView; label: string }[]

export const KIND_OPTIONS = SCHOOL_EVENT_KINDS.map((value) => ({
  value,
  label: SCHOOL_EVENT_KIND_LABELS[value],
}))
export const AUDIENCE_OPTIONS = SCHOOL_EVENT_AUDIENCES.map((value) => ({
  value,
  label: SCHOOL_EVENT_AUDIENCE_LABELS[value],
}))
/** Kademe seçenekleri (sınıf düzeyi). */
export const GRADE_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1))

// --- Form ----------------------------------------------------------------------------------------

export const eventFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(2, 'Başlığı en az 2 karakterle yazın.')
      .max(
        SCHOOL_EVENT_TITLE_MAX,
        `En çok ${String(SCHOOL_EVENT_TITLE_MAX)} karakter girebilirsiniz.`,
      ),
    kind: z.enum(SCHOOL_EVENT_KINDS, 'Etkinlik türünü seçin.'),
    allDay: z.boolean(),
    startDate: z.string().min(1, 'Başlangıç gününü seçin.'),
    endDate: z.string().min(1, 'Bitiş gününü seçin.'),
    startTime: z.string(),
    endTime: z.string(),
    location: z
      .string()
      .max(
        SCHOOL_EVENT_LOCATION_MAX,
        `Yer en çok ${String(SCHOOL_EVENT_LOCATION_MAX)} karakter olabilir.`,
      ),
    description: z
      .string()
      .max(
        SCHOOL_EVENT_DESCRIPTION_MAX,
        `Açıklama en çok ${String(SCHOOL_EVENT_DESCRIPTION_MAX)} karakter olabilir.`,
      ),
    audienceKind: z.enum(SCHOOL_EVENT_AUDIENCES, 'Hedef kitleyi seçin.'),
    audienceIds: z.array(z.string()),
  })
  .superRefine((values, context) => {
    if (values.startDate === '' || values.endDate === '') return
    for (const issue of schoolEventIssues(eventFields(values)))
      context.addIssue({ code: 'custom', path: [issue.path], message: issue.message })
  })
export type EventFormValues = z.input<typeof eventFormSchema>

/** Form değerlerinden etkinlik alanları: boş saat `null`, tüm günde saat yok. */
function eventFields(values: EventFormValues): SchoolEventFields {
  return normalizeSchoolEvent({
    ...values,
    startTime: values.startTime === '' ? null : values.startTime,
    endTime: values.endTime === '' ? null : values.endTime,
  })
}

/** Yeni etkinliğin varsayılanı: seçilen gün, tüm kurum, 09:00–10:00. */
export function eventDefaults(day: string): EventFormValues {
  return {
    title: '',
    kind: 'other',
    allDay: false,
    startDate: day,
    endDate: day,
    startTime: '09:00',
    endTime: '10:00',
    location: '',
    description: '',
    audienceKind: 'institution',
    audienceIds: [],
  }
}

export function eventValues(event: SchoolEvent): EventFormValues {
  return {
    title: event.title,
    kind: event.kind,
    allDay: event.allDay,
    startDate: event.startDate,
    endDate: event.endDate,
    startTime: event.startTime ?? '',
    endTime: event.endTime ?? '',
    location: event.location ?? '',
    description: event.description ?? '',
    audienceKind: event.audienceKind,
    audienceIds: [...event.audienceIds],
  }
}

export function createBody(values: EventFormValues): SchoolEventCreateBody {
  const fields = eventFields(values)
  return { ...fields }
}

/**
 * Düzenleme gövdesi: yalnız değişen alanlar (sunucu yine bütün hâli doğrular). Hiçbiri değişmediyse
 * `null`.
 */
export function updateBody(
  event: SchoolEvent,
  values: EventFormValues,
): SchoolEventUpdateBody | null {
  const next = eventFields(values)
  const before = eventFields(eventValues(event))
  const body: Record<string, unknown> = {}
  for (const key of Object.keys(next) as (keyof SchoolEventFields)[]) {
    const changed =
      key === 'audienceIds'
        ? next.audienceIds.join('|') !== before.audienceIds.join('|')
        : next[key] !== before[key]
    if (changed) body[key] = next[key]
  }
  return Object.keys(body).length === 0 ? null : (body as SchoolEventUpdateBody)
}

/** Sunucu alan yolu → form alanı. */
export const formField = (name: string): keyof EventFormValues | null =>
  name in eventDefaults('2026-01-01') ? (name as keyof EventFormValues) : null

export const cancelFormSchema = schoolEventCancelSchema
export const CANCEL_REASON_LIMITS = {
  min: SCHOOL_EVENT_CANCEL_REASON_MIN,
  max: SCHOOL_EVENT_CANCEL_REASON_MAX,
}

// --- Takvim --------------------------------------------------------------------------------------

/** O güne değen etkinlikler. */
export const eventsOn = <T extends Pick<SchoolEvent, 'startDate' | 'endDate'>>(
  events: readonly T[],
  day: string,
) => events.filter((event) => event.startDate <= day && day <= event.endDate)

/** Bağlantının İstanbul günleri: çıkıştan dönüşe (biletli etkinlikte tek gün). */
export const linkDays = (link: Pick<SchoolCalendarLink, 'startsAt' | 'endsAt'>) => ({
  startDate: dayKey(link.startsAt),
  endDate: dayKey(link.endsAt ?? link.startsAt),
})

export const linksOn = <T extends Pick<SchoolCalendarLink, 'startsAt' | 'endsAt'>>(
  links: readonly T[],
  day: string,
) =>
  links.filter((link) => {
    const days = linkDays(link)
    return days.startDate <= day && day <= days.endDate
  })

/** Dar ekran listesi: yalnız etkinliği ya da bağlantısı olan günler. */
export const busyDays = (
  days: readonly string[],
  data: { events: readonly SchoolEvent[]; links: readonly SchoolCalendarLink[] },
) =>
  days.filter((day) => eventsOn(data.events, day).length > 0 || linksOn(data.links, day).length > 0)

// --- Metinler ------------------------------------------------------------------------------------

export const kindText = (kind: SchoolEvent['kind']) => SCHOOL_EVENT_KIND_LABELS[kind]
export const statusText = (status: SchoolEventStatus) => SCHOOL_EVENT_STATUS_LABELS[status]
export const statusTone = (status: SchoolEventStatus): BadgeTone =>
  status === 'published' ? 'green' : status === 'cancelled' ? 'red' : 'amber'
export const linkSourceText = (source: SchoolCalendarLink['source']) =>
  SCHOOL_CALENDAR_LINK_LABELS[source]

/** `29 Ekim 2026` ya da `9 Kasım – 13 Kasım 2026`. */
export function eventDateText(event: Pick<SchoolEvent, 'startDate' | 'endDate'>) {
  return event.startDate === event.endDate
    ? dayText(event.startDate, true)
    : `${dayText(event.startDate)} – ${dayText(event.endDate, true)}`
}

/** `Tüm gün` ya da `09:30–11:00`. */
export const eventTimeText = (event: Pick<SchoolEvent, 'allDay' | 'startTime' | 'endTime'>) =>
  event.allDay ? 'Tüm gün' : `${event.startTime ?? ''}–${event.endTime ?? ''}`

/** `Tüm kurum` ya da `Sınıf: 7-A, 7-B`. */
export const audienceText = (event: Pick<SchoolEvent, 'audienceKind' | 'audienceLabels'>) =>
  event.audienceKind === 'institution'
    ? SCHOOL_EVENT_AUDIENCE_LABELS.institution
    : `${SCHOOL_EVENT_AUDIENCE_LABELS[event.audienceKind]}: ${event.audienceLabels.join(', ')}`

/** Bağlantının zaman metni: `20 Eki 08:00 – 20:00` ya da `30 Eki 19:00` (Europe/Istanbul). */
export function linkTimeText(link: Pick<SchoolCalendarLink, 'startsAt' | 'endsAt'>) {
  const start = `${dateLabel(link.startsAt)} ${timeLabel(link.startsAt)}`
  if (link.endsAt === null) return start
  const end =
    dayKey(link.startsAt) === dayKey(link.endsAt)
      ? timeLabel(link.endsAt)
      : `${dateLabel(link.endsAt)} ${timeLabel(link.endsAt)}`
  return `${start} – ${end}`
}

/** Etkinlik bitti mi (Europe/Istanbul bugünü). */
export const eventEnded = (event: Pick<SchoolEvent, 'endDate'>, today: string) =>
  event.endDate < today
