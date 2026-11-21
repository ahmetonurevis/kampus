import type { FastifyBaseLogger } from 'fastify'

import {
  attendanceWarningOf,
  type AttendanceWarningLevel,
} from '@kampus/school-core/cefr/attendance-warning.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { groupStatus, isGroupClosed } from '@kampus/school-core/lib/language-groups.ts'
import { notificationEnabled } from '@kampus/school-core/lib/notifications.ts'

import type { Database } from '../db/client.ts'
import { loadCourses } from '../db/courses.ts'
import { loadGroups } from '../db/language-groups.ts'
import { listActiveEnrollments, listLessonHourAttendances } from '../db/progression.ts'
import { lockInstitution } from '../db/records.ts'
import { getInstitutionModules } from './modules.ts'
import { notify } from './notify.ts'

/**
 * Devam şartı izleme uyarısı (OG-087; IST-080; DOM-DIL-060, DOM-DIL-070). Günlük iş, açık dil
 * grubunun aktif kursiyerlerinin devamını ders saati yoklamasından hesaplar (grup ilerleme
 * ucuyla aynı satırlar, `listLessonHourAttendances`); devamsızlık hakkının %80'ine ulaşana
 * `attendance_threshold_warning`, hakkı aşana `attendance_threshold_exceeded` yazar. Alıcı
 * `notify`'ın yaş kuralıdır: 18 yaş altında veli, yetişkinde kursiyer (DOM-ILT-037). Aynı kur
 * kaydı ve düzey için ikinci bildirim yazılmaz (`dedupeKey` = kur kaydı kimliği; tür kimliğe
 * girer). Bildirimde saat sayısı yoktur (DOM-ILT-023); "devamsızlıktan kaldı" önerisi kur sonu
 * kararındadır (`incomplete_attendance`), burada yalnız ona atıf vardır.
 */
// TODO(devam-uyari-koordinator): Akademik koordinatöre uyarı gitmiyor; personelin bildirimi yok
// (`NOTIFICATION_AUDIENCES` yalnız öğrenci ve veli). Personel bildirimi gelince bu işe eklenir.
export type AttendanceWarningResult = {
  enrollments: number
  warnings: number
  exceeded: number
  created: number
  deduplicated: number
  /** Bozuk yoklama verisi yüzünden atlanan kur kaydı sayısı. */
  skippedEnrollments: number
  skipped: string | null
}

export async function sendAttendanceWarnings(input: {
  db: Database
  institutionId: string
  now: Date
  log: FastifyBaseLogger
}): Promise<AttendanceWarningResult> {
  const { institutionId, now, log } = input
  const result: AttendanceWarningResult = {
    enrollments: 0,
    warnings: 0,
    exceeded: 0,
    created: 0,
    deduplicated: 0,
    skippedEnrollments: 0,
    skipped: null,
  }
  return input.db.transaction(async (tx) => {
    await lockInstitution(tx, institutionId)
    const institution = await getInstitutionModules(tx, institutionId)
    if (institution === null) return { ...result, skipped: 'institution_missing' }
    if (institution.type !== 'language_school') return { ...result, skipped: 'not_language_school' }
    if (!notificationEnabled('attendance_threshold_warning', institution.modules))
      return { ...result, skipped: 'module_disabled' }

    const [groups, courses] = await Promise.all([
      loadGroups(tx, institutionId),
      loadCourses(tx, institutionId),
    ])
    const hoursOf = new Map(courses.map((course) => [course.id, course.totalHours]))
    const ctx = { institutionId, now, log, actor: null }
    const openGroups = new Map<string, number>()
    for (const group of groups) {
      if (isGroupClosed(groupStatus(group, now.toISOString()))) continue
      const totalHours = hoursOf.get(group.courseId) ?? 0
      if (totalHours >= 1) openGroups.set(group.id, totalHours)
    }
    const enrollments = (await listActiveEnrollments(tx, institutionId)).filter((item) =>
      openGroups.has(item.groupId),
    )
    const attendance = await listLessonHourAttendances(
      tx,
      institutionId,
      enrollments.map((item) => item.id),
    )
    for (const enrollment of enrollments) {
      result.enrollments += 1
      let level: AttendanceWarningLevel
      try {
        ;({ level } = attendanceWarningOf({
          totalHours: openGroups.get(enrollment.groupId) ?? 0,
          rows: attendance.get(enrollment.id) ?? [],
        }))
      } catch (error) {
        // Bozuk yoklama verisi tek kursiyeri atlatır; kurumun diğer bildirimleri geri alınmaz.
        if (!(error instanceof DomainError)) throw error
        result.skippedEnrollments += 1
        log.warn(
          { enrollmentId: enrollment.id, code: error.code },
          'attendance warning skipped: invalid attendance data',
        )
        continue
      }
      if (level === 'ok') continue
      if (level === 'warning') result.warnings += 1
      else result.exceeded += 1
      const sent = await notify(tx, ctx, {
        type:
          level === 'warning' ? 'attendance_threshold_warning' : 'attendance_threshold_exceeded',
        recipients: { studentIds: [enrollment.studentId] },
        data: { enrollmentId: enrollment.id },
        dedupeKey: enrollment.id,
      })
      result.created += sent.created.length
      result.deduplicated += sent.deduplicated
    }
    return result
  })
}
