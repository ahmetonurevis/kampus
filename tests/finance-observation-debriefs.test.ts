import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canViewDevelopmentGoal,
  canViewObservationDebrief,
  developmentGoalCreateSchema,
  developmentGoalFollowUpSchema,
  developmentGoalOverdueDays,
  developmentGoalUpdateSchema,
  isDevelopmentGoalOverdue,
  OBSERVATION_DEBRIEF_MANAGE_ROLES,
  OBSERVATION_DEBRIEF_READ_ROLES,
  observationDebriefCreateSchema,
  observationDebriefUpdateSchema,
  planDevelopmentGoal,
  planDevelopmentGoalFollowUp,
  planDevelopmentGoalUpdate,
  planObservationDebrief,
  planObservationDebriefFinalize,
  planObservationDebriefUpdate,
  type DebriefChecks,
  type DevelopmentGoalChecks,
} from '../packages/school-core/src/lib/finance-observation-debriefs.ts'

import { isDomainError } from './support/domain-error.ts'

// Gözlem sonrası görüşme ve gelişim hedefi (DOM-FIN-133; ON-209). Kararlar K-454…K-456.

const TODAY = '2026-11-19'
const TEACHER = 'm-selin'
const OBSERVER = 'm-mudur'
const member = (membershipId: string, role = 'ogretmen', active = true) => ({
  membershipId,
  role,
  active,
})

const checks = (overrides: Partial<DebriefChecks> = {}): DebriefChecks & { exists: boolean } => ({
  observation: { status: 'completed', teacherMembershipId: TEACHER, observedDate: '2026-11-10' },
  participants: new Map([
    [TEACHER, member(TEACHER)],
    [OBSERVER, member(OBSERVER, 'yonetici')],
  ]),
  previousParticipants: [],
  today: TODAY,
  exists: false,
  ...overrides,
})
const debriefInput = (overrides: Record<string, unknown> = {}) =>
  observationDebriefCreateSchema.parse({
    debriefDate: '2026-11-12',
    participantMembershipIds: [TEACHER, OBSERVER],
    ...overrides,
  })

test('DOM-FIN-133 K-456: yazma yalnız yönetici, okuma yönetici ve öğretmen', () => {
  assert.deepEqual(OBSERVATION_DEBRIEF_MANAGE_ROLES, ['yonetici'])
  assert.deepEqual(OBSERVATION_DEBRIEF_READ_ROLES, ['yonetici', 'ogretmen'])
})

test('DOM-FIN-133 K-454: görüşme şeması; metinler taslakta boş, boş metin null, katılımcı tekil', () => {
  const parsed = debriefInput({ strengths: '  ' })
  assert.equal(parsed.strengths, null)
  assert.equal(parsed.teacherComment, null)
  assert.equal(
    observationDebriefCreateSchema.safeParse({
      debriefDate: '2026-11-12',
      participantMembershipIds: [TEACHER, TEACHER],
    }).success,
    false,
  )
  assert.equal(
    observationDebriefCreateSchema.safeParse({
      debriefDate: '2026-11-12',
      participantMembershipIds: [],
    }).success,
    false,
  )
  assert.equal(observationDebriefUpdateSchema.safeParse({}).success, false)
  assert.equal(
    observationDebriefCreateSchema.safeParse({ ...debriefInput(), institutionId: 'b' }).success,
    false,
  )
})

test('DOM-FIN-133 K-454: görüşme yalnız tamamlanmış gözleme, gözlem başına bir', () => {
  assert.doesNotThrow(() => planObservationDebrief(debriefInput(), checks()))
  assert.throws(
    () =>
      planObservationDebrief(
        debriefInput(),
        checks({
          observation: {
            status: 'draft',
            teacherMembershipId: TEACHER,
            observedDate: '2026-11-10',
          },
        }),
      ),
    isDomainError('debrief_observation_not_completed'),
  )
  assert.throws(
    () => planObservationDebrief(debriefInput(), { ...checks(), exists: true }),
    isDomainError('debrief_exists', 'conflict'),
  )
})

test('DOM-FIN-133 K-454: görüşme günü gözlem ile bugün arasında', () => {
  assert.throws(
    () => planObservationDebrief(debriefInput({ debriefDate: '2026-11-09' }), checks()),
    isDomainError('debrief_date_before_observation'),
  )
  assert.throws(
    () => planObservationDebrief(debriefInput({ debriefDate: '2026-11-20' }), checks()),
    isDomainError('debrief_date_future'),
  )
  assert.doesNotThrow(() =>
    planObservationDebrief(debriefInput({ debriefDate: '2026-11-10' }), checks()),
  )
  assert.doesNotThrow(() => planObservationDebrief(debriefInput({ debriefDate: TODAY }), checks()))
})

