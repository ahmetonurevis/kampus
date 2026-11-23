import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError, type DomainErrorKind } from '../packages/school-core/src/lib/errors.ts'
import {
  assertMealCancellationRestorable,
  assertMealSubscriptionArchivable,
  daysBetween,
  DEFAULT_MEAL_CUTOFF,
  holidayDays,
  isSubscribedDay,
  MEAL_DIET_TYPES,
  mealCancellationCreateSchema,
  mealCancellationDeadline,
  mealCutoffText,
  mealDailyCount,
  mealMonthSchema,
  mealMonthSummary,
  mealSubscriptionCalendar,
  mealSubscriptionCreateSchema,
  mealSubscriptionIssues,
  mealSubscriptionSettingsSchema,
  mealSubscriptionStatus,
  mealSubscriptionUpdateSchema,
  mealWeekdaysText,
  monthRange,
  planMealCancellations,
  planMealSubscriptionCreate,
  planMealSubscriptionSettings,
  planMealSubscriptionUpdate,
  type MealSubscriptionFields,
} from '../packages/school-core/src/lib/finance-meal-subscriptions.ts'

/**
 * Yemek aboneliği ve gün iptali kuralları (DOM-FIN-164; ON-150; K-547…K-549). Bugün 2026-10-07
 * çarşamba; saat 12:00 İstanbul (09:00 UTC). Varsayılan kesim bir gün önce 15:00.
 */

const TODAY = '2026-10-07'
const NOW = new Date('2026-10-07T09:00:00.000Z')
const CUTOFF = { ...DEFAULT_MEAL_CUTOFF }

function rejects(fn: () => unknown, code: string, kind: DomainErrorKind = 'rule') {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })
}

const input = (extra: Record<string, unknown> = {}) =>
  mealSubscriptionCreateSchema.parse({
    studentId: 's1',
    mealKind: 'lunch',
    startDate: '2026-10-12',
    endDate: '2026-12-31',
    weekdays: [5, 1, 3],
    dietType: 'standard',
    ...extra,
  })
const createChecks = (extra: Record<string, unknown> = {}) => ({
  today: TODAY,
  student: { active: true },
  enabledKinds: ['lunch' as const],
  existing: [],
  ...extra,
})
const fields = (extra: Partial<MealSubscriptionFields> = {}): MealSubscriptionFields => ({
  studentId: 's1',
  mealKind: 'lunch',
  startDate: '2026-10-01',
  endDate: '2026-12-31',
  weekdays: [1, 2, 3, 4, 5],
  dietType: 'standard',
  dietNote: null,
  ...extra,
})

