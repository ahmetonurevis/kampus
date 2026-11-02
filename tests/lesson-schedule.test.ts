import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Session } from '../packages/school-core/src/lib/domain.ts'
import { runWorkflow } from '../packages/school-core/src/lib/school-workflows.ts'
import { scopeFor, type Actor } from '../packages/school-core/src/lib/scope.ts'
import { isDomainError } from './support/domain-error.ts'

/**
 * Ders programı kuralları (IST-094; docs/domain/yetki-ve-kapsam.md DOM-YTK-068, DOM-YTK-069):
 * çakışma, başlamış ders kilidi, gerekçeli iptal, yoklamalı gün ve yedek öğretmen. Saat
 * 2026-10-06 10:00Z salıdır; örnek program bu haftanın ve gelecek haftanın derslerini içerir.
 */

const now = '2026-10-06T10:00:00.000Z'
let sequence = 0
const makeId = (prefix: string) => `${prefix}-lesson-test-${++sequence}`
const admin: Session = { role: 'yonetici' }
const run = (state: State, command: string, input: unknown, recordId?: string) =>
  runWorkflow(state, admin, command, input, makeId, recordId, now)

type Lesson = State['schedule'][number]
const future = (state: State, classId = 'c1', subjectId = 'math'): Lesson => {
  const lesson = state.schedule.find(
    (l) =>
      l.classId === classId && l.subjectId === subjectId && Date.parse(l.date) > Date.parse(now),
  )
  assert.ok(lesson, 'örnek programda gelecek ders yok')
  return lesson
}
const past = (state: State): Lesson => {
  const lesson = state.schedule.find(
    (l) => l.classId === 'c1' && Date.parse(l.date) < Date.parse(now),
  )
  assert.ok(lesson, 'örnek programda geçmiş ders yok')
  return lesson
}
const slot = (lesson: Lesson) => ({
  classId: lesson.classId,
  teacherId: lesson.teacherId,
  subjectId: lesson.subjectId,
  date: lesson.date,
  duration: lesson.duration,
  room: lesson.room,
})
/** Başarısız işlem State'i değiştirmez. */
function unchanged(state: State, action: () => unknown, check: (error: unknown) => boolean) {
  const before = JSON.stringify(state)
  assert.throws(action, check)
  assert.equal(JSON.stringify(state), before)
}
/** Programda o güne ders olmayan, gelecek bir hafta içi saat (ikinci haftadan sonra). */
const FREE = '2026-11-03T07:00:00.000Z'
/** t1'in yedeği: aynı branş ve kampüs. */
function withBackup(state: State, overrides: Partial<State['teachers'][number]> = {}) {
  const t1 = state.teachers.find((t) => t.id === 't1')!
  const backup = { ...t1, id: 'teacher-backup', name: 'Yedek Öğretmen', ...overrides }
  state.teachers.push(backup)
  return backup
}

test('DOM-YTK-069: ders geçmiş saate planlanamaz; başlamış ders düzenlenemez', () => {
  const state = createSeed(new Date(now))
  const lesson = future(state)
  unchanged(
    state,
    () => run(state, 'lesson', { ...slot(lesson), date: '2026-10-06T09:00:00.000Z' }),
    isDomainError('lesson_in_past'),
  )
  const started = past(state)
  unchanged(
    state,
    () => run(state, 'lesson', { ...slot(started), date: FREE }, started.id),
    isDomainError('lesson_in_past'),
  )
  // Ders başlangıcı işlem anına eşitse başlamış sayılır.
  unchanged(
    state,
    () => run(state, 'lesson', { ...slot(lesson), date: now }),
    isDomainError('lesson_in_past'),
  )
})

test('DOM-YTK-069: öğretmen, sınıf ve derslik çakışması 409; düzenlenen ders kendisiyle çakışmaz', () => {
  const state = createSeed(new Date(now))
  const lesson = future(state)
  unchanged(
    state,
    () => run(state, 'lesson', slot(lesson)),
    isDomainError('teacher_lesson_conflict', 'conflict'),
  )
  const other = withBackup(state)
  unchanged(
    state,
    () => run(state, 'lesson', { ...slot(lesson), teacherId: other.id, room: 'Z-1' }),
    isDomainError('class_lesson_conflict', 'conflict'),
  )
  // Aynı kampüste başka sınıfın dersliği.
  const neighbour = state.schedule.find(
    (l) =>
      l.classId !== lesson.classId &&
      l.date === lesson.date &&
      state.classes.find((c) => c.id === l.classId)?.branchId ===
        state.classes.find((c) => c.id === lesson.classId)?.branchId &&
      l.teacherId !== lesson.teacherId,
  )
  assert.ok(neighbour, 'aynı saatte aynı kampüste başka ders yok')
  const moved = run(state, 'lesson', { ...slot(lesson), date: FREE }, lesson.id) as Lesson
  assert.equal(moved.date, FREE)
  unchanged(
    state,
    () =>
      run(state, 'lesson', {
        ...slot(lesson),
        date: neighbour.date,
        teacherId: other.id,
        room: ` ${neighbour.room.toLocaleUpperCase('tr')} `,
      }),
    isDomainError('room_conflict', 'conflict'),
  )
})

