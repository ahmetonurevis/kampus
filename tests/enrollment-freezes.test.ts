import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import { recordAttendance } from '../packages/school-core/src/lib/domain.ts'
import {
  applyFreezeStart,
  assertFreezeRequester,
  clearFreezeFlag,
  daysBetween,
  FREEZE_REASON_LABELS,
  FREEZE_REASONS,
  FREEZE_TOTAL_MAX_DAYS,
  freezeFormSchema,
  freezePhase,
  freezesAvailableFor,
  frozenDaysUsed,
  groupsToFreeze,
  isMidCourse,
  openInstallmentsDuring,
  placementRenewalRequired,
  planFreezeApproval,
  planFreezeRejection,
  planFreezeRequest,
  planFreezeReturn,
  requestFreezeSchema,
  type FreezeFacts,
} from '../packages/school-core/src/lib/enrollment-freezes.ts'
import {
  ENROLLMENT_EVENT_STATUS,
  ENROLLMENT_STATUS_EFFECTS,
  ENROLLMENT_STATUS_LABELS,
  enrollmentEvents,
  enrollmentStatus,
  enrollmentStatuses,
} from '../packages/school-core/src/lib/enrollment-status.ts'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  groupOccupancy,
  type GroupMember,
  type LanguageGroup,
} from '../packages/school-core/src/lib/language-groups.ts'
import { studentsWithEffect } from '../packages/school-core/src/lib/student-roster.ts'
import { withdrawStudent } from '../packages/school-core/src/lib/withdrawals.ts'
import { requireAuthorized } from '../packages/school-core/src/lib/authorize.ts'

const NOW = '2026-10-06T10:00:00.000Z'
const TODAY = '2026-10-06'
const seed = (): State => createSeed(new Date(NOW))

const INPUT = {
  studentId: 's1',
  reason: 'relocation',
  startDate: '2026-10-20',
  returnDate: '2027-01-20',
  documentReceived: false,
} as const

const group = (id: string, extra: Partial<LanguageGroup> = {}): LanguageGroup =>
  ({
    id,
    courseId: 'course-1',
    capacity: 2,
    state: 'open',
    startDate: '2026-11-02',
    endDate: '2027-01-15',
    ...extra,
  }) as LanguageGroup
const member = (groupId: string, studentId: string, extra: Partial<GroupMember> = {}) => ({
  groupId,
  studentId,
  status: 'active' as const,
  joinedAt: NOW,
  ...extra,
})
const freeze = (extra: Partial<FreezeFacts> = {}): FreezeFacts => ({
  id: 'freeze-1',
  status: 'requested',
  startDate: '2026-10-20',
  returnDate: '2027-01-20',
  endedDate: null,
  startedAt: null,
  ...extra,
})
const request = (extra: Partial<Parameters<typeof planFreezeRequest>[0]> = {}) =>
  planFreezeRequest({
    input: INPUT,
    student: { isActive: true },
    freezes: [],
    groups: [],
    today: TODAY,
    ...extra,
  })
const rejectsWith = (code: string, action: () => unknown) =>
  assert.throws(action, (error) => error instanceof DomainError && error.code === code)

test('DOM-DIL-052: dondurma yalnız dil okulundadır', () => {
  assert.equal(freezesAvailableFor('language_school'), true)
  assert.equal(freezesAvailableFor('school'), false)
})

test('DOM-DIL-052: 18 yaş altında talebi veli, üstünde kursiyer açar; personel ikisinde', () => {
  assertFreezeRequester('ogrenci', false)
  assertFreezeRequester('veli', true)
  for (const role of ['yonetici', 'onburo'] as const) {
    assertFreezeRequester(role, true)
    assertFreezeRequester(role, false)
  }
  rejectsWith('freeze_guardian_required', () => assertFreezeRequester('ogrenci', true))
  rejectsWith('freeze_learner_required', () => assertFreezeRequester('veli', false))
})

test('DOM-DIL-052: kur sınırındaki başlangıç belge istemez; açık kayıt ikinci talebi engeller', () => {
  const plan = request()
  assert.equal(plan.midCourse, false)
  rejectsWith('enrollment_freeze_open', () => request({ freezes: [freeze()] }))
  rejectsWith('enrollment_freeze_open', () =>
    request({ freezes: [freeze({ status: 'approved' })] }),
  )
  assert.equal(request({ freezes: [freeze({ status: 'rejected' })] }).midCourse, false)
})