describe('DOM-FIN-164: şemalar ve alan kuralları (K-547)', () => {
  test('DOM-FIN-164: oluşturma şeması diyet açıklamasını, tarih sırasını ve günleri denetler', () => {
    assert.equal(input().dietNote, undefined)
    const other = input({ dietType: 'other', dietNote: '  Domuz eti içermeyen ' })
    assert.equal(other.dietNote, 'Domuz eti içermeyen')
    const paths = (extra: Record<string, unknown>) =>
      mealSubscriptionCreateSchema
        .safeParse({
          studentId: 's1',
          mealKind: 'lunch',
          startDate: '2026-10-12',
          endDate: '2026-12-31',
          weekdays: [1],
          dietType: 'standard',
          ...extra,
        })
        .error?.issues.map((issue) => issue.path.join('.'))
    assert.deepEqual(paths({ dietType: 'other' }), ['dietNote'])
    assert.deepEqual(paths({ dietType: 'other', dietNote: 'x' }), ['dietNote'])
    assert.deepEqual(paths({ dietNote: 'Gerekmez' }), ['dietNote'])
    assert.deepEqual(paths({ endDate: '2026-10-11' }), ['endDate'])
    assert.deepEqual(paths({ endDate: '2027-10-13' }), ['endDate'])
    assert.deepEqual(paths({ weekdays: [] }), ['weekdays'])
    assert.deepEqual(paths({ weekdays: [1, 1] }), ['weekdays'])
    assert.deepEqual(paths({ weekdays: [8] }), ['weekdays.0'])
    assert.deepEqual(paths({ dietType: 'keto' }), ['dietType'])
    assert.deepEqual(paths({ mealKind: 'dinner' }), ['mealKind'])
    assert.deepEqual(paths({ institutionId: 'x' }), [''])
    assert.equal(paths({ endDate: '2027-10-12' }), undefined)
  })

  test('DOM-FIN-164: alan kuralları bütün hâlde döner', () => {
    assert.deepEqual(
      mealSubscriptionIssues({
        startDate: '2026-10-12',
        endDate: '2026-10-11',
        dietType: 'other',
        dietNote: null,
      }).map((issue) => issue.code),
      ['meal_subscription_end_before_start', 'meal_diet_note_required'],
    )
    assert.deepEqual(
      mealSubscriptionIssues({
        startDate: '2026-10-12',
        endDate: '2026-10-12',
        dietType: 'vegetarian',
        dietNote: '  ',
      }),
      [],
    )
  })

  test('DOM-FIN-164: düzenleme, iptal, ayar ve ay şemaları', () => {
    assert.equal(mealSubscriptionUpdateSchema.safeParse({}).success, false)
    assert.equal(mealSubscriptionUpdateSchema.safeParse({ endDate: '2026-11-30' }).success, true)
    assert.equal(mealSubscriptionUpdateSchema.safeParse({ mealKind: 'lunch' }).success, false)
    assert.equal(mealCancellationCreateSchema.safeParse({ dates: [] }).success, false)
    assert.equal(
      mealCancellationCreateSchema.safeParse({ dates: ['2026-10-12', '2026-10-12'] }).success,
      false,
    )
    assert.equal(
      mealCancellationCreateSchema.safeParse({
        dates: daysBetween('2026-10-01', '2026-11-01'),
      }).success,
      false,
    )
    assert.equal(
      mealSubscriptionSettingsSchema.safeParse({ cutoffDaysBefore: 0, cutoffTime: '09:30' })
        .success,
      true,
    )
    assert.equal(
      mealSubscriptionSettingsSchema.safeParse({ cutoffDaysBefore: 8, cutoffTime: '09:30' })
        .success,
      false,
    )
    assert.equal(
      mealSubscriptionSettingsSchema.safeParse({ cutoffDaysBefore: 1, cutoffTime: '24:00' })
        .success,
      false,
    )
    assert.equal(mealMonthSchema.safeParse('2026-10').success, true)
    assert.equal(mealMonthSchema.safeParse('2026-13').success, false)
  })
})

