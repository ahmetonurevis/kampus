import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  assertIncidentAddendum,
  assertIncidentFinalize,
  guardianIncidentSummary,
  incidentAccess,
  incidentAddendumSchema,
  incidentHealthSchema,
  incidentNotificationRequired,
  incidentNotificationSchema,
  incidentReportInputSchema,
  incidentReportUpdateSchema,
  planIncidentNotification,
  planIncidentReport,
  planIncidentReportUpdate,
  type IncidentReportChecks,
  type IncidentStaffMember,
  type IncidentValues,
} from '../packages/school-core/src/lib/finance-incidents.ts'

/** Kaza ve yaralanma tutanağı kuralları (DOM-FIN-146; ON-162; K-493…K-495). */

const NOW = new Date('2026-10-06T09:00:00.000Z')
const staff = (role = 'ogretmen', active = true): IncidentStaffMember => ({ role, active })
const members = new Map<string, IncidentStaffMember>([
  ['m-resp', staff()],
  ['m-wit', staff('onburo')],
  ['m-aid', staff('yonetici')],
  ['m-old', staff('ogretmen', false)],
  ['m-parent', staff('veli')],
  ['m-injured', staff('ogretmen', false)],
])
const checks = (overrides: Partial<IncidentReportChecks> = {}): IncidentReportChecks => ({
  now: NOW,
  members,
  studentExists: true,
  ...overrides,
})
const base = {
  injured: { kind: 'student', studentId: 's-1' },
  occurredAt: '2026-10-06T08:30:00+03:00',
  location: ' Bahçe ',
  kind: 'fall',
  description: 'Teneffüste koşarken düştü.',
  bodyParts: ['knee'],
  severity: 'minor',
  referral: 'infirmary',
  responsibleMembershipId: 'm-resp',
}
const parse = (extra: Record<string, unknown> = {}) =>
  incidentReportInputSchema.parse({ ...base, ...extra })
function rejects(run: () => unknown, code: string, kind: DomainError['kind'] = 'rule') {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })
}

describe('DOM-FIN-146: tutanak şeması', () => {
  test('varsayılanlar ve kırpma; bilinmeyen alan ve eksik alan 400', () => {
    const parsed = parse()
    assert.equal(parsed.location, 'Bahçe')
    assert.deepEqual(parsed.witnessMembershipIds, [])
    assert.equal(parsed.firstAid, null)
    assert.equal(parsed.injuryNote, null)
    assert.equal(
      incidentReportInputSchema.safeParse({ ...base, allergies: 'fıstık' }).success,
      false,
    )
    assert.equal(
      incidentReportInputSchema.safeParse({ ...base, severity: 'deadly' }).success,
      false,
    )
    assert.equal(
      incidentReportInputSchema.safeParse({ ...base, description: 'kısa' }).success,
      false,
    )
    assert.equal(incidentReportInputSchema.safeParse({ ...base, bodyParts: [] }).success, false)
    assert.equal(
      incidentReportInputSchema.safeParse({ ...base, bodyParts: ['knee', 'knee'] }).success,
      false,
    )
    assert.equal(
      incidentReportInputSchema.safeParse({ ...base, witnessMembershipIds: ['a', 'a'] }).success,
      false,
    )
    assert.equal(
      incidentReportInputSchema.safeParse({ ...base, injured: { kind: 'visitor' } }).success,
      false,
    )
    assert.equal(parse({ injuryNote: '  ' }).injuryNote, null)
  })

  test('düzeltme en az bir alan ister; yaralanan değişmez', () => {
    assert.equal(incidentReportUpdateSchema.safeParse({}).success, false)
    assert.equal(
      incidentReportUpdateSchema.safeParse({ injured: { kind: 'staff', membershipId: 'x' } })
        .success,
      false,
    )
    assert.equal(incidentReportUpdateSchema.safeParse({ location: 'Spor salonu' }).success, true)
  })

  test('bildirim ve ek not şemaları', () => {
    assert.deepEqual(incidentNotificationSchema.parse({ channel: 'phone' }), {
      notifiedAt: null,
      channel: 'phone',
      notifiedByMembershipId: null,
    })
    assert.equal(incidentNotificationSchema.safeParse({ channel: 'sms' }).success, false)
    assert.equal(incidentAddendumSchema.safeParse({ note: 'kısa' }).success, false)
    assert.equal(
      incidentAddendumSchema.parse({ note: ' Sevk hastane oldu. ' }).note,
      'Sevk hastane oldu.',
    )
  })
})

