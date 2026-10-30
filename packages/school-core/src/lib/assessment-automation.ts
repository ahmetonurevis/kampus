import { z } from 'zod'
import type { State } from '../data/seed.ts'
import { toAuditValue, type RecordAuditEntry } from './audit.ts'
import type { MakeId, Session } from './domain.ts'
import { dayKey } from './format.ts'
import { csvObjects } from './delimited-input.ts'
import { appointmentHoldsTime } from './appointment-status.ts'
import { intervalsOverlap, tutorConflict } from './tutor-conflicts.ts'
import { DomainError } from './errors.ts'
import { scopeFor, sessionActor, sessionTeacherId } from './scope.ts'

z.config(z.locales.tr())

const integer = (min: number, max: number) => z.coerce.number().int().min(min).max(max)
const identifier = z.string().trim().min(1, 'Bir kayıt seçin.')
const day = z
  .string()
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      Number.isFinite(Date.parse(`${v}T09:00Z`)) &&
      new Date(`${v}T09:00Z`).toISOString().slice(0, 10) === v,
    'Geçerli bir tarih seçin.',
  )
const instant = z
  .string()
  .refine(
    (v) =>
      day.safeParse(v.slice(0, 10)).success &&
      /T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v) &&
      Number.isFinite(Date.parse(v)),
    'Geçerli bir tarih ve saat seçin.',
  )
const fileText = z
  .string()
  .min(1, 'Dosya içeriği boş.')
  .refine((v) => new TextEncoder().encode(v).length <= 1024 * 1024, 'Dosya en fazla 1 MB olabilir.')
export const keyHeader = ['booklet', 'question', 'subjectId', 'topic', 'answer'] as const
export const responseHeader = ['student', 'booklet', 'answers'] as const
export const automationSchemas = {
  profile: z.object({
    examId: identifier,
    title: z.string().trim().min(2).max(100),
    format: z.enum(['csv', 'fixed']),
    identifier: z.enum(['id', 'number']),
    headerLines: integer(0, 10),
    studentStart: integer(1, 1000),
    studentLength: integer(1, 100),
    bookletStart: integer(1, 1000),
    bookletLength: integer(1, 10),
    answersStart: integer(1, 1000),
    answersLength: integer(1, 400),
    keyCsv: fileText,
  }),
  evaluate: z.object({ profileId: identifier, text: fileText }),
  plan: z.object({
    examId: identifier,
    threshold: integer(1, 100),
    fromDate: day,
    toDate: day,
    duration: integer(15, 120),
    maxGroupSize: integer(1, 40),
    branchId: z.string().default(''),
    subjectId: z.string().default(''),
  }),
  slot: z.object({ teacherId: identifier, date: instant, duration: integer(15, 120) }),
}

// Kayıt tipleri State'e bağlı değildir; State bunları örnek veride boş başlayan koleksiyonlar için kullanır.
export type AttendanceMark = 'Geldi' | 'Gelmedi' | 'İzinli'
export type AnswerKeyQuestion = { number: number; subjectId: string; topic: string; answer: string }
export type QuestionOutcome = 'correct' | 'wrong' | 'blank' | 'multiple' | 'cancelled'
export type OpticalQuestionResult = AnswerKeyQuestion & {
  response: string | undefined
  outcome: QuestionOutcome
}
export type OpticalTopicScore = {
  topic: string
  total: number
  correct: number
  percent: number | null
}
export type OpticalPreviewRow = {
  examId: string
  studentId: string
  studentName: string
  subjectId: string
  booklet: string
  profileId: string
  keyRevision: number
  questionResults: OpticalQuestionResult[]
  correct: number
  wrong: number
  blank: number
  multiple: number
  cancelled: number
  topicScores: OpticalTopicScore[]
  weakTopics: string[]
  net: number
  replaces: boolean
}
type Stamp = { id: string; createdAt: string; updatedAt: string }
type MockExam = State['mockExams'][number]
type OpticalProfile = State['opticalProfiles'][number]
export type OpticalEvaluation = Omit<OpticalPreviewRow, 'studentName' | 'replaces'> & Stamp
export type TutorGroup = {
  examId: string
  branchId: string
  grade: number
  subjectId: string
  topic: string
  studentIds: string[]
  scores: { studentId: string; percent: number | null }[]
}
export type PlannedTutorSession = TutorGroup & {
  teacherId: string
  date: string
  duration: number
  room: string
  roomClassId: string
  capacity: number
}
export type TutorSession = PlannedTutorSession &
  Stamp & {
    status: string
    attendance: Record<string, AttendanceMark>
    threshold: number
    cancelReason?: string
    cancelledAt?: string
    attendanceAt?: string
  }

