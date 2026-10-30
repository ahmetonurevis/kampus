// @ts-nocheck — TODO(ts): tiplenecek (C2)
import { z } from 'zod'
z.config(z.locales.tr())
import { dayKey } from './format.ts'
import { csvObjects } from './delimited-input.ts'
import { tutorConflict } from './tutor-conflicts.ts'

const integer = (min, max) => z.coerce.number().int().min(min).max(max)
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
export const keyHeader = ['booklet', 'question', 'subjectId', 'topic', 'answer']
export const responseHeader = ['student', 'booklet', 'answers']
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

const record = (state, collection, id) => {
  const value = state[collection]?.find((r) => r.id === id)
  if (!value) throw new Error('İlgili kayıt bulunamadı. Listeyi yenileyin.')
  return value
}
const active = (state, collection, id) => {
  const value = record(state, collection, id)
  if (value.isActive === false || value.deletedAt) throw new Error('Pasif kayıt kullanılamaz.')
  return value
}
function access(state, session, module, write = false) {
  if (!state.modules[module]) throw new Error('Bu modül kurum ayarlarından kapalı.')
  if (write && !['yonetici', 'ogretmen'].includes(session.role))
    throw new Error('Bu işlem için yetkiniz bulunmuyor.')
  if (session.role === 'ogretmen') active(state, 'teachers', 't1')
}
export function automationScope(state, session) {
  const teacher = state.teachers.find((t) => t.id === 't1')
  const classIds = new Set(
    state.assignments.filter((a) => a.teacherId === 't1').map((a) => a.classId),
  )
  const permitted = state.students.filter(
    (s) =>
      session.role === 'yonetici' ||
      (session.role === 'ogretmen' && teacher?.isActive && classIds.has(s.classId)) ||
      (session.role === 'ogrenci' && s.id === 's1') ||
      (session.role === 'veli' &&
        s.id === session.childId &&
        state.parents.find((p) => p.id === 'p1')?.studentIds.includes(s.id)),
  )
  return {
    students: permitted.filter((s) => s.isActive),
    studentIds: new Set(permitted.map((s) => s.id)),
    teacher,
    classIds,
  }
}
export function automationExams(state, session) {
  const scope = automationScope(state, session)
  return state.mockExams.filter(
    (exam) =>
      session.role === 'yonetici' ||
      scope.students.some(
        (s) => state.classes.find((c) => c.id === s.classId)?.grade === exam.grade,
      ),
  )
}