describe('DOM-FIN-146: tutanak açma (K-493)', () => {
  test('öğrenci tutanağı değerleri; sağlık grubu ayrı', () => {
    const values = planIncidentReport(
      parse({ firstAid: { byMembershipId: 'm-aid', action: 'Buz uygulandı.' } }),
      checks(),
    )
    assert.equal(values.occurredAt, '2026-10-06T05:30:00.000Z')
    assert.deepEqual(values.health, {
      bodyParts: ['knee'],
      severity: 'minor',
      injuryNote: null,
      firstAidAction: 'Buz uygulandı.',
      referral: 'infirmary',
    })
    assert.equal(values.firstAidByMembershipId, 'm-aid')
    assert.equal(incidentHealthSchema.safeParse(values.health).success, true)
  })

  test('olay anı gelecekte ve 30 günden eski olamaz', () => {
    rejects(
      () => planIncidentReport(parse({ occurredAt: '2026-10-06T10:00:00Z' }), checks()),
      'incident_occurred_in_future',
    )
    rejects(
      () => planIncidentReport(parse({ occurredAt: '2026-09-05T08:00:00Z' }), checks()),
      'incident_occurred_too_old',
    )
    planIncidentReport(parse({ occurredAt: '2026-09-07T09:00:00Z' }), checks())
  })

  test('yaralanan: öğrenci kurumda, personel kurumun personeli (pasif olabilir)', () => {
    rejects(
      () => planIncidentReport(parse(), checks({ studentExists: false })),
      'incident_student_not_found',
    )
    const staffInjured = parse({ injured: { kind: 'staff', membershipId: 'm-injured' } })
    planIncidentReport(staffInjured, checks({ injuredMember: staff('ogretmen', false) }))
    rejects(
      () => planIncidentReport(staffInjured, checks({ injuredMember: null })),
      'incident_injured_not_found',
    )
    rejects(
      () => planIncidentReport(staffInjured, checks({ injuredMember: staff('veli') })),
      'incident_injured_not_staff',
    )
    rejects(
      () =>
        planIncidentReport(
          parse({
            injured: { kind: 'staff', membershipId: 'm-wit' },
            witnessMembershipIds: ['m-wit'],
          }),
          checks({ injuredMember: staff('onburo') }),
        ),
      'incident_witness_is_injured',
    )
  })

  test('sorumlu, tanık ve müdahaleyi yapan etkin personel', () => {
    rejects(
      () => planIncidentReport(parse({ responsibleMembershipId: 'nope' }), checks()),
      'incident_responsible_not_found',
    )
    rejects(
      () => planIncidentReport(parse({ responsibleMembershipId: 'm-parent' }), checks()),
      'incident_responsible_not_staff',
    )
    rejects(
      () => planIncidentReport(parse({ witnessMembershipIds: ['m-wit', 'm-old'] }), checks()),
      'incident_witness_inactive',
    )
    rejects(
      () =>
        planIncidentReport(
          parse({ firstAid: { byMembershipId: 'm-parent', action: 'Pansuman' } }),
          checks(),
        ),
      'incident_first_aid_by_not_staff',
    )
    const outside = planIncidentReport(
      parse({ firstAid: { byMembershipId: null, action: '112 ekibi müdahale etti.' } }),
      checks(),
    )
    assert.equal(outside.firstAidByMembershipId, null)
  })
})

