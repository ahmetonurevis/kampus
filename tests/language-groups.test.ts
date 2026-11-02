import test, { describe } from 'node:test'
import assert from 'node:assert/strict'

import { authorize, type AuthorizationSource } from '../packages/school-core/src/lib/authorize.ts'
import { NO_COORDINATOR_SCOPE } from '../packages/school-core/src/lib/coordinator-duties.ts'
import {
  planCourseArchive,
  planCourseUpdate,
  type Course,
  type CourseManager,
} from '../packages/school-core/src/lib/courses.ts'
import {
  ageBandOf,
  canReadGroup,
  groupEndDate,
  groupOccupancy,
  groupSessions,
  groupsBlockingCourseArchive,
  groupStatus,
  groupView,
  isoWeekday,
  planGroupCancellation,
  planGroupCreation,
  planGroupMerge,
  planGroupOpen,
  planGroupPlacement,
  planGroupUpdate,
  sessionsPerWeek,
  suggestWaitlistOffers,
  waitlistQueue,
  type GroupMember,
  type GroupPlanningContext,
  type LanguageGroup,
  type WaitlistEntry,
} from '../packages/school-core/src/lib/language-groups.ts'
import { OPERATION_COMMANDS } from '../packages/school-core/src/modules/commands.ts'
import type { Role } from '../packages/school-core/src/modules/navigation.ts'
import { isDomainError } from './support/domain-error.ts'

/**
 * Dil okulu grup planlama kuralları (IST-077; DOM-DIL-003, -008, -040…045). Tarih sabit: 6 Ekim
 * 2026 Salı; gruplar 12 Ekim Pazartesi başlar.
 */

const ZodError = { name: 'ZodError' }
const NOW = '2026-10-06T09:00:00.000Z'
const LANG = 'language_school' as const
const ADMIN: CourseManager = { role: 'yonetici', coordination: NO_COORDINATOR_SCOPE }
const B1_COORDINATOR: CourseManager = {
  role: 'ogretmen',
  coordination: { subjectIds: [], cefrLevels: ['B1'] },
}
const TEACHER: CourseManager = { role: 'ogretmen', coordination: NO_COORDINATOR_SCOPE }
const COURSE_ID = '00000000-0000-4000-8000-0000000000c1'
const OTHER_COURSE_ID = '00000000-0000-4000-8000-0000000000c2'
const G1 = '00000000-0000-4000-8000-0000000000a1'
const G2 = '00000000-0000-4000-8000-0000000000a2'
const NEW = '00000000-0000-4000-8000-0000000000a9'

const course = (overrides: Partial<Course> = {}): Course => ({
  id: COURSE_ID,
  name: 'Genel İngilizce B1.1',
  language: 'en',
  level: 'B1',
  skillFocus: [],
  description: null,
  // Haftada 4 oturum (45 dk), toplam 12 oturum: üç hafta.
  totalHours: 12,
  weeklyHours: 4,
  sessionMinutes: 45,
  minLearners: 2,
  maxLearners: 12,
  certified: false,
  nextCourseId: null,
  status: 'active',
  activatedAt: NOW,
  archivedAt: null,
  eOzel: { programCode: null, approval: 'not_submitted', recordedAt: null, recordedByUserId: null },
  ...overrides,
})

const SCHEDULE = [
  { weekday: 1, startTime: '18:00' },
  { weekday: 1, startTime: '18:45' },
  { weekday: 3, startTime: '18:00' },
  { weekday: 3, startTime: '18:45' },
]

const group = (overrides: Partial<LanguageGroup> = {}): LanguageGroup => ({
  id: G1,
  courseId: COURSE_ID,
  name: 'B1 Akşam',
  ageBand: 'adult',
  teacherMembershipId: 't-selin',
  delivery: 'in_person',
  room: 'Derslik 1',
  schedule: SCHEDULE,
  startDate: '2026-10-12',
  endDate: '2026-10-28',
  capacity: 10,
  state: 'planned',
  openedAt: null,
  cancelledAt: null,
  cancelReason: null,
  mergedIntoGroupId: null,
  ...overrides,
})

const member = (studentId: string, groupId = G1, status: GroupMember['status'] = 'active') => ({
  groupId,
  studentId,
  status,
  joinedAt: NOW,
})

const entry = (overrides: Partial<WaitlistEntry>): WaitlistEntry => ({
  id: 'w-1',
  courseId: COURSE_ID,
  groupId: G1,
  studentId: 's-w1',
  prospectId: null,
  requestedAt: '2026-10-01T09:00:00.000Z',
  status: 'waiting',
  offerGroupId: null,
  offeredAt: null,
  offerExpiresAt: null,
  ...overrides,
})

const ctx = (overrides: Partial<GroupPlanningContext> = {}): GroupPlanningContext => ({
  institutionType: LANG,
  manager: ADMIN,
  courses: [course()],
  groups: [],
  members: [],
  waitlist: [],
  teacherMembershipIds: ['t-selin', 't-can'],
  now: NOW,
  ...overrides,
})

const BODY = {
  courseId: COURSE_ID,
  name: 'B1 Akşam',
  ageBand: 'adult',
  teacherMembershipId: 't-selin',
  delivery: 'in_person',
  room: 'Derslik 1',
  schedule: SCHEDULE,
  startDate: '2026-10-12',
  capacity: 10,
}

