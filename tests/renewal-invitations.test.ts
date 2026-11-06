import assert from 'node:assert/strict'
import test from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  invitableStudentIds,
  isRenewalPlanned,
  planRenewalInvitationResponse,
  planRenewalInvitations,
  RENEWAL_INVITATION_MAX_STUDENTS,
  RENEWAL_INVITATION_NOTE_MAX,
  RENEWAL_INVITATION_STATUS_LABELS,
  RENEWAL_INVITATION_STATUSES,
  renewalInvitationAccess,
  renewalInvitationStatus,
  renewalInvitationStudentIds,
} from '../packages/school-core/src/lib/renewal-invitations.ts'
import { notificationSubject } from '../packages/school-core/src/lib/notifications.ts'
import { notificationTypeSpec } from '../packages/school-core/src/modules/notification-types.ts'

/** Yenileme daveti kuralları (K-10; DOM-KAY-027, IST-100). */

const YEAR = 2027

function state(over: Record<string, unknown> = {}) {
  return {
    academicYear: 2026,
    students: [
      { id: 's1', classId: 'c6', isActive: true },
      { id: 's2', classId: 'c6', isActive: true },
      { id: 'pasif', classId: 'c6', isActive: false },
      { id: 'son', classId: 'c12', isActive: true },
    ],
    classes: [
      { id: 'c6', grade: 6 },
      { id: 'c12', grade: 12 },
    ],
    renewals: [] as { studentId: string; year: number; status: string }[],
    ...over,
  } as unknown as Parameters<typeof planRenewalInvitations>[0]
}

function context(invited: readonly string[] = []) {
  let serial = 0
  return {
    invitedStudentIds: new Set(invited),
    makeId: () => {
      serial += 1
      return `inv-${String(serial)}`
    },
  }
}

const rejects = (run: () => unknown, code: string, kind: string) =>
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })

test('DOM-KAY-027: seçili öğrencilere davet planlanır; yinelenen öğrenci tek davettir', () => {
  const plan = planRenewalInvitations(
    state(),
    { academicYear: YEAR, studentIds: ['s1', 's2', 's1'] },
    context(),
  )
  assert.equal(plan.academicYear, YEAR)
  assert.deepEqual(plan.invitations, [
    { id: 'inv-1', studentId: 's1' },
    { id: 'inv-2', studentId: 's2' },
  ])
})

test('DOM-KAY-027: aynı öğrenci ve yıla ikinci davet 409; toplu açmada hiçbiri planlanmaz', () => {
  rejects(
    () =>
      planRenewalInvitations(
        state(),
        { academicYear: YEAR, studentIds: ['s1', 's2'] },
        context(['s2']),
      ),
    'renewal_invitation_exists',
    'conflict',
  )
})

test('DOM-KAY-027: planı yapılmış öğrenciye davet açılmaz; iptal edilen plan engellemez', () => {
  const planned = state({ renewals: [{ studentId: 's1', year: YEAR, status: 'Planlandı' }] })
  rejects(
    () => planRenewalInvitations(planned, { academicYear: YEAR, studentIds: ['s1'] }, context()),
    'renewal_invitation_already_planned',
    'conflict',
  )
  const cancelled = state({ renewals: [{ studentId: 's1', year: YEAR, status: 'İptal' }] })
  assert.equal(
    planRenewalInvitations(cancelled, { academicYear: YEAR, studentIds: ['s1'] }, context())
      .invitations.length,
    1,
  )
  const otherYear = state({ renewals: [{ studentId: 's1', year: YEAR - 1, status: 'Planlandı' }] })
  assert.equal(
    planRenewalInvitations(otherYear, { academicYear: YEAR, studentIds: ['s1'] }, context())
      .invitations.length,
    1,
  )
})

test('DOM-KAY-027: geçmiş yıl, bilinmeyen, pasif ve son sınıf öğrencisi reddedilir', () => {
  rejects(
    () => planRenewalInvitations(state(), { academicYear: 2026, studentIds: ['s1'] }, context()),
    'renewal_year_invalid',
    'rule',
  )
  rejects(
    () => planRenewalInvitations(state(), { academicYear: YEAR, studentIds: ['yok'] }, context()),
    'student_not_found',
    'not_found',
  )
  rejects(
    () => planRenewalInvitations(state(), { academicYear: YEAR, studentIds: ['pasif'] }, context()),
    'renewal_invitation_student_inactive',
    'conflict',
  )
  rejects(
    () => planRenewalInvitations(state(), { academicYear: YEAR, studentIds: ['son'] }, context()),
    'renewal_invitation_final_grade',
    'rule',
  )
})

test('DOM-KAY-027: form davet açılamayacak öğrenciyi sunmaz; süzgeç planla aynıdır', () => {
  const source = state({ renewals: [{ studentId: 's2', year: YEAR, status: 'Planlandı' }] })
  assert.deepEqual(invitableStudentIds(source, YEAR, new Set()), ['s1'])
  assert.deepEqual(invitableStudentIds(source, YEAR, new Set(['s1'])), [])
  assert.deepEqual(invitableStudentIds(source, YEAR + 1, new Set()), ['s1', 's2'])
})

test('DOM-KAY-027: gövde doğrulanır; boş seçim, sınırı aşan seçim ve bilinmeyen alan reddedilir', () => {
  for (const body of [
    { academicYear: YEAR, studentIds: [] },
    {
      academicYear: YEAR,
      studentIds: Array.from(
        { length: RENEWAL_INVITATION_MAX_STUDENTS + 1 },
        (_, i) => `s${String(i)}`,
      ),
    },
    { academicYear: YEAR, studentIds: ['s1'], institutionId: 'b' },
    { studentIds: ['s1'] },
  ])
    assert.throws(() => planRenewalInvitations(state(), body, context()))
})