describe('DOM-FIN-146: taslak düzeltme, kesinleşme, bildirim ve ek not (K-493)', () => {
  const current = (): IncidentValues & {
    status: 'draft' | 'finalized'
    injuredMembershipId: string | null
  } => ({
    ...planIncidentReport(parse(), checks()),
    status: 'draft',
    injuredMembershipId: null,
  })
  const update = (
    patch: Record<string, unknown>,
    over: { status?: 'draft' | 'finalized'; firstNotifiedAt?: string | null } = {},
  ) =>
    planIncidentReportUpdate(
      { ...current(), status: over.status ?? 'draft' },
      incidentReportUpdateSchema.parse(patch),
      { now: NOW, members, firstNotifiedAt: over.firstNotifiedAt ?? null },
    )

  test('değişen alan adları; değişiklik yoksa 422; kesinleşmiş 409', () => {
    const { values, changed } = update({ severity: 'severe', witnessMembershipIds: ['m-wit'] })
    assert.equal(values.health.severity, 'severe')
    assert.deepEqual(changed, ['severity', 'witnessMembershipIds'])
    rejects(() => update({ location: 'Bahçe' }), 'incident_report_unchanged')
    rejects(
      () => update({ location: 'Koridor' }, { status: 'finalized' }),
      'incident_report_finalized',
      'conflict',
    )
    const aid = update({ firstAid: { byMembershipId: 'm-aid', action: 'Pansuman' } })
    assert.deepEqual(aid.changed, ['firstAid'])
    const kept = planIncidentReportUpdate(
      { ...aid.values, status: 'draft', injuredMembershipId: null },
      incidentReportUpdateSchema.parse({ kind: 'play' }),
      { now: NOW, members, firstNotifiedAt: null },
    )
    assert.equal(kept.values.health.firstAidAction, 'Pansuman')
    assert.equal(kept.values.firstAidByMembershipId, 'm-aid')
    assert.deepEqual(update({ firstAid: null, injuryNote: 'Sıyrık' }).changed, ['injuryNote'])
  })

  test('olay anı yeniden denetlenir ve ilk bildirimden sonraya alınamaz', () => {
    rejects(() => update({ occurredAt: '2026-10-06T10:00:00Z' }), 'incident_occurred_in_future')
    rejects(
      () =>
        update(
          { occurredAt: '2026-10-06T06:30:00Z' },
          { firstNotifiedAt: '2026-10-06T06:00:00.000Z' },
        ),
      'incident_occurred_after_notification',
    )
    rejects(() => update({ responsibleMembershipId: 'm-old' }), 'incident_responsible_inactive')
  })

  test('ağır öğrenci olayı bildirim kaydı olmadan kesinleşmez', () => {
    assert.equal(incidentNotificationRequired('student', 'severe'), true)
    assert.equal(incidentNotificationRequired('staff', 'severe'), false)
    assert.equal(incidentNotificationRequired('student', 'moderate'), false)
    const input = {
      status: 'draft' as const,
      injuredKind: 'student' as const,
      severity: 'severe' as const,
      notificationCount: 0,
    }
    rejects(() => assertIncidentFinalize(input), 'incident_notification_required')
    assertIncidentFinalize({ ...input, notificationCount: 1 })
    assertIncidentFinalize({ ...input, injuredKind: 'staff' })
    rejects(
      () => assertIncidentFinalize({ ...input, status: 'finalized', notificationCount: 1 }),
      'incident_report_finalized',
      'conflict',
    )
  })

  test('bildirim: yalnız öğrenci, olaydan sonra, gelecekte değil, etkin personel, en çok 10', () => {
    const report = {
      injuredKind: 'student' as const,
      occurredAt: '2026-10-06T05:30:00.000Z',
      notificationCount: 0,
    }
    const input = incidentNotificationSchema.parse({ channel: 'phone' })
    assert.deepEqual(planIncidentNotification(report, input, { now: NOW, notifiedBy: staff() }), {
      notifiedAt: NOW.toISOString(),
    })
    rejects(
      () =>
        planIncidentNotification({ ...report, injuredKind: 'staff' }, input, {
          now: NOW,
          notifiedBy: staff(),
        }),
      'incident_notification_not_student',
    )
    rejects(
      () =>
        planIncidentNotification({ ...report, notificationCount: 10 }, input, {
          now: NOW,
          notifiedBy: staff(),
        }),
      'incident_notification_limit',
    )
    rejects(
      () =>
        planIncidentNotification(
          report,
          { ...input, notifiedAt: '2026-10-06T05:00:00Z' },
          {
            now: NOW,
            notifiedBy: staff(),
          },
        ),
      'incident_notification_before_incident',
    )
    rejects(
      () =>
        planIncidentNotification(
          report,
          { ...input, notifiedAt: '2026-10-06T09:30:00Z' },
          {
            now: NOW,
            notifiedBy: staff(),
          },
        ),
      'incident_notification_in_future',
    )
    rejects(
      () =>
        planIncidentNotification(report, input, { now: NOW, notifiedBy: staff('ogretmen', false) }),
      'incident_notified_by_inactive',
    )
  })

  test('ek not yalnız kesinleşmiş tutanağa, en çok 50', () => {
    rejects(
      () => assertIncidentAddendum({ status: 'draft', addendumCount: 0 }),
      'incident_addendum_draft',
    )
    rejects(
      () => assertIncidentAddendum({ status: 'finalized', addendumCount: 50 }),
      'incident_addendum_limit',
    )
    assertIncidentAddendum({ status: 'finalized', addendumCount: 49 })
  })
})

