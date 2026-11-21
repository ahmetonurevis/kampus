import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  assertTripDayCardPurpose,
  canManageTripDay,
  canUseTripDayCardPurpose,
  isTripDay,
  planTripDayAssign,
  planTripDayCheckComplete,
  planTripDayCheckProceed,
  planTripDayCheckStart,
  planTripDayGroup,
  planTripDayGroupArchive,
  planTripDayMarks,
  tripDayAssignSchema,
  tripDayCardPurposeSchema,
  tripDayCheckCounts,
  tripDayCheckProceedSchema,
  tripDayCheckStartSchema,
  tripDayCountsLabel,
  tripDayGroupAccess,
  tripDayGroupSchema,
  tripDayGroupUpdateSchema,
  tripDayHealthAlert,
  tripDayHealthLabel,
  tripDayMarksSchema,
  tripDayRange,
  type TripDayAssignChecks,
  type TripDayGroupAccess,
  type TripDayMarkState,
} from '../packages/school-core/src/lib/finance-trip-day.ts'

/** Gezi günü yoklaması ve acil kart kuralları (DOM-FIN-154; ON-157; K-517…K-519). */

const NOW = new Date('2026-10-20T07:00:00Z') // 10:00 İstanbul
const PLAN = { departureAt: '2026-10-20T05:00:00.000Z', returnAt: '2026-10-21T17:00:00.000Z' }
const LEAD: TripDayGroupAccess = { read: true, operate: true, card: true }
const READER: TripDayGroupAccess = { read: true, operate: false, card: false }

function rejects(fn: () => unknown, code: string, kind: DomainError['kind'] = 'rule') {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })
}

describe('DOM-FIN-154: gezi günü şemaları', () => {
  test('grup plakayı boşluksuz büyük harfle saklar, boş plaka null olur', () => {
    const group = tripDayGroupSchema.parse({
      name: ' 1. otobüs ',
      vehiclePlate: '06 abc 123',
      leaderMembershipId: 'm1',
    })
    assert.deepEqual(group, {
      name: '1. otobüs',
      vehiclePlate: '06ABC123',
      leaderMembershipId: 'm1',
    })
    assert.equal(
      tripDayGroupSchema.parse({ name: 'Mavi', vehiclePlate: '', leaderMembershipId: 'm1' })
        .vehiclePlate,
      null,
    )
    assert.equal(
      tripDayGroupSchema.parse({ name: 'Mavi', leaderMembershipId: 'm1' }).vehiclePlate,
      null,
    )
    assert.equal(
      tripDayGroupSchema.safeParse({
        name: 'Mavi',
        vehiclePlate: '99 X 1',
        leaderMembershipId: 'm1',
      }).success,
      false,
    )
    assert.equal(
      tripDayGroupSchema.safeParse({ name: 'M', leaderMembershipId: 'm1' }).success,
      false,
    )
    assert.equal(
      tripDayGroupSchema.safeParse({ name: 'Mavi', leaderMembershipId: 'm1', institutionId: 'x' })
        .success,
      false,
    )
  })

  test('düzeltme en az bir alan ister', () => {
    assert.equal(tripDayGroupUpdateSchema.safeParse({}).success, false)
    assert.deepEqual(tripDayGroupUpdateSchema.parse({ vehiclePlate: null }), { vehiclePlate: null })
  })

  test('dağıtım ve işaret aynı öğrenciyi iki kez almaz; sınırlar', () => {
    const groupId = '00000000-0000-4000-8000-000000000001'
    assert.equal(
      tripDayAssignSchema.safeParse({ groupId, studentIds: ['s1', 's1'] }).success,
      false,
    )
    assert.equal(tripDayAssignSchema.safeParse({ groupId, studentIds: [] }).success, false)
    assert.equal(tripDayAssignSchema.safeParse({ groupId: null, studentIds: ['s1'] }).success, true)
    assert.equal(
      tripDayMarksSchema.safeParse({
        marks: [
          { studentId: 's1', status: 'present' },
          { studentId: 's1', status: 'absent' },
        ],
      }).success,
      false,
    )
    assert.equal(
      tripDayMarksSchema.safeParse({ marks: [{ studentId: 's1', status: 'here' }] }).success,
      false,
    )
    assert.equal(
      tripDayMarksSchema.safeParse({
        marks: [{ studentId: 's1', status: 'present', location: '41,29' }],
      }).success,
      false,
    )
    assert.equal(tripDayCheckStartSchema.safeParse({ checkpoint: 'V' }).success, false)
    assert.equal(tripDayCheckProceedSchema.safeParse({ reason: 'kısa' }).success, false)
    assert.equal(tripDayCardPurposeSchema.parse(undefined), 'office')
  })
})

