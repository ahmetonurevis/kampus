import assert from 'node:assert/strict'
import test from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  planStaffingPlan,
  planStaffingPositionUpdate,
  scheduleHoursBySubject,
  staffingPlanInputSchema,
  staffingPositionInputSchema,
  staffingPositionUpdateSchema,
  staffingRows,
  staffingTotals,
  staffingWeek,
  type StaffingPositionState,
} from '../packages/school-core/src/lib/finance-staffing-plans.ts'

const rejects = (fn: () => unknown, code: string) =>
  assert.throws(fn, (error) => error instanceof DomainError && error.code === code)

test('DOM-FIN-126 K-433: hafta pazartesi–pazar, programdan iptal edilmemiş ders başına bir saat', () => {
  assert.deepEqual(staffingWeek('2026-11-19'), { startDate: '2026-11-16', endDate: '2026-11-22' })
  assert.deepEqual(staffingWeek('2026-11-16'), { startDate: '2026-11-16', endDate: '2026-11-22' })
  assert.deepEqual(staffingWeek('2026-11-22'), { startDate: '2026-11-16', endDate: '2026-11-22' })
  const hours = scheduleHoursBySubject([
    { subjectId: 'math', cancelled: false },
    { subjectId: 'math', cancelled: false },
    { subjectId: 'math', cancelled: true },
    { subjectId: 'eng', cancelled: false },
    { subjectId: '', cancelled: false },
  ])
  assert.deepEqual(
    [...hours],
    [
      ['math', 2],
      ['eng', 1],
    ],
  )
})

test('DOM-FIN-126 K-434 K-435: kapasite, açık, pozisyon düşümü ve tam zamanlı eşdeğeri', () => {
  const rows = staffingRows({
    normHours: 20,
    lines: [
      { subjectId: 'math', requiredHours: 70 },
      { subjectId: 'art', requiredHours: 4 },
    ],
    scheduleHours: new Map([
      ['math', 60],
      ['eng', 30],
    ]),
    teachers: [
      { membershipId: 'a', subjectIds: ['math'], payBasis: 'full_time' },
      { membershipId: 'b', subjectIds: ['math', 'eng', 'eng'], payBasis: 'unknown' },
      { membershipId: 'c', subjectIds: ['eng'], payBasis: 'hourly' },
      { membershipId: 'd', subjectIds: [], payBasis: 'full_time' },
      { membershipId: 'e', subjectIds: ['art', 'eng', 'math'], payBasis: 'full_time' },
    ],
    positions: [
      { subjectId: 'math', hours: 10, status: 'open' },
      { subjectId: 'math', hours: 5, status: 'posted' },
      { subjectId: 'math', hours: 40, status: 'filled' },
      { subjectId: 'eng', hours: 8, status: 'cancelled' },
    ],
  })
  const bySubject = new Map(rows.map((row) => [row.subjectId, row]))
  assert.deepEqual(
    rows.map((row) => row.subjectId),
    ['art', 'eng', 'math'],
  )
  // math: a 20 + b 10 (20/2) + e 6 (20/3, kalan ilk branşa) = 36
  const math = bySubject.get('math')!
  assert.equal(math.requiredHours, 70)
  assert.equal(math.requiredSource, 'plan')
  assert.equal(math.scheduleHours, 60)
  assert.equal(math.fullTimeTeachers, 3)
  assert.equal(math.capacityHours, 36)
  assert.equal(math.gapHours, 34)
  assert.equal(math.openPositionHours, 15)
  assert.equal(math.suggestedHours, 19)
  assert.equal(math.suggestedFte, 1)
  // eng: plan satırı yok → program; b 10 + e 7 = 17; saatlik c kapasiteye girmez
  const eng = bySubject.get('eng')!
  assert.equal(eng.requiredSource, 'schedule')
  assert.equal(eng.requiredHours, 30)
  assert.equal(eng.hourlyTeachers, 1)
  assert.equal(eng.capacityHours, 17)
  assert.equal(eng.gapHours, 13)
  assert.equal(eng.openPositionHours, 0)
  assert.equal(eng.suggestedFte, 0.7)
  // art: fazla kapasite eksiye düşmez
  const art = bySubject.get('art')!
  assert.equal(art.capacityHours, 7)
  assert.equal(art.gapHours, 0)
  assert.equal(art.surplusHours, 3)
  const totals = staffingTotals(rows, 20)
  assert.equal(totals.requiredHours, 104)
  assert.equal(totals.capacityHours, 60)
  assert.equal(totals.suggestedHours, 32)
  assert.equal(totals.suggestedFte, 1.6)
})

