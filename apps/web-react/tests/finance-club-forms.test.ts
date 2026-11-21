import assert from 'node:assert/strict'
import test from 'node:test'

import type { ClubDetail, ClubRow } from '@kampus/react-shared/use-finance-clubs.ts'

import {
  attendanceBody,
  attendanceDefaults,
  clubCreateBody,
  clubDefaults,
  clubFormField,
  clubFormSchema,
  clubUpdateBody,
  countsText,
  quotaText,
  scheduleText,
} from '../src/pages/finance/finance-club-forms.ts'

// Kulüpler sekmesinin saf mantığı (DOM-FIN-142; ON-098; K-483).

const issuesOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? []

const club: ClubRow = {
  id: 'c1',
  name: 'Bilim ve Robotik',
  teacherMembershipId: 'm-t',
  teacherName: 'Selin Kaya',
  capacity: 18,
  memberCount: 2,
  meetingDay: 3,
  startTime: '15:30',
  endTime: '16:30',
  version: 4,
}

test('DOM-FIN-142: kulüp formu saat sırasını ister, düzenleme yalnız değişeni gönderir (K-483)', () => {
  const values = clubDefaults(club)
  assert.equal(clubFormSchema.safeParse(values).success, true)
  assert.deepEqual(issuesOf(clubFormSchema.safeParse({ ...values, endTime: '15:00' })), ['endTime'])
  assert.deepEqual(issuesOf(clubFormSchema.safeParse({ ...clubDefaults(), name: 'Satranç' })), [
    'teacherMembershipId',
    'capacity',
    'meetingDay',
    'startTime',
    'endTime',
  ])
  assert.deepEqual(clubCreateBody(values), {
    name: 'Bilim ve Robotik',
    teacherMembershipId: 'm-t',
    capacity: 18,
    meetingDay: 3,
    startTime: '15:30',
    endTime: '16:30',
  })
  assert.equal(clubUpdateBody(values, club), null)
  assert.deepEqual(clubUpdateBody({ ...values, capacity: '20', meetingDay: '4' }, club), {
    capacity: 20,
    meetingDay: 4,
  })
  assert.equal(clubFormField('capacity'), 'capacity')
  assert.equal(clubFormField('institutionId'), null)
  assert.equal(scheduleText(club), 'Çarşamba 15:30–16:30')
  assert.equal(quotaText(club), '2/18')
})

test('DOM-FIN-142: yoklama taslağı her üyeyi "geldi" ile başlatır (K-483)', () => {
  const members: ClubDetail['members'] = [
    {
      id: 'mb1',
      studentId: 's1',
      studentName: 'Deniz',
      joinedAt: '2026-10-01T09:00:00.000Z',
      sessionCount: 0,
      presentCount: 0,
      version: 1,
    },
    {
      id: 'mb2',
      studentId: 's2',
      studentName: 'Ece',
      joinedAt: '2026-10-01T09:00:00.000Z',
      sessionCount: 0,
      presentCount: 0,
      version: 1,
    },
  ]
  const marks = { ...attendanceDefaults(members), mb2: 'excused' as const }
  assert.deepEqual(attendanceBody('2026-10-06', marks), {
    sessionDate: '2026-10-06',
    marks: [
      { memberId: 'mb1', status: 'present' },
      { memberId: 'mb2', status: 'excused' },
    ],
  })
  assert.equal(countsText({ present: 1, absent: 0, excused: 1 }), '1 geldi · 0 gelmedi · 1 izinli')
})