const create = (body: Record<string, unknown> = {}, context: Partial<GroupPlanningContext> = {}) =>
  planGroupCreation({ ...ctx(context), input: { ...BODY, ...body }, groupId: NEW })

/** Başarısız işlem girdiyi değiştirmez (core işlemleri saf, DOM-DIL-008). */
function unchangedOnFailure(
  context: GroupPlanningContext,
  run: () => unknown,
  code: string,
  kind = 'rule',
) {
  const before = structuredClone(context)
  assert.throws(run, isDomainError(code, kind))
  assert.deepEqual(context, before)
}

describe('grup takvimi (IST-077)', () => {
  test('oturumlar kurun toplam saatine yayılır; bitiş son oturumun günüdür', () => {
    assert.equal(isoWeekday('2026-10-12'), 1)
    assert.equal(isoWeekday('2026-10-18'), 7)
    assert.equal(sessionsPerWeek(course()), 4)
    assert.equal(sessionsPerWeek(course({ sessionMinutes: 90, weeklyHours: 4 })), 2)
    const sessions = groupSessions(group(), course())
    assert.equal(sessions.length, 12)
    assert.deepEqual(sessions[0], { date: '2026-10-12', startTime: '18:00', endTime: '18:45' })
    assert.deepEqual(sessions.at(-1), { date: '2026-10-28', startTime: '18:45', endTime: '19:30' })
    assert.equal(groupEndDate(group(), course()), '2026-10-28')
    // Başlangıç günü kalıpta yoksa ilk oturum sonraki kalıp günüdür.
    assert.equal(groupSessions(group({ startDate: '2026-10-13' }), course())[0]?.date, '2026-10-14')
    assert.deepEqual(groupSessions(group({ schedule: [] }), course()), [])
  })

  test('durum tarihten türetilir: açık grup başlangıçta devam eder, bitişten sonra tamamlanır', () => {
    const open = group({ state: 'open' })
    assert.equal(groupStatus(open, NOW), 'open')
    assert.equal(groupStatus(open, '2026-10-12T05:00:00.000Z'), 'running')
    // 28 Ekim 23.30 İstanbul: hâlâ bitiş günü.
    assert.equal(groupStatus(open, '2026-10-28T20:30:00.000Z'), 'running')
    assert.equal(groupStatus(open, '2026-10-28T21:30:00.000Z'), 'completed')
    assert.equal(groupStatus(group(), '2027-01-01T00:00:00.000Z'), 'planned')
    assert.equal(groupStatus(group({ state: 'cancelled' }), NOW), 'cancelled')
  })

  test('DOM-DIL-041 yaş bandı İstanbul gününe göre', () => {
    assert.equal(ageBandOf('2008-10-06', NOW), 'adult')
    assert.equal(ageBandOf('2008-10-07', NOW), 'teen')
    assert.equal(ageBandOf('2014-10-06', NOW), 'teen')
    assert.equal(ageBandOf('2014-10-07', NOW), 'child')
  })
})

