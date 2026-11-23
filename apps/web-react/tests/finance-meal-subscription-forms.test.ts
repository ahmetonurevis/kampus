import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  MealDailyCount,
  MealSubscriptionDay,
  MealSubscriptionRow,
} from '@kampus/react-shared/use-finance-meal-subscriptions.ts'

import {
  cancelledText,
  classMealTotal,
  countMealKinds,
  cutoffBody,
  cutoffFormSchema,
  dayStatusText,
  dietCountsText,
  dietText,
  firstCancellable,
  monthText,
  onlyEndDate,
  periodText,
  shiftMonth,
  subscriptionCreateBody,
  subscriptionDefaults,
  subscriptionFormField,
  subscriptionFormSchema,
  subscriptionUpdateBody,
} from '../src/pages/finance/finance-meal-subscription-forms.ts'

// Yemek aboneliği sekmesinin saf mantığı (DOM-FIN-164; ON-150; K-547…K-549).

const TODAY = '2026-10-06'

const row = (extra: Partial<MealSubscriptionRow> = {}): MealSubscriptionRow => ({
  id: 'abonelik-1',
  studentId: 's1',
  studentName: 'Deniz Yılmaz',
  classId: 'c1',
  className: '7-A',
  mealKind: 'lunch',
  startDate: '2026-10-12',
  endDate: '2026-12-31',
  weekdays: [1, 2, 3, 4, 5],
  dietType: 'standard',
  dietNote: null,
  status: 'upcoming',
  version: 3,
  ...extra,
})

test('DOM-FIN-164: varsayılan yarından okul yılı sonuna hafta içi öğle yemeği', () => {
  assert.deepEqual(subscriptionDefaults(TODAY, ['breakfast', 'lunch']), {
    studentId: '',
    mealKind: 'lunch',
    startDate: '2026-10-07',
    endDate: '2027-06-30',
    weekdays: [1, 2, 3, 4, 5],
    dietType: 'standard',
    dietNote: '',
  })
  assert.equal(subscriptionDefaults('2027-03-01', ['snack']).endDate, '2027-06-30')
  assert.equal(subscriptionDefaults(TODAY, ['snack']).mealKind, 'snack')
  assert.equal(subscriptionDefaults(TODAY, [], row({ dietNote: 'Helal' })).dietNote, 'Helal')
})

test('DOM-FIN-164: form şeması diyet açıklamasını ve tarih sırasını denetler (K-547)', () => {
  const values = { ...subscriptionDefaults(TODAY, ['lunch']), studentId: 's1' }
  assert.equal(subscriptionFormSchema.safeParse(values).success, true)
  const paths = (extra: Record<string, unknown>) =>
    subscriptionFormSchema
      .safeParse({ ...values, ...extra })
      .error?.issues.map((issue) => issue.path.join('.'))
  assert.deepEqual(paths({ dietType: 'other' }), ['dietNote'])
  assert.deepEqual(paths({ endDate: '2026-10-06' }), ['endDate'])
  assert.deepEqual(paths({ weekdays: [] }), ['weekdays'])
  assert.deepEqual(paths({ studentId: '' }), ['studentId'])
  // Diğer olmayan diyette eski açıklama yok sayılır.
  assert.equal(paths({ dietNote: 'Kalan metin' }), undefined)
})

test('DOM-FIN-164: oluşturma gövdesi günleri sıralar, açıklamayı yalnız diğerde gönderir', () => {
  const values = {
    ...subscriptionDefaults(TODAY, ['lunch']),
    studentId: 's1',
    weekdays: [5, 1],
    dietNote: 'Kalan',
  }
  assert.deepEqual(subscriptionCreateBody(values), {
    studentId: 's1',
    mealKind: 'lunch',
    startDate: '2026-10-07',
    endDate: '2027-06-30',
    weekdays: [1, 5],
    dietType: 'standard',
    dietNote: null,
  })
  assert.equal(
    subscriptionCreateBody({ ...values, dietType: 'other', dietNote: ' Helal ' }).dietNote,
    'Helal',
  )
})