test('DOM-FIN-133 K-454: katılanlar kurumun etkin yönetici/öğretmeni ve gözlenen öğretmeni içerir', () => {
  const people = (entries: [string, ReturnType<typeof member> | null][]) => new Map(entries)
  assert.throws(
    () =>
      planObservationDebrief(
        debriefInput(),
        checks({
          participants: people([
            [TEACHER, member(TEACHER)],
            [OBSERVER, null],
          ]),
        }),
      ),
    isDomainError('debrief_participant_not_found'),
  )
  assert.throws(
    () =>
      planObservationDebrief(
        debriefInput(),
        checks({
          participants: people([
            [TEACHER, member(TEACHER)],
            [OBSERVER, member(OBSERVER, 'onburo')],
          ]),
        }),
      ),
    isDomainError('debrief_participant_invalid'),
  )
  const inactive = people([
    [TEACHER, member(TEACHER)],
    [OBSERVER, member(OBSERVER, 'yonetici', false)],
  ])
  assert.throws(
    () => planObservationDebrief(debriefInput(), checks({ participants: inactive })),
    isDomainError('debrief_participant_inactive'),
  )
  assert.throws(
    () => planObservationDebrief(debriefInput({ participantMembershipIds: [OBSERVER] }), checks()),
    isDomainError('debrief_teacher_missing'),
  )
  // Listede zaten olan ayrılmış personel düzeltmede kalabilir.
  const patch = planObservationDebriefUpdate(
    { status: 'draft' },
    observationDebriefUpdateSchema.parse({ participantMembershipIds: [TEACHER, OBSERVER] }),
    checks({ participants: inactive, previousParticipants: [OBSERVER] }),
  )
  assert.deepEqual(patch.participantMembershipIds, [TEACHER, OBSERVER])
})

test('DOM-FIN-133 K-454: taslak düzeltilir, kesinleşince değişmez; kesinleştirme metin ister', () => {
  const patch = planObservationDebriefUpdate(
    { status: 'draft' },
    observationDebriefUpdateSchema.parse({ strengths: 'Sınıf yönetimi güçlü', teacherComment: '' }),
    checks(),
  )
  assert.deepEqual(patch, { strengths: 'Sınıf yönetimi güçlü', teacherComment: null })
  assert.throws(
    () =>
      planObservationDebriefUpdate(
        { status: 'draft' },
        observationDebriefUpdateSchema.parse({ debriefDate: '2026-11-25' }),
        checks(),
      ),
    isDomainError('debrief_date_future'),
  )
  assert.throws(
    () =>
      planObservationDebriefUpdate(
        { status: 'finalized' },
        observationDebriefUpdateSchema.parse({ strengths: 'x' }),
        checks(),
      ),
    isDomainError('debrief_finalized', 'conflict'),
  )
  assert.throws(
    () =>
      planObservationDebriefFinalize({ status: 'draft', strengths: null, developmentAreas: 'x' }),
    isDomainError('debrief_strengths_required'),
  )
  assert.throws(
    () =>
      planObservationDebriefFinalize({ status: 'draft', strengths: 'x', developmentAreas: null }),
    isDomainError('debrief_development_areas_required'),
  )
  assert.doesNotThrow(() =>
    planObservationDebriefFinalize({ status: 'draft', strengths: 'x', developmentAreas: 'y' }),
  )
  assert.throws(
    () =>
      planObservationDebriefFinalize({
        status: 'finalized',
        strengths: 'x',
        developmentAreas: 'y',
      }),
    isDomainError('debrief_finalized', 'conflict'),
  )
})

test('DOM-FIN-133 K-456: görüşmeyi yönetici, gözlemci; öğretmen yalnız kesinleşince görür', () => {
  const debrief = {
    teacherMembershipId: TEACHER,
    observerMembershipId: OBSERVER,
    status: 'draft' as const,
  }
  assert.equal(canViewObservationDebrief({ role: 'yonetici', membershipId: 'x' }, debrief), true)
  assert.equal(
    canViewObservationDebrief({ role: 'ogretmen', membershipId: OBSERVER }, debrief),
    true,
  )
  assert.equal(
    canViewObservationDebrief({ role: 'ogretmen', membershipId: TEACHER }, debrief),
    false,
  )
  assert.equal(
    canViewObservationDebrief(
      { role: 'ogretmen', membershipId: TEACHER },
      { ...debrief, status: 'finalized' },
    ),
    true,
  )
  assert.equal(
    canViewObservationDebrief({ role: 'ogretmen', membershipId: 'm-baska' }, debrief),
    false,
  )
  for (const role of ['onburo', 'muhasebe', 'veli', 'ogrenci'])
    assert.equal(
      canViewObservationDebrief(
        { role, membershipId: OBSERVER },
        { ...debrief, status: 'finalized' },
      ),
      false,
    )
})

