// Dil okulu kur listesinin saf yardımcıları (IST-076; DOM-DIL-005…007): satır biçimleme, süzgeç
// seçenekleri, CSV sütunları ve rol yetkisi. React'siz sınanır (`tests/course-rows.test.ts`).
import { CEFR_LEVELS, type CefrLevel } from '@kampus/school-core/content/taxonomy.ts'
import {
  COURSE_EOZEL_APPROVAL_LABELS,
  COURSE_LANGUAGES,
  COURSE_STATUS_LABELS,
  type CourseStatus,
} from '@kampus/school-core/lib/courses.ts'
import type { Course } from '@kampus/react-shared/courses.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import type { FilterField } from '@/lib/list-query.ts'
import type { ListColumn } from '@/lib/list-view.ts'
import type { RoleKey } from '@/lib/navigation.ts'

export type CourseRow = {
  id: string
  name: string
  /** Görünen değerler: süzgeç ve arama bu metinlerle çalışır. */
  language: string
  level: string
  status: string
  statusKey: CourseStatus
  levelKey: CefrLevel
  /** "120 saat · 6 saat/hafta · 20 hafta". */
  hours: string
  session: string
  learners: string
  certified: string
  eOzel: string
  course: Course
}

export const CEFR_LEVEL_KEYS = Object.keys(CEFR_LEVELS) as CefrLevel[]
export const COURSE_LANGUAGE_KEYS = Object.keys(
  COURSE_LANGUAGES,
) as (keyof typeof COURSE_LANGUAGES)[]

const STATUS_TONES = {
  draft: 'amber',
  active: 'green',
  archived: 'gray',
} as const satisfies Record<CourseStatus, BadgeTone>

export const courseStatusTone = (status: CourseStatus): BadgeTone => STATUS_TONES[status]

/** Personel yanıtında durum hep vardır; öğrenci/veli görünümünde yalnız etkin kur döner. */
export const courseStatusOf = (course: Pick<Course, 'status'>): CourseStatus =>
  course.status ?? 'active'

export const sessionText = (minutes: number) =>
  minutes === 90 ? '90 dk (2 ders saati)' : `${minutes} dk`

export const certifiedText = (certified: boolean) => (certified ? 'Belgeli' : 'Belgesiz')

export function courseRow(course: Course): CourseRow {
  const statusKey = courseStatusOf(course)
  return {
    id: course.id,
    name: course.name,
    language: COURSE_LANGUAGES[course.language],
    level: CEFR_LEVELS[course.level].label,
    status: COURSE_STATUS_LABELS[statusKey],
    statusKey,
    levelKey: course.level,
    hours: `${course.totalHours} saat · ${course.weeklyHours} saat/hafta · ${course.durationWeeks} hafta`,
    session: sessionText(course.sessionMinutes),
    learners:
      course.minLearners === undefined
        ? `En çok ${course.maxLearners}`
        : `${course.minLearners}–${course.maxLearners} kişi`,
    certified: certifiedText(course.certified),
    eOzel: course.eOzel ? COURSE_EOZEL_APPROVAL_LABELS[course.eOzel.approval] : '—',
    course,
  }
}

/** Seviye sırası, sonra Türkçe ad (sunucu sırasıyla aynı; arşiv birleşimi sonrası yeniden). */
export function courseRows(courses: readonly Course[]): CourseRow[] {
  return [...courses]
    .sort(
      (a, b) =>
        CEFR_LEVELS[a.level].rank - CEFR_LEVELS[b.level].rank ||
        a.name.localeCompare(b.name, 'tr', { numeric: true }),
    )
    .map(courseRow)
}

/** Tablo süzgeçleri: durum, seviye, dil (seçenekler sabit listeden; boş liste de süzülebilir). */
export const COURSE_FILTERS: readonly FilterField[] = [
  {
    key: 'status',
    label: 'Durum',
    options: Object.values(COURSE_STATUS_LABELS).map((label) => ({ value: label, label })),
  },
  {
    key: 'level',
    label: 'CEFR seviyesi',
    options: CEFR_LEVEL_KEYS.map((key) => ({
      value: CEFR_LEVELS[key].label,
      label: CEFR_LEVELS[key].label,
    })),
  },
  {
    key: 'language',
    label: 'Dil',
    options: Object.values(COURSE_LANGUAGES).map((label) => ({ value: label, label })),
  },
]

export const COURSE_CSV_COLUMNS: readonly ListColumn[] = [
  { key: 'name', label: 'Kur' },
  { key: 'language', label: 'Dil' },
  { key: 'level', label: 'CEFR seviyesi' },
  { key: 'status', label: 'Durum' },
  { key: 'hours', label: 'Ders saati' },
  { key: 'session', label: 'Oturum' },
  { key: 'learners', label: 'Mevcut' },
  { key: 'certified', label: 'Belge' },
  { key: 'eOzel', label: 'e-Özel' },
]

/** Bir CSV satırı: ekrandaki metinlerle aynı. */
export function courseCsvRow(row: CourseRow): Record<string, string> {
  return Object.fromEntries(
    COURSE_CSV_COLUMNS.map((column) => [column.key, String(row[column.key as keyof CourseRow])]),
  )
}

/**
 * Kurun seviyesini yönetebilir mi (DOM-YTK-027): yönetici her seviyeyi, öğretmen yalnız akademik
 * koordinatörü olduğu seviyeleri. Ön büro, öğrenci ve veli okur. Sunucu aynı kuralı uygular; bu
 * yalnız düğmelerin görünürlüğüdür.
 */
export function canManageLevel(
  role: RoleKey | undefined,
  coordinatedLevels: ReadonlySet<string>,
  level: string,
): boolean {
  if (role === 'yonetici') return true
  return role === 'ogretmen' && coordinatedLevels.has(level)
}

/** Yeni kur ekleyebilir mi: yönetici ya da en az bir seviyenin koordinatörü öğretmen. */
export function canCreateCourse(role: RoleKey | undefined, coordinatedLevels: ReadonlySet<string>) {
  return role === 'yonetici' || (role === 'ogretmen' && coordinatedLevels.size > 0)
}

/** e-Özel kaydını yalnız yönetici işaretler (DOM-DIL-006). */
export const canRecordEOzel = (role: RoleKey | undefined) => role === 'yonetici'

/** Kur için hangi işlemler sunulur (durum ve yetkiye göre). */
export function courseActions(
  course: Pick<Course, 'status' | 'level'>,
  role: RoleKey | undefined,
  coordinatedLevels: ReadonlySet<string>,
) {
  const status = courseStatusOf(course)
  const manage = canManageLevel(role, coordinatedLevels, course.level)
  return {
    edit: manage && status !== 'archived',
    activate: manage && status === 'draft',
    archive: manage && status !== 'archived',
    eOzel: canRecordEOzel(role) && status !== 'archived',
  }
}