describe('grup oluşturma (IST-077)', () => {
  test('DOM-DIL-008 yönetici etkin kurdan grup planlar; bitiş hesaplanır, kalıp sıralanır', () => {
    const created = create({ schedule: [...SCHEDULE].reverse() })
    assert.deepEqual(created, group({ id: NEW }))
    // Çevrim içi ve öğretmensiz planlama da olur.
    const online = create({ delivery: 'online', room: null, teacherMembershipId: null })
    assert.equal(online.room, null)
    assert.equal(online.teacherMembershipId, null)
  })

  test('DOM-DIL-008 okulda 404; koordinatör yalnız kendi seviyesinde; kur etkin olmalı', () => {
    assert.throws(
      () => create({}, { institutionType: 'school' }),
      isDomainError('module_unavailable_for_type', 'not_found'),
    )
    assert.equal(create({}, { manager: B1_COORDINATOR }).id, NEW)
    assert.throws(
      () => create({}, { manager: TEACHER }),
      isDomainError('course_coordinator_required', 'forbidden'),
    )
    assert.throws(
      () => create({}, { courses: [course({ status: 'draft', activatedAt: null })] }),
      isDomainError('group_course_inactive'),
    )
    assert.throws(
      () => create({ courseId: OTHER_COURSE_ID }),
      isDomainError('group_course_not_found'),
    )
  })

  test('400: şema geçersiz alanı ve bilinmeyen alanı reddeder', () => {
    for (const body of [
      { capacity: 19 },
      { capacity: 0 },
      { startDate: '2026-02-30' },
      { schedule: [{ weekday: 8, startTime: '18:00' }] },
      { schedule: [{ weekday: 1, startTime: '24:00' }] },
      { schedule: [] },
      { ageBand: 'senior' },
      { institutionId: 'x' },
    ])
      assert.throws(() => create(body), ZodError, JSON.stringify(body))
  })

  test('DOM-DIL-002 kalıp kurun haftalık saatine uyar, oturumlar binmez', () => {
    assert.throws(
      () => create({ schedule: SCHEDULE.slice(0, 3) }),
      isDomainError('group_schedule_mismatch'),
    )
    assert.throws(
      () =>
        create({
          schedule: [...SCHEDULE.slice(0, 3), { weekday: 3, startTime: '18:30' }],
        }),
      isDomainError('group_schedule_overlap'),
    )
  })

  test('DOM-DIL-003 yasal çalışma aralığı 07.00–23.00; çocuk ve genç grubunda 21.00', () => {
    const at = (time: string) => [...SCHEDULE.slice(0, 3), { weekday: 5, startTime: time }]
    assert.throws(
      () => create({ schedule: at('06:30') }),
      isDomainError('group_outside_legal_hours'),
    )
    assert.throws(
      () => create({ schedule: at('22:30') }),
      isDomainError('group_outside_legal_hours'),
    )
    assert.equal(create({ schedule: at('22:15') }).schedule.length, 4)
    assert.throws(
      () => create({ ageBand: 'teen', schedule: at('20:30') }),
      isDomainError('group_minor_late'),
    )
    assert.equal(create({ ageBand: 'child', schedule: at('20:15') }).ageBand, 'child')
  })

  test('DOM-DIL-040 kapasite kurun en çok mevcudunu aşamaz; başlangıç geçmiş olamaz', () => {
    assert.throws(() => create({ capacity: 13 }), isDomainError('group_capacity_exceeds_course'))
    assert.throws(() => create({ startDate: '2026-10-05' }), isDomainError('group_start_passed'))
    assert.equal(create({ startDate: '2026-10-06' }).startDate, '2026-10-06')
  })

  test('öğretmen kurumun öğretmeni olmalı; çevrim içi grubun dersliği olmaz', () => {
    assert.throws(
      () => create({ teacherMembershipId: 't-yabanci' }),
      isDomainError('group_teacher_invalid'),
    )
    assert.throws(() => create({ delivery: 'online' }), isDomainError('group_room_online'))
  })

  test('409: ad iptal edilmemiş gruplarda tekil (büyük/küçük harf duyarsız)', () => {
    const context = ctx({ groups: [group({ id: G2, teacherMembershipId: 't-can', room: 'D2' })] })
    unchangedOnFailure(
      context,
      () => planGroupCreation({ ...context, input: { ...BODY, name: 'b1 AKŞAM' }, groupId: NEW }),
      'group_name_exists',
      'conflict',
    )
    const cancelled = ctx({ groups: [group({ id: G2, state: 'cancelled' })] })
    assert.equal(planGroupCreation({ ...cancelled, input: BODY, groupId: NEW }).name, 'B1 Akşam')
  })

  test('IST-077 öğretmen ve derslik çakışması reddedilir; kapanmış ve tarihi ayrı grup çakışmaz', () => {
    const other = group({
      id: G2,
      name: 'B1 Diğer',
      schedule: [{ weekday: 3, startTime: '18:30' }],
    })
    const otherCourse = course({ id: OTHER_COURSE_ID, totalHours: 3, weeklyHours: 1 })
    const courses = [course(), otherCourse]
    const conflicted = { ...other, courseId: OTHER_COURSE_ID, endDate: '2026-10-28' }
    const context = ctx({ courses, groups: [{ ...conflicted, room: 'D9' }] })
    unchangedOnFailure(
      context,
      () => planGroupCreation({ ...context, input: BODY, groupId: NEW }),
      'group_teacher_conflict',
    )
    assert.throws(
      () =>
        create(
          { name: 'B1 Yeni' },
          {
            courses,
            groups: [{ ...conflicted, teacherMembershipId: 't-can', room: 'derslik  1' }],
          },
        ),
      isDomainError('group_room_conflict'),
    )
    // Çevrim içi gruplar derslik paylaşmaz; farklı saat, iptal ve tarih aralığı dışı çakışmaz.
    for (const groups of [
      [{ ...conflicted, teacherMembershipId: 't-can', delivery: 'online' as const, room: null }],
      [{ ...conflicted, schedule: [{ weekday: 3, startTime: '19:30' }] }],
      [{ ...conflicted, state: 'cancelled' as const }],
      [{ ...conflicted, startDate: '2026-10-29', endDate: '2026-11-20' }],
      // Ortak aralık 26–27 Ekim: Çarşamba yok.
      [{ ...conflicted, startDate: '2026-10-26', endDate: '2026-10-27' }],
    ])
      assert.equal(create({ name: 'B1 Yeni' }, { courses, groups }).id, NEW, JSON.stringify(groups))
  })
})

