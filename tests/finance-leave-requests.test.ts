import assert from 'node:assert/strict'
import test from 'node:test'

import {
  affectedLessons,
  applySubstitutes,
  LEAVE_REQUEST_LESSONS_MAX,
  leaveBalanceAfterRequest,
  leaveRequestApproveSchema,
  leaveRequestCancelSchema,
  leaveRequestCreateSchema,
  leaveRequestRejectSchema,
  leaveRequestSubstitutesSchema,
  lessonSnapshot,
  planLeaveRequest,
  planLeaveRequestApproval,
  planLeaveRequestCancel,
  planLeaveRequestRejection,
  planLeaveRequestSubstitutes,
  substituteWarnings,
  weekdayCount,
  type LeaveRequestCreateInput,
  type LeaveRequestState,
  type LeaveTeacher,
  type ScheduleLesson,
} from '../packages/school-core/src/lib/finance-leave-requests.ts'
import {
  effectiveLeaveTypes,
  type LeaveProfile,
  type LeaveType,
} from '../packages/school-core/src/lib/finance-staff-leave.ts'

import { isDomainError } from './support/domain-error.ts'

// Personel izin talebi ve onayı (DOM-FIN-116; ON-182). Kararlar K-397…K-399.

const rejects = (run: () => unknown, code: string, kind = 'rule') =>
  assert.throws(run, isDomainError(code, kind))
const TYPES = effectiveLeaveTypes([])
const typeOf = (code: string): LeaveType => {
  const found = TYPES.find((type) => type.code === code)
  assert.ok(found, code)
  return found
}
const profile = (overrides: Partial<LeaveProfile> = {}): LeaveProfile => ({
  seniorityStartDate: '2020-03-15',
  birthDate: null,
  openingBalance: null,
  ...overrides,
})
/** İstanbul 09.00 (UTC 06.00) ve 10.00 dersleri. */
const lesson = (id: string, date: string, overrides: Partial<ScheduleLesson> = {}) => ({
  id,
  date,
  duration: 40,
  classId: 'c1',
  subjectId: 'mat',
  title: 'Matematik',
  teacherId: 't1',
  originalTeacherId: null,
  cancelledAt: null,
  ...overrides,
})
const SCHEDULE: ScheduleLesson[] = [
  lesson('l2', '2026-11-03T07:00:00.000Z'),
  lesson('l1', '2026-11-02T06:00:00.000Z'),
  lesson('l3', '2026-11-04T06:00:00.000Z', { cancelledAt: '2026-10-01T00:00:00.000Z' }),
  lesson('l4', '2026-11-05T06:00:00.000Z', { teacherId: 't3', originalTeacherId: 't1' }),
  lesson('l5', '2026-11-02T06:10:00.000Z', { teacherId: 't2', classId: 'c2' }),
  lesson('l6', '2026-11-09T06:00:00.000Z'),
  // İstanbul'da 2 Kasım 00.30 (UTC 1 Kasım 21.30): aralığa girer.
  lesson('l7', '2026-11-01T21:30:00.000Z'),
]
const TEACHERS: LeaveTeacher[] = [
  { id: 't1', name: 'Selin Kaya', subjectId: 'mat', isActive: true },
  { id: 't2', name: 'Murat Demir', subjectId: 'mat', isActive: true },
  { id: 't3', name: 'Ayla Şen', subjectId: 'fen', isActive: true },
  { id: 't4', name: 'Eski Öğretmen', subjectId: 'mat', isActive: false },
]
const REQUEST: LeaveRequestCreateInput = {
  membershipId: 'm-selin',
  typeCode: 'annual',
  startDate: '2026-11-02',
  endDate: '2026-11-06',
  days: 5,
}
const PERIOD = { startDate: '2026-11-02', endDate: '2026-11-06' }

