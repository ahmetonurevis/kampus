import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import {
  ENROLLMENT_EVENT_STATUS,
  ENROLLMENT_STATUS_EFFECTS,
  ENROLLMENT_STATUS_LABELS,
  ENROLLMENT_STATUSES,
  enrollmentEvents,
  enrollmentStatus,
  enrollmentStatuses,
  type EnrollmentRenewal,
} from '../packages/school-core/src/lib/enrollment-status.ts'
import { runWorkflow } from '../packages/school-core/src/lib/school-workflows.ts'
import { withdrawStudent } from '../packages/school-core/src/lib/withdrawals.ts'

const NOW = '2026-10-06T10:00:00.000Z'
let serial = 0
const makeId = (prefix: string) => `${prefix}-status-test-${String(++serial)}`
const ADMIN = { role: 'yonetici', childId: 's1' } as const
const RENEWAL = {
  studentId: 's1',
  targetClassId: 'c4',
  year: 2027,
  mode: 'renew',
  total: 28500,
  scholarship: 0,
  discount: 0,
  count: 7,
  startDate: '2027-01-31',
}

type RenewalRow = { id: string; status: string }
const run = (state: State, command: string, input: unknown, recordId?: string, at = NOW) =>
  runWorkflow(state, ADMIN, command, input, makeId, recordId, at) as unknown as RenewalRow