const goalChecks = (overrides: Partial<DevelopmentGoalChecks> = {}): DevelopmentGoalChecks => ({
  debrief: undefined,
  teacher: member(TEACHER),
  period: undefined,
  today: TODAY,
  ...overrides,
})
const goalInput = (overrides: Record<string, unknown> = {}) =>
  developmentGoalCreateSchema.parse({
    teacherMembershipId: TEACHER,
    title: 'Ders sonunda kazanım yoklaması yapmak',
    successCriterion: 'Üç gözlemde çıkış kartı kullanılmış olmalı',
    followUpDate: '2026-12-15',
    ...overrides,
  })

test('DOM-FIN-133 K-455: hedef kaynağı görüşme ya da öğretmen, ikisi birden değil', () => {
  const both = developmentGoalCreateSchema.safeParse({
    teacherMembershipId: TEACHER,
    debriefId: '0b0e8b2a-3a4b-4c5d-8e9f-0a1b2c3d4e5f',
    title: 'Hedef',
    successCriterion: 'Ölçüt',
    followUpDate: '2026-12-15',
  })
  assert.equal(both.success, false)
  const none = developmentGoalCreateSchema.safeParse({
    title: 'Hedef',
    successCriterion: 'Ölçüt',
    followUpDate: '2026-12-15',
  })
  assert.equal(none.success, false)
  assert.equal(developmentGoalUpdateSchema.safeParse({}).success, false)
  assert.equal(developmentGoalFollowUpSchema.safeParse({ note: 'x' }).success, false)
})

test('DOM-FIN-133 K-455: doğrudan ve görüşmeden hedef; öğretmen, dönem ve takip tarihi denetlenir', () => {
  const direct = planDevelopmentGoal(goalInput(), goalChecks())
  assert.equal(direct.source, 'direct')
  assert.equal(direct.debriefId, null)
  assert.equal(direct.teacherMembershipId, TEACHER)
  const debriefId = '0b0e8b2a-3a4b-4c5d-8e9f-0a1b2c3d4e5f'
  const fromDebrief = planDevelopmentGoal(
    goalInput({ teacherMembershipId: undefined, debriefId }),
    goalChecks({ debrief: { teacherMembershipId: TEACHER } }),
  )
  assert.equal(fromDebrief.source, 'observation_debrief')
  assert.equal(fromDebrief.debriefId, debriefId)
  assert.throws(
    () =>
      planDevelopmentGoal(
        goalInput({ teacherMembershipId: undefined, debriefId }),
        goalChecks({ debrief: null, teacher: null }),
      ),
    isDomainError('development_goal_debrief_not_found'),
  )
  assert.throws(
    () => planDevelopmentGoal(goalInput(), goalChecks({ teacher: null })),
    isDomainError('development_goal_teacher_not_found'),
  )
  assert.throws(
    () => planDevelopmentGoal(goalInput(), goalChecks({ teacher: member(TEACHER, 'yonetici') })),
    isDomainError('development_goal_not_teacher'),
  )
  assert.throws(
    () =>
      planDevelopmentGoal(goalInput(), goalChecks({ teacher: member(TEACHER, 'ogretmen', false) })),
    isDomainError('development_goal_teacher_inactive'),
  )
  assert.throws(
    () => planDevelopmentGoal(goalInput(), goalChecks({ period: null })),
    isDomainError('development_goal_period_not_found'),
  )
  assert.throws(
    () => planDevelopmentGoal(goalInput(), goalChecks({ period: { status: 'closed' } })),
    isDomainError('development_goal_period_closed'),
  )
  assert.equal(
    planDevelopmentGoal(goalInput(), goalChecks({ period: { status: 'active' } })).source,
    'direct',
  )
  assert.throws(
    () => planDevelopmentGoal(goalInput({ followUpDate: '2026-11-18' }), goalChecks()),
    isDomainError('development_goal_follow_up_past'),
  )
  assert.doesNotThrow(() => planDevelopmentGoal(goalInput({ followUpDate: TODAY }), goalChecks()))
})