describe('grup değiştirme, açma ve iptal (IST-077)', () => {
  test('PATCH alanları değiştirir; çevrim içine geçişte derslik düşer; değişen alanlar döner', () => {
    const context = ctx({ groups: [group()] })
    const result = planGroupUpdate({
      ...context,
      groupId: G1,
      input: { name: 'B1 Akşam A', delivery: 'online', capacity: 10 },
    })
    assert.equal(result.group.room, null)
    assert.deepEqual(result.fields, ['name', 'delivery', 'room'])
    const moved = planGroupUpdate({ ...context, groupId: G1, input: { startDate: '2026-10-19' } })
    assert.equal(moved.group.endDate, '2026-11-04')
    assert.deepEqual(moved.fields, ['startDate', 'endDate'])
    assert.throws(() => planGroupUpdate({ ...context, groupId: G1, input: {} }), ZodError)
    assert.throws(
      () => planGroupUpdate({ ...context, groupId: NEW, input: { name: 'X' } }),
      isDomainError('group_not_found', 'not_found'),
    )
  })

  test('DOM-DIL-042 kursiyeri olan grubun gün/saati değişmez; kapasite kursiyerden az olamaz', () => {
    const context = ctx({ groups: [group()], members: [member('s1'), member('s2', G1, 'frozen')] })
    unchangedOnFailure(
      context,
      () =>
        planGroupUpdate({
          ...context,
          groupId: G1,
          input: { schedule: [...SCHEDULE.slice(0, 3), { weekday: 5, startTime: '18:00' }] },
        }),
      'group_schedule_locked',
    )
    assert.throws(
      () => planGroupUpdate({ ...context, groupId: G1, input: { ageBand: 'teen' } }),
      isDomainError('group_schedule_locked'),
    )
    const withOffer = ctx({
      groups: [group()],
      members: [member('s1')],
      waitlist: [
        entry({
          status: 'offered',
          offerGroupId: G1,
          offeredAt: NOW,
          offerExpiresAt: '2026-10-08T09:00:00.000Z',
        }),
      ],
    })
    assert.throws(
      () => planGroupUpdate({ ...withOffer, groupId: G1, input: { capacity: 1 } }),
      isDomainError('group_capacity_below_members'),
    )
    assert.equal(
      planGroupUpdate({ ...withOffer, groupId: G1, input: { capacity: 2 } }).group.capacity,
      2,
    )
  })

  test('409: kapanmış grup değişmez; başlamış grubun öğretmeni değişebilir', () => {
    const cancelled = ctx({ groups: [group({ state: 'cancelled' })] })
    assert.throws(
      () => planGroupUpdate({ ...cancelled, groupId: G1, input: { name: 'X' } }),
      isDomainError('group_closed', 'conflict'),
    )
    const running = ctx({ groups: [group({ state: 'open' })], now: '2026-10-14T09:00:00.000Z' })
    assert.equal(
      planGroupUpdate({ ...running, groupId: G1, input: { teacherMembershipId: 't-can' } }).group
        .teacherMembershipId,
      't-can',
    )
    assert.throws(
      () => planGroupUpdate({ ...running, groupId: G1, input: { startDate: '2026-10-19' } }),
      isDomainError('group_schedule_locked'),
    )
  })

  test('DOM-DIL-042 grup açılış sayısına ulaşınca açılır; öğretmen ve derslik gerekir', () => {
    const below = ctx({ groups: [group()], members: [member('s1'), member('s2', G1, 'frozen')] })
    unchangedOnFailure(below, () => planGroupOpen({ ...below, groupId: G1 }), 'group_below_minimum')
    const members = [member('s1'), member('s2')]
    const opened = planGroupOpen({ ...ctx({ groups: [group()], members }), groupId: G1 })
    assert.equal(opened.state, 'open')
    assert.equal(opened.openedAt, NOW)
    assert.throws(
      () => planGroupOpen({ ...ctx({ groups: [opened], members }), groupId: G1 }),
      isDomainError('group_not_planned', 'conflict'),
    )
    assert.throws(
      () =>
        planGroupOpen({
          ...ctx({ groups: [group({ teacherMembershipId: null })], members }),
          groupId: G1,
        }),
      isDomainError('group_teacher_required'),
    )
    assert.throws(
      () => planGroupOpen({ ...ctx({ groups: [group({ room: null })], members }), groupId: G1 }),
      isDomainError('group_room_required'),
    )
    assert.throws(
      () =>
        planGroupOpen({
          ...ctx({ groups: [group()], members, now: '2026-10-13T09:00:00.000Z' }),
          groupId: G1,
        }),
      isDomainError('group_start_passed'),
    )
    assert.throws(
      () =>
        planGroupOpen({ ...ctx({ groups: [group()], members, manager: TEACHER }), groupId: G1 }),
      isDomainError('course_coordinator_required', 'forbidden'),
    )
  })

  test('DOM-DIL-042 iptal gerekçe ister; iptal edilen grup yeniden iptal edilmez', () => {
    const context = ctx({ groups: [group()] })
    assert.throws(
      () => planGroupCancellation({ ...context, groupId: G1, input: { reason: ' ' } }),
      ZodError,
    )
    const cancelled = planGroupCancellation({
      ...context,
      groupId: G1,
      input: { reason: 'Açılış sayısına ulaşılamadı.' },
    })
    assert.equal(cancelled.state, 'cancelled')
    assert.equal(cancelled.cancelledAt, NOW)
    assert.throws(
      () =>
        planGroupCancellation({
          ...ctx({ groups: [cancelled] }),
          groupId: G1,
          input: { reason: 'Yine' },
        }),
      isDomainError('group_closed', 'conflict'),
    )
  })
})