describe('DOM-FIN-154: gün ve erişim (K-517, K-518)', () => {
  test('gezi günleri çıkış ve dönüş günü dahil, İstanbul gününe göre', () => {
    assert.deepEqual(tripDayRange(PLAN), { from: '2026-10-20', to: '2026-10-21' })
    assert.equal(isTripDay(PLAN, NOW), true)
    assert.equal(isTripDay(PLAN, new Date('2026-10-21T20:59:00Z')), true)
    assert.equal(isTripDay(PLAN, new Date('2026-10-21T21:00:00Z')), false) // 22 Ekim 00:00
    assert.equal(isTripDay(PLAN, new Date('2026-10-19T20:59:00Z')), false)
  })

  test('yönetici her grubu, öğretmen yalnız kendi grubunu yürütür; ön büro okur', () => {
    assert.deepEqual(tripDayGroupAccess({ role: 'yonetici', membershipId: 'x' }, 'm1'), LEAD)
    assert.deepEqual(tripDayGroupAccess({ role: 'onburo', membershipId: 'm1' }, 'm1'), READER)
    assert.deepEqual(tripDayGroupAccess({ role: 'ogretmen', membershipId: 'm1' }, 'm1'), LEAD)
    assert.deepEqual(tripDayGroupAccess({ role: 'ogretmen', membershipId: 'm2' }, 'm1'), {
      read: false,
      operate: false,
      card: false,
    })
    assert.equal(tripDayGroupAccess({ role: 'veli', membershipId: 'm1' }, 'm1').read, false)
    assert.equal(canManageTripDay('onburo'), true)
    assert.equal(canManageTripDay('ogretmen'), false)
  })

  test('tam telefonlu kart: yönetici her zaman, sorumlu yalnız gezi günü; ön büro hiç', () => {
    const admin = { role: 'yonetici' as const, membershipId: 'a' }
    const teacher = { role: 'ogretmen' as const, membershipId: 'm1' }
    assert.equal(canUseTripDayCardPurpose(admin, LEAD, 'emergency', false), true)
    assert.equal(canUseTripDayCardPurpose(teacher, LEAD, 'emergency', true), true)
    assert.equal(canUseTripDayCardPurpose(teacher, LEAD, 'emergency', false), false)
    assert.equal(canUseTripDayCardPurpose(teacher, LEAD, 'office', false), true)
    rejects(
      () => assertTripDayCardPurpose(teacher, LEAD, 'emergency', false),
      'trip_day_card_full_forbidden',
      'forbidden',
    )
    rejects(
      () => assertTripDayCardPurpose({ role: 'onburo', membershipId: 'o' }, READER, 'office', true),
      'trip_day_card_forbidden',
      'forbidden',
    )
    assert.doesNotThrow(() => assertTripDayCardPurpose(teacher, LEAD, 'office', false))
  })
})