function plan(
  input: LeaveRequestCreateInput = REQUEST,
  overrides: Partial<Parameters<typeof planLeaveRequest>[1]> = {},
) {
  const parsed = leaveRequestCreateSchema.parse(input)
  return planLeaveRequest(parsed, {
    staff: { role: 'ogretmen', active: true },
    type: TYPES.find((type) => type.code === parsed.typeCode) ?? null,
    profile: profile(),
    records: [],
    requests: [],
    lessons: affectedLessons(SCHEDULE, 't1', parsed),
    teachers: TEACHERS,
    ownTeacherId: 't1',
    employmentEndDate: null,
    ...overrides,
  })
}

const stored = (overrides: Partial<LeaveRequestState> = {}): LeaveRequestState => ({
  id: 'r1',
  membershipId: 'm-selin',
  typeCode: 'annual',
  startDate: '2026-11-02',
  endDate: '2026-11-06',
  days: 5,
  description: null,
  status: 'pending',
  ...overrides,
})
function approve(
  request: LeaveRequestState = stored(),
  allowAdvance = false,
  overrides: Partial<Parameters<typeof planLeaveRequestApproval>[2]> = {},
) {
  return planLeaveRequestApproval(request, leaveRequestApproveSchema.parse({ allowAdvance }), {
    staff: { role: 'ogretmen', active: true },
    type: typeOf(request.typeCode),
    profile: profile(),
    records: [],
    requests: [request],
    lockedMonths: [],
    employmentEndDate: null,
    ...overrides,
  })
}

test('DOM-FIN-116: talep şeması tam gün ister, bitiş başlangıçtan önce olamaz, ders tekil', () => {
  const parsed = leaveRequestCreateSchema.parse({ ...REQUEST, description: '  ' })
  assert.equal(parsed.description, null)
  assert.deepEqual(parsed.substitutes, [])
  assert.equal(leaveRequestCreateSchema.safeParse({ ...REQUEST, days: 0.5 }).success, false)
  assert.equal(
    leaveRequestCreateSchema.safeParse({ ...REQUEST, endDate: '2026-11-01' }).success,
    false,
  )
  assert.equal(
    leaveRequestCreateSchema.safeParse({ ...REQUEST, description: 'x'.repeat(501) }).success,
    false,
  )
  const twice = leaveRequestCreateSchema.safeParse({
    ...REQUEST,
    substitutes: [
      { lessonId: 'l1', substituteTeacherId: 't2' },
      { lessonId: 'l1', substituteTeacherId: null },
    ],
  })
  assert.equal(twice.success, false)
  assert.equal(
    leaveRequestCreateSchema.safeParse({ ...REQUEST, institutionId: 'x' }).success,
    false,
  )
  assert.equal(leaveRequestApproveSchema.parse({}).allowAdvance, false)
  assert.equal(leaveRequestRejectSchema.safeParse({ reason: 'kısa' }).success, false)
  assert.equal(leaveRequestCancelSchema.safeParse({ reason: 'Personel vazgeçti' }).success, true)
  assert.equal(leaveRequestSubstitutesSchema.safeParse({ substitutes: [] }).success, false)
})

test('DOM-FIN-116: etkilenen dersler İstanbul gününe göre, iptal edilenler hariç, sıralı', () => {
  const ids = affectedLessons(SCHEDULE, 't1', PERIOD).map((item) => item.id)
  // l3 iptal, l5 başka öğretmen, l6 aralık dışı; l4'te t1 asıl öğretmen.
  assert.deepEqual(ids, ['l7', 'l1', 'l2', 'l4'])
  assert.deepEqual(affectedLessons(SCHEDULE, 't9', PERIOD), [])
  const first = SCHEDULE[1]
  assert.ok(first)
  assert.deepEqual(lessonSnapshot(first, 't2'), {
    lessonId: 'l1',
    startsAt: '2026-11-02T06:00:00.000Z',
    duration: 40,
    classId: 'c1',
    subjectId: 'mat',
    title: 'Matematik',
    substituteTeacherId: 't2',
  })
  assert.equal(lessonSnapshot({ ...first, title: null }, null).title, 'Ders')
})

