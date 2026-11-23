import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  assertConsentDecision,
  assertConsentWithdrawable,
  assertVisitOpen,
  consentHealthSchema,
  infirmaryDischargeSchema,
  infirmaryVisitInputSchema,
  infirmaryVisitUpdateSchema,
  medicationAdministrationSchema,
  medicationConsentInputSchema,
  medicationConsentRejectSchema,
  medicationScheduleSlots,
  normalizeDose,
  planInfirmaryDischarge,
  planInfirmaryVisit,
  planInfirmaryVisitUpdate,
  planMedicationAdministration,
  planMedicationConsent,
  visitHealthSchema,
  visitPresence,
  type InfirmaryStaffMember,
  type VisitChecks,
  type VisitValues,
} from '../packages/school-core/src/lib/finance-infirmary.ts'

/** Revir ve ilaç onayı kuralları (DOM-FIN-151; ON-101; IST-102; K-508…K-510). */

const NOW = new Date('2026-10-06T09:00:00.000Z') // Europe/Istanbul 12:00
const staff = (role = 'ogretmen', active = true): InfirmaryStaffMember => ({ role, active })

function rejects(run: () => unknown, code: string, kind: DomainError['kind'] = 'rule') {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof DomainError, String(error))
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })
}

const visitInput = (extra: Record<string, unknown> = {}) =>
  infirmaryVisitInputSchema.parse({ studentId: 's-1', complaint: 'Baş ağrısı', ...extra })
const visitChecks = (extra: Partial<VisitChecks> = {}): VisitChecks => ({
  now: NOW,
  studentExists: true,
  openVisitExists: false,
  ...extra,
})

