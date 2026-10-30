// Otomatik etüt ekranının saf hesapları. Plan, çakışma ve kapsam kuralları core
// `lib/assessment-automation.ts` ve `lib/tutor-conflicts.ts`'tedir; plan önizlemesini ve onayını
// sunucu hesaplar (`POST /assessment/plan[/preview]`). Burada ikinci kopya yazılmaz: yalnız form
// değerleri, sunucu yanıtının ekran satırlarına çevrilmesi ve liste satırları bulunur.
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { TutoringPlanPreview } from '@kampus/react-shared/use-assessment-commands.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import {
  automationSchemas,
  tutoringSessions,
  type AttendanceMark,
} from '@kampus/school-core/lib/assessment-automation.ts'
import type { Session } from '@kampus/school-core/lib/domain.ts'
import { dateLabel, dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import { sessionTeacherId } from '@kampus/school-core/lib/scope.ts'
import type { CollectionName } from '@kampus/school-core/modules/collection-modules.ts'

/** Etüt listesi: tüm roller kendi kapsamında okur (sunucu daraltır). İlki ana koleksiyondur. */
export const TUTORING_LIST_SOURCES = [
  'tutorSessions',
  'subjects',
  'branches',
] as const satisfies readonly CollectionName[]

/**
 * Plan formunun okuduğu koleksiyonlar: deneme listesi ve sunum adları (ders; öğretmen ve öğrenci
 * adları kapsam kaynaklarından gelir). Plan hesabı için koleksiyon okunmaz. İlki ana koleksiyondur.
 */
export const TUTORING_PLAN_SOURCES = [
  'mockExams',
  'subjects',
] as const satisfies readonly CollectionName[]

export const ATTENDANCE_MARKS = ['Geldi', 'Gelmedi', 'İzinli'] as const satisfies AttendanceMark[]

export type TutorRow = {
  id: string
  title: string
  date: string
  when: string
  teacher: string
  room: string
  status: string
  studentCount: number
  /** Salt okunur ayrıntı: öğrenci adı + yoklama durumu. */
  students: { id: string; name: string; mark: string }[]
  cancelReason: string
  threshold: number
  /** Yazma yetkisi: yönetici veya etüdün öğretmeni; sunucu yine doğrular. */
  manageable: boolean
  /** Yoklama başlangıç saatinden sonra alınır (gelecek etüt 422). */
  attendanceOpen: boolean
  cancellable: boolean
}

/** Etüt satırları (core `tutoringSessions`: öğrenci/veli kendi kapsamına daraltılmış). */
export function tutorRows(state: State, session: Session, now: string): TutorRow[] {
  const own = sessionTeacherId(state, session)
  const writer = session.role === 'yonetici' || session.role === 'ogretmen'
  return tutoringSessions(state, session)
    .map((entry) => {
      const subject = state.subjects.find((s) => s.id === entry.subjectId)?.name ?? entry.subjectId
      const cancelled = entry.status === 'İptal'
      const manageable = writer && (session.role === 'yonetici' || entry.teacherId === own)
      return {
        id: entry.id,
        title: `${subject} · ${entry.topic}`,
        date: entry.date,
        when: `${dateLabel(entry.date)} ${timeLabel(entry.date)}`,
        teacher: state.teachers.find((t) => t.id === entry.teacherId)?.name ?? '—',
        room: entry.room,
        status: entry.status,
        studentCount: entry.studentIds.length,
        students: entry.studentIds.map((id) => ({
          id,
          name: state.students.find((s) => s.id === id)?.name ?? id,
          mark: entry.attendance[id] ?? '',
        })),
        cancelReason: entry.cancelReason ?? '',
        threshold: entry.threshold,
        manageable,
        attendanceOpen: manageable && !cancelled && Date.parse(entry.date) <= Date.parse(now),
        cancellable: manageable && entry.status === 'Planlandı',
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

/** Yoklama formunun başlangıç değerleri: kayıtlı işaret, yoksa "Geldi". */
export function attendanceDefaults(row: TutorRow): Record<string, AttendanceMark> {
  return Object.fromEntries(
    row.students.map((student) => [
      student.id,
      ATTENDANCE_MARKS.find((mark) => mark === student.mark) ?? 'Geldi',
    ]),
  )
}

export type PlanFormValues = {
  examId: string
  threshold: string
  fromDate: string
  toDate: string
  duration: string
  maxGroupSize: string
  branchId: string
  subjectId: string
}

const DAY_MS = 86_400_000

/** Plan formunun başlangıç değerleri: bugünden bir hafta, eşik %70, 30 dk, 6 öğrenci. */
export function defaultPlanValues(now: string, examId = ''): PlanFormValues {
  return {
    examId,
    threshold: '70',
    fromDate: dayKey(now),
    toDate: dayKey(Date.parse(now) + 7 * DAY_MS),
    duration: '30',
    maxGroupSize: '6',
    branchId: '',
    subjectId: '',
  }
}

export type PlanSessionRow = {
  key: string
  title: string
  when: string
  teacher: string
  room: string
  students: string
  capacity: string
  /** Grup kapasiteye ulaştı (en küçük: grup üst sınırı, derslik kapasitesi). */
  full: boolean
}

export type PlanUnresolvedRow = {
  key: string
  title: string
  students: string
  studentCount: number
  reason: string
}

export type PlanCoveredRow = { key: string; topic: string; students: string }

export type PlanView = {
  sessions: PlanSessionRow[]
  unresolved: PlanUnresolvedRow[]
  covered: PlanCoveredRow[]
  summary: {
    sessions: number
    students: number
    unresolvedGroups: number
    unresolvedStudents: number
    covered: number
    evaluatedStudents: number
  }
}

type Names = Pick<State, 'subjects' | 'teachers' | 'students'>

/**
 * Sunucu plan önizlemesini ekran satırlarına çevirir: öğretmen, ders ve öğrenci adları okunan
 * koleksiyonlardan gelir (önizleme yalnız kimlik döner). Plan hesabı sunucudadır; burada
 * yalnız sunum yapılır.
 */
export function planView(plan: TutoringPlanPreview, state: Names): PlanView {
  const subject = (id: string) => state.subjects.find((item) => item.id === id)?.name ?? id
  const teacher = (id: string) => state.teachers.find((item) => item.id === id)?.name ?? id
  const names = (ids: readonly string[]) =>
    ids.map((id) => state.students.find((item) => item.id === id)?.name ?? id).join(', ')
  return {
    sessions: plan.sessions.map((item, index) => ({
      key: `${item.subjectId}:${item.topic}:${item.date}:${item.teacherId}:${item.roomClassId}:${index}`,
      title: `${subject(item.subjectId)} · ${item.topic}`,
      when: `${dateLabel(item.date)} ${timeLabel(item.date)}`,
      teacher: teacher(item.teacherId),
      room: item.room,
      students: names(item.studentIds),
      capacity: `${item.studentIds.length}/${item.capacity}`,
      full: item.studentIds.length >= item.capacity,
    })),
    unresolved: plan.unresolved.map((item, index) => ({
      key: `${item.subjectId}:${item.topic}:${index}`,
      title: `${subject(item.subjectId)} · ${item.topic}`,
      students: names(item.studentIds),
      studentCount: item.studentIds.length,
      reason: item.reason,
    })),
    covered: coveredRows(plan, names),
    summary: {
      sessions: plan.summary.sessionCount,
      students: new Set(plan.sessions.flatMap((item) => item.studentIds)).size,
      unresolvedGroups: plan.summary.unresolvedGroupCount,
      unresolvedStudents: plan.summary.unresolvedStudentCount,
      covered: plan.summary.coveredCount,
      evaluatedStudents: plan.evaluatedStudents,
    },
  }
}

/** Zaten etütle karşılanan kazanımlar, kazanım başına öğrenci adlarıyla. */
function coveredRows(
  plan: TutoringPlanPreview,
  names: (ids: readonly string[]) => string,
): PlanCoveredRow[] {
  const byTopic = new Map<string, string[]>()
  for (const item of plan.covered) {
    const list = byTopic.get(item.topic) ?? []
    list.push(item.studentId)
    byTopic.set(item.topic, list)
  }
  return [...byTopic].map(([topic, ids]) => ({ key: topic, topic, students: names(ids) }))
}

export type PlanFields = Partial<Record<keyof PlanFormValues, string>>
export type PlanFailure = { message: string; fields: PlanFields }

/** Plan isteği: form değerleri sayıya çevrilir; bayat plan onayında `expectedPlan` eklenir. */
export function planRequest(values: PlanFormValues, expectedPlan?: string) {
  return {
    examId: values.examId,
    threshold: Number(values.threshold),
    fromDate: values.fromDate,
    toDate: values.toDate,
    duration: Number(values.duration),
    maxGroupSize: Number(values.maxGroupSize),
    branchId: values.branchId,
    subjectId: values.subjectId,
    ...(expectedPlan === undefined ? {} : { expectedPlan }),
  }
}

function fieldOf(path: readonly PropertyKey[], values: PlanFormValues) {
  const key = path[0]
  return typeof key === 'string' && key in values ? (key as keyof PlanFormValues) : undefined
}

/**
 * İstek göndermeden önce core Zod şemasıyla alan denetimi (sunucuyla aynı şema): geçerliyse
 * istek, değilse alan alan Türkçe ileti. Karar yine sunucunundur.
 */
export function checkPlanForm(
  values: PlanFormValues,
): { ok: true; request: ReturnType<typeof planRequest> } | { ok: false; failure: PlanFailure } {
  const request = planRequest(values)
  const parsed = automationSchemas.plan.safeParse(request)
  if (parsed.success) return { ok: true, request }
  const fields: PlanFields = {}
  for (const issue of parsed.error.issues) {
    const field = fieldOf(issue.path, values)
    if (field && !(field in fields)) fields[field] = issue.message
  }
  return { ok: false, failure: { message: 'Plan bilgilerini kontrol edin.', fields } }
}

const DATE_RANGE_CODES = new Set(['tutoring_date_range_invalid'])

/**
 * Sunucunun plan önizleme hatası (400 doğrulama maddeleri veya 422 iş kuralı) alan iletisine
 * çevrilir: Zod maddeleri alan adıyla, tarih ve ders kuralları ilgili alana, diğerleri deneme
 * alanına yazılır.
 */
export function planFailure(error: ApiError, values: PlanFormValues): PlanFailure {
  const fields: PlanFields = {}
  for (const issue of error.issues) {
    const field = fieldOf(issue.path, values)
    if (field && !(field in fields)) fields[field] = issue.message
  }
  if (Object.keys(fields).length > 0) return { message: 'Plan bilgilerini kontrol edin.', fields }
  const field: keyof PlanFormValues = DATE_RANGE_CODES.has(error.code)
    ? 'fromDate'
    : error.code === 'subject_out_of_scope'
      ? 'subjectId'
      : 'examId'
  return { message: error.message, fields: { [field]: error.message } }
}

// --- Öğretmen uygunluk saatleri ---------------------------------------------------------

/** Uygunluk sayfasının okuduğu koleksiyonlar; ilki ana koleksiyondur. */
export const AVAILABILITY_SOURCES = [
  'availability',
  'teachers',
] as const satisfies readonly CollectionName[]

export type AvailabilityRow = {
  id: string
  teacherId: string
  teacher: string
  date: string
  when: string
  duration: number
  /** Kaldırma düğmesi: yönetici herkesin, öğretmen kendi saatini (sunucu da zorlar). */
  manageable: boolean
  past: boolean
}

export function availabilityRows(state: State, session: Session, now: string): AvailabilityRow[] {
  const own = sessionTeacherId(state, session)
  const admin = session.role === 'yonetici'
  return state.availability
    .map((slot) => ({
      id: slot.id,
      teacherId: slot.teacherId,
      teacher: state.teachers.find((item) => item.id === slot.teacherId)?.name ?? slot.teacherId,
      date: slot.date,
      when: `${dateLabel(slot.date, { weekday: 'short', year: 'numeric' })} ${timeLabel(slot.date)}`,
      duration: slot.duration,
      manageable: admin || (own !== undefined && slot.teacherId === own),
      past: Date.parse(slot.date) <= Date.parse(now),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

export type SlotFormValues = { teacherId: string; date: string; duration: string }

/**
 * Formdaki yerel tarih-saat (`datetime-local`, Europe/Istanbul) ISO anına çevrilir; geçersiz
 * değer olduğu gibi kalır ve şema "Geçerli bir tarih ve saat seçin." der.
 */
export function slotRequest(values: SlotFormValues) {
  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(values.date)
  const iso = local ? new Date(`${values.date}:00+03:00`) : null
  return {
    teacherId: values.teacherId,
    date: iso && Number.isFinite(iso.getTime()) ? iso.toISOString() : values.date,
    duration: Number(values.duration),
  }
}

/** Kaydedilebilir öğretmenler: yönetici aktif öğretmenlerden seçer, öğretmen yalnız kendisi. */
export function slotTeachers(state: State, session: Session): { id: string; name: string }[] {
  const own = sessionTeacherId(state, session)
  return state.teachers
    .filter((teacher) => teacher.isActive && (session.role === 'yonetici' || teacher.id === own))
    .map((teacher) => ({ id: teacher.id, name: teacher.name }))
}
