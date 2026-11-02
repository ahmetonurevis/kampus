import { z } from 'zod'
import { subjectsForGrade } from '../data/curriculum.ts'
import type { State } from '../data/seed.ts'
import { WORKFLOW_COMMANDS, isWorkflowCommand, type WorkflowCommand } from '../modules/commands.ts'
import type { Role } from '../modules/navigation.ts'
import { appointmentHoldsTime } from './appointment-status.ts'
import { toAuditValue, type AuditValue, type RecordAuditEntry } from './audit.ts'
import { installmentAmounts, type MakeId, type Session } from './domain.ts'
import { dayKey } from './format.ts'
import { tutorConflict, type Interval } from './tutor-conflicts.ts'
import { DomainError } from './errors.ts'
import {
  DEMO_PARENT_ID,
  DEMO_STUDENT_ID,
  linkedRecordId,
  scopeFor,
  sessionActor,
  sessionTeacherId,
} from './scope.ts'

z.config(z.locales.tr())
const text = z.string().trim().min(2, 'En az iki karakter girin.').max(2000)
const identifier = z.string().min(1, 'Bir kayıt seçin.')
const integer = (min: number, max: number) => z.coerce.number().int().min(min).max(max)
const day = z
  .string()
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      Number.isFinite(Date.parse(`${v}T09:00:00Z`)) &&
      new Date(`${v}T09:00:00Z`).toISOString().slice(0, 10) === v,
    'Geçerli bir tarih seçin.',
  )
const instant = z
  .string()
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}T/.test(v) &&
      day.safeParse(v.slice(0, 10)).success &&
      /(Z|[+-]\d{2}:\d{2})$/.test(v) &&
      Number.isFinite(Date.parse(v)),
    'Geçerli bir tarih ve saat seçin.',
  )