test('DOM-YTK-069: öğretmenin randevusu, etüdü ve etkinliği dersle çakışır', () => {
  const state = createSeed(new Date(now))
  const lesson = future(state)
  const input = { ...slot(lesson), date: FREE, room: 'Z-9' }
  state.appointments.push({
    ...state.appointments[0]!,
    id: 'apt-lesson-test',
    teacherId: lesson.teacherId,
    date: FREE,
    duration: 30,
    status: 'Onaylandı',
  })
  unchanged(
    state,
    () => run(state, 'lesson', input),
    isDomainError('teacher_appointment_conflict', 'conflict'),
  )
  state.appointments = state.appointments.filter((a) => a.id !== 'apt-lesson-test')
  // Etüt kaydının yalnız çakışma alanları (lib/tutor-conflicts.ts); kalan alanlar kurala girmez.
  const tutoring = {
    id: 'tutor-lesson-test',
    teacherId: lesson.teacherId,
    branchId: 'b-lesson-test',
    studentIds: [],
    date: FREE,
    duration: 40,
    room: 'Etüt-1',
    status: 'Planlandı',
  } as unknown as State['tutorSessions'][number]
  state.tutorSessions.push(tutoring)
  unchanged(
    state,
    () => run(state, 'lesson', input),
    isDomainError('tutor_schedule_conflict', 'conflict'),
  )
  state.tutorSessions = state.tutorSessions.filter((s) => s.id !== tutoring.id)
  state.schoolEvents.push({
    id: 'event-lesson-test',
    title: 'Bilim şenliği',
    classId: '',
    branchId: state.classes.find((c) => c.id === lesson.classId)!.branchId,
    date: '2026-11-03T06:30:00.000Z',
    endDate: '2026-11-03T08:00:00.000Z',
    location: 'Bahçe',
    description: 'Şenlik',
    requiresConsent: false,
    consentDeadline: '2026-11-02T00:00:00.000Z',
    teacherId: lesson.teacherId,
    status: 'Planlandı',
    createdAt: now,
  })
  unchanged(
    state,
    () => run(state, 'lesson', input),
    isDomainError('teacher_event_conflict', 'conflict'),
  )
  // İptal edilen etkinlik ve başka öğretmenin etkinliği çakışmaz.
  state.schoolEvents[state.schoolEvents.length - 1]!.status = 'İptal'
  const created = run(state, 'lesson', input) as Lesson
  assert.equal(created.date, FREE)
})

test('DOM-YTK-069: iptal gerekçe ister, geçmiş dersi ve yoklaması alınmış günü reddeder; iptal kaydı korunur', () => {
  const state = createSeed(new Date(now))
  const lesson = future(state)
  unchanged(
    state,
    () => run(state, 'lesson-cancel', {}, lesson.id),
    (e) => e instanceof Error,
  )
  unchanged(
    state,
    () => run(state, 'lesson-cancel', { reason: 'x' }, lesson.id),
    (e) => e instanceof Error,
  )
  const started = past(state)
  unchanged(
    state,
    () => run(state, 'lesson-cancel', { reason: 'Okul gezisi.' }, started.id),
    isDomainError('lesson_in_past'),
  )
  // Bugünün sonraki dersi: sınıfın bugünkü yoklaması alınmış.
  const today = state.schedule.find(
    (l) =>
      l.classId === 'c1' &&
      Date.parse(l.date) > Date.parse(now) &&
      l.date.slice(0, 10) === now.slice(0, 10),
  )
  assert.ok(today, 'bugün saat 10.00Z sonrasında 7-A dersi yok')
  state.attendance = state.attendance.filter((a) => a.date.slice(0, 10) !== now.slice(0, 10))
  state.attendance.push({
    id: 'att-lesson-test',
    studentId: 's1',
    classId: 'c1',
    date: now,
    status: 'present',
    reason: '',
  })
  unchanged(
    state,
    () => run(state, 'lesson-cancel', { reason: 'Okul gezisi.' }, today.id),
    isDomainError('lesson_attendance_taken'),
  )
  const cancelled = run(state, 'lesson-cancel', { reason: ' Okul gezisi. ' }, lesson.id) as Lesson
  assert.equal(cancelled.cancelledAt, now)
  assert.equal(cancelled.cancelReason, 'Okul gezisi.')
  assert.ok(state.schedule.some((l) => l.id === lesson.id))
  unchanged(
    state,
    () => run(state, 'lesson-cancel', { reason: 'Yine.' }, lesson.id),
    isDomainError('lesson_already_cancelled', 'conflict'),
  )
  // İptal edilen dersin saati boşalır.
  assert.ok(run(state, 'lesson', slot(lesson)))
})

