// Otomatik etüt ekranının saf hesapları. Plan, çakışma ve kapsam kuralları core
// `lib/assessment-automation.ts` ve `lib/tutor-conflicts.ts`'tedir; burada ikinci kopya yazılmaz.
// Plan önizlemesi sunucuya yazmaz: aynı core `planTutoring` istemcide çalışır, son onayda
// sunucu planı yeniden hesaplar.
import { ZodError } from 'zod'
import type { State } from '@kampus/school-core/data/seed.ts'
import {
  planTutoring,
  tutoringSessions,
  type AttendanceMark,
} from '@kampus/school-core/lib/assessment-automation.ts'
import type { Session } from '@kampus/school-core/lib/domain.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { dateLabel, dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import { sessionTeacherId } from '@kampus/school-core/lib/scope.ts'
import { ASSESSMENT_COMMANDS } from '@kampus/school-core/modules/commands.ts'
import type { CollectionName } from '@kampus/school-core/modules/collection-modules.ts'

/** Etüt listesi: tüm roller kendi kapsamında okur (sunucu daraltır). İlki ana koleksiyondur. */
export const TUTORING_LIST_SOURCES = [
  'tutorSessions',
  'subjects',
  'branches',
] as const satisfies readonly CollectionName[]

/**
 * Plan önizlemesinin okuduğu koleksiyonlar: core komut tablosundaki `plan` listesi (deneme,
 * optik analiz, uygunluk, ders/randevu/etkinlik çakışma kaynakları). İlki ana koleksiyondur.
 */
export const TUTORING_PLAN_SOURCES: readonly CollectionName[] = [
  'mockExams',
  ...ASSESSMENT_COMMANDS.plan.collections,
]

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

export type PlanSummary = {
  sessions: number
  students: number
  unresolvedGroups: number
  unresolvedStudents: number
  covered: number
  evaluatedStudents: number
}

export type PlanSessionRow = {
  key: string
  title: string
  when: string
  teacher: string
  room: string
  students: string
  capacity: string
  full: boolean
}

export type PlanUnresolvedRow = { key: string; title: string; students: number; reason: string }

type Plan = ReturnType<typeof planTutoring>

export type PlanPreview =
  | {
      ok: true
      /** Sunucuya `expectedPlan` olarak gönderilen metin (core planının JSON'u). */
      signature: string
      summary: PlanSummary
      sessions: PlanSessionRow[]
      unresolved: PlanUnresolvedRow[]
      /** Kapasite ve zaman çakışması uyarıları. */
      warnings: string[]
    }
  | { ok: false; message: string; fields: Partial<Record<keyof PlanFormValues, string>> }

export function planSummary(plan: Plan): PlanSummary {
  return {
    sessions: plan.sessions.length,
    students: new Set(plan.sessions.flatMap((s) => s.studentIds)).size,
    unresolvedGroups: plan.unresolved.length,
    unresolvedStudents: plan.unresolved.reduce((sum, group) => sum + group.studentIds.length, 0),
    covered: plan.covered.length,
    evaluatedStudents: plan.evaluatedStudents,
  }
}

const DATE_RANGE_CODES = new Set(['tutoring_date_range_invalid'])

/**
 * Plan önizlemesi (saf; `planTutoring` kayıt oluşturmaz). Form hataları alan alan döner: Zod
 * maddeleri alan adıyla, core tarih/ders kuralı ilgili alana yazılır.
 */