describe('DOM-FIN-164: abonelik açma, düzenleme ve silme (K-547)', () => {
  test('DOM-FIN-164: geçerli abonelik günleri sıralar, diyet açıklamasını yalnız diğerde tutar', () => {
    assert.deepEqual(planMealSubscriptionCreate(input(), createChecks()), {
      studentId: 's1',
      mealKind: 'lunch',
      startDate: '2026-10-12',
      endDate: '2026-12-31',
      weekdays: [1, 3, 5],
      dietType: 'standard',
      dietNote: null,
    })
    assert.equal(
      planMealSubscriptionCreate(
        input({ dietType: 'other', dietNote: 'Domuz eti içermeyen' }),
        createChecks(),
      ).dietNote,
      'Domuz eti içermeyen',
    )
    assert.equal(
      planMealSubscriptionCreate(input({ startDate: TODAY }), createChecks()).startDate,
      TODAY,
    )
  })

  test('DOM-FIN-164: öğrenci, öğün, başlangıç ve çakışma reddi', () => {
    rejects(
      () => planMealSubscriptionCreate(input(), createChecks({ student: null })),
      'meal_subscription_student_not_found',
    )
    rejects(
      () => planMealSubscriptionCreate(input(), createChecks({ student: { active: false } })),
      'meal_subscription_student_inactive',
    )
    rejects(
      () => planMealSubscriptionCreate(input({ mealKind: 'breakfast' }), createChecks()),
      'meal_kind_disabled',
    )
    rejects(
      () => planMealSubscriptionCreate(input({ startDate: '2026-10-06' }), createChecks()),
      'meal_subscription_start_past',
    )
    rejects(
      () =>
        planMealSubscriptionCreate(
          input({ startDate: '2027-10-09', endDate: '2027-10-20' }),
          createChecks(),
        ),
      'meal_subscription_start_too_far',
    )
    const existing = [
      { id: 'm1', mealKind: 'lunch' as const, startDate: '2026-09-01', endDate: '2026-10-12' },
    ]
    rejects(
      () => planMealSubscriptionCreate(input(), createChecks({ existing })),
      'meal_subscription_overlap',
      'conflict',
    )
    // Başka öğün ya da değmeyen tarih çakışma değildir.
    assert.ok(
      planMealSubscriptionCreate(input({ startDate: '2026-10-13' }), createChecks({ existing })),
    )
    assert.ok(
      planMealSubscriptionCreate(
        input({ mealKind: 'snack' }),
        createChecks({ existing, enabledKinds: ['lunch', 'snack'] }),
      ),
    )
  })

  test('DOM-FIN-164: başlamış abonelikte yalnız bitiş günü, bugünden önceye çekilmez', () => {
    const current = fields()
    const checks = { today: TODAY, existing: [] }
    assert.deepEqual(planMealSubscriptionUpdate(current, { endDate: TODAY }, checks), {
      values: {
        startDate: '2026-10-01',
        endDate: TODAY,
        weekdays: [1, 2, 3, 4, 5],
        dietType: 'standard',
        dietNote: null,
      },
      changed: ['endDate'],
    })
    rejects(
      () => planMealSubscriptionUpdate(current, { endDate: '2026-10-06' }, checks),
      'meal_subscription_end_past',
    )
    rejects(
      () => planMealSubscriptionUpdate(current, { dietType: 'vegetarian' }, checks),
      'meal_subscription_started',
    )
    rejects(
      () => planMealSubscriptionUpdate(current, { weekdays: [1] }, checks),
      'meal_subscription_started',
    )
    rejects(
      () => planMealSubscriptionUpdate(current, { endDate: current.endDate }, checks),
      'meal_subscription_unchanged',
    )
    rejects(
      () =>
        planMealSubscriptionUpdate(fields({ endDate: '2026-10-06' }), { endDate: TODAY }, checks),
      'meal_subscription_ended',
    )
    rejects(
      () =>
        planMealSubscriptionUpdate(
          current,
          { endDate: '2027-01-31' },
          {
            today: TODAY,
            existing: [
              { id: 'm2', mealKind: 'lunch', startDate: '2027-01-10', endDate: '2027-02-10' },
            ],
          },
        ),
      'meal_subscription_overlap',
      'conflict',
    )
  })

  test('DOM-FIN-164: başlamamış abonelikte her alan değişir, sonuç bütün olarak doğrulanır', () => {
    const upcoming = fields({ startDate: '2026-10-12', dietType: 'other', dietNote: 'Helal' })
    const checks = { today: TODAY, existing: [] }
    const plan = planMealSubscriptionUpdate(
      upcoming,
      { dietType: 'vegetarian', weekdays: [3, 1] },
      checks,
    )
    assert.deepEqual(plan.values.weekdays, [1, 3])
    assert.equal(plan.values.dietNote, null)
    assert.deepEqual(plan.changed, ['weekdays', 'dietType', 'dietNote'])
    assert.equal(
      planMealSubscriptionUpdate(upcoming, { dietNote: 'Helal et' }, checks).values.dietNote,
      'Helal et',
    )
    rejects(
      () => planMealSubscriptionUpdate(upcoming, { startDate: '2026-10-06' }, checks),
      'meal_subscription_start_past',
    )
    rejects(
      () => planMealSubscriptionUpdate(upcoming, { endDate: '2026-10-11' }, checks),
      'meal_subscription_end_before_start',
    )
    rejects(
      () => planMealSubscriptionUpdate(upcoming, { dietNote: null }, checks),
      'meal_diet_note_required',
    )
    rejects(
      () => planMealSubscriptionUpdate(upcoming, { dietType: 'standard', dietNote: 'x' }, checks),
      'meal_diet_note_not_allowed',
    )
  })

  test('DOM-FIN-164: yalnız başlamamış abonelik silinir', () => {
    assert.doesNotThrow(() => assertMealSubscriptionArchivable({ startDate: '2026-10-08' }, TODAY))
    rejects(
      () => assertMealSubscriptionArchivable({ startDate: TODAY }, TODAY),
      'meal_subscription_started',
    )
  })

  test('DOM-FIN-164: durum, yemek günü ve metinler', () => {
    assert.equal(
      mealSubscriptionStatus({ startDate: '2026-10-08', endDate: '2026-10-09' }, TODAY),
      'upcoming',
    )
    assert.equal(mealSubscriptionStatus({ startDate: TODAY, endDate: TODAY }, TODAY), 'active')
    assert.equal(
      mealSubscriptionStatus({ startDate: '2026-10-01', endDate: '2026-10-06' }, TODAY),
      'ended',
    )
    const sub = { startDate: '2026-10-05', endDate: '2026-10-16', weekdays: [1, 3] }
    assert.equal(isSubscribedDay(sub, '2026-10-05'), true)
    assert.equal(isSubscribedDay(sub, '2026-10-06'), false)
    assert.equal(isSubscribedDay(sub, '2026-10-19'), false)
    assert.equal(mealWeekdaysText([5, 1, 3]), 'Pzt, Çar, Cum')
    assert.equal(mealWeekdaysText([1, 2, 3, 4, 5]), 'Hafta içi')
    assert.equal(mealWeekdaysText([1, 2, 3, 4, 5, 6, 7]), 'Her gün')
    assert.equal(mealCutoffText(CUTOFF), 'Bir gün önce, saat 15:00')
    assert.equal(
      mealCutoffText({ cutoffDaysBefore: 0, cutoffTime: '09:00' }),
      'Aynı gün, saat 09:00',
    )
    assert.equal(
      mealCutoffText({ cutoffDaysBefore: 2, cutoffTime: '12:00' }),
      '2 gün önce, saat 12:00',
    )
    assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' })
    assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' })
    assert.deepEqual(
      [
        ...holidayDays(
          [{ title: 'Ara tatil', startDate: '2026-10-28', endDate: '2026-11-02' }],
          '2026-10-01',
          '2026-10-31',
        ),
      ],
      [
        ['2026-10-28', 'Ara tatil'],
        ['2026-10-29', 'Ara tatil'],
        ['2026-10-30', 'Ara tatil'],
        ['2026-10-31', 'Ara tatil'],
      ],
    )
  })
})

