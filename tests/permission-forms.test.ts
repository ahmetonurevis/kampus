import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Participant } from '../packages/school-core/src/lib/communication.ts'
import {
  archivePermissionForm,
  closePermissionForm,
  createPermissionForm,
  decidePermission,
  isPermissionFormOpen,
  permissionCounts,
  permissionDeadlineEndsAt,
  permissionReminders,
  permissionStatus,
  updatePermissionForm,
  type PermissionDecisionRecord,
} from '../packages/school-core/src/lib/permission-forms.ts'
import { scopeFor, type ScopeSource } from '../packages/school-core/src/lib/scope.ts'
import { NOTIFICATION_TYPES } from '../packages/school-core/src/modules/notification-types.ts'
import { isDomainError } from './support/domain-error.ts'

// 2026-10-06 salıdır. Deniz (s1) ve Nehir (s25) 7-A (c1); Ece (s2) 5-A (c2); Ayşe Yılmaz (p1)
// Deniz ile Ece'nin velisidir. Selin Kaya (t1) c1–c4'ün rehber öğretmeni; Ahmet Yıldırım (t2) c1'e
// Türkçe dersine girer ama rehberi değildir; t5 c5–c8'in rehberidir.
const now = '2026-10-06T10:00:00.000Z'
const seed = () => createSeed(new Date(now))
let sequence = 0
const id = (prefix: string) => `${prefix}-permission-test-${++sequence}`

const person = (
  role: Participant['role'],
  kind: 'student' | 'teacher' | 'child',
  recordIds: string[],
  userId: string,
) =>
  ({ role, links: recordIds.map((recordId) => ({ kind, recordId })), userId }) satisfies Participant
const teacher = (recordId: string) => person('ogretmen', 'teacher', [recordId], `u-${recordId}`)
const mother = person('veli', 'child', ['s1', 's2'], 'u-p1')
const father = person('veli', 'child', ['s1'], 'u-p1b')
const studentOf = (recordId: string) => person('ogrenci', 'student', [recordId], `u-${recordId}`)
const admin: Participant = { role: 'yonetici', links: [], userId: 'u-admin' }
const front: Participant = { role: 'onburo', links: [], userId: 'u-front' }

const FORM = {
  topic: 'trip',
  title: 'Müze gezisi',
  description: 'Cuma günü İstanbul Arkeoloji Müzesi gezisi.',
  deadline: '2026-10-09',
  classIds: ['c1'],
}
const zodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'
const snapshot = (state: State) =>
  JSON.stringify([state.permissionForms, state.permissionDecisions])

function unchanged(state: State, action: () => unknown, check: (e: unknown) => boolean) {
  const before = snapshot(state)
  assert.throws(action, check)
  assert.equal(snapshot(state), before)
}

const open = (state: State, by: Participant = teacher('t1'), input: object = FORM) =>
  createPermissionForm(state, by, input, id, now)

// --- Form açma ---------------------------------------------------------------------------------

test('DOM-ILT-036: rehber öğretmen sınıfına form açar; hedef öğrenciler açılışta çözülür', () => {
  const state = seed()
  const form = open(state)
  assert.equal(state.permissionForms.at(-1), form)
  assert.equal(form.teacherId, 't1')
  assert.equal(form.status, 'open')
  assert.deepEqual(form.classIds, ['c1'])
  const classOne = state.students.filter((s) => s.classId === 'c1').map((s) => s.id)
  assert.deepEqual(form.studentIds, classOne)
  assert.deepEqual(form.createdBy, { role: 'ogretmen', userId: 'u-t1' })
})

test('DOM-ILT-036: tek tek seçilen öğrenci sınıfınkiyle birleşir, yönetici formu öğretmensiz', () => {
  const state = seed()
  const form = open(state, admin, { ...FORM, classIds: ['c1'], studentIds: ['s1', 's2'] })
  assert.equal(form.teacherId, null)
  assert.equal(form.studentIds.filter((s) => s === 's1').length, 1)
  assert.ok(form.studentIds.includes('s2'))
  assert.deepEqual(form.targetStudentIds, ['s1', 's2'])
})

test('DOM-ILT-036: rehberi olmadığı sınıfa öğretmen form açamaz; ön büro, veli ve öğrenci açamaz', () => {
  const state = seed()
  unchanged(
    state,
    () => open(state, teacher('t2')),
    isDomainError('permission_form_scope_denied', 'forbidden'),
  )
  unchanged(
    state,
    () => open(state, teacher('t1'), { ...FORM, classIds: [], studentIds: ['s1', 'missing'] }),
    isDomainError('permission_form_scope_denied', 'forbidden'),
  )
  for (const by of [front, mother, studentOf('s1')])
    unchanged(state, () => open(state, by), isDomainError('permission_denied', 'forbidden'))
})

