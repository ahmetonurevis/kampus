import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GuardianInvitation } from '@kampus/react-shared/guardian-invitations.ts'
import { learnerWords } from '@kampus/school-core/lib/enrollment-learner.ts'
import {
  canManageGuardianAccounts,
  enrollmentParentId,
  focusableField,
  guardianAccountBody,
  guardianAccountDefaults,
  guardianAccountErrorMessage,
  guardianAccountFieldFor,
  guardianAccountFormSchema,
  guardianAccountStudents,
  guardianInvitationRow,
  hasPendingInvitation,
  isGuardianRecord,
  memberExistsMessage,
} from '../src/pages/crm/enrollment-guardian-account.ts'

const NOW = Date.parse('2026-11-04T09:00:00.000Z')

const invitation = (overrides: Partial<GuardianInvitation> = {}): GuardianInvitation => ({
  id: 'gi-1',
  name: 'Ayşe Yılmaz',
  email: 'ayse@kampus.example',
  role: 'veli',
  status: 'pending',
  studentIds: ['s-1'],
  parentId: 'p-1',
  createdAt: '2026-11-03T08:30:00.000Z',
  expiresAt: '2026-11-10T08:30:00.000Z',
  ...overrides,
})

test('ON-290, DOM-YTK-071: form veli kaydının adı ve e-postasıyla, kayıttaki öğrenci seçili açılır', () => {
  assert.deepEqual(
    guardianAccountDefaults({ name: 'Ayşe Yılmaz', email: 'ayse@kampus.example' }, 's-1'),
    { name: 'Ayşe Yılmaz', email: 'ayse@kampus.example', studentIds: ['s-1'] },
  )
  // E-postası olmayan veli kaydında alan boş gelir, personel girer.
  assert.deepEqual(guardianAccountDefaults({ name: 'Ayşe Yılmaz' }, 's-1'), {
    name: 'Ayşe Yılmaz',
    email: '',
    studentIds: ['s-1'],
  })
  assert.deepEqual(guardianAccountDefaults(null, 's-1'), {
    name: '',
    email: '',
    studentIds: ['s-1'],
  })
})

test('ON-290, DOM-YTK-071: gövde veli kaydını her zaman taşır; form core şemasıyla doğrulanır', () => {
  const parsed = guardianAccountFormSchema.parse({
    name: '  Ayşe Yılmaz ',
    email: 'AYSE@kampus.example',
    studentIds: ['s-1', 's-2'],
  })
  const body = guardianAccountBody(parsed, 'p-1')
  assert.equal(body.parentId, 'p-1')
  assert.deepEqual(body.studentIds, ['s-1', 's-2'])
  assert.equal(guardianAccountFormSchema.safeParse({ ...parsed, studentIds: [] }).success, false)
  assert.equal(
    guardianAccountFormSchema.safeParse({ ...parsed, studentIds: ['s-1', 's-1'] }).success,
    false,
  )
  assert.equal(guardianAccountFormSchema.safeParse({ ...parsed, email: 'eposta' }).success, false)
})

test('ON-290: kayıttaki öğrenci başta, kardeşler ada göre; tekrar eden öğrenci bir kez', () => {
  assert.deepEqual(
    guardianAccountStudents({ id: 's-1', name: 'Deniz Yılmaz' }, [
      { id: 's-3', name: 'Zeynep Yılmaz' },
      { id: 's-1', name: 'Deniz Yılmaz' },
      { id: 's-2', name: 'Ece Yılmaz' },
    ]),
    [
      { id: 's-1', name: 'Deniz Yılmaz' },
      { id: 's-2', name: 'Ece Yılmaz' },
      { id: 's-3', name: 'Zeynep Yılmaz' },
    ],
  )
  assert.deepEqual(guardianAccountStudents({ id: 's-1', name: 'Deniz' }, []), [
    { id: 's-1', name: 'Deniz' },
  ])
})

