import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import { authorize, type WriteDecision } from '../packages/school-core/src/lib/authorize.ts'
import {
  archiveRecord,
  createClass,
  saveBranch,
  saveTeacher,
  updateBranch,
  updateClass,
  updateTeacher,
} from '../packages/school-core/src/lib/school-management.ts'
import type { Actor } from '../packages/school-core/src/lib/scope.ts'
import type { Role } from '../packages/school-core/src/modules/navigation.ts'
import { isDomainError } from './support/domain-error.ts'

/**
 * Kampüs, öğretmen ve sınıf kaydı (oluştur + düzenle). Yetki yalnız yöneticidedir (yetki matrisi
 * "Kampüs, sınıf, kadro", DOM-YTK-001); kontenjan, branş ve program çakışmaları işlemdedir.
 */

const now = '2026-10-06T10:00:00.000Z'
const seed = () => createSeed(new Date(now))
let count = 0
const id = (prefix: string) => `${prefix}-save-test-${++count}`
const roles: Role[] = ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli']
const actors: Record<Role, Actor> = {
  yonetici: { role: 'yonetici', links: [] },
  onburo: { role: 'onburo', links: [] },
  ogretmen: { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't1' }] },
  ogrenci: { role: 'ogrenci', links: [{ kind: 'student', recordId: 's1' }] },
  veli: { role: 'veli', links: [{ kind: 'child', recordId: 's1' }] },
}
const code = (decision: WriteDecision) => (decision.allowed ? 'allowed' : decision.code)
/** c1 (7-A) ders atamaları: ders → öğretmen. */
const c1Teachers = (state: State) =>
  Object.fromEntries(
    state.assignments.filter((a) => a.classId === 'c1').map((a) => [a.subjectId, a.teacherId]),
  )
const NEW_CLASS = {
  grade: 7,
  section: 'd',
  branchId: 'b1',
  teacherId: 't1',
  capacity: 24,
  room: '401',
}
const NEW_TEACHER = {
  name: 'Test Matematik Öğretmeni',
  email: 'test-matematik@kampus.example',
  phone: '05559990001',
  subjectId: 'math',
  branchId: 'b1',
}

function unchanged(state: State, run: () => unknown, check: (error: unknown) => boolean) {
  const snapshot = JSON.stringify(state)
  assert.throws(run, check)
  assert.equal(JSON.stringify(state), snapshot)
}

test('DOM-YTK-001: kampüs, öğretmen ve sınıf kaydını yalnız yönetici yapar; ön büro dahil diğer roller reddedilir', () => {
  const state = seed()
  for (const action of ['branch.save', 'teacher.save', 'class.save'] as const)
    for (const role of roles)
      assert.equal(
        code(authorize(actors[role], action, {}, state)),
        role === 'yonetici' ? 'allowed' : 'permission_denied',
        `${action} ${role}`,
      )
  // Çekirdek kayıtlar modüle bağlı değildir: modüller kapalıyken de yönetici kaydeder.
  for (const key of Object.keys(state.modules)) state.modules[key] = false
  assert.equal(code(authorize(actors.yonetici, 'class.save', {}, state)), 'allowed')
  assert.equal(
    code(
      authorize(actors.yonetici, 'branch.save', {}, state, { institutionType: 'language_school' }),
    ),
    'allowed',
  )
})

test('Kampüs oluşturulur ve kısmi gövdeyle düzenlenir; kimlik döner, aynı ad reddedilir', () => {
  const state = seed()
  const branchId = saveBranch(state, { name: 'Test Kampüsü', address: 'Örnek Mah. No: 1' }, id)
  assert.equal(state.branches.at(-1)?.id, branchId)
  assert.equal(updateBranch(state, branchId, { name: 'Test Kampüsü 2' }, id), branchId)
  const branch = state.branches.find((b) => b.id === branchId)
  assert.equal(branch?.name, 'Test Kampüsü 2')
  assert.equal(branch?.address, 'Örnek Mah. No: 1')
  // Aynı içerikle yeniden kaydetmek kayıt eklemez.
  updateBranch(state, branchId, { name: 'Test Kampüsü 2' }, id)
  assert.equal(state.branches.filter((b) => b.name === 'Test Kampüsü 2').length, 1)
  unchanged(
    state,
    () => saveBranch(state, { name: 'test kampüsü 2', address: 'Başka' }, id),
    isDomainError('branch_name_taken', 'conflict'),
  )
  unchanged(
    state,
    () => updateBranch(state, branchId, { name: 'Kadıköy Kampüsü' }, id),
    isDomainError('branch_name_taken', 'conflict'),
  )
  unchanged(
    state,
    () => updateBranch(state, branchId, { name: '' }, id),
    (e) => e instanceof Error,
  )
})

