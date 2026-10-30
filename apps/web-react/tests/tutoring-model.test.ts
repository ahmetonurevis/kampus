import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed, type State } from '@kampus/school-core/data/seed.ts'
import {
  exampleOpticalFile,
  planTutoring,
  runAssessment,
} from '@kampus/school-core/lib/assessment-automation.ts'
import type { Session } from '@kampus/school-core/lib/domain.ts'
import {
  attendanceDefaults,
  defaultPlanValues,
  planDifference,
  planRequest,
  previewPlan,
  sendsExpectedPlan,
  tutorRows,
  TUTORING_PLAN_SOURCES,
  type PlanFormValues,
} from '../src/pages/assessment/tutoring-model.ts'

const NOW = '2026-10-30T09:00:00.000Z'
const admin: Session = { role: 'yonetici' }
const teacher: Session = { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't1' }] }
const student: Session = { role: 'ogrenci', links: [{ kind: 'student', recordId: 's1' }] }
const parent: Session = {
  role: 'veli',
  childId: 's2',
  links: [
    { kind: 'child', recordId: 's1' },
    { kind: 'child', recordId: 's2' },
  ],
}

let counter = 0
const makeId = (prefix: string) => `${prefix}-test-${++counter}`

/** Optik analizi kayıtlı, etüdü olmayan kurum durumu. */
function evaluated(): State {
  const state = structuredClone(createSeed(new Date(NOW)))
  const profile = state.opticalProfiles[0]
  assert.ok(profile)
  const text = exampleOpticalFile(state, profile)
  runAssessment(state, admin, 'evaluate', { profileId: profile.id, text }, makeId, '', NOW)
  return state
}

const values = (over: Partial<PlanFormValues> = {}): PlanFormValues => ({
  ...defaultPlanValues(NOW, 'exam-7-1'),
  threshold: '100',
  toDate: '2026-11-20',
  ...over,
})

test('plan formu bugünden bir hafta, eşik %70 ile başlar', () => {
  const initial = defaultPlanValues(NOW, 'exam-7-1')
  assert.equal(initial.fromDate, '2026-10-30')
  assert.equal(initial.toDate, '2026-11-06')
  assert.equal(initial.threshold, '70')
  assert.equal(initial.examId, 'exam-7-1')
})

test('plan kaynakları ana koleksiyonla başlar ve uygunluk/çakışma kaynaklarını içerir', () => {
  assert.equal(TUTORING_PLAN_SOURCES[0], 'mockExams')
  for (const name of ['availability', 'schedule', 'appointments', 'tutorSessions', 'schoolEvents'])
    assert.ok(TUTORING_PLAN_SOURCES.includes(name as never), name)
})

test('önizleme core planıdır, kayıt oluşturmaz ve imza sunucuya gidecek metindir', () => {
  const state = evaluated()
  const before = JSON.stringify(state)
  const input = values()
  const preview = previewPlan(state, admin, input, NOW)
  assert.ok(preview.ok)
  assert.equal(JSON.stringify(state), before)
  assert.equal(state.tutorSessions.length, 0)
  assert.equal(preview.signature, JSON.stringify(planTutoring(state, admin, input, NOW)))
  assert.ok(preview.summary.sessions + preview.summary.unresolvedGroups > 0)
  assert.equal(preview.summary.sessions, preview.sessions.length)
  assert.equal(preview.unresolved.length, preview.summary.unresolvedGroups)
})

test('kapasite dolu ve yerleşemeyen gruplar uyarı olur', () => {
  const state = evaluated()
  const small = previewPlan(state, admin, values({ maxGroupSize: '1' }), NOW)
  assert.ok(small.ok)
  assert.ok(small.sessions.length > 0)
  assert.ok(small.warnings.some((warning) => warning.includes('kapasitesi doldu')))

  // Uygunluk saati yokken tüm gruplar yerleşemez ve nedeni yazılır.
  state.availability = []
  const none = previewPlan(state, admin, values(), NOW)
  assert.ok(none.ok)
  assert.equal(none.summary.sessions, 0)
  assert.ok(none.unresolved.length > 0)
  assert.ok(none.warnings.some((warning) => warning.includes('uygunluk saati yok')))
})