test('ON-290, DOM-KAY-012: kesin kayıt yanıtından veli kaydı; kursiyerin kendisinde veli yok', () => {
  const records = [
    { collection: 'students', id: 's-9' },
    { collection: 'parents', id: 'p-9' },
    { collection: 'contracts', id: 'contract-9' },
  ]
  assert.equal(enrollmentParentId('new', '', records), 'p-9')
  assert.equal(enrollmentParentId('existing', 'p-1', records), 'p-1')
  assert.equal(enrollmentParentId('existing', '', records), null)
  assert.equal(enrollmentParentId('self', '', records), null)
  assert.equal(enrollmentParentId('new', '', [{ collection: 'students', id: 's-9' }]), null)
  assert.equal(isGuardianRecord({ relationship: 'self' }), false)
  assert.equal(isGuardianRecord({ relationship: 'mother' }), true)
  assert.equal(isGuardianRecord({}), true)
  assert.equal(isGuardianRecord(null), false)
})

test('ON-290, DOM-YTK-071: hata kodları alana gider; member_exists yöneticiye yönlendirir', () => {
  assert.equal(guardianAccountFieldFor({ code: 'member_exists' }), 'email')
  assert.equal(guardianAccountFieldFor({ code: 'invitation_exists' }), 'email')
  assert.equal(guardianAccountFieldFor({ code: 'guardian_record_not_linked' }), 'studentIds')
  assert.equal(guardianAccountFieldFor({ code: 'guardian_link_exists' }), 'root.server')
  assert.equal(guardianAccountFieldFor({ code: 'guardian_identity_mismatch' }), 'root.server')
  assert.equal(guardianAccountFieldFor({ code: 'not_found' }), undefined)
  const school = learnerWords('school')
  assert.equal(
    guardianAccountErrorMessage('member_exists', 'sunucu', school),
    memberExistsMessage(school),
  )
  assert.match(memberExistsMessage(school), /kurum yöneticisine/)
  assert.equal(
    guardianAccountErrorMessage('invitation_exists', 'Bekleyen davet var.', school),
    'Bekleyen davet var.',
  )
  assert.equal(focusableField('email'), true)
  assert.equal(focusableField('root.server'), false)
  assert.equal(focusableField(undefined), false)
})

test('ON-290, DOM-YTK-071: veli daveti yalnız yönetici ve ön büro', () => {
  assert.equal(canManageGuardianAccounts('yonetici'), true)
  assert.equal(canManageGuardianAccounts('onburo'), true)
  for (const role of ['ogretmen', 'veli', 'ogrenci', null, undefined])
    assert.equal(canManageGuardianAccounts(role), false)
})

test('ON-290: bekleyen davet satırı ve öğrencinin bekleyen daveti', () => {
  const row = guardianInvitationRow(invitation(), NOW)
  assert.equal(row.name, 'Ayşe Yılmaz')
  assert.equal(row.expired, false)
  assert.match(row.createdLabel, /2026/)
  assert.equal(guardianInvitationRow(invitation({ name: null }), NOW).name, 'ayse@kampus.example')
  assert.equal(
    guardianInvitationRow(invitation({ expiresAt: '2026-11-04T08:59:00.000Z' }), NOW).expired,
    true,
  )
  assert.equal(hasPendingInvitation([invitation()], 's-1'), true)
  assert.equal(hasPendingInvitation([invitation()], 's-2'), false)
  assert.equal(hasPendingInvitation([invitation({ status: 'canceled' })], 's-1'), false)
  assert.equal(hasPendingInvitation([], 's-1'), false)
})

test('DOM-KAY-012: member_exists iletisi okulda "öğrenciye", dil okulunda "kursiyere" der', () => {
  assert.match(memberExistsMessage(learnerWords('school')), /hesabın bu öğrenciye bağlanması/)
  const message = guardianAccountErrorMessage(
    'member_exists',
    'sunucu',
    learnerWords('language_school'),
  )
  assert.match(message, /hesabın bu kursiyere bağlanması/)
  assert.doesNotMatch(message, /öğrenci/)
})