test('DOM-DIL-052: geçmiş başlangıç, ters dönüş ve pasif kursiyer reddedilir', () => {
  rejectsWith('freeze_start_past', () =>
    request({ input: { ...INPUT, startDate: '2026-10-05', returnDate: '2026-11-05' } }),
  )
  rejectsWith('freeze_return_before_start', () =>
    request({ input: { ...INPUT, returnDate: INPUT.startDate } }),
  )
  rejectsWith('student_not_found', () => request({ student: undefined }))
  rejectsWith('freeze_student_inactive', () => request({ student: { isActive: false } }))
  assert.equal(requestFreezeSchema.safeParse({ ...INPUT, reason: 'tatil' }).success, false)
  assert.equal(requestFreezeSchema.safeParse({ ...INPUT, extra: true }).success, false)
})

test('DOM-KAY-024, K-20: neden yalnız kategoridir; serbest metin ve sağlık kategorisi alınmaz', () => {
  assert.deepEqual(
    [...FREEZE_REASONS],
    ['documented', 'military', 'relocation', 'work_school_schedule', 'other'],
  )
  assert.equal(FREEZE_REASON_LABELS.documented, 'Belgeli neden')
  assert.equal(requestFreezeSchema.safeParse({ ...INPUT, reason: 'documented' }).success, true)
  assert.equal(requestFreezeSchema.safeParse({ ...INPUT, reason: 'health' }).success, false)
  for (const field of ['reasonNote', 'documentNote', 'decisionNote', 'note', 'diagnosis'])
    assert.equal(
      requestFreezeSchema.safeParse({ ...INPUT, [field]: 'Kalp ameliyatı' }).success,
      false,
      field,
    )
  assert.deepEqual(Object.keys(requestFreezeSchema.shape).sort(), [
    'documentReceived',
    'reason',
    'returnDate',
    'startDate',
    'studentId',
  ])
  assert.deepEqual(Object.keys(freezeFormSchema.shape).sort(), [
    'documentReceived',
    'reason',
    'returnDate',
    'startDate',
    'studentId',
  ])
  assert.deepEqual(Object.keys(request()).sort(), [
    'documentReceived',
    'midCourse',
    'reason',
    'returnDate',
    'startDate',
    'studentId',
  ])
})

test('DOM-DIL-052: kur ortası başlangıç yalnız belge bilgisiyle olur; dosya içeriği alınmaz', () => {
  const running = group('g1', { startDate: '2026-10-01', endDate: '2026-12-20' })
  rejectsWith('freeze_document_required', () => request({ groups: [running] }))
  const plan = request({
    groups: [running],
    input: { ...INPUT, documentReceived: true },
  })
  assert.equal(plan.midCourse, true)
  assert.equal('document' in plan, false)
})

test('DOM-DIL-052: kur sınırı başlangıçtan önce ve bitişten sonradır; iptal grup sayılmaz', () => {
  const course = group('g1', { startDate: '2026-10-01', endDate: '2026-12-20' })
  assert.equal(isMidCourse('2026-10-01', [course]), false)
  assert.equal(isMidCourse('2026-12-20', [course]), false)
  assert.equal(isMidCourse('2026-12-21', [course]), false)
  assert.equal(isMidCourse('2026-10-02', [course]), true)
  assert.equal(isMidCourse('2026-10-02', [{ ...course, state: 'cancelled' }]), false)
})

test('DOM-DIL-045, DOM-DIL-052: iki programdaki kursiyerde birinin ortası bütün talebi belgeli yapar', () => {
  const ielts = group('g-ielts', { startDate: '2026-10-01', endDate: '2026-12-20' })
  const general = group('g-genel', { startDate: '2027-02-01', endDate: '2027-04-01' })
  assert.equal(isMidCourse('2026-10-20', [general]), false)
  assert.equal(isMidCourse('2026-10-20', [general, ielts]), true)
  // Dondurma kursiyer düzeyindedir: iki programın üyeliği birlikte donar.
  assert.deepEqual(
    groupsToFreeze(
      [member('g-ielts', 's1'), member('g-genel', 's1')],
      [ielts, general],
      '2026-10-20T10:00:00.000Z',
    ),
    ['g-ielts', 'g-genel'],
  )
})

