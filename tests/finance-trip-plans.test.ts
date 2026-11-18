import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertTripPlanTransition,
  canTripPlanTransition,
  checkTripPlan,
  normalizeTripPlate,
  planTripPlanApprove,
  planTripPlanCancel,
  planTripPlanComplete,
  planTripPlanNotice,
  planTripPlanSubmit,
  planTripPlanUpdate,
  sortTripStaff,
  tripPlanActions,
  tripPlanNoticeSchema,
  tripPlanNumber,
  tripPlanReasonSchema,
  tripPlanSchema,
  tripPlateLabel,
  tripStaffRatio,
  tripStaffRatioMessage,
  updateTripPlanSchema,
  type StoredTripPlanFields,
  type TripPlanChecks,
  type TripPlanInput,
} from '../packages/school-core/src/lib/finance-trip-plans.ts'

import { isDomainError } from './support/domain-error.ts'

// Gezi planı ve onay dosyası (DOM-FIN-111; ON-155). Şimdi 2026-10-06 12:00 (Europe/Istanbul 15:00).

const NOW = new Date('2026-10-06T12:00:00.000Z')
const INPUT: TripPlanInput = {
  name: 'Anıtkabir gezisi',
  purpose: 'Cumhuriyet tarihi dersinin kazanımlarını yerinde gözlemlemek.',
  departureAt: '2026-10-20T05:00:00.000Z',
  returnAt: '2026-10-20T17:00:00.000Z',
  expectedStudentCount: 40,
  stops: [{ place: 'Anıtkabir', note: 'Rehberli tur' }, { place: 'Ankara Kalesi' }],
  staff: [
    { membershipId: 'm-lead', role: 'lead' },
    { membershipId: 'm-help', role: 'assistant' },
  ],
  transport: {
    type: 'bus',
    company: 'Mavi Turizm',
    plate: '06 abc 123',
    driverName: 'Ali Sürücü',
    driverPhone: '0532 111 22 33',
  },
  risks: [{ risk: 'Kalabalıkta kaybolma', measure: 'Grup başına sorumlu öğretmen ve yaka kartı' }],
  emergencyContacts: [{ name: 'Okul müdürü', phone: '05321234567', relation: 'Müdür' }],
}
const STAFF: TripPlanChecks['staff'] = new Map([
  ['m-lead', { role: 'ogretmen', active: true }],
  ['m-help', { role: 'yonetici', active: true }],
])
const parsed = () => tripPlanSchema.parse(INPUT)
const checks = (extra: Partial<TripPlanChecks> = {}): TripPlanChecks => ({
  now: NOW,
  staff: STAFF,
  ...extra,
})
const stored = (): StoredTripPlanFields => {
  const data = parsed()
  return { ...data }
}

function throwsCode(run: () => unknown, code: string) {
  assert.throws(run, isDomainError(code))
}

test('DOM-FIN-111: plan şeması alanları kırpar, plakayı ve telefonu düzeltir, taslakta risk boş olabilir (K-366)', () => {
  const data = parsed()
  assert.equal(data.transport.plate, '06ABC123')
  assert.equal(data.transport.driverPhone, '05321112233')
  assert.equal(data.transport.documentFileId, null)
  assert.equal(data.stops[1]?.note, null)
  assert.equal(data.paidActivityId, null)
  assert.equal(data.departureAt, '2026-10-20T05:00:00.000Z')
  const draft = tripPlanSchema.parse({ ...INPUT, risks: undefined, emergencyContacts: undefined })
  assert.deepEqual(draft.risks, [])
  assert.deepEqual(draft.emergencyContacts, [])
  assert.equal(tripPlanNumber(7), 'GZ-0007')
  assert.equal(normalizeTripPlate(' 34 abc-12 '), '34ABC12')
  assert.equal(tripPlateLabel('34ABC123'), '34 ABC 123')
  assert.equal(tripPlateLabel('XYZ'), 'XYZ')
})

test('DOM-FIN-111: şema geçersiz plakayı, telefonu, boş güzergâhı, yinelenen ve sorumlusuz görevliyi reddeder (K-366)', () => {
  const bad = (patch: Partial<TripPlanInput>) =>
    assert.equal(tripPlanSchema.safeParse({ ...INPUT, ...patch }).success, false)
  bad({ transport: { ...INPUT.transport, plate: '99 A 1' } })
  bad({ transport: { ...INPUT.transport, driverPhone: '123' } })
  bad({ stops: [] })
  bad({ staff: [] })
  bad({ staff: [{ membershipId: 'm-lead', role: 'assistant' }] })
  bad({
    staff: [
      { membershipId: 'm-lead', role: 'lead' },
      { membershipId: 'm-lead', role: 'assistant' },
    ],
  })
  bad({ name: 'ab' })
  bad({ purpose: 'kısa' })
  bad({ expectedStudentCount: 0 })
  bad({ departureAt: '2026-10-20 08:00' })
  assert.equal(tripPlanSchema.safeParse({ ...INPUT, institutionId: 'x' }).success, false)
  assert.equal(tripPlanReasonSchema.safeParse({ reason: 'yok' }).success, false)
  assert.equal(tripPlanNoticeSchema.safeParse({ notifiedOn: '2026-13-01' }).success, false)
  assert.deepEqual(tripPlanNoticeSchema.parse({ notifiedOn: '2026-10-07', reference: ' ' }), {
    notifiedOn: '2026-10-07',
    reference: null,
  })
})

