import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed } from '../apps/web/src/data/seed.js'
import { subjectsForGrade } from '../apps/web/src/data/curriculum.js'
import {
  saveBranch,
  saveClass,
  saveTeacher,
  archiveRecord,
  restoreRecord,
} from '../apps/web/src/lib/school-management.js'
import { createSnapshotWriter, restoreSnapshot } from '../apps/web/src/lib/demo-persistence.js'
let count = 0
const id = (prefix) => `${prefix}-test-${++count}`
function addTeacher(state) {
  saveTeacher(
    state,
    {
      name: 'Yeni Matematik Öğretmeni',
      phone: '05559990000',
      email: 'matematik@example.com',
      subjectId: 'math',
      branchId: 'b1',
    },
    id,
  )
  return state.teachers.at(-1)
}
test('Özel okul müfredatı: tüm öğrencilerin dersleri, branş atamaları, veli ve geçmişleri tutarlı', () => {
  const s = createSeed()
  assert.equal(s.subjects.length, 16)
  for (const cls of s.classes) {
    const assignments = s.assignments.filter((a) => a.classId === cls.id)
    assert.equal(assignments.length, subjectsForGrade(cls.grade).length)
    for (const a of assignments)
      assert.equal(s.teachers.find((t) => t.id === a.teacherId).subjectId, a.subjectId)
  }
  for (const student of s.students) {
    assert.ok(s.parents.some((p) => p.id === student.parentId && p.studentIds.includes(student.id)))
    assert.ok(
      new Set(s.grades.filter((g) => g.studentId === student.id).map((g) => g.subjectId)).size >=
        10,
    )
  }
  for (const quiz of s.quizzes) {
    assert.ok(quiz.questionIds.length >= 4)
    const grade = s.classes.find((c) => c.id === quiz.classId).grade
    for (const qid of quiz.questionIds) {
      const q = s.bank.find((q) => q.id === qid)
      assert.equal(q.subjectId, quiz.subjectId)
      assert.ok(grade >= q.minGrade && grade <= q.maxGrade)
    }
  }
  const slots = new Set()
  for (const lesson of s.schedule) {
    const key = `${lesson.teacherId}-${lesson.date}`
    assert.ok(!slots.has(key), `Çakışan ders: ${key}`)
    slots.add(key)
    assert.equal(s.teachers.find((t) => t.id === lesson.teacherId).subjectId, lesson.subjectId)
    assert.ok(![0, 6].includes(new Date(lesson.date).getUTCDay()))
  }
})
test('Kampüs ekle/düzenle/arşivle/geri al; ilişkili sınıf ve kadro güvenli aktarılır', () => {
  const s = createSeed()
  saveBranch(s, { name: 'Yeni Kampüs', address: 'Örnek Mahallesi No: 12 İstanbul' }, id)
  const b = s.branches.at(-1)
  saveBranch(s, { name: 'Çamlıca Kampüsü', address: b.address }, id, b.id)
  assert.throws(() => saveBranch(s, { name: b.name, address: b.address }, id), /zaten/)
  archiveRecord(s, 'branch', b.id)
  assert.equal(b.isActive, false)
  restoreRecord(s, 'branch', b.id)
  const snapshot = JSON.stringify(s)
  assert.throws(() => archiveRecord(s, 'branch', 'b1'), /kampüsü seçin/)
  assert.equal(JSON.stringify(s), snapshot)
  archiveRecord(s, 'branch', 'b1', b.id)
  assert.equal(s.classes[0].branchId, b.id)
  assert.equal(s.teachers[0].branchId, b.id)
  assert.equal(s.students.length, 240)
  assert.equal(s.invoices.length, 1920)
})
test('Öğretmen devri tüm aktif işleri aktarır; geçmişi korur, uygun olmayan branşı reddeder', () => {
  const s = createSeed(),
    replacement = addTeacher(s)
  const answered = s.questions.filter((q) => q.teacherId === 't1' && q.answeredAt).map((q) => q.id)
  const oldInvoices = JSON.stringify(s.invoices)
  const snapshot = JSON.stringify(s)
  assert.throws(() => archiveRecord(s, 'teacher', 't1', 't3'), /aynı branştan/i)
  assert.equal(JSON.stringify(s), snapshot)
  archiveRecord(s, 'teacher', 't1', replacement.id)
  assert.equal(s.teachers[0].isActive, false)
  assert.equal(s.assignments.filter((a) => a.teacherId === replacement.id).length, 8)
  assert.ok(s.questions.filter((q) => q.teacherId === 't1').every((q) => q.answeredAt))
  for (const qid of answered) assert.equal(s.questions.find((q) => q.id === qid).teacherId, 't1')
  assert.equal(JSON.stringify(s.invoices), oldInvoices)
  restoreRecord(s, 'teacher', 't1')
  assert.equal(s.teachers[0].isActive, true)
})
test('Sınıf ekleme tüm branşları doğrular; kontenjan küçültme ve hatalı öğretmen kısmi kayıt oluşturmaz', () => {
  const s = createSeed(),
    assignment = Object.fromEntries(
      s.assignments.filter((a) => a.classId === 'c1').map((a) => [a.subjectId, a.teacherId]),
    )
  const data = {
    grade: 7,
    section: 'D',
    branchId: 'b1',
    teacherId: 't1',
    capacity: 24,
    room: '401',
  }
  const snapshot = JSON.stringify(s)
  assert.throws(() => saveClass(s, data, { ...assignment, math: 't3' }, id), /Matematik/)
  assert.equal(JSON.stringify(s), snapshot)
  const classId = saveClass(s, data, assignment, id)
  assert.equal(s.classes.at(-1).name, '7-D')
  assert.equal(s.assignments.filter((a) => a.classId === classId).length, 10)
  assert.throws(
    () => saveClass(s, { ...s.classes[0], capacity: 4 }, assignment, id, 'c1'),
    /mevcut/,
  )
  archiveRecord(s, 'class', 'c1', classId)
  assert.equal(s.students[0].classId, classId)
  assert.equal(s.grades.filter((g) => g.studentId === 's1').length, 43)
  assert.ok(s.attendance.some((a) => a.studentId === 's1' && a.classId === 'c1'))
})
test('Öğretmen devri program çakışmasında atomik biçimde reddedilir', () => {
  const s = createSeed(),
    teacher = addTeacher(s)
  const future = s.schedule.find((l) => l.teacherId === 't1' && +new Date(l.date) > Date.now())
  s.schedule.push({ ...future, id: 'conflict', teacherId: teacher.id, classId: 'c9' })
  const snapshot = JSON.stringify(s)
  assert.throws(() => archiveRecord(s, 'teacher', 't1', teacher.id), /çakışma/)
  assert.equal(JSON.stringify(s), snapshot)
})
test('Değişiklik temelli kalıcılık: not, silinen program, yeni kayıt, sıra ve tercihler kayıpsız döner', () => {
  const initial = createSeed(),
    write = createSnapshotWriter(initial),
    state = structuredClone(initial)
  assert.ok(write(initial).length < 200)
  state.grades[0].score = 91
  state.schedule.splice(0, 1)
  state.questions.unshift({ ...state.questions[0], id: 'new-question', text: 'Yeni soru' })
  state.preferences = { s1: { sms: false } }
  state.videoProgress[0].progress = 75
  state.audit.push({ id: 'audit1', action: 'Güncelleme' })
  const persisted = write(state)
  assert.ok(persisted.length < 100000)
  assert.deepEqual(restoreSnapshot(persisted), state)
  assert.throws(() => restoreSnapshot('{'), /JSON/)
  assert.throws(
    () => restoreSnapshot({ format: 'school-delta-v1', createdAt: 'geçersiz', changes: {} }),
    /geçersiz/,
  )
})