export function previewPlan(
  state: State,
  session: Session,
  values: PlanFormValues,
  now: string,
): PlanPreview {
  try {
    const plan = planTutoring(state, session, values, now)
    const subjectName = (id: string) => state.subjects.find((s) => s.id === id)?.name ?? id
    const teacherName = (id: string) => state.teachers.find((t) => t.id === id)?.name ?? id
    const sessions = plan.sessions.map((s, index) => ({
      key: `${s.subjectId}:${s.topic}:${s.date}:${s.teacherId}:${s.roomClassId}:${index}`,
      title: `${subjectName(s.subjectId)} · ${s.topic}`,
      when: `${dateLabel(s.date)} ${timeLabel(s.date)}`,
      teacher: teacherName(s.teacherId),
      room: s.room,
      students: s.studentIds
        .map((id) => state.students.find((x) => x.id === id)?.name ?? id)
        .join(', '),
      capacity: `${s.studentIds.length}/${s.capacity}`,
      full: s.studentIds.length >= s.capacity,
    }))
    const unresolved = plan.unresolved.map((group, index) => ({
      key: `${group.subjectId}:${group.topic}:${index}`,
      title: `${subjectName(group.subjectId)} · ${group.topic}`,
      students: group.studentIds.length,
      reason: group.reason,
    }))
    const warnings = [
      ...sessions
        .filter((row) => row.full)
        .map(
          (row) =>
            `${row.title}: derslik kapasitesi doldu (${row.capacity}); kalan öğrenciler ayrı oturuma bölünür.`,
        ),
      ...unresolved.map(
        (row) => `${row.title}: ${row.students} öğrenci yerleşemedi. ${row.reason}`,
      ),
    ]
    return {
      ok: true,
      signature: JSON.stringify(plan),
      summary: planSummary(plan),
      sessions,
      unresolved,
      warnings,
    }
  } catch (error) {
    if (error instanceof ZodError) {
      const fields: Partial<Record<keyof PlanFormValues, string>> = {}
      for (const issue of error.issues) {
        const key = issue.path[0]
        if (typeof key === 'string' && key in values && !(key in fields))
          fields[key as keyof PlanFormValues] = issue.message
      }
      return { ok: false, message: 'Plan bilgilerini kontrol edin.', fields }
    }
    if (error instanceof DomainError) {
      const field: keyof PlanFormValues = DATE_RANGE_CODES.has(error.code)
        ? 'fromDate'
        : error.code === 'subject_out_of_scope'
          ? 'subjectId'
          : 'examId'
      return { ok: false, message: error.message, fields: { [field]: error.message } }
    }
    throw error
  }
}

/**
 * Onay sırasında sunucu planı değiştirdi (409): önceki ve güncel plan özeti kıyaslanır.
 * İki plan aynıysa `null` (fark yok).
 */
export function planDifference(before: PlanSummary, after: PlanSummary): string | null {
  const fields = [
    'sessions',
    'students',
    'unresolvedGroups',
    'unresolvedStudents',
    'covered',
  ] as const
  if (fields.every((field) => before[field] === after[field])) return null
  return `Önceki plan: ${before.sessions} etüt, ${before.students} öğrenci, ${before.unresolvedStudents} yerleşemeyen öğrenci. Güncel plan: ${after.sessions} etüt, ${after.students} öğrenci, ${after.unresolvedStudents} yerleşemeyen öğrenci.`
}

/** Plan onayı isteği: form değerleri (sayıya çevrilmiş) ve verilmişse önizlemedeki plan. */
export function planRequest(values: PlanFormValues, signature: string | null) {
  return {
    examId: values.examId,
    threshold: Number(values.threshold),
    fromDate: values.fromDate,
    toDate: values.toDate,
    duration: Number(values.duration),
    maxGroupSize: Number(values.maxGroupSize),
    branchId: values.branchId,
    subjectId: values.subjectId,
    ...(signature === null ? {} : { expectedPlan: signature }),
  }
}

/**
 * `expectedPlan` yalnız yöneticide gönderilir: öğretmenin okuduğu ders/randevu/etkinlik kayıtları
 * kendi kapsamına daraltıldığı için istemci planı sunucunun (tüm kurum) planından farklı çıkabilir
 * ve her onay "plan değişmiş" olurdu. Öğretmende sunucu planı yeniden hesaplayıp yazar.
 */
export function sendsExpectedPlan(session: Pick<Session, 'role'>): boolean {
  return session.role === 'yonetici'
}
