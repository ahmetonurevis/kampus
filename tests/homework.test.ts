import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Participant } from '../packages/school-core/src/lib/communication.ts'
import {
  acceptsLate,
  archiveHomework,
  assignHomework,
  gradeSubmission,
  isHomeworkClosed,
  isLateSubmission,
  submitHomework,
  submitHomeworkSchema,
  updateHomework,
} from '../packages/school-core/src/lib/homework.ts'
import { scopeFor, type ScopeSource } from '../packages/school-core/src/lib/scope.ts'
import { NOTIFICATION_TYPES } from '../packages/school-core/src/modules/notification-types.ts'
import { isDomainError } from './support/domain-error.ts'

// 2026-10-06 salıdır. Deniz (s1) ve Nehir (s25) 7-A (c1); Ece (s2) 5-A (c2). Selin Kaya (t1)
// c1 ve c2'de matematik, Ahmet Yıldırım (t2) Türkçe; Aylin Özer (t17) matematik ama bu sınıflara
// girmez. hw1 c1 matematik (t1, son tarih geçmiş), hw2 c1 Türkçe (t2, açık), hw11 c2 matematik.
const now = '2026-10-06T10:00:00.000Z'
const later = '2026-10-12T10:00:00.000Z'
const seed = () => createSeed(new Date(now))
let sequence = 0
const id = (prefix: string) => `${prefix}-homework-test-${++sequence}`

const person = (
  role: Participant['role'],
  kind: 'student' | 'teacher' | 'child',
  recordId: string,
) => ({ role, links: [{ kind, recordId }], userId: `u-${recordId}` }) satisfies Participant
const student = (recordId = 's1') => person('ogrenci', 'student', recordId)
const teacher = (recordId: string) => person('ogretmen', 'teacher', recordId)
const parent = person('veli', 'child', 's1')
const admin: Participant = { role: 'yonetici', links: [], userId: 'u-admin' }
const front: Participant = { role: 'onburo', links: [], userId: 'u-front' }

const HOMEWORK = {
  classId: 'c1',
  title: 'Denklem çalışma kâğıdı',
  description: 'Kitaptaki 1–10 arası soruları çözün.',
  dueDate: '2026-10-09T23:59:00+03:00',
}
const zodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'

function unchanged(state: State, action: () => unknown, check: (e: unknown) => boolean) {
  const before = JSON.stringify([state.homework, state.submissions])
  assert.throws(action, check)
  assert.equal(JSON.stringify([state.homework, state.submissions]), before)
}

// --- Ödev verme --------------------------------------------------------------------------------

test('DOM-AKD-070: öğretmen tek dersle girdiği sınıfa ödev verir; ders ve öğretmen atamadan, son tarih UTC', () => {
  const state = seed()
  const created = assignHomework(state, teacher('t1'), HOMEWORK, id, now)
  assert.equal(state.homework.at(-1), created)
  assert.equal(created.subjectId, 'math')
  assert.equal(created.teacherId, 't1')
  assert.equal(created.subject, 'Matematik')
  assert.equal(created.dueDate, '2026-10-09T20:59:00.000Z')
  assert.equal(created.allowLate, true)
  assert.deepEqual(created.createdBy, { role: 'ogretmen', userId: 'u-t1' })
})

test('DOM-AKD-070: yönetici dersi seçer, öğretmen sınıfın o dersine atanmış öğretmendir', () => {
  const state = seed()
  const created = assignHomework(
    state,
    admin,
    { ...HOMEWORK, subjectId: 'turkish', allowLate: false },
    id,
    now,
  )
  assert.equal(created.teacherId, 't2')
  assert.equal(created.allowLate, false)
  unchanged(
    state,
    () => assignHomework(state, admin, HOMEWORK, id, now),
    isDomainError('homework_subject_required'),
  )
  unchanged(
    state,
    () => assignHomework(state, admin, { ...HOMEWORK, subjectId: 'physics' }, id, now),
    isDomainError('homework_teacher_unavailable'),
  )
  unchanged(
    state,
    () => assignHomework(state, admin, { ...HOMEWORK, subjectId: 'math', classId: 'yok' }, id, now),
    isDomainError('class_not_found', 'not_found'),
  )
})

test('DOM-AKD-070: başka sınıf ya da branş 403; ön büro, öğrenci ve veli ödev veremez', () => {
  const state = seed()
  unchanged(
    state,
    () => assignHomework(state, teacher('t17'), HOMEWORK, id, now),
    isDomainError('homework_scope_denied', 'forbidden'),
  )
  unchanged(
    state,
    () => assignHomework(state, teacher('t1'), { ...HOMEWORK, subjectId: 'turkish' }, id, now),
    isDomainError('homework_scope_denied', 'forbidden'),
  )
  for (const actor of [front, student(), parent])
    unchanged(
      state,
      () => assignHomework(state, actor, { ...HOMEWORK, subjectId: 'math' }, id, now),
      isDomainError('permission_denied', 'forbidden'),
    )
})