const optionalText = z.string().trim().max(2000).default('')
const list = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => [
    ...new Set(
      v
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ])
export const workflowSchemas = {
  guidance: z.object({
    studentId: identifier,
    teacherId: identifier,
    title: text,
    plan: text,
    sharedNote: optionalText,
    internalNote: optionalText,
    followUp: day,
  }),
  'guidance-note': z.object({
    text,
    sharedNote: optionalText,
    followUp: day,
    status: z.enum(['Takipte', 'Tamamlandı']),
  }),
  goal: z.object({
    studentId: identifier,
    subjectId: z.string(),
    title: text.max(120),
    targetNet: z.coerce
      .number()
      .min(1, 'Hedef net en az 1 olmalıdır.')
      .max(500)
      .refine(
        (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
        'Hedef net en fazla iki ondalık basamak içerebilir.',
      ),
    deadline: day,
    motivation: optionalText,
  }),
  'goal-review': z
    .object({ status: z.enum(['Aktif', 'Reddedildi']), feedback: optionalText })
    .refine((v) => v.status === 'Aktif' || v.feedback.length >= 2, {
      message: 'Reddetme gerekçesini yazın.',
      path: ['feedback'],
    }),
  'goal-step': z.object({ title: text.max(160), topic: optionalText, dueDate: day }),
  'goal-step-done': z.object({ stepId: identifier }),
  'goal-suggest': z.object({}),
  'goal-comment': z.object({ text }),
  'goal-close': z.object({}),
  exam: z.object({
    title: text,
    type: z.enum(['LGS', 'YKS', 'Okul denemesi']),
    grade: integer(5, 12),
    wrongPenalty: integer(0, 10),
    date: day,
    subjectIds: z.array(identifier).min(1, 'En az bir ders seçin.'),
  }),
  'exam-result': z.object({
    examId: identifier,
    studentId: identifier,
    subjectId: identifier,
    correct: integer(0, 200),
    wrong: integer(0, 200),
    blank: integer(0, 200),
    weakTopics: list,
  }),
  'exam-import': z.object({
    csv: z
      .string()
      .trim()
      .min(2, 'CSV içeriğini girin.')
      .refine(
        (v) => new TextEncoder().encode(v).length <= 1024 * 1024,
        'CSV en fazla 1 MB olabilir.',
      ),
  }),
  renewal: z.object({
    studentId: identifier,
    targetClassId: z.string(),
    year: integer(2020, 2100),
    mode: z.enum(['renew', 'graduate']),
    total: z.coerce
      .number()
      .min(100)
      .max(1000000)
      .refine(
        (v) =>
          Number.isSafeInteger(Math.round(v * 100)) &&
          Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
        'Tutar en fazla iki ondalık basamak içerebilir.',
      ),
    scholarship: integer(0, 100),
    discount: z.coerce
      .number()
      .min(0)
      .max(1000000)
      .refine(
        (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
        'İndirim en fazla iki ondalık basamak içerebilir.',
      ),
    count: integer(1, 12),
    startDate: day,
  }),
  lesson: z.object({
    classId: identifier,
    teacherId: identifier,
    subjectId: identifier,
    date: instant,
    duration: integer(10, 180),
    room: text.max(80),
  }),
  // Gerekçe denetim kaydına da yazılır (`audit_log.reason`, en çok 500 karakter; DOM-YTK-069).
  substitute: z.object({ teacherId: identifier, reason: text.max(500) }),
  'lesson-cancel': z.object({ reason: text.max(500) }),
  'study-task': z.object({
    studentId: identifier,
    subjectId: identifier,
    topic: text,
    title: text,
    instructions: text,
    dueDate: day,
    minutes: integer(5, 240),
  }),
  'study-complete': z.object({ completionNote: text }),
  'study-review': z.object({
    feedback: text,
    status: z.enum(['Onaylandı', 'Tamamlandı', 'Tekrar çalışılacak']),
  }),
  event: z.object({
    title: text,
    classId: z.string(),
    branchId: identifier,
    date: instant,
    endDate: instant,
    location: text,
    description: text,
    requiresConsent: z.coerce.boolean(),
    consentDeadline: day,
  }),
  consent: z.object({ decision: z.enum(['Onaylandı', 'Reddedildi']), note: optionalText }),
  route: z.object({
    title: text,
    branchId: identifier,
    plate: text.max(30),
    driver: text.max(80),
    phone: z.string().regex(/^0\d{10}$/, 'Telefonu 05XXXXXXXXX biçiminde girin.'),
    capacity: integer(1, 100),
    stops: list.refine((v) => v.length > 0, 'En az bir durak yazın.'),
  }),
  'transport-assign': z.object({ studentId: identifier, routeId: identifier, stop: identifier }),
  meal: z.object({
    branchId: identifier,
    date: day,
    title: text,
    allergens: text,
    description: optionalText,
  }),
  club: z.object({
    title: text,
    branchId: identifier,
    teacherId: identifier,
    capacity: integer(1, 100),
    description: text,
    meeting: text,
  }),
  'club-enroll': z.object({ studentId: identifier }),
  'club-attendance': z.object({
    date: day,
    marks: z.record(identifier, z.enum(['Geldi', 'Gelmedi', 'İzinli'])),
  }),
  achievement: z.object({
    studentId: identifier,
    clubId: identifier,
    title: text,
    description: text,
    date: day,
  }),
}
type WorkflowSchemas = typeof workflowSchemas
export type WorkflowInput<C extends keyof WorkflowSchemas> = z.output<WorkflowSchemas[C]>
type Stamp = { id: string; createdAt: string; updatedAt: string }
// Kayıt tipleri State'e bağlı değildir; State bunları örnek veride boş başlayan koleksiyonlar için kullanır.
export type GuidanceNote = Pick<WorkflowInput<'guidance-note'>, 'text'> & {
  id: string
  date: string
  actor: Role
}
export type GoalStep = Pick<WorkflowInput<'goal-step'>, 'title' | 'topic'> & {
  id: string
  dueDate: string
  done: boolean
  doneAt?: string
  source: string
}
export type GoalComment = WorkflowInput<'goal-comment'> & { id: string; date: string; actor: Role }
export type LessonSubstitution = Pick<WorkflowInput<'substitute'>, 'reason'> & {
  fromTeacherId: string
  toTeacherId: string
  date: string
}
export type RenewalQuote = ReturnType<typeof renewalQuote>
type RenewalKey = 'studentId' | 'targetClassId' | 'year' | 'mode'
// Mezuniyet kaydı ücret ve sözleşme üretmez; ücret, taksit ve sözleşme alanları yalnız yenilemede bulunur.
export type Renewal = Stamp &
  Pick<WorkflowInput<'renewal'>, RenewalKey> &
  Pick<RenewalQuote, 'amount'> &
  Partial<
    Omit<WorkflowInput<'renewal'>, RenewalKey> &
      Omit<RenewalQuote, 'amount'> & { contractId: string }
  > & { fromClassId: string; status: string; activatedAt?: string }
export type EnrollmentRecord = Stamp & {
  studentId: string
  classId: string
  year: number
  endedAt: string
}
export type EventConsent = WorkflowInput<'consent'> &
  Stamp & { eventId: string; studentId: string; parentId: string }
export type ClubAttendanceRecord = Stamp & {
  clubId: string
  studentId: string
  date: string
  status: WorkflowInput<'club-attendance'>['marks'][string]
}
// Denetim kaydı tipleri `lib/audit.ts` içindedir; eski içe aktarımlar için buradan da verilir.
export type { AuditEntry, AuditValue, JsonValue, RecordAuditEntry } from './audit.ts'
export type { WorkflowCommand }
const commandRoles: Partial<Record<string, readonly Role[]>> = {
  goal: ['yonetici', 'ogretmen', 'ogrenci'],
  'goal-review': ['yonetici', 'ogretmen'],
  'goal-step': ['yonetici', 'ogretmen', 'ogrenci'],
  'goal-step-done': ['ogrenci'],
  'goal-suggest': ['yonetici', 'ogretmen', 'ogrenci'],
  'goal-comment': ['yonetici', 'ogretmen', 'veli'],
  'goal-close': ['yonetici', 'ogretmen', 'ogrenci'],
  guidance: ['yonetici', 'ogretmen'],
  // İç notun tek yazarı rehberlik görevli öğretmendir (DOM-YTK-026, DOM-ILT-040).
  'guidance-note': ['ogretmen'],
  exam: ['yonetici', 'ogretmen'],
  'exam-result': ['yonetici', 'ogretmen'],
  'exam-import': ['yonetici', 'ogretmen'],
  renewal: ['yonetici', 'onburo'],
  'renewal-activate': ['yonetici', 'onburo'],
  lesson: ['yonetici'],
  substitute: ['yonetici'],
  'lesson-cancel': ['yonetici'],
  'study-task': ['yonetici', 'ogretmen', 'ogrenci'],
  'study-complete': ['ogrenci'],
  'study-review': ['yonetici', 'ogretmen'],
  event: ['yonetici', 'onburo', 'ogretmen'],
  consent: ['veli'],
  'event-cancel': ['yonetici', 'onburo', 'ogretmen'],
  route: ['yonetici', 'onburo'],
  'route-archive': ['yonetici', 'onburo'],
  'transport-assign': ['yonetici', 'onburo'],
  'transport-remove': ['yonetici', 'onburo'],
  meal: ['yonetici', 'onburo'],
  club: ['yonetici', 'ogretmen'],
  'club-enroll': ['yonetici', 'ogretmen', 'ogrenci', 'veli'],
  'club-leave': ['yonetici', 'ogretmen', 'ogrenci', 'veli'],
  'club-attendance': ['yonetici', 'ogretmen'],
  achievement: ['yonetici', 'ogretmen'],
  'club-archive': ['yonetici', 'ogretmen'],
}
export function mayRun(session: Session, command: string) {
  // Komut adı dışarıdan gelir; `toString` gibi yerleşik özellikler tabloda yok sayılır.
  if (!Object.hasOwn(commandRoles, command)) return false
  return !!commandRoles[command]?.includes(session.role)
}
/**
 * İş akışı ekranlarının kapsamı: `scopeFor` sonucunun demo ve form ihtiyaçlarına göre biçimi.
 * Veli kapsamı seçili çocukla daraltılır; seçim bağlı çocuklardan biri değilse boştur
 * (DOM-YTK-002). `student` öğrencinin kendisi veya velinin seçili çocuğudur.
 */
export function workflowScope(state: State, session: Session) {
  const actor = sessionActor(state, session)
  const scope = scopeFor(state, actor)
  const studentId =
    session.role === 'veli'
      ? session.childId
      : (linkedRecordId(actor, 'student') ?? DEMO_STUDENT_ID)
  const student = state.students.find((s) => s.id === studentId)
  const studentIds: ReadonlySet<string> =
    session.role === 'veli'
      ? new Set(studentId !== undefined && scope.studentIds.has(studentId) ? [studentId] : [])
      : scope.studentIds
  const permitted = state.students.filter((s) => studentIds.has(s.id))
  return {
    student,
    students: permitted.filter((s) => s.isActive),
    studentIds,
    classIds: scope.classIds,
    institution: session.role === 'yonetici' || session.role === 'onburo',
    teacher: scope.teacher,
    scope,
  }
}
function requireRecord<T extends { id: string }>(list: readonly T[], id: string | undefined) {
  const value = list.find((r) => r.id === id)
  if (!value)
    throw new DomainError('record_not_found', 'İlgili kayıt bulunamadı. Listeyi yenileyin.', {
      kind: 'not_found',
    })
  return value
}
function active<
  T extends { id: string; isActive?: boolean; deletedAt?: string | null; status?: string },
>(list: readonly T[], id: string | undefined) {
  const record = requireRecord(list, id)
  if (record.isActive === false || record.deletedAt || record.status === 'Arşiv')
    throw new DomainError('record_inactive', 'Pasif veya arşivlenmiş kayıt kullanılamaz.')
  return record
}
const studentScopeDenied = () =>
  new DomainError('student_scope_denied', 'Bu öğrenci için işlem yetkiniz bulunmuyor.', {
    kind: 'forbidden',
  })
/**
 * Kapsamdaki etkin öğrenci. Kurum kapsamı olmayan rol (öğretmen, veli, öğrenci) için kapsam
 * kayıt durumundan önce denetlenir: kapsam dışı öğrenci var olsun olmasın, pasif olsun olmasın
 * 403 `student_scope_denied` alır; böylece kısıtlı ya da velayeti olmayan veli (`DOM-ILT-070`,
 * `DOM-ILT-074`) çocuğun kaydının varlığını ve pasifliğini 404/422 farkından öğrenemez (OG-032).
 * Yönetici ve ön büro kurumun bütün kayıtlarını zaten görür; onlarda olmayan kayıt 404 kalır.
 */
function scopedStudent(state: State, session: Session, id: string | undefined) {
  const scope = workflowScope(state, session)
  if (!scope.institution && (id === undefined || !scope.studentIds.has(id)))
    throw studentScopeDenied()
  const student = active(state.students, id)
  // Bulunan öğrencinin kimliği aranan kimlikle aynıdır.
  if (!scope.studentIds.has(student.id)) throw studentScopeDenied()
  return student
}
function gradeOf(state: State, student: { classId: string }) {
  return requireRecord(state.classes, student.classId).grade
}
function stamped<T extends object>(makeId: MakeId, prefix: string, data: T, now: string) {
  return { id: makeId(prefix), ...data, createdAt: now, updatedAt: now }
}
function atDay(value: string) {
  return `${value}T09:00:00.000Z`
}
type Goal = State['studentGoals'][number]
export function examNet(
  result: { correct: number; wrong: number },
  exam: { wrongPenalty: number },
) {
  return (
    Math.round(
      (result.correct - (exam.wrongPenalty ? result.wrong / exam.wrongPenalty : 0)) * 100,
    ) / 100
  )
}
export function examProgress(state: State, studentId: string) {
  return state.mockExams
    .filter((e) => state.mockResults.some((r) => r.examId === e.id && r.studentId === studentId))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((exam) => {
      const results = state.mockResults.filter(
        (r) => r.examId === exam.id && r.studentId === studentId,
      )
      return {
        ...exam,
        net: Math.round(results.reduce((sum, r) => sum + examNet(r, exam), 0) * 100) / 100,
        complete: exam.subjectIds.every((id) => results.some((r) => r.subjectId === id)),
        results,
      }
    })
}
const round2 = (value: number) => Math.round(value * 100) / 100
const OPEN_GOAL_STATUSES: readonly string[] = ['Onay bekliyor', 'Aktif']
// Hedefin ders/genel net serisi: yalnızca ilgili öğrencinin deneme sonuçlarından türetilir.
export function goalSeries(state: State, studentId: string, subjectId?: string) {
  return examProgress(state, studentId).flatMap((exam) => {
    const point = { examId: exam.id, title: exam.title, date: exam.date }
    if (!subjectId) return exam.complete ? [{ ...point, net: exam.net }] : []
    const results = exam.results.filter((r) => r.subjectId === subjectId)
    if (!results.length) return []
    return [{ ...point, net: round2(results.reduce((sum, r) => sum + examNet(r, exam), 0)) }]
  })
}
export function goalProgress(state: State, goal: Goal) {
  const series = goalSeries(state, goal.studentId, goal.subjectId)
  const last = series[series.length - 1]
  const current = last ? last.net : null
  const achieved = current !== null && current >= goal.targetNet
  const span = goal.targetNet - goal.baselineNet
  const percent = achieved
    ? 100
    : current === null || span <= 0
      ? 0
      : Math.min(100, Math.max(0, Math.round(((current - goal.baselineNet) / span) * 100)))
  return {
    series,
    current,
    achieved,
    percent,
    stepsDone: goal.steps.filter((s) => s.done).length,
    stepsTotal: goal.steps.length,
  }
}
// Zayıf konulardan haftalık adım önerileri üretir; mevcut adımlarda olan konular tekrarlanmaz.
export function suggestGoalSteps(state: State, goal: Goal, now = new Date().toISOString()) {
  const known = new Set(goal.steps.map((s) => s.topic.toLocaleLowerCase('tr-TR')).filter(Boolean))
  const picked: { topic: string; subjectName: string }[] = []
  for (const result of state.mockResults) {
    if (result.studentId !== goal.studentId) continue
    if (goal.subjectId && result.subjectId !== goal.subjectId) continue
    const subjectName = state.subjects.find((s) => s.id === result.subjectId)?.name || ''
    for (const topic of result.weakTopics) {
      const key = topic.toLocaleLowerCase('tr-TR')
      if (known.has(key)) continue
      known.add(key)
      picked.push({ topic, subjectName })
    }
  }
  const deadline = goal.deadline.slice(0, 10)
  return picked.slice(0, 4).map(({ topic, subjectName }, index) => {
    const weekly = dayKey(new Date(new Date(now).getTime() + (index + 1) * 7 * 86400000))
    return {
      title: goal.subjectId ? `${topic} konu tekrarı` : `${subjectName} · ${topic} konu tekrarı`,
      topic,
      dueDate: atDay(weekly < deadline ? weekly : deadline),
      source: 'auto',
    }
  })
}
function goalRecord(state: State, session: Session, recordId: string | undefined) {
  const goal = requireRecord(state.studentGoals, recordId)
  scopedStudent(state, session, goal.studentId)
  if (
    session.role === 'ogretmen' &&
    goal.subjectId &&
    goal.subjectId !==
      state.teachers.find((t) => t.id === sessionTeacherId(state, session))?.subjectId
  )
    throw new DomainError('goal_branch_mismatch', 'Bu hedef başka bir branşa ait.', {
      kind: 'forbidden',
    })
  return goal
}
function openGoalRecord(state: State, session: Session, recordId: string | undefined) {
  const goal = goalRecord(state, session, recordId)
  if (!OPEN_GOAL_STATUSES.includes(goal.status))
    throw new DomainError(
      'goal_closed',
      'Reddedilmiş veya kapatılmış hedef üzerinde işlem yapılamaz.',
    )
  return goal
}
export function renewalQuote(input: unknown) {
  const data = workflowSchemas.renewal.parse(input)
  const gross = Math.round(data.total * 100)
  const scholarshipAmount = Math.round((gross * data.scholarship) / 100)
  const discountAmount = Math.round(data.discount * 100)
  const amount = gross - scholarshipAmount - discountAmount
  if (amount < 10000)
    throw new DomainError(
      'renewal_amount_too_low',
      'Burs ve indirim sonrası eğitim bedeli en az 100 ₺ olmalıdır.',
    )
  return {
    gross,
    scholarshipAmount,
    discountAmount,
    amount,
    installments: installmentAmounts(amount, data.count),
  }
}
function overlaps(a: Interval, b: Interval) {
  return (
    Date.parse(a.date) < Date.parse(b.date) + (b.duration || 30) * 60000 &&
    Date.parse(b.date) < Date.parse(a.date) + (a.duration || 30) * 60000
  )
}
type LessonSlot = Pick<
  WorkflowInput<'lesson'>,
  'classId' | 'teacherId' | 'subjectId' | 'date' | 'duration' | 'room'
>
function validateLesson(state: State, data: LessonSlot, ignoreId: string | undefined) {
  const classroom = active(state.classes, data.classId)
  active(state.branches, classroom.branchId)
  const teacher = active(state.teachers, data.teacherId)
  const tutorReason = tutorConflict(
    { ...state, schedule: [], appointments: [], schoolEvents: [] },
    {
      ...data,
      branchId: classroom.branchId,
      studentIds: state.students
        .filter((s) => s.isActive && s.classId === classroom.id)
        .map((s) => s.id),
    },
  )
  if (tutorReason)
    throw new DomainError('tutor_schedule_conflict', tutorReason, { kind: 'conflict' })
  if (
    teacher.subjectId !== data.subjectId ||
    teacher.branchId !== classroom.branchId ||
    !state.assignments.some((a) => a.classId === classroom.id && a.subjectId === data.subjectId)
  )
    throw new DomainError(
      'lesson_teacher_mismatch',
      'Öğretmenin branşı ve kampüsü seçilen derse uygun olmalıdır.',
    )
  for (const lesson of state.schedule) {
    if (lesson.id === ignoreId || lesson.cancelledAt || !overlaps(data, lesson)) continue
    const otherClass = requireRecord(state.classes, lesson.classId)
    if (lesson.teacherId === data.teacherId)
      throw new DomainError('teacher_lesson_conflict', 'Öğretmenin bu saatte başka dersi var.', {
        kind: 'conflict',
      })
    if (lesson.classId === data.classId)
      throw new DomainError('class_lesson_conflict', 'Sınıfın bu saatte başka dersi var.', {
        kind: 'conflict',
      })
    if (
      otherClass.branchId === classroom.branchId &&
      lesson.room.trim().toLocaleLowerCase('tr') === data.room.trim().toLocaleLowerCase('tr')
    )
      throw new DomainError(
        'room_conflict',
        'Derslik bu saatte başka bir sınıf tarafından kullanılıyor.',
        { kind: 'conflict' },
      )
  }
  if (
    state.appointments.some(
      (a) => a.teacherId === data.teacherId && appointmentHoldsTime(a) && overlaps(data, a),
    )
  )
    throw new DomainError(
      'teacher_appointment_conflict',
      'Öğretmenin bu saatte görüşme randevusu var.',
      { kind: 'conflict' },
    )
  // Öğretmenin sorumlu olduğu (iptal edilmemiş) okul etkinliği de onu meşgul eder (DOM-YTK-069).
  if (
    (state.schoolEvents || []).some(
      (e) =>
        e.status !== 'İptal' &&
        e.teacherId === data.teacherId &&
        overlaps(data, {
          date: e.date,
          duration: (Date.parse(e.endDate) - Date.parse(e.date)) / 60000,
        }),
    )
  )
    throw new DomainError('teacher_event_conflict', 'Öğretmenin bu saatte okul etkinliği var.', {
      kind: 'conflict',
    })
}
/**
 * Başlamış veya geçmiş ders değişmez: düzenlenmez, yedek atanmaz, iptal edilmez; ders geçmiş
 * saate planlanmaz (DOM-YTK-069). Ders başlangıcı işlem anına eşit ya da önceyse geçmiştir.
 */
function requireUpcomingLesson(date: string, now: string, message: string) {
  if (Date.parse(date) <= Date.parse(now)) throw new DomainError('lesson_in_past', message)
}
function validateExamResult(state: State, session: Session, input: unknown) {
  const data = workflowSchemas['exam-result'].parse(input)
  const student = scopedStudent(state, session, data.studentId),
    exam = requireRecord(state.mockExams, data.examId)
  if (gradeOf(state, student) !== exam.grade)
    throw new DomainError('exam_level_mismatch', 'Öğrencinin sınıf düzeyi sınavla aynı olmalıdır.')
  if (!exam.subjectIds.includes(data.subjectId))
    throw new DomainError('exam_subject_out_of_scope', 'Ders bu denemenin kapsamında değil.')
  if (
    session.role === 'ogretmen' &&
    active(state.teachers, sessionTeacherId(state, session)).subjectId !== data.subjectId
  )
    throw new DomainError(
      'exam_branch_forbidden',
      'Yalnızca kendi branşınızın sonuçlarını girebilirsiniz.',
      { kind: 'forbidden' },
    )
  if (data.correct + data.wrong + data.blank < 1 || data.correct + data.wrong + data.blank > 200)
    throw new DomainError(
      'exam_question_total_invalid',
      'Ders soru toplamı 1–200 arasında olmalıdır.',
    )
  return data
}
function upsertResult(
  state: State,
  data: WorkflowInput<'exam-result'>,
  makeId: MakeId,
  now: string,
) {
  const previous = state.mockResults.find(
    (r) =>
      r.examId === data.examId && r.studentId === data.studentId && r.subjectId === data.subjectId,
  )
  if (previous)
    Object.assign(previous, data, { updatedAt: now, source: 'manual', evaluationId: null })
  else state.mockResults.push(stamped(makeId, 'result', data, now))
}
// CSV Excel'den UTF-8 olarak kaydedilebilir; tırnaklı hücre ve satır sonları desteklenir.
export function parseResultsCsv(raw: string) {
  const source = raw.replace(/^\uFEFF/, '')
  // split en az bir öğe döndürür; varsayılan değer yalnız tip içindir.
  const [firstLine = ''] = source.split(/\r?\n/, 1)
  const separator = firstLine.includes(';') ? ';' : ','
  const rows: string[][] = [],
    row: string[] = []
  let cell = '',
    quoted = false
  for (let i = 0; i <= source.length; i++) {
    const char = source[i]
    if (char === '"') {
      if (quoted && source[i + 1] === '"') {
        cell += '"'
        i++
      } else quoted = !quoted
    } else if (!quoted && (char === separator || char === '\n' || char === undefined)) {
      row.push(cell.trim())
      cell = ''
      if (char !== separator) {
        if (row.some(Boolean)) rows.push([...row])
        row.length = 0
      }
    } else if (char !== '\r' && char !== undefined) cell += char
  }
  if (quoted) throw new DomainError('csv_unclosed_quote', 'CSV içinde kapanmamış tırnak var.')
  const header = ['examId', 'studentId', 'subjectId', 'correct', 'wrong', 'blank', 'weakTopics']
  const [headerRow] = rows
  if (!headerRow || headerRow.join('|') !== header.join('|'))
    throw new DomainError('csv_invalid_header', 'CSV başlıkları örnek şablonla aynı olmalıdır.')
  if (rows.length < 2 || rows.length > 1001)
    throw new DomainError('csv_invalid_row_count', 'Bir aktarımda 1–1000 sonuç satırı olmalıdır.')
  return rows.slice(1).map((values, index) => {
    if (values.length !== header.length || values.slice(3, 6).some((v) => !/^\d+$/.test(v)))
      throw new DomainError(
        'csv_invalid_column_count',
        `CSV ${index + 2}. satır: sütun sayısı veya sayısal değerler geçersiz.`,
      )
    return Object.fromEntries(header.map((key, i) => [key, values[i]]))
  })
}
export function eventStudents(state: State, event: { classId?: string | null; branchId: string }) {
  return state.students.filter(
    (s) =>
      s.isActive &&
      (!event.classId || s.classId === event.classId) &&
      state.classes.find((c) => c.id === s.classId)?.branchId === event.branchId,
  )
}
function ownedClub(state: State, session: Session, recordId: string | undefined) {
  const club = active(state.clubs, recordId)
  if (session.role === 'ogretmen' && club.teacherId !== sessionTeacherId(state, session))
    throw new DomainError('club_own_only', 'Yalnızca sorumlu olduğunuz kulübü yönetebilirsiniz.', {
      kind: 'forbidden',
    })
  return club
}
/**
 * İş akışı komutlarının yürütücüleri. Her komut kendi dalıdır; dönüş tipi komut → sonuç tipini
 * verir (`WorkflowResult`). Ortak denetimler (modül, rol, öğretmen) `executeWorkflow` içindedir.
 */
function workflowHandlers(
  state: State,
  session: Session,
  input: unknown,
  makeId: MakeId,
  recordId: string | undefined,
  now: string,
  teacherId: string | undefined,
) {
  return {
    goal: () => {
      const data = workflowSchemas.goal.parse(input)
      const student = scopedStudent(state, session, data.studentId)
      if (data.deadline < dayKey(now))
        throw new DomainError('goal_due_date_past', 'Hedef son tarihi geçmişte olamaz.')
      if (
        data.subjectId &&
        !subjectsForGrade(gradeOf(state, student)).some((s) => s.id === data.subjectId)
      )
        throw new DomainError(
          'goal_subject_level_mismatch',
          'Seçilen ders öğrencinin sınıf düzeyine uygun değil.',
        )
      if (
        session.role === 'ogretmen' &&
        data.subjectId !== state.teachers.find((t) => t.id === teacherId)?.subjectId
      )
        throw new DomainError(
          'goal_own_subject_only',
          'Yalnızca kendi dersiniz için hedef belirleyebilirsiniz.',
          { kind: 'forbidden' },
        )
      if (
        state.studentGoals.some(
          (g) =>
            g.studentId === data.studentId &&
            g.subjectId === data.subjectId &&
            OPEN_GOAL_STATUSES.includes(g.status),
        )
      )
        throw new DomainError(
          'goal_already_open',
          'Bu kapsam için açık bir hedef zaten var. Önce mevcut hedefi kapatın.',
          { kind: 'conflict' },
        )
      const series = goalSeries(state, data.studentId, data.subjectId)
      const last = series[series.length - 1]
      const baselineNet = last ? last.net : 0
      if (data.targetNet <= baselineNet)
        throw new DomainError(
          'goal_target_net_too_low',
          `Hedef net, mevcut net değerinin (${baselineNet}) üzerinde olmalıdır.`,
        )
      const entry = stamped(
        makeId,
        'goal',
        {
          ...data,
          deadline: atDay(data.deadline),
          baselineNet,
          status: session.role === 'ogrenci' ? 'Onay bekliyor' : 'Aktif',
          feedback: '',
          steps: [],
          comments: [],
        },
        now,
      )
      state.studentGoals.unshift(entry)
      return entry
    },
    'goal-review': () => {
      const data = workflowSchemas['goal-review'].parse(input)
      const entry = goalRecord(state, session, recordId)
      if (entry.status !== 'Onay bekliyor')
        throw new DomainError('goal_not_pending', 'Yalnızca onay bekleyen hedef değerlendirilir.')
      Object.assign(entry, data, { reviewedAt: now, updatedAt: now })
      return entry
    },
    'goal-step': () => {
      const data = workflowSchemas['goal-step'].parse(input)
      const entry = openGoalRecord(state, session, recordId)
      if (data.dueDate < dayKey(now))
        throw new DomainError('step_due_date_past', 'Adım son tarihi geçmişte olamaz.')
      if (data.dueDate > entry.deadline.slice(0, 10))
        throw new DomainError(
          'step_due_date_after_goal',
          'Adım son tarihi hedef son tarihinden sonra olamaz.',
        )
      if (entry.steps.length >= 30)
        throw new DomainError('goal_step_limit', 'Bir hedefe en fazla 30 adım eklenebilir.')
      entry.steps.push({
        id: makeId('step'),
        title: data.title,
        topic: data.topic,
        dueDate: atDay(data.dueDate),
        done: false,
        source: 'manual',
      })
      entry.updatedAt = now
      return entry
    },
    'goal-step-done': () => {
      const data = workflowSchemas['goal-step-done'].parse(input)
      const entry = openGoalRecord(state, session, recordId)
      if (entry.status !== 'Aktif')
        throw new DomainError(
          'goal_not_approved',
          'Adımlar hedef onaylandıktan sonra tamamlanabilir.',
        )
      const step = entry.steps.find((s) => s.id === data.stepId)
      if (!step)
        throw new DomainError('step_not_found', 'Gelişim adımı bulunamadı. Listeyi yenileyin.', {
          kind: 'not_found',
        })
      if (step.done)
        throw new DomainError('step_already_completed', 'Bu adım zaten tamamlanmış.', {
          kind: 'conflict',
        })
      Object.assign(step, { done: true, doneAt: now })
      entry.updatedAt = now
      return entry
    },
    'goal-suggest': () => {
      workflowSchemas['goal-suggest'].parse(input)
      const entry = openGoalRecord(state, session, recordId)
      const suggestions = suggestGoalSteps(state, entry, now)
      if (!suggestions.length)
        throw new DomainError(
          'goal_no_suggestions',
          'Önerilecek yeni zayıf konu bulunamadı. Deneme sonucu girildiğinde tekrar deneyin.',
        )
      if (entry.steps.length + suggestions.length > 30)
        throw new DomainError('goal_step_limit', 'Bir hedefe en fazla 30 adım eklenebilir.')
      for (const suggestion of suggestions)
        entry.steps.push({ id: makeId('step'), ...suggestion, done: false })
      entry.updatedAt = now
      return entry
    },
    'goal-comment': () => {
      const data = workflowSchemas['goal-comment'].parse(input)
      const entry = goalRecord(state, session, recordId)
      entry.comments.push({
        id: makeId('comment'),
        text: data.text,
        date: now,
        actor: session.role,
      })
      entry.updatedAt = now
      return entry
    },
    'goal-close': () => {
      workflowSchemas['goal-close'].parse(input)
      const entry = openGoalRecord(state, session, recordId)
      Object.assign(entry, { status: 'Kapatıldı', closedAt: now, updatedAt: now })
      return entry
    },
    guidance: () => {
      const data = workflowSchemas.guidance.parse(input)
      scopedStudent(state, session, data.studentId)
      active(state.teachers, data.teacherId)
      if (data.internalNote && !workflowScope(state, session).scope.counselor)
        throw new DomainError(
          'guidance_counselor_only',
          'Kurum içi notu yalnız rehberlik görevli öğretmen yazabilir.',
          { kind: 'forbidden', path: ['internalNote'] },
        )
      if (session.role === 'ogretmen' && data.teacherId !== teacherId)
        throw new DomainError(
          'guidance_own_only',
          'Kendi sorumluluğunuzda takip dosyası açabilirsiniz.',
          { kind: 'forbidden' },
        )
      const entry = stamped(
        makeId,
        'guidance',
        { ...data, followUp: atDay(data.followUp), status: 'Takipte', notes: [] },
        now,
      )
      state.guidanceCases.unshift(entry)
      return entry
    },
    'guidance-note': () => {
      const data = workflowSchemas['guidance-note'].parse(input)
      const entry = requireRecord(state.guidanceCases, recordId)
      scopedStudent(state, session, entry.studentId)
      if (!workflowScope(state, session).scope.counselor)
        throw new DomainError(
          'guidance_counselor_only',
          'Görüşme notunu yalnız rehberlik görevli öğretmen kaydedebilir.',
          { kind: 'forbidden' },
        )
      if (session.role === 'ogretmen' && entry.teacherId !== teacherId)
        throw new DomainError('guidance_not_owner', 'Bu takip dosyasının sorumlusu değilsiniz.', {
          kind: 'forbidden',
        })
      entry.notes.push({ id: makeId('note'), text: data.text, date: now, actor: session.role })
      Object.assign(entry, {
        sharedNote: data.sharedNote,
        followUp: atDay(data.followUp),
        status: data.status,
        updatedAt: now,
      })
      return entry
    },
    exam: () => {
      const data = workflowSchemas.exam.parse(input)
      const allowed = subjectsForGrade(data.grade).map((s) => s.id)
      if (
        new Set(data.subjectIds).size !== data.subjectIds.length ||
        data.subjectIds.some((id) => !allowed.includes(id))
      )
        throw new DomainError(
          'exam_subjects_level_mismatch',
          'Sınav dersleri seçilen sınıf düzeyine uygun olmalıdır.',
        )
      if ((data.type === 'LGS' && data.grade !== 8) || (data.type === 'YKS' && data.grade < 9))
        throw new DomainError(
          'exam_type_level_mismatch',
          'LGS için 8. sınıf; YKS için lise düzeyi seçin.',
        )
      if (
        session.role === 'ogretmen' &&
        !state.classes.some(
          (c) => c.grade === data.grade && workflowScope(state, session).classIds.has(c.id),
        )
      )
        throw new DomainError(
          'class_level_not_assigned',
          'Bu sınıf düzeyinde göreviniz bulunmuyor.',
          { kind: 'forbidden' },
        )
      const entry = stamped(makeId, 'exam', { ...data, date: atDay(data.date) }, now)
      state.mockExams.unshift(entry)
      return entry
    },
    'exam-result': () => {
      // Doğrulama sırası korunur: şema hatası kapsam ve kayıt denetimlerinden önce gelir.
      workflowSchemas['exam-result'].parse(input)
      const result = validateExamResult(state, session, input)
      upsertResult(state, result, makeId, now)
      return result
    },
    'exam-import': () => {
      const data = workflowSchemas['exam-import'].parse(input)
      const results = parseResultsCsv(data.csv).map((row) =>
        validateExamResult(state, session, row),
      )
      const keys = results.map((r) => `${r.examId}/${r.studentId}/${r.subjectId}`)
      if (new Set(keys).size !== keys.length)
        throw new DomainError(
          'csv_duplicate_rows',
          'CSV aynı öğrenci, sınav ve ders için yinelenen satır içeriyor.',
        )
      results.forEach((result) => upsertResult(state, result, makeId, now))
      return results.length
    },
    renewal: () => {
      const data = workflowSchemas.renewal.parse(input)
      const student = scopedStudent(state, session, data.studentId),
        oldClass = active(state.classes, student.classId)
      if (data.year <= state.academicYear)
        throw new DomainError(
          'renewal_year_invalid',
          'Yenileme için mevcut dönemden sonraki bir yıl seçin.',
        )
      if (state.renewals.some((r) => r.studentId === student.id && r.year === data.year))
        throw new DomainError(
          'renewal_already_exists',
          'Bu öğrenci için bu yılın yenilemesi zaten oluşturulmuş.',
          { kind: 'conflict' },
        )
      if (state.renewals.some((r) => r.studentId === student.id && r.status === 'Planlandı'))
        throw new DomainError(
          'transition_planned_exists',
          'Öğrencinin planlanmış bir dönem geçişi var; önce onu tamamlayın.',
          { kind: 'conflict' },
        )
      if (data.mode === 'graduate') {
        if (oldClass.grade !== 12)
          throw new DomainError(
            'graduation_grade_invalid',
            'Mezuniyet yalnızca 12. sınıf öğrencileri için yapılabilir.',
          )
        const entry = stamped(
          makeId,
          'renewal',
          {
            studentId: student.id,
            fromClassId: oldClass.id,
            targetClassId: '',
            year: data.year,
            mode: data.mode,
            amount: 0,
            status: 'Planlandı',
          },
          now,
        )
        state.renewals.unshift(entry)
        return entry
      }
      const target = active(state.classes, data.targetClassId)
      active(state.branches, target.branchId)
      if (target.grade !== oldClass.grade + 1)
        throw new DomainError(
          'new_class_level_invalid',
          'Yeni sınıf öğrencinin bir üst sınıf düzeyinde olmalıdır.',
        )
      const occupants = new Set(
        state.students.filter((s) => s.isActive && s.classId === target.id).map((s) => s.id),
      )
      state.renewals
        .filter(
          (r) => r.targetClassId === target.id && r.year === data.year && r.status === 'Planlandı',
        )
        .forEach((r) => occupants.add(r.studentId))
      if (occupants.size >= target.capacity)
        throw new DomainError('class_capacity_full', 'Yeni sınıfta yeterli kontenjan yok.')
      const quote = renewalQuote(input),
        entryId = makeId('renewal'),
        contractId = makeId('contract'),
        start = new Date(atDay(data.startDate))
      const invoices = quote.installments.map((amount, index) => {
        const last = new Date(
          Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index + 1, 0),
        ).getUTCDate()
        return stamped(
          makeId,
          'inv',
          {
            studentId: student.id,
            contractId,
            academicYear: data.year,
            installment: index + 1,
            amount,
            dueDate: new Date(
              Date.UTC(
                start.getUTCFullYear(),
                start.getUTCMonth() + index,
                Math.min(start.getUTCDate(), last),
                9,
              ),
            ).toISOString(),
            paidAt: null,
            method: null,
            reminderAt: null,
          },
          now,
        )
      })
      const entry = {
        id: entryId,
        ...data,
        ...quote,
        fromClassId: oldClass.id,
        contractId,
        status: 'Planlandı',
        createdAt: now,
        updatedAt: now,
      }
      state.contracts.push({
        id: contractId,
        studentId: student.id,
        classId: target.id,
        academicYear: data.year,
        date: now,
        amount: quote.amount,
        title: `${data.year}–${data.year + 1} eğitim sözleşmesi`,
        invoiceIds: invoices.map((i) => i.id),
      })
      state.invoices.push(...invoices)
      state.renewals.unshift(entry)
      return entry
    },
    'renewal-activate': () => {
      const entry = requireRecord(state.renewals, recordId),
        student = active(state.students, entry.studentId)
      if (entry.status !== 'Planlandı')
        throw new DomainError('transition_already_applied', 'Bu dönem geçişi zaten uygulanmış.', {
          kind: 'conflict',
        })
      if (student.classId !== entry.fromClassId)
        throw new DomainError(
          'transition_class_changed',
          'Öğrencinin sınıfı değişmiş. Dönem geçişi uygulanamadı.',
          { kind: 'conflict' },
        )
      if (
        (state.tutorSessions || []).some(
          (tutor) =>
            tutor.status === 'Planlandı' &&
            Date.parse(tutor.date) > Date.parse(now) &&
            tutor.studentIds.includes(student.id),
        )
      )
        throw new DomainError(
          'transition_has_future_tutoring',
          'Öğrencinin ileri tarihli etütlerini iptal ettikten sonra dönem geçişini uygulayın.',
        )
      if (entry.mode === 'renew') {
        const target = active(state.classes, entry.targetClassId)
        active(state.branches, target.branchId)
        if (
          state.students.filter((s) => s.isActive && s.classId === target.id).length >=
          target.capacity
        )
          throw new DomainError('class_capacity_full', 'Hedef sınıfın kontenjanı dolu.')
      }
      state.enrollmentHistory.push(
        stamped(
          makeId,
          'enrollment',
          {
            studentId: student.id,
            classId: student.classId,
            year: student.academicYear || state.academicYear,
            endedAt: now,
          },
          now,
        ),
      )
      if (entry.mode === 'graduate') student.isActive = false
      else {
        student.classId = entry.targetClassId
        student.academicYear = entry.year
        const target = requireRecord(state.classes, entry.targetClassId)
        for (const task of state.studyTasks.filter(
          (t) => t.studentId === student.id && t.status !== 'Tamamlandı',
        ))
          task.teacherId =
            state.assignments.find((a) => a.classId === target.id && a.subjectId === task.subjectId)
              ?.teacherId || target.teacherId
        for (const guidance of state.guidanceCases.filter(
          (g) => g.studentId === student.id && g.status !== 'Tamamlandı',
        )) {
          const subjectId = state.teachers.find((t) => t.id === guidance.teacherId)?.subjectId
          guidance.teacherId =
            state.assignments.find((a) => a.classId === target.id && a.subjectId === subjectId)
              ?.teacherId || target.teacherId
        }
      }
      state.transportAssignments = state.transportAssignments.filter(
        (a) =>
          a.studentId !== student.id ||
          (entry.mode === 'renew' &&
            state.transportRoutes.find((r) => r.id === a.routeId)?.branchId ===
              state.classes.find((c) => c.id === student.classId)?.branchId),
      )
      state.clubMemberships
        .filter((m) => m.studentId === student.id)
        .forEach((m) => {
          if (
            entry.mode === 'graduate' ||
            state.clubs.find((c) => c.id === m.clubId)?.branchId !==
              state.classes.find((c) => c.id === student.classId)?.branchId
          )
            m.status = 'Ayrıldı'
        })
      Object.assign(entry, {
        status: entry.mode === 'graduate' ? 'Mezun' : 'Tamamlandı',
        activatedAt: now,
      })
      return entry
    },
    lesson: () => {
      const data = workflowSchemas.lesson.parse(input)
      const existing = recordId ? requireRecord(state.schedule, recordId) : null
      if (existing?.cancelledAt)
        throw new DomainError('lesson_cancelled', 'İptal edilmiş ders düzenlenemez.')
      if (existing)
        requireUpcomingLesson(existing.date, now, 'Başlamış veya geçmiş ders düzenlenemez.')
      requireUpcomingLesson(data.date, now, 'Ders geçmiş bir saate planlanamaz.')
      validateLesson(state, data, recordId)
      const title = () => state.subjects.find((s) => s.id === data.subjectId)?.name
      if (existing) {
        Object.assign(existing, data, { title: title(), updatedAt: now })
        return existing
      }
      // Yeni ders, damga alanlarından sonra girdi ve ders adıyla aynı alan sırasında oluşturulur.
      const entry = {
        ...stamped(makeId, 'lesson', {}, now),
        ...data,
        title: title(),
        updatedAt: now,
      }
      state.schedule.push(entry)
      return entry
    },
    substitute: () => {
      const data = workflowSchemas.substitute.parse(input)
      const lesson = requireRecord(state.schedule, recordId)
      if (lesson.cancelledAt)
        throw new DomainError(
          'lesson_cancelled',
          'İptal edilmiş ders için görevlendirme yapılamaz.',
        )
      requireUpcomingLesson(lesson.date, now, 'Başlamış veya geçmiş derse yedek atanamaz.')
      if (lesson.teacherId === data.teacherId)
        throw new DomainError('teacher_unchanged', 'Farklı bir öğretmen seçin.')
      validateLesson(state, { ...lesson, teacherId: data.teacherId }, lesson.id)
      lesson.originalTeacherId ||= lesson.teacherId
      lesson.substitutions ||= []
      lesson.substitutions.push({
        fromTeacherId: lesson.teacherId,
        toTeacherId: data.teacherId,
        reason: data.reason,
        date: now,
      })
      lesson.teacherId = data.teacherId
      return lesson
    },
    'lesson-cancel': () => {
      const data = workflowSchemas['lesson-cancel'].parse(input)
      const entry = requireRecord(state.schedule, recordId)
      if (entry.cancelledAt)
        throw new DomainError('lesson_already_cancelled', 'Ders zaten iptal edilmiş.', {
          kind: 'conflict',
        })
      requireUpcomingLesson(entry.date, now, 'Başlamış veya geçmiş ders iptal edilemez.')
      // Yoklama gün bazındadır (DOM-AKD-030 farkı): sınıfın o günü için yoklama alınmışsa
      // dersin iptali alınmış yoklamayı anlamsızlaştırır; ders iptal edilmez (DOM-YTK-069).
      const day = dayKey(entry.date)
      if (state.attendance.some((a) => a.classId === entry.classId && dayKey(a.date) === day))
        throw new DomainError(
          'lesson_attendance_taken',
          'Bu ders günü için sınıfın yoklaması alınmış; ders iptal edilemez.',
        )
      // İptal kaydı silinmez; gerekçe derste ve denetim kaydında korunur.
      Object.assign(entry, { cancelledAt: now, cancelReason: data.reason, updatedAt: now })
      return entry
    },
    'study-task': () => {
      const data = workflowSchemas['study-task'].parse(input)
      if (data.dueDate < dayKey(now))
        throw new DomainError(
          'task_due_date_past',
          'Yeni çalışma görevinin son tarihi geçmişte olamaz.',
        )
      const student = scopedStudent(state, session, data.studentId)
      const teacher = state.assignments.find(
        (a) => a.classId === student.classId && a.subjectId === data.subjectId,
      )?.teacherId
      if (!teacher || !state.teachers.some((t) => t.id === teacher && t.isActive))
        throw new DomainError(
          'lesson_no_teacher',
          'Bu ders için aktif öğretmen ataması bulunmuyor.',
        )
      if (session.role === 'ogretmen' && teacher !== teacherId)
        throw new DomainError(
          'homework_own_lesson_only',
          'Yalnızca kendi dersiniz için görev verebilirsiniz.',
          { kind: 'forbidden' },
        )
      const entry = stamped(
        makeId,
        'study',
        {
          ...data,
          teacherId: teacher,
          dueDate: atDay(data.dueDate),
          status: session.role === 'ogrenci' ? 'Onay bekliyor' : 'Onaylandı',
          completionNote: '',
          feedback: '',
        },
        now,
      )
      state.studyTasks.unshift(entry)
      return entry
    },
    'study-complete': () => {
      const data = workflowSchemas['study-complete'].parse(input)
      const entry = requireRecord(state.studyTasks, recordId)
      scopedStudent(state, session, entry.studentId)
      if (!['Onaylandı', 'Tekrar çalışılacak'].includes(entry.status))
        throw new DomainError(
          'homework_not_submittable',
          'Yalnızca onaylanmış veya tekrar verilen görev teslim edilebilir.',
        )
      Object.assign(entry, data, { status: 'Değerlendirme bekliyor', completedAt: now })
      return entry
    },
    'study-review': () => {
      const data = workflowSchemas['study-review'].parse(input)
      const entry = requireRecord(state.studyTasks, recordId)
      scopedStudent(state, session, entry.studentId)
      if (session.role === 'ogretmen' && entry.teacherId !== teacherId)
        throw new DomainError('homework_not_owner', 'Bu çalışma görevinin öğretmeni değilsiniz.', {
          kind: 'forbidden',
        })
      if (
        (entry.status === 'Onay bekliyor' && data.status !== 'Onaylandı') ||
        (entry.status !== 'Onay bekliyor' && entry.status !== 'Değerlendirme bekliyor')
      )
        throw new DomainError(
          'review_status_invalid',
          'Görevin durumuna uygun değerlendirme seçin.',
        )
      Object.assign(entry, data, { reviewedAt: now })
      return entry
    },
    event: () => {
      const data = workflowSchemas.event.parse(input)
      active(state.branches, data.branchId)
      const classroom = data.classId ? active(state.classes, data.classId) : null
      if (classroom && classroom.branchId !== data.branchId)
        throw new DomainError('event_campus_mismatch', 'Sınıf ve kampüs aynı olmalıdır.')
      if (
        session.role === 'ogretmen' &&
        (!classroom || !workflowScope(state, session).classIds.has(classroom.id))
      )
        throw new DomainError(
          'event_own_class_only',
          'Yalnızca kendi sınıflarınıza etkinlik oluşturabilirsiniz.',
          { kind: 'forbidden' },
        )
      if (Date.parse(data.endDate) <= Date.parse(data.date))
        throw new DomainError('event_time_invalid', 'Bitiş zamanı başlangıçtan sonra olmalıdır.')
      if (data.requiresConsent && Date.parse(atDay(data.consentDeadline)) > Date.parse(data.date))
        throw new DomainError(
          'event_deadline_invalid',
          'Onay son tarihi etkinlik başlangıcından sonra olamaz.',
        )
      const conflict = tutorConflict(
        { ...state, schedule: [], appointments: [], schoolEvents: [] },
        {
          ...data,
          teacherId: session.role === 'ogretmen' ? teacherId : null,
          room: data.location,
          duration: (Date.parse(data.endDate) - Date.parse(data.date)) / 60000,
          studentIds: eventStudents(state, data).map((student) => student.id),
        },
      )
      if (conflict) throw new DomainError('tutor_schedule_conflict', conflict, { kind: 'conflict' })
      const entry = stamped(
        makeId,
        'event',
        {
          ...data,
          consentDeadline: atDay(data.consentDeadline),
          teacherId: session.role === 'ogretmen' ? teacherId : null,
          status: 'Planlandı',
        },
        now,
      )
      state.schoolEvents.unshift(entry)
      return entry
    },
    consent: () => {
      const data = workflowSchemas.consent.parse(input)
      const event = requireRecord(state.schoolEvents, recordId),
        student = scopedStudent(state, session, session.childId)
      if (
        !event.requiresConsent ||
        event.status === 'İptal' ||
        !eventStudents(state, event).some((s) => s.id === student.id)
      )
        throw new DomainError(
          'event_consent_denied',
          'Bu etkinlik için çocuğunuz adına onay verilemez.',
          { kind: 'forbidden' },
        )
      if (
        Date.parse(now) > Date.parse(event.consentDeadline) + 43199999 ||
        Date.parse(now) >= Date.parse(event.date)
      )
        throw new DomainError('event_consent_expired', 'Etkinliğin onay süresi dolmuş.')
      const existing = state.eventConsents.find(
        (c) => c.eventId === event.id && c.studentId === student.id,
      )
      if (existing) Object.assign(existing, data, { updatedAt: now })
      else
        state.eventConsents.push(
          stamped(
            makeId,
            'consent',
            { eventId: event.id, studentId: student.id, parentId: student.parentId, ...data },
            now,
          ),
        )
      return event
    },
    'event-cancel': () => {
      const event = requireRecord(state.schoolEvents, recordId)
      if (session.role === 'ogretmen' && event.teacherId !== teacherId)
        throw new DomainError(
          'event_cancel_own_only',
          'Yalnızca oluşturduğunuz etkinliği iptal edebilirsiniz.',
          { kind: 'forbidden' },
        )
      event.status = 'İptal'
      return event
    },
    route: () => {
      const data = workflowSchemas.route.parse(input)
      active(state.branches, data.branchId)
      if (
        state.transportRoutes.some(
          (r) =>
            r.id !== recordId &&
            r.status === 'Aktif' &&
            r.plate.toLocaleLowerCase('tr') === data.plate.toLocaleLowerCase('tr'),
        )
      )
        throw new DomainError(
          'route_plate_taken',
          'Bu plaka başka aktif güzergâhta kullanılıyor.',
          {
            kind: 'conflict',
          },
        )
      if (recordId) {
        const entry = active(state.transportRoutes, recordId),
          assignments = state.transportAssignments.filter((a) => a.routeId === recordId)
        if (
          assignments.length > data.capacity ||
          assignments.some(
            (a) =>
              !data.stops.includes(a.stop) ||
              state.classes.find(
                (c) => c.id === state.students.find((s) => s.id === a.studentId)?.classId,
              )?.branchId !== data.branchId,
          )
        )
          throw new DomainError(
            'route_has_assignments',
            'Atanmış öğrenciler nedeniyle kapasite, durak veya kampüs değişikliği yapılamaz. Önce atamaları güncelleyin.',
          )
        Object.assign(entry, data, { updatedAt: now })
        return entry
      }
      const entry = stamped(makeId, 'route', { ...data, status: 'Aktif' }, now)
      state.transportRoutes.push(entry)
      return entry
    },
    'route-archive': () => {
      const entry = active(state.transportRoutes, recordId)
      if (state.transportAssignments.some((a) => a.routeId === entry.id))
        throw new DomainError(
          'route_has_students',
          'Önce bu güzergâhtaki öğrencileri başka servise taşıyın veya atamalarını kaldırın.',
        )
      entry.status = 'Arşiv'
      return entry
    },
    'transport-assign': () => {
      const data = workflowSchemas['transport-assign'].parse(input)
      const student = scopedStudent(state, session, data.studentId),
        route = active(state.transportRoutes, data.routeId)
      if (state.classes.find((c) => c.id === student.classId)?.branchId !== route.branchId)
        throw new DomainError('route_campus_mismatch', 'Servis ve öğrenci aynı kampüste olmalıdır.')
      if (!route.stops.includes(data.stop))
        throw new DomainError('route_stop_invalid', 'Seçilen durak bu güzergâhta bulunmuyor.')
      if (
        state.transportAssignments.filter(
          (a) => a.routeId === route.id && a.studentId !== student.id,
        ).length >= route.capacity
      )
        throw new DomainError('route_capacity_full', 'Servis kontenjanı dolu.')
      const existing = state.transportAssignments.find((a) => a.studentId === student.id)
      if (existing) Object.assign(existing, data, { updatedAt: now })
      else state.transportAssignments.push(stamped(makeId, 'transport', data, now))
      return route
    },
    'transport-remove': () => {
      requireRecord(state.transportAssignments, recordId)
      state.transportAssignments = state.transportAssignments.filter((a) => a.id !== recordId)
      return true
    },
    meal: () => {
      const data = workflowSchemas.meal.parse(input)
      active(state.branches, data.branchId)
      const previous = state.mealMenus.find(
        (m) => m.branchId === data.branchId && m.date.slice(0, 10) === data.date,
      )
      if (previous && previous.id !== recordId)
        throw new DomainError(
          'menu_exists',
          'Bu kampüs ve gün için menü zaten var. Mevcut menüyü düzenleyin.',
          { kind: 'conflict' },
        )
      if (recordId) {
        const entry = requireRecord(state.mealMenus, recordId)
        Object.assign(entry, data, { date: atDay(data.date), updatedAt: now })
        return entry
      }
      const entry = stamped(makeId, 'meal', { ...data, date: atDay(data.date) }, now)
      state.mealMenus.push(entry)
      return entry
    },
    club: () => {
      const data = workflowSchemas.club.parse(input)
      active(state.branches, data.branchId)
      const teacher = active(state.teachers, data.teacherId)
      if (
        teacher.branchId !== data.branchId ||
        (session.role === 'ogretmen' && teacher.id !== teacherId)
      )
        throw new DomainError(
          'club_teacher_invalid',
          'Kulüp sorumlusu kampüse uygun olmalıdır; öğretmen kendi adına kulüp açabilir.',
        )
      const entry = stamped(makeId, 'club', { ...data, status: 'Aktif' }, now)
      state.clubs.push(entry)
      return entry
    },
    'club-enroll': () => {
      const data = workflowSchemas['club-enroll'].parse(input)
      const club = active(state.clubs, recordId),
        student = scopedStudent(state, session, data.studentId)
      if (session.role === 'ogretmen') ownedClub(state, session, recordId)
      if (state.classes.find((c) => c.id === student.classId)?.branchId !== club.branchId)
        throw new DomainError('club_campus_mismatch', 'Öğrenci ve kulüp aynı kampüste olmalıdır.')
      const existing = state.clubMemberships.find(
        (m) => m.clubId === club.id && m.studentId === student.id,
      )
      if (existing?.status === 'Aktif')
        throw new DomainError('club_member_exists', 'Öğrenci bu kulübe zaten kayıtlı.', {
          kind: 'conflict',
        })
      if (
        state.clubMemberships.filter((m) => m.clubId === club.id && m.status === 'Aktif').length >=
        club.capacity
      )
        throw new DomainError('club_capacity_full', 'Kulüp kontenjanı dolu.')
      if (existing) Object.assign(existing, { status: 'Aktif', updatedAt: now })
      else
        state.clubMemberships.push(
          stamped(
            makeId,
            'member',
            { clubId: club.id, studentId: student.id, status: 'Aktif' },
            now,
          ),
        )
      return club
    },
    'club-leave': () => {
      const member = requireRecord(state.clubMemberships, recordId)
      scopedStudent(state, session, member.studentId)
      if (session.role === 'ogretmen') ownedClub(state, session, member.clubId)
      if (member.status !== 'Aktif')
        throw new DomainError('membership_already_ended', 'Üyelik zaten sonlandırılmış.', {
          kind: 'conflict',
        })
      member.status = 'Ayrıldı'
      return member
    },
    'club-attendance': () => {
      const data = workflowSchemas['club-attendance'].parse(input)
      const club = ownedClub(state, session, recordId),
        members = state.clubMemberships.filter((m) => m.clubId === club.id && m.status === 'Aktif')
      if (data.date > dayKey(now))
        throw new DomainError(
          'club_attendance_future',
          'Gelecek tarih için kulüp yoklaması alınamaz.',
        )
      // Durumu seçilmiş üyeler üye sırasıyla; eksik üye varsa liste kısalır.
      const marked = members.flatMap((member) => {
        const status = data.marks[member.studentId]
        return status ? [{ studentId: member.studentId, status }] : []
      })
      if (
        !members.length ||
        marked.length !== members.length ||
        Object.keys(data.marks).some((id) => !members.some((m) => m.studentId === id))
      )
        throw new DomainError(
          'club_attendance_incomplete',
          'Tüm aktif üyelerin yoklama durumunu seçin.',
        )
      for (const member of marked) {
        const entry = state.clubAttendance.find(
          (a) =>
            a.clubId === club.id &&
            a.studentId === member.studentId &&
            a.date.slice(0, 10) === data.date,
        )
        if (entry) Object.assign(entry, { status: member.status, updatedAt: now })
        else
          state.clubAttendance.push(
            stamped(
              makeId,
              'club-attendance',
              {
                clubId: club.id,
                studentId: member.studentId,
                date: atDay(data.date),
                status: member.status,
              },
              now,
            ),
          )
      }
      return club
    },
    achievement: () => {
      const data = workflowSchemas.achievement.parse(input)
      scopedStudent(state, session, data.studentId)
      ownedClub(state, session, data.clubId)
      if (
        !state.clubMemberships.some(
          (m) => m.studentId === data.studentId && m.clubId === data.clubId && m.status === 'Aktif',
        )
      )
        throw new DomainError(
          'club_achievement_member_required',
          'Başarı kaydı için öğrenci kulübün aktif üyesi olmalıdır.',
        )
      const entry = stamped(makeId, 'achievement', { ...data, date: atDay(data.date) }, now)
      state.socialAchievements.push(entry)
      return entry
    },
    'club-archive': () => {
      const club = ownedClub(state, session, recordId)
      club.status = 'Arşiv'
      state.clubMemberships
        .filter((m) => m.clubId === club.id && m.status === 'Aktif')
        .forEach((m) => {
          m.status = 'Ayrıldı'
        })
      return club
    },
  } satisfies Record<WorkflowCommand, () => unknown>
}
type WorkflowHandlers = ReturnType<typeof workflowHandlers>
/** Komutun sonucu; dize komut için bütün sonuçların birleşimi (`WorkflowResult<WorkflowCommand>`). */
export type WorkflowResult<C extends WorkflowCommand = WorkflowCommand> = ReturnType<
  WorkflowHandlers[C]
>

function executeWorkflow(
  state: State,
  session: Session,
  command: string,
  input: unknown,
  makeId: MakeId,
  recordId: string | undefined,
  now: string,
): WorkflowResult {
  // Komut → modül tek yerdedir (`modules/commands.ts`); komut çalışma anında serbest metin gelir,
  // bilinmeyen komut tablo dışında kalır.
  if (!isWorkflowCommand(command)) throw new DomainError('unknown_command', 'İşlem bulunamadı.')
  const module = WORKFLOW_COMMANDS[command].module
  if (!state.modules[module])
    throw new DomainError('module_disabled', 'Bu modül kullanıma kapalı.', { kind: 'forbidden' })
  if (!mayRun(session, command))
    throw new DomainError('permission_denied', 'Bu işlem için rolünüzün yetkisi yok.', {
      kind: 'forbidden',
    })
  const teacherId = sessionTeacherId(state, session)
  if (session.role === 'ogretmen') active(state.teachers, teacherId)
  // Şeması olan her komut, dalın ilk adımı olarak girdisini kendi şemasıyla doğrular.
  return workflowHandlers(state, session, input, makeId, recordId, now, teacherId)[command]()
}

type AuditedCollection = {
  [K in keyof State]: State[K] extends readonly { id: string }[] ? K : never
}[keyof State]
const findById = (list: readonly { id: string }[], id: string) => list.find((r) => r.id === id)

// Denetim kaydı gizli alanlara arka kapı olmamalıdır: rehberlik iç notu eski/yeni değerden
// çıkarılır, yalnız değişen alanın adı yazılır (DOM-ILT-041, DOM-YTK-053).
const AUDIT_MASKED_FIELDS: Partial<Record<AuditedCollection, readonly string[]>> = {
  guidanceCases: ['internalNote', 'notes'],
}
function maskAuditValues(
  collection: AuditedCollection | undefined,
  oldValue: AuditValue,
  newValue: AuditValue,
) {
  const fields = (collection && AUDIT_MASKED_FIELDS[collection]) || []
  if (!fields.length) return { oldValue, newValue, fields: [] }
  const read = (value: AuditValue, key: string): unknown =>
    typeof value === 'object' && value !== null && Object.hasOwn(value, key)
      ? Reflect.get(value, key)
      : undefined
  const strip = (value: AuditValue): AuditValue =>
    typeof value === 'object' && value !== null
      ? Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key)))
      : value
  return {
    oldValue: strip(oldValue),
    newValue: strip(newValue),
    fields: fields.filter(
      (key) => JSON.stringify(read(oldValue, key)) !== JSON.stringify(read(newValue, key)),
    ),
  }
}

