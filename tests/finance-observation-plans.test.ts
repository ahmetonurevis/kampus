import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canViewObservationPlan,
  isObservationPlanOverdue,
  minutesOf,
  OBSERVATION_PLAN_DURATION_DEFAULT,
  OBSERVATION_PLAN_MANAGE_ROLES,
  OBSERVATION_PLAN_READ_ROLES,
  OBSERVATION_PLANS_PER_PERIOD_MAX,
  observationPlanCancelSchema,
  observationPlanCreateSchema,
  observationPlanPostponeSchema,
  observationPlanStartSchema,
  observationPlanUpdateSchema,
  planEndTime,
  planObservationPlan,
  planObservationPlanCancel,
  planObservationPlanPostpone,
  planObservationPlanStart,
  planObservationPlanUpdate,
  slotsOverlap,
  timeOf,
  type BusyPlan,
  type ObservationPlanChecks,
  type ObservationPlanState,
  type ObservationPlanUpdateChecks,
} from '../packages/school-core/src/lib/finance-observation-plans.ts'

import { isDomainError } from './support/domain-error.ts'

// Ders gözlem planı (DOM-FIN-139; ON-207). Kararlar K-472…K-474.

const TODAY = '2026-11-23'
const TEMPLATE_ID = '7b0f2a3e-4c1d-4e5f-8a9b-0c1d2e3f4a5b'
const PERIOD_ID = '1a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d'
const input = (patch: Record<string, unknown> = {}) =>
  observationPlanCreateSchema.parse({
    teacherMembershipId: 'm-selin',
    observerMembershipId: 'm-mudur',
    templateId: TEMPLATE_ID,
    plannedDate: '2026-11-25',
    startTime: '09:40',
    ...patch,
  })
const checks = (patch: Partial<ObservationPlanChecks> = {}): ObservationPlanChecks => ({
  template: { archived: false, versionId: 'v-1' },
  teacher: { membershipId: 'm-selin', role: 'ogretmen', active: true },
  observer: { membershipId: 'm-mudur', role: 'yonetici', active: true },
  classFound: null,
  subjectFound: null,
  period: undefined,
  teacherPlansInPeriod: 0,
  busy: [],
  today: TODAY,
  ...patch,
})
const busy = (patch: Partial<BusyPlan> = {}): BusyPlan => ({
  id: 'p-other',
  teacherMembershipId: 'm-murat',
  observerMembershipId: 'm-mudur',
  plannedDate: '2026-11-25',
  startTime: '09:00',
  durationMinutes: 40,
  ...patch,
})
const OPEN_PERIOD = { status: 'active' as const, startDate: '2026-09-01', endDate: '2027-01-31' }
const state = (patch: Partial<ObservationPlanState> = {}): ObservationPlanState => ({
  status: 'planned',
  observationId: null,
  teacherMembershipId: 'm-selin',
  observerMembershipId: 'm-mudur',
  performancePeriodId: null,
  plannedDate: '2026-11-25',
  startTime: '09:40',
  durationMinutes: 40,
  ...patch,
})
const updateChecks = (
  patch: Partial<ObservationPlanUpdateChecks> = {},
): ObservationPlanUpdateChecks => ({
  teacher: { membershipId: 'm-selin', role: 'ogretmen', active: true },
  observer: { membershipId: 'm-mudur', role: 'yonetici', active: true },
  classFound: null,
  subjectFound: null,
  period: undefined,
  teacherPlansInPeriod: 0,
  busy: [],
  today: TODAY,
  ...patch,
})

test('DOM-FIN-139: rol listeleri; yazma yalnız yönetici, okuma yönetici ve öğretmen', () => {
  assert.deepEqual(OBSERVATION_PLAN_MANAGE_ROLES, ['yonetici'])
  assert.deepEqual(OBSERVATION_PLAN_READ_ROLES, ['yonetici', 'ogretmen'])
})