test('DOM-AKD-070: geçmiş son tarih, pasif sınıf ve geçersiz gövde reddedilir; kayıt değişmez', () => {
  const state = seed()
  unchanged(
    state,
    () => assignHomework(state, teacher('t1'), { ...HOMEWORK, dueDate: now }, id, now),
    isDomainError('homework_due_in_past'),
  )
  unchanged(
    state,
    () => assignHomework(state, teacher('t1'), { ...HOMEWORK, dueDate: '2026-10-09' }, id, now),
    zodError,
  )
  unchanged(
    state,
    () => assignHomework(state, teacher('t1'), { ...HOMEWORK, institutionId: 'x' }, id, now),
    zodError,
  )
  const classroom = state.classes.find((c) => c.id === 'c1')
  assert.ok(classroom)
  Object.assign(classroom, { isActive: false })
  unchanged(
    state,
    () => assignHomework(state, teacher('t1'), HOMEWORK, id, now),
    isDomainError('record_inactive'),
  )
})

test('DOM-AKD-070: modül kapalıyken ödev verilemez', () => {
  const state = seed()
  state.modules.learning = false
  unchanged(
    state,
    () => assignHomework(state, teacher('t1'), HOMEWORK, id, now),
    isDomainError('module_disabled', 'forbidden'),
  )
})

// --- Düzenleme ve arşiv ---------------------------------------------------------------------

test('DOM-AKD-071: ödevin öğretmeni ve yönetici düzenler; aynı sınıfın başka öğretmeni 403, görmeyen 404', () => {
  const state = seed()
  const updated = updateHomework(
    state,
    teacher('t2'),
    'hw2',
    { title: 'Yeni başlık', dueDate: '2026-10-20T12:00:00Z', allowLate: false },
    now,
  )
  assert.equal(updated.title, 'Yeni başlık')
  assert.equal(updated.dueDate, '2026-10-20T12:00:00.000Z')
  assert.equal(updated.allowLate, false)
  assert.equal(updated.updatedAt, now)
  updateHomework(state, admin, 'hw2', { description: 'Yönetici düzeltmesi.' }, now)
  unchanged(
    state,
    () => updateHomework(state, teacher('t1'), 'hw2', { title: 'Başka' }, now),
    isDomainError('homework_not_owner', 'forbidden'),
  )
  unchanged(
    state,
    () => updateHomework(state, teacher('t17'), 'hw2', { title: 'Başka' }, now),
    isDomainError('homework_not_found', 'not_found'),
  )
  unchanged(
    state,
    () => updateHomework(state, admin, 'yok', { title: 'Başka' }, now),
    isDomainError('homework_not_found', 'not_found'),
  )
  unchanged(
    state,
    () => updateHomework(state, admin, 'hw2', { dueDate: '2026-10-01T10:00:00Z' }, now),
    isDomainError('homework_due_in_past'),
  )
  unchanged(state, () => updateHomework(state, admin, 'hw2', { classId: 'c2' }, now), zodError)
  unchanged(state, () => updateHomework(state, admin, 'hw2', {}, now), zodError)
})

test('DOM-AKD-071: teslimsiz ödev arşivlenir; teslim almış ödev 409 ile korunur', () => {
  const state = seed()
  const created = assignHomework(state, teacher('t1'), HOMEWORK, id, now)
  unchanged(
    state,
    () => archiveHomework(state, teacher('t2'), created.id),
    isDomainError('homework_not_owner', 'forbidden'),
  )
  archiveHomework(state, teacher('t1'), created.id)
  assert.ok(!state.homework.some((h) => h.id === created.id))
  unchanged(
    state,
    () => archiveHomework(state, teacher('t2'), 'hw2'),
    isDomainError('homework_has_submissions', 'conflict'),
  )
})

// --- Teslim -------------------------------------------------------------------------------------