describe('grup birleştirme (DOM-DIL-042)', () => {
  const target = group({ capacity: 4 })
  const source = group({ id: G2, name: 'B1 Akşam 2', teacherMembershipId: 't-can', room: 'D2' })

  test('kaynak kapanır, kursiyerleri hedefe taşınır; hedefte olan taşınmaz', () => {
    const members = [member('s1'), member('s2', G2), member('s1', G2), member('s3', G2, 'frozen')]
    const result = planGroupMerge({
      learnerBirthDates: {},
      ...ctx({ groups: [target, source], members }),
      groupId: G1,
      input: { sourceGroupId: G2, sourceVersion: 1 },
    })
    assert.deepEqual(result.movedStudentIds, ['s2', 's3'])
    assert.equal(result.source.state, 'cancelled')
    assert.equal(result.source.mergedIntoGroupId, G1)
    assert.equal(result.target, target)
  })

  test('kapasite, kur, yaş bandı, aynı grup ve onay sınırları', () => {
    const members = [
      member('s1'),
      member('s2'),
      member('s3', G2),
      member('s4', G2),
      member('s5', G2),
    ]
    const context = ctx({ groups: [target, source], members })
    unchangedOnFailure(
      context,
      () =>
        planGroupMerge({
          learnerBirthDates: {},
          ...context,
          groupId: G1,
          input: { sourceGroupId: G2, sourceVersion: 1 },
        }),
      'group_merge_capacity',
    )
    assert.throws(
      () =>
        planGroupMerge({
          learnerBirthDates: {},
          ...context,
          groupId: G1,
          input: { sourceGroupId: G1, sourceVersion: 1 },
        }),
      isDomainError('group_merge_same'),
    )
    for (const changed of [{ courseId: OTHER_COURSE_ID }, { ageBand: 'teen' as const }])
      assert.throws(
        () =>
          planGroupMerge({
            learnerBirthDates: {},
            ...ctx({ groups: [target, { ...source, ...changed }] }),
            groupId: G1,
            input: { sourceGroupId: G2, sourceVersion: 1 },
          }),
        isDomainError('group_merge_mismatch'),
      )
    const later = {
      ...source,
      schedule: [...SCHEDULE.slice(0, 3), { weekday: 5, startTime: '18:00' }],
    }
    const moving = ctx({ groups: [target, later], members: [member('s3', G2)] })
    assert.throws(
      () =>
        planGroupMerge({
          learnerBirthDates: {},
          ...moving,
          groupId: G1,
          input: { sourceGroupId: G2, sourceVersion: 1 },
        }),
      isDomainError('group_merge_consent_required'),
    )
    assert.deepEqual(
      planGroupMerge({
        learnerBirthDates: {},
        ...moving,
        groupId: G1,
        input: { sourceGroupId: G2, sourceVersion: 1, learnersConsented: true },
      }).movedStudentIds,
      ['s3'],
    )
    assert.throws(
      () =>
        planGroupMerge({
          learnerBirthDates: {},
          ...ctx({ groups: [target, { ...source, state: 'cancelled' }] }),
          groupId: G1,
          input: { sourceGroupId: G2, sourceVersion: 1 },
        }),
      isDomainError('group_closed', 'conflict'),
    )
  })
})