/** Çevrimdışı demo oturumunda denetim girdisinin kişisi (oturum `userId` taşımıyorsa). */
function demoAuditUserId(state: State, session: Session): string {
  if (session.role === 'ogretmen') return sessionTeacherId(state, session) ?? ''
  if (session.role === 'ogrenci')
    return linkedRecordId(sessionActor(state, session), 'student') ?? ''
  if (session.role === 'veli') return DEMO_PARENT_ID
  return `demo-${session.role}`
}

/**
 * Okul iş akışı komutunu çalıştırır ve denetim kaydını yazar. Komut sabit verilince dönüş tipi o
 * komutun sonucudur (`WorkflowResult<'goal'>`); dışarıdan gelen dize komutta bütün sonuçların
 * birleşimidir ve bilinmeyen komut `unknown_command` ile reddedilir.
 */
export function runWorkflow<C extends WorkflowCommand>(
  state: State,
  session: Session,
  command: C,
  input: unknown,
  makeId: MakeId,
  recordId?: string,
  now?: string,
): WorkflowResult<C>
export function runWorkflow(
  state: State,
  session: Session,
  command: string,
  input: unknown,
  makeId: MakeId,
  recordId?: string,
  now?: string,
): WorkflowResult
export function runWorkflow(
  state: State,
  session: Session,
  command: string,
  input: unknown,
  makeId: MakeId,
  recordId?: string,
  now = new Date().toISOString(),
): WorkflowResult {
  const collections: Partial<Record<string, AuditedCollection>> = {
    goal: 'studentGoals',
    'goal-review': 'studentGoals',
    'goal-step': 'studentGoals',
    'goal-step-done': 'studentGoals',
    'goal-suggest': 'studentGoals',
    'goal-comment': 'studentGoals',
    'goal-close': 'studentGoals',
    guidance: 'guidanceCases',
    'guidance-note': 'guidanceCases',
    exam: 'mockExams',
    'exam-result': 'mockResults',
    'exam-import': 'mockResults',
    renewal: 'renewals',
    'renewal-activate': 'renewals',
    lesson: 'schedule',
    substitute: 'schedule',
    'lesson-cancel': 'schedule',
    'study-task': 'studyTasks',
    'study-complete': 'studyTasks',
    'study-review': 'studyTasks',
    event: 'schoolEvents',
    consent: 'eventConsents',
    'event-cancel': 'schoolEvents',
    route: 'transportRoutes',
    'route-archive': 'transportRoutes',
    'transport-assign': 'transportAssignments',
    'transport-remove': 'transportAssignments',
    meal: 'mealMenus',
    club: 'clubs',
    'club-enroll': 'clubMemberships',
    'club-leave': 'clubMemberships',
    'club-attendance': 'clubAttendance',
    achievement: 'socialAchievements',
    'club-archive': 'clubs',
  }
  const collection = collections[command]
  const previous = recordId && collection ? findById(state[collection], recordId) : null
  const oldValue = previous ? toAuditValue(previous) : null
  const result = executeWorkflow(state, session, command, input, makeId, recordId, now)
  const resultId = typeof result === 'object' && 'id' in result ? result.id : undefined
  const newValue = toAuditValue(typeof result === 'object' ? result : { result })
  const masked = maskAuditValues(collection, oldValue, newValue)
  const entry: RecordAuditEntry = {
    id: makeId('audit'),
    actor: session.role,
    // Oturum kişi kimliğini taşıyorsa (API) denetim ona bağlanır; taşımıyorsa (çevrimdışı demo)
    // rolün demo kişisi yazılır.
    user_id: session.userId ?? demoAuditUserId(state, session),
    action: command,
    table_name: collection,
    record_id: recordId || resultId || command,
    date: now,
    changed_at: now,
    old_value: masked.oldValue,
    new_value: masked.newValue,
    ...(masked.fields.length ? { masked_fields: masked.fields } : {}),
  }
  state.audit.unshift(entry)
  state.audit = state.audit.slice(0, 200)
  return result
}
