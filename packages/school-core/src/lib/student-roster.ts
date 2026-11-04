/**
 * Kayıt durumuna bağlı öğrenci süzgeci (DOM-KAY-026). Sınıf listesi, yoklama ve akademik bildirim
 * alıcıları öğrencinin etkin olup olmadığını `isActive` bayrağından okumaz; türetilmiş kayıt
 * durumunun etki tablosundan (`ENROLLMENT_STATUS_EFFECTS`) okur. Durum kümesi bir kez kurulur
 * (`enrollmentStatuses`), öğrenci başına tarama yoktur.
 */
import {
  ENROLLMENT_STATUS_EFFECTS,
  enrollmentStatuses,
  type EnrollmentRecords,
  type EnrollmentStatusEffects,
  type EnrollmentStudent,
} from './enrollment-status.ts'

/** Süzgeçte okunan etki bayrakları (durumla `switch` yazılmaz). */
export type RosterEffect = keyof Pick<
  EnrollmentStatusEffects,
  'roster' | 'attendance' | 'academicNotices'
>

/** `effect` bayrağı açık durumdaki öğrenciler; sıra korunur. */
export function studentsWithEffect<T extends EnrollmentStudent>(
  students: readonly T[],
  records: Pick<EnrollmentRecords, 'renewals'>,
  effect: RosterEffect,
): T[] {
  const statuses = enrollmentStatuses(students, records)
  return students.filter((student) => {
    const status = statuses.get(student.id)
    return status !== undefined && ENROLLMENT_STATUS_EFFECTS[status][effect]
  })
}