describe('yerleştirme kuralı (ON-058 sözleşmesi; DOM-DIL-040, -041, -045)', () => {
  const ADULT = { studentId: 's-new', birthDate: '1990-01-01', placementLevel: 'B1' as const }
  const place = (overrides: Partial<Parameters<typeof planGroupPlacement>[0]> = {}) =>
    planGroupPlacement({
      institutionType: LANG,
      actorRole: 'onburo',
      courses: [course()],
      groups: [group()],
      members: [],
      waitlist: [],
      groupId: G1,
      learner: ADULT,
      input: { studentId: 's-new' },
      now: NOW,
      ...overrides,
    })

  test('uygun kursiyer aktif üyelik olarak döner', () => {
    assert.deepEqual(place(), { groupId: G1, studentId: 's-new', status: 'active', joinedAt: NOW })
    assert.throws(
      () => place({ institutionType: 'school' }),
      isDomainError('module_unavailable_for_type', 'not_found'),
    )
  })

  test('mükerrer: aynı grup ve aynı kurun başka grubu 409', () => {
    assert.throws(
      () => place({ members: [member('s-new')] }),
      isDomainError('group_member_exists', 'conflict'),
    )
    assert.throws(
      () =>
        place({
          groups: [group(), group({ id: G2, name: 'B1 Sabah', schedule: [] })],
          members: [member('s-new', G2)],
        }),
      isDomainError('group_member_same_course', 'conflict'),
    )
  })

  test('DOM-DIL-040 dolu grup reddedilir; kursiyerin kendi teklifi yer sayılır', () => {
    const full = { groups: [group({ capacity: 1 })], members: [member('s1')] }
    assert.throws(() => place(full), isDomainError('group_full'))
    const offer = entry({
      studentId: 's-new',
      status: 'offered',
      offerGroupId: G1,
      offeredAt: NOW,
      offerExpiresAt: '2026-10-08T09:00:00.000Z',
    })
    assert.throws(
      () => place({ groups: [group({ capacity: 1 })], waitlist: [{ ...offer, studentId: 's-x' }] }),
      isDomainError('group_full'),
    )
    assert.equal(place({ groups: [group({ capacity: 1 })], waitlist: [offer] }).studentId, 's-new')
  })

  test('DOM-DIL-041 seviye istisnası yalnız öğretmen ya da yönetici gerekçesiyle', () => {
    const a2 = { ...ADULT, placementLevel: 'A2' as const }
    const reasoned = { studentId: 's-new', levelReason: 'Öğretmen önerisi' }
    assert.throws(() => place({ learner: a2 }), isDomainError('group_level_mismatch'))
    assert.throws(
      () => place({ learner: { ...ADULT, placementLevel: null } }),
      isDomainError('group_level_mismatch'),
    )
    // Ön büro gerekçe yazsa da seviye istisnası yapamaz.
    assert.throws(
      () => place({ learner: a2, input: reasoned }),
      isDomainError('group_level_mismatch'),
    )
    for (const actorRole of ['ogretmen', 'yonetici'] as const)
      assert.equal(place({ learner: a2, input: reasoned, actorRole }).groupId, G1)
  })

  test('DOM-DIL-041 yaş bandı: çocuk, genç 12–17, yetişkin; istisna yalnız yönetici gerekçesiyle', () => {
    const teen = { ...ADULT, birthDate: '2010-05-05' }
    const child = { ...ADULT, birthDate: '2016-01-01' }
    const approved = { studentId: 's-new', ageReason: 'Veli ve rehber onayı' }
    assert.throws(() => place({ learner: teen }), isDomainError('group_age_band_mismatch'))
    assert.throws(
      () => place({ learner: teen, input: approved }),
      isDomainError('group_age_band_mismatch'),
    )
    // İstisna 1: 18 yaş altı yetişkin grubuna; istisna 2: yetişkin genç grubuna.
    assert.equal(place({ learner: teen, input: approved, actorRole: 'yonetici' }).groupId, G1)
    const teenGroup = { groups: [group({ ageBand: 'teen' })] }
    assert.throws(() => place(teenGroup), isDomainError('group_age_band_mismatch'))
    assert.equal(place({ ...teenGroup, input: approved, actorRole: 'yonetici' }).groupId, G1)
    assert.equal(place({ ...teenGroup, learner: teen }).groupId, G1)
    // Çocuk–genç geçişi ve yetişkinin çocuk grubu istisna değildir: yönetici gerekçesi de yetmez.
    const childGroup = { groups: [group({ ageBand: 'child' })] }
    for (const overrides of [
      { ...childGroup, learner: teen },
      { ...childGroup, learner: ADULT },
      { ...teenGroup, learner: child },
    ])
      assert.throws(
        () => place({ ...overrides, input: approved, actorRole: 'yonetici' }),
        isDomainError('group_age_band_mismatch'),
      )
    assert.equal(place({ ...childGroup, learner: child }).groupId, G1)
    assert.throws(
      () => place({ learner: { ...ADULT, birthDate: null } }),
      isDomainError('learner_birth_date_required'),
    )
  })

  test('DOM-DIL-003 18 yaş altı 21.00 sonrası grupta yok; DOM-DIL-045 kursiyerin saatleri çakışmaz', () => {
    const late = group({ schedule: [...SCHEDULE.slice(0, 3), { weekday: 5, startTime: '21:00' }] })
    assert.throws(
      () =>
        place({
          groups: [late],
          learner: { ...ADULT, birthDate: '2010-05-05' },
          input: { studentId: 's-new', ageReason: 'Onay' },
          actorRole: 'yonetici',
        }),
      isDomainError('group_minor_late'),
    )
    const otherCourse = course({ id: OTHER_COURSE_ID, totalHours: 3, weeklyHours: 1 })
    const ielts = group({
      id: G2,
      courseId: OTHER_COURSE_ID,
      name: 'IELTS',
      schedule: [{ weekday: 1, startTime: '18:30' }],
    })
    assert.throws(
      () =>
        place({
          courses: [course(), otherCourse],
          groups: [group(), ielts],
          members: [member('s-new', G2)],
        }),
      isDomainError('learner_schedule_conflict'),
    )
    assert.equal(
      place({
        courses: [course(), otherCourse],
        groups: [group(), { ...ielts, schedule: [{ weekday: 2, startTime: '18:30' }] }],
        members: [member('s-new', G2)],
      }).groupId,
      G1,
    )
    assert.throws(
      () => place({ groups: [group({ state: 'cancelled' })] }),
      isDomainError('group_closed', 'conflict'),
    )
  })
})

describe('bekleme listesi (DOM-DIL-043)', () => {
  test('sıra grubun ve kurun grupsuz bekleyenleridir; boş yer kadar 48 saatlik teklif önerilir', () => {
    const waitlist = [
      entry({ id: 'w-3', requestedAt: '2026-10-03T09:00:00.000Z' }),
      entry({ id: 'w-1', groupId: null, requestedAt: '2026-10-01T09:00:00.000Z' }),
      entry({
        id: 'w-2',
        requestedAt: '2026-10-02T09:00:00.000Z',
        studentId: null,
        prospectId: 'p1',
      }),
      entry({ id: 'w-x', groupId: G2 }),
      entry({ id: 'w-y', groupId: null, courseId: OTHER_COURSE_ID }),
      entry({ id: 'w-z', status: 'withdrawn' }),
      entry({
        id: 'w-old',
        status: 'offered',
        offerGroupId: G1,
        offeredAt: '2026-10-01T09:00:00.000Z',
        offerExpiresAt: '2026-10-03T09:00:00.000Z',
      }),
    ]
    const g = group({ capacity: 3 })
    assert.deepEqual(
      waitlistQueue(g, waitlist).map((item) => item.id),
      ['w-1', 'w-2', 'w-3'],
    )
    const suggestion = suggestWaitlistOffers({
      group: g,
      members: [member('s1')],
      waitlist,
      now: NOW,
    })
    assert.deepEqual(suggestion, {
      expire: ['w-old'],
      offers: [
        { entryId: 'w-1', offerExpiresAt: '2026-10-08T09:00:00.000Z' },
        { entryId: 'w-2', offerExpiresAt: '2026-10-08T09:00:00.000Z' },
      ],
    })
    assert.deepEqual(groupOccupancy(g, [member('s1')], waitlist, NOW), {
      active: 1,
      frozen: 0,
      offers: 0,
      free: 2,
    })
    assert.deepEqual(
      suggestWaitlistOffers({
        group: group({ state: 'cancelled' }),
        members: [],
        waitlist,
        now: NOW,
      }).offers,
      [],
    )
  })
})