test('DOM-FIN-164: düzenleme gövdesi değişen alanlar; başlamış abonelikte yalnız bitiş', () => {
  const upcoming = row()
  const values = subscriptionDefaults(TODAY, ['lunch'], upcoming)
  assert.equal(subscriptionUpdateBody(values, upcoming, TODAY), null)
  assert.deepEqual(
    subscriptionUpdateBody(
      { ...values, weekdays: [3, 1], dietType: 'other', dietNote: 'Helal' },
      upcoming,
      TODAY,
    ),
    { weekdays: [1, 3], dietType: 'other', dietNote: 'Helal' },
  )
  const active = row({ startDate: '2026-10-01', status: 'active' })
  assert.equal(onlyEndDate(active, TODAY), true)
  assert.equal(onlyEndDate(upcoming, TODAY), false)
  assert.deepEqual(
    subscriptionUpdateBody(
      { ...subscriptionDefaults(TODAY, ['lunch'], active), endDate: '2026-11-30', weekdays: [1] },
      active,
      TODAY,
    ),
    { endDate: '2026-11-30' },
  )
  assert.equal(subscriptionFormField('weekdays.0'), 'weekdays')
  assert.equal(subscriptionFormField('dietNote'), 'dietNote')
  assert.equal(subscriptionFormField('institutionId'), null)
})

test('DOM-FIN-164: kesim formu ve metinler (K-548)', () => {
  assert.equal(
    cutoffFormSchema.safeParse({ cutoffDaysBefore: '8', cutoffTime: '15:00' }).success,
    false,
  )
  assert.equal(
    cutoffFormSchema.safeParse({ cutoffDaysBefore: '1', cutoffTime: '25:00' }).success,
    false,
  )
  assert.deepEqual(cutoffBody({ cutoffDaysBefore: ' 0 ', cutoffTime: '09:30' }), {
    cutoffDaysBefore: 0,
    cutoffTime: '09:30',
  })
  assert.equal(dietText(row()), 'Normal')
  assert.equal(dietText(row({ dietType: 'other', dietNote: 'Helal' })), 'Diğer: Helal')
  assert.match(periodText(row()), /Hafta içi$/)
  assert.equal(monthText('2026-10'), 'Ekim 2026')
  assert.equal(shiftMonth('2026-12', 1), '2027-01')
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  const day = (extra: Partial<MealSubscriptionDay>): MealSubscriptionDay => ({
    mealDate: '2026-10-07',
    status: 'scheduled',
    holidayTitle: null,
    deadline: '2026-10-06T12:00:00.000Z',
    canCancel: false,
    canRestore: false,
    cancellation: null,
    ...extra,
  })
  assert.equal(dayStatusText(day({ status: 'holiday', holidayTitle: 'Bayram' })), 'Tatil: Bayram')
  assert.equal(dayStatusText(day({ status: 'late_cancelled' })), 'Geç iptal')
  assert.equal(
    firstCancellable([day({}), day({ mealDate: '2026-10-08', canCancel: true })]),
    '2026-10-08',
  )
  assert.equal(firstCancellable([day({})]), '')
})

test('DOM-FIN-164: sayım metinleri ve sınıf kırılımı (K-549)', () => {
  const diets = [
    { dietType: 'standard' as const, count: 12 },
    { dietType: 'vegetarian' as const, count: 0 },
    { dietType: 'gluten_free' as const, count: 2 },
  ]
  assert.equal(dietCountsText(diets), 'Normal 12 · Glütensiz 2')
  assert.equal(dietCountsText([]), '—')
  assert.equal(cancelledText({ cancelled: 2, lateCancelled: 1 }), '2 iptal · 1 geç iptal')
  assert.equal(cancelledText({ cancelled: 0, lateCancelled: 0 }), '')
  const count: MealDailyCount = {
    date: TODAY,
    holidayTitle: null,
    meals: [
      { mealKind: 'lunch', total: 14, cancelled: 2, lateCancelled: 1, diets },
      { mealKind: 'snack', total: 0, cancelled: 0, lateCancelled: 0, diets: [] },
    ],
    classes: [
      { classId: 'c1', className: '7-A', meals: [{ mealKind: 'lunch', total: 14, diets }] },
    ],
  }
  assert.deepEqual(countMealKinds(count), ['lunch', 'snack'])
  const [entry] = count.classes
  assert.ok(entry)
  assert.equal(classMealTotal(entry, 'lunch'), 14)
  assert.equal(classMealTotal(entry, 'snack'), 0)
})
