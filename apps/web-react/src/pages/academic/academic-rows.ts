// Akademik okuma ekranlarının satır ve özet hesapları (Vue `Academic.vue`). Saf işlevlerdir:
// API satırları ve başvuru koleksiyonlarının eşlemeleri girer, tablo/CSV satırı ve özet çıkar.
// Ortalama ve gün anahtarı school-core `format` işlevleriyle hesaplanır; hiçbiri saklanmaz.
import { average, dateLabel } from '@kampus/school-core/lib/format.ts'
import type { CoreRecord, CoreRow } from '@/hooks/use-core-collection.ts'

type Subject = CoreRecord<'subjects'>
type SchoolClass = CoreRecord<'classes'>
type Student = CoreRecord<'students'>
type Teacher = CoreRecord<'teachers'>
type Branch = CoreRecord<'branches'>
type Grade = CoreRecord<'grades'>
type Attendance = CoreRecord<'attendance'>

export type AcademicSources = {
  subjects: readonly CoreRow<'subjects'>[]
  classes: readonly CoreRow<'classes'>[]
  students: readonly CoreRow<'students'>[]
  teachers: readonly CoreRow<'teachers'>[]
  branches: readonly CoreRow<'branches'>[]
}

/** Kimlik → kayıt eşlemeleri; satır başına tam tarama yapılmaz (bir kez kurulur). */
export type AcademicLookups = {
  subjects: ReadonlyMap<string, Subject>
  classes: ReadonlyMap<string, SchoolClass>
  students: ReadonlyMap<string, Student>
  teachers: ReadonlyMap<string, Teacher>
  branches: ReadonlyMap<string, Branch>
  /** Sınıftaki aktif öğrenciler (okul numarası sırasıyla); yalnız kapsamdaki öğrenciler gelir. */
  studentsByClass: ReadonlyMap<string, readonly Student[]>
}

function byId<T extends { id: string }>(rows: readonly { record: T }[]): Map<string, T> {
  return new Map(rows.map((row) => [row.record.id, row.record]))
}

export function academicLookups(sources: AcademicSources): AcademicLookups {
  const studentsByClass = new Map<string, Student[]>()
  for (const { record } of sources.students) {
    if (!record.isActive) continue
    const list = studentsByClass.get(record.classId)
    if (list) list.push(record)
    else studentsByClass.set(record.classId, [record])
  }
  return {
    subjects: byId(sources.subjects),
    classes: byId(sources.classes),
    students: byId(sources.students),
    teachers: byId(sources.teachers),
    branches: byId(sources.branches),
    studentsByClass,
  }
}

// --- Notlar -----------------------------------------------------------------

export const scoreText = (score: number) => `${score}/100`
/** Başarı rozeti: 65 altı dikkat ister (Vue ile aynı eşik). */
export const scoreTone = (score: number) => (score < 65 ? 'amber' : 'green')

export type GradeRow = {
  id: string
  studentId: string
  student: string
  subject: string
  title: string
  topic: string
  /** ISO tarih; ekranda `dateLabel` ile gösterilir. */
  date: string
  score: number
}

export function gradeRow(item: CoreRow<'grades'>, lookups: AcademicLookups): GradeRow {
  const record = item.record
  return {
    id: item.id,
    studentId: record.studentId,
    student: lookups.students.get(record.studentId)?.name ?? '',
    subject: lookups.subjects.get(record.subjectId)?.name ?? record.subject,
    title: record.title ?? '',
    topic: record.topic ?? '',
    date: record.date ?? '',
    score: record.score,
  }
}

/** CSV hücreleri: ekrandaki metinle aynı (tarih Türkçe, puan "80/100"). */
export function gradeCsvRow(row: GradeRow) {
  return { ...row, date: dateLabel(row.date, { year: 'numeric' }), score: scoreText(row.score) }
}

/** Genel ortalama: bütün notların ortalaması (ders ortalamalarının ortalaması değil). */
export const overallAverage = (grades: readonly Pick<Grade, 'score'>[]) =>
  average(grades.map((grade) => grade.score))

// --- Yoklama ----------------------------------------------------------------

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

const STATUS_LABELS = {
  present: 'Geldi',
  absent: 'Gelmedi',
  late: 'Geç geldi',
  excused: 'Mazeretli',
} as const satisfies Record<AttendanceStatus, string>

export function attendanceStatusLabel(status: string): string {
  return status in STATUS_LABELS ? STATUS_LABELS[status as AttendanceStatus] : status
}

export const ATTENDANCE_OPTIONS = ATTENDANCE_STATUSES.map((value) => ({
  value,
  label: STATUS_LABELS[value],
}))

export const NO_REASON = 'Kayıtlı mazeret yok'

export type AttendanceRow = {
  id: string
  studentId: string
  student: string
  className: string
  date: string
  status: string
  statusLabel: string
  /** Geç kalma dakikası (DOM-AKD-036); yalnız dakikası girilmiş "Geç geldi" kaydında. */
  lateMinutes: number | null
  reason: string
}

