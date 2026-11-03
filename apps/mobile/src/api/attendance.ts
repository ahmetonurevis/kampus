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

/** Listede dokunulan satır: bir ders ya da bir sınıf ve sınıfın bugünkü yoklaması. */
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

/**
 * Ekranın iki bölümü: bugünün dersleri ve ders verilen ama bugün dersi olmayan sınıflar. Ders
 * programı kapalıyken ders bölümü boştur, ders verilen bütün sınıflar ikinci bölümdedir.
 */
export type AttendanceSections = {
  lessons: AttendanceTarget[]
  classes: AttendanceTarget[]
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
 * Yoklama listesi. Ders programı açıksa önce bugünün dersleri (iptal hariç, saat sırasıyla), sonra
 * ders verilen ama bugün dersi olmayan sınıflar; web her ders verilen sınıfta bugünkü yoklamaya
 * izin verir (DOM-YTK-022). Program kapalıysa yalnız sınıflar (ad sırasıyla). Yoklama sınıf ve gün
 * bazındadır: aynı sınıfın bugünkü dersleri aynı kaydı gösterir (DOM-AKD-030 boşluğu).
 */
export function attendanceTargets({
  lessons,
  today,
  classNames,
  subjectNames,
  teachingClassIds,
  takenClassIds,
}: TargetInput): AttendanceSections {
  const className = (classId: string) => classNames.get(classId) ?? 'Sınıf'
  const lessonRows = todayLessons(lessons ?? [], today).map((lesson) => ({
    key: `lesson:${lesson.id}`,
    classId: lesson.classId,
    title: className(lesson.classId),
    subtitle: lessonSubtitle(lesson, subjectNames),
    canTake: teachingClassIds.has(lesson.classId),
    taken: takenClassIds.has(lesson.classId),
  }))
  const withLesson = new Set(lessonRows.map((row) => row.classId))
  const classRows = [...teachingClassIds]
    .filter((classId) => !withLesson.has(classId))
    .map((classId) => ({
      key: `class:${classId}`,
      classId,
      title: className(classId),
      subtitle: lessons ? 'Bugün programda dersi yok' : 'Bugünkü yoklama',
      canTake: true,
      taken: takenClassIds.has(classId),
    }))
    .sort((left, right) => left.title.localeCompare(right.title, 'tr', { numeric: true }))
  return { lessons: lessonRows, classes: classRows }
}

/**
 * Ekranın günü eskidi mi: gün Europe/Istanbul takvimine göredir. Uygulama gece yarısını arka
 * planda geçirdiyse dünün dersleri gösterilmez, dünün tarihiyle kayıt gönderilmez (öğretmen geçmiş
 * günü düzeltemez, `attendance_correction_admin_only`, DOM-AKD-035).
 */
export function isStaleDay(day: string, now: Date = new Date()): boolean {
  return dayKey(now) !== day
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

/**
 * Kaydedilmemiş işaretler: sunucudaki son hâlden (ya da varsayılan "Geldi"den) farklı olanlar.
 * Sürüm çakışmasından (409) sonra sorgular tazelenince sunucunun yeni değeriyle aynı olan işaret
 * düşer, farklı olan kalır (web `AttendanceTaking` ile aynı: kullanıcının işi silinmez).
 */
export function pendingEdits(
  base: Readonly<Record<string, AttendanceMark>>,
  edits: Readonly<Record<string, AttendanceMark>>,
): Record<string, AttendanceMark> {
  return Object.fromEntries(
    Object.entries(edits).filter(([id, status]) => id in base && base[id] !== status),
  )
}

/** Pencere açılışında okunan sınıf sürümü; hedefe (`key`) bağlıdır, başka hedefe geçmez. */
export type VersionPin = { key: string; version: number | undefined }

/**
 * Pencerenin göndereceği sınıf sürümü (`If-Match`). Sürüm pencere açılırken sınıflar tazelenince bir
 * kez sabitlenir (`VersionPin`); sonraki tazelemeler (uygulama öne dönünce odak tazelemesi dahil)
 * onu değiştirmez. Aksi halde başka bir cihazın kaydı sürümü yükseltir, ekrandaki eski işaretler
 * yeni sürümle 409 almadan üzerine yazılırdı. Sabitleme gelene kadar (ya da başka hedefe ait) kayıt
 * beklemede sayılır.
 */
export function pinnedClassVersion(
  pin: VersionPin | null,
  key: string,
): { version: number | undefined; pending: boolean } {
  if (pin === null || pin.key !== key) return { version: undefined, pending: true }
  return { version: pin.version, pending: false }
}

/**
 * Düzenleme sürerken sunucu kaydı değişti mi: ilk düzenlemedeki sunucu durumu (`baseline`) ile şimdiki
 * durum farklıysa başka bir yerde (başka cihaz, yönetici) yoklama değişmiştir. Yalnız içerik
 * karşılaştırılır; aynı içeriği getiren odak tazelemesi uyarı çıkarmaz. Düzenleme yoksa uyarı yoktur.
 */
export function changedElsewhere(
  baseline: Readonly<Record<string, AttendanceMark>> | null,
  base: Readonly<Record<string, AttendanceMark>>,
  edits: Readonly<Record<string, AttendanceMark>>,
): boolean {
  if (baseline === null || Object.keys(edits).length === 0) return false
  const ids = new Set([...Object.keys(baseline), ...Object.keys(base)])
  return [...ids].some((id) => baseline[id] !== base[id])
}

/** Sunucu kaydı değişince pencerede gösterilen uyarı (düzenlenmiş öğrencilerin işareti korunur). */
export const CHANGED_ELSEWHERE_NOTICE =
  'Bu yoklama başka bir yerde değişti. Dokunmadığınız öğrencilerin durumu güncellendi; kaydetmeden önce kontrol edin.'

/** Sunucudaki son hâle göre değişen öğrenci sayısı; kaydedilmemiş iş uyarısı için. */
export function unsavedCount(
  base: Readonly<Record<string, AttendanceMark>>,
  marks: Readonly<Record<string, AttendanceMark>>,
): number {
  return Object.keys(pendingEdits(base, marks)).length
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

/** Pencere içinde gösterilecek Türkçe hata (toast pencerenin altında kalır); 401'de `null`. */
export function attendanceFailureText(error: ApiError): string | null {
  return commandFeedback(error, ATTENDANCE_MESSAGES).message
}