const record = <T extends { id: string }>(list: readonly T[] | undefined, id: string) => {
  const value = list?.find((r) => r.id === id)
  if (!value)
    throw new DomainError('record_not_found', 'İlgili kayıt bulunamadı. Listeyi yenileyin.', {
      kind: 'not_found',
    })
  return value
}
const active = <T extends { id: string; isActive?: boolean; deletedAt?: string | null }>(
  list: readonly T[] | undefined,
  id: string,
) => {
  const value = record(list, id)
  if (value.isActive === false || value.deletedAt)
    throw new DomainError('record_inactive', 'Pasif kayıt kullanılamaz.')
  return value
}
function access(state: State, session: Session, module: string, write = false) {
  if (!state.modules[module])
    throw new DomainError('module_disabled', 'Bu modül kurum ayarlarından kapalı.', {
      kind: 'forbidden',
    })
  if (write && !['yonetici', 'ogretmen'].includes(session.role))
    throw new DomainError('permission_denied', 'Bu işlem için yetkiniz bulunmuyor.', {
      kind: 'forbidden',
    })
  if (session.role === 'ogretmen') active(state.teachers, sessionTeacherId(state, session) ?? '')
}
/**
 * Optik ve etüt kapsamı `scopeFor` üzerindendir. Ön büro bu modülleri kullanmaz (DOM-YTK-021);
 * veli kapsamı seçili çocukla daraltılır.
 */
export function automationScope(state: State, session: Session) {
  const scope = scopeFor(state, sessionActor(state, session))
  const teacherId = sessionTeacherId(state, session)
  const teacher = state.teachers.find((t) => t.id === teacherId)
  const studentIds: ReadonlySet<string> =
    session.role === 'onburo'
      ? new Set()
      : session.role === 'veli'
        ? new Set(
            session.childId !== undefined && scope.studentIds.has(session.childId)
              ? [session.childId]
              : [],
          )
        : scope.studentIds
  const permitted = state.students.filter((s) => studentIds.has(s.id))
  return {
    students: permitted.filter((s) => s.isActive),
    studentIds,
    teacher,
    classIds: scope.classIds,
  }
}
export function automationExams(state: State, session: Session) {
  const scope = automationScope(state, session)
  return state.mockExams.filter(
    (exam) =>
      session.role === 'yonetici' ||
      scope.students.some(
        (s) => state.classes.find((c) => c.id === s.classId)?.grade === exam.grade,
      ),
  )
}

