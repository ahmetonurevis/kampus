// Ders programı ekranlarının saf hesapları (IST-094; DOM-YTK-068, DOM-YTK-069): `/lessons`
// satırının görünümü, hafta/gün/liste aralığı, işlem görünürlüğü, form şemaları (core iş akışı
// şemaları) ve yedek öğretmen adayları. Kural sunucudadır; burası kullanıcıya geçersiz işlem ve
// seçenek göstermemek ve sunucu hatasını doğru alana bağlamak içindir.
import { z } from 'zod'
import { subjectsForGrade } from '@kampus/school-core/data/curriculum.ts'
import { dateLabel, dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import { workflowSchemas } from '@kampus/school-core/lib/school-workflows.ts'
import { isApiError, type ApiError } from '@kampus/api-client/errors.ts'
import {
  lessonErrorField,
  type Lesson,
  type LessonCancelledFilter,
  type LessonFormKind,
} from '@kampus/react-shared/lessons.ts'
import { addDays, isDayKey, weekDays, weekStart, type AcademicLookups } from './academic-rows.ts'

export type { Lesson }

// --- Görünüm ve aralık -------------------------------------------------------

export const SCHEDULE_VIEWS = [
  { value: 'hafta', label: 'Haftalık' },
  { value: 'gun', label: 'Günlük' },
  { value: 'liste', label: 'Liste' },
] as const
export type ScheduleViewMode = (typeof SCHEDULE_VIEWS)[number]['value']

export function scheduleViewMode(value: unknown): ScheduleViewMode {
  return SCHEDULE_VIEWS.some((view) => view.value === value) ? (value as ScheduleViewMode) : 'hafta'
}

/** Haftalık ve günlük görünümde aralık seçili günden türer; listede tarih süzgecidir. */
export function scheduleRange(
  view: ScheduleViewMode,
  anchor: string,
  from: string,
  to: string,
): { dateFrom?: string; dateTo?: string } {
  if (view === 'hafta') {
    const start = weekStart(anchor)
    return { dateFrom: start, dateTo: addDays(start, 6) }
  }
  if (view === 'gun') return { dateFrom: anchor, dateTo: anchor }
  return { ...(isDayKey(from) ? { dateFrom: from } : {}), ...(isDayKey(to) ? { dateTo: to } : {}) }
}

/** Liste süzgecinde bitiş başlangıçtan önce (sunucu 400 verirdi; istek atılmaz). */
export const reversedRange = (from: string, to: string) =>
  isDayKey(from) && isDayKey(to) && from > to

/** "İptalleri göster": varsayılan günlük program (iptalsiz); işaretliyse iptal geçmişi de gelir. */
export const cancelledFilter = (show: boolean): LessonCancelledFilter => (show ? 'all' : 'false')

/** Haftalık görünümün başlığı ve günlük görünümün günü. */
export const noon = (key: string) => `${key}T12:00:00.000Z`

export function rangeTitle(view: ScheduleViewMode, anchor: string): string {
  if (view === 'gun') return dateLabel(noon(anchor), { weekday: 'long', year: 'numeric' })
  const start = weekStart(anchor)
  return `${dateLabel(noon(start), { day: 'numeric', month: 'long' })} – ${dateLabel(
    noon(addDays(start, 6)),
    { day: 'numeric', month: 'long', year: 'numeric' },
  )}`
}

// --- Satır görünümü ----------------------------------------------------------

/** `admin`: sınıf ve öğretmen; `teacher`: sınıf; `student`: öğretmen. */
export type ScheduleAudience = 'admin' | 'teacher' | 'student'

export const LESSON_STATUS_LABELS = {
  planned: 'Planlandı',
  substituted: 'Yedek atandı',
  cancelled: 'İptal edildi',
} as const satisfies Record<Lesson['status'], string>

export type ScheduleLesson = {
  id: string
  version: number
  title: string
  className: string
  teacher: string
  /** "Yedek: Ad Soyad" (yedek atanmışsa); gerekçe hiçbir satırda yoktur. */
  substitute: string
  day: string
  time: string
  /** Gösterim tarihi ("1 Aralık 2026 Salı"). */
  dayLabel: string
  duration: number
  room: string
  subtitle: string
  status: Lesson['status']
  statusLabel: string
  cancelled: boolean
  date: string
}

const nameOf = (map: ReadonlyMap<string, { name: string }>, id: string | null) =>
  (id ? map.get(id)?.name : undefined) ?? ''

/**
 * Yedek satırı: yedek atanmışsa dersi veren (`teacherId`) yedektir. Rol yedeğin kaydını
 * göremiyorsa (öğrenci yalnız sınıfının öğretmenlerini görür) ad yerine genel metin yazılır.
 */
export function substituteText(lesson: Lesson, lookups: Pick<AcademicLookups, 'teachers'>) {
  if (!lesson.originalTeacherId) return ''
  const name = nameOf(lookups.teachers, lesson.teacherId)
  return name ? `Yedek: ${name}` : 'Yedek öğretmen atandı'
}

export function scheduleLesson(
  lesson: Lesson,
  lookups: Pick<AcademicLookups, 'classes' | 'teachers' | 'subjects'>,
  audience: ScheduleAudience,
): ScheduleLesson {
  const className = nameOf(lookups.classes, lesson.classId)
  const teacher = nameOf(lookups.teachers, lesson.teacherId)
  const who =
    audience === 'admin'
      ? [className, teacher]
      : audience === 'teacher'
        ? [className]
        : [lesson.originalTeacherId ? '' : teacher]
  return {
    id: lesson.id,
    version: lesson.version,
    title: lesson.title ?? lookups.subjects.get(lesson.subjectId)?.name ?? 'Ders',
    className,
    teacher,
    substitute: substituteText(lesson, lookups),
    day: dayKey(lesson.date),
    time: timeLabel(lesson.date),
    dayLabel: dateLabel(lesson.date, { weekday: 'long', year: 'numeric' }),
    duration: lesson.duration,
    room: lesson.room,
    subtitle: [...who, `Derslik ${lesson.room}`].filter(Boolean).join(' · '),
    status: lesson.status,
    statusLabel: LESSON_STATUS_LABELS[lesson.status],
    cancelled: lesson.status === 'cancelled',
    date: lesson.date,
  }
}

/**
 * Haftanın (ya da tek günün) günleri → o günün dersleri, saat sırasıyla. İptal edilen ders
 * günlük programda görünmez (iş kuralı); yalnız yönetici "İptalleri göster" ile görür.
 */
export function scheduleByDay(
  lessons: readonly ScheduleLesson[],
  days: readonly string[],
  showCancelled = false,
): Map<string, ScheduleLesson[]> {
  const map = new Map(days.map((key) => [key, [] as ScheduleLesson[]]))
  for (const lesson of lessons) {
    if (lesson.cancelled && !showCancelled) continue
    map.get(lesson.day)?.push(lesson)
  }
  for (const list of map.values()) list.sort((left, right) => left.date.localeCompare(right.date))
  return map
}

export const viewDays = (view: ScheduleViewMode, anchor: string): string[] =>
  view === 'gun' ? [anchor] : weekDays(weekStart(anchor))

/** CSV hücreleri: ekrandaki metinle aynı. */
export function scheduleCsvRow(row: ScheduleLesson) {
  return {
    dayLabel: row.dayLabel,
    time: row.time,
    title: row.title,
    className: row.className,
    teacher: row.teacher,
    substitute: row.substitute,
    room: row.room,
    duration: row.duration,
    statusLabel: row.statusLabel,
  }
}

// --- İşlemler ----------------------------------------------------------------

/** Başlamış ya da geçmiş ders (core `requireUpcomingLesson`: başlangıç ≤ şimdi). */
export const isPastLesson = (lesson: Pick<Lesson, 'date'>, now: string) =>
  Date.parse(lesson.date) <= Date.parse(now)

export type LessonActions = { edit: boolean; substitute: boolean; cancel: boolean }
const NO_ACTIONS: LessonActions = { edit: false, substitute: false, cancel: false }

/**
 * Yönetici, iptal edilmemiş ve henüz başlamamış derste düzenler, yedek atar ve iptal eder
 * (DOM-YTK-069). Diğer roller salt okur; karar sunucudadır (403/422).
 */
export function lessonActions(
  lesson: Pick<Lesson, 'date' | 'status'>,
  canManage: boolean,
  now: string,
): LessonActions {
  if (!canManage || lesson.status === 'cancelled' || isPastLesson(lesson, now)) return NO_ACTIONS
  return { edit: true, substitute: true, cancel: true }
}

// --- Formlar -----------------------------------------------------------------

const ISTANBUL_OFFSET = '+03:00'
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

/** `datetime-local` değeri (Europe/Istanbul, sabit +03:00) → ISO 8601 UTC; geçersizse olduğu gibi. */
export function istanbulToIso(value: string): string {
  if (!LOCAL_DATE_TIME.test(value)) return value
  const time = Date.parse(`${value}:00${ISTANBUL_OFFSET}`)
  return Number.isFinite(time) ? new Date(time).toISOString() : value
}

/** ISO an → `datetime-local` değeri (Europe/Istanbul). */
export function isoToIstanbul(value: string): string {
  if (!Number.isFinite(Date.parse(value))) return ''
  return `${dayKey(value)}T${timeLabel(value)}`
}

const coreLesson = workflowSchemas.lesson

/**
 * Ders formu: core `lesson` şeması; yalnız başlangıç formda yerel saat olarak girilir ve ISO'ya
 * çevrilip core kuralıyla doğrulanır.
 */
export const lessonFormSchema = coreLesson.extend({
  date: z
    .string()
    .trim()
    .min(1, 'Ders başlangıcını seçin.')
    .transform(istanbulToIso)
    .pipe(coreLesson.shape.date),
})
export type LessonFormValues = z.input<typeof lessonFormSchema>
export type LessonFormOutput = z.output<typeof lessonFormSchema>

export const substituteFormSchema = workflowSchemas.substitute
export type SubstituteFormValues = z.input<typeof substituteFormSchema>
export const cancelFormSchema = workflowSchemas['lesson-cancel']
export type CancelFormValues = z.input<typeof cancelFormSchema>

/** Gerekçe sınırı core şemasından (denetim kaydı en çok 500 karakter; DOM-YTK-069). */
export const REASON_MAX_LENGTH = cancelFormSchema.shape.reason.maxLength ?? 500

export function lessonFormDefaults(lesson?: Lesson): LessonFormValues {
  return {
    classId: lesson?.classId ?? '',
    subjectId: lesson?.subjectId ?? '',
    teacherId: lesson?.teacherId ?? '',
    date: lesson ? isoToIstanbul(lesson.date) : '',
    duration: lesson?.duration ?? 40,
    room: lesson?.room ?? '',
  }
}

/**
 * Düzenlemede yalnız değişen alanlar gider (`PATCH` kısmidir). Yedek atanmış derste öğretmen
 * alanı formda kilitlidir; değişmediği için gövdeye girmez (`lesson_has_substitution` önlenir).
 */
export function changedLessonFields(
  lesson: Lesson,
  values: LessonFormOutput,
): Partial<LessonFormOutput> {
  const changed: Partial<LessonFormOutput> = {}
  if (values.classId !== lesson.classId) changed.classId = values.classId
  if (values.subjectId !== lesson.subjectId) changed.subjectId = values.subjectId
  if (values.teacherId !== lesson.teacherId) changed.teacherId = values.teacherId
  if (Date.parse(values.date) !== Date.parse(lesson.date)) changed.date = values.date
  if (values.duration !== lesson.duration) changed.duration = values.duration
  if (values.room !== lesson.room) changed.room = values.room
  return changed
}

export type Option = { value: string; label: string }

type FormLookups = Pick<AcademicLookups, 'classes' | 'teachers' | 'subjects' | 'branches'>

/** Aktif sınıflar: "7-A · Kadıköy Kampüsü". */
export function classOptions(lookups: FormLookups): Option[] {
  return [...lookups.classes.values()]
    .filter((item) => item.isActive)
    .map((item) => ({
      value: item.id,
      label: [item.name, lookups.branches.get(item.branchId)?.name].filter(Boolean).join(' · '),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'tr'))
}

/** Sınıf düzeyinin dersleri (müfredat); sınıf seçilmeden boştur. */
export function subjectOptions(classId: string, lookups: FormLookups): Option[] {
  const grade = lookups.classes.get(classId)?.grade
  if (grade === undefined) return []
  return subjectsForGrade(grade).map((item) => ({ value: item.id, label: item.name }))
}

/** Sınıfın kampüsündeki, dersin branşındaki aktif öğretmenler (core `lesson_teacher_mismatch`). */
export function teacherOptions(classId: string, subjectId: string, lookups: FormLookups): Option[] {
  const branchId = lookups.classes.get(classId)?.branchId
  if (!branchId || !subjectId) return []
  return [...lookups.teachers.values()]
    .filter((item) => item.isActive && item.branchId === branchId && item.subjectId === subjectId)
    .map((item) => ({ value: item.id, label: item.name }))
    .sort((left, right) => left.label.localeCompare(right.label, 'tr'))
}

/**
 * Yedek adayları: dersin kampüsündeki aktif öğretmenler; dersi veren hariç. Dersin branşı core
 * kuralıdır (`lesson_teacher_mismatch`), bu yüzden aynı branştakiler gösterilir.
 */
export function substituteCandidates(
  lesson: Pick<Lesson, 'classId' | 'subjectId' | 'teacherId'>,
  lookups: FormLookups,
): Option[] {
  return teacherOptions(lesson.classId, lesson.subjectId, lookups).filter(
    (option) => option.value !== lesson.teacherId,
  )
}

/** Başka bir seçim değişince geçersiz kalan bağımlı seçim temizlenir (sınıf → ders → öğretmen). */
export function keepValidOption(value: string, options: readonly Option[]): string {
  return options.some((option) => option.value === value) ? value : ''
}

/** 409 `version_conflict`: başka biri dersi değiştirdi; form uyarısı gösterir, toast çıkmaz. */
export const isLessonVersionConflict = (error: unknown) =>
  isApiError(error) && error.status === 409 && error.code === 'version_conflict'

/**
 * Hata tek yerde görünür (`routeCommandErrors`): formdaki alana bağlanan kod (çakışmalar dahil,
 * sunucu mesajıyla) yalnız alanın altında, sürüm çakışması yalnız form uyarısında, gerisi toast.
 */
export function lessonErrorRoutes(kind: LessonFormKind) {
  return {
    fieldFor: (error: ApiError) => lessonErrorField(error, kind),
    silent: isLessonVersionConflict,
  }
}