test('DOM-FIN-139: saat yardımcıları ve aralık kesişimi', () => {
  assert.equal(minutesOf('09:40'), 580)
  assert.equal(timeOf(580), '09:40')
  assert.equal(planEndTime('09:40', 40), '10:20')
  const a = { plannedDate: '2026-11-25', startTime: '09:00', durationMinutes: 40 }
  assert.equal(slotsOverlap(a, { ...a, startTime: '09:39' }), true)
  assert.equal(slotsOverlap(a, { ...a, startTime: '09:40' }), false, 'uç uca değen kesişmez')
  assert.equal(slotsOverlap(a, { ...a, startTime: '08:30' }), true)
  assert.equal(slotsOverlap(a, { ...a, plannedDate: '2026-11-26' }), false)
})

test('DOM-FIN-139 K-472: şema varsayılan süre, saat biçimi, gün sonu ve fazla alan', () => {
  assert.equal(input().durationMinutes, OBSERVATION_PLAN_DURATION_DEFAULT)
  assert.equal(input({ note: '  ' }).note, null)
  assert.equal(input({ classId: '' }).classId, null)
  assert.equal(
    observationPlanCreateSchema.safeParse({ ...input(), startTime: '9:40' }).success,
    false,
  )
  assert.equal(
    observationPlanCreateSchema.safeParse({ ...input(), startTime: '24:00' }).success,
    false,
  )
  assert.equal(
    observationPlanCreateSchema.safeParse({ ...input(), startTime: '23:30', durationMinutes: 40 })
      .success,
    false,
  )
  assert.equal(
    observationPlanCreateSchema.safeParse({ ...input(), durationMinutes: 5 }).success,
    false,
  )
  assert.equal(
    observationPlanCreateSchema.safeParse({ ...input(), institutionId: 'x' }).success,
    false,
  )
  assert.equal(observationPlanUpdateSchema.safeParse({}).success, false)
  assert.equal(observationPlanUpdateSchema.safeParse({ note: 'Odak' }).success, true)
  assert.equal(
    observationPlanPostponeSchema.safeParse({ plannedDate: '2026-11-26', startTime: '10:00' })
      .success,
    false,
    'gerekçesiz erteleme',
  )
  assert.equal(
    observationPlanPostponeSchema.safeParse({
      plannedDate: '2026-11-26',
      startTime: '23:50',
      durationMinutes: 40,
      reason: 'Sınav haftası',
    }).success,
    false,
  )
  assert.equal(observationPlanCancelSchema.safeParse({ reason: 'x' }).success, false)
  assert.equal(observationPlanStartSchema.safeParse({ extra: 1 }).success, false)
})

test('DOM-FIN-139 K-472: geçerli plan formun son sürümünü ve alanları döner', () => {
  const plan = planObservationPlan(
    input({ classId: 'c-7a', note: 'Soru teknikleri' }),
    checks({ classFound: true }),
  )
  assert.deepEqual(plan, {
    teacherMembershipId: 'm-selin',
    observerMembershipId: 'm-mudur',
    templateVersionId: 'v-1',
    plannedDate: '2026-11-25',
    startTime: '09:40',
    durationMinutes: 40,
    classId: 'c-7a',
    subjectId: null,
    performancePeriodId: null,
    note: 'Soru teknikleri',
  })
  assert.doesNotThrow(() => planObservationPlan(input({ plannedDate: TODAY }), checks()))
})

test('DOM-FIN-139 K-472: form, kişi ve kayıt bağı DOM-FIN-130 kurallarıyla reddedilir', () => {
  assert.throws(
    () => planObservationPlan(input(), checks({ template: null })),
    isDomainError('observation_template_not_found'),
  )
  assert.throws(
    () => planObservationPlan(input(), checks({ template: { archived: true, versionId: 'v' } })),
    isDomainError('observation_template_archived', 'conflict'),
  )
  assert.throws(
    () =>
      planObservationPlan(
        input({ observerMembershipId: 'm-selin' }),
        checks({ observer: { membershipId: 'm-selin', role: 'ogretmen', active: true } }),
      ),
    isDomainError('observation_self'),
  )
  assert.throws(
    () =>
      planObservationPlan(
        input(),
        checks({ teacher: { membershipId: 'm-selin', role: 'ogretmen', active: false } }),
      ),
    isDomainError('observation_teacher_inactive'),
  )
  assert.throws(
    () =>
      planObservationPlan(
        input(),
        checks({ observer: { membershipId: 'm-mudur', role: 'onburo', active: true } }),
      ),
    isDomainError('observation_observer_invalid'),
  )
  assert.throws(
    () => planObservationPlan(input({ subjectId: 's-x' }), checks({ subjectFound: false })),
    isDomainError('observation_subject_not_found'),
  )
})