export function parseAnswerKey(state: State, exam: MockExam, raw: string) {
  const rows = csvObjects(raw, keyHeader, 3200)
  const keys = new Map<string, AnswerKeyQuestion[]>()
  for (const [index, row] of rows.entries()) {
    const booklet = row.booklet.trim().toLocaleUpperCase('tr'),
      number = Number(row.question.trim())
    const subjectId = row.subjectId.trim(),
      topic = row.topic.trim(),
      answer = row.answer.trim().toUpperCase()
    if (
      !/^[A-Z0-9]{1,4}$/.test(booklet) ||
      !/^\d+$/.test(row.question.trim()) ||
      !Number.isInteger(number) ||
      number < 1 ||
      number > 400
    )
      throw new DomainError(
        'answer_key_invalid_row',
        `Anahtar ${index + 2}. satırda kitapçık veya soru numarası geçersiz.`,
      )
    if (!exam.subjectIds.includes(subjectId) || !state.subjects.some((s) => s.id === subjectId))
      throw new DomainError(
        'answer_key_subject_out_of_scope',
        `Anahtar ${index + 2}. satırdaki ders sınav kapsamında değil.`,
      )
    if (!topic || topic.length > 200 || !/^[A-E-]$/.test(answer))
      throw new DomainError(
        'answer_key_invalid_values',
        `Anahtar ${index + 2}. satırda kazanım veya cevap geçersiz. Cevap A–E, iptal soru - olmalıdır.`,
      )
    let questions = keys.get(booklet)
    if (!questions) {
      questions = []
      keys.set(booklet, questions)
    }
    if (questions.some((q) => q.number === number))
      throw new DomainError(
        'answer_key_duplicate_question',
        `${booklet} kitapçığında ${number}. soru yineleniyor.`,
      )
    questions.push({ number, subjectId, topic, answer })
  }
  if (keys.size > 8)
    throw new DomainError(
      'answer_key_too_many_booklets',
      'En fazla sekiz kitapçık tanımlayabilirsiniz.',
    )
  const sorted = [...keys]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([booklet, questions]) => ({
      booklet,
      questions: questions.sort((a, b) => a.number - b.number),
    }))
  let expected = ''
  for (const key of sorted) {
    if (key.questions.some((q, i) => q.number !== i + 1))
      throw new DomainError(
        'answer_key_question_sequence',
        `${key.booklet} kitapçığı soruları 1'den başlayan kesintisiz sıra içermelidir.`,
      )
    const counts: Record<string, number> = {}
    for (const question of key.questions) {
      const signature = JSON.stringify([
        question.subjectId,
        question.topic,
        question.answer === '-',
      ])
      counts[signature] = (counts[signature] || 0) + 1
    }
    if (
      exam.subjectIds.some(
        (id) => !key.questions.some((q) => q.subjectId === id && q.answer !== '-'),
      )
    )
      throw new DomainError(
        'answer_key_subject_empty',
        'Her sınav dersi en az bir geçerli soru içermelidir.',
      )
    if (exam.subjectIds.some((id) => key.questions.filter((q) => q.subjectId === id).length > 200))
      throw new DomainError(
        'answer_key_subject_too_large',
        'Bir derste en fazla 200 soru olabilir.',
      )
    const signature = JSON.stringify(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
    if (expected && signature !== expected)
      throw new DomainError(
        'answer_key_booklet_mismatch',
        'Kitapçıkların ders/kazanım soru sayıları ve iptalleri eşit olmalıdır.',
      )
    expected = signature
  }
  return sorted
}
export function prepareProfile(state: State, session: Session, input: unknown, profileId = '') {
  access(state, session, 'optical', true)
  if (session.role !== 'yonetici')
    throw new DomainError(
      'answer_key_admin_only',
      'Cevap anahtarını yalnızca yönetici düzenleyebilir.',
      { kind: 'forbidden' },
    )
  if (!state.modules.exams)
    throw new DomainError('module_disabled', 'Deneme sınavları modülü kapalı.', {
      kind: 'forbidden',
    })
  const data = automationSchemas.profile.parse(input),
    exam = record(state.mockExams, data.examId)
  if (state.opticalProfiles.some((p) => p.examId === exam.id && p.id !== profileId))
    throw new DomainError(
      'optical_profile_exists',
      'Bu sınavın zaten optik profili var. Mevcut profili düzenleyin.',
      { kind: 'conflict' },
    )
  const keys = parseAnswerKey(state, exam, data.keyCsv)
  if (data.format === 'fixed') {
    const fields: [number, number][] = [
      [data.studentStart, data.studentLength],
      [data.bookletStart, data.bookletLength],
      [data.answersStart, data.answersLength],
    ]
    if (
      fields.some(([start, length], i) =>
        fields.some(
          ([other, width], j) => i !== j && start < other + width && other < start + length,
        ),
      )
    )
      throw new DomainError(
        'optical_field_overlap',
        'DAT/TXT öğrenci, kitapçık ve cevap alanları çakışmamalıdır.',
      )
    if (keys.some((k) => k.questions.length !== data.answersLength))
      throw new DomainError(
        'optical_answer_length_mismatch',
        'Cevap alanı uzunluğu kitapçığın soru sayısıyla aynı olmalıdır.',
      )
    if (keys.some((k) => k.booklet.length > data.bookletLength))
      throw new DomainError(
        'optical_booklet_field_too_short',
        'Kitapçık alanı kodu içerecek kadar uzun olmalıdır.',
      )
  }
  const existing = profileId ? record(state.opticalProfiles, profileId) : null
  if (existing && existing.examId !== exam.id)
    throw new DomainError('optical_profile_exam_locked', 'Profilin sınavı değiştirilemez.')
  return {
    ...data,
    keys,
    revision: existing
      ? existing.revision + (JSON.stringify(existing.keys) !== JSON.stringify(keys) ? 1 : 0)
      : 1,
  }
}
function responseRows(profile: OpticalProfile, raw: string) {
  if (profile.format === 'csv')
    return csvObjects(raw, responseHeader).map((row, i) => ({ ...row, line: i + 2 }))
  const lines = raw
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .slice(profile.headerLines)
  while (lines.length && !lines.at(-1)?.trim()) lines.pop()
  if (!lines.length || lines.length > 1000)
    throw new DomainError('optical_row_count_invalid', 'DAT/TXT 1–1000 öğrenci satırı içermelidir.')
  const width = Math.max(
    profile.studentStart + profile.studentLength - 1,
    profile.bookletStart + profile.bookletLength - 1,
    profile.answersStart + profile.answersLength - 1,
  )
  return lines.map((line, i) => {
    const characters = Array.from(line),
      rowNumber = i + profile.headerLines + 1
    if (characters.length < width)
      throw new DomainError(
        'optical_row_too_short',
        `DAT/TXT ${rowNumber}. satır alanları dolduracak kadar uzun değil.`,
      )
    const field = (start: number, length: number) =>
      characters.slice(start - 1, start - 1 + length).join('')
    return {
      student: field(profile.studentStart, profile.studentLength),
      booklet: field(profile.bookletStart, profile.bookletLength),
      answers: field(profile.answersStart, profile.answersLength),
      line: rowNumber,
    }
  })
}
function summarize(questions: readonly OpticalQuestionResult[]) {
  const counts = { correct: 0, wrong: 0, blank: 0, multiple: 0, cancelled: 0 }
  for (const q of questions) {
    if (q.outcome === 'multiple') {
      counts.multiple++
      counts.wrong++
    } else counts[q.outcome]++
  }
  const topics = [...new Set(questions.map((q) => q.topic))].map((topic) => {
    const rows = questions.filter((q) => q.topic === topic && q.outcome !== 'cancelled')
    const correct = rows.filter((q) => q.outcome === 'correct').length
    return {
      topic,
      total: rows.length,
      correct,
      percent: rows.length ? Math.round((correct / rows.length) * 100) : null,
    }
  })
  return {
    ...counts,
    topicScores: topics,
    weakTopics: topics
      .filter((t) => t.total > 0 && (t.correct / t.total) * 100 < 70)
      .map((t) => t.topic),
  }
}
export function previewOptical(
  state: State,
  session: Session,
  input: unknown,
): OpticalPreviewRow[] {
  access(state, session, 'optical', true)
  if (!state.modules.exams)
    throw new DomainError('module_disabled', 'Deneme sınavları modülü kapalı.', {
      kind: 'forbidden',
    })
  const data = automationSchemas.evaluate.parse(input),
    profile = record(state.opticalProfiles, data.profileId)
  const exam = record(state.mockExams, profile.examId),
    scope = automationScope(state, session),
    seen = new Set<string>()
  const output: OpticalPreviewRow[] = []
  for (const row of responseRows(profile, data.text)) {
    const identity = row.student.trim(),
      matches = state.students.filter(
        (s) => String(s[profile.identifier === 'number' ? 'number' : 'id']) === identity,
      )
    const [student] = matches
    // Kapsam dışı öğrenci "yok" gibi davranır: aynı kod ve ileti, numaranın kurumda var olup
    // olmadığını sızdırmaz. Pasif ama kapsamdaki öğrenciyi aktör zaten görür; ayrı ileti alır.
    if (matches.length !== 1 || !student || !scope.studentIds.has(student.id))
      throw new DomainError(
        'optical_student_unmatched',
        `${row.line}. satırdaki öğrenci tekil eşleşmedi: ${identity || 'boş kimlik'}.`,
      )
    if (!student.isActive)
      throw new DomainError('optical_student_out_of_scope', `${row.line}. satırdaki öğrenci pasif.`)
    if (state.classes.find((c) => c.id === student.classId)?.grade !== exam.grade)
      throw new DomainError(
        'optical_level_mismatch',
        `${row.line}. satırdaki öğrencinin sınıf düzeyi sınavla uyumsuz.`,
      )
    if (seen.has(student.id))
      throw new DomainError(
        'optical_student_duplicate',
        `${row.line}. satırda öğrenci yineleniyor.`,
      )
    seen.add(student.id)
    const booklet = row.booklet.trim().toUpperCase(),
      key = profile.keys.find((k) => k.booklet === booklet)
    if (!key)
      throw new DomainError(
        'optical_booklet_unknown',
        `${row.line}. satırdaki kitapçık tanımsız: ${booklet || 'boş'}.`,
      )
    const responses = Array.from(row.answers.toUpperCase())
    if (responses.length !== key.questions.length)
      throw new DomainError(
        'optical_answer_count_mismatch',
        `${row.line}. satırda ${key.questions.length} cevap bekleniyor; ${responses.length} karakter var. Boş cevaplar için - kullanabilirsiniz.`,
      )
    if (responses.some((c) => !'ABCDE -._*'.includes(c)))
      throw new DomainError(
        'optical_answer_invalid',
        `${row.line}. satırda geçersiz cevap var. A–E, boş için -/./_/boşluk, çoklu işaret için * kullanın.`,
      )
    for (const subjectId of exam.subjectIds.filter(
      // Öğretmen için access() aktif öğretmen kaydını zaten doğruladı.
      (id) => session.role !== 'ogretmen' || scope.teacher?.subjectId === id,
    )) {
      const questionResults = key.questions
        .filter((q) => q.subjectId === subjectId)
        .map((q) => {
          const response = responses[q.number - 1]
          const outcome: QuestionOutcome =
            q.answer === '-'
              ? 'cancelled'
              : response === '*'
                ? 'multiple'
                : response !== undefined && ' -._'.includes(response)
                  ? 'blank'
                  : response === q.answer
                    ? 'correct'
                    : 'wrong'
          return { ...q, response, outcome }
        })
      const summary = summarize(questionResults)
      output.push({
        examId: exam.id,
        studentId: student.id,
        studentName: student.name,
        subjectId,
        booklet,
        profileId: profile.id,
        keyRevision: profile.revision,
        questionResults,
        ...summary,
        net:
          Math.round(
            (summary.correct - (exam.wrongPenalty ? summary.wrong / exam.wrongPenalty : 0)) * 100,
          ) / 100,
        replaces: state.mockResults.some(
          (r) => r.examId === exam.id && r.studentId === student.id && r.subjectId === subjectId,
        ),
      })
    }
  }
  if (!output.length)
    throw new DomainError(
      'no_evaluation_in_scope',
      'Sınavda branşınıza uygun değerlendirme bulunmuyor.',
    )
  return output
}