describe('DOM-FIN-154: grup ve dağıtım (K-517)', () => {
  const groupChecks = {
    role: 'onburo',
    planStatus: 'approved' as const,
    staffMembershipIds: ['m1', 'm2'],
    otherGroupNames: ['1. Otobüs'],
    groupCount: 1,
  }

  test('sorumlu planın görevlisi, ad tekil, kapalı planda değişmez', () => {
    assert.doesNotThrow(() =>
      planTripDayGroup({ name: '2. otobüs', leaderMembershipId: 'm2' }, groupChecks, 'create'),
    )
    rejects(
      () =>
        planTripDayGroup({ name: '2. otobüs', leaderMembershipId: 'm9' }, groupChecks, 'create'),
      'trip_day_leader_not_staff',
    )
    rejects(
      () =>
        planTripDayGroup({ name: '1. otobüs', leaderMembershipId: 'm1' }, groupChecks, 'create'),
      'trip_day_group_name_taken',
      'conflict',
    )
    rejects(
      () =>
        planTripDayGroup(
          { name: 'X grubu', leaderMembershipId: 'm1' },
          { ...groupChecks, planStatus: 'cancelled' },
          'create',
        ),
      'trip_day_plan_closed',
    )
    rejects(
      () => planTripDayGroup({ name: 'X grubu' }, { ...groupChecks, role: 'ogretmen' }, 'create'),
      'trip_day_manage_forbidden',
      'forbidden',
    )
    rejects(
      () =>
        planTripDayGroup(
          { name: 'X grubu', leaderMembershipId: 'm1' },
          { ...groupChecks, groupCount: 30 },
          'create',
        ),
      'trip_day_groups_full',
    )
    rejects(
      () =>
        planTripDayGroup(
          { leaderMembershipId: 'm2' },
          { ...groupChecks, hasOpenCheck: true },
          'update',
        ),
      'trip_day_check_open',
    )
    assert.doesNotThrow(() =>
      planTripDayGroup({ name: 'Yeni ad' }, { ...groupChecks, hasOpenCheck: true }, 'update'),
    )
  })

  test('turu açılmış grup kaldırılmaz', () => {
    assert.doesNotThrow(() =>
      planTripDayGroupArchive({ role: 'yonetici', planStatus: 'draft', checkCount: 0 }),
    )
    rejects(
      () => planTripDayGroupArchive({ role: 'yonetici', planStatus: 'approved', checkCount: 1 }),
      'trip_day_group_has_checks',
    )
  })

  const G1 = '00000000-0000-4000-8000-000000000001'
  const G2 = '00000000-0000-4000-8000-000000000002'
  const assign = (extra: Partial<TripDayAssignChecks> = {}): TripDayAssignChecks => ({
    role: 'onburo',
    planStatus: 'approved',
    targetExists: true,
    eligible: new Set(['s1', 's2', 's3']),
    currentGroup: new Map([['s2', G2]]),
    openGroups: new Set(),
    ...extra,
  })

  test('ekleme, taşıma ve çıkarma ayrılır; aynı gruptaki öğrenci yazılmaz', () => {
    assert.deepEqual(planTripDayAssign({ groupId: G1, studentIds: ['s1', 's2'] }, assign()), {
      add: ['s1'],
      move: ['s2'],
      remove: [],
    })
    assert.deepEqual(planTripDayAssign({ groupId: G2, studentIds: ['s2'] }, assign()), {
      add: [],
      move: [],
      remove: [],
    })
    assert.deepEqual(planTripDayAssign({ groupId: null, studentIds: ['s1', 's2'] }, assign()), {
      add: [],
      move: [],
      remove: ['s2'],
    })
  })

  test('katılımcı olmayan ve süren turlu grup reddedilir', () => {
    rejects(
      () => planTripDayAssign({ groupId: G1, studentIds: ['s9'] }, assign()),
      'trip_day_student_not_participant',
    )
    rejects(
      () => planTripDayAssign({ groupId: G1, studentIds: ['s1'] }, assign({ targetExists: false })),
      'trip_day_group_not_found',
    )
    rejects(
      () =>
        planTripDayAssign(
          { groupId: G1, studentIds: ['s2'] },
          assign({ openGroups: new Set([G2]) }),
        ),
      'trip_day_check_open',
    )
    rejects(
      () =>
        planTripDayAssign(
          { groupId: G1, studentIds: ['s1'] },
          assign({ openGroups: new Set([G1]) }),
        ),
      'trip_day_check_open',
    )
    rejects(
      () =>
        planTripDayAssign(
          { groupId: null, studentIds: ['s2'] },
          assign({ openGroups: new Set([G2]) }),
        ),
      'trip_day_check_open',
    )
    rejects(
      () =>
        planTripDayAssign({ groupId: G1, studentIds: ['s1'] }, assign({ planStatus: 'completed' })),
      'trip_day_plan_closed',
    )
  })
})

