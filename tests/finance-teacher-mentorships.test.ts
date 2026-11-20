import assert from 'node:assert/strict'
import test from 'node:test'

import {
  checklistProgress,
  DEFAULT_MENTORSHIP_CHECKLIST,
  MENTOR_ROLES,
  mentorshipAddDays,
  mentorshipCompleteSchema,
  mentorshipContact,
  mentorshipCreateSchema,
  mentorshipDaysBetween,
  mentorshipEndSchema,
  mentorshipMeetingSchema,
  mentorshipOverdueBefore,
  mentorshipSettingsSchema,
  mentorshipSummary,
  planChecklistItemComplete,
  planChecklistItemReopen,
  planMentorship,
  planMentorshipComplete,
  planMentorshipEnd,
  planMentorshipMeeting,
  planMentorshipMeetingArchive,
  TEACHER_MENTORSHIP_ROLES,
  type MentorshipChecks,
} from '../packages/school-core/src/lib/finance-teacher-mentorships.ts'

import { isDomainError } from './support/domain-error.ts'

// Yeni öğretmen mentorluğu (DOM-FIN-136; ON-219). Kararlar K-463…K-465.

const TODAY = '2026-11-21'
const INPUT = mentorshipCreateSchema.parse({
  mentorMembershipId: 'm-mentor',
  menteeMembershipId: 'm-mentee',
  startDate: '2026-09-01',
  endDate: '2027-06-30',
})
const checks = (over: Partial<MentorshipChecks> = {}): MentorshipChecks => ({
  mentor: { membershipId: 'm-mentor', role: 'ogretmen', active: true },
  mentee: { membershipId: 'm-mentee', role: 'ogretmen', active: true },
  menteeHasActive: false,
  mentorActiveCount: 0,
  maxActivePerMentor: 3,
  onboarding: undefined,
  checklist: DEFAULT_MENTORSHIP_CHECKLIST,
  ...over,
})
const ACTIVE = { status: 'active' as const, startDate: '2026-09-01' }
const CLOSED = { status: 'completed' as const, startDate: '2026-09-01' }
const ITEM_OPEN = { required: true, completedAt: null }
const ITEM_DONE = { required: true, completedAt: '2026-10-01T09:00:00.000Z' }

test('DOM-FIN-136 K-465: okuma ve yazma yalnız yönetici; mentor öğretmen ya da yönetici', () => {
  assert.deepEqual(TEACHER_MENTORSHIP_ROLES, ['yonetici'])
  assert.deepEqual(MENTOR_ROLES, ['ogretmen', 'yonetici'])
})

test('DOM-FIN-136 K-463: eşleşme kurum ayarındaki maddeleri kopyalar', () => {
  const items = planMentorship(INPUT, checks())
  assert.equal(items.length, DEFAULT_MENTORSHIP_CHECKLIST.length)
  assert.equal(items.filter((item) => item.required).length, 4)
  assert.notEqual(items[0], DEFAULT_MENTORSHIP_CHECKLIST[0])
  const manager = planMentorship(
    INPUT,
    checks({ mentor: { membershipId: 'm-mentor', role: 'yonetici', active: true } }),
  )
  assert.equal(manager.length, 5)
  assert.equal(INPUT.onboardingOfferId, null)
})

test('DOM-FIN-136 K-463: kişi, rol, etkinlik ve aynı kişi reddedilir', () => {
  const cases: [Partial<MentorshipChecks>, string][] = [
    [{ mentor: null }, 'mentorship_mentor_not_found'],
    [
      { mentor: { membershipId: 'm-mentor', role: 'onburo', active: true } },
      'mentorship_mentor_invalid',
    ],
    [
      { mentor: { membershipId: 'm-mentor', role: 'ogretmen', active: false } },
      'mentorship_mentor_invalid',
    ],
    [{ mentee: null }, 'mentorship_mentee_not_found'],
    [
      { mentee: { membershipId: 'm-mentee', role: 'yonetici', active: true } },
      'mentorship_mentee_not_teacher',
    ],
    [
      { mentee: { membershipId: 'm-mentee', role: 'ogretmen', active: false } },
      'mentorship_mentee_inactive',
    ],
    [{ mentee: { membershipId: 'm-mentor', role: 'ogretmen', active: true } }, 'mentorship_self'],
  ]
  for (const [over, code] of cases)
    assert.throws(() => planMentorship(INPUT, checks(over)), isDomainError(code))
})

