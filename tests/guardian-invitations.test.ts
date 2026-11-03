import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  GUARDIAN_INVITATION_MAX_STUDENTS,
  guardianInvitationInputSchema,
  planGuardianInvitation,
} from '../packages/school-core/src/lib/guardian-invitations.ts'
import type { GuardianLink } from '../packages/school-core/src/lib/guardianship.ts'
import { isDomainError } from './support/domain-error.ts'

const ZodError = { name: 'ZodError' }

/** Ayşe Yılmaz'ın veli kaydı (p-ayse) Deniz (s1) ve Ece (s2) ile hesapsız bağlıdır. */
const bond = (id: string, studentId: string, patch: Partial<GuardianLink> = {}): GuardianLink => ({
  id,
  studentId,
  parentId: 'p-ayse',
  membershipId: null,
  relationship: 'mother',
  custody: 'full',
  contactRestricted: false,
  isPayer: true,
  canPickUp: true,
  ...patch,
})
const deniz = bond('g1', 's1')
const ece = bond('g2', 's2')
const LINKS: readonly GuardianLink[] = Object.freeze([deniz, ece])

const BODY = { email: 'ayse.yilmaz@example.com', name: 'Ayşe Yılmaz', studentIds: ['s1', 's2'] }

const plan = (
  input: Record<string, unknown>,
  patch: Partial<Parameters<typeof planGuardianInvitation>[0]> = {},
) =>
  planGuardianInvitation({
    input: { ...BODY, ...input },
    alreadyMember: false,
    pendingInvitation: false,
    parentInvitationPending: false,
    links: LINKS,
    identityLinks: LINKS,
    ...patch,
  })