describe('DOM-FIN-164: gün iptali ve kesim (K-548)', () => {
  const sub = { startDate: '2026-10-01', endDate: '2026-12-31', weekdays: [1, 2, 3, 4, 5] }
  const cancelChecks = (extra: Record<string, unknown> = {}) => ({
    now: NOW,
    today: TODAY,
    by: 'family' as const,
    cutoff: CUTOFF,
    holidays: new Map<string, string>(),
    cancelled: new Set<string>(),
    ...extra,
  })

  test('DOM-FIN-164: kesim anı İstanbul saatiyle bir gün önce 15:00', () => {
    assert.equal(mealCancellationDeadline('2026-10-08', CUTOFF), '2026-10-07T12:00:00.000Z')
    assert.equal(
      mealCancellationDeadline('2026-10-08', { cutoffDaysBefore: 0, cutoffTime: '09:30' }),
      '2026-10-08T06:30:00.000Z',
    )
  })

  test('DOM-FIN-164: veli kesimden önce iptal eder; günler sıralanır', () => {
    assert.deepEqual(
      planMealCancellations(sub, { dates: ['2026-10-09', '2026-10-08'] }, cancelChecks()),
      [
        { mealDate: '2026-10-08', late: false },
        { mealDate: '2026-10-09', late: false },
      ],
    )
  })

  test('DOM-FIN-164: kesimden sonra veli reddedilir, okulun iptali geç iptaldir', () => {
    const after = new Date('2026-10-07T12:00:00.000Z')
    rejects(
      () => planMealCancellations(sub, { dates: ['2026-10-08'] }, cancelChecks({ now: after })),
      'meal_cancellation_cutoff_passed',
    )
    assert.deepEqual(
      planMealCancellations(
        sub,
        { dates: ['2026-10-08', TODAY] },
        cancelChecks({ now: after, by: 'school' }),
      ),
      [
        { mealDate: TODAY, late: true },
        { mealDate: '2026-10-08', late: true },
      ],
    )
  })

  test('DOM-FIN-164: yemek günü olmayan, tatil, geçmiş ve iptal edilmiş gün reddedilir', () => {
    rejects(
      () => planMealCancellations(sub, { dates: ['2026-10-10'] }, cancelChecks()),
      'meal_day_not_subscribed',
    )
    rejects(
      () =>
        planMealCancellations(
          sub,
          { dates: ['2026-10-29'] },
          cancelChecks({ holidays: new Map([['2026-10-29', 'Cumhuriyet Bayramı']]) }),
        ),
      'meal_day_holiday',
    )
    rejects(
      () => planMealCancellations(sub, { dates: ['2026-10-06'] }, cancelChecks({ by: 'school' })),
      'meal_day_past',
    )
    rejects(
      () =>
        planMealCancellations(
          sub,
          { dates: ['2026-10-09'] },
          cancelChecks({ cancelled: new Set(['2026-10-09']) }),
        ),
      'meal_day_already_cancelled',
      'conflict',
    )
  })

  test('DOM-FIN-164: geri alma veli için kesime, okul için güne bağlı', () => {
    const restore = (mealDate: string, extra: Record<string, unknown> = {}) =>
      assertMealCancellationRestorable(
        { mealDate },
        { now: NOW, today: TODAY, by: 'family', cutoff: CUTOFF, ...extra },
      )
    assert.doesNotThrow(() => restore('2026-10-08'))
    rejects(() => restore(TODAY), 'meal_cancellation_cutoff_passed')
    assert.doesNotThrow(() => restore(TODAY, { by: 'school' }))
    rejects(() => restore('2026-10-06', { by: 'school' }), 'meal_day_past')
  })

  test('DOM-FIN-164: abonelik takvimi gün durumunu ve iptal bayraklarını verir', () => {
    const cancellations = [
      { id: 'x1', mealDate: '2026-10-09', late: false, cancelledBy: 'family' as const, version: 1 },
      { id: 'x2', mealDate: TODAY, late: true, cancelledBy: 'school' as const, version: 1 },
    ]
    const checks = {
      now: NOW,
      today: TODAY,
      by: 'family' as const,
      cutoff: CUTOFF,
      holidays: new Map([['2026-10-12', 'Tatil']]),
      cancellations,
    }
    const days = mealSubscriptionCalendar(
      { ...sub, startDate: '2026-10-06' },
      { from: '2026-10-05', to: '2026-10-13' },
      checks,
    )
    assert.deepEqual(
      days.map((day) => [day.mealDate, day.status, day.canCancel, day.canRestore]),
      [
        ['2026-10-06', 'scheduled', false, false],
        [TODAY, 'late_cancelled', false, false],
        ['2026-10-08', 'scheduled', true, false],
        ['2026-10-09', 'cancelled', false, true],
        ['2026-10-12', 'holiday', false, false],
        ['2026-10-13', 'scheduled', true, false],
      ],
    )
    assert.equal(days[1]?.cancellation?.id, 'x2')
    assert.equal(days[4]?.holidayTitle, 'Tatil')
    const school = mealSubscriptionCalendar(
      sub,
      { from: TODAY, to: '2026-10-08' },
      {
        ...checks,
        by: 'school',
      },
    )
    assert.deepEqual(
      school.map((day) => [day.status, day.canCancel, day.canRestore]),
      [
        ['late_cancelled', false, true],
        ['scheduled', true, false],
      ],
    )
    assert.deepEqual(
      mealSubscriptionCalendar(sub, { from: '2027-01-01', to: '2027-01-10' }, checks),
      [],
    )
  })

  test('DOM-FIN-164: kesim ayarı değişiklik ister', () => {
    assert.deepEqual(
      planMealSubscriptionSettings(CUTOFF, { cutoffDaysBefore: 0, cutoffTime: '09:00' }),
      { cutoffDaysBefore: 0, cutoffTime: '09:00' },
    )
    rejects(
      () => planMealSubscriptionSettings(CUTOFF, { ...CUTOFF }),
      'meal_subscription_settings_unchanged',
    )
  })
})