const student = (state: State, id: string) => state.students.find((item) => item.id === id)!
const withdraw = (state: State, studentId: string) =>
  withdrawStudent(
    state,
    studentId,
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

test('DOM-KAY-026: kesin kayıtlı öğrenci aktiftir; ilk olay kesin kayıttır, durum saklanmaz', () => {
  const state = createSeed(new Date(NOW))
  const deniz = student(state, 's1')
  assert.equal(enrollmentStatus(deniz, state), 'active')
  assert.deepEqual(enrollmentEvents(deniz, state), [
    { kind: 'enrolled', at: deniz.joinedAt, classId: deniz.classId },
  ])
  // Alanı olmayan eski kayıt aktiftir.
  assert.equal(enrollmentStatus({ id: 'x-legacy', classId: 'c1' }, { renewals: [] }), 'active')
  assert.equal('enrollmentStatus' in deniz, false)
})

test('DOM-KAY-026, DOM-KAY-020: yenileme planı durumu değiştirmez, dönem geçişi sınıfı değiştirip aktif bırakır', () => {
  const state = createSeed(new Date(NOW))
  const fromClassId = student(state, 's1').classId
  const planned = run(state, 'renewal', RENEWAL)
  assert.equal(enrollmentStatus(student(state, 's1'), state), 'active')
  assert.deepEqual(
    enrollmentEvents(student(state, 's1'), state).map((event) => event.kind),
    ['enrolled', 'renewed'],
  )
  const later = '2027-06-20T09:00:00.000Z'
  run(state, 'renewal-activate', {}, planned.id, later)
  const events = enrollmentEvents(student(state, 's1'), state)
  assert.equal(enrollmentStatus(student(state, 's1'), state), 'active')
  assert.deepEqual(
    events.map((event) => event.kind),
    ['enrolled', 'renewed', 'promoted'],
  )
  // Kesin kayıt sınıfı ilk geçişin çıkış sınıfıdır; güncel sınıf değişmiş olsa da.
  assert.deepEqual(events[0], {
    kind: 'enrolled',
    at: student(state, 's1').joinedAt,
    classId: fromClassId,
  })
  assert.deepEqual(events[2], {
    kind: 'promoted',
    at: later,
    renewalId: planned.id,
    year: 2027,
    fromClassId,
    toClassId: 'c4',
  })
})

test('DOM-KAY-026, DOM-KAY-022: uygulanmış mezuniyet mezun yapar; planlanmış mezuniyet olay değildir', () => {
  const state = createSeed(new Date(NOW))
  const senior = state.students.find(
    (item) => state.classes.find((c) => c.id === item.classId)?.grade === 12,
  )!
  const planned = run(state, 'renewal', {
    ...RENEWAL,
    studentId: senior.id,
    mode: 'graduate',
    targetClassId: '',
  })
  assert.equal(enrollmentStatus(senior, state), 'active')
  assert.deepEqual(
    enrollmentEvents(senior, state).map((event) => event.kind),
    ['enrolled'],
  )
  run(state, 'renewal-activate', {}, planned.id)
  assert.equal(enrollmentStatus(senior, state), 'graduated')
  assert.deepEqual(enrollmentEvents(senior, state).at(-1), {
    kind: 'graduated',
    at: NOW,
    renewalId: planned.id,
    fromClassId: senior.classId,
  })
})

test('DOM-KAY-026, DOM-KAY-024: ayrılış pasifleştirir; iptal edilen yenileme olay üretmez, olay ayrılış gününü taşır', () => {
  const state = createSeed(new Date(NOW))
  run(state, 'renewal', RENEWAL)
  const result = withdraw(state, 's1')
  const deniz = student(state, 's1')
  assert.equal(enrollmentStatus(deniz, state), 'withdrawn')
  // Çevrimdışı State'te ayrılış kaydı yok: olay tarihsizdir ve sondadır.
  assert.deepEqual(enrollmentEvents(deniz, state), [
    { kind: 'enrolled', at: deniz.joinedAt, classId: deniz.classId },
    { kind: 'withdrawn', at: null, withdrawalId: null },
  ])
  const withdrawals = [
    { id: 'wd-other', studentId: 's2', withdrawalDate: '2026-09-01' },
    { id: 'wd-1', studentId: 's1', withdrawalDate: result.withdrawalDate },
  ]
  assert.deepEqual(enrollmentEvents(deniz, { renewals: state.renewals, withdrawals }).at(-1), {
    kind: 'withdrawn',
    at: '2026-10-01',
    withdrawalId: 'wd-1',
  })
})

test('DOM-KAY-026: durumu bayrak belirler; aktif öğrencinin ayrılış kaydı olay üretmez', () => {
  const active = { id: 's-flag', classId: 'c1', isActive: true }
  const withdrawals = [{ id: 'wd-flag', studentId: 's-flag', withdrawalDate: '2026-09-01' }]
  assert.equal(enrollmentStatus(active, { renewals: [] }), 'active')
  assert.deepEqual(
    enrollmentEvents(active, { renewals: [], withdrawals }).map((event) => event.kind),
    ['enrolled'],
  )
  // Tarihsiz kesin kayıt (eski kayıt) da ilk olaydır.
  assert.equal(enrollmentEvents(active, { renewals: [] })[0]?.at, null)
})

test('DOM-KAY-026: olaylar tarihe göre sıralanır; ayrılış günü aynı günün geçişinden önce gelir', () => {
  const graduation: EnrollmentRenewal = {
    id: 'r-grad',
    studentId: 's-order',
    mode: 'graduate',
    status: 'Mezun',
    year: 2027,
    fromClassId: 'c12',
    targetClassId: '',
    createdAt: '2026-05-01T09:00:00.000Z',
    activatedAt: '2026-06-20T09:00:00.000Z',
  }
  const promotion: EnrollmentRenewal = {
    ...graduation,
    id: 'r-promo',
    mode: 'renew',
    status: 'Tamamlandı',
    year: 2026,
    fromClassId: 'c11',
    targetClassId: 'c12',
    createdAt: '2025-04-01T09:00:00.000Z',
    activatedAt: '2025-06-20T09:00:00.000Z',
  }
  const cancelled: EnrollmentRenewal = { ...promotion, id: 'r-cancel', status: 'İptal' }
  const learner = { id: 's-order', classId: 'c12', isActive: false }
  const records = { renewals: [graduation, cancelled, promotion] }
  assert.deepEqual(
    enrollmentEvents(learner, records).map((event) => event.kind),
    ['enrolled', 'renewed', 'promoted', 'graduated'],
  )
  assert.deepEqual(enrollmentEvents(learner, records)[0], {
    kind: 'enrolled',
    at: null,
    classId: 'c11',
  })
  const plannedPromotion: EnrollmentRenewal = {
    id: 'r-day',
    studentId: 's-day',
    mode: 'renew',
    status: 'Planlandı',
    year: 2027,
    fromClassId: 'c1',
    targetClassId: 'c4',
    createdAt: '2026-10-01T08:00:00.000Z',
  }
  const sameDay = enrollmentEvents(
    { id: 's-day', classId: 'c1', isActive: false, joinedAt: '2025-09-01T09:00:00.000Z' },
    {
      renewals: [plannedPromotion],
      withdrawals: [{ id: 'wd-day', studentId: 's-day', withdrawalDate: '2026-10-01' }],
    },
  )
  assert.deepEqual(
    sameDay.map((event) => event.kind),
    ['enrolled', 'withdrawn', 'renewed'],
  )
})

test('DOM-KAY-026: toplu durum haritası her öğrenciyi tek geçişte çözer', () => {
  const state = createSeed(new Date(NOW))
  const senior = state.students.find(
    (item) => state.classes.find((c) => c.id === item.classId)?.grade === 12,
  )!
  const planned = run(state, 'renewal', {
    ...RENEWAL,
    studentId: senior.id,
    mode: 'graduate',
    targetClassId: '',
  })
  run(state, 'renewal-activate', {}, planned.id)
  withdraw(state, 's1')
  const statuses = enrollmentStatuses(state.students, state)
  assert.equal(statuses.size, state.students.length)
  assert.equal(statuses.get('s1'), 'withdrawn')
  assert.equal(statuses.get(senior.id), 'graduated')
  assert.equal(statuses.get('s2'), 'active')
  for (const item of state.students)
    assert.equal(statuses.get(item.id), enrollmentStatus(item, state))
})

test('DOM-KAY-026: durum etkileri; yalnız aktif öğrenci listede ve yoklamada, finans bildirimi sürer', () => {
  assert.deepEqual(ENROLLMENT_STATUSES, ['active', 'frozen', 'withdrawn', 'graduated'])
  for (const status of ENROLLMENT_STATUSES) {
    const effects = ENROLLMENT_STATUS_EFFECTS[status]
    assert.equal(effects.roster, status === 'active')
    assert.equal(effects.attendance, status === 'active')
    assert.equal(effects.academicNotices, status === 'active')
    assert.equal(effects.financeNotices, true)
    assert.ok(ENROLLMENT_STATUS_LABELS[status].length > 0)
  }
  assert.deepEqual(ENROLLMENT_EVENT_STATUS, {
    enrolled: 'active',
    renewed: null,
    promoted: 'active',
    graduated: 'graduated',
    withdrawn: 'withdrawn',
    frozen: 'frozen',
    returned: 'active',
  })
})