test('DOM-FIN-139 K-472: geçmiş güne plan açılmaz (İstanbul günü)', () => {
  assert.throws(
    () => planObservationPlan(input({ plannedDate: '2026-11-22' }), checks()),
    isDomainError('observation_plan_date_past'),
  )
})

test('DOM-FIN-139 K-472: dönem kapalı, gün dönem dışı ve dönem başına sınır', () => {
  const linked = input({ performancePeriodId: PERIOD_ID })
  assert.throws(
    () => planObservationPlan(linked, checks({ period: null })),
    isDomainError('observation_period_not_found'),
  )
  assert.throws(
    () => planObservationPlan(linked, checks({ period: { ...OPEN_PERIOD, status: 'closed' } })),
    isDomainError('observation_period_closed'),
  )
  assert.throws(
    () =>
      planObservationPlan(linked, checks({ period: { ...OPEN_PERIOD, endDate: '2026-11-24' } })),
    isDomainError('observation_plan_outside_period'),
  )
  assert.doesNotThrow(() =>
    planObservationPlan(
      linked,
      checks({ period: OPEN_PERIOD, teacherPlansInPeriod: OBSERVATION_PLANS_PER_PERIOD_MAX - 1 }),
    ),
  )
  assert.throws(
    () =>
      planObservationPlan(
        linked,
        checks({ period: OPEN_PERIOD, teacherPlansInPeriod: OBSERVATION_PLANS_PER_PERIOD_MAX }),
      ),
    isDomainError('observation_plan_limit'),
  )
  // Döneme bağlanmayan plan sınıra girmez.
  assert.doesNotThrow(() => planObservationPlan(input(), checks({ teacherPlansInPeriod: 99 })))
})

test('DOM-FIN-139 K-472: gözlemcinin ve gözlenenin aynı saatte iki planı olamaz', () => {
  assert.throws(
    () => planObservationPlan(input(), checks({ busy: [busy({ startTime: '09:30' })] })),
    isDomainError('observation_plan_observer_busy'),
  )
  // Gözlemci o saatte başka planda gözlenen öğretmen.
  assert.throws(
    () =>
      planObservationPlan(
        input(),
        checks({
          busy: [
            busy({
              teacherMembershipId: 'm-mudur',
              observerMembershipId: 'm-ayse',
              startTime: '10:00',
            }),
          ],
        }),
      ),
    isDomainError('observation_plan_observer_busy'),
  )
  assert.throws(
    () =>
      planObservationPlan(
        input(),
        checks({
          busy: [
            busy({
              teacherMembershipId: 'm-selin',
              observerMembershipId: 'm-ayse',
              startTime: '10:00',
            }),
          ],
        }),
      ),
    isDomainError('observation_plan_teacher_busy'),
  )
  // Bitişik saat ve başka kişiler çakışmaz.
  assert.doesNotThrow(() =>
    planObservationPlan(
      input(),
      checks({
        busy: [busy({ startTime: '09:00' }), busy({ observerMembershipId: 'm-ayse' })],
      }),
    ),
  )
})