test('DOM-DIL-052: toplam dondurma 6 ayı geçemez, parçalar toplanır', () => {
  const used = freeze({
    id: 'old',
    status: 'ended',
    startDate: '2026-01-01',
    returnDate: '2026-03-01',
    endedDate: '2026-02-01',
    startedAt: '2026-01-01T09:00:00.000Z',
  })
  assert.equal(frozenDaysUsed([used]), 31)
  // Hiç başlamadan biten ve reddedilen sayılmaz.
  assert.equal(frozenDaysUsed([freeze({ status: 'ended', endedDate: TODAY })]), 0)
  assert.equal(frozenDaysUsed([freeze({ status: 'rejected' })]), 0)
  const startDate = '2026-10-20'
  const exact = new Date(
    Date.parse(`${startDate}T00:00:00.000Z`) + (FREEZE_TOTAL_MAX_DAYS - 31) * 86_400_000,
  )
    .toISOString()
    .slice(0, 10)
  const within = request({ freezes: [used], input: { ...INPUT, startDate, returnDate: exact } })
  assert.equal(daysBetween(within.startDate, within.returnDate), FREEZE_TOTAL_MAX_DAYS - 31)
  rejectsWith('freeze_limit_exceeded', () =>
    request({ freezes: [used], input: { ...INPUT, returnDate: '2027-04-01' } }),
  )
})

test('DOM-DIL-052: onay koşulları güncel veriyle denetler, karara bağlanmış talep değişmez', () => {
  const base = {
    student: { isActive: true },
    freezes: [],
    groups: [],
    today: TODAY,
  }
  const pending = { ...freeze(), documentReceived: false }
  assert.deepEqual(planFreezeApproval({ ...base, freeze: pending }), {
    midCourse: false,
    startsNow: false,
  })
  assert.equal(
    planFreezeApproval({ ...base, freeze: { ...pending, startDate: TODAY } }).startsNow,
    true,
  )
  // Talepten sonra grup başladı: başlangıç artık kur ortası ve belge yok.
  rejectsWith('freeze_document_required', () =>
    planFreezeApproval({
      ...base,
      freeze: pending,
      groups: [group('g1', { startDate: '2026-10-01', endDate: '2026-12-20' })],
    }),
  )
  rejectsWith('freeze_start_past', () =>
    planFreezeApproval({ ...base, today: '2026-10-21', freeze: pending }),
  )
  rejectsWith('freeze_student_inactive', () =>
    planFreezeApproval({ ...base, student: { isActive: false }, freeze: pending }),
  )
  rejectsWith('enrollment_freeze_decided', () =>
    planFreezeApproval({ ...base, freeze: { ...pending, status: 'approved' } }),
  )
  rejectsWith('enrollment_freeze_decided', () =>
    planFreezeRejection({ freeze: { status: 'rejected' } }),
  )
  assert.doesNotThrow(() => planFreezeRejection({ freeze: pending }))
})

test('DOM-DIL-052: aşama saklanmaz, durumdan ve tarihlerden türetilir', () => {
  assert.equal(freezePhase(freeze(), TODAY), 'requested')
  assert.equal(freezePhase(freeze({ status: 'approved' }), TODAY), 'scheduled')
  const started = freeze({ status: 'approved', startedAt: NOW })
  assert.equal(freezePhase(started, TODAY), 'frozen')
  assert.equal(freezePhase(started, started.returnDate), 'overdue')
  assert.equal(freezePhase(freeze({ status: 'ended' }), TODAY), 'ended')
})

test('DOM-KAY-026, DOM-DIL-052: dondurulmuş dördüncü durumdur; pasif öğrencide bayrak yok sayılır', () => {
  const records = { renewals: [] }
  const base = { id: 's1', classId: 'c1' }
  assert.equal(ENROLLMENT_STATUS_LABELS.frozen, 'Dondurulmuş')
  assert.equal(enrollmentStatus({ ...base, frozenAt: NOW }, records), 'frozen')
  assert.equal(enrollmentStatus({ ...base, frozenAt: null }, records), 'active')
  assert.equal(enrollmentStatus({ ...base, isActive: false, frozenAt: NOW }, records), 'withdrawn')
  assert.deepEqual(
    [...enrollmentStatuses([{ ...base, frozenAt: NOW }], records)],
    [['s1', 'frozen']],
  )
  assert.deepEqual(ENROLLMENT_STATUS_EFFECTS.frozen, {
    roster: false,
    attendance: false,
    academicNotices: false,
    financeNotices: true,
  })
  assert.equal(studentsWithEffect([{ ...base, frozenAt: NOW }], records, 'attendance').length, 0)
})

test('DOM-KAY-026: dondurma ve dönüş olaydır, durum tablosu buna uyar', () => {
  const events = enrollmentEvents(
    { id: 's1', classId: 'c1', joinedAt: '2026-01-01T09:00:00.000Z' },
    {
      renewals: [],
      freezes: [
        {
          id: 'f1',
          studentId: 's1',
          startedAt: '2026-03-01T09:00:00.000Z',
          endedDate: '2026-04-01',
        },
        { id: 'f2', studentId: 's1', startedAt: null, endedDate: null },
        { id: 'f3', studentId: 's2', startedAt: '2026-03-01T09:00:00.000Z', endedDate: null },
      ],
    },
  )
  assert.deepEqual(
    events.map((event) => event.kind),
    ['enrolled', 'frozen', 'returned'],
  )
  assert.equal(ENROLLMENT_EVENT_STATUS.frozen, 'frozen')
  assert.equal(ENROLLMENT_EVENT_STATUS.returned, 'active')
})