test('DOM-FIN-111: plan bütünlüğü dönüş, süre, geçmiş çıkış ve görevli üyeliğini denetler (K-366)', () => {
  checkTripPlan(parsed(), checks())
  throwsCode(
    () => checkTripPlan({ ...parsed(), returnAt: '2026-10-20T05:00:00.000Z' }, checks()),
    'trip_plan_return_before_departure',
  )
  throwsCode(
    () => checkTripPlan({ ...parsed(), returnAt: '2026-11-25T05:00:00.000Z' }, checks()),
    'trip_plan_too_long',
  )
  const past = { ...parsed(), departureAt: '2026-10-06T11:00:00.000Z' }
  throwsCode(() => checkTripPlan(past, checks()), 'trip_plan_departure_past')
  checkTripPlan(past, checks({ allowPastDeparture: true }))
  throwsCode(
    () =>
      checkTripPlan(
        parsed(),
        checks({ staff: new Map([['m-lead', STAFF.get('m-lead') ?? null]]) }),
      ),
    'trip_plan_staff_not_found',
  )
  throwsCode(
    () =>
      checkTripPlan(
        parsed(),
        checks({ staff: new Map([...STAFF, ['m-help', { role: 'onburo', active: true }]]) }),
      ),
    'trip_plan_staff_not_teacher',
  )
  throwsCode(
    () =>
      checkTripPlan(
        parsed(),
        checks({ staff: new Map([...STAFF, ['m-lead', { role: 'ogretmen', active: false }]]) }),
      ),
    'trip_plan_staff_inactive',
  )
})

test('DOM-FIN-111: ücretli etkinlik bağı kurumda, açık, tek planlı ve gezi günlerinde olmalı (DOM-FIN-098, K-366)', () => {
  const linked = { ...parsed(), paidActivityId: '1b4e28ba-2fa1-41d2-883f-0016d3cca427' }
  const activity = { status: 'open' as const, activityDate: '2026-10-20', linkedToOtherPlan: false }
  checkTripPlan(linked, checks({ activity }))
  throwsCode(() => checkTripPlan(linked, checks()), 'trip_plan_activity_not_found')
  throwsCode(
    () => checkTripPlan(linked, checks({ activity: null })),
    'trip_plan_activity_not_found',
  )
  throwsCode(
    () => checkTripPlan(linked, checks({ activity: { ...activity, status: 'cancelled' } })),
    'trip_plan_activity_cancelled',
  )
  assert.throws(
    () => checkTripPlan(linked, checks({ activity: { ...activity, linkedToOtherPlan: true } })),
    isDomainError('trip_plan_activity_linked', 'conflict'),
  )
  throwsCode(
    () => checkTripPlan(linked, checks({ activity: { ...activity, activityDate: '2026-10-21' } })),
    'trip_plan_activity_date_mismatch',
  )
})

test('DOM-FIN-111: düzeltme değişen alanları bulur, taslak dışında planı yeniden açar (K-367)', () => {
  const draft = planTripPlanUpdate({ ...stored(), status: 'draft' }, { name: 'Yeni gezi adı' })
  assert.deepEqual(draft.changed, ['name'])
  assert.equal(draft.reopens, false)
  assert.equal(draft.next.name, 'Yeni gezi adı')
  const approved = planTripPlanUpdate(
    { ...stored(), status: 'approved' },
    updateTripPlanSchema.parse({ name: 'Anıtkabir gezisi', expectedStudentCount: 45 }),
  )
  assert.deepEqual(approved.changed, ['expectedStudentCount'])
  assert.equal(approved.reopens, true)
  throwsCode(
    () => planTripPlanUpdate({ ...stored(), status: 'submitted' }, { name: 'Anıtkabir gezisi' }),
    'trip_plan_unchanged',
  )
  throwsCode(
    () => planTripPlanUpdate({ ...stored(), status: 'completed' }, { name: 'Başka' }),
    'trip_plan_status_invalid',
  )
})