test('DOM-FIN-139 K-472: düzeltme; gün, saat ya da gözlemci değişince bildirim ve yeniden denetim', () => {
  const note = planObservationPlanUpdate(
    state(),
    observationPlanUpdateSchema.parse({ note: 'Odak' }),
    updateChecks(),
  )
  assert.deepEqual(note, { patch: { note: 'Odak' }, notify: false })
  const moved = planObservationPlanUpdate(
    state(),
    observationPlanUpdateSchema.parse({ startTime: '11:00' }),
    updateChecks(),
  )
  assert.deepEqual(moved, { patch: { startTime: '11:00' }, notify: true })
  assert.throws(
    () =>
      planObservationPlanUpdate(
        state(),
        observationPlanUpdateSchema.parse({ startTime: '09:00' }),
        updateChecks({ busy: [busy({ startTime: '09:20' })] }),
      ),
    isDomainError('observation_plan_observer_busy'),
  )
  assert.throws(
    () =>
      planObservationPlanUpdate(
        state(),
        observationPlanUpdateSchema.parse({ plannedDate: '2026-11-20' }),
        updateChecks(),
      ),
    isDomainError('observation_plan_date_past'),
  )
  assert.throws(
    () =>
      planObservationPlanUpdate(
        state({ startTime: '23:00' }),
        observationPlanUpdateSchema.parse({ durationMinutes: 90 }),
        updateChecks(),
      ),
    isDomainError('observation_plan_day_end'),
  )
  const observer = planObservationPlanUpdate(
    state(),
    observationPlanUpdateSchema.parse({ observerMembershipId: 'm-ayse' }),
    updateChecks({ observer: { membershipId: 'm-ayse', role: 'ogretmen', active: true } }),
  )
  assert.deepEqual(observer, { patch: { observerMembershipId: 'm-ayse' }, notify: true })
  assert.throws(
    () =>
      planObservationPlanUpdate(
        state(),
        observationPlanUpdateSchema.parse({ observerMembershipId: 'm-selin' }),
        updateChecks({ observer: { membershipId: 'm-selin', role: 'ogretmen', active: true } }),
      ),
    isDomainError('observation_self'),
  )
  const period = planObservationPlanUpdate(
    state(),
    observationPlanUpdateSchema.parse({ performancePeriodId: PERIOD_ID }),
    updateChecks({ period: OPEN_PERIOD }),
  )
  assert.deepEqual(period.patch, { performancePeriodId: PERIOD_ID })
  assert.throws(
    () =>
      planObservationPlanUpdate(
        state(),
        observationPlanUpdateSchema.parse({ performancePeriodId: PERIOD_ID }),
        updateChecks({ period: OPEN_PERIOD, teacherPlansInPeriod: 3 }),
      ),
    isDomainError('observation_plan_limit'),
  )
  const template = planObservationPlanUpdate(
    state(),
    observationPlanUpdateSchema.parse({ templateId: TEMPLATE_ID }),
    updateChecks({ template: { archived: false, versionId: 'v-2' } }),
  )
  assert.deepEqual(template.patch, { templateVersionId: 'v-2' })
  assert.throws(
    () =>
      planObservationPlanUpdate(
        state(),
        observationPlanUpdateSchema.parse({ templateId: TEMPLATE_ID }),
        updateChecks({ template: null }),
      ),
    isDomainError('observation_template_not_found'),
  )
})

test('DOM-FIN-139 K-472 K-473: gerçekleşen, iptal ve başlamış plan değişmez', () => {
  const body = observationPlanUpdateSchema.parse({ note: 'x' })
  assert.throws(
    () => planObservationPlanUpdate(state({ status: 'done' }), body, updateChecks()),
    isDomainError('observation_plan_done', 'conflict'),
  )
  assert.throws(
    () => planObservationPlanUpdate(state({ status: 'cancelled' }), body, updateChecks()),
    isDomainError('observation_plan_cancelled', 'conflict'),
  )
  assert.throws(
    () => planObservationPlanUpdate(state({ observationId: 'o-1' }), body, updateChecks()),
    isDomainError('observation_plan_started', 'conflict'),
  )
  assert.throws(
    () => planObservationPlanCancel(state({ observationId: 'o-1' }), { reason: 'Hastalık' }),
    isDomainError('observation_plan_started', 'conflict'),
  )
})