describe('okuma kapsamı ve görünüm (IST-077)', () => {
  test('her rolün kapsamı: personel hepsini, öğretmen kendi/koordinatör grubunu, öğrenci ve veli kendi grubunu', () => {
    const members = [member('s-deniz')]
    const reader = (role: Role, extra: Partial<Parameters<typeof canReadGroup>[0]> = {}) => ({
      role,
      membershipId: 'm-1',
      coordination: NO_COORDINATOR_SCOPE,
      studentIds: [],
      ...extra,
    })
    const g = group()
    const c = course()
    assert.equal(canReadGroup(reader('yonetici'), g, c, members), true)
    assert.equal(canReadGroup(reader('onburo'), g, c, members), true)
    assert.equal(canReadGroup(reader('ogretmen'), g, c, members), false)
    assert.equal(canReadGroup(reader('ogretmen', { membershipId: 't-selin' }), g, c, members), true)
    assert.equal(
      canReadGroup(
        reader('ogretmen', { coordination: B1_COORDINATOR.coordination }),
        g,
        c,
        members,
      ),
      true,
    )
    assert.equal(canReadGroup(reader('ogrenci', { studentIds: ['s-deniz'] }), g, c, members), true)
    assert.equal(canReadGroup(reader('ogrenci', { studentIds: ['s-ece'] }), g, c, members), false)
    assert.equal(
      canReadGroup(reader('veli', { studentIds: ['s-ece', 's-deniz'] }), g, c, members),
      true,
    )
    assert.equal(canReadGroup(reader('veli'), g, c, members), false)
  })

  test('öğrenci ve veli daraltılmış alanları görür', () => {
    const staff = groupView(group(), course(), 'onburo', [member('s1')], [], NOW)
    assert.equal('capacity' in staff && staff.capacity, 10)
    assert.equal('freeSeats' in staff && staff.freeSeats, 9)
    for (const role of ['ogrenci', 'veli'] as const) {
      const view = groupView(group(), course(), role, [member('s1')], [], NOW)
      assert.deepEqual(Object.keys(view).sort(), [
        'ageBand',
        'courseId',
        'courseName',
        'delivery',
        'endDate',
        'id',
        'level',
        'name',
        'room',
        'schedule',
        'sessionMinutes',
        'startDate',
        'status',
      ])
    }
  })

  test('DOM-DIL-008 yetki tablosu: beş rol okur, yönetici ve öğretmen yönetir, sırayı yönetici ve ön büro okur; okulda 404', () => {
    const source: AuthorizationSource = {
      modules: {},
      students: [],
      classes: [],
      teachers: [],
      assignments: [],
      clubs: [],
      mockExams: [],
    }
    for (const action of ['group.read', 'group.manage', 'group.waitlist'] as const)
      assert.equal(OPERATION_COMMANDS[action].module, null)
    for (const role of ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'] as const) {
      const actor = { role, links: [] }
      const options = { institutionType: LANG }
      assert.equal(authorize(actor, 'group.read', {}, source, options).allowed, true)
      assert.equal(
        authorize(actor, 'group.manage', {}, source, options).allowed,
        role === 'yonetici' || role === 'ogretmen',
      )
      assert.equal(
        authorize(actor, 'group.waitlist', {}, source, options).allowed,
        role === 'yonetici' || role === 'onburo',
      )
      const school = authorize(actor, 'group.read', {}, source, { institutionType: 'school' })
      assert.equal(!school.allowed && school.kind, 'not_found')
    }
  })
})

describe('kur arşivi (DOM-DIL-008, OG-028 takibi)', () => {
  test('kapanmamış grubu olan kur arşivlenmez', () => {
    const groups = [group(), group({ id: G2, name: 'Eski', state: 'cancelled' })]
    const blocking = groupsBlockingCourseArchive(groups, COURSE_ID, NOW)
    assert.deepEqual(blocking, [{ courseId: COURSE_ID, name: 'B1 Akşam', capacity: 10 }])
    const archive = (openGroups: { courseId: string; name: string }[]) =>
      planCourseArchive({
        institutionType: LANG,
        manager: ADMIN,
        courses: [course()],
        courseId: COURSE_ID,
        now: NOW,
        openGroups,
      })
    assert.throws(() => archive(blocking), isDomainError('course_has_open_groups'))
    // Tamamlanan grup arşivi engellemez.
    const done = groupsBlockingCourseArchive(
      [group({ state: 'open' })],
      COURSE_ID,
      '2026-11-01T09:00:00.000Z',
    )
    assert.equal(archive(done).status, 'archived')
  })
})

