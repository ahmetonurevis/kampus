// İzin takvimi görünümü ve ayar formu (DOM-FIN-123; ON-183; K-420…K-422). Takvim pazartesiyle
// başlayan haftalardır; ay görünümü ayın günlerini kapsayan tam haftaları (en çok 6), hafta görünümü
// tek haftayı ister. Gün anahtarları `YYYY-MM-DD`; hesap UTC gün aritmetiğidir (saat dilimi yok).
import type {
  LeaveCalendarEntry,
  LeaveCalendarSettings,
  LeaveCalendarSettingsBody,
} from '@kampus/react-shared/use-finance-leave-calendar.ts'
import type {
  LeaveRequestLessonView,
  LeaveRequestTeacher,
} from '@kampus/react-shared/use-finance-leave-requests.ts'
import {
  LEAVE_CALENDAR_CATEGORY_LABELS,
  LEAVE_CALENDAR_STATUS_LABELS,
  leaveCalendarSettingsSchema,
  leaveConflictText,
  type LeaveConflict,
} from '@kampus/school-core/lib/finance-leave-calendar.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'

export type CalendarMode = 'month' | 'week'
export const CALENDAR_MODES = [
  { value: 'month', label: 'Ay' },
  { value: 'week', label: 'Hafta' },
] as const satisfies readonly { value: CalendarMode; label: string }[]
export const WEEKDAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'] as const
export const WEEKDAY_NAMES = [
  'Pazartesi',
  'Salı',
  'Çarşamba',
  'Perşembe',
  'Cuma',
  'Cumartesi',
  'Pazar',
] as const

const DAY_MS = 86_400_000
const at = (day: string) => Date.parse(`${day}T00:00:00.000Z`)
export const addDays = (day: string, days: number) =>
  new Date(at(day) + days * DAY_MS).toISOString().slice(0, 10)
/** Pazartesi 0 … pazar 6. */
const weekday = (day: string) => (new Date(at(day)).getUTCDay() + 6) % 7
const mondayOf = (day: string) => addDays(day, -weekday(day))
const monthStart = (day: string) => `${day.slice(0, 7)}-01`
function monthEnd(day: string) {
  const [year, month] = day.split('-').map(Number)
  return new Date(Date.UTC(year ?? 1970, month ?? 1, 0)).toISOString().slice(0, 10)
}

const monthFormatter = new Intl.DateTimeFormat('tr-TR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/** Görünümün gün aralığı: ay için ayı kapsayan tam haftalar, hafta için pazartesi–pazar. */
export function calendarRange(mode: CalendarMode, anchor: string) {
  if (mode === 'week') {
    const startDate = mondayOf(anchor)
    return { startDate, endDate: addDays(startDate, 6) }
  }
  const startDate = mondayOf(monthStart(anchor))
  const last = monthEnd(anchor)
  return { startDate, endDate: addDays(last, 6 - weekday(last)) }
}

/** Önceki ya da sonraki ay/hafta (ay görünümünde ayın ilk günü). */
export function shiftAnchor(mode: CalendarMode, anchor: string, direction: -1 | 1) {
  if (mode === 'week') return addDays(mondayOf(anchor), direction * 7)
  const [year, month] = anchor.split('-').map(Number)
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1 + direction, 1))
    .toISOString()
    .slice(0, 10)
}

/** Aralığın haftaları (her biri 7 gün). */
export function calendarWeeks(range: { startDate: string; endDate: string }): string[][] {
  const weeks: string[][] = []
  for (let day = range.startDate; day <= range.endDate; day = addDays(day, 7))
    weeks.push(Array.from({ length: 7 }, (_, index) => addDays(day, index)))
  return weeks
}

/** Başlık: "Kasım 2026" ya da "2 Kas – 8 Kas 2026". */
export function periodTitle(mode: CalendarMode, anchor: string) {
  if (mode === 'month') return monthFormatter.format(new Date(at(monthStart(anchor))))
  const range = calendarRange('week', anchor)
  return `${dayText(range.startDate)} – ${dayText(range.endDate, true)}`
}

export const dayText = (day: string, year = false) =>
  dateLabel(`${day}T09:00:00.000Z`, {
    day: 'numeric',
    month: 'long',
    ...(year ? { year: 'numeric' } : {}),
  })
export const dayLongText = (day: string) =>
  `${dayText(day, true)} ${WEEKDAY_NAMES[weekday(day)] ?? ''}`

export const isWeekend = (day: string) => weekday(day) >= 5

/** O gün izinli kayıtlar. */
export const entriesOn = (entries: readonly LeaveCalendarEntry[], day: string) =>
  entries.filter((entry) => entry.startDate <= day && day <= entry.endDate)

/** Kaydın gösterim adı (K-420): tür adı, "Raporlu" ya da ön büroda "İzinli". */
export const entryLabel = (entry: Pick<LeaveCalendarEntry, 'category' | 'typeLabel'>) =>
  entry.category === 'leave' && entry.typeLabel !== null
    ? entry.typeLabel
    : LEAVE_CALENDAR_CATEGORY_LABELS[entry.category]

