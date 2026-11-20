import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertDecision,
  assertFinalize,
  assertFollowUp,
  assertMeetingDateFitsDecisions,
  assertMeetingEditable,
  assertMeetingPerson,
  attendanceCounts,
  departmentDecisionFollowUpSchema,
  departmentDecisionInputSchema,
  departmentMeetingFinalizeSchema,
  departmentMeetingInputSchema,
  DEPARTMENT_MEETING_MEMBER_ROLES,
  FINANCE_DEPARTMENT_MEETING_ROLES,
  isDecisionOverdue,
  mergeAgenda,
  numberDecisions,
  overdueDays,
} from '../packages/school-core/src/lib/finance-department-meetings.ts'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'

/** Zümre toplantısı tutanağı kuralları (DOM-FIN-132; ON-217; K-451…K-453). */

const AGENDA_A = '00000000-0000-4000-8000-00000000000a'
const AGENDA_B = '00000000-0000-4000-8000-00000000000b'

const BASE = {
  subjectId: 'math',
  kind: 'term_start',
  meetingDate: '2026-09-10',
  location: 'Öğretmenler odası',
  chairMembershipId: 'm-chair',
  agenda: [{ title: 'Açılış ve yoklama' }, { title: 'Yıllık planların incelenmesi' }],
  attendees: [
    { membershipId: 'm-chair', status: 'attended' },
    { membershipId: 'm-2', status: 'excused' },
  ],
}

const codeOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof DomainError)
    return error.code
  }
  return null
}
const issuePaths = (input: unknown) => {
  const result = departmentMeetingInputSchema.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
}

test('DOM-FIN-132: K-451 tutanağı yalnız yönetici yazar ve okur; kişiler öğretmen ya da yönetici', () => {
  assert.deepEqual([...FINANCE_DEPARTMENT_MEETING_ROLES], ['yonetici'])
  assert.deepEqual([...DEPARTMENT_MEETING_MEMBER_ROLES], ['yonetici', 'ogretmen'])
})

test('DOM-FIN-132: toplantı gövdesi gündemi ve katılımı doğrular, boş görüşme null olur', () => {
  const parsed = departmentMeetingInputSchema.parse({
    ...BASE,
    agenda: [{ title: '  Açılış  ', discussion: '' }],
  })
  assert.deepEqual(parsed.agenda, [{ id: null, title: 'Açılış', discussion: null }])
  assert.equal(parsed.location, 'Öğretmenler odası')

  assert.deepEqual(issuePaths({ ...BASE, agenda: [] }), ['agenda'])
  assert.deepEqual(issuePaths({ ...BASE, attendees: [] }), ['attendees', 'chairMembershipId'])
  assert.deepEqual(issuePaths({ ...BASE, kind: 'weekly' }), ['kind'])
  assert.deepEqual(issuePaths({ ...BASE, meetingDate: '2026-13-01' }), ['meetingDate'])
  assert.deepEqual(issuePaths({ ...BASE, location: 'x' }), ['location'])
  assert.deepEqual(issuePaths({ ...BASE, institutionId: 'b' }), [''])
  assert.deepEqual(
    issuePaths({
      ...BASE,
      agenda: [
        { id: AGENDA_A, title: 'Bir' },
        { id: AGENDA_A, title: 'İki' },
      ],
    }),
    ['agenda.1.id'],
  )
  assert.deepEqual(
    issuePaths({
      ...BASE,
      attendees: [...BASE.attendees, { membershipId: 'm-2', status: 'absent' }],
    }),
    ['attendees.2.membershipId'],
  )
  assert.deepEqual(issuePaths({ ...BASE, chairMembershipId: 'm-2' }), ['chairMembershipId'])
  assert.deepEqual(issuePaths({ ...BASE, chairMembershipId: 'm-yok' }), ['chairMembershipId'])
})