describe('inceleme düzeltmeleri (OG-029)', () => {
  test('DOM-DIL-008 en çok mevcut kapanmamış grubun kapasitesinin altına inmez', () => {
    const update = (maxLearners: number, groups: LanguageGroup[]) =>
      planCourseUpdate({
        institutionType: LANG,
        manager: ADMIN,
        courses: [course()],
        courseId: COURSE_ID,
        input: { maxLearners },
        openGroups: groupsBlockingCourseArchive(groups, COURSE_ID, NOW),
      })
    assert.throws(() => update(9, [group()]), isDomainError('course_max_below_group_capacity'))
    assert.equal(update(10, [group()]).course.maxLearners, 10)
    assert.equal(update(9, [group({ state: 'cancelled' })]).course.maxLearners, 9)
    // Eski kapasite kurun üstünde kalsa da kapasiteye dokunmayan değişiklik geçer.
    const legacy = group({ capacity: 14 })
    const context = ctx({ groups: [legacy] })
    assert.equal(
      planGroupUpdate({ ...context, groupId: G1, input: { name: 'B1 Yeni' } }).group.name,
      'B1 Yeni',
    )
    assert.throws(
      () => planGroupUpdate({ ...context, groupId: G1, input: { capacity: 13 } }),
      isDomainError('group_capacity_exceeds_course'),
    )
  })

  test('DOM-DIL-042 açılmış grubun öğretmeni ve yüz yüzede dersliği boşaltılamaz', () => {
    const opened = group({ state: 'open', openedAt: NOW })
    // Açık (başlamamış) ve devam eden grup.
    for (const now of [NOW, '2026-10-14T09:00:00.000Z']) {
      const context = ctx({ groups: [opened], now })
      unchangedOnFailure(
        context,
        () => planGroupUpdate({ ...context, groupId: G1, input: { teacherMembershipId: null } }),
        'group_teacher_required',
      )
      unchangedOnFailure(
        context,
        () => planGroupUpdate({ ...context, groupId: G1, input: { room: null } }),
        'group_room_required',
      )
      assert.equal(
        planGroupUpdate({ ...context, groupId: G1, input: { delivery: 'online' } }).group.room,
        null,
      )
    }
    // Planlanan grupta öğretmen ve derslik sonradan atanabilir.
    assert.equal(
      planGroupUpdate({ ...ctx({ groups: [group()] }), groupId: G1, input: { room: null } }).group
        .room,
      null,
    )
  })

  test('DOM-DIL-042 başlangıcı geçmiş planlanan grup açılmaz, ileri tarihe alınır, kur arşivini engeller', () => {
    const later = '2026-10-20T09:00:00.000Z'
    const stale = group()
    const context = ctx({ groups: [stale], now: later })
    assert.equal(groupStatus(stale, later), 'planned')
    assert.throws(
      () => planGroupOpen({ ...context, groupId: G1 }),
      isDomainError('group_start_passed'),
    )
    const moved = planGroupUpdate({ ...context, groupId: G1, input: { startDate: '2026-10-26' } })
    assert.equal(moved.group.endDate, '2026-11-11')
    assert.throws(
      () => planGroupUpdate({ ...context, groupId: G1, input: { startDate: '2026-10-19' } }),
      isDomainError('group_start_passed'),
    )
    // Kursiyeri varsa tarih sözleşmedir: birleştirme ya da iptal.
    assert.throws(
      () =>
        planGroupUpdate({
          ...ctx({ groups: [stale], members: [member('s1')], now: later }),
          groupId: G1,
          input: { startDate: '2026-10-26' },
        }),
      isDomainError('group_schedule_locked'),
    )
    assert.equal(groupsBlockingCourseArchive([stale], COURSE_ID, later).length, 1)
  })

  test('DOM-DIL-042 birleştirmede taşınan kursiyerin saatleri ve 21.00 sınırı denetlenir', () => {
    const target = group()
    const source = group({ id: G2, name: 'B1 Akşam 2', teacherMembershipId: 't-can', room: 'D2' })
    const otherCourse = course({ id: OTHER_COURSE_ID, totalHours: 3, weeklyHours: 1 })
    const ielts = group({
      id: NEW,
      courseId: OTHER_COURSE_ID,
      name: 'IELTS',
      teacherMembershipId: 't-can',
      room: 'D3',
      schedule: [{ weekday: 3, startTime: '18:30' }],
    })
    const conflicting = ctx({
      courses: [course(), otherCourse],
      groups: [target, source, ielts],
      members: [member('s3', G2), member('s3', NEW)],
    })
    unchangedOnFailure(
      conflicting,
      () =>
        planGroupMerge({
          ...conflicting,
          learnerBirthDates: {},
          groupId: G1,
          input: { sourceGroupId: G2, sourceVersion: 1, learnersConsented: true },
        }),
      'learner_schedule_conflict',
    )
    const late = group({ schedule: [...SCHEDULE.slice(0, 3), { weekday: 5, startTime: '21:00' }] })
    const lateCtx = ctx({ groups: [late, source], members: [member('s3', G2)] })
    const merge = (learnerBirthDates: Record<string, string | null>) =>
      planGroupMerge({
        ...lateCtx,
        learnerBirthDates,
        groupId: G1,
        input: { sourceGroupId: G2, sourceVersion: 1, learnersConsented: true },
      })
    assert.throws(() => merge({ s3: '2010-05-05' }), isDomainError('group_minor_late'))
    assert.throws(() => merge({}), isDomainError('learner_birth_date_required'))
    assert.deepEqual(merge({ s3: '1990-01-01' }).movedStudentIds, ['s3'])
  })
})