test('DOM-FIN-116: yedek uyarıları dersi olan, izinli ve başka branştan öğretmeni gösterir', () => {
  const target = lessonSnapshot(lesson('l1', '2026-11-02T06:00:00.000Z'), null)
  const teacher = (id: string) => {
    const found = TEACHERS.find((item) => item.id === id)
    assert.ok(found)
    return found
  }
  assert.deepEqual(substituteWarnings(target, teacher('t2'), SCHEDULE, new Map()), ['busy'])
  assert.deepEqual(
    substituteWarnings(
      target,
      teacher('t3'),
      SCHEDULE,
      new Map([['t3', [{ startDate: '2026-11-02', endDate: '2026-11-02' }]]]),
    ),
    ['on_leave', 'other_subject'],
  )
  assert.deepEqual(
    substituteWarnings(target, { ...teacher('t2'), subjectId: null }, [], new Map()),
    [],
  )
  // İptal edilmiş ders ve aynı ders meşgul saymaz.
  assert.deepEqual(
    substituteWarnings(
      target,
      teacher('t2'),
      [
        lesson('l1', target.startsAt, { teacherId: 't2' }),
        { ...lesson('x', target.startsAt), teacherId: 't2', cancelledAt: 'x' },
      ],
      new Map(),
    ),
    [],
  )
})

test('DOM-FIN-116: talep açılır, dersler kopyalanır, yedek seçilir ve kalan bakiye döner', () => {
  const result = plan({
    ...REQUEST,
    substitutes: [{ lessonId: 'l1', substituteTeacherId: 't2' }],
  })
  assert.deepEqual(result.snapshot, {
    kind: 'annual',
    typeLabel: 'Yıllık ücretli izin',
    paid: true,
    deductsFromAnnual: true,
  })
  assert.deepEqual(
    result.lessons.map((item) => [item.lessonId, item.substituteTeacherId]),
    [
      ['l7', null],
      ['l1', 't2'],
      ['l2', null],
      ['l4', null],
    ],
  )
  // 2020-03-15 kıdem: 5 × 14 + 20 = 90 gün; talep 5 gün.
  assert.equal(result.balanceAfterDays, 85)
  // Yıllıktan düşmeyen türde bakiye yok; ders bağı yoksa boş liste.
  const excuse = plan({ ...REQUEST, typeCode: 'marriage', days: 3 }, { lessons: [] })
  assert.equal(excuse.balanceAfterDays, null)
  assert.deepEqual(excuse.lessons, [])
  // Yetersiz bakiye talepte uyarıdır (eksi döner).
  const short = plan(REQUEST, { profile: profile({ seniorityStartDate: '2026-01-05' }) })
  assert.equal(short.balanceAfterDays, -5)
})

test('DOM-FIN-116: talep kayıt kurallarını ve çakışmayı denetler', () => {
  rejects(() => plan(REQUEST, { staff: null }), 'staff_leave_staff_not_found')
  rejects(() => plan(REQUEST, { staff: { role: 'veli', active: true } }), 'staff_leave_not_staff')
  rejects(
    () => plan(REQUEST, { staff: { role: 'ogretmen', active: false } }),
    'staff_leave_staff_inactive',
  )
  rejects(() => plan({ ...REQUEST, typeCode: 'sick' }), 'staff_leave_sick_not_manual')
  rejects(() => plan({ ...REQUEST, typeCode: 'yok_tur' }), 'staff_leave_type_not_found')
  rejects(() => plan({ ...REQUEST, days: 6 }), 'staff_leave_days_exceed_range')
  rejects(() => plan(REQUEST, { profile: null }), 'staff_leave_profile_required')
  rejects(
    () =>
      plan(REQUEST, {
        records: [
          {
            id: 'k1',
            startDate: '2026-11-06',
            endDate: '2026-11-06',
            days: 1,
            deductsFromAnnual: true,
          },
        ],
      }),
    'staff_leave_overlap',
  )
  for (const status of ['pending', 'approved'] as const)
    rejects(
      () =>
        plan(REQUEST, {
          requests: [{ id: 'r0', status, startDate: '2026-10-30', endDate: '2026-11-02' }],
        }),
      'staff_leave_request_overlap',
    )
  // Reddedilmiş ve iptal edilmiş talep çakışma sayılmaz.
  for (const status of ['rejected', 'cancelled'] as const)
    plan(REQUEST, {
      requests: [{ id: 'r0', status, startDate: '2026-11-02', endDate: '2026-11-06' }],
    })
  const many = Array.from({ length: LEAVE_REQUEST_LESSONS_MAX + 1 }, (_, index) =>
    lesson(`m${String(index)}`, '2026-11-02T06:00:00.000Z'),
  )
  rejects(() => plan(REQUEST, { lessons: many }), 'staff_leave_request_too_many_lessons')
})