export function attendanceRow(
  item: CoreRow<'attendance'>,
  lookups: AcademicLookups,
): AttendanceRow {
  const record = item.record
  return {
    id: item.id,
    studentId: record.studentId,
    student: lookups.students.get(record.studentId)?.name ?? '',
    className: lookups.classes.get(record.classId)?.name ?? '',
    date: record.date,
    status: record.status,
    statusLabel: attendanceStatusLabel(record.status),
    lateMinutes: record.status === 'late' ? (record.lateMinutes ?? null) : null,
    reason: record.reason ?? '',
  }
}

/** Katılım metni: "Geç geldi · 12 dk" (dakika yoksa yalnız durum). */
export const attendanceStatusText = (label: string, lateMinutes: number | null) =>
  lateMinutes === null ? label : `${label} · ${lateMinutes} dk`

export function attendanceCsvRow(row: AttendanceRow) {
  return {
    ...row,
    date: dateLabel(row.date, { year: 'numeric', weekday: 'long' }),
    statusLabel: attendanceStatusText(row.statusLabel, row.lateMinutes),
    reason: row.reason || NO_REASON,
  }
}

export type AttendanceCounts = Record<AttendanceStatus, number>

export function attendanceCounts(records: readonly Pick<Attendance, 'status'>[]): AttendanceCounts {
  const counts: AttendanceCounts = { present: 0, absent: 0, late: 0, excused: 0 }
  for (const record of records)
    if (record.status in counts) counts[record.status as AttendanceStatus]++
  return counts
}

/** Gün anahtarı (`YYYY-MM-DD`): adres durumu ve sunucu `dateFrom`/`dateTo` değeri. */
export const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/
export const isDayKey = (value: unknown): value is string =>
  typeof value === 'string' && DAY_KEY.test(value)

/** Tek gün süzgeci: sunucuda `dateFrom` = `dateTo` (gün Europe/Istanbul'a göre eşlenir). */
export function attendanceDayFilters(day: string): { dateFrom?: string; dateTo?: string } {
  return isDayKey(day) ? { dateFrom: day, dateTo: day } : {}
}

export const ATTENDANCE_RANGE_ORDER_ERROR = 'Bitiş günü başlangıç gününden önce olamaz.'
export const ATTENDANCE_RANGE_LONG_ERROR = 'Tarih aralığı en fazla 1 yıl olabilir.'

/**
 * Yoklama geçmişi tarih aralığının hatası (IST-093): bitiş başlangıçtan önce olamaz, aralık en
 * çok 1 yıldır (başlangıçtan bir yıl sonraki gün dahil). Sunucu aynı kuralı 400 ile uygular
 * (`services/collection-reads.ts`); burada istek atılmadan alanın altında gösterilir. Geçerli ya da
 * tamamlanmamış (tek uçlu) aralık için boş metin.
 */
export function attendanceRangeError(from: string, to: string): string {
  if (!isDayKey(from) || !isDayKey(to)) return ''
  if (to < from) return ATTENDANCE_RANGE_ORDER_ERROR
  const limit = new Date(`${from}T00:00:00Z`)
  limit.setUTCFullYear(limit.getUTCFullYear() + 1)
  return to > limit.toISOString().slice(0, 10) ? ATTENDANCE_RANGE_LONG_ERROR : ''
}

/**
 * Sunucuya giden aralık süzgeci: biçimli uçlar eklenir (tek uç açık aralıktır); geçersiz aralık
 * uygulanmaz (hata alanın altında gösterilir).
 */
export function attendanceRangeFilters(
  from: string,
  to: string,
): { dateFrom?: string; dateTo?: string } {
  if (attendanceRangeError(from, to)) return {}
  return {
    ...(isDayKey(from) ? { dateFrom: from } : {}),
    ...(isDayKey(to) ? { dateTo: to } : {}),
  }
}

// --- Sınıflar ---------------------------------------------------------------

export const ROLE_HOMEROOM = 'Sınıf danışmanı'
export const ROLE_SUBJECT = 'Branş öğretmeni'

export type TeacherClassRow = {
  id: string
  name: string
  level: string
  grade: number
  branch: string
  room: string
  count: number
  /** Öğretmenin bu sınıftaki görevi: danışman ya da branş öğretmeni. */
  duty: string
}

export function teacherClassRow(
  item: CoreRow<'classes'>,
  lookups: AcademicLookups,
  teacherId: string,
): TeacherClassRow {
  const record = item.record
  return {
    id: item.id,
    name: record.name,
    level: record.level,
    grade: record.grade,
    branch: lookups.branches.get(record.branchId)?.name ?? '',
    room: record.room,
    count: lookups.studentsByClass.get(record.id)?.length ?? 0,
    duty: record.teacherId === teacherId ? ROLE_HOMEROOM : ROLE_SUBJECT,
  }
}

// --- Ders programı ----------------------------------------------------------

const DAY_MS = 86_400_000
const toUtc = (key: string) => new Date(`${key}T00:00:00.000Z`)
const toKey = (date: Date) => date.toISOString().slice(0, 10)

export function addDays(key: string, days: number): string {
  return toKey(new Date(toUtc(key).getTime() + days * DAY_MS))
}

/** Gün anahtarının ait olduğu haftanın pazartesisi. */
export function weekStart(key: string): string {
  const weekday = toUtc(key).getUTCDay()
  return addDays(key, -((weekday + 6) % 7))
}

export const weekDays = (start: string): string[] =>
  Array.from({ length: 7 }, (_, index) => addDays(start, index))