test('DOM-DIL-052: dondurulan kursiyerin yoklaması beklenmez; bayrak kalkınca yeniden beklenir', () => {
  const state = seed()
  const frozen = state.students.find((item) => item.id === 's1')
  assert.ok(frozen)
  const classmates = state.students.filter(
    (item) => item.classId === frozen.classId && item.isActive,
  )
  const marks = Object.fromEntries(
    classmates.filter((item) => item.id !== 's1').map((item) => [item.id, 'present']),
  )
  rejectsWith('attendance_incomplete', () =>
    recordAttendance(structuredClone(state), frozen.classId, TODAY, marks, NOW),
  )
  applyFreezeStart(state, 's1', NOW)
  assert.equal(frozen.isActive, true)
  recordAttendance(state, frozen.classId, TODAY, marks, NOW)
  assert.equal(
    state.attendance.some((item) => item.studentId === 's1' && item.date.startsWith(TODAY)),
    false,
  )
  clearFreezeFlag(state, 's1')
  assert.equal(frozen.frozenAt, null)
  rejectsWith('attendance_incomplete', () =>
    recordAttendance(structuredClone(state), frozen.classId, TODAY, marks, NOW),
  )
  rejectsWith('student_not_found', () => applyFreezeStart(state, 'yok', NOW))
  rejectsWith('student_not_found', () => clearFreezeFlag(state, 'yok'))
})

test('DOM-DIL-052: dondurulan kursiyer grup kapasitesinde yer tutmaz; kapalı grup donmaz', () => {
  const open = group('g-open', { capacity: 1 })
  const closed = group('g-closed', { startDate: '2026-01-01', endDate: '2026-02-01' })
  assert.deepEqual(
    groupsToFreeze(
      [member('g-open', 's1'), member('g-closed', 's1'), member('g-none', 's1')],
      [open, closed],
      NOW,
    ),
    ['g-open'],
  )
  assert.deepEqual(groupsToFreeze([member('g-open', 's1', { status: 'frozen' })], [open], NOW), [])
  const occupancy = groupOccupancy(open, [member('g-open', 's1', { status: 'frozen' })], [], NOW)
  assert.deepEqual(
    { active: occupancy.active, frozen: occupancy.frozen, free: occupancy.free },
    { active: 0, frozen: 1, free: 1 },
  )
})

test('DOM-DIL-052: dönüşte yalnız başlamamış ve boş yeri olan grup geri açılır', () => {
  const started = freeze({ status: 'approved', startedAt: NOW })
  const plan = (extra: Partial<Parameters<typeof planFreezeReturn>[0]>) =>
    planFreezeReturn({
      freeze: started,
      learnerGroupIds: ['g1'],
      groups: [group('g1')],
      members: [member('g1', 's1', { status: 'frozen' })],
      waitlist: [],
      now: NOW,
      ...extra,
    })
  assert.deepEqual(plan({}), {
    endedDate: TODAY,
    started: true,
    restoreGroupIds: ['g1'],
    releaseGroupIds: [],
    needsPlacement: false,
  })
  const full = plan({
    groups: [group('g1', { capacity: 1 })],
    members: [member('g1', 's1', { status: 'frozen' }), member('g1', 's2')],
  })
  assert.deepEqual(full.releaseGroupIds, ['g1'])
  assert.equal(full.needsPlacement, true)
  // Başlamış grup: kaçırılan ders kur geçmeyi bozar; aynı grup garanti edilmez.
  const running = plan({ groups: [group('g1', { startDate: '2026-10-01' })] })
  assert.deepEqual(running.releaseGroupIds, ['g1'])
  assert.deepEqual(plan({ groups: [] }).releaseGroupIds, ['g1'])
  // Başlamadan biten dondurmada üyelik değişmemiştir.
  const scheduled = plan({ freeze: freeze({ status: 'approved' }) })
  assert.equal(scheduled.started, false)
  assert.deepEqual(scheduled.releaseGroupIds, [])
  rejectsWith('enrollment_freeze_not_active', () => plan({ freeze: freeze() }))
  rejectsWith('enrollment_freeze_not_active', () => plan({ freeze: freeze({ status: 'ended' }) }))
})