test('DOM-FIN-116: yedek seçimi derse, etkin öğretmene ve başkasına bağlıdır', () => {
  const lessons = affectedLessons(SCHEDULE, 't1', PERIOD).map((item) => lessonSnapshot(item, null))
  const checks = { teachers: TEACHERS, ownTeacherId: 't1' }
  rejects(
    () => applySubstitutes(lessons, [{ lessonId: 'l6', substituteTeacherId: 't2' }], checks),
    'staff_leave_lesson_not_affected',
  )
  rejects(
    () => applySubstitutes(lessons, [{ lessonId: 'l1', substituteTeacherId: 't1' }], checks),
    'staff_leave_substitute_self',
  )
  for (const id of ['t4', 't9'])
    rejects(
      () => applySubstitutes(lessons, [{ lessonId: 'l1', substituteTeacherId: id }], checks),
      'staff_leave_substitute_not_found',
    )
  const set = applySubstitutes(lessons, [{ lessonId: 'l2', substituteTeacherId: 't3' }], checks)
  assert.equal(set.find((item) => item.lessonId === 'l2')?.substituteTeacherId, 't3')
  const cleared = applySubstitutes(set, [{ lessonId: 'l2', substituteTeacherId: null }], checks)
  assert.equal(cleared.find((item) => item.lessonId === 'l2')?.substituteTeacherId, null)
})

test('DOM-FIN-116: onay kayıt kopyası üretir; yetersiz bakiye avans işaretiyle onaylanır', () => {
  assert.deepEqual(approve(), {
    snapshot: {
      kind: 'annual',
      typeLabel: 'Yıllık ücretli izin',
      paid: true,
      deductsFromAnnual: true,
    },
    balanceAfterDays: 85,
  })
  const young = { profile: profile({ seniorityStartDate: '2025-03-15' }) }
  // Bir hak ediş (14 gün) − planlanan 10 gün = 4; talep 5 gün.
  const records = [
    { id: 'k1', startDate: '2026-12-01', endDate: '2026-12-14', days: 10, deductsFromAnnual: true },
  ]
  rejects(() => approve(stored(), false, { ...young, records }), 'staff_leave_balance_insufficient')
  assert.equal(approve(stored(), true, { ...young, records }).balanceAfterDays, -1)
  assert.equal(approve(stored(), false, young).balanceAfterDays, 9)
  // Yıllıktan düşmeyen tür bakiyeye bakmaz.
  assert.equal(
    approve(stored({ typeCode: 'unpaid' }), false, { type: typeOf('unpaid'), profile: null })
      .balanceAfterDays,
    null,
  )
})