test('DOM-YTK-069: yedek öğretmen aynı kampüs ve branşta etkin olmalı; iptal veya geçmiş derse atanmaz', () => {
  const state = createSeed(new Date(now))
  const lesson = future(state)
  const assignments = JSON.stringify(state.assignments)
  const otherCampus = state.branches.find(
    (b) => b.id !== state.classes.find((c) => c.id === lesson.classId)!.branchId,
  )!
  withBackup(state, { id: 'teacher-far', branchId: otherCampus.id })
  unchanged(
    state,
    () => run(state, 'substitute', { teacherId: 'teacher-far', reason: 'İzinli.' }, lesson.id),
    isDomainError('lesson_teacher_mismatch'),
  )
  withBackup(state, { id: 'teacher-passive', isActive: false })
  unchanged(
    state,
    () => run(state, 'substitute', { teacherId: 'teacher-passive', reason: 'İzinli.' }, lesson.id),
    isDomainError('record_inactive'),
  )
  const backup = withBackup(state)
  const started = past(state)
  unchanged(
    state,
    () => run(state, 'substitute', { teacherId: backup.id, reason: 'İzinli.' }, started.id),
    isDomainError('lesson_in_past'),
  )
  const original = lesson.teacherId
  run(state, 'substitute', { teacherId: backup.id, reason: 'İzinli.' }, lesson.id)
  assert.equal(lesson.teacherId, backup.id)
  assert.equal(lesson.originalTeacherId, original)
  assert.equal(JSON.stringify(state.assignments), assignments)
  run(state, 'lesson-cancel', { reason: 'Okul gezisi.' }, lesson.id)
  unchanged(
    state,
    () => run(state, 'substitute', { teacherId: original, reason: 'Döndü.' }, lesson.id),
    isDomainError('lesson_cancelled'),
  )
})

test('DOM-YTK-068: iptal ve görevlendirme gerekçesi yalnız yöneticiye döner; öğretmen, ön büro, öğrenci ve veli durumu görür', () => {
  const state = createSeed(new Date(now))
  const lesson = future(state)
  const original = lesson.teacherId
  const backup = withBackup(state)
  run(state, 'substitute', { teacherId: backup.id, reason: 'Sağlık izni.' }, lesson.id)
  run(state, 'lesson-cancel', { reason: 'Okul gezisi.' }, lesson.id)
  const record = state.schedule.find((l) => l.id === lesson.id)!
  const others: Actor[] = [
    { role: 'ogretmen', links: [{ kind: 'teacher', recordId: backup.id }] },
    { role: 'ogretmen', links: [{ kind: 'teacher', recordId: original }] },
    { role: 'onburo', links: [] },
    { role: 'ogrenci', links: [{ kind: 'student', recordId: 's1' }] },
    { role: 'veli', links: [{ kind: 'child', recordId: 's1' }] },
  ]
  for (const actor of others) {
    const scope = scopeFor(state, actor)
    assert.ok(scope.canRead('schedule', record), actor.role)
    const shown = scope.redact('schedule', record)
    assert.equal(shown.cancelledAt, now)
    assert.equal(shown.originalTeacherId, original)
    assert.equal(shown.teacherId, backup.id)
    assert.equal('cancelReason' in shown, false, actor.role)
    assert.equal('substitutions' in shown, false, actor.role)
  }
  const staff = scopeFor(state, { role: 'yonetici', links: [] }).redact('schedule', record)
  assert.equal(staff.cancelReason, 'Okul gezisi.')
  assert.equal(staff.substitutions?.[0]?.reason, 'Sağlık izni.')
})

test('DOM-YTK-069: yedek atanmış derste öğretmen düzenlemeyle değişmez (lesson_has_substitution)', () => {
  const state = createSeed(new Date(now))
  const lesson = future(state)
  const backup = withBackup(state)
  withBackup(state, { id: 'teacher-third', name: 'Üçüncü Öğretmen' })
  run(state, 'substitute', { teacherId: backup.id, reason: 'İzinli.' }, lesson.id)
  unchanged(
    state,
    () => run(state, 'lesson', { ...slot(lesson), teacherId: 'teacher-third' }, lesson.id),
    isDomainError('lesson_has_substitution'),
  )
  unchanged(
    state,
    () => run(state, 'lesson', { ...slot(lesson), teacherId: lesson.originalTeacherId }, lesson.id),
    isDomainError('lesson_has_substitution'),
  )
  // Öğretmen dışındaki alanlar düzenlenir; yedek öğretmen yerinde kalır.
  run(state, 'lesson', { ...slot(lesson), duration: 45 }, lesson.id)
  assert.equal(lesson.duration, 45)
  assert.equal(lesson.teacherId, backup.id)
})
