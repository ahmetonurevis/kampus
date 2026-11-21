import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ObservationPlan } from '@kampus/react-shared/use-finance-observation-plans.ts'
import {
  cancelFormSchema,
  canStartPlan,
  emptyPlanForm,
  isOpenPlan,
  planCreateBody,
  planFormSchema,
  planFormValues,
  plansByDay,
  planTimeText,
  planUpdateBody,
  postponeBody,
  postponeFormSchema,
  postponeFormValues,
} from '../src/pages/finance/finance-observation-plan-forms.ts'

// Gözlem planı formları ve takvim listesi (DOM-FIN-139; ON-207; K-472…K-474).

const TODAY = '2026-11-23'
const plan = (patch: Partial<ObservationPlan> = {}): ObservationPlan => ({
  id: 'p-1',
  teacherMembershipId: 'm-selin',
  teacherName: 'Selin Kaya',
  observerMembershipId: 'm-mudur',
  observerName: 'Aylin Demir',
  templateId: 't-1',
  templateVersionId: 'v-1',
  templateName: 'Ders gözlem formu',
  templateVersionNumber: 1,
  plannedDate: '2026-11-25',
  startTime: '09:40',
  endTime: '10:20',
  durationMinutes: 40,
  classId: 'c-7a',
  className: '7-A',
  subjectId: null,
  subjectName: null,
  performancePeriodId: null,
  performancePeriodName: null,
  note: null,
  status: 'planned',
  postponeCount: 0,
  postponeReason: null,
  cancelReason: null,
  cancelledAt: null,
  observationId: null,
  observationStatus: null,
  doneAt: null,
  overdue: false,
  pendingNoticeCount: 1,
  createdAt: '2026-11-20T09:00:00.000Z',
  updatedAt: '2026-11-20T09:00:00.000Z',
  version: 1,
  ...patch,
})

test('DOM-FIN-139: boş form bugünle ve 40 dakikayla açılır; zorunlu alanlar ve saat biçimi', () => {
  const empty = emptyPlanForm(TODAY)
  assert.equal(empty.plannedDate, TODAY)
  assert.equal(empty.durationMinutes, '40')
  const parsed = planFormSchema.safeParse(empty)
  assert.equal(parsed.success, false)
  const filled = {
    ...empty,
    templateId: 't-1',
    teacherMembershipId: 'm-selin',
    observerMembershipId: 'm-mudur',
  }
  assert.equal(planFormSchema.safeParse(filled).success, true)
  assert.equal(planFormSchema.safeParse({ ...filled, startTime: '9:40' }).success, false)
  assert.equal(planFormSchema.safeParse({ ...filled, durationMinutes: '5' }).success, false)
  assert.equal(planFormSchema.safeParse({ ...filled, durationMinutes: '4.5' }).success, false)
})

test('DOM-FIN-139: açma gövdesi boş seçimleri göndermez, süre sayıya döner', () => {
  const body = planCreateBody({
    ...emptyPlanForm(TODAY),
    templateId: 't-1',
    teacherMembershipId: 'm-selin',
    observerMembershipId: 'm-mudur',
    durationMinutes: '80',
    note: '  ',
  })
  assert.deepEqual(body, {
    templateId: 't-1',
    teacherMembershipId: 'm-selin',
    observerMembershipId: 'm-mudur',
    plannedDate: TODAY,
    startTime: '09:00',
    durationMinutes: 80,
  })
  const linked = planCreateBody({
    ...emptyPlanForm(TODAY),
    templateId: 't-1',
    teacherMembershipId: 'm-selin',
    observerMembershipId: 'm-mudur',
    classId: 'c-7a',
    performancePeriodId: 'd-1',
    note: 'Soru teknikleri',
  })
  assert.equal(linked.classId, 'c-7a')
  assert.equal(linked.performancePeriodId, 'd-1')
  assert.equal(linked.note, 'Soru teknikleri')
})

test('DOM-FIN-139 K-472: düzeltme gövdesi yalnız değişenleri taşır; değişiklik yoksa null', () => {
  const current = plan()
  const values = planFormValues(current)
  assert.equal(planUpdateBody(values, current), null)
  assert.deepEqual(
    planUpdateBody({ ...values, startTime: '11:00', durationMinutes: '80' }, current),
    {
      startTime: '11:00',
      durationMinutes: 80,
    },
  )
  assert.deepEqual(planUpdateBody({ ...values, classId: '' }, current), { classId: '' })
  assert.deepEqual(
    planUpdateBody({ ...values, performancePeriodId: '' }, plan({ performancePeriodId: 'd-1' })),
    { performancePeriodId: null },
  )
  assert.deepEqual(
    planUpdateBody({ ...values, observerMembershipId: 'm-ayse', templateId: 't-2' }, current),
    { observerMembershipId: 'm-ayse', templateId: 't-2' },
  )
  assert.deepEqual(planUpdateBody({ ...values, note: 'Odak' }, current), { note: 'Odak' })
})

test('DOM-FIN-139 K-472: erteleme ve iptal formu gerekçe ister', () => {
  const values = postponeFormValues(plan())
  assert.equal(values.reason, '')
  assert.equal(postponeFormSchema.safeParse(values).success, false)
  const ready = { ...values, plannedDate: '2026-11-26', reason: 'Sınav haftası' }
  assert.equal(postponeFormSchema.safeParse(ready).success, true)
  assert.deepEqual(postponeBody(ready), {
    plannedDate: '2026-11-26',
    startTime: '09:40',
    durationMinutes: 40,
    reason: 'Sınav haftası',
  })
  assert.equal(cancelFormSchema.safeParse({ reason: 'x' }).success, false)
  assert.equal(cancelFormSchema.safeParse({ reason: 'Öğretmen izinli' }).success, true)
})

test('DOM-FIN-139 K-473: açık plan, başlatılabilirlik ve gün gruplaması', () => {
  assert.equal(isOpenPlan(plan()), true)
  assert.equal(isOpenPlan(plan({ status: 'postponed' })), true)
  assert.equal(isOpenPlan(plan({ status: 'done' })), false)
  assert.equal(isOpenPlan(plan({ status: 'cancelled' })), false)
  assert.equal(canStartPlan(plan({ plannedDate: TODAY }), TODAY), true)
  assert.equal(canStartPlan(plan({ plannedDate: '2026-11-20' }), TODAY), true)
  assert.equal(canStartPlan(plan(), TODAY), false, 'günü gelmemiş')
  assert.equal(canStartPlan(plan({ plannedDate: TODAY, observationId: 'o-1' }), TODAY), false)
  assert.equal(canStartPlan(plan({ plannedDate: TODAY, status: 'cancelled' }), TODAY), false)
  const groups = plansByDay([
    plan({ id: 'a', plannedDate: '2026-11-26' }),
    plan({ id: 'b', plannedDate: '2026-11-25' }),
    plan({ id: 'c', plannedDate: '2026-11-26' }),
  ])
  assert.deepEqual(
    groups.map((group) => [group.day, group.plans.map((item) => item.id)]),
    [
      ['2026-11-25', ['b']],
      ['2026-11-26', ['a', 'c']],
    ],
  )
  assert.equal(planTimeText(plan()), '09:40–10:20')
})