export function currentEvaluations(state: State, examId: string, session: Session) {
  const scope = automationScope(state, session)
  return (state.opticalEvaluations || []).filter((evaluation) => {
    const profile = state.opticalProfiles.find((p) => p.id === evaluation.profileId)
    const result = state.mockResults.find(
      (r) =>
        r.examId === evaluation.examId &&
        r.studentId === evaluation.studentId &&
        r.subjectId === evaluation.subjectId,
    )
    return (
      evaluation.examId === examId &&
      profile?.revision === evaluation.keyRevision &&
      result?.evaluationId === evaluation.id &&
      scope.studentIds.has(evaluation.studentId) &&
      (session.role !== 'ogretmen' || scope.teacher?.subjectId === evaluation.subjectId)
    )
  })
}
export function tutoringSessions(state: State, session: Session) {
  if (!state.modules.tutoring) return []
  const scope = automationScope(state, session)
  return (state.tutorSessions || [])
    .filter(
      (s) =>
        session.role === 'yonetici' ||
        (session.role === 'ogretmen'
          ? s.teacherId === sessionTeacherId(state, session)
          : s.studentIds.some((id) => scope.studentIds.has(id))),
    )
    .map((s) => ({
      ...s,
      studentIds: ['ogrenci', 'veli'].includes(session.role)
        ? s.studentIds.filter((id) => scope.studentIds.has(id))
        : s.studentIds,
      scores: ['ogrenci', 'veli'].includes(session.role)
        ? s.scores.filter((score) => scope.studentIds.has(score.studentId))
        : s.scores,
      attendance: ['ogrenci', 'veli'].includes(session.role)
        ? Object.fromEntries(
            Object.entries(s.attendance).filter(([id]) => scope.studentIds.has(id)),
          )
        : s.attendance,
    }))
}

