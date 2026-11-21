import { attendanceSummary, type AttendanceSummary } from './progression.ts'

/**
 * Devam şartı izleme uyarısı (IST-080; DOM-DIL-060). Devamsızlık hakkı, kur saatinden gereken
 * katılım saatinin çıkarılmasıdır; uyarı eşiği bu hakkın %80'idir. Oran mevzuat parametresidir
 * (kurum daha sıkı devam oranı verirse hak küçülür, eşik onunla kayar). Karşılaştırma tamsayı
 * aritmetiğiyle yapılır, kayan nokta yoktur. Yoklaması alınmamış (`pending`) saat devamsızlık
 * sayılmaz: yalnız `gelmedi` yazılmış saatler hakka işler. `exceeded` kurun devamsızlıktan
 * tamamlanamayacağı durumdur; kur sonu kararındaki `incomplete_attendance` önerisi
 * (DOM-DIL-070) buna dayanır, burada yeniden yazılmaz.
 */
export const ATTENDANCE_WARNING_PERCENT = 80

export type AttendanceWarningLevel = 'ok' | 'warning' | 'exceeded'

export type AttendanceWarning = {
  level: AttendanceWarningLevel
  /** Kurda en çok devamsız kalınabilecek saat (toplam − gereken). */
  allowanceHours: number
  absentHours: number
}

/** Devam özetinden uyarı düzeyi; saf ve idempotenttir. */
export function attendanceWarning(
  summary: Pick<AttendanceSummary, 'totalHours' | 'requiredHours' | 'absentHours'>,
  warnPercent: number = ATTENDANCE_WARNING_PERCENT,
): AttendanceWarning {
  const allowanceHours = Math.max(0, summary.totalHours - summary.requiredHours)
  const { absentHours } = summary
  const level: AttendanceWarningLevel =
    absentHours > allowanceHours
      ? 'exceeded'
      : absentHours > 0 && absentHours * 100 >= warnPercent * allowanceHours
        ? 'warning'
        : 'ok'
  return { level, allowanceHours, absentHours }
}

/** Ders saati satırlarından doğrudan uyarı (`attendanceSummary` ile aynı doğrulama). */
export function attendanceWarningOf(input: Parameters<typeof attendanceSummary>[0]) {
  return attendanceWarning(attendanceSummary(input))
}