test('DOM-FIN-132: karar, takip ve kesinleştirme gövdeleri', () => {
  const decision = departmentDecisionInputSchema.parse({
    agendaItemId: AGENDA_A,
    text: 'Ortak sınav takvimi hazırlanacak.',
    responsibleMembershipId: 'm-2',
  })
  assert.equal(decision.dueDate, null)
  assert.equal(
    departmentDecisionInputSchema.safeParse({ ...decision, agendaItemId: 'x' }).success,
    false,
  )
  assert.equal(departmentDecisionInputSchema.safeParse({ ...decision, text: 'x' }).success, false)

  assert.deepEqual(departmentDecisionFollowUpSchema.parse({ status: 'completed' }), {
    status: 'completed',
    followUpNote: null,
  })
  const cancelled = departmentDecisionFollowUpSchema.safeParse({ status: 'cancelled' })
  assert.equal(cancelled.success, false)
  assert.deepEqual(
    cancelled.error?.issues.map((issue) => issue.path.join('.')),
    ['followUpNote'],
  )
  assert.equal(
    departmentDecisionFollowUpSchema.safeParse({
      status: 'cancelled',
      followUpNote: 'Gerek kalmadı',
    }).success,
    true,
  )
  assert.equal(
    departmentMeetingFinalizeSchema.safeParse({ signedDate: '2026-09-10' }).success,
    true,
  )
  assert.equal(departmentMeetingFinalizeSchema.safeParse({}).success, false)
})

test('DOM-FIN-132: K-453 kesinleşmiş tutanak değişmez', () => {
  assert.equal(
    codeOf(() => assertMeetingEditable('draft')),
    null,
  )
  assert.equal(
    codeOf(() => assertMeetingEditable('finalized')),
    'department_meeting_finalized',
  )
})

test('DOM-FIN-132: K-452 başkan, katılımcı ve sorumlu kurumun etkin öğretmen ya da yöneticisi', () => {
  const check = (staff: { role: string; active: boolean } | null, alreadyListed = false) =>
    codeOf(() => assertMeetingPerson({ staff, alreadyListed, path: ['attendees', 0] }))
  assert.equal(check({ role: 'ogretmen', active: true }), null)
  assert.equal(check({ role: 'yonetici', active: true }), null)
  assert.equal(check(null), 'department_meeting_staff_not_found')
  assert.equal(check({ role: 'onburo', active: true }), 'department_meeting_not_staff')
  assert.equal(check({ role: 'veli', active: true }), 'department_meeting_not_staff')
  assert.equal(check({ role: 'ogretmen', active: false }), 'department_meeting_staff_inactive')
  assert.equal(check({ role: 'ogretmen', active: false }, true), null)
  try {
    assertMeetingPerson({
      staff: null,
      alreadyListed: false,
      path: ['attendees', 2, 'membershipId'],
    })
  } catch (error) {
    assert.ok(error instanceof DomainError)
    assert.deepEqual(error.path, ['attendees', '2', 'membershipId'])
  }
})

test('DOM-FIN-132: K-452 gündem birleştirme kimliği korur, kararlı maddeyi silmez', () => {
  const previous = [
    { id: AGENDA_A, title: 'Açılış', discussion: null },
    { id: AGENDA_B, title: 'Planlar', discussion: null },
  ]
  let next = 0
  const newId = () => `new-${String((next += 1))}`
  const merged = mergeAgenda({
    previous,
    next: [
      { id: AGENDA_B, title: 'Yıllık planlar', discussion: 'Görüşüldü' },
      { id: null, title: 'Dilek ve temenniler', discussion: null },
      { id: AGENDA_A, title: 'Açılış', discussion: null },
    ],
    usedIds: new Set([AGENDA_B]),
    newId,
  })
  assert.deepEqual(
    merged.map((item) => [item.id, item.title]),
    [
      [AGENDA_B, 'Yıllık planlar'],
      ['new-1', 'Dilek ve temenniler'],
      [AGENDA_A, 'Açılış'],
    ],
  )
  assert.equal(
    codeOf(() =>
      mergeAgenda({
        previous,
        next: [{ id: AGENDA_A, title: 'Açılış', discussion: null }],
        usedIds: new Set([AGENDA_B]),
        newId,
      }),
    ),
    'department_meeting_agenda_in_use',
  )
  assert.equal(
    mergeAgenda({
      previous,
      next: [{ id: AGENDA_A, title: 'Açılış', discussion: null }],
      usedIds: new Set(),
      newId,
    }).length,
    1,
  )
  assert.equal(
    codeOf(() =>
      mergeAgenda({
        previous,
        next: [{ id: '00000000-0000-4000-8000-0000000000ff', title: 'Yabancı', discussion: null }],
        usedIds: new Set(),
        newId,
      }),
    ),
    'department_meeting_agenda_unknown',
  )
})

