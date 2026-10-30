// @ts-nocheck — TODO(ts): tiplenecek (C2)
import { z } from 'zod'
import { installmentAmounts } from './domain.ts'
import { dayKey } from './format.ts'
import { subjectsForGrade } from '../data/curriculum.ts'
import { tutorConflict } from './tutor-conflicts.ts'

z.config(z.locales.tr())
const text = z.string().trim().min(2, 'En az iki karakter girin.').max(2000)
const identifier = z.string().min(1, 'Bir kayıt seçin.')
const integer = (min, max) => z.coerce.number().int().min(min).max(max)
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
  substitute: z.object({ teacherId: identifier, reason: text }),
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
const commandModules = {
  goal: 'goals',
  'goal-review': 'goals',
  'goal-step': 'goals',
  'goal-step-done': 'goals',
  'goal-suggest': 'goals',
  'goal-comment': 'goals',
  'goal-close': 'goals',
  guidance: 'guidance',
  'guidance-note': 'guidance',
  exam: 'exams',
  'exam-result': 'exams',
  'exam-import': 'exams',
  renewal: 'renewal',
  'renewal-activate': 'renewal',
  lesson: 'planning',
  substitute: 'planning',
  'lesson-cancel': 'planning',
  'study-task': 'study',
  'study-complete': 'study',
  'study-review': 'study',
  event: 'calendar',
  consent: 'calendar',
  'event-cancel': 'calendar',
  route: 'transport',
  'route-archive': 'transport',
  'transport-assign': 'transport',
  'transport-remove': 'transport',
  meal: 'meals',
  club: 'clubs',
  'club-enroll': 'clubs',
  'club-leave': 'clubs',
  'club-attendance': 'clubs',
  achievement: 'clubs',
  'club-archive': 'clubs',
}
const commandRoles = {
  goal: ['yonetici', 'ogretmen', 'ogrenci'],
  'goal-review': ['yonetici', 'ogretmen'],
  'goal-step': ['yonetici', 'ogretmen', 'ogrenci'],
  'goal-step-done': ['ogrenci'],
  'goal-suggest': ['yonetici', 'ogretmen', 'ogrenci'],
  'goal-comment': ['yonetici', 'ogretmen', 'veli'],
  'goal-close': ['yonetici', 'ogretmen', 'ogrenci'],
  guidance: ['yonetici', 'ogretmen'],
  'guidance-note': ['yonetici', 'ogretmen'],
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
export function mayRun(session, command) {
  return !!commandRoles[command]?.includes(session.role)
}
export function workflowScope(state, session) {
  const studentId = session.role === 'veli' ? session.childId : 's1'
  const student = state.students.find((s) => s.id === studentId)
  const classIds = new Set(
    state.assignments.filter((a) => a.teacherId === 't1').map((a) => a.classId),
  )
  const institution = ['yonetici', 'onburo'].includes(session.role)
  const permitted = state.students.filter(
    (s) =>
      institution ||
      (session.role === 'ogretmen'
        ? classIds.has(s.classId)
        : s.id === studentId &&
          (session.role !== 'veli' ||
            state.parents.find((p) => p.id === 'p1')?.studentIds.includes(s.id))),
  )
  const students = permitted.filter((s) => s.isActive)
  return {
    student,
    students,
    studentIds: new Set(permitted.map((s) => s.id)),
    classIds,
    institution,
  }
}
function requireRecord(state, collection, id) {
  const value = state[collection].find((r) => r.id === id)
  if (!value) throw new Error('İlgili kayıt bulunamadı. Listeyi yenileyin.')
  return value
}
function active(state, collection, id) {
  const record = requireRecord(state, collection, id)
  if (record.isActive === false || record.deletedAt || record.status === 'Arşiv')
    throw new Error('Pasif veya arşivlenmiş kayıt kullanılamaz.')
  return record
}
function scopedStudent(state, session, id) {
  const student = active(state, 'students', id)
  if (!workflowScope(state, session).studentIds.has(id))
    throw new Error('Bu öğrenci için işlem yetkiniz bulunmuyor.')
  return student
}
function gradeOf(state, student) {
  return requireRecord(state, 'classes', student.classId).grade
}
function stamped(makeId, prefix, data, now) {
  return { id: makeId(prefix), ...data, createdAt: now, updatedAt: now }
}
function atDay(value) {
  return `${value}T09:00:00.000Z`
}
export function examNet(result, exam) {
  return (
    Math.round(
      (result.correct - (exam.wrongPenalty ? result.wrong / exam.wrongPenalty : 0)) * 100,
    ) / 100
  )
}
export function examProgress(state, studentId) {
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
const round2 = (value) => Math.round(value * 100) / 100
const OPEN_GOAL_STATUSES = ['Onay bekliyor', 'Aktif']
// Hedefin ders/genel net serisi: yalnızca ilgili öğrencinin deneme sonuçlarından türetilir.
export function goalSeries(state, studentId, subjectId) {
  return examProgress(state, studentId).flatMap((exam) => {
    const point = { examId: exam.id, title: exam.title, date: exam.date }
    if (!subjectId) return exam.complete ? [{ ...point, net: exam.net }] : []
    const results = exam.results.filter((r) => r.subjectId === subjectId)
    if (!results.length) return []
    return [{ ...point, net: round2(results.reduce((sum, r) => sum + examNet(r, exam), 0)) }]
  })
}
export function goalProgress(state, goal) {
  const series = goalSeries(state, goal.studentId, goal.subjectId)
  const current = series.length ? series[series.length - 1].net : null
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
export function suggestGoalSteps(state, goal, now = new Date().toISOString()) {
  const known = new Set(goal.steps.map((s) => s.topic.toLocaleLowerCase('tr-TR')).filter(Boolean))
  const picked = []
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
function goalRecord(state, session, recordId) {
  const goal = requireRecord(state, 'studentGoals', recordId)
  scopedStudent(state, session, goal.studentId)
  if (
    session.role === 'ogretmen' &&
    goal.subjectId &&
    goal.subjectId !== state.teachers.find((t) => t.id === 't1')?.subjectId
  )
    throw new Error('Bu hedef başka bir branşa ait.')
  return goal
}
function openGoalRecord(state, session, recordId) {
  const goal = goalRecord(state, session, recordId)
  if (!OPEN_GOAL_STATUSES.includes(goal.status))
    throw new Error('Reddedilmiş veya kapatılmış hedef üzerinde işlem yapılamaz.')
  return goal
}
export function renewalQuote(input) {
  const data = workflowSchemas.renewal.parse(input)
  const gross = Math.round(data.total * 100)
  const scholarshipAmount = Math.round((gross * data.scholarship) / 100)
  const discountAmount = Math.round(data.discount * 100)
  const amount = gross - scholarshipAmount - discountAmount
  if (amount < 10000)
    throw new Error('Burs ve indirim sonrası eğitim bedeli en az 100 ₺ olmalıdır.')
  return {
    gross,
    scholarshipAmount,
    discountAmount,
    amount,
    installments: installmentAmounts(amount, data.count),
  }
}
function overlaps(a, b) {
  return (
    Date.parse(a.date) < Date.parse(b.date) + (b.duration || 30) * 60000 &&
    Date.parse(b.date) < Date.parse(a.date) + (a.duration || 30) * 60000
  )
}
function validateLesson(state, data, ignoreId) {
  const classroom = active(state, 'classes', data.classId)
  active(state, 'branches', classroom.branchId)
  const teacher = active(state, 'teachers', data.teacherId)
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
  if (tutorReason) throw new Error(tutorReason)
  if (
    teacher.subjectId !== data.subjectId ||
    teacher.branchId !== classroom.branchId ||
    !state.assignments.some((a) => a.classId === classroom.id && a.subjectId === data.subjectId)
  )
    throw new Error('Öğretmenin branşı ve kampüsü seçilen derse uygun olmalıdır.')
  for (const lesson of state.schedule) {
    if (lesson.id === ignoreId || lesson.cancelledAt || !overlaps(data, lesson)) continue
    const otherClass = requireRecord(state, 'classes', lesson.classId)
    if (lesson.teacherId === data.teacherId)
      throw new Error('Öğretmenin bu saatte başka dersi var.')
    if (lesson.classId === data.classId) throw new Error('Sınıfın bu saatte başka dersi var.')
    if (
      otherClass.branchId === classroom.branchId &&
      lesson.room.trim().toLocaleLowerCase('tr') === data.room.trim().toLocaleLowerCase('tr')
    )
      throw new Error('Derslik bu saatte başka bir sınıf tarafından kullanılıyor.')
  }
  if (
    state.appointments.some(
      (a) => a.teacherId === data.teacherId && a.status !== 'Reddedildi' && overlaps(data, a),
    )
  )
    throw new Error('Öğretmenin bu saatte görüşme randevusu var.')
}
function validateExamResult(state, session, input) {
  const data = workflowSchemas['exam-result'].parse(input)
  const student = scopedStudent(state, session, data.studentId),
    exam = requireRecord(state, 'mockExams', data.examId)
  if (gradeOf(state, student) !== exam.grade)
    throw new Error('Öğrencinin sınıf düzeyi sınavla aynı olmalıdır.')
  if (!exam.subjectIds.includes(data.subjectId))
    throw new Error('Ders bu denemenin kapsamında değil.')
  if (session.role === 'ogretmen' && active(state, 'teachers', 't1').subjectId !== data.subjectId)
    throw new Error('Yalnızca kendi branşınızın sonuçlarını girebilirsiniz.')
  if (data.correct + data.wrong + data.blank < 1 || data.correct + data.wrong + data.blank > 200)
    throw new Error('Ders soru toplamı 1–200 arasında olmalıdır.')
  return data
}
function upsertResult(state, data, makeId, now) {
  const previous = state.mockResults.find(
    (r) =>
      r.examId === data.examId && r.studentId === data.studentId && r.subjectId === data.subjectId,
  )
  if (previous)
    Object.assign(previous, data, { updatedAt: now, source: 'manual', evaluationId: null })
  else state.mockResults.push(stamped(makeId, 'result', data, now))
}
// CSV Excel'den UTF-8 olarak kaydedilebilir; tırnaklı hücre ve satır sonları desteklenir.
export function parseResultsCsv(raw) {
  const source = raw.replace(/^\uFEFF/, ''),
    separator = source.split(/\r?\n/, 1)[0].includes(';') ? ';' : ','
  const rows = [],
    row = []
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
  if (quoted) throw new Error('CSV içinde kapanmamış tırnak var.')
  const header = ['examId', 'studentId', 'subjectId', 'correct', 'wrong', 'blank', 'weakTopics']
  if (!rows.length || rows[0].join('|') !== header.join('|'))
    throw new Error('CSV başlıkları örnek şablonla aynı olmalıdır.')
  if (rows.length < 2 || rows.length > 1001)
    throw new Error('Bir aktarımda 1–1000 sonuç satırı olmalıdır.')
  return rows.slice(1).map((values, index) => {
    if (values.length !== header.length || values.slice(3, 6).some((v) => !/^\d+$/.test(v)))
      throw new Error(`CSV ${index + 2}. satır: sütun sayısı veya sayısal değerler geçersiz.`)
    return Object.fromEntries(header.map((key, i) => [key, values[i]]))
  })
}
export function eventStudents(state, event) {
  return state.students.filter(
    (s) =>
      s.isActive &&
      (!event.classId || s.classId === event.classId) &&
      state.classes.find((c) => c.id === s.classId)?.branchId === event.branchId,
  )
}
function ownedClub(state, session, recordId) {
  const club = active(state, 'clubs', recordId)
  if (session.role === 'ogretmen' && club.teacherId !== 't1')
    throw new Error('Yalnızca sorumlu olduğunuz kulübü yönetebilirsiniz.')
  return club
}
function executeWorkflow(
  state,
  session,
  command,
  input,
  makeId,
  recordId,
  now = new Date().toISOString(),
) {
  const module = commandModules[command]
  if (!module || !state.modules[module]) throw new Error('Bu modül kullanıma kapalı.')
  if (!mayRun(session, command)) throw new Error('Bu işlem için rolünüzün yetkisi yok.')
  if (session.role === 'ogretmen') active(state, 'teachers', 't1')
  const data = workflowSchemas[command] ? workflowSchemas[command].parse(input) : {}
  if (command === 'goal') {
    const student = scopedStudent(state, session, data.studentId)
    if (data.deadline < dayKey(now)) throw new Error('Hedef son tarihi geçmişte olamaz.')
    if (
      data.subjectId &&
      !subjectsForGrade(gradeOf(state, student)).some((s) => s.id === data.subjectId)
    )
      throw new Error('Seçilen ders öğrencinin sınıf düzeyine uygun değil.')
    if (
      session.role === 'ogretmen' &&
      data.subjectId !== state.teachers.find((t) => t.id === 't1')?.subjectId
    )
      throw new Error('Yalnızca kendi dersiniz için hedef belirleyebilirsiniz.')
    if (
      state.studentGoals.some(
        (g) =>
          g.studentId === data.studentId &&
          g.subjectId === data.subjectId &&
          OPEN_GOAL_STATUSES.includes(g.status),
      )
    )
      throw new Error('Bu kapsam için açık bir hedef zaten var. Önce mevcut hedefi kapatın.')
    const series = goalSeries(state, data.studentId, data.subjectId)
    const baselineNet = series.length ? series[series.length - 1].net : 0
    if (data.targetNet <= baselineNet)
      throw new Error(`Hedef net, mevcut net değerinin (${baselineNet}) üzerinde olmalıdır.`)
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
  }
  if (command === 'goal-review') {
    const entry = goalRecord(state, session, recordId)
    if (entry.status !== 'Onay bekliyor')
      throw new Error('Yalnızca onay bekleyen hedef değerlendirilir.')
    Object.assign(entry, data, { reviewedAt: now, updatedAt: now })
    return entry
  }
  if (command === 'goal-step') {
    const entry = openGoalRecord(state, session, recordId)
    if (data.dueDate < dayKey(now)) throw new Error('Adım son tarihi geçmişte olamaz.')
    if (data.dueDate > entry.deadline.slice(0, 10))
      throw new Error('Adım son tarihi hedef son tarihinden sonra olamaz.')
    if (entry.steps.length >= 30) throw new Error('Bir hedefe en fazla 30 adım eklenebilir.')
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
  }
  if (command === 'goal-step-done') {
    const entry = openGoalRecord(state, session, recordId)
    if (entry.status !== 'Aktif')
      throw new Error('Adımlar hedef onaylandıktan sonra tamamlanabilir.')
    const step = entry.steps.find((s) => s.id === data.stepId)
    if (!step) throw new Error('Gelişim adımı bulunamadı. Listeyi yenileyin.')
    if (step.done) throw new Error('Bu adım zaten tamamlanmış.')
    Object.assign(step, { done: true, doneAt: now })
    entry.updatedAt = now
    return entry
  }
  if (command === 'goal-suggest') {
    const entry = openGoalRecord(state, session, recordId)
    const suggestions = suggestGoalSteps(state, entry, now)
    if (!suggestions.length)
      throw new Error(
        'Önerilecek yeni zayıf konu bulunamadı. Deneme sonucu girildiğinde tekrar deneyin.',
      )
    if (entry.steps.length + suggestions.length > 30)
      throw new Error('Bir hedefe en fazla 30 adım eklenebilir.')
    for (const suggestion of suggestions)
      entry.steps.push({ id: makeId('step'), ...suggestion, done: false })
    entry.updatedAt = now
    return entry
  }
  if (command === 'goal-comment') {
    const entry = goalRecord(state, session, recordId)
    entry.comments.push({ id: makeId('comment'), text: data.text, date: now, actor: session.role })
    entry.updatedAt = now
    return entry
  }
  if (command === 'goal-close') {
    const entry = openGoalRecord(state, session, recordId)
    Object.assign(entry, { status: 'Kapatıldı', closedAt: now, updatedAt: now })
    return entry
  }
  if (command === 'guidance') {
    scopedStudent(state, session, data.studentId)
    active(state, 'teachers', data.teacherId)
    if (session.role === 'ogretmen' && data.teacherId !== 't1')
      throw new Error('Kendi sorumluluğunuzda takip dosyası açabilirsiniz.')
    const entry = stamped(
      makeId,
      'guidance',
      { ...data, followUp: atDay(data.followUp), status: 'Takipte', notes: [] },
      now,
    )
    state.guidanceCases.unshift(entry)
    return entry
  }
  if (command === 'guidance-note') {
    const entry = requireRecord(state, 'guidanceCases', recordId)
    scopedStudent(state, session, entry.studentId)
    if (session.role === 'ogretmen' && entry.teacherId !== 't1')
      throw new Error('Bu takip dosyasının sorumlusu değilsiniz.')
    entry.notes.push({ id: makeId('note'), text: data.text, date: now, actor: session.role })
    Object.assign(entry, {
      sharedNote: data.sharedNote,
      followUp: atDay(data.followUp),
      status: data.status,
      updatedAt: now,
    })
    return entry
  }
  if (command === 'exam') {
    const allowed = subjectsForGrade(data.grade).map((s) => s.id)
    if (
      new Set(data.subjectIds).size !== data.subjectIds.length ||
      data.subjectIds.some((id) => !allowed.includes(id))
    )
      throw new Error('Sınav dersleri seçilen sınıf düzeyine uygun olmalıdır.')
    if ((data.type === 'LGS' && data.grade !== 8) || (data.type === 'YKS' && data.grade < 9))
      throw new Error('LGS için 8. sınıf; YKS için lise düzeyi seçin.')
    if (
      session.role === 'ogretmen' &&
      !state.classes.some(
        (c) => c.grade === data.grade && workflowScope(state, session).classIds.has(c.id),
      )
    )
      throw new Error('Bu sınıf düzeyinde göreviniz bulunmuyor.')
    const entry = stamped(makeId, 'exam', { ...data, date: atDay(data.date) }, now)
    state.mockExams.unshift(entry)
    return entry
  }
  if (command === 'exam-result') {
    const result = validateExamResult(state, session, input)
    upsertResult(state, result, makeId, now)
    return result
  }
  if (command === 'exam-import') {
    const results = parseResultsCsv(data.csv).map((row) => validateExamResult(state, session, row))
    const keys = results.map((r) => `${r.examId}/${r.studentId}/${r.subjectId}`)
    if (new Set(keys).size !== keys.length)
      throw new Error('CSV aynı öğrenci, sınav ve ders için yinelenen satır içeriyor.')
    results.forEach((result) => upsertResult(state, result, makeId, now))
    return results.length
  }
  if (command === 'renewal') {
    const student = scopedStudent(state, session, data.studentId),
      oldClass = active(state, 'classes', student.classId)
    if (data.year <= state.academicYear)
      throw new Error('Yenileme için mevcut dönemden sonraki bir yıl seçin.')
    if (state.renewals.some((r) => r.studentId === student.id && r.year === data.year))
      throw new Error('Bu öğrenci için bu yılın yenilemesi zaten oluşturulmuş.')
    if (state.renewals.some((r) => r.studentId === student.id && r.status === 'Planlandı'))
      throw new Error('Öğrencinin planlanmış bir dönem geçişi var; önce onu tamamlayın.')
    if (data.mode === 'graduate') {
      if (oldClass.grade !== 12)
        throw new Error('Mezuniyet yalnızca 12. sınıf öğrencileri için yapılabilir.')
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
    const target = active(state, 'classes', data.targetClassId)
    active(state, 'branches', target.branchId)
    if (target.grade !== oldClass.grade + 1)
      throw new Error('Yeni sınıf öğrencinin bir üst sınıf düzeyinde olmalıdır.')
    const occupants = new Set(
      state.students.filter((s) => s.isActive && s.classId === target.id).map((s) => s.id),
    )
    state.renewals
      .filter(
        (r) => r.targetClassId === target.id && r.year === data.year && r.status === 'Planlandı',
      )
      .forEach((r) => occupants.add(r.studentId))
    if (occupants.size >= target.capacity) throw new Error('Yeni sınıfta yeterli kontenjan yok.')
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
  }
  if (command === 'renewal-activate') {
    const entry = requireRecord(state, 'renewals', recordId),
      student = active(state, 'students', entry.studentId)
    if (entry.status !== 'Planlandı') throw new Error('Bu dönem geçişi zaten uygulanmış.')
    if (student.classId !== entry.fromClassId)
      throw new Error('Öğrencinin sınıfı değişmiş. Dönem geçişi uygulanamadı.')
    if (
      (state.tutorSessions || []).some(
        (tutor) =>
          tutor.status === 'Planlandı' &&
          Date.parse(tutor.date) > Date.parse(now) &&
          tutor.studentIds.includes(student.id),
      )
    )
      throw new Error(
        'Öğrencinin ileri tarihli etütlerini iptal ettikten sonra dönem geçişini uygulayın.',
      )
    if (entry.mode === 'renew') {
      const target = active(state, 'classes', entry.targetClassId)
      active(state, 'branches', target.branchId)
      if (
        state.students.filter((s) => s.isActive && s.classId === target.id).length >=
        target.capacity
      )
        throw new Error('Hedef sınıfın kontenjanı dolu.')
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
      const target = requireRecord(state, 'classes', entry.targetClassId)
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
  }
  if (command === 'lesson') {
    validateLesson(state, data, recordId)
    const entry = recordId
      ? requireRecord(state, 'schedule', recordId)
      : stamped(makeId, 'lesson', {}, now)
    if (entry.cancelledAt) throw new Error('İptal edilmiş ders düzenlenemez.')
    Object.assign(entry, data, {
      title: state.subjects.find((s) => s.id === data.subjectId)?.name,
      updatedAt: now,
    })
    if (!recordId) state.schedule.push(entry)
    return entry
  }
  if (command === 'substitute') {
    const lesson = requireRecord(state, 'schedule', recordId)
    if (lesson.cancelledAt) throw new Error('İptal edilmiş ders için görevlendirme yapılamaz.')
    if (lesson.teacherId === data.teacherId) throw new Error('Farklı bir öğretmen seçin.')
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
  }
  if (command === 'lesson-cancel') {
    const entry = requireRecord(state, 'schedule', recordId)
    if (entry.cancelledAt) throw new Error('Ders zaten iptal edilmiş.')
    entry.cancelledAt = now
    return entry
  }
  if (command === 'study-task') {
    if (data.dueDate < dayKey(now))
      throw new Error('Yeni çalışma görevinin son tarihi geçmişte olamaz.')
    const student = scopedStudent(state, session, data.studentId)
    const teacher = state.assignments.find(
      (a) => a.classId === student.classId && a.subjectId === data.subjectId,
    )?.teacherId
    if (!teacher || !state.teachers.some((t) => t.id === teacher && t.isActive))
      throw new Error('Bu ders için aktif öğretmen ataması bulunmuyor.')
    if (session.role === 'ogretmen' && teacher !== 't1')
      throw new Error('Yalnızca kendi dersiniz için görev verebilirsiniz.')
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
  }
  if (command === 'study-complete' || command === 'study-review') {
    const entry = requireRecord(state, 'studyTasks', recordId)
    scopedStudent(state, session, entry.studentId)
    if (command === 'study-complete') {
      if (!['Onaylandı', 'Tekrar çalışılacak'].includes(entry.status))
        throw new Error('Yalnızca onaylanmış veya tekrar verilen görev teslim edilebilir.')
      Object.assign(entry, data, { status: 'Değerlendirme bekliyor', completedAt: now })
    } else {
      if (session.role === 'ogretmen' && entry.teacherId !== 't1')
        throw new Error('Bu çalışma görevinin öğretmeni değilsiniz.')
      if (
        (entry.status === 'Onay bekliyor' && data.status !== 'Onaylandı') ||
        (entry.status !== 'Onay bekliyor' && entry.status !== 'Değerlendirme bekliyor')
      )
        throw new Error('Görevin durumuna uygun değerlendirme seçin.')
      Object.assign(entry, data, { reviewedAt: now })
    }
    return entry
  }
  if (command === 'event') {
    active(state, 'branches', data.branchId)
    const classroom = data.classId ? active(state, 'classes', data.classId) : null
    if (classroom && classroom.branchId !== data.branchId)
      throw new Error('Sınıf ve kampüs aynı olmalıdır.')
    if (
      session.role === 'ogretmen' &&
      (!classroom || !workflowScope(state, session).classIds.has(classroom.id))
    )
      throw new Error('Yalnızca kendi sınıflarınıza etkinlik oluşturabilirsiniz.')
    if (Date.parse(data.endDate) <= Date.parse(data.date))
      throw new Error('Bitiş zamanı başlangıçtan sonra olmalıdır.')
    if (data.requiresConsent && Date.parse(atDay(data.consentDeadline)) > Date.parse(data.date))
      throw new Error('Onay son tarihi etkinlik başlangıcından sonra olamaz.')
    const conflict = tutorConflict(
      { ...state, schedule: [], appointments: [], schoolEvents: [] },
      {
        ...data,
        teacherId: session.role === 'ogretmen' ? 't1' : null,
        room: data.location,
        duration: (Date.parse(data.endDate) - Date.parse(data.date)) / 60000,
        studentIds: eventStudents(state, data).map((student) => student.id),
      },
    )
    if (conflict) throw new Error(conflict)
    const entry = stamped(
      makeId,
      'event',
      {
        ...data,
        consentDeadline: atDay(data.consentDeadline),
        teacherId: session.role === 'ogretmen' ? 't1' : null,
        status: 'Planlandı',
      },
      now,
    )
    state.schoolEvents.unshift(entry)
    return entry
  }
  if (command === 'consent') {
    const event = requireRecord(state, 'schoolEvents', recordId),
      student = scopedStudent(state, session, session.childId)
    if (
      !event.requiresConsent ||
      event.status === 'İptal' ||
      !eventStudents(state, event).some((s) => s.id === student.id)
    )
      throw new Error('Bu etkinlik için çocuğunuz adına onay verilemez.')
    if (
      Date.parse(now) > Date.parse(event.consentDeadline) + 43199999 ||
      Date.parse(now) >= Date.parse(event.date)
    )
      throw new Error('Etkinliğin onay süresi dolmuş.')
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
  }
  if (command === 'event-cancel') {
    const event = requireRecord(state, 'schoolEvents', recordId)
    if (session.role === 'ogretmen' && event.teacherId !== 't1')
      throw new Error('Yalnızca oluşturduğunuz etkinliği iptal edebilirsiniz.')
    event.status = 'İptal'
    return event
  }
  if (command === 'route') {
    active(state, 'branches', data.branchId)
    if (
      state.transportRoutes.some(
        (r) =>
          r.id !== recordId &&
          r.status === 'Aktif' &&
          r.plate.toLocaleLowerCase('tr') === data.plate.toLocaleLowerCase('tr'),
      )
    )
      throw new Error('Bu plaka başka aktif güzergâhta kullanılıyor.')
    if (recordId) {
      const entry = active(state, 'transportRoutes', recordId),
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
        throw new Error(
          'Atanmış öğrenciler nedeniyle kapasite, durak veya kampüs değişikliği yapılamaz. Önce atamaları güncelleyin.',
        )
      Object.assign(entry, data, { updatedAt: now })
      return entry
    }
    const entry = stamped(makeId, 'route', { ...data, status: 'Aktif' }, now)
    state.transportRoutes.push(entry)
    return entry
  }
  if (command === 'route-archive') {
    const entry = active(state, 'transportRoutes', recordId)
    if (state.transportAssignments.some((a) => a.routeId === entry.id))
      throw new Error(
        'Önce bu güzergâhtaki öğrencileri başka servise taşıyın veya atamalarını kaldırın.',
      )
    entry.status = 'Arşiv'
    return entry
  }
  if (command === 'transport-assign') {
    const student = scopedStudent(state, session, data.studentId),
      route = active(state, 'transportRoutes', data.routeId)
    if (state.classes.find((c) => c.id === student.classId)?.branchId !== route.branchId)
      throw new Error('Servis ve öğrenci aynı kampüste olmalıdır.')
    if (!route.stops.includes(data.stop)) throw new Error('Seçilen durak bu güzergâhta bulunmuyor.')
    if (
      state.transportAssignments.filter((a) => a.routeId === route.id && a.studentId !== student.id)
        .length >= route.capacity
    )
      throw new Error('Servis kontenjanı dolu.')
    const existing = state.transportAssignments.find((a) => a.studentId === student.id)
    if (existing) Object.assign(existing, data, { updatedAt: now })
    else state.transportAssignments.push(stamped(makeId, 'transport', data, now))
    return route
  }
  if (command === 'transport-remove') {
    requireRecord(state, 'transportAssignments', recordId)
    state.transportAssignments = state.transportAssignments.filter((a) => a.id !== recordId)
    return true
  }
  if (command === 'meal') {
    active(state, 'branches', data.branchId)
    const previous = state.mealMenus.find(
      (m) => m.branchId === data.branchId && m.date.slice(0, 10) === data.date,
    )
    if (previous && previous.id !== recordId)
      throw new Error('Bu kampüs ve gün için menü zaten var. Mevcut menüyü düzenleyin.')
    if (recordId) {
      const entry = requireRecord(state, 'mealMenus', recordId)
      Object.assign(entry, data, { date: atDay(data.date), updatedAt: now })
      return entry
    }
    const entry = stamped(makeId, 'meal', { ...data, date: atDay(data.date) }, now)
    state.mealMenus.push(entry)
    return entry
  }
  if (command === 'club') {
    active(state, 'branches', data.branchId)
    const teacher = active(state, 'teachers', data.teacherId)
    if (teacher.branchId !== data.branchId || (session.role === 'ogretmen' && teacher.id !== 't1'))
      throw new Error(
        'Kulüp sorumlusu kampüse uygun olmalıdır; öğretmen kendi adına kulüp açabilir.',
      )
    const entry = stamped(makeId, 'club', { ...data, status: 'Aktif' }, now)
    state.clubs.push(entry)
    return entry
  }
  if (command === 'club-enroll') {
    const club = active(state, 'clubs', recordId),
      student = scopedStudent(state, session, data.studentId)
    if (session.role === 'ogretmen') ownedClub(state, session, recordId)
    if (state.classes.find((c) => c.id === student.classId)?.branchId !== club.branchId)
      throw new Error('Öğrenci ve kulüp aynı kampüste olmalıdır.')
    const existing = state.clubMemberships.find(
      (m) => m.clubId === club.id && m.studentId === student.id,
    )
    if (existing?.status === 'Aktif') throw new Error('Öğrenci bu kulübe zaten kayıtlı.')
    if (
      state.clubMemberships.filter((m) => m.clubId === club.id && m.status === 'Aktif').length >=
      club.capacity
    )
      throw new Error('Kulüp kontenjanı dolu.')
    if (existing) Object.assign(existing, { status: 'Aktif', updatedAt: now })
    else
      state.clubMemberships.push(
        stamped(makeId, 'member', { clubId: club.id, studentId: student.id, status: 'Aktif' }, now),
      )
    return club
  }
  if (command === 'club-leave') {
    const member = requireRecord(state, 'clubMemberships', recordId)
    scopedStudent(state, session, member.studentId)
    if (session.role === 'ogretmen') ownedClub(state, session, member.clubId)
    if (member.status !== 'Aktif') throw new Error('Üyelik zaten sonlandırılmış.')
    member.status = 'Ayrıldı'
    return member
  }
  if (command === 'club-attendance') {
    const club = ownedClub(state, session, recordId),
      members = state.clubMemberships.filter((m) => m.clubId === club.id && m.status === 'Aktif')
    if (data.date > dayKey(now)) throw new Error('Gelecek tarih için kulüp yoklaması alınamaz.')
    if (
      !members.length ||
      members.some((m) => !data.marks[m.studentId]) ||
      Object.keys(data.marks).some((id) => !members.some((m) => m.studentId === id))
    )
      throw new Error('Tüm aktif üyelerin yoklama durumunu seçin.')
    for (const member of members) {
      const entry = state.clubAttendance.find(
        (a) =>
          a.clubId === club.id &&
          a.studentId === member.studentId &&
          a.date.slice(0, 10) === data.date,
      )
      if (entry) Object.assign(entry, { status: data.marks[member.studentId], updatedAt: now })
      else
        state.clubAttendance.push(
          stamped(
            makeId,
            'club-attendance',
            {
              clubId: club.id,
              studentId: member.studentId,
              date: atDay(data.date),
              status: data.marks[member.studentId],
            },
            now,
          ),
        )
    }
    return club
  }
  if (command === 'achievement') {
    scopedStudent(state, session, data.studentId)
    ownedClub(state, session, data.clubId)
    if (
      !state.clubMemberships.some(
        (m) => m.studentId === data.studentId && m.clubId === data.clubId && m.status === 'Aktif',
      )
    )
      throw new Error('Başarı kaydı için öğrenci kulübün aktif üyesi olmalıdır.')
    const entry = stamped(makeId, 'achievement', { ...data, date: atDay(data.date) }, now)
    state.socialAchievements.push(entry)
    return entry
  }
  if (command === 'club-archive') {
    const club = ownedClub(state, session, recordId)
    club.status = 'Arşiv'
    state.clubMemberships
      .filter((m) => m.clubId === club.id && m.status === 'Aktif')
      .forEach((m) => {
        m.status = 'Ayrıldı'
      })
    return club
  }
  throw new Error('İşlem bulunamadı.')
}

export function runWorkflow(
  state,
  session,
  command,
  input,
  makeId,
  recordId,
  now = new Date().toISOString(),
) {
  const collections = {
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
  const previous = recordId && collection ? state[collection].find((r) => r.id === recordId) : null
  const oldValue = previous ? JSON.parse(JSON.stringify(previous)) : null
  const result = executeWorkflow(state, session, command, input, makeId, recordId, now)
  state.audit.unshift({
    id: makeId('audit'),
    actor: session.role,
    user_id:
      session.role === 'ogretmen'
        ? 't1'
        : session.role === 'ogrenci'
          ? 's1'
          : session.role === 'veli'
            ? 'p1'
            : `demo-${session.role}`,
    action: command,
    table_name: collection,
    record_id: recordId || result?.id || command,
    date: now,
    changed_at: now,
    old_value: oldValue,
    new_value: typeof result === 'object' ? JSON.parse(JSON.stringify(result)) : { result },
  })
  state.audit = state.audit.slice(0, 200)
  return result
}