describe('DOM-FIN-164: günlük mutfak sayısı ve aylık özet (K-549)', () => {
  const base = {
    mealKind: 'lunch' as const,
    startDate: '2026-10-01',
    endDate: '2026-12-31',
    weekdays: [1, 2, 3, 4, 5] as const,
  }
  const subs = [
    {
      ...base,
      id: 'a',
      classId: 'c1',
      dietType: 'standard' as const,
      weekdays: [...base.weekdays],
    },
    {
      ...base,
      id: 'b',
      classId: 'c1',
      dietType: 'vegetarian' as const,
      weekdays: [...base.weekdays],
    },
    {
      ...base,
      id: 'c',
      classId: 'c9',
      dietType: 'gluten_free' as const,
      weekdays: [...base.weekdays],
    },
    {
      ...base,
      id: 'd',
      classId: null,
      dietType: 'standard' as const,
      weekdays: [...base.weekdays],
    },
    {
      ...base,
      id: 'e',
      classId: 'c9',
      dietType: 'standard' as const,
      weekdays: [...base.weekdays],
    },
    { ...base, id: 'f', classId: 'c9', dietType: 'standard' as const, weekdays: [6] },
    {
      ...base,
      id: 'g',
      classId: 'c1',
      dietType: 'standard' as const,
      mealKind: 'snack' as const,
      weekdays: [...base.weekdays],
    },
  ]
  const diet = (row: { diets: { dietType: string; count: number }[] } | undefined) =>
    Object.fromEntries((row?.diets ?? []).map((item) => [item.dietType, item.count]))

  test('DOM-FIN-164: gün × öğün × diyet, iptaller düşülür, sınıf kırılımı', () => {
    const count = mealDailyCount(TODAY, subs, {
      mealKinds: ['lunch', 'snack'],
      holidayTitle: null,
      cancellations: [
        { subscriptionId: 'd', late: false },
        { subscriptionId: 'e', late: true },
      ],
    })
    const lunch = count.meals.find((row) => row.mealKind === 'lunch')
    assert.equal(lunch?.total, 3)
    assert.equal(lunch?.cancelled, 1)
    assert.equal(lunch?.lateCancelled, 1)
    assert.deepEqual(diet(lunch), {
      standard: 1,
      vegetarian: 1,
      gluten_free: 1,
      lactose_free: 0,
      other: 0,
    })
    assert.deepEqual(
      lunch?.diets.map((row) => row.dietType),
      [...MEAL_DIET_TYPES],
    )
    assert.equal(count.meals.find((row) => row.mealKind === 'snack')?.total, 1)
    const c1 = count.classes.find((row) => row.classId === 'c1')
    assert.deepEqual(
      c1?.meals.map((row) => [row.mealKind, row.total]),
      [
        ['lunch', 2],
        ['snack', 1],
      ],
    )
    assert.equal(count.classes.find((row) => row.classId === 'c9')?.meals[0]?.total, 1)
    assert.equal(
      count.classes.some((row) => row.classId === null),
      false,
    )
  })

  test('DOM-FIN-164: tatil gününde sayı sıfır, kapalı öğün sayılmaz', () => {
    const holiday = mealDailyCount(TODAY, subs, {
      mealKinds: ['lunch'],
      holidayTitle: 'Tatil',
      cancellations: [],
    })
    assert.equal(holiday.holidayTitle, 'Tatil')
    assert.equal(holiday.meals[0]?.total, 0)
    assert.deepEqual(holiday.classes, [])
    const lunchOnly = mealDailyCount(TODAY, subs, {
      mealKinds: ['lunch'],
      holidayTitle: null,
      cancellations: [],
    })
    assert.deepEqual(
      lunchOnly.meals.map((row) => row.mealKind),
      ['lunch'],
    )
    assert.equal(lunchOnly.meals[0]?.total, 5)
    assert.deepEqual(
      lunchOnly.classes.find((row) => row.classId === null)?.meals.map((row) => row.total),
      [1],
    )
  })

  test('DOM-FIN-164: aylık özet abone, tatil, iptal, geç iptal ve iade günü', () => {
    const summary = mealMonthSummary(
      '2026-10',
      { startDate: '2026-10-05', endDate: '2026-12-31', weekdays: [1, 2, 3, 4, 5] },
      {
        holidays: new Map([
          ['2026-10-29', 'Cumhuriyet Bayramı'],
          ['2026-10-31', 'Hafta sonu tatili'],
        ]),
        cancellations: [
          { mealDate: '2026-10-08', late: false },
          { mealDate: '2026-10-09', late: false },
          { mealDate: '2026-10-12', late: true },
          // Aralık dışı iptal sayılmaz.
          { mealDate: '2026-11-02', late: false },
        ],
      },
    )
    assert.deepEqual(summary, {
      subscribedDays: 19,
      holidayDays: 1,
      cancelledDays: 2,
      lateCancelledDays: 1,
      mealDays: 16,
      refundableDays: 2,
    })
    assert.deepEqual(
      mealMonthSummary(
        '2026-09',
        { startDate: '2026-10-05', endDate: '2026-12-31', weekdays: [1] },
        {
          holidays: new Map(),
          cancellations: [],
        },
      ).subscribedDays,
      0,
    )
  })
})