test('DOM-FIN-136 K-463: bitiş başlangıçtan sonra ve en çok 366 gün', () => {
  assert.throws(
    () => planMentorship({ ...INPUT, endDate: INPUT.startDate }, checks()),
    isDomainError('mentorship_dates_invalid'),
  )
  assert.throws(
    () => planMentorship({ ...INPUT, endDate: '2027-09-03' }, checks()),
    isDomainError('mentorship_too_long'),
  )
  assert.equal(planMentorship({ ...INPUT, endDate: '2027-09-02' }, checks()).length, 5)
})

test('DOM-FIN-136 K-463: süren eşleşme 409, mentor sınırı 422', () => {
  assert.throws(
    () => planMentorship(INPUT, checks({ menteeHasActive: true })),
    isDomainError('mentorship_mentee_has_active', 'conflict'),
  )
  assert.throws(
    () => planMentorship(INPUT, checks({ mentorActiveCount: 3 })),
    (error: unknown) =>
      isDomainError('mentorship_mentor_limit')(error) &&
      error instanceof Error &&
      error.message.includes('en çok 3'),
  )
  assert.equal(planMentorship(INPUT, checks({ mentorActiveCount: 2 })).length, 5)
})

test('DOM-FIN-136 K-463: işe başlama listesi kabul edilmiş ve yeni öğretmenin hesabına bağlı olmalı', () => {
  assert.throws(
    () => planMentorship(INPUT, checks({ onboarding: null })),
    isDomainError('mentorship_onboarding_not_found'),
  )
  assert.throws(
    () =>
      planMentorship(INPUT, checks({ onboarding: { status: 'sent', membershipId: 'm-mentee' } })),
    isDomainError('mentorship_onboarding_mismatch'),
  )
  assert.throws(
    () =>
      planMentorship(
        INPUT,
        checks({ onboarding: { status: 'accepted', membershipId: 'm-other' } }),
      ),
    isDomainError('mentorship_onboarding_mismatch'),
  )
  assert.equal(
    planMentorship(INPUT, checks({ onboarding: { status: 'accepted', membershipId: 'm-mentee' } }))
      .length,
    5,
  )
})

test('DOM-FIN-136 K-464: görüşme yalnız süren eşleşmeye, başlangıçla bugün arasında', () => {
  const meeting = mentorshipMeetingSchema.parse({
    meetingDate: '2026-10-01',
    durationMinutes: 45,
    topic: ' Ders planı ',
    note: '',
    nextStep: 'Gözlem',
  })
  assert.equal(meeting.topic, 'Ders planı')
  assert.equal(meeting.note, null)
  planMentorshipMeeting(ACTIVE, meeting, TODAY)
  planMentorshipMeeting(ACTIVE, { meetingDate: ACTIVE.startDate }, TODAY)
  assert.throws(
    () => planMentorshipMeeting(CLOSED, meeting, TODAY),
    isDomainError('mentorship_closed', 'conflict'),
  )
  assert.throws(
    () => planMentorshipMeeting(ACTIVE, { meetingDate: '2026-11-22' }, TODAY),
    isDomainError('mentorship_meeting_date_future'),
  )
  assert.throws(
    () => planMentorshipMeeting(ACTIVE, { meetingDate: '2026-08-31' }, TODAY),
    isDomainError('mentorship_meeting_before_start'),
  )
  planMentorshipMeetingArchive(ACTIVE)
  assert.throws(
    () => planMentorshipMeetingArchive(CLOSED),
    isDomainError('mentorship_closed', 'conflict'),
  )
  for (const bad of [
    { durationMinutes: 4 },
    { durationMinutes: 481 },
    { durationMinutes: 30.5 },
    { topic: 'a' },
    { note: 'x'.repeat(4001) },
    { nextStep: 'x'.repeat(501) },
  ])
    assert.equal(
      mentorshipMeetingSchema.safeParse({
        meetingDate: '2026-10-01',
        durationMinutes: 30,
        topic: 'Konu',
        ...bad,
      }).success,
      false,
    )
})