describe('DOM-FIN-151: revir ziyareti (K-508)', () => {
  test('DOM-FIN-151: şema şikâyeti ister, yapılanları tekil tutar, bilinmeyen alanı reddeder', () => {
    assert.equal(infirmaryVisitInputSchema.safeParse({ studentId: 's-1' }).success, false)
    assert.equal(
      infirmaryVisitInputSchema.safeParse({ studentId: 's-1', complaint: 'x' }).success,
      false,
    )
    assert.equal(
      infirmaryVisitInputSchema.safeParse({
        studentId: 's-1',
        complaint: 'Baş ağrısı',
        actions: ['rest', 'rest'],
      }).success,
      false,
    )
    assert.equal(
      infirmaryVisitInputSchema.safeParse({
        studentId: 's-1',
        complaint: 'Baş ağrısı',
        allergies: 'Fıstık',
      }).success,
      false,
    )
    const parsed = visitInput({ note: '  ' })
    assert.deepEqual(parsed.actions, [])
    assert.equal(parsed.note, null)
    assert.equal(parsed.arrivedAt, null)
    assert.equal(infirmaryVisitUpdateSchema.safeParse({}).success, false)
    assert.equal(infirmaryDischargeSchema.safeParse({ outcome: 'healed' }).success, false)
  })

  test('DOM-FIN-151: açma; geliş anı boşsa şimdi, sağlık grubu ayrı döner', () => {
    const values = planInfirmaryVisit(visitInput({ actions: ['rest'] }), visitChecks())
    assert.equal(values.arrivedAt, NOW.toISOString())
    assert.deepEqual(values.health, { complaint: 'Baş ağrısı', actions: ['rest'], note: null })
    assert.equal(values.referredByMembershipId, null)
    assert.equal(visitHealthSchema.safeParse(values.health).success, true)
  })

  test('DOM-FIN-151: açma kuralları: öğrenci, an, gönderen, tutanak, tek açık ziyaret', () => {
    rejects(
      () => planInfirmaryVisit(visitInput(), visitChecks({ studentExists: false })),
      'infirmary_student_not_found',
    )
    rejects(
      () => planInfirmaryVisit(visitInput({ arrivedAt: '2026-10-06T10:00:00Z' }), visitChecks()),
      'infirmary_arrived_in_future',
    )
    rejects(
      () => planInfirmaryVisit(visitInput({ arrivedAt: '2026-09-28T10:00:00Z' }), visitChecks()),
      'infirmary_arrived_too_old',
    )
    const referred = visitInput({ referredByMembershipId: 'm-1' })
    rejects(
      () => planInfirmaryVisit(referred, visitChecks({ referredBy: null })),
      'infirmary_referred_by_not_found',
    )
    rejects(
      () => planInfirmaryVisit(referred, visitChecks({ referredBy: staff('veli') })),
      'infirmary_referred_by_not_staff',
    )
    rejects(
      () => planInfirmaryVisit(referred, visitChecks({ referredBy: staff('ogretmen', false) })),
      'infirmary_referred_by_inactive',
    )
    assert.equal(
      planInfirmaryVisit(referred, visitChecks({ referredBy: staff() })).referredByMembershipId,
      'm-1',
    )
    const linked = visitInput({ incidentReportId: '3f1c2a8e-8a1b-4c3d-9e2f-1a2b3c4d5e6f' })
    rejects(
      () => planInfirmaryVisit(linked, visitChecks({ incident: null })),
      'infirmary_incident_not_found',
    )
    rejects(
      () => planInfirmaryVisit(linked, visitChecks({ incident: { studentId: 's-2' } })),
      'infirmary_incident_other_student',
    )
    rejects(
      () => planInfirmaryVisit(linked, visitChecks({ incident: { studentId: null } })),
      'infirmary_incident_other_student',
    )
    assert.ok(
      planInfirmaryVisit(linked, visitChecks({ incident: { studentId: 's-1' } })).incidentReportId,
    )
    rejects(
      () => planInfirmaryVisit(visitInput(), visitChecks({ openVisitExists: true })),
      'infirmary_visit_already_open',
      'conflict',
    )
  })

  const current = (extra: Partial<VisitValues> = {}) => ({
    status: 'open' as const,
    studentId: 's-1',
    arrivedAt: '2026-10-06T08:00:00.000Z',
    referredByMembershipId: null,
    incidentReportId: null,
    health: { complaint: 'Baş ağrısı', actions: [], note: null },
    ...extra,
  })

  test('DOM-FIN-151: açık ziyaret düzeltmesi; değişen alan adları, değişiklik yoksa 422', () => {
    const { values, changed } = planInfirmaryVisitUpdate(
      current(),
      infirmaryVisitUpdateSchema.parse({ actions: ['rest', 'first_aid'], note: 'Su içti' }),
      { now: NOW },
    )
    assert.deepEqual(changed, ['actions', 'note'])
    assert.equal(values.health.complaint, 'Baş ağrısı')
    rejects(
      () =>
        planInfirmaryVisitUpdate(
          current(),
          infirmaryVisitUpdateSchema.parse({ complaint: 'Baş ağrısı' }),
          { now: NOW },
        ),
      'infirmary_visit_unchanged',
    )
    rejects(
      () =>
        planInfirmaryVisitUpdate(
          current(),
          infirmaryVisitUpdateSchema.parse({ arrivedAt: '2026-10-06T09:30:00Z' }),
          { now: NOW },
        ),
      'infirmary_arrived_in_future',
    )
    rejects(
      () =>
        planInfirmaryVisitUpdate(
          current(),
          infirmaryVisitUpdateSchema.parse({ referredByMembershipId: 'm-x' }),
          { now: NOW, referredBy: null },
        ),
      'infirmary_referred_by_not_found',
    )
    rejects(
      () =>
        planInfirmaryVisitUpdate(
          current(),
          infirmaryVisitUpdateSchema.parse({
            incidentReportId: '3f1c2a8e-8a1b-4c3d-9e2f-1a2b3c4d5e6f',
          }),
          { now: NOW, incident: { studentId: 's-2' } },
        ),
      'infirmary_incident_other_student',
    )
    const cleared = planInfirmaryVisitUpdate(
      current({ referredByMembershipId: 'm-1', incidentReportId: 'r-1' }),
      infirmaryVisitUpdateSchema.parse({ referredByMembershipId: null, incidentReportId: null }),
      { now: NOW },
    )
    assert.deepEqual(cleared.changed, ['referredByMembershipId', 'incidentReportId'])
    rejects(
      () =>
        planInfirmaryVisitUpdate(
          { ...current(), status: 'closed' },
          infirmaryVisitUpdateSchema.parse({ note: 'Geç not' }),
          { now: NOW },
        ),
      'infirmary_visit_closed',
      'conflict',
    )
    assert.doesNotThrow(() => assertVisitOpen('open'))
  })

  test('DOM-FIN-151: kapatma; dönüş anı, en az bir yapılan, kapanmış ziyaret 409', () => {
    const discharge = (extra: Record<string, unknown> = {}) =>
      infirmaryDischargeSchema.parse({ outcome: 'returned_to_class', ...extra })
    rejects(() => planInfirmaryDischarge(current(), discharge(), NOW), 'infirmary_actions_required')
    rejects(
      () =>
        planInfirmaryDischarge(
          current(),
          discharge({ actions: ['rest'], returnedAt: '2026-10-06T07:00:00Z' }),
          NOW,
        ),
      'infirmary_returned_before_arrival',
    )
    rejects(
      () =>
        planInfirmaryDischarge(
          current(),
          discharge({ actions: ['rest'], returnedAt: '2026-10-06T09:01:00Z' }),
          NOW,
        ),
      'infirmary_returned_in_future',
    )
    const done = planInfirmaryDischarge(current(), discharge({ actions: ['rest'] }), NOW)
    assert.equal(done.returnedAt, NOW.toISOString())
    assert.deepEqual(done.changed, ['status', 'returnedAt', 'outcome', 'actions'])
    const kept = planInfirmaryDischarge(
      current({ health: { complaint: 'Mide', actions: ['rest'], note: null } }),
      discharge({ note: 'Eve gönderildi' }),
      NOW,
    )
    assert.deepEqual(kept.health.actions, ['rest'])
    assert.deepEqual(kept.changed, ['status', 'returnedAt', 'outcome', 'note'])
    rejects(
      () =>
        planInfirmaryDischarge(
          { ...current(), status: 'closed' },
          discharge({ actions: ['rest'] }),
          NOW,
        ),
      'infirmary_visit_closed',
      'conflict',
    )
  })

  test('DOM-FIN-151: öğretmen yalnız revirde / döndü durumunu görür (K-510)', () => {
    assert.equal(visitPresence('open'), 'in_infirmary')
    assert.equal(visitPresence('closed'), 'returned')
  })
})