export function tutoringCalendarEntries(state: State, session: Session) {
  return tutoringSessions(state, session)
    .filter((s) => s.status !== 'İptal')
    .map((s) => ({
      ...s,
      isTutoring: true,
      classId: s.roomClassId,
      title: `Etüt · ${state.subjects.find((subject) => subject.id === s.subjectId)?.name || s.subjectId} · ${s.topic}`,
      subtitle: `${s.studentIds.length} öğrenci · Derslik ${s.room}`,
    }))
}
function planInput(state: State, session: Session, input: unknown, now: string) {
  access(state, session, 'tutoring', true)
  const data = automationSchemas.plan.parse(input)
  if (!state.modules.exams)
    throw new DomainError('module_disabled', 'Deneme sınavları modülü kapalı.', {
      kind: 'forbidden',
    })
  record(state.mockExams, data.examId)
  if (
    data.fromDate < dayKey(now) ||
    data.toDate < data.fromDate ||
    (Date.parse(data.toDate) - Date.parse(data.fromDate)) / 86400000 > 30
  )
    throw new DomainError(
      'tutoring_date_range_invalid',
      'Etüt tarih aralığı bugün veya sonrasında, en fazla 31 gün olmalıdır.',
    )
  if (data.branchId) active(state.branches, data.branchId)
  if (data.subjectId && !record(state.mockExams, data.examId).subjectIds.includes(data.subjectId))
    throw new DomainError('subject_out_of_scope', 'Ders sınav kapsamında değil.')
  return data
}
export function planTutoring(
  state: State,
  session: Session,
  input: unknown,
  now = new Date().toISOString(),
) {
  const data = planInput(state, session, input, now),
    exam = record(state.mockExams, data.examId)
  const candidates = new Map<string, TutorGroup>(),
    covered: { studentId: string; topic: string; sessionId: string }[] = [],
    sessions: PlannedTutorSession[] = [],
    unresolved: (TutorGroup & { reason: string })[] = []
  const evaluations = currentEvaluations(state, data.examId, session)
  for (const evaluation of evaluations) {
    if (data.subjectId && evaluation.subjectId !== data.subjectId) continue
    const student = record(state.students, evaluation.studentId)
    if (!student.isActive) continue
    const classroom = active(state.classes, student.classId)
    if (classroom.grade !== exam.grade || (data.branchId && classroom.branchId !== data.branchId))
      continue
    if (!state.branches.find((b) => b.id === classroom.branchId)?.isActive) continue
    for (const topic of evaluation.topicScores.filter(
      (t) => t.total > 0 && (t.correct / t.total) * 100 < data.threshold,
    )) {
      const previous = state.tutorSessions.find(
        (s) =>
          s.examId === exam.id &&
          s.subjectId === evaluation.subjectId &&
          s.topic === topic.topic &&
          s.studentIds.includes(student.id) &&
          s.status !== 'İptal',
      )
      if (previous) {
        covered.push({ studentId: student.id, topic: topic.topic, sessionId: previous.id })
        continue
      }
      const signature = JSON.stringify([
        classroom.branchId,
        classroom.grade,
        evaluation.subjectId,
        topic.topic,
      ])
      let group = candidates.get(signature)
      if (!group) {
        group = {
          examId: exam.id,
          branchId: classroom.branchId,
          grade: classroom.grade,
          subjectId: evaluation.subjectId,
          topic: topic.topic,
          studentIds: [],
          scores: [],
        }
        candidates.set(signature, group)
      }
      group.studentIds.push(student.id)
      group.scores.push({ studentId: student.id, percent: topic.percent })
    }
  }
  const groups = [...candidates.values()].sort(
    (a, b) =>
      a.branchId.localeCompare(b.branchId) ||
      a.subjectId.localeCompare(b.subjectId) ||
      a.topic.localeCompare(b.topic, 'tr'),
  )
  for (const group of groups) {
    const teachers = state.teachers.filter(
      (t) =>
        t.isActive &&
        t.branchId === group.branchId &&
        t.subjectId === group.subjectId &&
        (session.role !== 'ogretmen' || t.id === sessionTeacherId(state, session)),
    )
    const rooms = state.classes
      .filter((c) => c.isActive && c.branchId === group.branchId)
      .sort((a, b) => a.capacity - b.capacity || a.id.localeCompare(b.id))
    const slots = state.availability
      .filter(
        (s) =>
          teachers.some((t) => t.id === s.teacherId) &&
          s.duration >= data.duration &&
          Date.parse(s.date) > Date.parse(now) &&
          dayKey(s.date) >= data.fromDate &&
          dayKey(s.date) <= data.toDate,
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.teacherId.localeCompare(b.teacherId))
    if (!teachers.length || !rooms.length || !slots.length) {
      unresolved.push({
        ...group,
        reason: !teachers.length
          ? 'Aktif branş öğretmeni yok.'
          : !rooms.length
            ? 'Aktif derslik yok.'
            : 'Tarih aralığında yeterli sürede öğretmen uygunluk saati yok.',
      })
      continue
    }
    const remaining = [...group.studentIds].sort()
    let lastReason = ''
    while (remaining.length) {
      let selected: PlannedTutorSession | null = null
      for (const slot of slots) {
        for (const room of rooms) {
          const candidate: PlannedTutorSession = {
            ...group,
            teacherId: slot.teacherId,
            date: slot.date,
            duration: data.duration,
            room: room.room,
            roomClassId: room.id,
            capacity: Math.min(data.maxGroupSize, room.capacity),
            studentIds: [],
          }
          lastReason = tutorConflict(state, candidate, sessions)
          if (lastReason) continue
          for (const studentId of remaining) {
            if (candidate.studentIds.length >= candidate.capacity) break
            const withStudent = { ...candidate, studentIds: [...candidate.studentIds, studentId] }
            const reason = tutorConflict(state, withStudent, sessions)
            if (!reason) candidate.studentIds.push(studentId)
            else lastReason = reason
          }
          if (candidate.studentIds.length) {
            selected = candidate
            break
          }
        }
        if (selected) break
      }
      if (!selected) {
        unresolved.push({
          ...group,
          studentIds: [...remaining],
          reason: lastReason || 'Uygun ortak saat bulunamadı.',
        })
        break
      }
      selected.scores = group.scores.filter((s) => selected.studentIds.includes(s.studentId))
      sessions.push(selected)
      for (const id of selected.studentIds) remaining.splice(remaining.indexOf(id), 1)
    }
  }
  return {
    input: data,
    sessions,
    unresolved,
    covered,
    evaluatedStudents: new Set(evaluations.map((e) => e.studentId)).size,
  }
}