test('DOM-FIN-136 K-465: madde tamamla ve geri al yalnız süren eşleşmede', () => {
  planChecklistItemComplete(ACTIVE, ITEM_OPEN)
  planChecklistItemReopen(ACTIVE, ITEM_DONE)
  assert.throws(
    () => planChecklistItemComplete(ACTIVE, ITEM_DONE),
    isDomainError('mentorship_item_completed'),
  )
  assert.throws(
    () => planChecklistItemReopen(ACTIVE, ITEM_OPEN),
    isDomainError('mentorship_item_not_completed'),
  )
  assert.throws(
    () => planChecklistItemComplete(CLOSED, ITEM_OPEN),
    isDomainError('mentorship_closed', 'conflict'),
  )
  assert.throws(
    () => planChecklistItemReopen({ status: 'ended_early' }, ITEM_DONE),
    isDomainError('mentorship_closed', 'conflict'),
  )
})

test('DOM-FIN-136 K-463 K-465: tamamlama görüşme ve zorunlu maddeleri ister', () => {
  const facts = { meetingCount: 1, items: [ITEM_DONE, { required: false, completedAt: null }] }
  planMentorshipComplete(ACTIVE, facts, TODAY, TODAY)
  assert.throws(
    () => planMentorshipComplete(ACTIVE, { ...facts, meetingCount: 0 }, TODAY, TODAY),
    isDomainError('mentorship_no_meetings'),
  )
  assert.throws(
    () =>
      planMentorshipComplete(
        ACTIVE,
        { meetingCount: 2, items: [ITEM_OPEN, ITEM_OPEN] },
        TODAY,
        TODAY,
      ),
    (error: unknown) =>
      isDomainError('mentorship_checklist_incomplete')(error) &&
      error instanceof Error &&
      error.message.includes('2 zorunlu'),
  )
  assert.throws(
    () => planMentorshipComplete(ACTIVE, facts, '2026-11-22', TODAY),
    isDomainError('mentorship_close_date_future'),
  )
  assert.throws(
    () => planMentorshipComplete(ACTIVE, facts, '2026-08-31', TODAY),
    isDomainError('mentorship_close_before_start'),
  )
  assert.throws(
    () => planMentorshipComplete(CLOSED, facts, TODAY, TODAY),
    isDomainError('mentorship_closed', 'conflict'),
  )
  assert.equal(mentorshipCompleteSchema.safeParse({ closedOn: '2026-02-30' }).success, false)
})

test('DOM-FIN-136 K-463: erken sonlandırma gerekçe ister; kapanan eşleşme değişmez', () => {
  planMentorshipEnd(ACTIVE, TODAY, TODAY)
  assert.throws(
    () => planMentorshipEnd({ status: 'ended_early', startDate: '2026-09-01' }, TODAY, TODAY),
    isDomainError('mentorship_closed', 'conflict'),
  )
  assert.throws(
    () => planMentorshipEnd(ACTIVE, '2026-08-01', TODAY),
    isDomainError('mentorship_close_before_start'),
  )
  assert.equal(mentorshipEndSchema.safeParse({ closedOn: TODAY, reason: 'kısa' }).success, false)
  assert.equal(mentorshipEndSchema.safeParse({ closedOn: TODAY }).success, false)
  assert.equal(
    mentorshipEndSchema.parse({ closedOn: TODAY, reason: '  Kurumdan ayrıldı ' }).reason,
    'Kurumdan ayrıldı',
  )
})

