// Haftalık ders programında kazanım etütleri (IST-096). Etüt oturumu `GET /collections/tutorSessions`
// ile haftanın günleriyle okunur; kapsamı sunucu daraltır (öğretmen kendi etütleri, öğrenci ve veli
// yalnız kendi kapsamındaki öğrenciler). Satır metni Vue `tutoringCalendarEntries` ile aynıdır:
// "Etüt · <ders> · <konu>" ve "<n> öğrenci · Derslik <x>". İptal edilen etüt programda görünmez.
import type { State } from '@kampus/school-core/data/seed.ts'
import { dateLabel, dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import type { AcademicLookups } from './academic-rows.ts'
import {
  LESSON_STATUS_LABELS,
  type ScheduleAudience,
  type ScheduleLesson,
} from './schedule-model.ts'

export type TutorSessionRecord = State['tutorSessions'][number]

/** Programdaki etüt satırı: ders satırı alanları + panelin ihtiyacı olan etüt bilgisi. */
export type ScheduleTutoring = ScheduleLesson & {
  kind: 'tutoring'
  subject: string
  topic: string
  /** Öğrenci adları yalnız öğretmende ve yöneticide dolar; öğrenci ve veli için `null`. */
  students: { id: string; name: string }[] | null
  studentCount: number
}

export const TUTORING_LABEL = 'Etüt'
const CANCELLED = 'İptal'

/** Öğrenci listesini (adlarıyla) yalnız öğretmen ve yönetici görür. */
export const seesTutoringStudents = (audience: ScheduleAudience) => audience !== 'student'

/**
 * Etüt kaydının program satırı. `studentId` (veli: seçili çocuk) verilirse öğrenci listesi ve sayı
 * o çocuğa daraltılır; kayıt çocuğu içermiyorsa satır yoktur (`null`). Sunucu kapsamı zaten
 * daraltır; bu ikinci kat velide birden çok çocuk arasındaki seçimi uygular.
 */
export function scheduleTutoring(
  record: TutorSessionRecord,
  lookups: Pick<AcademicLookups, 'subjects' | 'teachers' | 'students'>,
  audience: ScheduleAudience,
  studentId?: string,
): ScheduleTutoring | null {
  if (record.status === CANCELLED) return null
  if (studentId !== undefined && !record.studentIds.includes(studentId)) return null
  const studentIds = studentId === undefined ? record.studentIds : [studentId]
  const subject = lookups.subjects.get(record.subjectId)?.name || record.subjectId
  const room = record.room
  return {
    kind: 'tutoring',
    id: record.id,
    version: 0,
    title: `${TUTORING_LABEL} · ${subject} · ${record.topic}`,
    className: '',
    teacher: lookups.teachers.get(record.teacherId)?.name ?? '',
    substitute: '',
    day: dayKey(record.date),
    time: timeLabel(record.date),
    dayLabel: dateLabel(record.date, { weekday: 'long', year: 'numeric' }),
    duration: record.duration,
    room,
    subtitle: `${studentIds.length} öğrenci · Derslik ${room}`,
    status: 'planned',
    statusLabel: LESSON_STATUS_LABELS.planned,
    cancelled: false,
    date: record.date,
    subject,
    topic: record.topic,
    studentCount: studentIds.length,
    students: seesTutoringStudents(audience)
      ? studentIds.map((id) => ({ id, name: lookups.students.get(id)?.name ?? 'Öğrenci' }))
      : null,
  }
}

/** Haftanın etüt satırları (iptal ve çocuk dışı kayıtlar çıkar); gün ve saat sırası `scheduleByDay`'dadır. */
export function scheduleTutorings(
  records: readonly TutorSessionRecord[],
  lookups: Pick<AcademicLookups, 'subjects' | 'teachers' | 'students'>,
  audience: ScheduleAudience,
  studentId?: string,
): ScheduleTutoring[] {
  return records.flatMap((record) => scheduleTutoring(record, lookups, audience, studentId) ?? [])
}