export function runAssessment(
  state: State,
  session: Session,
  command: string,
  input: Readonly<Record<string, unknown>>,
  makeId: MakeId,
  recordId = '',
  now = new Date().toISOString(),
) {
  // Komuta göre farklı kayıtlar döner; denetim kaydı yalnız kimliği ve JSON kopyasını kullanır.
  let result: { id?: string } & Record<string, unknown>,
    oldValue: unknown = null,
    collection: string | undefined
  const stamp = <T extends object>(prefix: string, value: T) => ({
    id: makeId(prefix),
    ...value,
    createdAt: now,
    updatedAt: now,
  })
  if (command === 'profile') {
    const data = prepareProfile(state, session, input, recordId)
    const previous = recordId ? record(state.opticalProfiles, recordId) : null
    oldValue = previous ? structuredClone(previous) : null
    const profile = previous
      ? { ...previous, ...data, updatedAt: now }
      : stamp('optical-profile', data)
    result = profile
    state.opticalProfiles = [...state.opticalProfiles.filter((p) => p.id !== profile.id), profile]
    collection = 'opticalProfiles'
  } else if (command === 'evaluate') {
    const preview = previewOptical(state, session, input)
    if (input.expectedPreview && input.expectedPreview !== JSON.stringify(preview))
      throw new DomainError(
        'evaluation_stale',
        'Değerlendirme değişmiş. Sonuçları yeniden önizleyin.',
        { kind: 'conflict' },
      )
    const evaluations = [...state.opticalEvaluations],
      results = [...state.mockResults]
    for (const row of preview) {
      const match = (r: { examId: string; studentId: string; subjectId: string }) =>
        r.examId === row.examId && r.studentId === row.studentId && r.subjectId === row.subjectId
      const evaluationIndex = evaluations.findIndex(match),
        previous = evaluations[evaluationIndex]
      // Önizlemeye özgü alanlar kalıcı değerlendirmeye yazılmaz.
      const data: Omit<OpticalPreviewRow, 'studentName' | 'replaces'> &
        Partial<Pick<OpticalPreviewRow, 'studentName' | 'replaces'>> = { ...row }
      delete data.studentName
      delete data.replaces
      const evaluation = previous
        ? { ...previous, ...data, updatedAt: now }
        : stamp('optical-result', data)
      result = evaluation
      if (evaluationIndex < 0) evaluations.push(evaluation)
      else evaluations[evaluationIndex] = evaluation
      const existingIndex = results.findIndex(match),
        existing = results[existingIndex]
      const aggregate = {
        examId: row.examId,
        studentId: row.studentId,
        subjectId: row.subjectId,
        correct: row.correct,
        wrong: row.wrong,
        blank: row.blank,
        weakTopics: row.weakTopics,
        source: 'optical',
        evaluationId: result.id,
        updatedAt: now,
      }
      const aggregateResult = existing ? { ...existing, ...aggregate } : stamp('result', aggregate)
      if (existingIndex < 0) results.push(aggregateResult)
      else results[existingIndex] = aggregateResult
    }
    state.opticalEvaluations = evaluations
    state.mockResults = results
    result = { count: preview.length, students: new Set(preview.map((r) => r.studentId)).size }
    collection = 'opticalEvaluations'
  } else if (command === 'plan') {
    const plan = planTutoring(state, session, input, now)
    // Yalnız yokluk (undefined/null) denetimi atlar; boş metin verilmiş ama eşleşmeyen plandır.
    const expected = input.expectedPlan
    if (expected !== undefined && expected !== null && expected !== JSON.stringify(plan))
      throw new DomainError(
        'tutoring_plan_stale',
        'Etüt planı değişmiş. Güncel planı yeniden önizleyin.',
        { kind: 'conflict' },
      )
    if (!plan.sessions.length)
      throw new DomainError(
        'tutoring_nothing_to_create',
        'Oluşturulabilecek etüt yok. Eksik kazanımları, mevcut etütleri ve uygunluk saatlerini kontrol edin.',
      )
    const sessions = plan.sessions.map((s) =>
      stamp('tutor', {
        ...s,
        status: 'Planlandı',
        attendance: {},
        threshold: plan.input.threshold,
      }),
    )
    state.tutorSessions.push(...sessions)
    result = {
      sessionIds: sessions.map((s) => s.id),
      count: sessions.length,
      unresolved: plan.unresolved.length,
    }
    collection = 'tutorSessions'
  } else if (command === 'slot') {
    access(state, session, 'tutoring', true)
    const data = automationSchemas.slot.parse(input)
    data.date = new Date(data.date).toISOString()
    const teacher = active(state.teachers, data.teacherId)
    if (session.role === 'ogretmen' && teacher.id !== sessionTeacherId(state, session))
      throw new DomainError(
        'availability_own_only',
        'Yalnızca kendi uygunluk saatinizi ekleyebilirsiniz.',
        { kind: 'forbidden' },
      )
    if (Date.parse(data.date) <= Date.parse(now))
      throw new DomainError('availability_must_be_future', 'Uygunluk saati gelecekte olmalıdır.')
    const reason = tutorConflict(state, {
      ...data,
      branchId: teacher.branchId,
      room: '',
      studentIds: [],
    })
    if (reason) throw new DomainError('tutor_schedule_conflict', reason, { kind: 'conflict' })
    if (
      state.availability.some(
        (s) =>
          s.teacherId === teacher.id &&
          Date.parse(s.date) < Date.parse(data.date) + data.duration * 60000 &&
          Date.parse(data.date) < Date.parse(s.date) + s.duration * 60000,
      )
    )
      throw new DomainError(
        'availability_overlap',
        'Bu saat başka bir uygunluk aralığıyla çakışıyor.',
        { kind: 'conflict' },
      )
    const slot = stamp('slot', data)
    result = slot
    state.availability.push(slot)
    collection = 'availability'
  } else if (command === 'slot-remove') {
    access(state, session, 'tutoring', true)
    const slot = record(state.availability, recordId)
    if (session.role === 'ogretmen' && slot.teacherId !== sessionTeacherId(state, session))
      throw new DomainError(
        'availability_own_only',
        'Yalnızca kendi uygunluk saatinizi kaldırabilirsiniz.',
        { kind: 'forbidden' },
      )
    // Bekleyen talep ya da onaylı randevu saate bağlıdır; saat kalkarsa talep yine onaylanabilir
    // ve randevu dayanaksız kalırdı (DOM-ILT-101). Önce talep reddedilir veya randevu iptal
    // edilir. Saati bilinmeyen eski randevu, aynı öğretmenin bu aralıktaki randevusu sayılır.
    const booked = state.appointments.some(
      (a) =>
        appointmentHoldsTime(a) &&
        (a.slotId === slot.id ||
          (a.slotId === undefined && a.teacherId === slot.teacherId && intervalsOverlap(a, slot))),
    )
    if (booked)
      throw new DomainError(
        'availability_has_appointments',
        'Bu saatte bekleyen veya onaylı randevu var; önce talebi reddedin ya da randevuyu iptal edin.',
        { kind: 'conflict', path: ['slotId'] },
      )
    oldValue = structuredClone(slot)
    result = slot
    state.availability = state.availability.filter((s) => s.id !== recordId)
    collection = 'availability'
  } else if (command === 'cancel' || command === 'attendance') {
    access(state, session, 'tutoring', true)
    const entry = record(state.tutorSessions, recordId)
    if (session.role === 'ogretmen' && entry.teacherId !== sessionTeacherId(state, session))
      throw new DomainError('tutoring_own_only', 'Yalnızca kendi etüdünüzü yönetebilirsiniz.', {
        kind: 'forbidden',
      })
    if (entry.status === 'İptal')
      throw new DomainError('tutoring_already_cancelled', 'Etüt iptal edilmiş.', {
        kind: 'conflict',
      })
    oldValue = structuredClone(entry)
    if (command === 'cancel') {
      const reason = z.string().trim().min(2, 'İptal nedenini girin.').max(500).parse(input.reason)
      if (entry.status === 'Tamamlandı')
        throw new DomainError('tutoring_completed', 'Tamamlanmış etüt iptal edilemez.')
      Object.assign(entry, {
        status: 'İptal',
        cancelReason: reason,
        cancelledAt: now,
        updatedAt: now,
      })
    } else {
      if (Date.parse(entry.date) > Date.parse(now))
        throw new DomainError('tutoring_attendance_future', 'Gelecek etüdün yoklaması alınamaz.')
      const marks = z.record(z.string(), z.enum(['Geldi', 'Gelmedi', 'İzinli'])).parse(input.marks)
      if (
        Object.keys(marks).length !== entry.studentIds.length ||
        entry.studentIds.some((id) => !Object.hasOwn(marks, id))
      )
        throw new DomainError(
          'tutoring_attendance_roster_mismatch',
          'Yoklamada tüm etüt öğrencileri ve yalnızca bu öğrenciler bulunmalıdır.',
        )
      Object.assign(entry, {
        attendance: marks,
        status: 'Tamamlandı',
        attendanceAt: now,
        updatedAt: now,
      })
    }
    result = entry
    collection = 'tutorSessions'
  } else throw new DomainError('unknown_command', 'İşlem bulunamadı.')
  const entry: RecordAuditEntry = {
    id: makeId('audit'),
    actor: session.role,
    user_id:
      session.role === 'ogretmen' ? (sessionTeacherId(state, session) ?? '') : 'demo-yonetici',
    action: command,
    table_name: collection,
    record_id: result.id || recordId || command,
    date: now,
    changed_at: now,
    old_value: toAuditValue(oldValue),
    new_value: toAuditValue(result),
  }
  state.audit.unshift(entry)
  state.audit = state.audit.slice(0, 200)
  return result
}