test('DOM-FIN-111: onaya gönderme risk, acil iletişim ve kara yolu ulaşım bilgisini ister (K-366, K-367)', () => {
  const base = { ...stored(), status: 'draft' as const }
  planTripPlanSubmit(base, NOW)
  throwsCode(
    () => planTripPlanSubmit({ ...base, status: 'approved' }, NOW),
    'trip_plan_status_invalid',
  )
  throwsCode(() => planTripPlanSubmit({ ...base, risks: [] }, NOW), 'trip_plan_risks_required')
  throwsCode(
    () => planTripPlanSubmit({ ...base, emergencyContacts: [] }, NOW),
    'trip_plan_emergency_contact_required',
  )
  throwsCode(
    () => planTripPlanSubmit({ ...base, transport: { ...base.transport, plate: null } }, NOW),
    'trip_plan_transport_incomplete',
  )
  planTripPlanSubmit({ ...base, transport: { ...base.transport, type: 'train', plate: null } }, NOW)
  throwsCode(
    () => planTripPlanSubmit({ ...base, departureAt: '2026-10-06T11:00:00.000Z' }, NOW),
    'trip_plan_departure_past',
  )
})

test('DOM-FIN-111: onay, tamamlama, iptal ve bildirim geçişleri (K-367, K-368)', () => {
  planTripPlanApprove({ status: 'submitted', departureAt: '2026-10-20T05:00:00.000Z' }, NOW)
  throwsCode(
    () => planTripPlanApprove({ status: 'draft', departureAt: '2026-10-20T05:00:00.000Z' }, NOW),
    'trip_plan_status_invalid',
  )
  throwsCode(
    () =>
      planTripPlanApprove({ status: 'submitted', departureAt: '2026-10-05T05:00:00.000Z' }, NOW),
    'trip_plan_departure_past',
  )
  planTripPlanComplete({ status: 'approved', returnAt: '2026-10-06T11:00:00.000Z' }, NOW)
  throwsCode(
    () => planTripPlanComplete({ status: 'approved', returnAt: '2026-10-20T17:00:00.000Z' }, NOW),
    'trip_plan_not_returned',
  )
  planTripPlanCancel('approved', 'yonetici')
  planTripPlanCancel('rejected', 'onburo')
  assert.throws(
    () => planTripPlanCancel('approved', 'onburo'),
    isDomainError('trip_plan_cancel_forbidden', 'forbidden'),
  )
  throwsCode(() => planTripPlanCancel('completed', 'yonetici'), 'trip_plan_status_invalid')
  const approved = { status: 'approved' as const, approvedAt: '2026-10-05T07:00:00.000Z' }
  planTripPlanNotice(approved, '2026-10-06', NOW)
  throwsCode(() => planTripPlanNotice(approved, '2026-10-07', NOW), 'trip_plan_notice_date_future')
  throwsCode(
    () => planTripPlanNotice(approved, '2026-10-04', NOW),
    'trip_plan_notice_before_approval',
  )
  throwsCode(
    () => planTripPlanNotice({ status: 'draft', approvedAt: null }, '2026-10-06', NOW),
    'trip_plan_status_invalid',
  )
  assert.equal(canTripPlanTransition('cancelled', 'edit'), false)
  assertTripPlanTransition('submitted', 'reject')
})

test('DOM-FIN-111: görevli oranı her 15 öğrenciye bir görevli önerir, yalnız uyarıdır (K-366)', () => {
  assert.deepEqual(tripStaffRatio(40, 2), {
    studentsPerStaff: 20,
    recommendedStaff: 3,
    warning: true,
  })
  assert.deepEqual(tripStaffRatio(30, 2), {
    studentsPerStaff: 15,
    recommendedStaff: 2,
    warning: false,
  })
  assert.equal(tripStaffRatio(5, 0).warning, true)
  assert.equal(tripStaffRatioMessage(30, 2), null)
  assert.match(tripStaffRatioMessage(40, 2) ?? '', /en az 3 görevli/)
})

test('DOM-FIN-111: rolün işlemleri; onay ve ret yalnız yöneticide, ön büro taslak yazar (K-367)', () => {
  assert.deepEqual(tripPlanActions('submitted', 'yonetici'), {
    edit: true,
    submit: false,
    approve: true,
    reject: true,
    complete: false,
    cancel: true,
    notify: false,
  })
  assert.deepEqual(tripPlanActions('submitted', 'onburo'), {
    edit: true,
    submit: false,
    approve: false,
    reject: false,
    complete: false,
    cancel: false,
    notify: false,
  })
  assert.equal(tripPlanActions('draft', 'onburo').submit, true)
  assert.equal(tripPlanActions('draft', 'onburo').cancel, true)
  assert.equal(tripPlanActions('approved', 'onburo').notify, true)
  assert.equal(tripPlanActions('approved', 'yonetici').complete, true)
  assert.equal(tripPlanActions('draft', 'ogretmen').edit, false)
  assert.equal(tripPlanActions('completed', 'yonetici').cancel, false)
  assert.deepEqual(
    sortTripStaff([
      { role: 'assistant' as const, id: 1 },
      { role: 'lead' as const, id: 2 },
    ]).map((item) => item.id),
    [2, 1],
  )
})