test('DOM-FIN-133 K-455: süren hedef düzeltilir, kapanan hedef 409', () => {
  const patch = planDevelopmentGoalUpdate(
    { status: 'in_progress' },
    developmentGoalUpdateSchema.parse({ title: 'Yeni hedef', performancePeriodId: null }),
    { period: undefined, today: TODAY },
  )
  assert.deepEqual(patch, { title: 'Yeni hedef', performancePeriodId: null })
  assert.throws(
    () =>
      planDevelopmentGoalUpdate(
        { status: 'open' },
        developmentGoalUpdateSchema.parse({ followUpDate: '2026-01-01' }),
        { period: undefined, today: TODAY },
      ),
    isDomainError('development_goal_follow_up_past'),
  )
  assert.throws(
    () =>
      planDevelopmentGoalUpdate(
        { status: 'open' },
        developmentGoalUpdateSchema.parse({
          performancePeriodId: '0b0e8b2a-3a4b-4c5d-8e9f-0a1b2c3d4e5f',
        }),
        { period: { status: 'closed' }, today: TODAY },
      ),
    isDomainError('development_goal_period_closed'),
  )
  for (const status of ['achieved', 'dropped'] as const)
    assert.throws(
      () =>
        planDevelopmentGoalUpdate(
          { status },
          developmentGoalUpdateSchema.parse({ title: 'Yeni hedef' }),
          { period: undefined, today: TODAY },
        ),
      isDomainError('development_goal_closed', 'conflict'),
    )
})

test('DOM-FIN-133 K-455: takip notu; durum yalnız ileri, kapanana tarih verilmez', () => {
  const follow = (status: 'open' | 'in_progress' | 'achieved' | 'dropped', input: unknown) =>
    planDevelopmentGoalFollowUp({ status }, developmentGoalFollowUpSchema.parse(input), TODAY)
  assert.deepEqual(follow('open', { note: 'Görüşüldü', nextFollowUpDate: '2026-12-01' }), {
    note: 'Görüşüldü',
    statusFrom: 'open',
    statusTo: null,
    nextFollowUpDate: '2026-12-01',
  })
  assert.equal(follow('open', { note: 'Başladı', status: 'in_progress' }).statusTo, 'in_progress')
  assert.equal(follow('open', { note: 'Gerek kalmadı', status: 'dropped' }).statusTo, 'dropped')
  assert.equal(follow('in_progress', { note: 'Ulaştı', status: 'achieved' }).statusTo, 'achieved')
  assert.throws(
    () => follow('in_progress', { note: 'Geri', status: 'open' }),
    isDomainError('development_goal_status_invalid'),
  )
  assert.throws(
    () => follow('open', { note: 'Aynı', status: 'open' }),
    isDomainError('development_goal_status_invalid'),
  )
  assert.throws(
    () => follow('open', { note: 'Ulaştı', status: 'achieved', nextFollowUpDate: '2026-12-01' }),
    isDomainError('development_goal_follow_up_closed'),
  )
  assert.throws(
    () => follow('open', { note: 'Ertelendi', nextFollowUpDate: '2026-11-01' }),
    isDomainError('development_goal_follow_up_past'),
  )
  for (const status of ['achieved', 'dropped'] as const)
    assert.throws(
      () => follow(status, { note: 'Yeni not' }),
      isDomainError('development_goal_closed', 'conflict'),
    )
})

test('DOM-FIN-133 K-455: takip tarihi geçmiş süren hedef gecikmiştir (İstanbul günü)', () => {
  assert.equal(
    isDevelopmentGoalOverdue({ status: 'open', followUpDate: '2026-11-18' }, TODAY),
    true,
  )
  assert.equal(
    developmentGoalOverdueDays({ status: 'in_progress', followUpDate: '2026-11-09' }, TODAY),
    10,
  )
  assert.equal(isDevelopmentGoalOverdue({ status: 'open', followUpDate: TODAY }, TODAY), false)
  assert.equal(
    isDevelopmentGoalOverdue({ status: 'achieved', followUpDate: '2026-01-01' }, TODAY),
    false,
  )
  assert.equal(developmentGoalOverdueDays({ status: 'open', followUpDate: TODAY }, TODAY), 0)
})

test('DOM-FIN-133 K-456: hedefi yönetici, öğretmeni ve kaynak gözlemin gözlemcisi görür', () => {
  const goal = { teacherMembershipId: TEACHER, observerMembershipId: OBSERVER }
  assert.equal(canViewDevelopmentGoal({ role: 'yonetici', membershipId: 'x' }, goal), true)
  assert.equal(canViewDevelopmentGoal({ role: 'ogretmen', membershipId: TEACHER }, goal), true)
  assert.equal(canViewDevelopmentGoal({ role: 'ogretmen', membershipId: OBSERVER }, goal), true)
  assert.equal(canViewDevelopmentGoal({ role: 'ogretmen', membershipId: 'm-baska' }, goal), false)
  assert.equal(
    canViewDevelopmentGoal(
      { role: 'ogretmen', membershipId: 'm-baska' },
      { teacherMembershipId: TEACHER, observerMembershipId: null },
    ),
    false,
  )
  assert.equal(canViewDevelopmentGoal({ role: 'onburo', membershipId: TEACHER }, goal), false)
})