describe('DOM-FIN-146: erişim ve veli özeti (K-494, K-495)', () => {
  const draft = { createdByUserId: 'u-open', status: 'draft' as const }
  const final = { ...draft, status: 'finalized' as const }

  test('yönetici her şeyi; açan taslakta sağlığı görür, kesinleşince görmez', () => {
    assert.deepEqual(incidentAccess({ role: 'yonetici', userId: 'u-x' }, final), {
      read: true,
      health: true,
      edit: false,
      notify: true,
      manage: true,
    })
    assert.deepEqual(incidentAccess({ role: 'ogretmen', userId: 'u-open' }, draft), {
      read: true,
      health: true,
      edit: true,
      notify: true,
      manage: false,
    })
    assert.deepEqual(incidentAccess({ role: 'onburo', userId: 'u-open' }, final), {
      read: true,
      health: false,
      edit: false,
      notify: true,
      manage: false,
    })
    assert.equal(incidentAccess({ role: 'onburo', userId: 'u-other' }, draft).read, false)
    assert.equal(incidentAccess({ role: 'veli', userId: 'u-open' }, final).read, false)
  })

  test('veli özeti açıklama, tanık, not ve bildireni taşımaz', () => {
    const summary = guardianIncidentSummary({
      id: 'r-1',
      studentId: 's-1',
      occurredAt: '2026-10-06T05:30:00.000Z',
      location: 'Bahçe',
      kind: 'fall',
      health: {
        bodyParts: ['knee'],
        severity: 'moderate',
        injuryNote: 'Sol diz',
        firstAidAction: 'Buz',
        referral: 'infirmary',
      },
      finalizedAt: NOW.toISOString(),
      notifications: [
        { notifiedAt: NOW.toISOString(), channel: 'phone', notifiedByName: 'Selin Kaya' },
      ],
    })
    assert.deepEqual(Object.keys(summary).sort(), [
      'bodyParts',
      'finalizedAt',
      'firstAidAction',
      'id',
      'kind',
      'location',
      'notifications',
      'occurredAt',
      'referral',
      'severity',
      'studentId',
    ])
    assert.deepEqual(summary.notifications, [{ notifiedAt: NOW.toISOString(), channel: 'phone' }])
  })
})
