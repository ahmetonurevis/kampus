// Akademik okuma ekranlarının satır ve özet hesapları (Vue `Academic.vue`). Saf işlevlerdir:
// API satırları ve başvuru koleksiyonlarının eşlemeleri girer, tablo/CSV satırı ve özet çıkar.
// Ortalama ve gün anahtarı school-core `format` işlevleriyle hesaplanır; hiçbiri saklanmaz.
import { average, dateLabel, dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import type { CoreRecord, CoreRow } from '@/hooks/use-core-collection.ts'

type Subject = CoreRecord<'subjects'>
type SchoolClass = CoreRecord<'classes'>
type Student = CoreRecord<'students'>
type Teacher = CoreRecord<'teachers'>
type Branch = CoreRecord<'branches'>
type Grade = CoreRecord<'grades'>
type Attendance = CoreRecord<'attendance'>
type Lesson = CoreRecord<'schedule'>

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

/** Sunucu eşitlik filtresi en çok 20 değer alır (API beyaz listesi). */
export const MAX_FILTER_VALUES = 20

export type StudentScope = {
  /** `studentId` filtresine gidecek kimlikler; boşsa öğrenci filtresi yok. */
  ids: string[]
  /** Sınıf seçildi ama öğrencisi yok: liste boş olmalı (filtresiz sorgu bütün kapsamı döndürür). */
  empty: boolean
  /** Sınıf 20'den çok öğrenci içeriyor; ilk 20'si süzülür. */
  truncated: boolean
}

/**
 * Not kaydında sınıf alanı yoktur; sınıf filtresi sınıftaki öğrencilerin `studentId` filtresine
 * çevrilir. Sabit öğrenci (veli: seçili çocuk) sınıftan önce gelir.
 * TODO(api-grade-class): notlarda `classId` filtresi gelince bu çeviri ve 20 kimlik sınırı kalkar.
 */
export function studentScope(
  studentId: string | undefined,
  classId: string,
  lookups: Pick<AcademicLookups, 'studentsByClass'>,
): StudentScope {
  if (studentId) return { ids: [studentId], empty: false, truncated: false }
  if (!classId) return { ids: [], empty: false, truncated: false }
  const ids = (lookups.studentsByClass.get(classId) ?? []).map((student) => student.id)
  return {
    ids: ids.slice(0, MAX_FILTER_VALUES),
    empty: ids.length === 0,
    truncated: ids.length > MAX_FILTER_VALUES,
  }
}

export type SubjectAverage = { subjectId: string; name: string; average: number; count: number }

/** Ders bazında ortalama (core `average`); ders adı sırasıyla. Notu olmayan ders yer almaz. */
export function subjectAverages(
  grades: readonly Pick<Grade, 'subjectId' | 'subject' | 'score'>[],
  subjects: ReadonlyMap<string, Pick<Subject, 'name'>>,
): SubjectAverage[] {
  const groups = new Map<string, { name: string; scores: number[] }>()
  for (const grade of grades) {
    const group = groups.get(grade.subjectId)
    if (group) group.scores.push(grade.score)
    else
      groups.set(grade.subjectId, {
        name: subjects.get(grade.subjectId)?.name ?? grade.subject,
        scores: [grade.score],
      })
  }
  return [...groups]
    .map(([subjectId, { name, scores }]) => ({
      subjectId,
      name,
      average: average(scores),
      count: scores.length,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'tr'))
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
    reason: record.reason ?? '',
  }
}

export function attendanceCsvRow(row: AttendanceRow) {
  return {
    ...row,
    date: dateLabel(row.date, { year: 'numeric', weekday: 'long' }),
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

/** Yoklama `date` alanı UTC ISO'dur; tarih filtresi sunucu aramasına `YYYY-MM-DD` olarak gider. */
export const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/
export const isDayKey = (value: unknown): value is string =>
  typeof value === 'string' && DAY_KEY.test(value)

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

/** İptal edilen ders günlük programlarda görünmez (iş kuralı). */
export const isVisibleLesson = (lesson: Pick<Lesson, 'cancelledAt'>) => !lesson.cancelledAt

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

export type LessonRow = {
  id: string
  title: string
  day: string
  time: string
  duration: number
  room: string
  /** "7-A · Derslik 101" ya da öğrenci/veli için öğretmen adı. */
  subtitle: string
  date: string
}

export function lessonRow(
  item: CoreRow<'schedule'>,
  lookups: AcademicLookups,
  audience: 'teacher' | 'student',
): LessonRow {
  const record = item.record
  const who =
    audience === 'teacher'
      ? (lookups.classes.get(record.classId)?.name ?? '')
      : (lookups.teachers.get(record.teacherId)?.name ?? '')
  return {
    id: item.id,
    title: record.title ?? lookups.subjects.get(record.subjectId)?.name ?? '',
    day: dayKey(record.date),
    time: timeLabel(record.date),
    duration: record.duration,
    room: record.room,
    subtitle: [who, `Derslik ${record.room}`].filter(Boolean).join(' · '),
    date: record.date,
  }
}

/** Haftanın günleri → o günün (iptalsiz) dersleri, saat sırasıyla. */
export function lessonsByDay(
  items: readonly CoreRow<'schedule'>[],
  lookups: AcademicLookups,
  audience: 'teacher' | 'student',
  start: string,
): Map<string, LessonRow[]> {
  const days = new Map(weekDays(start).map((key) => [key, [] as LessonRow[]]))
  for (const item of items) {
    if (!isVisibleLesson(item.record)) continue
    const row = lessonRow(item, lookups, audience)
    days.get(row.day)?.push(row)
  }
  for (const list of days.values()) list.sort((left, right) => left.date.localeCompare(right.date))
  return days
}