test('DOM-FIN-126 K-435: açık pozisyon saati açığı aşarsa öneri sıfır', () => {
  const [row] = staffingRows({
    normHours: 15,
    lines: [{ subjectId: 'bio', requiredHours: 10 }],
    scheduleHours: new Map(),
    teachers: [],
    positions: [{ subjectId: 'bio', hours: 12, status: 'open' }],
  })
  assert.equal(row?.gapHours, 10)
  assert.equal(row?.suggestedHours, 0)
  assert.equal(row?.suggestedFte, 0)
})

test('DOM-FIN-126: plan şeması aynı branşı ve sınır dışı normu reddeder', () => {
  assert.equal(
    staffingPlanInputSchema.safeParse({
      normHours: 20,
      lines: [
        { subjectId: 'math', requiredHours: 1 },
        { subjectId: 'math', requiredHours: 2 },
      ],
    }).success,
    false,
  )
  assert.equal(staffingPlanInputSchema.safeParse({ normHours: 0, lines: [] }).success, false)
  assert.equal(staffingPlanInputSchema.safeParse({ normHours: 41, lines: [] }).success, false)
  assert.equal(
    staffingPlanInputSchema.safeParse({
      normHours: 20,
      lines: [{ subjectId: 'math', requiredHours: -1 }],
    }).success,
    false,
  )
})

test('DOM-FIN-126 K-433: plan değişikliği sıralanır, değişiklik yoksa 422', () => {
  const current = { normHours: 20, lines: [{ subjectId: 'a', requiredHours: 4 }] }
  const plan = planStaffingPlan(current, {
    normHours: 18,
    lines: [
      { subjectId: 'b', requiredHours: 2 },
      { subjectId: 'a', requiredHours: 4 },
    ],
  })
  assert.deepEqual(plan.changed, ['normHours', 'lines'])
  assert.deepEqual(
    plan.next.lines.map((line) => line.subjectId),
    ['a', 'b'],
  )
  rejects(() => planStaffingPlan(current, { ...current }), 'staffing_plan_unchanged')
})

test('DOM-FIN-126 K-435: pozisyon şemaları; boş not null olur, boş güncelleme reddedilir', () => {
  const parsed = staffingPositionInputSchema.parse({
    academicYear: 2026,
    subjectId: 'math',
    hours: 20,
    note: '  ',
  })
  assert.equal(parsed.note, null)
  assert.equal(parsed.jobOfferId, null)
  assert.equal(
    staffingPositionInputSchema.safeParse({ academicYear: 2026, subjectId: 'm', hours: 0 }).success,
    false,
  )
  assert.equal(staffingPositionUpdateSchema.safeParse({}).success, false)
  assert.equal(staffingPositionUpdateSchema.safeParse({ jobOfferId: 'x' }).success, false)
})

test('DOM-FIN-126 K-435: pozisyon durum geçişleri ve son durumların kilidi', () => {
  const open: StaffingPositionState = { status: 'open', hours: 10, note: null, jobOfferId: null }
  assert.deepEqual(planStaffingPositionUpdate(open, { status: 'posted', hours: 12 }).changed, [
    'status',
    'hours',
  ])
  assert.equal(
    planStaffingPositionUpdate({ ...open, status: 'posted' }, { status: 'open' }).next.status,
    'open',
  )
  rejects(() => planStaffingPositionUpdate(open, { hours: 10 }), 'staffing_position_unchanged')
  rejects(
    () => planStaffingPositionUpdate({ ...open, status: 'filled' }, { status: 'open' }),
    'staffing_position_closed',
  )
  rejects(
    () => planStaffingPositionUpdate({ ...open, status: 'cancelled' }, { note: 'x' }),
    'staffing_position_closed',
  )
  const linked = planStaffingPositionUpdate(open, {
    jobOfferId: '0b9f3c1e-8a7d-4d55-9a8e-1f2a3b4c5d6e',
    note: 'İlan verildi',
  })
  assert.deepEqual(linked.changed, ['note', 'jobOfferId'])
})