test('DOM-ILT-036: geçmiş son gün, hedefsiz form, olmayan sınıf ve pasif öğrenci reddedilir', () => {
  const state = seed()
  unchanged(
    state,
    () => open(state, admin, { ...FORM, deadline: '2026-10-05' }),
    isDomainError('permission_form_deadline_in_past'),
  )
  unchanged(state, () => open(state, admin, { ...FORM, classIds: [] }), zodError)
  unchanged(state, () => open(state, admin, { ...FORM, topic: 'party' }), zodError)
  unchanged(
    state,
    () => open(state, admin, { ...FORM, classIds: ['missing'] }),
    isDomainError('class_not_found', 'not_found'),
  )
  const s1 = state.students.find((s) => s.id === 's1')
  assert.ok(s1)
  s1.isActive = false
  unchanged(
    state,
    () => open(state, admin, { ...FORM, classIds: [], studentIds: ['s1'] }),
    isDomainError('student_inactive'),
  )
  // Bugün son gün olabilir: o günün sonuna kadar karar alınır.
  assert.equal(open(state, admin, { ...FORM, deadline: '2026-10-06' }).deadline, '2026-10-06')
})

test('DOM-YTK-040: iletişim modülü kapalıyken form açılmaz', () => {
  const state = seed()
  state.modules.communication = false
  unchanged(state, () => open(state, admin), isDomainError('module_disabled', 'forbidden'))
})

// --- Düzenleme, kapatma, arşiv -----------------------------------------------------------------

test('DOM-ILT-038: formun öğretmeni düzenler; başka öğretmen 403, görmeyen öğretmen 404', () => {
  const state = seed()
  const form = open(state)
  const result = updatePermissionForm(
    state,
    teacher('t1'),
    form.id,
    { title: 'Müze gezisi (güncel)', deadline: '2026-10-10' },
    now,
  )
  assert.equal(result.form.title, 'Müze gezisi (güncel)')
  assert.equal(result.form.deadline, '2026-10-10')
  assert.deepEqual(result.addedStudentIds, [])
  unchanged(
    state,
    () => updatePermissionForm(state, teacher('t2'), form.id, { title: 'Başka' }, now),
    isDomainError('permission_form_not_owner', 'forbidden'),
  )
  unchanged(
    state,
    () => updatePermissionForm(state, teacher('t5'), form.id, { title: 'Başka' }, now),
    isDomainError('permission_form_not_found', 'not_found'),
  )
  unchanged(
    state,
    () => updatePermissionForm(state, admin, 'missing', { title: 'Başka' }, now),
    isDomainError('permission_form_not_found', 'not_found'),
  )
  unchanged(state, () => updatePermissionForm(state, admin, form.id, {}, now), zodError)
  unchanged(
    state,
    () => updatePermissionForm(state, admin, form.id, { topic: 'club' }, now),
    zodError,
  )
})

test('DOM-ILT-038: kararı olmayan formun hedefi daraltılır; kararlı form daraltılamaz, genişler', () => {
  const state = seed()
  const form = open(state, admin, { ...FORM, classIds: ['c1', 'c2'] })
  const narrowed = updatePermissionForm(state, admin, form.id, { classIds: ['c1'] }, now)
  assert.ok(!narrowed.form.studentIds.includes('s2'))
  decidePermission(state, mother, form.id, { studentId: 's1', decision: 'approved' }, id, now)
  unchanged(
    state,
    () => updatePermissionForm(state, admin, form.id, { classIds: ['c5'] }, now),
    isDomainError('permission_form_scope_locked'),
  )
  const widened = updatePermissionForm(state, admin, form.id, { classIds: ['c1', 'c2'] }, now)
  assert.ok(widened.form.studentIds.includes('s2'))
  assert.ok(widened.addedStudentIds.includes('s2'))
  assert.ok(!widened.addedStudentIds.includes('s1'))
})

test('DOM-ILT-038: öğretmen hedefi rehberi olmadığı sınıfa genişletemez', () => {
  const state = seed()
  const form = open(state)
  unchanged(
    state,
    () => updatePermissionForm(state, teacher('t1'), form.id, { classIds: ['c1', 'c5'] }, now),
    isDomainError('permission_form_scope_denied', 'forbidden'),
  )
})