describe('DOM-FIN-154: yoklama turu (K-517)', () => {
  const start = {
    access: LEAD,
    planStatus: 'approved' as const,
    tripDay: true,
    memberCount: 3,
    hasOpenCheck: false,
    checkCount: 0,
  }

  test('tur onaylı planda, gezi günü, dolu grupta ve süren tur yokken açılır', () => {
    assert.doesNotThrow(() => planTripDayCheckStart(start))
    rejects(
      () => planTripDayCheckStart({ ...start, access: READER }),
      'trip_day_not_leader',
      'forbidden',
    )
    rejects(
      () => planTripDayCheckStart({ ...start, planStatus: 'submitted' }),
      'trip_day_plan_not_approved',
    )
    rejects(() => planTripDayCheckStart({ ...start, tripDay: false }), 'trip_day_not_today')
    rejects(() => planTripDayCheckStart({ ...start, memberCount: 0 }), 'trip_day_group_empty')
    rejects(
      () => planTripDayCheckStart({ ...start, hasOpenCheck: true }),
      'trip_day_check_open',
      'conflict',
    )
    rejects(() => planTripDayCheckStart({ ...start, checkCount: 50 }), 'trip_day_checks_full')
  })

  const roster = new Set(['s1', 's2', 's3'])
  const marks = (current: Map<string, TripDayMarkState> = new Map()) => ({
    access: LEAD,
    status: 'open' as const,
    roster,
    current,
    now: NOW,
  })

  test('işaret yalnız listedeki öğrenciye; aynı durum yazılmaz, değişen yazılır', () => {
    const current = new Map<string, TripDayMarkState>([
      ['s1', { status: 'present', markedAt: NOW }],
    ])
    const writes = planTripDayMarks(
      tripDayMarksSchema.parse({
        marks: [
          { studentId: 's1', status: 'present' },
          { studentId: 's2', status: 'absent', markedAt: '2026-10-20T06:55:00Z' },
        ],
      }),
      marks(current),
    )
    assert.deepEqual(writes, [
      {
        studentId: 's2',
        next: { status: 'absent', markedAt: new Date('2026-10-20T06:55:00Z') },
        insert: true,
      },
    ])
    const flip = planTripDayMarks(
      tripDayMarksSchema.parse({ marks: [{ studentId: 's1', status: 'absent' }] }),
      marks(current),
    )
    assert.equal(flip[0]?.insert, false)
    assert.equal(flip[0]?.next.markedAt.getTime(), NOW.getTime())
  })

  test('işaret kuralları: liste dışı, ileri, eski, biten tur, yetkisiz', () => {
    const one = (body: Record<string, unknown>) =>
      tripDayMarksSchema.parse({ marks: [{ studentId: 's1', status: 'present', ...body }] })
    rejects(
      () => planTripDayMarks(one({ studentId: 's9' }), marks()),
      'trip_day_student_not_in_group',
    )
    rejects(
      () => planTripDayMarks(one({ markedAt: '2026-10-20T07:06:00Z' }), marks()),
      'trip_day_mark_future',
    )
    assert.doesNotThrow(() => planTripDayMarks(one({ markedAt: '2026-10-20T07:04:00Z' }), marks()))
    rejects(
      () => planTripDayMarks(one({ markedAt: '2026-10-19T06:59:00Z' }), marks()),
      'trip_day_mark_too_old',
    )
    rejects(
      () => planTripDayMarks(one({}), { ...marks(), status: 'complete' }),
      'trip_day_check_closed',
    )
    rejects(
      () => planTripDayMarks(one({}), { ...marks(), access: READER }),
      'trip_day_not_leader',
      'forbidden',
    )
  })

  test('eksik ya da işaretlenmemiş varken tur tamam yapılamaz (güvenlik)', () => {
    const base = { access: LEAD, status: 'open' as const }
    assert.doesNotThrow(() => planTripDayCheckComplete({ ...base, roster: ['present', 'present'] }))
    rejects(
      () => planTripDayCheckComplete({ ...base, roster: ['present', 'absent'] }),
      'trip_day_check_missing',
    )
    rejects(
      () => planTripDayCheckComplete({ ...base, roster: ['present', 'pending'] }),
      'trip_day_check_missing',
    )
    rejects(
      () => planTripDayCheckComplete({ ...base, status: 'complete', roster: ['present'] }),
      'trip_day_check_already_closed',
      'conflict',
    )
    rejects(
      () => planTripDayCheckComplete({ ...base, access: READER, roster: ['present'] }),
      'trip_day_not_leader',
      'forbidden',
    )
  })

  test('eksikle devam: herkes işaretli ve en az bir yok olmalı', () => {
    const base = { access: LEAD, status: 'open' as const }
    assert.deepEqual(planTripDayCheckProceed({ ...base, roster: ['present', 'absent'] }), {
      total: 2,
      present: 1,
      absent: 1,
      pending: 0,
    })
    rejects(
      () => planTripDayCheckProceed({ ...base, roster: ['absent', 'pending'] }),
      'trip_day_check_unmarked',
    )
    rejects(
      () => planTripDayCheckProceed({ ...base, roster: ['present'] }),
      'trip_day_check_no_missing',
    )
    rejects(
      () => planTripDayCheckProceed({ ...base, status: 'incomplete', roster: ['absent'] }),
      'trip_day_check_already_closed',
      'conflict',
    )
  })

  test('sayım ve özet metni', () => {
    const counts = tripDayCheckCounts(['present', 'present', 'absent', 'pending'])
    assert.deepEqual(counts, { total: 4, present: 2, absent: 1, pending: 1 })
    assert.equal(tripDayCountsLabel(counts), '2 var · 1 yok · 1 işaretlenmedi')
    assert.equal(tripDayCountsLabel(tripDayCheckCounts(['present'])), '1 var · 0 yok')
  })
})

