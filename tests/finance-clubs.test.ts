import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  assertClubArchivable,
  assertClubTeacher,
  clubAttendanceCounts,
  clubAttendanceSchema,
  clubCreateSchema,
  clubMemberAddSchema,
  clubScheduleLabel,
  clubUpdateSchema,
  planClub,
  planClubAttendance,
  planClubMember,
  planClubUpdate,
  type StoredClubFields,
} from '../packages/school-core/src/lib/finance-clubs.ts'

/** Kulüp, üyelik ve kulüp yoklaması kuralları (DOM-FIN-142; ON-098; K-483). */

const M1 = '00000000-0000-4000-8000-000000000001'
const M2 = '00000000-0000-4000-8000-000000000002'

function rejects(fn: () => unknown, code: string, kind: 'rule' | 'conflict' = 'rule') {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })
}

const club = {
  name: ' Bilim ve Robotik ',
  teacherMembershipId: 'm-teacher',
  capacity: 18,
  meetingDay: 3,
  startTime: '15:30',
  endTime: '16:30',
}

describe('DOM-FIN-142: kulüp şeması ve kuralı (K-483)', () => {
  test('geçerli kulüp; saat sırası, gün ve kontenjan sınırı', () => {
    const parsed = clubCreateSchema.parse(club)
    assert.equal(parsed.name, 'Bilim ve Robotik')
    for (const bad of [
      { ...club, endTime: '15:30' },
      { ...club, meetingDay: 8 },
      { ...club, capacity: 0 },
      { ...club, capacity: 201 },
      { ...club, startTime: '25:00' },
      { ...club, institutionId: 'b' },
    ])
      assert.equal(clubCreateSchema.safeParse(bad).success, false)
    assert.equal(clubUpdateSchema.safeParse({}).success, false)
    assert.equal(clubMemberAddSchema.safeParse({ studentId: '' }).success, false)
    assert.equal(clubScheduleLabel(3, '15:30', '16:30'), 'Çarşamba 15:30–16:30')
  })

  test('ad tekil, sorumlu etkin öğretmen', () => {
    rejects(() => planClub({ teacher: undefined, nameTaken: true }), 'club_name_taken', 'conflict')
    rejects(() => assertClubTeacher(null), 'club_teacher_not_found')
    rejects(() => assertClubTeacher({ role: 'yonetici', active: true }), 'club_teacher_not_teacher')
    rejects(() => assertClubTeacher({ role: 'ogretmen', active: false }), 'club_teacher_inactive')
    planClub({ teacher: { role: 'ogretmen', active: true }, nameTaken: false })
  })

  test('düzenleme: değişiklik, saat sırası ve kontenjan', () => {
    const current: StoredClubFields = { ...club, name: 'Bilim ve Robotik' }
    const checks = { teacher: undefined, nameTaken: false, activeMembers: 5 }
    rejects(() => planClubUpdate(current, { capacity: 18 }, checks), 'club_unchanged')
    rejects(() => planClubUpdate(current, { endTime: '15:00' }, checks), 'club_time_order')
    rejects(() => planClubUpdate(current, { capacity: 4 }, checks), 'club_capacity_below_members')
    rejects(
      () => planClubUpdate(current, { name: 'Satranç' }, { ...checks, nameTaken: true }),
      'club_name_taken',
      'conflict',
    )
    rejects(
      () => planClubUpdate(current, { teacherMembershipId: 'm-2' }, { ...checks, teacher: null }),
      'club_teacher_not_found',
    )
    const plan = planClubUpdate(current, { capacity: 5, meetingDay: 4 }, checks)
    assert.deepEqual(plan.changed, ['capacity', 'meetingDay'])
    rejects(() => assertClubArchivable(1), 'club_has_members')
    assertClubArchivable(0)
  })
})

describe('DOM-FIN-142: üyelik ve yoklama (K-483)', () => {
  test('üyelik: etkin öğrenci, tek üyelik, kontenjan', () => {
    const checks = {
      student: { active: true },
      alreadyMember: false,
      activeMembers: 1,
      capacity: 2,
    }
    planClubMember(checks)
    rejects(() => planClubMember({ ...checks, student: null }), 'club_student_not_found')
    rejects(
      () => planClubMember({ ...checks, student: { active: false } }),
      'club_student_inactive',
    )
    rejects(
      () => planClubMember({ ...checks, alreadyMember: true }),
      'club_member_exists',
      'conflict',
    )
    rejects(() => planClubMember({ ...checks, activeMembers: 2 }), 'club_capacity_full', 'conflict')
  })

  test('yoklama: gelecek gün, üyesiz kulüp, eksik ve yabancı işaret, yinelenen oturum', () => {
    const input = clubAttendanceSchema.parse({
      sessionDate: '2026-10-06',
      marks: [
        { memberId: M1, status: 'present' },
        { memberId: M2, status: 'excused' },
      ],
    })
    const checks = { today: '2026-10-06', activeMemberIds: new Set([M1, M2]), sessionExists: false }
    planClubAttendance(input, checks)
    rejects(
      () => planClubAttendance({ ...input, sessionDate: '2026-10-07' }, checks),
      'club_session_future',
    )
    rejects(
      () => planClubAttendance(input, { ...checks, activeMemberIds: new Set() }),
      'club_no_members',
    )
    rejects(
      () => planClubAttendance(input, { ...checks, activeMemberIds: new Set([M1]) }),
      'club_attendance_unknown_member',
    )
    rejects(
      () =>
        planClubAttendance(
          { ...input, marks: input.marks.slice(0, 1) },
          { ...checks, activeMemberIds: new Set([M1, M2]) },
        ),
      'club_attendance_incomplete',
    )
    rejects(
      () => planClubAttendance(input, { ...checks, sessionExists: true }),
      'club_session_exists',
      'conflict',
    )
    assert.equal(
      clubAttendanceSchema.safeParse({
        sessionDate: '2026-10-06',
        marks: [
          { memberId: M1, status: 'present' },
          { memberId: M1, status: 'absent' },
        ],
      }).success,
      false,
    )
    assert.deepEqual(clubAttendanceCounts(input.marks), { present: 1, absent: 0, excused: 1 })
  })
})