/** Kaydın tek satır metni: ad, tür, (bekliyorsa) durum. */
export function entryText(entry: LeaveCalendarEntry) {
  const status = entry.status === 'pending' ? `, ${LEAVE_CALENDAR_STATUS_LABELS.pending}` : ''
  return `${entry.name} (${entryLabel(entry)}${status})`
}

/** O günü kapsayan sınav haftası adı. */
export const examWeekOn = (
  weeks: readonly { label: string; startDate: string; endDate: string }[],
  day: string,
) => weeks.find((week) => week.startDate <= day && day <= week.endDate)?.label ?? null

/** O gün eşiğe ulaşan branşlar ("Matematik: 2"). */
export function busyOn(
  busyDays: readonly { day: string; subjectId: string; count: number }[],
  subjects: readonly { id: string; name: string }[],
  day: string,
) {
  return busyDays
    .filter((item) => item.day === day)
    .map(
      (item) =>
        `${subjects.find((subject) => subject.id === item.subjectId)?.name ?? item.subjectId}: ${String(item.count)} kişi`,
    )
}

/** Dar ekran listesi: yalnız izni, sınav haftası ya da uyarısı olan günler. */
export function agendaDays(
  days: readonly string[],
  data: {
    entries: readonly LeaveCalendarEntry[]
    examWeeks: readonly { label: string; startDate: string; endDate: string }[]
  },
) {
  return days.filter(
    (day) => entriesOn(data.entries, day).length > 0 || examWeekOn(data.examWeeks, day) !== null,
  )
}

// --- Uyarılar ------------------------------------------------------------------------------------

/**
 * Talep formunda sunucu uyarılarına seçilen yedeklerin izin uyarısı eklenir: önizlemede yedek
 * seçilmemiştir, adayın `on_leave` uyarısı seçim anında listeye girer.
 */
export function formConflicts(
  conflicts: readonly LeaveConflict[],
  lessons: readonly LeaveRequestLessonView[],
  choices: Readonly<Record<string, string>>,
  teachers: readonly LeaveRequestTeacher[],
): LeaveConflict[] {
  const substitutes = lessons.flatMap((lesson): LeaveConflict[] => {
    const teacherId = choices[lesson.lessonId] ?? ''
    if (teacherId === '') return []
    const warnings =
      lesson.candidateWarnings.find((item) => item.teacherId === teacherId)?.warnings ?? []
    if (!warnings.includes('on_leave')) return []
    return [
      {
        code: 'substitute_on_leave',
        lessonId: lesson.lessonId,
        startsAt: lesson.startsAt,
        title: lesson.title,
        teacherId,
        teacherName: teachers.find((teacher) => teacher.id === teacherId)?.name ?? teacherId,
      },
    ]
  })
  return [...conflicts, ...substitutes]
}

export const conflictTexts = (conflicts: readonly LeaveConflict[]) =>
  conflicts.map((conflict) => leaveConflictText(conflict))

// --- Ayar formu ----------------------------------------------------------------------------------

export interface ExamWeekRow {
  label: string
  startDate: string
  endDate: string
}
export interface CalendarSettingsFormValues {
  concurrentThreshold: string
  examWeeks: ExamWeekRow[]
}

export const settingsDefaults = (
  settings: Pick<LeaveCalendarSettings, 'concurrentThreshold' | 'examWeeks'>,
): CalendarSettingsFormValues => ({
  concurrentThreshold: String(settings.concurrentThreshold),
  examWeeks: settings.examWeeks.map((week) => ({ ...week })),
})

export type SettingsIssue = { field: string; message: string }

/**
 * Form → gövde; core şemasıyla aynı mesajlarla denetlenir. Hata varsa alan yolu
 * (`concurrentThreshold`, `examWeeks.0.endDate`) ve mesaj listesi döner.
 */
export function settingsBody(
  values: CalendarSettingsFormValues,
): { body: LeaveCalendarSettingsBody } | { issues: SettingsIssue[] } {
  const text = values.concurrentThreshold.trim()
  const threshold = /^\d{1,2}$/.test(text) ? Number(text) : Number.NaN
  if (Number.isNaN(threshold))
    return { issues: [{ field: 'concurrentThreshold', message: 'Eşiği tam sayı olarak girin.' }] }
  const parsed = leaveCalendarSettingsSchema.safeParse({
    concurrentThreshold: threshold,
    examWeeks: values.examWeeks,
  })
  if (parsed.success)
    return {
      body: {
        concurrentThreshold: threshold,
        examWeeks: values.examWeeks.map((week) => ({ ...week, label: week.label.trim() })),
      },
    }
  return {
    issues: parsed.error.issues.map((issue) => ({
      field: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  }
}
