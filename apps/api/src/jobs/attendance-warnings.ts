import { sendAttendanceWarnings } from '../services/attendance-warnings.ts'
import { istanbulHour, REMINDER_EARLIEST_HOUR } from './permission-reminders.ts'
import { DAY_SECONDS, type InstitutionJob } from './types.ts'

/**
 * Devam şartı izleme uyarısı (OG-087, IST-080): her sabah 08:30 Europe/Istanbul kurum başına
 * çalışır; kural ve bildirim `sendAttendanceWarnings`'tedir. Aynı eşik için ikinci çalıştırma
 * yeni bildirim yazmaz (`dedupeKey`). İstanbul saatiyle 07:00'den önce çalışırsa gece bildirimi
 * gitmesin diye hiçbir şey okunmaz (`skipped: 'before_morning'`). Yalnız dil okulu ve `academic`
 * modülü açıkken iş görür.
 */
export const attendanceWarningsJob: InstitutionJob<{
  enrollments: number
  warnings: number
  exceeded: number
  created: number
  deduplicated: number
  skippedEnrollments: number
  skipped: string | null
}> = {
  name: 'attendance.warn',
  cron: '30 8 * * *',
  slotSeconds: DAY_SECONDS,
  run: async ({ db, log }, { institutionId }, now) =>
    istanbulHour(now) < REMINDER_EARLIEST_HOUR
      ? {
          enrollments: 0,
          warnings: 0,
          exceeded: 0,
          created: 0,
          deduplicated: 0,
          skippedEnrollments: 0,
          skipped: 'before_morning',
        }
      : sendAttendanceWarnings({ db, institutionId, now, log }),
}