test('DOM-FIN-139 K-472: erteleme yeni gün ve saati, gerekçeyi ister; aynı saat ve çakışma 422', () => {
  const parse = (patch: Record<string, unknown> = {}) =>
    observationPlanPostponeSchema.parse({
      plannedDate: '2026-11-26',
      startTime: '10:00',
      reason: 'Sınav haftası',
      ...patch,
    })
  const ok = { period: undefined, busy: [], today: TODAY }
  assert.deepEqual(planObservationPlanPostpone(state(), parse(), ok), {
    plannedDate: '2026-11-26',
    startTime: '10:00',
    durationMinutes: 40,
    reason: 'Sınav haftası',
  })
  assert.equal(
    planObservationPlanPostpone(state({ status: 'postponed' }), parse({ durationMinutes: 80 }), ok)
      .durationMinutes,
    80,
  )
  assert.throws(
    () =>
      planObservationPlanPostpone(
        state(),
        parse({ plannedDate: '2026-11-25', startTime: '09:40' }),
        ok,
      ),
    isDomainError('observation_plan_same_slot'),
  )
  assert.throws(
    () => planObservationPlanPostpone(state(), parse({ plannedDate: '2026-11-01' }), ok),
    isDomainError('observation_plan_date_past'),
  )
  assert.throws(
    () =>
      planObservationPlanPostpone(state(), parse(), {
        ...ok,
        period: { ...OPEN_PERIOD, endDate: '2026-11-25' },
      }),
    isDomainError('observation_plan_outside_period'),
  )
  assert.throws(
    () =>
      planObservationPlanPostpone(state(), parse(), {
        ...ok,
        busy: [busy({ plannedDate: '2026-11-26', startTime: '10:20' })],
      }),
    isDomainError('observation_plan_observer_busy'),
  )
  assert.throws(
    () =>
      planObservationPlanPostpone(state({ startTime: '09:40' }), parse({ startTime: '23:30' }), ok),
    isDomainError('observation_plan_day_end'),
  )
  assert.throws(
    () => planObservationPlanPostpone(state({ status: 'cancelled' }), parse(), ok),
    isDomainError('observation_plan_cancelled', 'conflict'),
  )
})

test('DOM-FIN-139 K-472: iptal gerekçeyle; gerçekleşen plan iptal edilmez', () => {
  assert.deepEqual(planObservationPlanCancel(state(), { reason: 'Öğretmen izinli' }), {
    reason: 'Öğretmen izinli',
  })
  assert.throws(
    () => planObservationPlanCancel(state({ status: 'done', observationId: 'o' }), { reason: 'x' }),
    isDomainError('observation_plan_done', 'conflict'),
  )
})

test('DOM-FIN-139 K-473: gözlem yalnız plan günü gelince ve bir kez başlatılır', () => {
  assert.doesNotThrow(() => planObservationPlanStart(state({ plannedDate: TODAY }), TODAY))
  assert.doesNotThrow(() => planObservationPlanStart(state({ plannedDate: '2026-11-20' }), TODAY))
  assert.throws(
    () => planObservationPlanStart(state(), TODAY),
    isDomainError('observation_plan_not_due'),
  )
  assert.throws(
    () => planObservationPlanStart(state({ plannedDate: TODAY, observationId: 'o-1' }), TODAY),
    isDomainError('observation_plan_started', 'conflict'),
  )
})

test('DOM-FIN-139 K-473: geciken plan günü geçmiş açık plandır', () => {
  assert.equal(
    isObservationPlanOverdue({ status: 'planned', plannedDate: '2026-11-22' }, TODAY),
    true,
  )
  assert.equal(
    isObservationPlanOverdue({ status: 'postponed', plannedDate: '2026-11-22' }, TODAY),
    true,
  )
  assert.equal(isObservationPlanOverdue({ status: 'planned', plannedDate: TODAY }, TODAY), false)
  assert.equal(
    isObservationPlanOverdue({ status: 'done', plannedDate: '2026-11-01' }, TODAY),
    false,
  )
  assert.equal(
    isObservationPlanOverdue({ status: 'cancelled', plannedDate: '2026-11-01' }, TODAY),
    false,
  )
})

test('DOM-FIN-139 K-474: görünürlük; yönetici hepsi, öğretmen kendi planı, diğer roller hiç', () => {
  const plan = { teacherMembershipId: 'm-selin', observerMembershipId: 'm-ayse' }
  assert.equal(canViewObservationPlan({ role: 'yonetici', membershipId: 'm-x' }, plan), true)
  assert.equal(canViewObservationPlan({ role: 'ogretmen', membershipId: 'm-selin' }, plan), true)
  assert.equal(canViewObservationPlan({ role: 'ogretmen', membershipId: 'm-ayse' }, plan), true)
  assert.equal(canViewObservationPlan({ role: 'ogretmen', membershipId: 'm-murat' }, plan), false)
  assert.equal(canViewObservationPlan({ role: 'onburo', membershipId: 'm-selin' }, plan), false)
})
