import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  assertInvitationPending,
  assertStaffInvitation,
  isStaffRole,
  planStaffActivation,
  planStaffRoleChange,
  staffInvitationInputSchema,
  type StaffMember,
} from '../packages/school-core/src/lib/staff-accounts.ts'

const admin: StaffMember = { id: 'm-admin', role: 'yonetici', deactivated: false }
const admin2: StaffMember = { id: 'm-admin2', role: 'yonetici', deactivated: false }
const teacher: StaffMember = { id: 'm-teacher', role: 'ogretmen', deactivated: false }
const student: StaffMember = { id: 'm-student', role: 'ogrenci', deactivated: false }

function code(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    if (error instanceof DomainError) return `${error.kind}:${error.code}`
    throw error
  }
  return undefined
}

describe('personel hesapları (DOM-YTK-070)', () => {
  test('DOM-YTK-070: personel rolleri yönetici, öğretmen ve ön büro', () => {
    assert.ok(isStaffRole('yonetici'))
    assert.ok(isStaffRole('onburo'))
    assert.ok(!isStaffRole('veli'))
  })

  test('DOM-YTK-070: davet girdisi e-postayı küçültür, öğretmen kaydı yalnız öğretmen rolünde', () => {
    const parsed = staffInvitationInputSchema.parse({
      email: ' Selin.Kaya@Example.COM ',
      name: ' Selin Kaya ',
      role: 'ogretmen',
      teacherId: 't-1',
    })
    assert.equal(parsed.email, 'selin.kaya@example.com')
    assert.equal(parsed.name, 'Selin Kaya')
    const wrong = staffInvitationInputSchema.safeParse({
      email: 'a@example.com',
      name: 'Ali',
      role: 'onburo',
      teacherId: 't-1',
    })
    assert.equal(wrong.success, false)
    assert.deepEqual(wrong.error?.issues[0]?.path, ['teacherId'])
    assert.equal(
      staffInvitationInputSchema.safeParse({ email: 'a@example.com', name: 'Ali', role: 'veli' })
        .success,
      false,
    )
    assert.equal(
      staffInvitationInputSchema.safeParse({ email: 'yok', name: 'Ali', role: 'onburo' }).success,
      false,
    )
  })

  test('DOM-YTK-070: rol değişikliği; aynı rol yazmaz, öğrenci reddedilir', () => {
    const members = [admin, admin2, teacher]
    assert.deepEqual(
      planStaffRoleChange({
        actorMembershipId: admin.id,
        target: teacher,
        members,
        role: 'onburo',
      }),
      { from: 'ogretmen', to: 'onburo' },
    )
    assert.equal(
      planStaffRoleChange({
        actorMembershipId: admin.id,
        target: teacher,
        members,
        role: 'ogretmen',
      }),
      null,
    )
    assert.equal(
      code(() =>
        planStaffRoleChange({
          actorMembershipId: admin.id,
          target: student,
          members,
          role: 'onburo',
        }),
      ),
      'rule:member_not_staff',
    )
  })

  test('DOM-YTK-070: kendi rolünü değiştiremez, son etkin yönetici düşürülemez', () => {
    assert.equal(
      code(() =>
        planStaffRoleChange({
          actorMembershipId: admin.id,
          target: admin,
          members: [admin, admin2],
          role: 'ogretmen',
        }),
      ),
      'rule:self_role_change',
    )
    const passiveAdmin = { ...admin2, deactivated: true }
    assert.equal(
      code(() =>
        planStaffRoleChange({
          actorMembershipId: 'm-other',
          target: admin,
          members: [admin, passiveAdmin],
          role: 'ogretmen',
        }),
      ),
      'rule:last_admin',
    )
    assert.deepEqual(
      planStaffRoleChange({
        actorMembershipId: admin.id,
        target: admin2,
        members: [admin, admin2],
        role: 'onburo',
      }),
      { from: 'yonetici', to: 'onburo' },
    )
    assert.equal(
      code(() =>
        planStaffRoleChange({
          actorMembershipId: admin.id,
          target: { ...teacher, deactivated: true },
          members: [admin],
          role: 'onburo',
        }),
      ),
      'rule:member_deactivated',
    )
  })

  test('DOM-YTK-070: pasifleştirme ve geri alma; mükerrer işlem yazmaz', () => {
    const members = [admin, teacher]
    assert.equal(
      planStaffActivation({ actorMembershipId: admin.id, target: teacher, members, active: false }),
      true,
    )
    assert.equal(
      planStaffActivation({
        actorMembershipId: admin.id,
        target: { ...teacher, deactivated: true },
        members,
        active: false,
      }),
      false,
    )
    assert.equal(
      planStaffActivation({
        actorMembershipId: admin.id,
        target: { ...teacher, deactivated: true },
        members,
        active: true,
      }),
      true,
    )
    assert.equal(
      planStaffActivation({ actorMembershipId: admin.id, target: teacher, members, active: true }),
      false,
    )
    assert.equal(
      code(() =>
        planStaffActivation({ actorMembershipId: admin.id, target: admin, members, active: false }),
      ),
      'rule:self_deactivate',
    )
    assert.equal(
      code(() =>
        planStaffActivation({ actorMembershipId: 'm-x', target: admin, members, active: false }),
      ),
      'rule:last_admin',
    )
    // Kendi hesabı geri almada da reddedilir (pasif yöneticinin bekleyen kendi isteği).
    assert.equal(
      code(() =>
        planStaffActivation({
          actorMembershipId: admin.id,
          target: { ...admin, deactivated: true },
          members,
          active: true,
        }),
      ),
      'rule:self_reactivate',
    )
    assert.equal(
      code(() =>
        planStaffActivation({ actorMembershipId: admin.id, target: admin, members, active: true }),
      ),
      'rule:self_reactivate',
    )
    assert.equal(
      code(() =>
        planStaffActivation({
          actorMembershipId: admin.id,
          target: student,
          members,
          active: false,
        }),
      ),
      'rule:member_not_staff',
    )
  })

  test('DOM-YTK-070: davet ön koşulları ve iptal', () => {
    assert.equal(
      code(() =>
        assertStaffInvitation({
          alreadyMember: false,
          pendingInvitation: false,
          teacherLinked: false,
        }),
      ),
      undefined,
    )
    assert.equal(
      code(() =>
        assertStaffInvitation({
          alreadyMember: true,
          pendingInvitation: false,
          teacherLinked: false,
        }),
      ),
      'conflict:member_exists',
    )
    assert.equal(
      code(() =>
        assertStaffInvitation({
          alreadyMember: false,
          pendingInvitation: true,
          teacherLinked: false,
        }),
      ),
      'conflict:invitation_exists',
    )
    assert.equal(
      code(() =>
        assertStaffInvitation({
          alreadyMember: false,
          pendingInvitation: false,
          teacherLinked: true,
        }),
      ),
      'conflict:teacher_already_linked',
    )
    assert.equal(
      code(() => assertInvitationPending('pending')),
      undefined,
    )
    assert.equal(
      code(() => assertInvitationPending('canceled')),
      'conflict:invitation_not_pending',
    )
  })
})