test('DOM-KAY-027, K-04: yanıt ödeyici velinindir; velayetli olup ödeyici olmayan görür, bağsız görmez', () => {
  const child = { kind: 'child', recordId: 's1' }
  const payer = { kind: 'payer', recordId: 's1' }
  assert.equal(renewalInvitationAccess([child, payer], 's1'), 'respond')
  assert.equal(renewalInvitationAccess([payer], 's1'), 'respond')
  assert.equal(renewalInvitationAccess([child], 's1'), 'read')
  assert.equal(renewalInvitationAccess([child, payer], 's2'), 'none')
  assert.equal(renewalInvitationAccess([{ kind: 'student', recordId: 's1' }], 's1'), 'none')
  assert.deepEqual(
    renewalInvitationStudentIds([child, payer, { kind: 'payer', recordId: 's2' }]).sort(),
    ['s1', 's2'],
  )
  assert.deepEqual(renewalInvitationStudentIds([{ kind: 'teacher', recordId: 't1' }]), [])
})

test('DOM-KAY-027: ödeyici yanıt verir, not kırpılır ve boş not saklanmaz; yanıt değiştirilebilir', () => {
  const invitation = { studentId: 's1', academicYear: YEAR }
  assert.deepEqual(
    planRenewalInvitationResponse(
      state(),
      invitation,
      { response: 'will_renew', note: '  Görüşelim.  ' },
      'respond',
    ),
    { response: 'will_renew', note: 'Görüşelim.' },
  )
  assert.deepEqual(
    planRenewalInvitationResponse(
      state(),
      invitation,
      { response: 'will_not_renew', note: '   ' },
      'respond',
    ),
    { response: 'will_not_renew', note: null },
  )
  assert.deepEqual(
    planRenewalInvitationResponse(state(), invitation, { response: 'will_renew' }, 'respond'),
    { response: 'will_renew', note: null },
  )
})

test('DOM-KAY-027: ödeyici olmayan 403, kapsam dışı 404; pasif öğrenci ve plan sonrası 409', () => {
  const invitation = { studentId: 's1', academicYear: YEAR }
  const body = { response: 'will_renew' }
  rejects(
    () => planRenewalInvitationResponse(state(), invitation, body, 'read'),
    'renewal_invitation_payer_only',
    'forbidden',
  )
  rejects(
    () => planRenewalInvitationResponse(state(), invitation, body, 'none'),
    'renewal_invitation_not_found',
    'not_found',
  )
  rejects(
    () =>
      planRenewalInvitationResponse(
        state(),
        { studentId: 'pasif', academicYear: YEAR },
        body,
        'respond',
      ),
    'renewal_invitation_student_inactive',
    'conflict',
  )
  rejects(
    () =>
      planRenewalInvitationResponse(
        state({ renewals: [{ studentId: 's1', year: YEAR, status: 'Tamamlandı' }] }),
        invitation,
        body,
        'respond',
      ),
    'renewal_invitation_planned',
    'conflict',
  )
})

test('DOM-KAY-027: yanıt gövdesi doğrulanır; uzun not ve bilinmeyen yanıt reddedilir', () => {
  const invitation = { studentId: 's1', academicYear: YEAR }
  for (const body of [
    {},
    { response: 'belki' },
    { response: 'will_renew', note: 'x'.repeat(RENEWAL_INVITATION_NOTE_MAX + 1) },
    { response: 'will_renew', contractId: 'c' },
  ])
    assert.throws(() => planRenewalInvitationResponse(state(), invitation, body, 'respond'))
})

test('DOM-KAY-027: durum yanıt ve plandan türer; plan yanıttan önce gelir, yenilemeyecek planı engellemez', () => {
  assert.equal(renewalInvitationStatus({ response: null }, false), 'pending')
  assert.equal(renewalInvitationStatus({ response: 'will_renew' }, false), 'will_renew')
  assert.equal(renewalInvitationStatus({ response: 'will_not_renew' }, false), 'will_not_renew')
  assert.equal(renewalInvitationStatus({ response: 'will_not_renew' }, true), 'planned')
  assert.equal(renewalInvitationStatus({ response: null }, true), 'planned')
  assert.equal(isRenewalPlanned([], 's1', YEAR), false)
  for (const status of RENEWAL_INVITATION_STATUSES)
    assert.ok(RENEWAL_INVITATION_STATUS_LABELS[status].length > 0)
})

test('DOM-ILT-023, K-10: davet bildirimi yalnız kimlik taşır, renewal modülüne bağlı, veliye gider', () => {
  const spec = notificationTypeSpec('renewal_invited')
  assert.ok(spec)
  assert.equal(spec.module, 'renewal')
  assert.equal(spec.category, 'service')
  assert.deepEqual(spec.audiences, { minor: ['parent'], adult: [] })
  assert.deepEqual(notificationSubject('renewal_invited', { invitationId: 'i1' }).subject, {
    type: 'renewal_invitations',
    id: 'i1',
  })
  assert.throws(() =>
    notificationSubject('renewal_invited', { invitationId: 'i1', amountCents: 1 } as never),
  )
  assert.doesNotMatch(spec.titles.parent, /₺|tutar|taksit/i)
})
