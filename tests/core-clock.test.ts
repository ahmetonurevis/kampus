import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { recordAttendance } from '../packages/school-core/src/lib/domain.ts'
import { dayKey, homeworkStatus } from '../packages/school-core/src/lib/format.ts'
import { saveClass } from '../packages/school-core/src/lib/school-management.ts'
import {
  workflowForm,
  workflowRows,
} from '../packages/school-core/src/lib/workflow-presentation.ts'
import { isDomainError } from './support/domain-error.ts'

// Saate bağlı her kural `now` parametresiyle sabitlenir; hiçbir test gerçek saate bağlı değildir.
const now = '2026-10-06T10:00:00.000Z'
const seed = () => createSeed(new Date(now))
let sequence = 0
const id = (prefix: string) => `${prefix}-clock-test-${++sequence}`
const classMarks = (state: ReturnType<typeof seed>, classId: string) =>
  Object.fromEntries(
    state.students.filter((s) => s.classId === classId && s.isActive).map((s) => [s.id, 'present']),
  )

test('Yoklamanın gelecek tarih sınırı işlem anına (now) göre denetlenir', () => {
  const state = seed()
  const marks = classMarks(state, 'c1')
  const later = '2026-10-09T08:00:00.000Z'
  const snapshot = JSON.stringify(state.attendance)
  assert.throws(
    () => recordAttendance(state, 'c1', later, marks, now),
    isDomainError('attendance_future_date'),
  )
  assert.equal(JSON.stringify(state.attendance), snapshot)
  // Aynı tarih, işlem anı o güne gelince kabul edilir.
  recordAttendance(state, 'c1', later, marks, '2026-10-09T12:00:00.000Z')
  assert.equal(
    state.attendance.filter((a) => a.classId === 'c1' && dayKey(a.date) === '2026-10-09').length,
    Object.keys(marks).length,
  )
})

test('İş akışı formunun varsayılan tarihleri işlem anından türetilir', () => {
  const state = seed()
  const goal = workflowForm(state, { role: 'yonetici' }, 'goal', undefined, {}, now)
  assert.equal(goal.initial.deadline, '2026-11-05')
  const step = workflowForm(state, { role: 'ogrenci' }, 'goal-step', undefined, {}, now)
  assert.equal(step.initial.dueDate, '2026-10-13')
  const meal = workflowForm(state, { role: 'yonetici' }, 'meal', undefined, {}, now)
  assert.equal(meal.initial.date, '2026-10-06')
  const later = '2027-03-01T10:00:00.000Z'
  assert.equal(
    workflowForm(state, { role: 'yonetici' }, 'goal', undefined, {}, later).initial.deadline,
    '2027-03-31',
  )
})

test('Yemek menüsünün "Bugün" etiketi işlem anına göre verilir', () => {
  const state = seed()
  const rows = workflowRows(state, { role: 'yonetici' }, 'yemek-menusu', now)
  const today = rows.filter((r) => r.status === 'Bugün')
  assert.ok(today.every((r) => dayKey(r.date ?? '') === dayKey(now)))
  const first = rows[0]
  assert.ok(first?.date)
  const onFirst = workflowRows(state, { role: 'yonetici' }, 'yemek-menusu', first.date)
  assert.ok(onFirst.filter((r) => r.status === 'Bugün').some((r) => r.id === first.id))
})

test('Sınıf düzenlemesi yalnız işlem anından sonraki dersleri taşır', () => {
  const run = (at: string) => {
    const state = seed()
    const c1 = state.classes.find((c) => c.id === 'c1')
    assert.ok(c1)
    const subjectTeachers = Object.fromEntries(
      state.assignments.filter((a) => a.classId === 'c1').map((a) => [a.subjectId, a.teacherId]),
    )
    const input = { ...c1, section: c1.name.split('-')[1], room: '999' }
    saveClass(state, input, subjectTeachers, id, 'c1', at)
    return state.schedule.filter((l) => l.classId === 'c1' && l.room === '999')
  }
  assert.equal(run('2099-01-01T00:00:00.000Z').length, 0)
  const moved = run(now)
  assert.ok(moved.length > 0)
  assert.ok(moved.every((l) => Date.parse(l.date) > Date.parse(now)))
})

test('Ödev durumu işlem anına göre gecikmiş veya bekliyor olur', () => {
  const homework = { id: 'hw-clock', dueDate: '2026-10-07T20:59:00.000Z' }
  assert.equal(homeworkStatus(homework, [], 's1', now), 'Bekliyor')
  assert.equal(homeworkStatus(homework, [], 's1', '2026-10-08T00:00:00.000Z'), 'Gecikmiş')
})