const consentInput = (extra: Record<string, unknown> = {}) =>
  medicationConsentInputSchema.parse({
    studentId: 's-1',
    medicationName: 'Parol şurup',
    dose: '5 ml',
    times: ['12:30'],
    startDate: '2026-10-06',
    endDate: '2026-10-10',
    ...extra,
  })

describe('DOM-FIN-151: veli ilaç onayı (K-509)', () => {
  test('DOM-FIN-151: şema saatleri sıralar, yineleyen ve biçimsiz saati reddeder', () => {
    assert.deepEqual(consentInput({ times: ['15:00', '09:00'] }).times, ['09:00', '15:00'])
    for (const times of [[], ['12:30', '12:30'], ['24:00'], ['9:00']])
      assert.equal(
        medicationConsentInputSchema.safeParse({ ...consentInput(), times }).success,
        false,
        JSON.stringify(times),
      )
    assert.equal(
      medicationConsentInputSchema.safeParse({ ...consentInput(), endDate: '2026-02-30' }).success,
      false,
    )
    assert.equal(consentInput().note, null)
    assert.equal(medicationConsentRejectSchema.safeParse({ reason: 'kısa' }).success, false)
    assert.equal(
      consentHealthSchema.safeParse({ medicationName: 'Parol', dose: '5 ml', note: null }).success,
      true,
    )
  })

  test('DOM-FIN-151: talep kuralları: kapsam, ilk gün, son gün, en çok 90 gün', () => {
    rejects(
      () => planMedicationConsent(consentInput(), { now: NOW, studentInScope: false }),
      'infirmary_student_not_found',
      'not_found',
    )
    const plan = (extra: Record<string, unknown>) =>
      planMedicationConsent(consentInput(extra), { now: NOW, studentInScope: true })
    rejects(() => plan({ startDate: '2026-10-05' }), 'infirmary_consent_start_past')
    rejects(
      () => plan({ startDate: '2026-12-06', endDate: '2026-12-07' }),
      'infirmary_consent_start_too_far',
    )
    rejects(() => plan({ endDate: '2026-10-05' }), 'infirmary_consent_end_before_start')
    rejects(() => plan({ endDate: '2027-01-04' }), 'infirmary_consent_too_long')
    assert.equal(plan({ endDate: '2027-01-03' }).endDate, '2027-01-03')
    const planned = plan({ note: 'Tok karnına' })
    assert.deepEqual(planned.health, {
      medicationName: 'Parol şurup',
      dose: '5 ml',
      note: 'Tok karnına',
    })
    assert.deepEqual(planned.times, ['12:30'])
  })

  test('DOM-FIN-151: onay ve ret yalnız bekleyende; süresi geçmiş onaylanmaz; geri çekme', () => {
    assert.doesNotThrow(() =>
      assertConsentDecision({ status: 'pending', endDate: '2026-10-06' }, 'approve', NOW),
    )
    rejects(
      () => assertConsentDecision({ status: 'approved', endDate: '2026-10-10' }, 'reject', NOW),
      'infirmary_consent_not_pending',
      'conflict',
    )
    rejects(
      () => assertConsentDecision({ status: 'pending', endDate: '2026-10-05' }, 'approve', NOW),
      'infirmary_consent_expired',
    )
    assert.doesNotThrow(() =>
      assertConsentDecision({ status: 'pending', endDate: '2026-10-05' }, 'reject', NOW),
    )
    assert.doesNotThrow(() => assertConsentWithdrawable('pending'))
    assert.doesNotThrow(() => assertConsentWithdrawable('approved'))
    rejects(() => assertConsentWithdrawable('rejected'), 'infirmary_consent_closed', 'conflict')
    rejects(() => assertConsentWithdrawable('withdrawn'), 'infirmary_consent_closed', 'conflict')
  })
})