test('DOM-FIN-116: onay bekleyen talep ister, kilitli bordro ayında 409, çakışmayı yeniden denetler', () => {
  for (const status of ['approved', 'rejected', 'cancelled'] as const)
    rejects(() => approve(stored({ status })), 'staff_leave_request_not_pending')
  rejects(
    () => approve(stored(), false, { lockedMonths: ['2026-11'] }),
    'payroll_period_locked',
    'conflict',
  )
  approve(stored(), false, { lockedMonths: ['2026-10', '2026-12'] })
  rejects(
    () =>
      approve(stored(), false, {
        requests: [
          stored(),
          { id: 'r2', status: 'approved', startDate: '2026-11-06', endDate: '2026-11-06' },
        ],
      }),
    'staff_leave_request_overlap',
  )
  rejects(
    () =>
      approve(stored(), false, {
        records: [
          {
            id: 'k',
            startDate: '2026-11-03',
            endDate: '2026-11-03',
            days: 1,
            deductsFromAnnual: false,
          },
        ],
      }),
    'staff_leave_overlap',
  )
  const closedType = { ...typeOf('other'), isActive: false }
  rejects(
    () => approve(stored({ typeCode: 'other' }), false, { type: closedType }),
    'staff_leave_type_inactive',
  )
})

test('DOM-FIN-116: ret yalnız bekleyen talepte; iptal onaylıda kaydı da iptal eder', () => {
  planLeaveRequestRejection(stored())
  rejects(
    () => planLeaveRequestRejection(stored({ status: 'approved' })),
    'staff_leave_request_not_pending',
  )
  assert.deepEqual(planLeaveRequestCancel(stored(), ['2026-11']), { cancelsRecord: false })
  assert.deepEqual(planLeaveRequestCancel(stored({ status: 'approved' }), []), {
    cancelsRecord: true,
  })
  rejects(
    () => planLeaveRequestCancel(stored({ status: 'approved' }), ['2026-11']),
    'payroll_period_locked',
    'conflict',
  )
  for (const status of ['rejected', 'cancelled'] as const)
    rejects(() => planLeaveRequestCancel(stored({ status }), []), 'staff_leave_request_closed')
})

test('DOM-FIN-116: yedek değişikliği açık talepte; değişiklik yoksa ret', () => {
  const lessons = affectedLessons(SCHEDULE, 't1', PERIOD).map((item) => lessonSnapshot(item, null))
  const checks = { teachers: TEACHERS, ownTeacherId: 't1' }
  const next = planLeaveRequestSubstitutes(
    stored({ status: 'approved' }),
    lessons,
    { substitutes: [{ lessonId: 'l1', substituteTeacherId: 't2' }] },
    checks,
  )
  assert.equal(next.find((item) => item.lessonId === 'l1')?.substituteTeacherId, 't2')
  rejects(
    () =>
      planLeaveRequestSubstitutes(
        stored(),
        lessons,
        { substitutes: [{ lessonId: 'l1', substituteTeacherId: null }] },
        checks,
      ),
    'staff_leave_substitutes_unchanged',
  )
  rejects(
    () =>
      planLeaveRequestSubstitutes(
        stored({ status: 'rejected' }),
        lessons,
        { substitutes: [{ lessonId: 'l1', substituteTeacherId: 't2' }] },
        checks,
      ),
    'staff_leave_request_closed',
  )
})

test('DOM-FIN-116: bakiye hesabı profil ve tür olmadan boş; hafta içi gün önerisi', () => {
  const request = { ...PERIOD, days: 5, deductsFromAnnual: true }
  assert.equal(leaveBalanceAfterRequest(request, null, [], null), null)
  assert.equal(
    leaveBalanceAfterRequest({ ...request, deductsFromAnnual: false }, profile(), [], null),
    null,
  )
  // Ayrılan personel: hizmet 2026-01-10'da bitti; 2026-03-15 hak edişi yok (5 × 14 = 70).
  assert.equal(leaveBalanceAfterRequest(request, profile(), [], '2026-01-10'), 65)
  assert.equal(weekdayCount('2026-11-02', '2026-11-08'), 5)
  assert.equal(weekdayCount('2026-11-07', '2026-11-08'), 0)
  assert.equal(weekdayCount('2026-11-06', '2026-11-02'), 0)
})
