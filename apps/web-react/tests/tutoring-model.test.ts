import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed, type State } from '@kampus/school-core/data/seed.ts'
import { ApiError } from '@kampus/api-client/errors.ts'
import type { TutoringPlanPreview } from '@kampus/react-shared/use-assessment-commands.ts'
import {
  exampleOpticalFile,
  planTutoring,
  runAssessment,
} from '@kampus/school-core/lib/assessment-automation.ts'
import type { Session } from '@kampus/school-core/lib/domain.ts'
import {
  attendanceDefaults,
  availabilityRows,
  AVAILABILITY_SOURCES,
  checkPlanForm,
  defaultPlanValues,
  planFailure,
  planRequest,
  planView,
  slotRequest,
  slotTeachers,
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

test('plan kaynakları ana koleksiyonla başlar; plan hesabı için koleksiyon okunmaz', () => {
  assert.equal(TUTORING_PLAN_SOURCES[0], 'mockExams')
  for (const name of ['availability', 'schedule', 'appointments', 'tutorSessions', 'schoolEvents'])
    assert.ok(!TUTORING_PLAN_SOURCES.includes(name as never), name)
  assert.equal(AVAILABILITY_SOURCES[0], 'availability')
})

/** Sunucunun döneceği önizleme: core planı + özet (sunucu da aynı çekirdeği çalıştırır). */
function serverPreview(state: State, input: PlanFormValues): TutoringPlanPreview {
  const plan = planTutoring(state, admin, input, NOW)
  const plannedStudents = new Set(plan.sessions.flatMap((item) => item.studentIds))
  return {
    ...plan,
    summary: {
      sessionCount: plan.sessions.length,
      plannedStudentCount: plannedStudents.size,
      unresolvedGroupCount: plan.unresolved.length,
      unresolvedStudentCount: plan.unresolved.reduce(
        (sum, item) => sum + item.studentIds.length,
        0,
      ),
      coveredCount: plan.covered.length,
    },
    expectedPlan: JSON.stringify(plan),
  } as TutoringPlanPreview
}

test('plan görünümü kimlikleri adlara çevirir ve özeti sayar', () => {
  const state = evaluated()
  const preview = serverPreview(state, values())
  const view = planView(preview, state)
  assert.equal(view.sessions.length, preview.sessions.length)
  assert.equal(view.unresolved.length, preview.unresolved.length)
  assert.ok(view.sessions.length + view.unresolved.length > 0)
  assert.equal(view.summary.sessions, preview.summary.sessionCount)
  assert.equal(view.summary.evaluatedStudents, preview.evaluatedStudents)
  for (const row of view.sessions) {
    assert.ok(!/^teacher-|^student-/.test(row.teacher + row.students), row.key)
    assert.match(row.capacity, /^\d+\/\d+$/)
  }
})

test('kapasitesi dolan etüt ve yerleşemeyen grup nedeniyle görünür', () => {
  const state = evaluated()
  const small = planView(serverPreview(state, values({ maxGroupSize: '1' })), state)
  assert.ok(small.sessions.length > 0)
  assert.ok(small.sessions.every((row) => row.full))

  // Uygunluk saati yokken tüm gruplar yerleşemez ve neden yazılır.
  state.availability = []
  const none = planView(serverPreview(state, values()), state)
  assert.equal(none.summary.sessions, 0)
  assert.ok(none.unresolved.length > 0)
  assert.ok(none.unresolved.every((row) => row.reason.length > 0 && row.studentCount > 0))
})

test('zaten etütte olan kazanımlar kazanım başına gruplanır', () => {
  const state = evaluated()
  runAssessment(state, admin, 'plan', values(), makeId, '', NOW)
  const view = planView(serverPreview(state, values()), state)
  assert.equal(view.summary.sessions, 0)
  assert.ok(view.covered.length > 0)
  assert.equal(new Set(view.covered.map((row) => row.topic)).size, view.covered.length)
  assert.ok(view.covered.every((row) => row.students.length > 0))
})

test('form denetimi core şemasıyla alan alan Türkçe döner', () => {
  const ok = checkPlanForm(values())
  assert.ok(ok.ok)
  assert.equal(ok.request.threshold, 100)

  const threshold = checkPlanForm(values({ threshold: '0' }))
  assert.ok(!threshold.ok)
  assert.ok(threshold.failure.fields.threshold)

  const duration = checkPlanForm(values({ duration: '5' }))
  assert.ok(!duration.ok)
  assert.ok(duration.failure.fields.duration)
})

test('sunucu hataları alana bağlanır; diğerleri deneme alanına yazılır', () => {
  const zod = new ApiError({
    status: 400,
    code: 'validation_error',
    message: 'Geçersiz.',
    issues: [
      { path: ['fromDate'], code: 'custom', message: 'Başlangıç bugün veya sonrasında olmalı.' },
    ],
  })
  const fromZod = planFailure(zod, values())
  assert.match(fromZod.fields.fromDate ?? '', /bugün veya sonrasında/)

  const range = planFailure(
    new ApiError({ status: 422, code: 'tutoring_date_range_invalid', message: 'En fazla 31 gün.' }),
    values(),
  )
  assert.equal(range.fields.fromDate, 'En fazla 31 gün.')

  const subject = planFailure(
    new ApiError({ status: 422, code: 'subject_out_of_scope', message: 'Ders kapsamda değil.' }),
    values(),
  )
  assert.equal(subject.fields.subjectId, 'Ders kapsamda değil.')

  const exam = planFailure(
    new ApiError({ status: 404, code: 'not_found', message: 'Deneme bulunamadı.' }),
    values(),
  )
  assert.equal(exam.fields.examId, 'Deneme bulunamadı.')
})

test('plan isteği sayıları çevirir; beklenen plan verilince eklenir', () => {
  const request = planRequest(values(), '{"sessions":[]}')
  assert.equal(request.threshold, 100)
  assert.equal(request.duration, 30)
  assert.equal(request.expectedPlan, '{"sessions":[]}')
  assert.ok(!('expectedPlan' in planRequest(values())))
})

test('uygunluk satırları role göre kaldırılabilir; yerel saat İstanbul saatine çevrilir', () => {
  const state = evaluated()
  assert.ok(state.availability.length > 0)
  const all = availabilityRows(state, admin, NOW)
  assert.equal(all.length, state.availability.length)
  assert.ok(all.every((row) => row.manageable))
  const own = availabilityRows(state, teacher, NOW)
  assert.ok(own.some((row) => row.manageable))
  assert.ok(own.filter((row) => !row.manageable).every((row) => row.teacherId !== 't1'))
  assert.ok(availabilityRows(state, student, NOW).every((row) => !row.manageable))

  const request = slotRequest({ teacherId: 't1', date: '2026-11-02T15:30', duration: '45' })
  assert.deepEqual(request, { teacherId: 't1', date: '2026-11-02T12:30:00.000Z', duration: 45 })
  assert.equal(slotRequest({ teacherId: 't1', date: 'x', duration: '45' }).date, 'x')

  assert.ok(slotTeachers(state, admin).length > 1)
  assert.deepEqual(
    slotTeachers(state, teacher).map((item) => item.id),
    ['t1'],
  )
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