export function parseAnswerKey(state, exam, raw) {
  const rows = csvObjects(raw, keyHeader, 3200)
  const keys = new Map()
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
      throw new Error(`Anahtar ${index + 2}. satırda kitapçık veya soru numarası geçersiz.`)
    if (!exam.subjectIds.includes(subjectId) || !state.subjects.some((s) => s.id === subjectId))
      throw new Error(`Anahtar ${index + 2}. satırdaki ders sınav kapsamında değil.`)
    if (!topic || topic.length > 200 || !/^[A-E-]$/.test(answer))
      throw new Error(
        `Anahtar ${index + 2}. satırda kazanım veya cevap geçersiz. Cevap A–E, iptal soru - olmalıdır.`,
      )
    if (!keys.has(booklet)) keys.set(booklet, [])
    const questions = keys.get(booklet)
    if (questions.some((q) => q.number === number))
      throw new Error(`${booklet} kitapçığında ${number}. soru yineleniyor.`)
    questions.push({ number, subjectId, topic, answer })
  }
  if (keys.size > 8) throw new Error('En fazla sekiz kitapçık tanımlayabilirsiniz.')
  const sorted = [...keys]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([booklet, questions]) => ({
      booklet,
      questions: questions.sort((a, b) => a.number - b.number),
    }))
  let expected = ''
  for (const key of sorted) {
    if (key.questions.some((q, i) => q.number !== i + 1))
      throw new Error(
        `${key.booklet} kitapçığı soruları 1'den başlayan kesintisiz sıra içermelidir.`,
      )
    const counts = {}
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
      throw new Error('Her sınav dersi en az bir geçerli soru içermelidir.')
    if (exam.subjectIds.some((id) => key.questions.filter((q) => q.subjectId === id).length > 200))
      throw new Error('Bir derste en fazla 200 soru olabilir.')
    const signature = JSON.stringify(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
    if (expected && signature !== expected)
      throw new Error('Kitapçıkların ders/kazanım soru sayıları ve iptalleri eşit olmalıdır.')
    expected = signature
  }
  return sorted
}
export function prepareProfile(state, session, input, profileId = '') {
  access(state, session, 'optical', true)
  if (session.role !== 'yonetici')
    throw new Error('Cevap anahtarını yalnızca yönetici düzenleyebilir.')
  if (!state.modules.exams) throw new Error('Deneme sınavları modülü kapalı.')
  const data = automationSchemas.profile.parse(input),
    exam = record(state, 'mockExams', data.examId)
  if (state.opticalProfiles.some((p) => p.examId === exam.id && p.id !== profileId))
    throw new Error('Bu sınavın zaten optik profili var. Mevcut profili düzenleyin.')
  const keys = parseAnswerKey(state, exam, data.keyCsv)
  if (data.format === 'fixed') {
    const fields = [
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
      throw new Error('DAT/TXT öğrenci, kitapçık ve cevap alanları çakışmamalıdır.')
    if (keys.some((k) => k.questions.length !== data.answersLength))
      throw new Error('Cevap alanı uzunluğu kitapçığın soru sayısıyla aynı olmalıdır.')
    if (keys.some((k) => k.booklet.length > data.bookletLength))
      throw new Error('Kitapçık alanı kodu içerecek kadar uzun olmalıdır.')
  }
  const existing = profileId ? record(state, 'opticalProfiles', profileId) : null
  if (existing && existing.examId !== exam.id) throw new Error('Profilin sınavı değiştirilemez.')
  return {
    ...data,
    keys,
    revision: existing
      ? existing.revision + (JSON.stringify(existing.keys) !== JSON.stringify(keys) ? 1 : 0)
      : 1,
  }
}
function responseRows(profile, raw) {
  if (profile.format === 'csv')
    return csvObjects(raw, responseHeader).map((row, i) => ({ ...row, line: i + 2 }))
  const lines = raw
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .slice(profile.headerLines)
  while (lines.length && !lines.at(-1).trim()) lines.pop()
  if (!lines.length || lines.length > 1000)
    throw new Error('DAT/TXT 1–1000 öğrenci satırı içermelidir.')
  const width = Math.max(
    profile.studentStart + profile.studentLength - 1,
    profile.bookletStart + profile.bookletLength - 1,
    profile.answersStart + profile.answersLength - 1,
  )
  return lines.map((line, i) => {
    const characters = Array.from(line),
      rowNumber = i + profile.headerLines + 1
    if (characters.length < width)
      throw new Error(`DAT/TXT ${rowNumber}. satır alanları dolduracak kadar uzun değil.`)
    const field = (start, length) => characters.slice(start - 1, start - 1 + length).join('')
    return {
      student: field(profile.studentStart, profile.studentLength),
      booklet: field(profile.bookletStart, profile.bookletLength),
      answers: field(profile.answersStart, profile.answersLength),
      line: rowNumber,
    }
  })
}
function summarize(questions) {
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
export function previewOptical(state, session, input) {
  access(state, session, 'optical', true)
  if (!state.modules.exams) throw new Error('Deneme sınavları modülü kapalı.')
  const data = automationSchemas.evaluate.parse(input),
    profile = record(state, 'opticalProfiles', data.profileId)
  const exam = record(state, 'mockExams', profile.examId),
    scope = automationScope(state, session),
    seen = new Set()
  const output = []
  for (const row of responseRows(profile, data.text)) {
    const identity = row.student.trim(),
      matches = state.students.filter(
        (s) => String(s[profile.identifier === 'number' ? 'number' : 'id']) === identity,
      )
    if (matches.length !== 1)
      throw new Error(
        `${row.line}. satırdaki öğrenci tekil eşleşmedi: ${identity || 'boş kimlik'}.`,
      )
    const student = matches[0]
    if (!student.isActive || !scope.studentIds.has(student.id))
      throw new Error(`${row.line}. satırdaki öğrenci pasif veya yetki kapsamınız dışında.`)
    if (state.classes.find((c) => c.id === student.classId)?.grade !== exam.grade)
      throw new Error(`${row.line}. satırdaki öğrencinin sınıf düzeyi sınavla uyumsuz.`)
    if (seen.has(student.id)) throw new Error(`${row.line}. satırda öğrenci yineleniyor.`)
    seen.add(student.id)
    const booklet = row.booklet.trim().toUpperCase(),
      key = profile.keys.find((k) => k.booklet === booklet)
    if (!key) throw new Error(`${row.line}. satırdaki kitapçık tanımsız: ${booklet || 'boş'}.`)
    const responses = Array.from(row.answers.toUpperCase())
    if (responses.length !== key.questions.length)
      throw new Error(
        `${row.line}. satırda ${key.questions.length} cevap bekleniyor; ${responses.length} karakter var. Boş cevaplar için - kullanabilirsiniz.`,
      )
    if (responses.some((c) => !'ABCDE -._*'.includes(c)))
      throw new Error(
        `${row.line}. satırda geçersiz cevap var. A–E, boş için -/./_/boşluk, çoklu işaret için * kullanın.`,
      )
    for (const subjectId of exam.subjectIds.filter(
      (id) => session.role !== 'ogretmen' || scope.teacher.subjectId === id,
    )) {
      const questionResults = key.questions
        .filter((q) => q.subjectId === subjectId)
        .map((q) => {
          const response = responses[q.number - 1]
          const outcome =
            q.answer === '-'
              ? 'cancelled'
              : response === '*'
                ? 'multiple'
                : ' -._'.includes(response)
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
  if (!output.length) throw new Error('Sınavda branşınıza uygun değerlendirme bulunmuyor.')
  return output
}

export function currentEvaluations(state, examId, session) {
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
export function tutoringSessions(state, session) {
  if (!state.modules.tutoring) return []
  const scope = automationScope(state, session)
  return (state.tutorSessions || [])
    .filter(
      (s) =>
        session.role === 'yonetici' ||
        (session.role === 'ogretmen'
          ? s.teacherId === 't1'
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

export function tutoringCalendarEntries(state, session) {
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
function planInput(state, session, input, now) {
  access(state, session, 'tutoring', true)
  const data = automationSchemas.plan.parse(input)
  if (!state.modules.exams) throw new Error('Deneme sınavları modülü kapalı.')
  record(state, 'mockExams', data.examId)
  if (
    data.fromDate < dayKey(now) ||
    data.toDate < data.fromDate ||
    (Date.parse(data.toDate) - Date.parse(data.fromDate)) / 86400000 > 30
  )
    throw new Error('Etüt tarih aralığı bugün veya sonrasında, en fazla 31 gün olmalıdır.')
  if (data.branchId) active(state, 'branches', data.branchId)
  if (
    data.subjectId &&
    !record(state, 'mockExams', data.examId).subjectIds.includes(data.subjectId)
  )
    throw new Error('Ders sınav kapsamında değil.')
  return data
}
export function planTutoring(state, session, input, now = new Date().toISOString()) {
  const data = planInput(state, session, input, now),
    exam = record(state, 'mockExams', data.examId)
  const candidates = new Map(),
    covered = [],
    sessions = [],
    unresolved = []
  const evaluations = currentEvaluations(state, data.examId, session)
  for (const evaluation of evaluations) {
    if (data.subjectId && evaluation.subjectId !== data.subjectId) continue
    const student = record(state, 'students', evaluation.studentId)
    if (!student.isActive) continue
    const classroom = active(state, 'classes', student.classId)
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
      if (!candidates.has(signature))
        candidates.set(signature, {
          examId: exam.id,
          branchId: classroom.branchId,
          grade: classroom.grade,
          subjectId: evaluation.subjectId,
          topic: topic.topic,
          studentIds: [],
          scores: [],
        })
      const group = candidates.get(signature)
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
        (session.role !== 'ogretmen' || t.id === 't1'),
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
      let selected = null
      for (const slot of slots) {
        for (const room of rooms) {
          const candidate = {
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
  state,
  session,
  command,
  input,
  makeId,
  recordId = '',
  now = new Date().toISOString(),
) {
  let result,
    oldValue = null,
    collection
  const stamp = (prefix, value) => ({
    id: makeId(prefix),
    ...value,
    createdAt: now,
    updatedAt: now,
  })
  if (command === 'profile') {
    const data = prepareProfile(state, session, input, recordId)
    const previous = recordId ? record(state, 'opticalProfiles', recordId) : null
    oldValue = previous ? structuredClone(previous) : null
    result = previous ? { ...previous, ...data, updatedAt: now } : stamp('optical-profile', data)
    state.opticalProfiles = [...state.opticalProfiles.filter((p) => p.id !== result.id), result]
    collection = 'opticalProfiles'
  } else if (command === 'evaluate') {
    const preview = previewOptical(state, session, input)
    if (input.expectedPreview && input.expectedPreview !== JSON.stringify(preview))
      throw new Error('Değerlendirme değişmiş. Sonuçları yeniden önizleyin.')
    const evaluations = [...state.opticalEvaluations],
      results = [...state.mockResults]
    for (const row of preview) {
      const match = (r) =>
        r.examId === row.examId && r.studentId === row.studentId && r.subjectId === row.subjectId
      const evaluationIndex = evaluations.findIndex(match),
        previous = evaluations[evaluationIndex]
      const data = { ...row }
      delete data.studentName
      delete data.replaces
      result = previous ? { ...previous, ...data, updatedAt: now } : stamp('optical-result', data)
      if (evaluationIndex < 0) evaluations.push(result)
      else evaluations[evaluationIndex] = result
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
    if (input.expectedPlan && input.expectedPlan !== JSON.stringify(plan))
      throw new Error('Etüt planı değişmiş. Güncel planı yeniden önizleyin.')
    if (!plan.sessions.length)
      throw new Error(
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
    const teacher = active(state, 'teachers', data.teacherId)
    if (session.role === 'ogretmen' && teacher.id !== 't1')
      throw new Error('Yalnızca kendi uygunluk saatinizi ekleyebilirsiniz.')
    if (Date.parse(data.date) <= Date.parse(now))
      throw new Error('Uygunluk saati gelecekte olmalıdır.')
    const reason = tutorConflict(state, {
      ...data,
      branchId: teacher.branchId,
      room: '',
      studentIds: [],
    })
    if (reason) throw new Error(reason)
    if (
      state.availability.some(
        (s) =>
          s.teacherId === teacher.id &&
          Date.parse(s.date) < Date.parse(data.date) + data.duration * 60000 &&
          Date.parse(data.date) < Date.parse(s.date) + s.duration * 60000,
      )
    )
      throw new Error('Bu saat başka bir uygunluk aralığıyla çakışıyor.')
    result = stamp('slot', data)
    state.availability.push(result)
    collection = 'availability'
  } else if (command === 'slot-remove') {
    access(state, session, 'tutoring', true)
    const slot = record(state, 'availability', recordId)
    if (session.role === 'ogretmen' && slot.teacherId !== 't1')
      throw new Error('Yalnızca kendi uygunluk saatinizi kaldırabilirsiniz.')
    oldValue = structuredClone(slot)
    result = slot
    state.availability = state.availability.filter((s) => s.id !== recordId)
    collection = 'availability'
  } else if (command === 'cancel' || command === 'attendance') {
    access(state, session, 'tutoring', true)
    const entry = record(state, 'tutorSessions', recordId)
    if (session.role === 'ogretmen' && entry.teacherId !== 't1')
      throw new Error('Yalnızca kendi etüdünüzü yönetebilirsiniz.')
    if (entry.status === 'İptal') throw new Error('Etüt iptal edilmiş.')
    oldValue = structuredClone(entry)
    if (command === 'cancel') {
      const reason = z.string().trim().min(2, 'İptal nedenini girin.').max(500).parse(input.reason)
      if (entry.status === 'Tamamlandı') throw new Error('Tamamlanmış etüt iptal edilemez.')
      Object.assign(entry, {
        status: 'İptal',
        cancelReason: reason,
        cancelledAt: now,
        updatedAt: now,
      })
    } else {
      if (Date.parse(entry.date) > Date.parse(now))
        throw new Error('Gelecek etüdün yoklaması alınamaz.')
      const marks = z.record(z.string(), z.enum(['Geldi', 'Gelmedi', 'İzinli'])).parse(input.marks)
      if (
        Object.keys(marks).length !== entry.studentIds.length ||
        entry.studentIds.some((id) => !Object.hasOwn(marks, id))
      )
        throw new Error('Yoklamada tüm etüt öğrencileri ve yalnızca bu öğrenciler bulunmalıdır.')
      Object.assign(entry, {
        attendance: marks,
        status: 'Tamamlandı',
        attendanceAt: now,
        updatedAt: now,
      })
    }
    result = entry
    collection = 'tutorSessions'
  } else throw new Error('İşlem bulunamadı.')
  state.audit.unshift({
    id: makeId('audit'),
    actor: session.role,
    user_id: session.role === 'ogretmen' ? 't1' : 'demo-yonetici',
    action: command,
    table_name: collection,
    record_id: result.id || recordId || command,
    date: now,
    changed_at: now,
    old_value: oldValue,
    new_value: structuredClone(result),
  })
  state.audit = state.audit.slice(0, 200)
  return result
}

export function exampleOpticalFile(state, profile, session = { role: 'yonetici' }) {
  const exam = record(state, 'mockExams', profile.examId),
    key = profile.keys[0]
  const students = automationScope(state, session)
    .students.filter(
      (s) => s.isActive && state.classes.find((c) => c.id === s.classId)?.grade === exam.grade,
    )
    .slice(0, 3)
  const rows = students.map((student, i) => {
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
      throw new Error('Örnek öğrenci kimliği alan uzunluğuna sığmıyor.')
    for (const [start, value] of [
      [profile.studentStart, identity],
      [profile.bookletStart, key.booklet],
      [profile.answersStart, answers],
    ])
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