test('DOM-FIN-132: K-452 karar gündem maddesine bağlı, termin toplantıdan önce olamaz', () => {
  const agenda = [{ id: AGENDA_A, title: 'Açılış', discussion: null }]
  const check = (agendaItemId: string, dueDate: string | null) =>
    codeOf(() => assertDecision({ agenda, agendaItemId, meetingDate: '2026-09-10', dueDate }))
  assert.equal(check(AGENDA_A, null), null)
  assert.equal(check(AGENDA_A, '2026-09-10'), null)
  assert.equal(check(AGENDA_B, null), 'department_meeting_agenda_not_found')
  assert.equal(check(AGENDA_A, '2026-09-09'), 'department_meeting_due_before_meeting')

  assert.equal(
    codeOf(() => assertMeetingDateFitsDecisions('2026-09-10', null)),
    null,
  )
  assert.equal(
    codeOf(() => assertMeetingDateFitsDecisions('2026-09-10', '2026-09-30')),
    null,
  )
  assert.equal(
    codeOf(() => assertMeetingDateFitsDecisions('2026-10-01', '2026-09-30')),
    'department_meeting_due_before_meeting',
  )
})

test('DOM-FIN-132: K-453 kesinleştirme imza günü toplantı ile bugün arasında', () => {
  const check = (status: 'draft' | 'finalized', signedDate: string) =>
    codeOf(() =>
      assertFinalize({ status, meetingDate: '2026-09-10', signedDate, today: '2026-09-15' }),
    )
  assert.equal(check('draft', '2026-09-10'), null)
  assert.equal(check('draft', '2026-09-15'), null)
  assert.equal(check('draft', '2026-09-09'), 'department_meeting_signed_before_meeting')
  assert.equal(check('draft', '2026-09-16'), 'department_meeting_signed_in_future')
  assert.equal(check('finalized', '2026-09-12'), 'department_meeting_finalized')
})

test('DOM-FIN-132: K-453 takip yalnız kesinleşmiş tutanakta, iptal edilen karar kapanır', () => {
  assert.equal(
    codeOf(() => assertFollowUp({ meetingStatus: 'finalized', from: 'open' })),
    null,
  )
  assert.equal(
    codeOf(() => assertFollowUp({ meetingStatus: 'finalized', from: 'completed' })),
    null,
  )
  assert.equal(
    codeOf(() => assertFollowUp({ meetingStatus: 'draft', from: 'open' })),
    'department_meeting_not_finalized',
  )
  assert.equal(
    codeOf(() => assertFollowUp({ meetingStatus: 'finalized', from: 'cancelled' })),
    'department_decision_cancelled',
  )
})

test('DOM-FIN-132: K-453 termini geçmiş açık karar ve gecikme günü', () => {
  const today = '2026-10-05'
  assert.equal(isDecisionOverdue({ status: 'open', dueDate: '2026-10-04' }, today), true)
  assert.equal(isDecisionOverdue({ status: 'open', dueDate: '2026-10-05' }, today), false)
  assert.equal(isDecisionOverdue({ status: 'open', dueDate: null }, today), false)
  assert.equal(isDecisionOverdue({ status: 'completed', dueDate: '2026-09-01' }, today), false)
  assert.equal(isDecisionOverdue({ status: 'cancelled', dueDate: '2026-09-01' }, today), false)
  assert.equal(overdueDays({ status: 'open', dueDate: '2026-09-30' }, today), 5)
  assert.equal(overdueDays({ status: 'open', dueDate: null }, today), 0)
  assert.equal(overdueDays({ status: 'completed', dueDate: '2026-09-30' }, today), 0)
})

test('DOM-FIN-132: K-452 karar numarası gündem sırası ve açılış sırasından hesaplanır', () => {
  const agenda = [{ id: AGENDA_B }, { id: AGENDA_A }]
  const numbered = numberDecisions(agenda, [
    { id: 'd3', agendaItemId: AGENDA_A, createdAt: '2026-09-10T09:00:00.000Z' },
    { id: 'd2', agendaItemId: AGENDA_B, createdAt: '2026-09-10T10:00:00.000Z' },
    { id: 'd1', agendaItemId: AGENDA_B, createdAt: '2026-09-10T09:30:00.000Z' },
    { id: 'd4', agendaItemId: 'kayip', createdAt: '2026-09-10T08:00:00.000Z' },
  ])
  assert.deepEqual(
    numbered.map((decision) => [decision.id, decision.number]),
    [
      ['d1', '1.1'],
      ['d2', '1.2'],
      ['d3', '2.1'],
      ['d4', '0.1'],
    ],
  )
})

test('DOM-FIN-132: katılım sayıları', () => {
  assert.deepEqual(
    attendanceCounts([
      { status: 'attended' },
      { status: 'attended' },
      { status: 'excused' },
      { status: 'absent' },
    ]),
    { attended: 2, absent: 1, excused: 1 },
  )
})