describe('veli hesabı daveti (DOM-YTK-071)', () => {
  test('DOM-YTK-071: girdi e-postayı küçültür, adı kırpar; öğrenciler 1–10 ve benzersiz', () => {
    const parsed = guardianInvitationInputSchema.parse({
      email: ' Ayse.Yilmaz@Example.COM ',
      name: ' Ayşe Yılmaz ',
      studentIds: [' s1 '],
    })
    assert.deepEqual(parsed, {
      email: 'ayse.yilmaz@example.com',
      name: 'Ayşe Yılmaz',
      studentIds: ['s1'],
    })
    const tooMany = Array.from({ length: GUARDIAN_INVITATION_MAX_STUDENTS + 1 }, (_, i) => `s${i}`)
    for (const body of [
      { ...BODY, studentIds: [] },
      { ...BODY, studentIds: tooMany },
      { ...BODY, studentIds: ['s1', 's1'] },
      { ...BODY, studentIds: [''] },
      { ...BODY, email: 'gecersiz' },
      { ...BODY, email: `${'a'.repeat(250)}@x.co` },
      { ...BODY, name: 'A' },
      { ...BODY, name: 'A'.repeat(121) },
      { ...BODY, parentId: '' },
      { ...BODY, role: 'veli' },
      { ...BODY, institutionId: 'x' },
    ])
      assert.equal(
        guardianInvitationInputSchema.safeParse(body).success,
        false,
        JSON.stringify(body),
      )
    const ten = Array.from({ length: GUARDIAN_INVITATION_MAX_STUDENTS }, (_, i) => `s${i}`)
    assert.ok(guardianInvitationInputSchema.safeParse({ ...BODY, studentIds: ten }).success)
  })

  test('DOM-YTK-071: veli kaydı verilmezse bağ yazılmaz; öğrenciler sırasıyla döner', () => {
    assert.deepEqual(plan({ studentIds: ['s2', 's1'] }), {
      studentIds: ['s2', 's1'],
      parentId: null,
      bondIds: [],
    })
    // Bağı olmayan öğrenci de seçilebilir: çocuk bağlantısı tek başına kapsam vermez.
    assert.deepEqual(plan({ studentIds: ['s9'] }, { links: [] }).bondIds, [])
  })

  test('DOM-YTK-071: veli kaydı verilirse seçilen öğrencilerdeki bağları hesaba bağlanır', () => {
    assert.deepEqual(plan({ parentId: 'p-ayse' }), {
      studentIds: ['s1', 's2'],
      parentId: 'p-ayse',
      bondIds: ['g1', 'g2'],
    })
    // Yalnız seçilen öğrencinin bağı: Ece seçilmezse onun bağı değişmez.
    assert.deepEqual(plan({ parentId: 'p-ayse', studentIds: ['s1'] }).bondIds, ['g1'])
    // Velayeti olmayan bağ da bağlanır; kapsam velayete göre bağdan okunur.
    const none = bond('g1', 's1', { custody: 'none', isPayer: false })
    assert.deepEqual(plan({ parentId: 'p-ayse', studentIds: ['s1'] }, { links: [none] }).bondIds, [
      'g1',
    ])
  })

  test('DOM-YTK-071: kayıtlı e-posta member_exists, bekleyen davet invitation_exists (409)', () => {
    assert.throws(
      () => plan({}, { alreadyMember: true }),
      isDomainError('member_exists', 'conflict'),
    )
    assert.throws(
      () => plan({}, { pendingInvitation: true }),
      isDomainError('invitation_exists', 'conflict'),
    )
    // E-posta denetimi veli kaydından önce gelir.
    assert.throws(
      () => plan({ parentId: 'p-yok' }, { alreadyMember: true }),
      isDomainError('member_exists', 'conflict'),
    )
  })

  test('DOM-YTK-071: veli kaydı seçilen öğrencinin velisi değilse 422 guardian_record_not_linked', () => {
    assert.throws(
      () => plan({ parentId: 'p-ayse', studentIds: ['s1', 's3'] }),
      isDomainError('guardian_record_not_linked'),
    )
    assert.throws(
      () => plan({ parentId: 'p-baska' }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError)
        assert.equal(error.code, 'guardian_record_not_linked')
        assert.deepEqual(error.path, ['parentId'])
        return true
      },
    )
  })

  test('DOM-YTK-071: hesaba bağlı ya da bekleyen davetteki veli kaydı 409 guardian_link_exists', () => {
    const linked = bond('g2', 's2', { membershipId: 'm-baska' })
    assert.throws(
      () =>
        plan({ parentId: 'p-ayse' }, { links: [deniz, linked], identityLinks: [deniz, linked] }),
      isDomainError('guardian_link_exists', 'conflict'),
    )
    assert.throws(
      () => plan({ parentId: 'p-ayse' }, { parentInvitationPending: true }),
      isDomainError('guardian_link_exists', 'conflict'),
    )
    // Bekleyen davet yalnız veli kaydı seçilince sayılır.
    assert.deepEqual(plan({}, { parentInvitationPending: true }).bondIds, [])
  })

  test('DOM-YTK-071: kayıt başka öğrencide başka hesapla eşlenmişse 422 guardian_identity_mismatch', () => {
    const elsewhere = bond('g9', 's9', { membershipId: 'm-baska' })
    assert.throws(
      () => plan({ parentId: 'p-ayse' }, { identityLinks: [...LINKS, elsewhere] }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError)
        assert.equal(error.code, 'guardian_identity_mismatch')
        assert.equal(error.kind, 'rule')
        assert.deepEqual(error.path, ['parentId'])
        return true
      },
    )
    // Başka kaydın hesaplı bağı eşlemeyi etkilemez.
    const other = bond('g8', 's9', { parentId: 'p-baska', membershipId: 'm-baska' })
    assert.deepEqual(plan({ parentId: 'p-ayse' }, { identityLinks: [...LINKS, other] }).bondIds, [
      'g1',
      'g2',
    ])
  })

  test('DOM-YTK-071: geçersiz girdi ZodError; girdiler değişmez', () => {
    assert.throws(() => plan({ studentIds: [] }), ZodError)
    assert.throws(() => plan({ role: 'veli' }), ZodError)
    assert.deepEqual(LINKS, [deniz, ece])
    assert.equal(deniz.membershipId, null)
  })
})