describe('DOM-FIN-154: acil kartın sağlık uyarısı en az bilgidir (K-518)', () => {
  test('profilden yalnız tür işareti ve kısaltılmış acil talimat', () => {
    const alert = tripDayHealthAlert({
      profile: {
        allergies: 2,
        chronicConditions: 0,
        medications: 1,
        emergencyInstructions: '  Oto-enjektör çantada.  ',
      },
      medicationToday: false,
    })
    assert.deepEqual(alert, {
      alert: true,
      kinds: ['allergy', 'medication'],
      action: 'Oto-enjektör çantada.',
      medicationToday: false,
      source: 'profile',
    })
    assert.equal(tripDayHealthLabel(alert), 'Dikkat: alerji, ilaç var')
    const long = tripDayHealthAlert({
      profile: {
        allergies: 0,
        chronicConditions: null,
        medications: null,
        emergencyInstructions: 'a'.repeat(400),
      },
      medicationToday: true,
    })
    assert.equal(long.action?.length, 200)
    assert.ok(long.action?.endsWith('…'))
    assert.deepEqual(long.kinds, [])
    assert.equal(tripDayHealthLabel(long), 'Bugün ilaç var')
  })

  test('profil okunamazsa yalnız revir ilaç işareti kalır', () => {
    const none = tripDayHealthAlert({ profile: null, medicationToday: false })
    assert.deepEqual(none, {
      alert: false,
      kinds: [],
      action: null,
      medicationToday: false,
      source: 'unavailable',
    })
    assert.equal(tripDayHealthLabel(none), null)
    const medication = tripDayHealthAlert({ profile: null, medicationToday: true })
    assert.equal(medication.alert, true)
    assert.equal(medication.source, 'unavailable')
  })
})
