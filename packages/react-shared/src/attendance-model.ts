// Sınıf yoklaması alma ekranının (web `AttendanceTaking`, mobil `TeacherAttendance`) ortak saf
// modeli: durum listesi, işaret hesabı, toplu işaretleme ve geç kalma dakikası (DOM-AKD-036). Yetki
// ve kurallar sunucudadır (core `recordAttendance`); buradaki işlevler yalnız ekran durumunu
// türetir ve gönderim gövdesini kurar. İstek aracı `use-academic-commands.ts`'tedir.
import { lateMinutesSchema } from '@kampus/school-core/lib/domain.ts'

import type { AttendanceMark } from './use-academic-commands.ts'

/** Yoklama durumları ve ekrandaki sıra (DOM-AKD-030). */
export const ATTENDANCE_STATUSES = [
  'present',
  'absent',
  'late',
  'excused',
] as const satisfies readonly AttendanceMark[]
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

const isStatus = (value: string | undefined): value is AttendanceStatus =>
  ATTENDANCE_STATUSES.some((status) => status === value)

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

/** Toplu işaretleme: verilen öğrencilere aynı durum; diğerlerinin işaretine dokunulmaz. */
export function bulkMark(
  edits: Readonly<Record<string, AttendanceStatus>>,
  studentIds: Iterable<string>,
  status: AttendanceStatus,
): Record<string, AttendanceStatus> {
  const next = { ...edits }
  for (const id of studentIds) next[id] = status
  return next
}

/**
 * Kayıtlı geç kalma dakikaları (öğrenci kimliği → metin). Dakika yalnız `late` kayıtta bulunur
 * (DOM-AKD-036); alan metni formda düzenlenir.
 */
export function savedLateMinutes(
  saved: readonly { studentId: string; lateMinutes?: number | undefined }[],
): Record<string, string> {
  return Object.fromEntries(
    saved.flatMap((item) =>
      item.lateMinutes === undefined ? [] : [[item.studentId, String(item.lateMinutes)]],
    ),
  )
}

/**
 * Gönderilecek geç kalma dakikaları: yalnız "Geç geldi" işaretli öğrencinin dolu alanı. Boş alan
 * dakikasız geç gelmedir. Değer core `lateMinutesSchema` ile doğrulanır (ileti core'dandır; geçersiz
 * değer o öğrencinin hatasıdır, istek atılmaz). Üst sınır (günün ders süresi) istemcide bilinmez,
 * sunucuda denetlenir (422).
 */
export function lateMinutesPayload(
  marks: Readonly<Record<string, AttendanceStatus>>,
  text: Readonly<Record<string, string>>,
): { minutes: Record<string, number>; errors: Record<string, string> } {
  const minutes: Record<string, number> = {}
  const errors: Record<string, string> = {}
  for (const [studentId, status] of Object.entries(marks)) {
    if (status !== 'late') continue
    const raw = (text[studentId] ?? '').trim()
    if (raw === '') continue
    // Yalnız ondalık yazım sayıdır ("0x10", "1e1" değil); diğeri NaN ile "dakika olarak girin".
    const parsed = lateMinutesSchema.safeParse(/^[-+]?\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN)
    if (parsed.success) minutes[studentId] = parsed.data
    else errors[studentId] = parsed.error.issues[0]?.message ?? 'Geç kalma süresi geçersiz.'
  }
  return { minutes, errors }
}

/**
 * Sunucunun dakika hatalarını (`422 late_minutes_out_of_range` / `late_minutes_without_late`,
 * `issues[].path = ['lateMinutes', öğrenciKimliği]`) o öğrencinin alanına eşler. Üst sınır (günün
 * ders süresi) istemcide bilinmez; ileti sunucudan gelir ve sınırı içerir (DOM-AKD-036). Yolu
 * `lateMinutes` altında olmayan madde yok sayılır.
 */
export function lateMinutesIssueErrors(
  issues: readonly { path: readonly (string | number)[]; message: string }[],
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const issue of issues) {
    const [field, studentId] = issue.path
    if (field === 'lateMinutes' && typeof studentId === 'string')
      errors[studentId] ??= issue.message
  }
  return errors
}
