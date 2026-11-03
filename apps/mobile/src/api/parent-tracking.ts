// Veli "Akademik takip" ekranının (`screens/ParentTracking.tsx`) saf hesapları: sekmeler,
// devamsızlık özeti ve satırı, haftalık ders programı. Çocuk kapsamı sunucudadır (veli yalnız bağlı
// çocuklarının kaydını okur); buradaki süzgeçler yalnız gösterimi sadeleştirir. Web karşılıkları
// `apps/web-react/src/pages/academic/{parent-tracking-tabs,academic-rows,schedule-model}.ts`.
import { dateLabel, dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import type { Lesson } from '@kampus/react-shared/lessons.ts'
import { isModuleOpen } from './session-state.ts'

// --- Sekmeler -------------------------------------------------------------------------------

export type ParentTab = 'notlar' | 'devamsizlik' | 'program' | 'odevler' | 'quizler' | 'gorevler'

type TabEntry = { value: ParentTab; label: string; modules: readonly string[] }

/**
 * Web Akademik Takip sekmeleriyle aynı sıra ve adlar (`parent-tracking-tabs.ts`). Ders programı
 * `planning` ve `academic`; ödev, quiz ve beceri görevleri `learning` modülüne bağlıdır (uçları
 * kapalıyken 403 `module_disabled` döner); kapalı modülün sekmesi çizilmez. Web quiz sekmesini
 * modül denetimi olmadan çizer ama `/quizzes` ucu `learning` ister; telefonda sekme de ona bağlıdır.
 */
const TABS: readonly TabEntry[] = [
  { value: 'notlar', label: 'Notlar', modules: ['academic'] },
  { value: 'devamsizlik', label: 'Devamsızlık', modules: ['academic'] },
  { value: 'program', label: 'Ders programı', modules: ['planning', 'academic'] },
  { value: 'odevler', label: 'Ödev durumu', modules: ['learning'] },
  { value: 'quizler', label: 'Quiz sonuçları', modules: ['learning'] },
  { value: 'gorevler', label: 'Beceri görevleri', modules: ['learning'] },
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

/** Kendi alanı olmayan ad (`toString`, `constructor`) durum sayılmaz. */
export const isAttendanceStatus = (value: string): value is AttendanceStatus =>
  Object.hasOwn(STATUS_LABELS, value)

export const attendanceLabel = (status: string): string =>
  isAttendanceStatus(status) ? STATUS_LABELS[status] : status

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

// --- Devamsızlık tarih aralığı --------------------------------------------------------------

export const ATTENDANCE_RANGES = ['term', 'last30', 'all'] as const
export type AttendanceRange = (typeof ATTENDANCE_RANGES)[number]
export const DEFAULT_ATTENDANCE_RANGE: AttendanceRange = 'all'

const RANGE_LABELS = {
  term: 'Bu dönem',
  last30: 'Son 30 gün',
  all: 'Tümü',
} as const satisfies Record<AttendanceRange, string>

export const attendanceRangeLabel = (range: AttendanceRange): string => RANGE_LABELS[range]

/** Bugünün (Europe/Istanbul) dönemi; tatilde ve yıl dışında `null` (`GET /academic-years/current`). */
export type CurrentTerm = { startDate: string; endDate: string } | null

/** "Bu dönem" yalnız günün dönemi varken sunulur; diğer aralıklar her zaman. */
export function attendanceRanges(term: CurrentTerm): AttendanceRange[] {
  return ATTENDANCE_RANGES.filter((range) => range !== 'term' || term !== null)
}

/** Seçili aralık sunulmuyorsa (dönem bitti) varsayılan aralığa dönülür. */
export const resolveAttendanceRange = (
  range: AttendanceRange,
  term: CurrentTerm,
): AttendanceRange => (attendanceRanges(term).includes(range) ? range : DEFAULT_ATTENDANCE_RANGE)

export const isAttendanceRange = (value: string): value is AttendanceRange =>
  Object.hasOwn(RANGE_LABELS, value)

/**
 * Sunucu `dateFrom`/`dateTo` süzgeci (Europe/Istanbul günü, iki uç dahil). "Son 30 gün" bugün ve
 * önceki 29 gündür; "Bu dönem" günün dönemidir (dönem yoksa süzgeç uygulanmaz, `{}`); "Tümü" süzgeçsizdir.
 */
export function attendanceRangeFilters(
  range: AttendanceRange,
  today: string,
  term: CurrentTerm,
): { dateFrom?: string; dateTo?: string } {
  if (range === 'last30') return { dateFrom: addDays(today, -29), dateTo: today }
  if (range === 'term' && term) return { dateFrom: term.startDate, dateTo: term.endDate }
  return {}
}

/**
 * Devamsızlık listesinin tek süzgeç alanı (`ListState.filter`) hem durumu hem aralığı taşır;
 * böylece ikisinden biri değişince sayfa `withFilter` ile başa döner. Varsayılan ikili boş metindir.
 */
export type AttendanceFilter = { status: AttendanceStatus | ''; range: AttendanceRange }

export const encodeAttendanceFilter = ({ status, range }: AttendanceFilter): string =>
  status === '' && range === DEFAULT_ATTENDANCE_RANGE ? '' : `${status}|${range}`

/** Bilinmeyen parça yok sayılır (eski ya da bozuk bellek değeri varsayılana düşer). */
export function decodeAttendanceFilter(filter: string): AttendanceFilter {
  const [status = '', range = ''] = filter.split('|')
  return {
    status: isAttendanceStatus(status) ? status : '',
    range: isAttendanceRange(range) ? range : DEFAULT_ATTENDANCE_RANGE,
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

/** Etüt satırının ayrıntı penceresi için alanları (web `ScheduleTutorPanel`). */
export type TutoringDetail = {
  subject: string
  topic: string
  time: string
  duration: number
  room: string
  teacher: string
  studentCount: number
}

export type LessonView = {
  id: string
  title: string
  time: string
  subtitle: string
  /** `tutoring`: kazanım etütü ("Etüt" etiketiyle çizilir, dokununca ayrıntı açar). */
  kind: 'lesson' | 'tutoring'
  tutoring?: TutoringDetail
}

export type ScheduleDay = { day: string; label: string; lessons: LessonView[] }

/** Etüt kaydının program için kullandığı alanlar (`State['tutorSessions']`). */
export type TutorSessionFields = {
  id: string
  date: string
  duration: number
  subjectId: string
  topic: string
  teacherId: string
  room: string
  status: string
  studentIds: readonly string[]
}

export const TUTORING_LABEL = 'Etüt'
const TUTORING_CANCELLED = 'İptal'

const MINUTE_MS = 60_000

type ScheduleNames = {
  subjects: ReadonlyMap<string, string>
  teachers: ReadonlyMap<string, string>
}

const timeRange = (date: string, duration: number) =>
  `${timeLabel(date)}–${timeLabel(Date.parse(date) + duration * MINUTE_MS)}`

/**
 * Kazanım etüdünün program satırı (web `schedule-tutoring.ts`): başlık "Etüt · <ders> · <konu>",
 * alt metin "<n> öğrenci · Derslik <x>". Velide `studentId` seçili çocuktur: kayıt çocuğu içermiyorsa
 * satır yoktur, öğrenci sayısı yalnız o çocuğu sayar (sunucu kapsamı zaten daraltır; ikinci kat
 * velinin birden çok çocuğu arasındaki seçimi uygular). İptal edilen etüt görünmez.
 */
export function tutoringView(
  record: TutorSessionFields,
  studentId: string,
  names: ScheduleNames,
): LessonView | null {
  if (record.status === TUTORING_CANCELLED) return null
  if (!record.studentIds.includes(studentId)) return null
  const subject = names.subjects.get(record.subjectId) || record.subjectId
  const teacher = names.teachers.get(record.teacherId) ?? ''
  return {
    id: record.id,
    kind: 'tutoring',
    title: `${TUTORING_LABEL} · ${subject} · ${record.topic}`,
    time: timeRange(record.date, record.duration),
    subtitle: `1 öğrenci · Derslik ${record.room}`,
    tutoring: {
      subject,
      topic: record.topic,
      time: timeRange(record.date, record.duration),
      duration: record.duration,
      room: record.room,
      teacher,
      studentCount: 1,
    },
  }
}

/**
 * Haftanın günleri, dersleri ve (verildiyse) kazanım etütleri. İptal edilen ders günlük programda
 * görünmez (sunucu zaten `cancelled=false` döndürür, istemci eski önbelleğe karşı yine süzer);
 * dersi ve etüdü olmayan gün listelenmez. Ders adı kaydın başlığı, yoksa ders adıdır. Yedek
 * atanmışsa "Yedek: Ad" yazılır, yedek kaydı okunamıyorsa genel metin (gerekçe gösterilmez,
 * DOM-YTK-068). Gün içinde ders ve etüt başlangıç saatine göre karışık sıralanır (IST-096).
 */
export function weekSchedule(
  lessons: readonly LessonFields[],
  start: string,
  names: ScheduleNames,
  tutoring: { sessions: readonly TutorSessionFields[]; studentId: string } = {
    sessions: [],
    studentId: '',
  },
): ScheduleDay[] {
  type Entry = { day: string; at: number; view: LessonView }
  const entries: Entry[] = [
    ...lessons
      .filter((lesson) => lesson.status !== 'cancelled')
      .map((lesson): Entry => {
        const teacher = names.teachers.get(lesson.teacherId)
        const who = lesson.originalTeacherId
          ? teacher
            ? `Yedek: ${teacher}`
            : 'Yedek öğretmen atandı'
          : teacher
        return {
          day: dayKey(lesson.date),
          at: Date.parse(lesson.date),
          view: {
            id: lesson.id,
            kind: 'lesson',
            title: lesson.title || names.subjects.get(lesson.subjectId) || 'Ders',
            time: timeRange(lesson.date, lesson.duration),
            subtitle: [who, lesson.room ? `Derslik ${lesson.room}` : undefined]
              .filter(Boolean)
              .join(' · '),
          },
        }
      }),
    ...tutoring.sessions.flatMap((record): Entry[] => {
      const view = tutoringView(record, tutoring.studentId, names)
      return view ? [{ day: dayKey(record.date), at: Date.parse(record.date), view }] : []
    }),
  ]
  return weekDays(start).flatMap((day) => {
    const rows = entries
      .filter((entry) => entry.day === day)
      .sort((left, right) => left.at - right.at || left.view.id.localeCompare(right.view.id))
      .map((entry) => entry.view)
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