test('Arşivli veya olmayan kayıt düzenlenemez (not_found); kayıt değişmez', () => {
  const state = seed()
  const branchId = saveBranch(state, { name: 'Test Kampüsü', address: 'Adres' }, id)
  archiveRecord(state, 'branch', branchId, '', now)
  unchanged(
    state,
    () => updateBranch(state, branchId, { address: 'Yeni' }, id),
    isDomainError('branch_not_found', 'not_found'),
  )
  unchanged(
    state,
    () => updateTeacher(state, 'yok', { name: 'Ad' }, id, now),
    isDomainError('teacher_not_found', 'not_found'),
  )
  unchanged(
    state,
    () => updateClass(state, 'yok', { room: '999' }, id, now),
    isDomainError('class_not_found', 'not_found'),
  )
})

test('Öğretmen oluşturulur ve düzenlenir; e-posta tekil, branş ataması ve gelecek etüt korunur', () => {
  const state = seed()
  const teacherId = saveTeacher(state, NEW_TEACHER, id, null, now)
  const created = state.teachers.find((t) => t.id === teacherId)
  assert.equal(created?.subject, 'Matematik')
  assert.equal(created?.guidanceCounselor, false)
  updateTeacher(state, teacherId, { phone: '05559990002', guidanceCounselor: true }, id, now)
  assert.equal(created?.phone, '05559990002')
  assert.equal(created?.name, NEW_TEACHER.name)
  // Rehberlik görevi bu yoldan verilmez (DOM-YTK-020).
  assert.equal(created?.guidanceCounselor, false)
  unchanged(
    state,
    () => saveTeacher(state, { ...NEW_TEACHER, email: 'OGRETMEN1@kampus.example' }, id, null, now),
    isDomainError('teacher_email_taken', 'conflict'),
  )
  unchanged(
    state,
    () => updateTeacher(state, 't1', { subjectId: 'turkish' }, id, now),
    isDomainError('teacher_has_assignments'),
  )
  unchanged(
    state,
    () => updateTeacher(state, teacherId, { branchId: 'b-yok' }, id, now),
    isDomainError('campus_required'),
  )
  unchanged(
    state,
    () => updateTeacher(state, teacherId, { subjectId: 'astronomy' }, id, now),
    isDomainError('subject_invalid'),
  )
  state.tutorSessions.push({
    ...state.tutorSessions[0]!,
    id: 'tutor-save-test',
    teacherId,
    status: 'Planlandı',
    date: '2026-10-20T13:00:00.000Z',
  })
  unchanged(
    state,
    () => updateTeacher(state, teacherId, { branchId: 'b2' }, id, now),
    isDomainError('teacher_has_future_tutoring'),
  )
})