test('DOM-AKD-072: öğrenci kendi sınıfının ödevini metin ve dosyayla teslim eder; yeniden teslim aynı kaydı günceller', () => {
  const state = seed()
  const hw = assignHomework(state, teacher('t1'), HOMEWORK, id, now)
  const first = submitHomework(
    state,
    student(),
    hw.id,
    { note: 'Çözümlerim ekte.', fileIds: ['f1'] },
    id,
    now,
    {
      fileNames: new Map([['f1', 'cozum.pdf']]),
    },
  )
  assert.equal(first.created, true)
  assert.deepEqual(first.attach, ['f1'])
  assert.equal(first.submission.fileName, 'cozum.pdf')
  assert.equal(first.submission.late, false)
  assert.equal(first.submission.score, null)
  const again = submitHomework(state, student(), hw.id, { fileIds: ['f1', 'f2'] }, id, later)
  assert.equal(again.created, false)
  assert.equal(again.submission.id, first.submission.id)
  assert.deepEqual(again.attach, ['f2'])
  assert.deepEqual(again.detach, [])
  assert.equal(again.submission.note, '')
  // Son tarih (9 Ekim) geçtikten sonra yeniden teslim geç işaretlenir.
  assert.equal(again.submission.late, true)
  assert.equal(state.submissions.filter((s) => s.homeworkId === hw.id).length, 1)
})

test('DOM-AKD-072: yeniden teslimde düşen dosya detach, geri eklenen dosya yeniden attach listesindedir', () => {
  const state = seed()
  const hw = assignHomework(state, teacher('t1'), HOMEWORK, id, now)
  submitHomework(state, student(), hw.id, { fileIds: ['f1', 'f2'] }, id, now)
  const dropped = submitHomework(state, student(), hw.id, { note: 'Yalnız metin.' }, id, now)
  assert.deepEqual(dropped.attach, [])
  assert.deepEqual(dropped.detach, ['f1', 'f2'])
  assert.deepEqual(dropped.submission.fileIds, [])
  const readded = submitHomework(state, student(), hw.id, { fileIds: ['f2'] }, id, now)
  assert.deepEqual(readded.attach, ['f2'])
  assert.deepEqual(readded.detach, [])
})

test('DOM-AKD-072: geç teslim ödev açıksa kabul edilir ve işaretlenir, kapalıysa 422', () => {
  const state = seed()
  // hw1 (c1 matematik) son tarihi 4 Ekim'di; Deniz teslim etmemişti.
  const late = submitHomework(state, student(), 'hw1', { note: 'Geç kaldım.' }, id, now)
  assert.equal(late.submission.late, true)
  assert.equal(isLateSubmission(late.submission, { dueDate: '2026-10-04T09:00:00.000Z' }), true)
  const hw = assignHomework(state, teacher('t1'), { ...HOMEWORK, allowLate: false }, id, now)
  unchanged(
    state,
    () => submitHomework(state, student('s25'), hw.id, { note: 'Geç.' }, id, later),
    isDomainError('homework_closed'),
  )
  assert.equal(acceptsLate({}), true)
  assert.equal(isHomeworkClosed(hw, later), true)
  assert.equal(isHomeworkClosed(hw, now), false)
})

test('DOM-AKD-072: başka sınıfın ödevi 404, puanlanmış teslim 409, boş teslim ve pasif öğrenci reddedilir', () => {
  const state = seed()
  unchanged(
    state,
    () => submitHomework(state, student(), 'hw11', { note: 'x' }, id, now),
    isDomainError('homework_not_found', 'not_found'),
  )
  unchanged(
    state,
    () => submitHomework(state, student(), 'yok', { note: 'x' }, id, now),
    isDomainError('homework_not_found', 'not_found'),
  )
  // sub-s1-hw3 puanlanmış.
  unchanged(
    state,
    () => submitHomework(state, student(), 'hw3', { note: 'Yeniden.' }, id, now),
    isDomainError('submission_graded', 'conflict'),
  )
  unchanged(state, () => submitHomework(state, student(), 'hw2', {}, id, now), zodError)
  assert.equal(submitHomeworkSchema.safeParse({ fileIds: ['a', 'a'] }).success, false)
  for (const actor of [parent, teacher('t2'), admin])
    unchanged(
      state,
      () => submitHomework(state, actor, 'hw2', { note: 'x' }, id, now),
      isDomainError('permission_denied', 'forbidden'),
    )
  const deniz = state.students.find((s) => s.id === 's1')
  assert.ok(deniz)
  Object.assign(deniz, { isActive: false })
  unchanged(
    state,
    () => submitHomework(state, student(), 'hw4', { note: 'x' }, id, now),
    isDomainError('student_inactive'),
  )
})

// --- Değerlendirme ------------------------------------------------------------------------------

