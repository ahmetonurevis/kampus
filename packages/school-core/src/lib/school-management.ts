import { z } from 'zod'
import { subjectsForGrade, subjectById } from '../data/curriculum.ts'
import type { State } from '../data/seed.ts'
import { requiredText, type MakeId } from './domain.ts'
import { appointmentHoldsTime } from './appointment-status.ts'
import { tutorConflict, type Interval } from './tutor-conflicts.ts'
import { DomainError } from './errors.ts'
import { studentsWithEffect } from './student-roster.ts'
import { isOpenQuestion } from './questions.ts'
import { assertDutiesFitBranch, type CoordinatorDutyRow } from './coordinator-duties.ts'

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
/** Ders → branş öğretmeni seçimi (sınıfın düzeyindeki her ders için bir öğretmen). */
export const subjectTeachersSchema = z.record(z.string().trim().min(1).max(40), requiredText)
/** Sınıf kaydı + ders atamaları: API gövdesi ve form şeması (`saveClass` iki parçayı ayrı alır). */
export const classInputSchema = classSchema.extend({ subjectTeachers: subjectTeachersSchema })
/**
 * Düzenleme gövdeleri: gönderilmeyen alan kaydın güncel değeriyle doldurulur, sonra kayıt
 * şemasıyla bütün olarak doğrulanır (`updateBranch`, `updateTeacher`, `updateClass`).
 */
export const branchPatchSchema = branchSchema.partial()
export const teacherPatchSchema = teacherSchema.partial()
export const classPatchSchema = classInputSchema.partial()
export type ArchiveKind = 'branch' | 'class' | 'teacher'
// Ders ve randevular aynı listede denetlenir; randevunun sınıfı ve dersliği yoktur.
type Booked = Interval & { teacherId: string; classId?: string; room?: string }
const same = (a: string, b: string) => a.toLocaleLowerCase('tr') === b.toLocaleLowerCase('tr')
const active = <T extends { id: string; isActive: boolean }>(
  items: readonly T[],
  id: string | null | undefined,
) => items.find((item) => item.id === id && item.isActive)
export function saveBranch(
  state: State,
  input: unknown,
  makeId: MakeId,
  recordId: string | null = null,
) {
  const data = branchSchema.parse(input)
  if (state.branches.some((b) => b.id !== recordId && b.isActive && same(b.name, data.name)))
    throw new DomainError('branch_name_taken', 'Bu isimde aktif bir kampüs zaten var.', {
      kind: 'conflict',
    })
  const existing = recordId ? active(state.branches, recordId) : null
  if (recordId && !existing)
    throw new DomainError('branch_not_found', 'Düzenlenecek aktif kampüs bulunamadı.', {
      kind: 'not_found',
    })
  if (existing) {
    Object.assign(existing, data)
    return existing.id
  }
  const id = makeId('b')
  state.branches.push({ ...data, id, color: '#8674c9', isActive: true, deletedAt: null })
  return id
}
/**
 * Öğretmen kaydı dışında tutulan koordinatör görevleri State'te değildir (DOM-YTK-027): API
 * öğretmenin etkin görevlerini yükleyip verir; demo kalıcılığında görev olmadığından verilmez.
 */