test('DOM-ILT-038: son günü geçmiş formun son günü değişmez; kapalı form düzenlenmez', () => {
  const state = seed()
  const form = open(state, admin, { ...FORM, deadline: '2026-10-06' })
  const tomorrow = '2026-10-07T10:00:00.000Z'
  unchanged(
    state,
    () => updatePermissionForm(state, admin, form.id, { deadline: '2026-10-20' }, tomorrow),
    isDomainError('permission_form_deadline_passed'),
  )
  unchanged(
    state,
    () => updatePermissionForm(state, admin, form.id, { deadline: '2026-10-05' }, now),
    isDomainError('permission_form_deadline_in_past'),
  )
  closePermissionForm(state, admin, form.id, now)
  unchanged(
    state,
    () => updatePermissionForm(state, admin, form.id, { title: 'Yeni ad' }, now),
    isDomainError('permission_form_closed'),
  )
})

test('DOM-ILT-038: form kapatılır, ikinci kapatma 409; kararlı form arşivlenmez', () => {
  const state = seed()
  const form = open(state)
  const empty = open(state)
  decidePermission(state, mother, form.id, { studentId: 's1', decision: 'rejected' }, id, now)
  unchanged(
    state,
    () => archivePermissionForm(state, teacher('t1'), form.id),
    isDomainError('permission_form_has_decisions', 'conflict'),
  )
  unchanged(
    state,
    () => closePermissionForm(state, teacher('t2'), form.id, now),
    isDomainError('permission_form_not_owner', 'forbidden'),
  )
  const closed = closePermissionForm(state, teacher('t1'), form.id, now)
  assert.equal(closed.status, 'closed')
  assert.equal(closed.closedAt, now)
  assert.equal(isPermissionFormOpen(closed, now), false)
  unchanged(
    state,
    () => closePermissionForm(state, teacher('t1'), form.id, now),
    isDomainError('permission_form_closed', 'conflict'),
  )
  archivePermissionForm(state, teacher('t1'), empty.id)
  assert.ok(!state.permissionForms.some((f) => f.id === empty.id))
})

// --- Karar -------------------------------------------------------------------------------------

test('DOM-ILT-037: veli kendi çocuğu için karar verir; değişiklik yeni satırdır, aynı karar yinelenmez', () => {
  const state = seed()
  const form = open(state)
  const first = decidePermission(
    state,
    mother,
    form.id,
    { studentId: 's1', decision: 'approved', note: 'Öğle yemeğini evden getirecek.' },
    id,
    now,
  )
  assert.equal(first.created, true)
  assert.equal(first.decision.relation, 'guardian')
  assert.equal(first.decision.decidedByUserId, 'u-p1')
  assert.equal(first.decision.teacherId, 't1')
  const again = decidePermission(
    state,
    mother,
    form.id,
    { studentId: 's1', decision: 'approved', note: 'Öğle yemeğini evden getirecek.' },
    id,
    now,
  )
  assert.equal(again.created, false)
  assert.equal(again.decision, first.decision)
  const changed = decidePermission(
    state,
    mother,
    form.id,
    { studentId: 's1', decision: 'rejected' },
    id,
    '2026-10-07T08:00:00.000Z',
  )
  assert.equal(changed.created, true)
  assert.equal(state.permissionDecisions.length, 2)
  assert.equal(permissionStatus(state.permissionDecisions, false), 'rejected')
})

test('DOM-ILT-037: veli başka çocuk ve hedefte olmayan çocuk için karar veremez (404)', () => {
  const state = seed()
  const form = open(state)
  unchanged(
    state,
    () =>
      decidePermission(state, mother, form.id, { studentId: 's25', decision: 'approved' }, id, now),
    isDomainError('student_not_found', 'not_found'),
  )
  // Ece (s2) annenin çocuğudur ama formun hedefi 7-A'dır.
  unchanged(
    state,
    () =>
      decidePermission(state, mother, form.id, { studentId: 's2', decision: 'approved' }, id, now),
    isDomainError('permission_form_not_found', 'not_found'),
  )
  unchanged(
    state,
    () =>
      decidePermission(
        state,
        mother,
        'missing',
        { studentId: 's1', decision: 'approved' },
        id,
        now,
      ),
    isDomainError('permission_form_not_found', 'not_found'),
  )
  unchanged(
    state,
    () => decidePermission(state, mother, form.id, { studentId: 's1', decision: 'maybe' }, id, now),
    zodError,
  )
  for (const by of [admin, front, teacher('t1')])
    unchanged(
      state,
      () =>
        decidePermission(state, by, form.id, { studentId: 's1', decision: 'approved' }, id, now),
      isDomainError('permission_denied', 'forbidden'),
    )
})