test('DOM-AKD-073: ödevin öğretmeni puan ve geri bildirim yazar; yeniden değerlendirir', () => {
  const state = seed()
  const graded = gradeSubmission(
    state,
    teacher('t2'),
    'hw2',
    'sub-s1-hw2',
    { score: 85, feedback: 'Güzel çalışma.' },
    now,
  )
  assert.equal(graded.score, 85)
  assert.equal(graded.feedback, 'Güzel çalışma.')
  assert.equal(graded.gradedAt, now)
  assert.deepEqual(graded.gradedBy, { role: 'ogretmen', userId: 'u-t2' })
  gradeSubmission(
    state,
    teacher('t2'),
    'hw2',
    'sub-s1-hw2',
    { score: 0, feedback: 'Düzelt.' },
    later,
  )
  assert.equal(graded.score, 0)
  assert.equal(graded.gradedAt, later)
})

test('DOM-AKD-073: başka öğretmen 403/404, yanlış ödevin teslimi 404, geçersiz puan reddedilir', () => {
  const state = seed()
  const grade = { score: 80, feedback: 'İyi.' }
  unchanged(
    state,
    () => gradeSubmission(state, teacher('t1'), 'hw2', 'sub-s1-hw2', grade, now),
    isDomainError('homework_not_owner', 'forbidden'),
  )
  unchanged(
    state,
    () => gradeSubmission(state, teacher('t17'), 'hw2', 'sub-s1-hw2', grade, now),
    isDomainError('homework_not_found', 'not_found'),
  )
  unchanged(
    state,
    () => gradeSubmission(state, teacher('t2'), 'hw2', 'sub-s1-hw3', grade, now),
    isDomainError('submission_not_found', 'not_found'),
  )
  for (const score of [-1, 101, 85.5])
    unchanged(
      state,
      () => gradeSubmission(state, teacher('t2'), 'hw2', 'sub-s1-hw2', { ...grade, score }, now),
      zodError,
    )
  for (const actor of [admin, student(), parent, front])
    unchanged(
      state,
      () => gradeSubmission(state, actor, 'hw2', 'sub-s1-hw2', grade, now),
      isDomainError('permission_denied', 'forbidden'),
    )
})

test('DOM-AKD-073, DOM-ILT-023: değerlendirme bildirimi yalnız ödev kimliği taşır, öğrenci ve veliye gider', () => {
  const spec = NOTIFICATION_TYPES.homework_graded
  assert.equal(spec.module, 'learning')
  assert.deepEqual(spec.audiences, { minor: ['student', 'parent'], adult: ['student'] })
  assert.equal(spec.data.safeParse({ homeworkId: 'hw1', score: 80 }).success, false)
  assert.equal(spec.subjectId(spec.data.parse({ homeworkId: 'hw1' })), 'hw1')
})

// --- Görünürlük ---------------------------------------------------------------------------------

test('DOM-AKD-074: teslimi ödevin öğretmeni ve sınıfın rehber öğretmeni okur; aynı sınıfa başka dersle giren öğretmen okumaz', () => {
  const state = seed()
  const visible = (source: State, by: Participant) =>
    scopeFor(source, by)
      .read('submissions', source.submissions)
      .map((row) => row.id)
  // sub-s1-hw2: Deniz'in (c1) Türkçe ödevi (t2). Selin Kaya (t1) c1'in rehber öğretmenidir; İngilizce
  // öğretmeni (t11) c1'e girer ama ödevin öğretmeni ve rehber değildir.
  assert.ok(visible(state, teacher('t2')).includes('sub-s1-hw2'))
  assert.ok(visible(state, teacher('t1')).includes('sub-s1-hw2'))
  assert.ok(!visible(state, teacher('t11')).includes('sub-s1-hw2'))
  assert.ok(visible(state, teacher('t11')).includes('sub-s1-hw5'), 'kendi ödevinin teslimi')
  assert.ok(visible(state, admin).includes('sub-s1-hw2'))
  assert.deepEqual(
    visible(state, student()).filter((id) => !id.startsWith('sub-s1-') && id !== 'sub-deniz'),
    [],
  )
  // Sınıftan ayrılan (atama sona eren) öğretmen kendi ödevinin teslimini görmeye devam eder.
  const left = {
    ...state,
    assignments: state.assignments.filter((a) => a.id !== 'assign-c1-turkish'),
  }
  assert.ok(visible(left, teacher('t2')).includes('sub-s1-hw2'))
  // Kaynakta ödev yoksa (API yüklemediyse) öğretmen yalnız rehberi olduğu sınıfı görür.
  const { students, teachers, classes, assignments, clubs, mockExams, modules } = state
  const withoutHomework: ScopeSource = {
    students,
    teachers,
    classes,
    assignments,
    clubs,
    mockExams,
    modules,
  }
  const rows = scopeFor(withoutHomework, teacher('t2')).read('submissions', state.submissions)
  assert.ok(!rows.some((row) => row.id === 'sub-s1-hw2'))
})