test('DOM-FIN-136 K-465: 30 günü aşan görüşmesizlik gecikmedir; başlamamış ve kapanmış izlenmez', () => {
  assert.deepEqual(mentorshipContact(ACTIVE, '2026-10-22', TODAY), {
    lastMeetingDate: '2026-10-22',
    daysSinceContact: 30,
    overdue: false,
  })
  assert.equal(mentorshipContact(ACTIVE, '2026-10-21', TODAY).overdue, true)
  assert.equal(mentorshipContact(ACTIVE, null, TODAY).daysSinceContact, 81)
  assert.equal(mentorshipContact(ACTIVE, null, TODAY).overdue, true)
  assert.deepEqual(mentorshipContact({ status: 'active', startDate: '2026-12-01' }, null, TODAY), {
    lastMeetingDate: null,
    daysSinceContact: 0,
    overdue: false,
  })
  assert.deepEqual(mentorshipContact(CLOSED, '2026-09-02', TODAY), {
    lastMeetingDate: '2026-09-02',
    daysSinceContact: null,
    overdue: false,
  })
  // SQL süzgecinin sınırı: son temas bu günden önceyse gecikmiş.
  assert.equal(mentorshipOverdueBefore(TODAY), '2026-10-22')
  assert.equal(mentorshipDaysBetween('2026-02-27', mentorshipAddDays('2026-02-27', 3)), 3)
})

test('DOM-FIN-136 K-465: tamamlanma oranı ve kurum özeti', () => {
  assert.deepEqual(checklistProgress([]), {
    total: 0,
    done: 0,
    requiredTotal: 0,
    requiredDone: 0,
    percent: null,
  })
  assert.deepEqual(
    checklistProgress([ITEM_DONE, ITEM_OPEN, { required: false, completedAt: 'x' }]),
    {
      total: 3,
      done: 2,
      requiredTotal: 2,
      requiredDone: 1,
      percent: 67,
    },
  )
  assert.deepEqual(
    mentorshipSummary([
      { status: 'active', overdue: true, checklist: { total: 4, done: 1 } },
      { status: 'active', overdue: false, checklist: { total: 4, done: 3 } },
      { status: 'completed', overdue: false, checklist: { total: 4, done: 4 } },
      { status: 'ended_early', overdue: false, checklist: { total: 4, done: 0 } },
    ]),
    { active: 2, overdue: 1, completed: 1, endedEarly: 1, activeChecklistPercent: 50 },
  )
  assert.equal(mentorshipSummary([]).activeChecklistPercent, null)
})

test('DOM-FIN-136 K-463 K-465: ayar sınırı 1–10, en çok 20 madde, aynı madde iki kez yok', () => {
  const ok = mentorshipSettingsSchema.parse({
    maxActivePerMentor: 2,
    checklistItems: [{ label: ' Tanışma ', required: true }],
  })
  assert.equal(ok.checklistItems[0]?.label, 'Tanışma')
  assert.equal(
    mentorshipSettingsSchema.safeParse({ maxActivePerMentor: 0, checklistItems: [] }).success,
    false,
  )
  assert.equal(
    mentorshipSettingsSchema.safeParse({ maxActivePerMentor: 11, checklistItems: [] }).success,
    false,
  )
  const duplicate = mentorshipSettingsSchema.safeParse({
    maxActivePerMentor: 2,
    checklistItems: [
      { label: 'Tanışma', required: true },
      { label: 'TANIŞMA', required: false },
    ],
  })
  assert.equal(duplicate.success, false)
  assert.deepEqual(duplicate.error?.issues[0]?.path, ['checklistItems', 1, 'label'])
  assert.equal(
    mentorshipSettingsSchema.safeParse({
      maxActivePerMentor: 2,
      checklistItems: Array.from({ length: 21 }, (_, index) => ({
        label: `Madde ${String(index)}`,
        required: false,
      })),
    }).success,
    false,
  )
  assert.equal(
    mentorshipCreateSchema.safeParse({ ...INPUT, institutionId: 'kurum-b' }).success,
    false,
  )
  assert.equal(
    mentorshipCreateSchema.safeParse({ ...INPUT, onboardingOfferId: 'x' }).success,
    false,
  )
})