test('DOM-ILT-030, DOM-ILT-038: son günden sonra ve kapalı formda karar verilmez, değişmez', () => {
  const state = seed()
  const form = open(state)
  decidePermission(state, mother, form.id, { studentId: 's1', decision: 'approved' }, id, now)
  // Son gün İstanbul'da 23:59:59'a kadardır: 9 Ekim 20:59:59Z açık, 21:00Z kapalı.
  const lastMoment = '2026-10-09T20:59:59.000Z'
  assert.equal(permissionDeadlineEndsAt('2026-10-09'), '2026-10-09T21:00:00.000Z')
  decidePermission(
    state,
    father,
    form.id,
    { studentId: 's1', decision: 'approved' },
    id,
    lastMoment,
  )
  unchanged(
    state,
    () =>
      decidePermission(
        state,
        mother,
        form.id,
        { studentId: 's1', decision: 'rejected' },
        id,
        '2026-10-09T21:00:00.000Z',
      ),
    isDomainError('permission_form_deadline_passed'),
  )
  closePermissionForm(state, admin, form.id, now)
  unchanged(
    state,
    () =>
      decidePermission(state, mother, form.id, { studentId: 's1', decision: 'rejected' }, id, now),
    isDomainError('permission_form_closed'),
  )
})

test('DOM-ILT-030: 18 yaşını doldurmuş öğrenci kendisi karar verir; 18 altında veli', () => {
  const state = seed()
  const form = open(state)
  unchanged(
    state,
    () =>
      decidePermission(
        state,
        studentOf('s1'),
        form.id,
        { studentId: 's1', decision: 'approved' },
        id,
        now,
      ),
    isDomainError('permission_guardian_required', 'forbidden'),
  )
  const s1 = state.students.find((s) => s.id === 's1')
  assert.ok(s1)
  Object.assign(s1, { birthDate: '2008-10-06' })
  unchanged(
    state,
    () =>
      decidePermission(state, mother, form.id, { studentId: 's1', decision: 'approved' }, id, now),
    isDomainError('permission_adult_self', 'forbidden'),
  )
  unchanged(
    state,
    () =>
      decidePermission(
        state,
        studentOf('s1'),
        form.id,
        { studentId: 's25', decision: 'approved' },
        id,
        now,
      ),
    isDomainError('student_not_found', 'not_found'),
  )
  const own = decidePermission(
    state,
    studentOf('s1'),
    form.id,
    { studentId: 's1', decision: 'approved' },
    id,
    now,
  )
  assert.equal(own.decision.relation, 'self')
  assert.equal(permissionStatus(state.permissionDecisions, true), 'approved')
  // Veli kararı yetişkin öğrencide sayılmaz.
  assert.equal(permissionStatus(state.permissionDecisions, false), 'pending')
})

test('DOM-ILT-030: kimlik satırındaki doğum tarihi öğrenci kaydının yerine geçer', () => {
  const state = seed()
  const form = open(state)
  unchanged(
    state,
    () =>
      decidePermission(state, mother, form.id, { studentId: 's1', decision: 'approved' }, id, now, {
        birthDate: '2008-10-06',
      }),
    isDomainError('permission_adult_self', 'forbidden'),
  )
  const own = decidePermission(
    state,
    studentOf('s1'),
    form.id,
    { studentId: 's1', decision: 'approved' },
    id,
    now,
    { birthDate: '2008-10-06' },
  )
  assert.equal(own.decision.relation, 'self')
})

test('DOM-ILT-037: pasif öğrenci için karar verilmez', () => {
  const state = seed()
  const form = open(state)
  const s1 = state.students.find((s) => s.id === 's1')
  assert.ok(s1)
  s1.isActive = false
  unchanged(
    state,
    () =>
      decidePermission(state, mother, form.id, { studentId: 's1', decision: 'approved' }, id, now),
    isDomainError('student_inactive'),
  )
})

test('DOM-ILT-031: iki velinin çelişen kararında ret geçerlidir; durum son karardan hesaplanır', () => {
  const decision = (
    by: string,
    value: 'approved' | 'rejected',
    at: string,
  ): Pick<PermissionDecisionRecord, 'decidedByUserId' | 'decidedAt' | 'decision' | 'relation'> => ({
    decidedByUserId: by,
    decidedAt: at,
    decision: value,
    relation: 'guardian',
  })
  assert.equal(permissionStatus([], false), 'pending')
  assert.equal(
    permissionStatus([decision('a', 'approved', '1'), decision('b', 'rejected', '1')], false),
    'rejected',
  )
  assert.equal(
    permissionStatus([decision('a', 'rejected', '1'), decision('a', 'approved', '2')], false),
    'approved',
  )
  assert.deepEqual(permissionCounts(['pending', 'approved', 'approved', 'rejected']), {
    pending: 1,
    approved: 2,
    rejected: 1,
    total: 4,
  })
})