describe('DOM-FIN-151: ilaç uygulaması (K-509)', () => {
  const consent = {
    status: 'approved' as const,
    startDate: '2026-10-05',
    endDate: '2026-10-07',
    times: ['09:00', '12:30'],
  }
  const given = new Set<string>()
  const checks = (extra: Record<string, unknown> = {}) => ({
    now: NOW,
    administeredBy: staff('onburo'),
    alreadyGiven: (day: string, time: string) => given.has(`${day} ${time}`),
    ...extra,
  })
  const input = (extra: Record<string, unknown> = {}) =>
    medicationAdministrationSchema.parse({ scheduledTime: '12:30', dose: '5 ml', ...extra })

  test('DOM-FIN-151: onaylı dozu kaydeder; gün Europe/Istanbul gününe göre', () => {
    const plan = planMedicationAdministration(consent, '5 ml', input(), checks())
    assert.equal(plan.administeredAt, NOW.toISOString())
    assert.equal(plan.doseDay, '2026-10-06')
    assert.deepEqual(plan.health, { dose: '5 ml', note: null })
    // UTC 21:30 → İstanbul ertesi gün 00:30.
    const late = planMedicationAdministration(
      { ...consent, times: ['00:30'] },
      '5 ml',
      input({ scheduledTime: '00:30', administeredAt: '2026-10-05T21:30:00Z' }),
      checks(),
    )
    assert.equal(late.doseDay, '2026-10-06')
    assert.equal(normalizeDose(' 2,5  ML '), '2.5 ml')
    assert.ok(planMedicationAdministration(consent, '2,5 ml', input({ dose: '2.5 ML' }), checks()))
  })

  test('DOM-FIN-151: onaysız, dönem dışı, onay dışı saat ve doz 422; aynı doz saati 409', () => {
    for (const status of ['pending', 'rejected', 'withdrawn'] as const)
      rejects(
        () => planMedicationAdministration({ ...consent, status }, '5 ml', input(), checks()),
        'infirmary_consent_not_approved',
      )
    rejects(
      () =>
        planMedicationAdministration(
          consent,
          '5 ml',
          input({ administeredAt: '2026-10-06T09:05:00Z' }),
          checks(),
        ),
      'infirmary_administration_in_future',
    )
    rejects(
      () =>
        planMedicationAdministration(
          consent,
          '5 ml',
          input({ administeredAt: '2026-10-05T08:00:00Z' }),
          checks(),
        ),
      'infirmary_administration_too_old',
    )
    rejects(
      () =>
        planMedicationAdministration(
          { ...consent, startDate: '2026-10-07' },
          '5 ml',
          input(),
          checks(),
        ),
      'infirmary_administration_outside_period',
    )
    rejects(
      () =>
        planMedicationAdministration(consent, '5 ml', input({ scheduledTime: '15:00' }), checks()),
      'infirmary_dose_time_not_approved',
    )
    rejects(
      () => planMedicationAdministration(consent, '5 ml', input({ dose: '10 ml' }), checks()),
      'infirmary_dose_not_approved',
    )
    rejects(
      () =>
        planMedicationAdministration(consent, '5 ml', input(), checks({ administeredBy: null })),
      'infirmary_administered_by_not_found',
    )
    rejects(
      () =>
        planMedicationAdministration(
          consent,
          '5 ml',
          input(),
          checks({ administeredBy: staff('veli') }),
        ),
      'infirmary_administered_by_not_staff',
    )
    given.add('2026-10-06 12:30')
    rejects(
      () => planMedicationAdministration(consent, '5 ml', input(), checks()),
      'infirmary_dose_already_given',
      'conflict',
    )
    assert.ok(
      planMedicationAdministration(consent, '5 ml', input({ scheduledTime: '09:00' }), checks()),
    )
  })

  test('DOM-FIN-151: gün planı yalnız günü kapsayan talepleri saat sırasıyla verir', () => {
    const slots = medicationScheduleSlots(
      [
        { id: 'b', startDate: '2026-10-01', endDate: '2026-10-06', times: ['12:30', '09:00'] },
        { id: 'a', startDate: '2026-10-06', endDate: '2026-10-06', times: ['12:30'] },
        { id: 'c', startDate: '2026-10-07', endDate: '2026-10-09', times: ['08:00'] },
      ],
      '2026-10-06',
    )
    assert.deepEqual(
      slots.map((slot) => `${slot.scheduledTime} ${slot.consent.id}`),
      ['09:00 b', '12:30 a', '12:30 b'],
    )
  })
})
