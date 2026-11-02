// Akademik yazma ekranlarının (yoklama alma, not girişi) saf hesapları. Yetkinin kendisi
// sunucudadır (school-core `authorize`); buradaki süzgeçler yalnız kullanıcıya seçilemeyecek
// seçenekleri hiç göstermemek içindir (kapsam dışı sınıf seçilemez).
import { lateMinutesSchema } from '@kampus/school-core/lib/domain.ts'
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

/** Öğretmen yalnız ders verdiği sınıfın kendi dersindeki notunu düzeltir (DOM-AKD-054). */
export function canCorrectGrade(
  assignments: readonly Assignment[],
  teacherId: string,
  classId: string | undefined,
  subjectId: string,
): boolean {
  return (
    teacherId !== '' &&
    classId !== undefined &&
    assignments.some(
      (item) =>
        item.teacherId === teacherId && item.classId === classId && item.subjectId === subjectId,
    )
  )
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

/** Toplu işaretleme: seçili öğrencilere aynı durum; diğerlerinin işaretine dokunulmaz. */
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

/**
 * Puan alanının ham değeri: boş alan `undefined` olur (core "Puanı girin" der). Aksi halde
 * `z.coerce.number()` boş metni sessizce 0 yapardı.
 */
export function scoreValue(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isNaN(raw) ? undefined : raw
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  return Number(raw)
}