test('DOM-DIL-012, DOM-DIL-052: 90 günü aşan dondurmada seviye tespiti yenilenir', () => {
  const ended = (endedDate: string) => ({
    startDate: '2026-01-01',
    startedAt: NOW,
    endedDate,
  })
  assert.equal(placementRenewalRequired(ended('2026-04-01')), false)
  assert.equal(placementRenewalRequired(ended('2026-04-02')), true)
  assert.equal(placementRenewalRequired({ ...ended('2026-08-01'), startedAt: null }), false)
  assert.equal(placementRenewalRequired({ ...ended('2026-08-01'), endedDate: null }), false)
})

test('DOM-DIL-052: taksit planı değişmez; aralıktaki açık taksit yalnız sayılır', () => {
  const invoices = [
    { id: 'i1', amount: 100, dueDate: '2026-10-19T09:00:00.000Z', paidAt: null },
    { id: 'i2', amount: 100, dueDate: '2026-10-20T09:00:00.000Z', paidAt: null },
    { id: 'i3', amount: 100, dueDate: '2026-11-20T09:00:00.000Z', paidAt: NOW },
    { id: 'i4', amount: 100, dueDate: '2026-12-20T09:00:00.000Z' },
    { id: 'i5', amount: 100, dueDate: '2026-12-21T09:00:00.000Z' },
    { id: 'i6', amount: 100, dueDate: '2027-01-20T09:00:00.000Z', paidAt: null },
  ]
  const before = structuredClone(invoices)
  assert.equal(
    openInstallmentsDuring(invoices, new Map([['i5', 100]]), {
      startDate: '2026-10-20',
      returnDate: '2027-01-20',
    }),
    2,
  )
  assert.deepEqual(invoices, before)
})

test('DOM-YTK-025, DOM-DIL-052: talep yetkisi rol ve kapsamla çözülür', () => {
  const state = seed()
  const options = { now: NOW, institutionType: 'language_school' as const }
  const target = { studentId: 's1' }
  requireAuthorized(
    { role: 'yonetici', links: [] },
    'enrollment.freezeRequest',
    target,
    state,
    options,
  )
  requireAuthorized(
    { role: 'onburo', links: [] },
    'enrollment.freezeRequest',
    target,
    state,
    options,
  )
  requireAuthorized(
    { role: 'veli', links: [{ kind: 'child', recordId: 's1' }] },
    'enrollment.freezeRequest',
    target,
    state,
    options,
  )
  requireAuthorized(
    { role: 'ogrenci', links: [{ kind: 'student', recordId: 's1' }] },
    'enrollment.freezeRequest',
    target,
    state,
    options,
  )
  const outside = () =>
    requireAuthorized(
      { role: 'veli', links: [{ kind: 'child', recordId: 's2' }] },
      'enrollment.freezeRequest',
      target,
      state,
      options,
    )
  assert.throws(outside, (error) => error instanceof DomainError && error.kind === 'not_found')
  assert.throws(() =>
    requireAuthorized(
      { role: 'ogretmen', links: [] },
      'enrollment.freezeRequest',
      target,
      state,
      options,
    ),
  )
  requireAuthorized({ role: 'yonetici', links: [] }, 'enrollment.freezeDecide', {}, state, options)
  assert.throws(() =>
    requireAuthorized({ role: 'onburo', links: [] }, 'enrollment.freezeDecide', {}, state, options),
  )
  requireAuthorized({ role: 'onburo', links: [] }, 'enrollment.freezeReturn', {}, state, options)
  assert.throws(() =>
    requireAuthorized(
      { role: 'veli', links: [{ kind: 'child', recordId: 's1' }] },
      'enrollment.freezeReturn',
      {},
      state,
      options,
    ),
  )
})

test('DOM-DIL-052: ayrılış dondurma bayrağını temizler, durum ayrıldı olur', () => {
  const state = seed()
  applyFreezeStart(state, 's1', NOW)
  withdrawStudent(
    state,
    's1',
    {
      withdrawalDate: TODAY,
      termStartDate: '2026-09-07',
      attendedUnits: 10,
      totalUnits: 100,
      reason: 'relocation',
      targetSchool: null,
    },
    (prefix) => `${prefix}-freeze-test`,
    { institutionType: 'language_school', allocated: new Map(), creditCents: 0, now: NOW },
  )
  const student = state.students.find((item) => item.id === 's1')
  assert.ok(student)
  assert.equal(student.frozenAt, null)
  assert.equal(enrollmentStatus(student, { renewals: [] }), 'withdrawn')
})
