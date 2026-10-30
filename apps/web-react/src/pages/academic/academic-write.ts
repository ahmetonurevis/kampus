// Akademik yazma ekranlarının (yoklama alma, not girişi) saf hesapları. Yetkinin kendisi
// sunucudadır (school-core `authorize`); buradaki süzgeçler yalnız kullanıcıya seçilemeyecek
// seçenekleri hiç göstermemek içindir (kapsam dışı sınıf seçilemez).
import { GRADE_TYPES, GRADE_TYPE_LABELS, type GradeType } from '@kampus/school-core/lib/grades.ts'
import type { CoreRecord } from '@/hooks/use-core-collection.ts'
import { ATTENDANCE_STATUSES, type AttendanceStatus } from './academic-rows.ts'

type Assignment = Pick<CoreRecord<'assignments'>, 'classId' | 'subjectId' | 'teacherId'>

/** Öğretmenin ders verdiği sınıflar. Yalnız sınıf danışmanı olduğu sınıfta yoklama alınamaz. */
export function teachingClassIds(
  assignments: readonly Assignment[],
  teacherId: string,
): ReadonlySet<string> {
  return new Set(
    assignments.filter((item) => item.teacherId === teacherId).map((item) => item.classId),
  )
}

/** Öğretmenin bir sınıfta okuttuğu dersler (kimlik sırasıyla, tekrarsız). */
export function teachingSubjectIds(
  assignments: readonly Assignment[],
  teacherId: string,
  classId: string,
): string[] {
  return [
    ...new Set(
      assignments
        .filter((item) => item.teacherId === teacherId && item.classId === classId)
        .map((item) => item.subjectId),
    ),
  ]
}

/**
 * Yoklama işaretleri: kayıtlı gün varsa onun durumu, yoksa herkes "geldi". Kullanıcının
 * değişiklikleri (`edits`) üstüne biner; hiçbiri state'te kopyalanmaz.
 */
export function attendanceMarks(
  studentIds: readonly string[],
  saved: readonly { studentId: string; status: string }[],
  edits: Readonly<Record<string, AttendanceStatus>> = {},
): Record<string, AttendanceStatus> {
  const savedBy = new Map(saved.map((item) => [item.studentId, item.status]))
  const isStatus = (value: string | undefined): value is AttendanceStatus =>
    ATTENDANCE_STATUSES.some((status) => status === value)
  return Object.fromEntries(
    studentIds.map((id) => {
      const stored = savedBy.get(id)
      return [id, edits[id] ?? (isStatus(stored) ? stored : 'present')]
    }),
  )
}

export function markCounts(
  marks: Readonly<Record<string, AttendanceStatus>>,
): Record<AttendanceStatus, number> {
  const counts: Record<AttendanceStatus, number> = { present: 0, absent: 0, late: 0, excused: 0 }
  for (const status of Object.values(marks)) counts[status] += 1
  return counts
}

/** Eylül–Ocak 1. dönem, Şubat–Ağustos 2. dönem (MEB takvimine yakın varsayılan; seçilebilir). */
export function defaultTerm(day: string): 1 | 2 {
  const month = Number(day.slice(5, 7))
  return month >= 9 || month === 1 ? 1 : 2
}

/** Ders etkinliklerine katılım puanı yalnız ortaokulda verilir (core `grade_kind_level_mismatch`). */
export function gradeTypeOptions(
  classGrade: number | undefined,
): { value: GradeType; label: string }[] {
  return GRADE_TYPES.filter((type) => type !== 'katilim' || (classGrade ?? 0) <= 8).map(
    (value) => ({
      value,
      label: GRADE_TYPE_LABELS[value],
    }),
  )
}