export type TeacherSaveOptions = {
  coordinatorDuties?: readonly Pick<CoordinatorDutyRow, 'kind' | 'scopeId'>[]
}
export function saveTeacher(
  state: State,
  input: unknown,
  makeId: MakeId,
  recordId: string | null = null,
  now = new Date().toISOString(),
  options: TeacherSaveOptions = {},
) {
  const data = teacherSchema.parse(input)
  if (!active(state.branches, data.branchId))
    throw new DomainError('campus_required', 'Aktif bir kampüs seçin.')
  const subject = subjectById(data.subjectId)
  if (!subject) throw new DomainError('subject_invalid', 'Geçerli bir branş seçin.')
  if (state.teachers.some((t) => t.id !== recordId && t.isActive && same(t.email, data.email)))
    throw new DomainError('teacher_email_taken', 'Bu e-posta adresi başka bir öğretmene ait.', {
      kind: 'conflict',
    })
  const existing = recordId ? active(state.teachers, recordId) : null
  if (recordId && !existing)
    throw new DomainError('teacher_not_found', 'Düzenlenecek aktif öğretmen bulunamadı.', {
      kind: 'not_found',
    })
  if (existing && existing.subjectId !== data.subjectId)
    assertDutiesFitBranch(options.coordinatorDuties ?? [], data.subjectId)
  if (
    existing &&
    (existing.branchId !== data.branchId || existing.subjectId !== data.subjectId) &&
    (state.tutorSessions || []).some(
      (session) =>
        session.teacherId === recordId &&
        session.status === 'Planlandı' &&
        Date.parse(session.date) > Date.parse(now),
    )
  )
    throw new DomainError(
      'teacher_has_future_tutoring',
      'Öğretmenin ileri tarihli etütlerini iptal ettikten sonra kampüs veya branşını değiştirin.',
    )
  if (
    existing &&
    existing.subjectId !== data.subjectId &&
    state.assignments.some((a) => a.teacherId === recordId && active(state.classes, a.classId))
  )
    throw new DomainError(
      'teacher_has_assignments',
      'Branşı değiştirmeden önce mevcut ders atamalarını başka bir öğretmene devredin.',
    )
  if (existing) {
    Object.assign(existing, data, { subject: subject.name })
    return existing.id
  }
  const id = makeId('t')
  state.teachers.push({
    ...data,
    id,
    subject: subject.name,
    attendanceRate: 100,
    homeworkRate: 100,
    isActive: true,
    deletedAt: null,
    // Rehberlik görevi öğretmen formundan verilmez; yeni öğretmen görevsiz başlar.
    guidanceCounselor: false,
  })
  return id
}
export function saveClass(
  state: State,
  input: unknown,
  subjectTeachers: Readonly<Record<string, string>>,
  makeId: MakeId,
  recordId: string | null = null,
  now = new Date().toISOString(),
  inherited: ReadonlySet<string> = new Set(),
) {
  const data = classSchema.parse(input)
  if (!active(state.branches, data.branchId))
    throw new DomainError('campus_required', 'Aktif bir kampüs seçin.')
  if (!active(state.teachers, data.teacherId))
    throw new DomainError('advisor_required', 'Aktif bir sınıf danışmanı seçin.')
  const name = `${data.grade}-${data.section}`
  if (
    state.classes.some(
      (c) => c.isActive && c.id !== recordId && c.branchId === data.branchId && same(c.name, name),
    )
  )
    throw new DomainError('class_name_taken', 'Bu kampüste aynı isimde bir sınıf zaten var.', {
      kind: 'conflict',
    })
  if (
    state.classes.some(
      (c) =>
        c.isActive && c.id !== recordId && c.branchId === data.branchId && same(c.room, data.room),
    )
  )
    throw new DomainError('classroom_in_use', 'Bu derslik başka bir aktif sınıfa atanmış.', {
      kind: 'conflict',
    })
  const existing = recordId ? active(state.classes, recordId) : null
  if (recordId && !existing)
    throw new DomainError('class_not_found', 'Düzenlenecek aktif sınıf bulunamadı.', {
      kind: 'not_found',
    })
  const count = studentsWithEffect(
    state.students.filter((s) => s.classId === recordId),
    state,
    'roster',
  ).length
  if (count > data.capacity)
    throw new DomainError(
      'capacity_below_students',
      `Kontenjan mevcut ${count} öğrenciden az olamaz.`,
    )
  if (existing && count && existing.grade !== data.grade)
    throw new DomainError(
      'class_level_locked',
      'Öğrencisi bulunan sınıfın düzeyi değiştirilemez. Uygun düzeyde yeni bir sınıf açın.',
    )
  const assignments = subjectsForGrade(data.grade).map((subject) => {
    const teacher = active(state.teachers, subjectTeachers[subject.id])
    if (!teacher || teacher.subjectId !== subject.id)
      throw new DomainError(
        'subject_teacher_required',
        // Düzenlemede gönderilmeyen dersin mevcut öğretmeni pasifleşmiş olabilir; kullanıcıya
        // göndermediği dersi suçlayan genel mesaj yerine durum açık söylenir.
        inherited.has(subject.id)
          ? `${subject.name} dersinin mevcut öğretmeni artık aktif değil; önce o dersin öğretmenini değiştirin.`
          : `${subject.name} dersi için uygun branş öğretmeni seçin.`,
        { path: ['subjectTeachers', subject.id] },
      )
    return { subjectId: subject.id, teacherId: teacher.id }
  })
  // Gelecek programda yeni öğretmenin başka bir dersiyle çakışmaya izin verilmez.
  const future = state.schedule.filter(
    (l) => !l.cancelledAt && l.classId === recordId && +new Date(l.date) > Date.parse(now),
  )
  if (
    existing &&
    (state.tutorSessions || []).some(
      (s) =>
        s.status === 'Planlandı' &&
        Date.parse(s.date) > Date.parse(now) &&
        ((s.roomClassId === recordId &&
          (data.room !== existing.room ||
            data.branchId !== existing.branchId ||
            data.capacity < s.studentIds.length)) ||
          (data.branchId !== existing.branchId &&
            s.studentIds.some(
              (id) => state.students.find((student) => student.id === id)?.classId === recordId,
            ))),
    )
  )
    throw new DomainError(
      'classroom_has_future_tutoring',
      'Bu derslikte gelecek etüt var. Önce etüdü iptal edin veya derslik değişikliğini erteleyin.',
    )
  for (const lesson of future) {
    const teacher = assignments.find((a) => a.subjectId === lesson.subjectId)?.teacherId
    const reason = tutorConflict(
      {
        ...state,
        schedule: state.schedule.filter((l) => l.classId !== recordId),
        appointments: [],
        schoolEvents: [],
      },
      {
        ...lesson,
        teacherId: teacher,
        room: data.room,
        branchId: data.branchId,
        studentIds: studentsWithEffect(
          state.students.filter((s) => s.classId === recordId),
          state,
          'roster',
        ).map((s) => s.id),
      },
    )
    if (reason) throw new DomainError('tutor_schedule_conflict', reason, { kind: 'conflict' })
    const busy: Booked[] = [
      ...state.schedule.filter((l) => !l.cancelledAt),
      ...state.appointments.filter(appointmentHoldsTime),
    ]
    if (
      busy.some(
        (other) =>
          other.classId !== recordId && other.teacherId === teacher && overlaps(lesson, other),
      )
    )
      throw new DomainError(
        'teacher_schedule_conflict',
        'Yeni öğretmenin ders programında çakışma var. Başka bir öğretmen seçin.',
        { kind: 'conflict' },
      )
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
  // Aynı dersin ataması yerinde güncellenir (kimlik ve sürüm korunur); düzeyde olmayan dersin
  // ataması kalkar, yeni ders sona eklenir.
  const previous = new Map(
    state.assignments.filter((a) => a.classId === classId).map((a) => [a.subjectId, a]),
  )
  const subjects = new Set(assignments.map((a) => a.subjectId))
  state.assignments = state.assignments.filter(
    (a) => a.classId !== classId || (subjects.has(a.subjectId) && previous.get(a.subjectId) === a),
  )
  for (const assignment of assignments) {
    const kept = previous.get(assignment.subjectId)
    if (kept) kept.teacherId = assignment.teacherId
    else state.assignments.push({ id: makeId('assign'), classId, ...assignment })
  }
  for (const lesson of future) {
    lesson.teacherId =
      assignments.find((a) => a.subjectId === lesson.subjectId)?.teacherId || data.teacherId
    lesson.room = data.room
  }
  // Yalnız yanıt bekleyen sorular taşınır; geri çekilmiş soru eski öğretmende kalır (DOM-ILT-092).
  // TODO(soru-ortak-ders): ders atamaları tek öğretmenli varsayılır (`subjectTeachers` ders başına
  // bir öğretmen); ortak derste soru ilk eşleşen atamaya taşınır, öğrencinin seçtiği öğretmen
  // korunmaz. Ortak ders kuralı netleşince taşıma sorunun öğretmeni hâlâ atanmışsa ona dokunmamalı.
  for (const question of state.questions.filter(
    (q) =>
      isOpenQuestion(q) &&
      state.students.some((s) => s.id === q.studentId && s.classId === classId),
  ))
    question.teacherId =
      assignments.find((a) => a.subjectId === question.subjectId)?.teacherId || data.teacherId
  for (const homework of state.homework.filter(
    (h) =>
      h.classId === classId &&
      (h.dueDate >= now || state.submissions.some((s) => s.homeworkId === h.id && s.score == null)),
  )) {
    homework.teacherId =
      assignments.find((a) => a.subjectId === homework.subjectId)?.teacherId || data.teacherId
  }
  // Quizin tarihi yoktur; çözülmemiş (hiç deneme kaydı olmayan) quiz açıktır. Çözülmüş quiz
  // notları üreten öğretmende kalır (ödevle aynı kural).
  const attempted = new Set(state.quizAttempts.map((a) => a.quizId))
  for (const quiz of state.quizzes.filter((q) => q.classId === classId && !attempted.has(q.id)))
    quiz.teacherId =
      assignments.find((a) => a.subjectId === quiz.subjectId)?.teacherId || data.teacherId
  for (const task of (state.studyTasks || []).filter(
    (t) =>
      t.status !== 'Tamamlandı' &&
      state.students.some((s) => s.id === t.studentId && s.classId === classId),
  ))
    task.teacherId =
      assignments.find((a) => a.subjectId === task.subjectId)?.teacherId || data.teacherId
  return classId
}
/** Sınıf ve ders atamalarını tek gövdeden açar (`classInputSchema`); yeni sınıfın kimliğini döndürür. */
export function createClass(
  state: State,
  input: unknown,
  makeId: MakeId,
  now = new Date().toISOString(),
) {
  const { subjectTeachers, ...data } = classInputSchema.parse(input)
  return saveClass(state, data, subjectTeachers, makeId, null, now)
}

/** Aktif kaydı düzenlenecek kayıt olarak bulur; yoksa `not_found` (arşivli kayıt düzenlenmez). */
function editable<T extends { id: string; isActive: boolean }>(
  items: readonly T[],
  recordId: string,
  code: string,
  message: string,
): T {
  const record = active(items, recordId)
  if (!record) throw new DomainError(code, message, { kind: 'not_found' })
  return record
}

/** Kampüsü kısmi gövdeyle düzenler: gönderilmeyen alan güncel değerinde kalır. */
export function updateBranch(state: State, recordId: string, input: unknown, makeId: MakeId) {
  const patch = branchPatchSchema.parse(input)
  const { name, address } = editable(
    state.branches,
    recordId,
    'branch_not_found',
    'Düzenlenecek aktif kampüs bulunamadı.',
  )
  return saveBranch(state, { name, address, ...patch }, makeId, recordId)
}

/** Öğretmeni kısmi gövdeyle düzenler; rehberlik görevi bu yoldan değişmez. */
export function updateTeacher(
  state: State,
  recordId: string,
  input: unknown,
  makeId: MakeId,
  now = new Date().toISOString(),
  options: TeacherSaveOptions = {},
) {
  const patch = teacherPatchSchema.parse(input)
  const { name, email, phone, subjectId, branchId } = editable(
    state.teachers,
    recordId,
    'teacher_not_found',
    'Düzenlenecek aktif öğretmen bulunamadı.',
  )
  return saveTeacher(
    state,
    { name, email, phone, subjectId, branchId, ...patch },
    makeId,
    recordId,
    now,
    options,
  )
}

/**
 * Sınıfı kısmi gövdeyle düzenler. `subjectTeachers` ders bazında birleşir: gönderilmeyen dersin
 * öğretmeni mevcut atamadan gelir.
 */
export function updateClass(
  state: State,
  recordId: string,
  input: unknown,
  makeId: MakeId,
  now = new Date().toISOString(),
) {
  const { subjectTeachers, ...patch } = classPatchSchema.parse(input)
  const { grade, section, branchId, teacherId, capacity, room } = editable(
    state.classes,
    recordId,
    'class_not_found',
    'Düzenlenecek aktif sınıf bulunamadı.',
  )
  const current = Object.fromEntries(
    state.assignments.filter((a) => a.classId === recordId).map((a) => [a.subjectId, a.teacherId]),
  )
  const inherited = new Set(
    Object.keys(current).filter((subjectId) => !(subjectId in (subjectTeachers ?? {}))),
  )
  return saveClass(
    state,
    { grade, section, branchId, teacherId, capacity, room, ...patch },
    { ...current, ...subjectTeachers },
    makeId,
    recordId,
    now,
    inherited,
  )
}

function overlaps(a: Interval, b: Interval) {
  const startA = +new Date(a.date),
    startB = +new Date(b.date)
  return (
    startA < startB + (b.duration || 30) * 60000 && startB < startA + (a.duration || 30) * 60000
  )
}
export function archiveRecord(
  state: State,
  kind: ArchiveKind,
  recordId: string,
  replacementId = '',
  now = new Date().toISOString(),
) {
  const collection = { branch: 'branches', class: 'classes', teacher: 'teachers' }[kind]
  if (!collection) throw new DomainError('record_type_invalid', 'Kayıt türü geçersiz.')
  // Tür başına ayrı değişken, aşağıdaki türe özgü alanların tipini korur; yalnız biri doludur.
  const classRecord = kind === 'class' ? active(state.classes, recordId) : undefined
  const teacherRecord = kind === 'teacher' ? active(state.teachers, recordId) : undefined
  const record =
    kind === 'branch' ? active(state.branches, recordId) : (classRecord ?? teacherRecord)
  if (!record)
    throw new DomainError('record_not_found', 'Aktif kayıt bulunamadı.', { kind: 'not_found' })
  if (recordId === replacementId)
    throw new DomainError('transfer_target_invalid', 'Farklı bir aktarım hedefi seçin.')
  if (
    (state.tutorSessions || []).some(
      (s) =>
        s.status === 'Planlandı' &&
        Date.parse(s.date) >= Date.parse(now) &&
        (kind === 'teacher'
          ? s.teacherId === recordId
          : kind === 'branch'
            ? s.branchId === recordId
            : s.roomClassId === recordId ||
              s.studentIds.some(
                (id) => state.students.find((student) => student.id === id)?.classId === recordId,
              )),
    )
  )
    throw new DomainError(
      'record_has_future_tutoring',
      'Bu kayıtla ilişkili gelecek etüt var. Önce Otomatik Etüt ekranından etüdü iptal edin.',
    )
  if (kind === 'branch') {
    const classes = state.classes.filter((c) => c.isActive && c.branchId === recordId)
    const teachers = state.teachers.filter((t) => t.isActive && t.branchId === recordId)
    const prospects = state.prospects.filter(
      (p) => p.branchId === recordId && !p.studentId && p.stage !== 'Vazgeçti',
    )
    const related = [
      ...(state.clubs || []).filter((c) => c.status === 'Aktif'),
      ...(state.transportRoutes || []).filter((r) => r.status === 'Aktif'),
      ...(state.schoolEvents || []).filter((e) => e.status === 'Planlandı' && e.date >= now),
      ...(state.mealMenus || []).filter((m) => m.date >= now),
    ].filter((r) => r.branchId === recordId)
    if (classes.length || teachers.length || prospects.length || related.length) {
      if (!active(state.branches, replacementId))
        throw new DomainError(
          'transfer_campus_required',
          'Sınıf ve öğretmenlerin aktarılacağı aktif kampüsü seçin.',
        )
      for (const cls of classes)
        if (
          state.classes.some(
            (c) =>
              c.isActive &&
              c.branchId === replacementId &&
              (same(c.name, cls.name) || same(c.room, cls.room)),
          )
        )
          throw new DomainError(
            'transfer_name_or_room_conflict',
            'Hedef kampüste aynı sınıf adı veya derslik var. Önce çakışan kayıtları düzenleyin.',
            { kind: 'conflict' },
          )
      if (
        (state.mealMenus || []).some(
          (m) =>
            m.branchId === recordId &&
            m.date >= now &&
            state.mealMenus.some(
              (other) =>
                other.branchId === replacementId && other.date.slice(0, 10) === m.date.slice(0, 10),
            ),
        )
      )
        throw new DomainError(
          'transfer_menu_conflict',
          'Hedef kampüste aynı gün için yemek menüsü var. Önce menüleri düzenleyin.',
          { kind: 'conflict' },
        )
      for (const cls of classes) cls.branchId = replacementId
      for (const teacher of teachers) teacher.branchId = replacementId
      for (const prospect of prospects) prospect.branchId = replacementId
      for (const relatedRecord of related) relatedRecord.branchId = replacementId
    }
  }
  if (kind === 'class' && classRecord) {
    const students = studentsWithEffect(
      state.students.filter((s) => s.classId === recordId),
      state,
      'roster',
    )
    const renewals = (state.renewals || []).filter(
      (r) => r.status === 'Planlandı' && r.targetClassId === recordId,
    )
    if (students.length || renewals.length) {
      const destination = active(state.classes, replacementId)
      if (!destination || destination.grade !== classRecord.grade)
        throw new DomainError(
          'transfer_class_required',
          'Öğrenciler için aynı düzeyde aktif bir sınıf seçin.',
        )
      if (
        students.length +
          studentsWithEffect(
            state.students.filter((s) => s.classId === replacementId),
            state,
            'roster',
          ).length >
        destination.capacity
      )
        throw new DomainError(
          'transfer_capacity_insufficient',
          'Hedef sınıfta tüm öğrenciler için yeterli kontenjan yok.',
        )
      for (const student of students) {
        student.classId = replacementId
        for (const task of (state.studyTasks || []).filter(
          (t) => t.studentId === student.id && t.status !== 'Tamamlandı',
        ))
          task.teacherId =
            state.assignments.find(
              (a) => a.classId === replacementId && a.subjectId === task.subjectId,
            )?.teacherId || destination.teacherId
        for (const guidance of (state.guidanceCases || []).filter(
          (g) => g.studentId === student.id && g.status !== 'Tamamlandı',
        )) {
          const subjectId = state.teachers.find((t) => t.id === guidance.teacherId)?.subjectId
          guidance.teacherId =
            state.assignments.find((a) => a.classId === replacementId && a.subjectId === subjectId)
              ?.teacherId || destination.teacherId
        }
        for (const renewal of (state.renewals || []).filter(
          (r) =>
            r.studentId === student.id && r.status === 'Planlandı' && r.fromClassId === recordId,
        ))
          renewal.fromClassId = replacementId
      }
      for (const renewal of renewals) {
        renewal.targetClassId = replacementId
        const contract = state.contracts.find((c) => c.id === renewal.contractId)
        if (contract) contract.classId = replacementId
      }
      if (destination.branchId !== classRecord.branchId) {
        const moved = new Set(students.map((s) => s.id))
        state.transportAssignments = (state.transportAssignments || []).filter(
          (a) => !moved.has(a.studentId),
        )
        for (const member of (state.clubMemberships || []).filter(
          (m) => moved.has(m.studentId) && m.status === 'Aktif',
        ))
          member.status = 'Ayrıldı'
      }
      for (const question of state.questions.filter(
        (q) => isOpenQuestion(q) && students.some((s) => s.id === q.studentId),
      ))
        question.teacherId =
          state.assignments.find(
            (a) => a.classId === replacementId && a.subjectId === question.subjectId,
          )?.teacherId || destination.teacherId
    }
    state.schedule = state.schedule.filter(
      (l) => l.cancelledAt || l.classId !== recordId || l.date < now,
    )
  }
  if (kind === 'teacher' && teacherRecord) {
    const assignments = state.assignments.filter(
      (a) => a.teacherId === recordId && active(state.classes, a.classId),
    )
    const advisers = state.classes.filter((c) => c.isActive && c.teacherId === recordId)
    const pending = state.questions.filter((q) => q.teacherId === recordId && isOpenQuestion(q))
    const future = state.schedule.filter(
      (l) => !l.cancelledAt && l.teacherId === recordId && l.date >= now,
    )
    const appointments = state.appointments.filter(
      (a) => a.teacherId === recordId && a.date >= now && appointmentHoldsTime(a),
    )
    const workflowRecords = [
      ...(state.guidanceCases || []).filter((g) => g.status !== 'Tamamlandı'),
      ...(state.studyTasks || []).filter((t) => t.status !== 'Tamamlandı'),
      ...(state.clubs || []).filter((c) => c.status === 'Aktif'),
    ].filter((r) => r.teacherId === recordId)
    if (
      assignments.length ||
      advisers.length ||
      pending.length ||
      future.length ||
      appointments.length ||
      workflowRecords.length
    ) {
      const replacement = active(state.teachers, replacementId)
      if (!replacement || replacement.subjectId !== teacherRecord.subjectId)
        throw new DomainError(
          'replacement_teacher_required',
          'Aynı branştan aktif bir öğretmen seçerek görevleri devredin.',
        )
      if (
        (state.clubs || []).some(
          (c) =>
            c.teacherId === recordId && c.status === 'Aktif' && c.branchId !== replacement.branchId,
        )
      )
        throw new DomainError(
          'club_teacher_campus_required',
          'Aktif kulüp sorumluluğu için aynı kampüsten öğretmen seçin.',
        )
      const incoming: Booked[] = [...future, ...appointments]
      const existing = [
        ...state.schedule.filter((l) => !l.cancelledAt),
        ...state.appointments.filter(appointmentHoldsTime),
      ].filter((l) => l.teacherId === replacementId && l.date >= now)
      if (incoming.some((a) => existing.some((b) => overlaps(a, b))))
        throw new DomainError(
          'replacement_schedule_conflict',
          'Seçilen öğretmenin programında çakışma var. Uygun veya yeni bir branş öğretmeni seçin.',
          { kind: 'conflict' },
        )
      for (const interval of incoming) {
        const classroom = state.classes.find((c) => c.id === interval.classId)
        const reason = tutorConflict(
          { ...state, schedule: [], appointments: [], schoolEvents: [] },
          {
            ...interval,
            teacherId: replacementId,
            branchId: classroom?.branchId,
            room: interval.room || '',
            studentIds: [],
          },
        )
        if (reason) throw new DomainError('tutor_schedule_conflict', reason, { kind: 'conflict' })
      }
      for (const a of assignments) a.teacherId = replacementId
      for (const c of advisers) c.teacherId = replacementId
      for (const q of pending) q.teacherId = replacementId
      for (const l of future) l.teacherId = replacementId
      for (const a of appointments) a.teacherId = replacementId
      for (const workflowRecord of workflowRecords) workflowRecord.teacherId = replacementId
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
export function restoreRecord(state: State, kind: ArchiveKind, recordId: string) {
  const classRecord = kind === 'class' ? state.classes.find((r) => r.id === recordId) : undefined
  const teacherRecord =
    kind === 'teacher' ? state.teachers.find((r) => r.id === recordId) : undefined
  const member = classRecord ?? teacherRecord
  const record = kind === 'branch' ? state.branches.find((r) => r.id === recordId) : member
  if (!record || record.isActive)
    throw new DomainError('archive_not_found', 'Arşiv kaydı bulunamadı.', { kind: 'not_found' })
  if (kind === 'branch' && state.branches.some((b) => b.isActive && same(b.name, record.name)))
    throw new DomainError('branch_name_taken', 'Aynı isimde aktif kampüs var.', {
      kind: 'conflict',
    })
  if (kind !== 'branch' && !active(state.branches, member?.branchId))
    throw new DomainError('parent_campus_archived', 'Önce bağlı kampüsü arşivden çıkarın.')
  if (kind === 'class' && classRecord) {
    if (
      state.classes.some(
        (c) =>
          c.isActive &&
          c.branchId === classRecord.branchId &&
          (same(c.name, classRecord.name) || same(c.room, classRecord.room)),
      )
    )
      throw new DomainError(
        'class_name_or_room_conflict',
        'Bu sınıf adı veya derslik başka bir sınıfta kullanılıyor.',
        { kind: 'conflict' },
      )
    if (
      !active(state.teachers, classRecord.teacherId) ||
      state.assignments.some((a) => a.classId === recordId && !active(state.teachers, a.teacherId))
    )
      throw new DomainError(
        'class_teachers_archived',
        'Önce bu sınıfa atanmış öğretmenleri arşivden çıkarın.',
      )
  }
  if (
    kind === 'teacher' &&
    teacherRecord &&
    state.teachers.some((t) => t.isActive && same(t.email, teacherRecord.email))
  )
    throw new DomainError(
      'teacher_email_taken',
      'Bu e-posta adresi başka bir öğretmende kullanılıyor.',
      { kind: 'conflict' },
    )
  record.isActive = true
  record.deletedAt = null
}
