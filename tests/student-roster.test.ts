import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed } from '../packages/school-core/src/data/seed.ts'
import {
  resolveRecipients,
  type Participant,
} from '../packages/school-core/src/lib/communication.ts'
import { recordAttendance } from '../packages/school-core/src/lib/domain.ts'
import {
  ENROLLMENT_STATUS_EFFECTS,
  enrollmentStatus,
} from '../packages/school-core/src/lib/enrollment-status.ts'
import { createPermissionForm } from '../packages/school-core/src/lib/permission-forms.ts'
import { runWorkflow } from '../packages/school-core/src/lib/school-workflows.ts'
import {
  studentsWithEffect,
  type RosterEffect,
} from '../packages/school-core/src/lib/student-roster.ts'
import { withdrawStudent } from '../packages/school-core/src/lib/withdrawals.ts'
import { isDomainError } from './support/domain-error.ts'

const NOW = '2026-10-06T10:00:00.000Z'
const EFFECTS: RosterEffect[] = ['roster', 'attendance', 'academicNotices']
let serial = 0
const makeId = (prefix: string) => `${prefix}-roster-test-${String(++serial)}`
const ADMIN = { role: 'yonetici', childId: 's1' } as const
const admin: Participant = { role: 'yonetici', links: [], userId: 'u-admin' }
const FORM = {
  topic: 'trip',
  title: 'Gezi',
  description: 'Müze gezisi',
  deadline: '2026-10-09',
}

/** Deniz (s1) ayrılır; 12. sınıftan bir öğrenci mezun olur (örnek veri üzerinde gerçek işlemler). */
function seedWithLeavers() {
  const state = createSeed(new Date(NOW))
  const graduate = state.students.find(
    (item) => state.classes.find((c) => c.id === item.classId)?.grade === 12,
  )!
  const planned = runWorkflow(
    state,
    ADMIN,
    'renewal',
    {
      studentId: graduate.id,
      targetClassId: '',
      year: 2027,
      mode: 'graduate',
      total: 28500,
      scholarship: 0,
      discount: 0,
      count: 7,
      startDate: '2027-01-31',
    },
    makeId,
    undefined,
    NOW,
  ) as unknown as { id: string }
  runWorkflow(state, ADMIN, 'renewal-activate', {}, makeId, planned.id, NOW)
  withdrawStudent(
    state,
    's1',
    {
      withdrawalDate: '2026-10-01',
      termStartDate: '2026-09-07',
      attendedUnits: 18,
      totalUnits: 180,
      reason: 'relocation',
    },
    makeId,
    { institutionType: 'school', allocated: new Map(), creditCents: 0, now: NOW },
  )
  return { state, graduate }
}

test('DOM-KAY-026: etki bayraklarıyla süzülen küme eski isActive okumasıyla aynı öğrencilerdir', () => {
  const { state } = seedWithLeavers()
  const legacy = state.students.filter((s) => s.isActive !== false).map((s) => s.id)
  assert.ok(legacy.length > 0 && legacy.length < state.students.length)
  for (const effect of EFFECTS)
    assert.deepEqual(
      studentsWithEffect(state.students, state, effect).map((s) => s.id),
      legacy,
      effect,
    )
})

test('DOM-KAY-026: ayrılan ve mezun öğrenci sınıf listesi, yoklama ve akademik bildirim dışındadır', () => {
  const { state, graduate } = seedWithLeavers()
  assert.equal(
    enrollmentStatus(
      state.students.find((s) => s.id === 's1')!,
      state,
    ),
    'withdrawn',
  )
  assert.equal(enrollmentStatus(graduate, state), 'graduated')
  for (const status of ['withdrawn', 'graduated'] as const)
    for (const effect of EFFECTS) assert.equal(ENROLLMENT_STATUS_EFFECTS[status][effect], false)
  for (const effect of EFFECTS) {
    const ids = studentsWithEffect(state.students, state, effect).map((s) => s.id)
    assert.ok(!ids.includes('s1') && !ids.includes(graduate.id), effect)
  }
})

test('DOM-KAY-026: yoklama yalnız etkin öğrencileri yazar; ayrılan ve mezun yazılmaz', () => {
  const { state, graduate } = seedWithLeavers()
  const date = '2026-10-06T09:00:00.000Z'
  for (const classId of new Set(['c1', graduate.classId])) {
    const active = state.students.filter((s) => s.classId === classId && s.isActive)
    recordAttendance(
      state,
      classId,
      date,
      Object.fromEntries(active.map((s) => [s.id, 'present'])),
      NOW,
    )
  }
  const marked = new Set(
    state.attendance.filter((a) => a.date.startsWith('2026-10-06')).map((a) => a.studentId),
  )
  assert.ok(marked.size > 0)
  assert.ok(!marked.has('s1') && !marked.has(graduate.id))
  // Ayrılan öğrencinin işareti istenmez: eksik kalan tek etkin öğrenci yine hata verir.
  assert.throws(
    () => recordAttendance(state, 'c1', date, {}, NOW),
    isDomainError('attendance_incomplete'),
  )
})

test('DOM-KAY-026, DOM-ILT-001: duyuru alıcılarında ayrılan ve mezun öğrenci ile velisi yoktur', () => {
  const { state, graduate } = seedWithLeavers()
  const classIds = ['c1', graduate.classId]
  const recipients = resolveRecipients(state, {
    branchIds: [],
    grades: [],
    levels: [],
    classIds,
    roles: ['ogrenci', 'veli'],
  })
  const legacy = state.students
    .filter((s) => s.isActive && classIds.includes(s.classId))
    .map((s) => s.id)
  for (const list of [recipients.studentIds, recipients.parentStudentIds]) {
    assert.ok(list.length > 0)
    assert.ok(!list.includes('s1') && !list.includes(graduate.id))
    assert.deepEqual(list, legacy)
  }
})

test('DOM-KAY-026, DOM-ILT-036: izin formu hedefi ayrılan öğrenciyi içermez, tek seçimi reddeder', () => {
  const { state } = seedWithLeavers()
  const form = createPermissionForm(state, admin, { ...FORM, classIds: ['c1'] }, makeId, NOW)
  assert.ok(form.studentIds.length > 0 && !form.studentIds.includes('s1'))
  assert.throws(
    () => createPermissionForm(state, admin, { ...FORM, studentIds: ['s1'] }, makeId, NOW),
    isDomainError('student_inactive'),
  )
})