test('form hataları alan alan Türkçe döner', () => {
  const state = evaluated()
  const threshold = previewPlan(state, admin, values({ threshold: '0' }), NOW)
  assert.ok(!threshold.ok)
  assert.ok(threshold.fields.threshold)

  const duration = previewPlan(state, admin, values({ duration: '5' }), NOW)
  assert.ok(!duration.ok)
  assert.ok(duration.fields.duration)

  const range = previewPlan(state, admin, values({ fromDate: '2026-10-01' }), NOW)
  assert.ok(!range.ok)
  assert.match(range.fields.fromDate ?? '', /bugün veya sonrasında/)

  const long = previewPlan(state, admin, values({ toDate: '2026-12-31' }), NOW)
  assert.ok(!long.ok)
  assert.match(long.message, /en fazla 31 gün/)

  const exam = previewPlan(state, admin, values({ examId: 'yok' }), NOW)
  assert.ok(!exam.ok)
  assert.ok(exam.fields.examId)

  const subject = previewPlan(state, admin, values({ subjectId: 'physics' }), NOW)
  assert.ok(!subject.ok)
  assert.ok(subject.fields.subjectId)
})

test('plan farkı yalnız sayılar değişince bildirilir', () => {
  const summary = {
    sessions: 3,
    students: 6,
    unresolvedGroups: 0,
    unresolvedStudents: 0,
    covered: 0,
    evaluatedStudents: 6,
  }
  assert.equal(planDifference(summary, { ...summary }), null)
  const changed = planDifference(summary, { ...summary, sessions: 2, unresolvedStudents: 2 })
  assert.match(changed ?? '', /Önceki plan: 3 etüt/)
  assert.match(changed ?? '', /Güncel plan: 2 etüt/)
})

test('onay isteği sayıları çevirir; beklenen plan yalnız yöneticide gönderilir', () => {
  const request = planRequest(values(), '{"sessions":[]}')
  assert.equal(request.threshold, 100)
  assert.equal(request.duration, 30)
  assert.equal(request.expectedPlan, '{"sessions":[]}')
  assert.ok(!('expectedPlan' in planRequest(values(), null)))
  assert.equal(sendsExpectedPlan(admin), true)
  assert.equal(sendsExpectedPlan(teacher), false)
})

test('etüt satırları role göre daraltılır; öğrenci/veli yalnız kendi çocuğunu görür', () => {
  const state = evaluated()
  runAssessment(state, admin, 'plan', values(), makeId, '', NOW)
  assert.ok(state.tutorSessions.length > 0)

  const all = tutorRows(state, admin, NOW)
  assert.equal(all.length, state.tutorSessions.length)
  assert.ok(all.every((row) => row.manageable))

  const own = tutorRows(state, student, NOW)
  assert.ok(own.length > 0)
  assert.ok(own.every((row) => !row.manageable && !row.cancellable && !row.attendanceOpen))
  assert.ok(own.every((row) => row.students.every((entry) => entry.id === 's1')))

  const child = tutorRows(state, { ...parent, childId: 's1' }, NOW)
  assert.ok(child.length > 0)
  assert.ok(child.every((row) => row.students.every((entry) => entry.id === 's1')))
  // Seçili çocuk etütte değilse başka çocuğun etütleri görünmez.
  const other = tutorRows(state, parent, NOW)
  assert.ok(other.every((row) => row.students.every((entry) => entry.id === 's2')))

  const mine = tutorRows(state, teacher, NOW)
  assert.ok(mine.length > 0)
  assert.ok(mine.every((row) => row.teacher === 'Selin Kaya'))
})

test('yoklama başlangıç saatinden sonra açılır; iptal yalnız planlı etütte', () => {
  const state = evaluated()
  runAssessment(state, admin, 'plan', values(), makeId, '', NOW)
  const [first] = tutorRows(state, admin, NOW)
  assert.ok(first)
  assert.equal(first.attendanceOpen, false)
  assert.equal(first.cancellable, true)

  const later = new Date(Date.parse(first.date) + 60_000).toISOString()
  const [started] = tutorRows(state, admin, later)
  assert.equal(started?.attendanceOpen, true)

  runAssessment(state, admin, 'cancel', { reason: 'Öğretmen izinli' }, makeId, first.id, NOW)
  const cancelled = tutorRows(state, admin, later).find((row) => row.id === first.id)
  assert.equal(cancelled?.status, 'İptal')
  assert.equal(cancelled?.cancelReason, 'Öğretmen izinli')
  assert.equal(cancelled?.attendanceOpen, false)
  assert.equal(cancelled?.cancellable, false)
})

test('yoklama varsayılanı kayıtlı işaret, yoksa Geldi', () => {
  const state = evaluated()
  runAssessment(state, admin, 'plan', values(), makeId, '', NOW)
  const [first] = tutorRows(state, admin, NOW)
  assert.ok(first)
  const defaults = attendanceDefaults(first)
  assert.deepEqual(
    Object.values(defaults),
    first.students.map(() => 'Geldi'),
  )
  const marked = { ...first, students: first.students.map((s) => ({ ...s, mark: 'İzinli' })) }
  assert.ok(Object.values(attendanceDefaults(marked)).every((mark) => mark === 'İzinli'))
})
