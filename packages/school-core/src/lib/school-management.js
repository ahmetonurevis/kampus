import { z } from 'zod'
import { requiredText } from './domain.js'
import { subjectsForGrade, subjectById } from '../data/curriculum.js'
export const branchSchema = z.object({ name: requiredText.max(80), address: requiredText.max(240) })
export const teacherSchema = z.object({
  name: requiredText.max(80),
  email: z.email('Geçerli bir e-posta adresi girin.'),
  phone: z.string().regex(/^0\d{10}$/, 'Telefonu 05XXXXXXXXX biçiminde girin.'),
  subjectId: requiredText,
  branchId: requiredText,
})
export const classSchema = z.object({
  grade: z.coerce.number().int().min(5).max(12),
  section: z
    .string()
    .trim()
    .min(1, 'Şube harfi girin.')
    .max(3)
    .transform((s) => s.toLocaleUpperCase('tr')),
  branchId: requiredText,
  teacherId: requiredText,
  capacity: z.coerce.number().int().min(1).max(40),
  room: requiredText.max(30),
})
const same = (a, b) => a.toLocaleLowerCase('tr') === b.toLocaleLowerCase('tr')
const active = (items, id) => items.find((item) => item.id === id && item.isActive)
export function saveBranch(state, input, makeId, recordId = null) {
  const data = branchSchema.parse(input)
  if (state.branches.some((b) => b.id !== recordId && b.isActive && same(b.name, data.name)))
    throw new Error('Bu isimde aktif bir kampüs zaten var.')
  const existing = recordId ? active(state.branches, recordId) : null
  if (recordId && !existing) throw new Error('Düzenlenecek aktif kampüs bulunamadı.')
  if (existing) Object.assign(existing, data)
  else
    state.branches.push({
      ...data,
      id: makeId('b'),
      color: '#8674c9',
      isActive: true,
      deletedAt: null,
    })
}
export function saveTeacher(state, input, makeId, recordId = null) {
  const data = teacherSchema.parse(input)
  if (!active(state.branches, data.branchId)) throw new Error('Aktif bir kampüs seçin.')
  const subject = subjectById(data.subjectId)
  if (!subject) throw new Error('Geçerli bir branş seçin.')
  if (state.teachers.some((t) => t.id !== recordId && t.isActive && same(t.email, data.email)))
    throw new Error('Bu e-posta adresi başka bir öğretmene ait.')
  const existing = recordId ? active(state.teachers, recordId) : null
  if (recordId && !existing) throw new Error('Düzenlenecek aktif öğretmen bulunamadı.')
  if (
    existing &&
    existing.subjectId !== data.subjectId &&
    state.assignments.some((a) => a.teacherId === recordId && active(state.classes, a.classId))
  )
    throw new Error(
      'Branşı değiştirmeden önce mevcut ders atamalarını başka bir öğretmene devredin.',
    )
  if (existing) Object.assign(existing, data, { subject: subject.name })
  else
    state.teachers.push({
      ...data,
      id: makeId('t'),
      subject: subject.name,
      attendanceRate: 100,
      homeworkRate: 100,
      isActive: true,
      deletedAt: null,
    })
}
export function saveClass(state, input, subjectTeachers, makeId, recordId = null) {
  const data = classSchema.parse(input)
  if (!active(state.branches, data.branchId)) throw new Error('Aktif bir kampüs seçin.')
  if (!active(state.teachers, data.teacherId)) throw new Error('Aktif bir sınıf danışmanı seçin.')
  const name = `${data.grade}-${data.section}`
  if (
    state.classes.some(
      (c) => c.isActive && c.id !== recordId && c.branchId === data.branchId && same(c.name, name),
    )
  )
    throw new Error('Bu kampüste aynı isimde bir sınıf zaten var.')
  if (
    state.classes.some(
      (c) =>
        c.isActive && c.id !== recordId && c.branchId === data.branchId && same(c.room, data.room),
    )
  )
    throw new Error('Bu derslik başka bir aktif sınıfa atanmış.')
  const existing = recordId ? active(state.classes, recordId) : null
  if (recordId && !existing) throw new Error('Düzenlenecek aktif sınıf bulunamadı.')
  const count = state.students.filter((s) => s.isActive && s.classId === recordId).length
  if (count > data.capacity) throw new Error(`Kontenjan mevcut ${count} öğrenciden az olamaz.`)
  if (existing && count && existing.grade !== data.grade)
    throw new Error(
      'Öğrencisi bulunan sınıfın düzeyi değiştirilemez. Uygun düzeyde yeni bir sınıf açın.',
    )
  const assignments = subjectsForGrade(data.grade).map((subject) => {
    const teacher = active(state.teachers, subjectTeachers[subject.id])
    if (!teacher || teacher.subjectId !== subject.id)
      throw new Error(`${subject.name} dersi için uygun branş öğretmeni seçin.`)
    return { id: makeId('assign'), classId: recordId, subjectId: subject.id, teacherId: teacher.id }
  })
  // Gelecek programda yeni öğretmenin başka bir dersiyle çakışmaya izin verilmez.
  const future = state.schedule.filter(
    (l) => l.classId === recordId && +new Date(l.date) > Date.now(),
  )
  for (const lesson of future) {
    const teacher = assignments.find((a) => a.subjectId === lesson.subjectId)?.teacherId
    if (
      [...state.schedule, ...state.appointments.filter((a) => a.status !== 'Reddedildi')].some(
        (other) =>
          other.classId !== recordId && other.teacherId === teacher && overlaps(lesson, other),
      )
    )
      throw new Error('Yeni öğretmenin ders programında çakışma var. Başka bir öğretmen seçin.')
  }
  const classId = existing?.id || makeId('c')
  if (existing) Object.assign(existing, data, { name, level: `${data.grade}. Sınıf` })
  else
    state.classes.push({
      ...data,
      id: classId,
      name,
      level: `${data.grade}. Sınıf`,
      isActive: true,
      deletedAt: null,
    })
  state.assignments = state.assignments.filter((a) => a.classId !== classId)
  state.assignments.push(...assignments.map((a) => ({ ...a, classId })))
  for (const lesson of future) {
    lesson.teacherId =
      assignments.find((a) => a.subjectId === lesson.subjectId)?.teacherId || data.teacherId
    lesson.room = data.room
  }
  for (const question of state.questions.filter(
    (q) =>
      !q.answeredAt && state.students.some((s) => s.id === q.studentId && s.classId === classId),
  ))
    question.teacherId =
      assignments.find((a) => a.subjectId === question.subjectId)?.teacherId || data.teacherId
  for (const homework of state.homework.filter(
    (h) =>
      h.classId === classId &&
      (h.dueDate >= new Date().toISOString() ||
        state.submissions.some((s) => s.homeworkId === h.id && s.score == null)),
  )) {
    homework.teacherId =
      assignments.find((a) => a.subjectId === homework.subjectId)?.teacherId || data.teacherId
  }
  for (const quiz of state.quizzes.filter((q) => q.classId === classId))
    quiz.teacherId =
      assignments.find((a) => a.subjectId === quiz.subjectId)?.teacherId || data.teacherId
  return classId
}
function overlaps(a, b) {
  const startA = +new Date(a.date),
    startB = +new Date(b.date)
  return (
    startA < startB + (b.duration || 30) * 60000 && startB < startA + (a.duration || 30) * 60000
  )
}
export function archiveRecord(
  state,
  kind,
  recordId,
  replacementId = '',
  now = new Date().toISOString(),
) {
  const collection = { branch: 'branches', class: 'classes', teacher: 'teachers' }[kind]
  if (!collection) throw new Error('Kayıt türü geçersiz.')
  const record = active(state[collection], recordId)
  if (!record) throw new Error('Aktif kayıt bulunamadı.')
  if (recordId === replacementId) throw new Error('Farklı bir aktarım hedefi seçin.')
  if (kind === 'branch') {
    const classes = state.classes.filter((c) => c.isActive && c.branchId === recordId)
    const teachers = state.teachers.filter((t) => t.isActive && t.branchId === recordId)
    const prospects = state.prospects.filter(
      (p) => p.branchId === recordId && !p.studentId && p.stage !== 'Vazgeçti',
    )
    if (classes.length || teachers.length || prospects.length) {
      if (!active(state.branches, replacementId))
        throw new Error('Sınıf ve öğretmenlerin aktarılacağı aktif kampüsü seçin.')
      for (const cls of classes)
        if (
          state.classes.some(
            (c) =>
              c.isActive &&
              c.branchId === replacementId &&
              (same(c.name, cls.name) || same(c.room, cls.room)),
          )
        )
          throw new Error(
            'Hedef kampüste aynı sınıf adı veya derslik var. Önce çakışan kayıtları düzenleyin.',
          )
      for (const cls of classes) cls.branchId = replacementId
      for (const teacher of teachers) teacher.branchId = replacementId
      for (const prospect of prospects) prospect.branchId = replacementId
    }
  }
  if (kind === 'class') {
    const students = state.students.filter((s) => s.isActive && s.classId === recordId)
    if (students.length) {
      const destination = active(state.classes, replacementId)
      if (!destination || destination.grade !== record.grade)
        throw new Error('Öğrenciler için aynı düzeyde aktif bir sınıf seçin.')
      if (
        students.length +
          state.students.filter((s) => s.isActive && s.classId === replacementId).length >
        destination.capacity
      )
        throw new Error('Hedef sınıfta tüm öğrenciler için yeterli kontenjan yok.')
      for (const student of students) student.classId = replacementId
      for (const question of state.questions.filter(
        (q) => !q.answeredAt && students.some((s) => s.id === q.studentId),
      ))
        question.teacherId =
          state.assignments.find(
            (a) => a.classId === replacementId && a.subjectId === question.subjectId,
          )?.teacherId || destination.teacherId
    }
    state.schedule = state.schedule.filter((l) => l.classId !== recordId || l.date < now)
  }
  if (kind === 'teacher') {
    const assignments = state.assignments.filter(
      (a) => a.teacherId === recordId && active(state.classes, a.classId),
    )
    const advisers = state.classes.filter((c) => c.isActive && c.teacherId === recordId)
    const pending = state.questions.filter((q) => q.teacherId === recordId && !q.answeredAt)
    const future = state.schedule.filter((l) => l.teacherId === recordId && l.date >= now)
    const appointments = state.appointments.filter(
      (a) => a.teacherId === recordId && a.date >= now && a.status !== 'Reddedildi',
    )
    if (
      assignments.length ||
      advisers.length ||
      pending.length ||
      future.length ||
      appointments.length
    ) {
      const replacement = active(state.teachers, replacementId)
      if (!replacement || replacement.subjectId !== record.subjectId)
        throw new Error('Aynı branştan aktif bir öğretmen seçerek görevleri devredin.')
      const incoming = [...future, ...appointments]
      const existing = [
        ...state.schedule,
        ...state.appointments.filter((a) => a.status !== 'Reddedildi'),
      ].filter((l) => l.teacherId === replacementId && l.date >= now)
      if (incoming.some((a) => existing.some((b) => overlaps(a, b))))
        throw new Error(
          'Seçilen öğretmenin programında çakışma var. Uygun veya yeni bir branş öğretmeni seçin.',
        )
      for (const a of assignments) a.teacherId = replacementId
      for (const c of advisers) c.teacherId = replacementId
      for (const q of pending) q.teacherId = replacementId
      for (const l of future) l.teacherId = replacementId
      for (const a of appointments) a.teacherId = replacementId
      for (const h of state.homework.filter(
        (h) =>
          h.teacherId === recordId &&
          (h.dueDate >= now ||
            state.submissions.some((s) => s.homeworkId === h.id && s.score == null)),
      ))
        h.teacherId = replacementId
    }
    state.availability = state.availability.filter((a) => a.teacherId !== recordId || a.date < now)
  }
  record.isActive = false
  record.deletedAt = now
}
export function restoreRecord(state, kind, recordId) {
  const collection = { branch: 'branches', class: 'classes', teacher: 'teachers' }[kind]
  const record = state[collection]?.find((r) => r.id === recordId)
  if (!record || record.isActive) throw new Error('Arşiv kaydı bulunamadı.')
  if (kind === 'branch' && state.branches.some((b) => b.isActive && same(b.name, record.name)))
    throw new Error('Aynı isimde aktif kampüs var.')
  if (kind !== 'branch' && !active(state.branches, record.branchId))
    throw new Error('Önce bağlı kampüsü arşivden çıkarın.')
  if (kind === 'class') {
    if (
      state.classes.some(
        (c) =>
          c.isActive &&
          c.branchId === record.branchId &&
          (same(c.name, record.name) || same(c.room, record.room)),
      )
    )
      throw new Error('Bu sınıf adı veya derslik başka bir sınıfta kullanılıyor.')
    if (
      !active(state.teachers, record.teacherId) ||
      state.assignments.some((a) => a.classId === recordId && !active(state.teachers, a.teacherId))
    )
      throw new Error('Önce bu sınıfa atanmış öğretmenleri arşivden çıkarın.')
  }
  if (kind === 'teacher' && state.teachers.some((t) => t.isActive && same(t.email, record.email)))
    throw new Error('Bu e-posta adresi başka bir öğretmende kullanılıyor.')
  record.isActive = true
  record.deletedAt = null
}
