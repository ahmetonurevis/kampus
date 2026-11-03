// Öğretmen yoklama alma ekranının (`screens/TeacherAttendance.tsx`) saf hesapları. Yetki ve
// kural sunucudadır (core `authorize('attendance.record')`, `recordAttendance`); buradaki süzgeçler
// yalnız seçilemeyecek dersi göstermemek ve gönderimi web ile aynı biçimde kurmak içindir. Durum
// seçenekleri ve işaret hesabı web `pages/academic/academic-rows.ts` / `academic-write.ts` ile
// aynıdır (TODO(yoklama-ortak-model): ikisi `@kampus/react-shared`'e taşınınca buradaki kopya kalkar).
import type { ApiError } from '@kampus/api-client/errors.ts'
import { dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import { commandFeedback } from '@kampus/react-shared/commands.ts'
import type { Lesson } from '@kampus/react-shared/lessons.ts'
import {
  ATTENDANCE_MESSAGES,
  type AttendanceMark,
  type RecordAttendanceInput,
} from '@kampus/react-shared/use-academic-commands.ts'

export type { AttendanceMark }

/** Ekran tonları (`ui/components.tsx` `Tone`); saf dosya React Native'e bağlanmasın diye ayrı. */
type ChoiceTone = 'green' | 'red' | 'amber' | 'primary'

/** Web yoklama alma ekranıyla aynı dört seçenek ve sıra (DOM-AKD-030). */
export const ATTENDANCE_CHOICES = [
  { value: 'present', label: 'Geldi', tone: 'green' },
  { value: 'absent', label: 'Gelmedi', tone: 'red' },
  { value: 'late', label: 'Geç geldi', tone: 'amber' },
  { value: 'excused', label: 'Mazeretli', tone: 'primary' },
] as const satisfies readonly { value: AttendanceMark; label: string; tone: ChoiceTone }[]

const MARKS: readonly string[] = ATTENDANCE_CHOICES.map((choice) => choice.value)
const isMark = (value: string | undefined): value is AttendanceMark =>
  value !== undefined && MARKS.includes(value)

type LessonFields = Pick<
  Lesson,
  'id' | 'classId' | 'subjectId' | 'title' | 'date' | 'duration' | 'room' | 'status'
>

/**
 * Bugünün (Europe/Istanbul) dersleri, başlangıç saatine göre. İptal edilen ders günlük programda
 * görünmez ve yoklaması alınmaz (DOM-AKD-030); sunucu zaten `cancelled=false` döndürür, istemci
 * yine de süzer (eski önbellek, değişen varsayılan).
 */
export function todayLessons<T extends Pick<Lesson, 'id' | 'date' | 'status'>>(
  lessons: readonly T[],
  today: string,
): T[] {
  return lessons
    .filter((lesson) => lesson.status !== 'cancelled' && dayKey(lesson.date) === today)
    .sort(
      (left, right) =>
        Date.parse(left.date) - Date.parse(right.date) || left.id.localeCompare(right.id),
    )
}

/** Listede dokunulan satır: bir ders (ya da program kapalıyken bir sınıf) ve sınıfın yoklaması. */
export type AttendanceTarget = {
  key: string
  classId: string
  title: string
  subtitle: string
  /** Öğretmen bu sınıfta ders veriyor (yoklama yetkisi, DOM-YTK-022); yedek derste `false`. */
  canTake: boolean
  /** Sınıfın bugünkü yoklaması kayıtlı. */
  taken: boolean
}

type TargetInput = {
  /** Bugünün dersleri; `null` ders programı (`planning`) kapalı demektir, sınıflar listelenir. */
  lessons: readonly LessonFields[] | null
  today: string
  classNames: ReadonlyMap<string, string>
  subjectNames: ReadonlyMap<string, string>
  teachingClassIds: ReadonlySet<string>
  takenClassIds: ReadonlySet<string>
}

const MINUTE_MS = 60_000

function lessonSubtitle(lesson: LessonFields, subjectNames: ReadonlyMap<string, string>): string {
  const end = Date.parse(lesson.date) + lesson.duration * MINUTE_MS
  return [
    `${timeLabel(lesson.date)}–${timeLabel(end)}`,
    lesson.title || subjectNames.get(lesson.subjectId),
    lesson.room ? `Derslik ${lesson.room}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Yoklama listesi. Ders programı açıksa bugünün dersleri (iptal hariç); kapalıysa web'deki gibi
 * öğretmenin ders verdiği sınıflar (ad sırasıyla). Yoklama sınıf ve gün bazındadır: aynı sınıfın
 * bugünkü dersleri aynı kaydı gösterir (DOM-AKD-030 boşluğu, ders saati bazlı yoklama yok).
 */
export function attendanceTargets({
  lessons,
  today,
  classNames,
  subjectNames,
  teachingClassIds,
  takenClassIds,
}: TargetInput): AttendanceTarget[] {
  const className = (classId: string) => classNames.get(classId) ?? 'Sınıf'
  if (lessons)
    return todayLessons(lessons, today).map((lesson) => ({
      key: lesson.id,
      classId: lesson.classId,
      title: className(lesson.classId),
      subtitle: lessonSubtitle(lesson, subjectNames),
      canTake: teachingClassIds.has(lesson.classId),
      taken: takenClassIds.has(lesson.classId),
    }))
  return [...teachingClassIds]
    .map((classId) => ({
      key: classId,
      classId,
      title: className(classId),
      subtitle: 'Bugünkü yoklama',
      canTake: true,
      taken: takenClassIds.has(classId),
    }))
    .sort((left, right) => left.title.localeCompare(right.title, 'tr', { numeric: true }))
}

/** Öğretmenin ders verdiği sınıflar; yalnız rehberi olduğu sınıfta yoklama alınamaz (DOM-YTK-022). */
export function teachingClassIds(
  assignments: readonly { classId: string; teacherId: string }[],
  teacherId: string,
): ReadonlySet<string> {
  if (!teacherId) return new Set()
  return new Set(
    assignments.filter((item) => item.teacherId === teacherId).map((item) => item.classId),
  )
}

/**
 * Ekrandaki işaretler: kullanıcının dokunduğu (`edits`), yoksa kayıtlı durum, o da yoksa "Geldi".
 * Yalnız verilen öğrenciler (sınıfın aktif öğrencileri) döner; sunucu hepsini ister.
 */
export function attendanceMarks(
  studentIds: readonly string[],
  saved: readonly { studentId: string; status: string }[],
  edits: Readonly<Record<string, AttendanceMark>> = {},
): Record<string, AttendanceMark> {
  const savedBy = new Map(saved.map((item) => [item.studentId, item.status]))
  return Object.fromEntries(
    studentIds.map((id) => {
      const stored = savedBy.get(id)
      return [id, edits[id] ?? (isMark(stored) ? stored : 'present')]
    }),
  )
}

/** Tek öğrencinin durumu; seçili durumun yeniden seçilmesi işareti kaldırmaz. */
export function markStudent(
  edits: Readonly<Record<string, AttendanceMark>>,
  studentId: string,
  status: AttendanceMark,
): Record<string, AttendanceMark> {
  return { ...edits, [studentId]: status }
}

/** "Tümünü geldi işaretle": yalnız ekrandaki seçimi hızlandırır, gönderim yine tek istektir (DOM-AKD-036). */
export function markAll(
  edits: Readonly<Record<string, AttendanceMark>>,
  studentIds: readonly string[],
  status: AttendanceMark,
): Record<string, AttendanceMark> {
  const next = { ...edits }
  for (const id of studentIds) next[id] = status
  return next
}

export function markCounts(
  marks: Readonly<Record<string, AttendanceMark>>,
): Record<AttendanceMark, number> {
  const counts: Record<AttendanceMark, number> = { present: 0, absent: 0, late: 0, excused: 0 }
  for (const status of Object.values(marks)) counts[status] += 1
  return counts
}

/** Kayıtlı (ya da varsayılan) duruma göre değişen öğrenci sayısı; kaydedilmemiş iş uyarısı için. */
export function unsavedCount(
  base: Readonly<Record<string, AttendanceMark>>,
  marks: Readonly<Record<string, AttendanceMark>>,
): number {
  return Object.entries(marks).filter(([id, status]) => base[id] !== status).length
}

/**
 * Gönderim yükü (`POST /classes/:classId/attendance`): bugünün tarihi, bütün öğrencilerin işareti
 * ve sınıfın okunan sürümü (`If-Match`). Geç kalma dakikası telefonda girilmez; `lateMinutes`
 * gönderilmediği için kayıtlı dakikalar korunur (DOM-AKD-036). Aynı gün ikinci gönderim kaydı
 * günceller, yinelemez (DOM-AKD-035).
 */
export function attendancePayload(input: {
  classId: string
  today: string
  marks: Readonly<Record<string, AttendanceMark>>
  classVersion: number | undefined
}): RecordAttendanceInput {
  return {
    classId: input.classId,
    date: input.today,
    marks: { ...input.marks },
    classVersion: input.classVersion ?? null,
  }
}

/**
 * Başarısız gönderimden sonra ekrandaki işaretler. Sürüm çakışmasında (409) sorgular tazelenir ve
 * işaretler bırakılır: ekran sunucudaki son hâli gösterir, öğretmen kontrol edip yeniden kaydeder.
 * Ağ ya da kural hatasında hiçbir kayıt değişmemiştir; kayıtlı durum aynı kalır, öğretmenin
 * kaydedilmemiş işaretleri yeniden denemek için korunur.
 */
export function editsAfterFailure(
  edits: Readonly<Record<string, AttendanceMark>>,
  error: Pick<ApiError, 'status' | 'code'>,
): Record<string, AttendanceMark> {
  return error.status === 409 && error.code === 'version_conflict' ? {} : { ...edits }
}

/** Pencere içinde gösterilecek Türkçe hata (toast pencerenin altında kalır); 401'de `null`. */
export function attendanceFailureText(error: ApiError): string | null {
  return commandFeedback(error, ATTENDANCE_MESSAGES).message
}