test('Sınıf ders atamalarıyla açılır; eksik veya yanlış branş öğretmeni kısmi kayıt bırakmaz', () => {
  const state = seed()
  const teachers = c1Teachers(state)
  unchanged(
    state,
    () =>
      createClass(state, { ...NEW_CLASS, subjectTeachers: { ...teachers, math: 't2' } }, id, now),
    isDomainError('subject_teacher_required'),
  )
  const missing = Object.fromEntries(Object.entries(teachers).filter(([key]) => key !== 'math'))
  unchanged(
    state,
    () => createClass(state, { ...NEW_CLASS, subjectTeachers: missing }, id, now),
    isDomainError('subject_teacher_required'),
  )
  unchanged(
    state,
    () =>
      createClass(state, { ...NEW_CLASS, subjectTeachers: teachers, teacherId: 't-yok' }, id, now),
    isDomainError('advisor_required'),
  )
  unchanged(
    state,
    () => createClass(state, { ...NEW_CLASS, subjectTeachers: teachers, room: '101' }, id, now),
    isDomainError('classroom_in_use', 'conflict'),
  )
  unchanged(
    state,
    () => createClass(state, { ...NEW_CLASS, subjectTeachers: teachers, section: 'A' }, id, now),
    isDomainError('class_name_taken', 'conflict'),
  )
  unchanged(
    state,
    () => createClass(state, { ...NEW_CLASS, subjectTeachers: teachers, capacity: 41 }, id, now),
    (error) => error instanceof Error && error.name === 'ZodError',
  )
  const classId = createClass(state, { ...NEW_CLASS, subjectTeachers: teachers }, id, now)
  const created = state.classes.find((c) => c.id === classId)
  assert.equal(created?.name, '7-D')
  assert.equal(created?.level, '7. Sınıf')
  assert.deepEqual(
    Object.fromEntries(
      state.assignments.filter((a) => a.classId === classId).map((a) => [a.subjectId, a.teacherId]),
    ),
    teachers,
  )
})

test('Sınıf düzenlemesi kısmi gövdeyi birleştirir; aynı dersin ataması kimliğini korur', () => {
  const state = seed()
  const before = state.assignments.filter((a) => a.classId === 'c1').map((a) => a.id)
  const math = state.assignments.find((a) => a.classId === 'c1' && a.subjectId === 'math')!
  const replacement = saveTeacher(state, NEW_TEACHER, id, null, now)
  const quiz = state.quizzes.find((q) => q.classId === 'c1' && q.subjectId === 'math')!
  assert.equal(
    updateClass(state, 'c1', { room: '401', subjectTeachers: { math: replacement } }, id, now),
    'c1',
  )
  const c1 = state.classes.find((c) => c.id === 'c1')
  assert.equal(c1?.room, '401')
  assert.equal(c1?.capacity, 24)
  assert.equal(c1?.name, '7-A')
  assert.deepEqual(
    state.assignments.filter((a) => a.classId === 'c1').map((a) => a.id),
    before,
  )
  assert.equal(math.teacherId, replacement)
  assert.equal(c1Teachers(state).turkish, 't2')
  // Sınıfın quizleri yeni ders öğretmenine geçer.
  assert.equal(quiz.teacherId, replacement)
  // Gelecek dersler yeni derslikte ve yeni öğretmendedir.
  for (const lesson of state.schedule.filter(
    (l) => l.classId === 'c1' && l.subjectId === 'math' && Date.parse(l.date) > Date.parse(now),
  ))
    assert.equal(lesson.teacherId, replacement)
})

test('Kontenjan, düzey ve program çakışması düzenlemeyi atomik biçimde reddeder', () => {
  const state = seed()
  // Kontenjan mevcut öğrenciden az olamaz (c1: 10 öğrenci).
  unchanged(
    state,
    () => updateClass(state, 'c1', { capacity: 9 }, id, now),
    isDomainError('capacity_below_students'),
  )
  unchanged(
    state,
    () => updateClass(state, 'c1', { grade: 8, section: 'Z' }, id, now),
    isDomainError('class_level_locked'),
  )
  unchanged(
    state,
    () => updateClass(state, 'c1', { room: '102' }, id, now),
    isDomainError('classroom_in_use', 'conflict'),
  )
  // Yeni matematik öğretmeninin aynı saatte başka sınıfta dersi var.
  const replacement = saveTeacher(state, NEW_TEACHER, id, null, now)
  const lesson = state.schedule.find(
    (l) =>
      l.classId === 'c1' &&
      l.subjectId === 'math' &&
      !l.cancelledAt &&
      Date.parse(l.date) > Date.parse(now),
  )!
  state.schedule.push({ ...lesson, id: 'lesson-save-test', classId: 'c2', teacherId: replacement })
  unchanged(
    state,
    () => updateClass(state, 'c1', { subjectTeachers: { math: replacement } }, id, now),
    (error) =>
      isDomainError('tutor_schedule_conflict', 'conflict')(error) ||
      isDomainError('teacher_schedule_conflict', 'conflict')(error),
  )
})