export function exampleOpticalFile(
  state: State,
  profile: OpticalProfile,
  session: Session = { role: 'yonetici' },
) {
  const exam = record(state.mockExams, profile.examId),
    key = profile.keys[0]
  const students = automationScope(state, session)
    .students.filter(
      (s) => s.isActive && state.classes.find((c) => c.id === s.classId)?.grade === exam.grade,
    )
    .slice(0, 3)
  const rows = students.map((student, i) => {
    if (!key) throw new TypeError('Optik profilinde cevap anahtarı yok.')
    const identity = String(student[profile.identifier === 'number' ? 'number' : 'id'])
    const answers = key.questions
      .map((q, n) => (q.answer === '-' ? '-' : n % 3 === i ? '-' : q.answer === 'A' ? 'B' : 'A'))
      .join('')
    if (profile.format === 'csv') return `${identity};${key.booklet};${answers}`
    const width = Math.max(
        profile.studentStart + profile.studentLength - 1,
        profile.bookletStart + profile.bookletLength - 1,
        profile.answersStart + profile.answersLength - 1,
      ),
      cells = Array(width).fill(' ')
    if (identity.length > profile.studentLength)
      throw new DomainError(
        'optical_student_id_too_long',
        'Örnek öğrenci kimliği alan uzunluğuna sığmıyor.',
      )
    const placements: [number, string][] = [
      [profile.studentStart, identity],
      [profile.bookletStart, key.booklet],
      [profile.answersStart, answers],
    ]
    for (const [start, value] of placements)
      Array.from(value).forEach((c, n) => {
        cells[start - 1 + n] = c
      })
    return cells.join('')
  })
  return (
    profile.format === 'csv'
      ? [responseHeader.join(';'), ...rows]
      : [...Array(profile.headerLines).fill('Örnek optik dosyası'), ...rows]
  ).join('\r\n')
}