// --- Hatırlatma ve bildirim --------------------------------------------------------------------

test('DOM-ILT-039: hatırlatma son güne 2 gün kala ve son gün yalnız bekleyen öğrencilere', () => {
  const state = seed()
  const form = open(state, admin, { ...FORM, classIds: [], studentIds: ['s1', 's25', 's2'] })
  decidePermission(state, mother, form.id, { studentId: 's1', decision: 'approved' }, id, now)
  decidePermission(state, mother, form.id, { studentId: 's2', decision: 'rejected' }, id, now)
  const remind = (at: string) =>
    permissionReminders({
      forms: state.permissionForms,
      decisions: state.permissionDecisions,
      adult: () => false,
      now: at,
    })
  // 6 Ekim: son güne 3 gün var, hatırlatma yok.
  assert.deepEqual(remind(now), [])
  const twoDays = remind('2026-10-07T05:00:00.000Z')
  assert.deepEqual(twoDays, [
    {
      formId: form.id,
      studentIds: ['s25'],
      daysLeft: 2,
      dedupeKey: `${form.id}:2026-10-09:2`,
    },
  ])
  assert.equal(remind('2026-10-08T05:00:00.000Z').length, 0)
  assert.equal(remind('2026-10-09T05:00:00.000Z')[0]?.daysLeft, 0)
  // Son gün geçti ya da form kapandı: hatırlatma yok.
  assert.deepEqual(remind('2026-10-10T05:00:00.000Z'), [])
  closePermissionForm(state, admin, form.id, now)
  assert.deepEqual(remind('2026-10-09T05:00:00.000Z'), [])
})

test('IST-067: izin formu bildirimleri zorunludur, veliye gider, yalnız form kimliği taşır', () => {
  for (const type of ['permission_form_opened', 'permission_form_reminder'] as const) {
    const spec = NOTIFICATION_TYPES[type]
    assert.equal(spec.mandatory, true)
    assert.equal(spec.topic, 'consent')
    assert.equal(spec.module, 'communication')
    assert.deepEqual(spec.audiences, { minor: ['parent'], adult: ['student'] })
    assert.equal(spec.subjectId(spec.data.parse({ formId: 'pf-1' })), 'pf-1')
    assert.throws(() => spec.data.parse({ formId: 'pf-1', title: 'Gezi' }))
  }
})

// --- Okuma kapsamı -----------------------------------------------------------------------------

test('DOM-ILT-037, DOM-ILT-073: form ve karar okuma kapsamı; veli yalnız kendi kararını görür', () => {
  const state = seed()
  const form = open(state)
  const mine = decidePermission(
    state,
    mother,
    form.id,
    { studentId: 's1', decision: 'approved' },
    id,
    now,
  )
  const theirs = decidePermission(
    state,
    father,
    form.id,
    { studentId: 's1', decision: 'rejected' },
    id,
    now,
  )
  const source: ScopeSource = state
  const scope = (actor: Participant) => scopeFor(source, actor)
  assert.equal(scope(admin).canRead('permissionForms', form), true)
  assert.equal(scope(front).access('permissionForms').allowed, false)
  assert.equal(scope(teacher('t1')).canRead('permissionForms', form), true)
  assert.equal(scope(teacher('t2')).canRead('permissionForms', form), true)
  assert.equal(scope(teacher('t5')).canRead('permissionForms', form), false)
  assert.equal(scope(mother).canRead('permissionForms', form), true)
  assert.equal(scope(studentOf('s1')).canRead('permissionForms', form), true)
  assert.equal(
    scope(person('veli', 'child', ['s3'], 'u-p3')).canRead('permissionForms', form),
    false,
  )
  assert.equal(scope(mother).canRead('permissionDecisions', mine.decision), true)
  assert.equal(scope(mother).canRead('permissionDecisions', theirs.decision), false)
  assert.equal(scope(teacher('t1')).canRead('permissionDecisions', theirs.decision), true)
  assert.ok(scope(teacher('t1')).hiddenFields('permissionDecisions').includes('decidedByUserId'))
  assert.deepEqual(scope(admin).hiddenFields('permissionDecisions'), [])
})
