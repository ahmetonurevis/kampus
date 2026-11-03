// Veli "Akademik takip" ekranının (`screens/ParentTracking.tsx`) saf hesapları: sekmeler,
// devamsızlık özeti ve satırı, haftalık ders programı. Çocuk kapsamı sunucudadır (veli yalnız bağlı
// çocuklarının kaydını okur); buradaki süzgeçler yalnız gösterimi sadeleştirir. Web karşılıkları
// `apps/web-react/src/pages/academic/{parent-tracking-tabs,academic-rows,schedule-model}.ts`.
import { dateLabel, dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import type { Lesson } from '@kampus/react-shared/lessons.ts'
import { isModuleOpen } from './session-state.ts'

// --- Sekmeler -------------------------------------------------------------------------------

export type ParentTab = 'notlar' | 'devamsizlik' | 'program' | 'odevler'

type TabEntry = { value: ParentTab; label: string; modules: readonly string[] }

/**
 * Web Akademik Takip sekmeleriyle aynı sıra ve adlar (quiz ve beceri görevleri telefonda henüz
 * yok). Ders programı `planning` ve `academic`, ödev `learning` modülüne bağlıdır; kapalı modülün
 * sekmesi çizilmez (uçları 403 `module_disabled` döner).
 */
const TABS: readonly TabEntry[] = [
  { value: 'notlar', label: 'Notlar', modules: ['academic'] },
  { value: 'devamsizlik', label: 'Devamsızlık', modules: ['academic'] },
  { value: 'program', label: 'Ders programı', modules: ['planning', 'academic'] },
  { value: 'odevler', label: 'Ödevler', modules: ['learning'] },
]

export const DEFAULT_PARENT_TAB: ParentTab = 'notlar'

/** Açık modüllere göre görünen sekmeler. */
export function parentTabs(
  modules: Record<string, boolean>,
): { value: ParentTab; label: string }[] {
  return TABS.filter((tab) => tab.modules.every((module) => isModuleOpen(modules, module))).map(
    ({ value, label }) => ({ value, label }),
  )
}

/** İstenen sekme görünenlerden değilse (modül kapandı) ilk görünen sekme. */
export function resolveParentTab(
  requested: ParentTab,
  tabs: readonly { value: ParentTab }[],
): ParentTab {
  return tabs.find((tab) => tab.value === requested)?.value ?? tabs[0]?.value ?? DEFAULT_PARENT_TAB
}

// --- Devamsızlık ----------------------------------------------------------------------------

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

const STATUS_LABELS = {
  present: 'Geldi',
  absent: 'Gelmedi',
  late: 'Geç geldi',
  excused: 'Mazeretli',
} as const satisfies Record<AttendanceStatus, string>

export const attendanceLabel = (status: string): string =>
  status in STATUS_LABELS ? STATUS_LABELS[status as AttendanceStatus] : status

export const isAttendanceStatus = (value: string): value is AttendanceStatus =>
  (ATTENDANCE_STATUSES as readonly string[]).includes(value)

export const NO_REASON = 'Kayıtlı mazeret yok'

type AttendanceFields = {
  date?: string
  status?: string
  lateMinutes?: number | null
  reason?: string | null
}

export type AttendanceCounts = Record<AttendanceStatus, number>

/** Katılım özeti kayıtlardan hesaplanır, saklanmaz; bilinmeyen durum sayıma girmez. */
export function attendanceCounts(records: readonly Pick<AttendanceFields, 'status'>[]) {
  const counts: AttendanceCounts = { present: 0, absent: 0, late: 0, excused: 0 }
  for (const record of records)
    if (record.status !== undefined && isAttendanceStatus(record.status)) counts[record.status] += 1
  return counts
}

export type AttendanceView = {
  title: string
  status: string
  subtitle: string
}

/**
 * Yoklama satırı: gün (Europe/Istanbul), katılım durumu ve "12 dk · mazeret notu". Geç kalma
 * dakikası yalnız "Geç geldi" kaydında gösterilir (DOM-AKD-036); mazeret notu yoksa genel metin.
 */
export function attendanceView(record: AttendanceFields): AttendanceView {
  const minutes =
    record.status === 'late' && typeof record.lateMinutes === 'number'
      ? `${record.lateMinutes} dk`
      : undefined
  return {
    title: record.date ? dateLabel(record.date, { year: 'numeric', weekday: 'long' }) : 'Ders günü',
    status: attendanceLabel(record.status ?? ''),
    subtitle: [minutes, record.reason?.trim() || NO_REASON].filter(Boolean).join(' · '),
  }
}

// --- Haftalık ders programı -----------------------------------------------------------------

const DAY_MS = 86_400_000
const toUtc = (key: string) => new Date(`${key}T00:00:00.000Z`)
const toKey = (date: Date) => date.toISOString().slice(0, 10)

/** Gün anahtarı (`YYYY-MM-DD`, Europe/Istanbul takvimi) artı gün sayısı. */
export const addDays = (key: string, days: number): string =>
  toKey(new Date(toUtc(key).getTime() + days * DAY_MS))

/** Gün anahtarının haftasının pazartesisi. */
export function weekStart(key: string): string {
  const weekday = toUtc(key).getUTCDay()
  return addDays(key, -((weekday + 6) % 7))
}

export const weekDays = (start: string): string[] =>
  Array.from({ length: 7 }, (_, index) => addDays(start, index))

/** Sunucu `dateFrom`/`dateTo` aralığı: haftanın pazartesisi ile pazarı, iki uç dahil. */
export const weekRange = (start: string) => ({ dateFrom: start, dateTo: addDays(start, 6) })

const noon = (key: string) => `${key}T12:00:00.000Z`

/** "2 Kasım – 8 Kasım 2026". */
export function weekTitle(start: string): string {
  return `${dateLabel(noon(start), { day: 'numeric', month: 'long' })} – ${dateLabel(
    noon(addDays(start, 6)),
    { day: 'numeric', month: 'long', year: 'numeric' },
  )}`
}

type LessonFields = Pick<
  Lesson,
  | 'id'
  | 'subjectId'
  | 'title'
  | 'teacherId'
  | 'originalTeacherId'
  | 'date'
  | 'duration'
  | 'room'
  | 'status'
>

export type LessonView = {
  id: string
  title: string
  time: string
  subtitle: string
}

export type ScheduleDay = { day: string; label: string; lessons: LessonView[] }

const MINUTE_MS = 60_000

/**
 * Haftanın günleri ve dersleri. İptal edilen ders günlük programda görünmez (sunucu zaten
 * `cancelled=false` döndürür, istemci eski önbelleğe karşı yine süzer); dersi olmayan gün
 * listelenmez. Ders adı kaydın başlığı, yoksa ders adıdır. Yedek atanmışsa "Yedek: Ad" yazılır,
 * yedek kaydı okunamıyorsa genel metin (gerekçe gösterilmez, DOM-YTK-068).
 */
export function weekSchedule(
  lessons: readonly LessonFields[],
  start: string,
  names: {
    subjects: ReadonlyMap<string, string>
    teachers: ReadonlyMap<string, string>
  },
): ScheduleDay[] {
  const visible = lessons.filter((lesson) => lesson.status !== 'cancelled')
  return weekDays(start).flatMap((day) => {
    const rows = visible
      .filter((lesson) => dayKey(lesson.date) === day)
      .sort(
        (left, right) =>
          Date.parse(left.date) - Date.parse(right.date) || left.id.localeCompare(right.id),
      )
      .map((lesson): LessonView => {
        const teacher = names.teachers.get(lesson.teacherId)
        const who = lesson.originalTeacherId
          ? teacher
            ? `Yedek: ${teacher}`
            : 'Yedek öğretmen atandı'
          : teacher
        const end = Date.parse(lesson.date) + lesson.duration * MINUTE_MS
        return {
          id: lesson.id,
          title: lesson.title || names.subjects.get(lesson.subjectId) || 'Ders',
          time: `${timeLabel(lesson.date)}–${timeLabel(end)}`,
          subtitle: [who, lesson.room ? `Derslik ${lesson.room}` : undefined]
            .filter(Boolean)
            .join(' · '),
        }
      })
    return rows.length
      ? [
          {
            day,
            label: dateLabel(noon(day), { weekday: 'long', day: 'numeric', month: 'long' }),
            lessons: rows,
          },
        ]
      : []
  })
}
