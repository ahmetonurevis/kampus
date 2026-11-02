import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  accessibleStudentIds,
  guardianBondsFor,
  guardedActorLinks,
  guardianLinksView,
  hasCustody,
  isContactRestricted,
  payerOf,
  planGuardianLink,
  planGuardianUnlink,
  planGuardianUpdate,
  type GuardianLink,
} from '../packages/school-core/src/lib/guardianship.ts'
import { createGuardianLinks } from '../packages/school-core/src/platform/seed-guardians.ts'
import { isDomainError } from './support/domain-error.ts'

const ZodError = { name: 'ZodError' }

/** Deniz (s1): annesi Ayşe velayetli ve ödeyici; babası velayetsiz ve iletişim kısıtlı. */
const mother: GuardianLink = {
  id: 'g1',
  studentId: 's1',
  parentId: 'p1',
  membershipId: 'm-ayse',
  relationship: 'mother',
  custody: 'full',
  contactRestricted: false,
  isPayer: true,
  canPickUp: true,
}
const father: GuardianLink = {
  id: 'g2',
  studentId: 's1',
  parentId: null,
  membershipId: 'm-kemal',
  relationship: 'father',
  custody: 'none',
  contactRestricted: true,
  isPayer: false,
  canPickUp: false,
}
const sibling: GuardianLink = { ...mother, id: 'g3', studentId: 's2' }
const LINKS: readonly GuardianLink[] = Object.freeze([mother, father, sibling])

const link = (input: Record<string, unknown>, links: readonly GuardianLink[] = LINKS) =>
  planGuardianLink({ studentId: 's1', links, account: { role: 'veli' }, input })

describe('veli–öğrenci bağı (IST-019)', () => {
  test('DOM-ILT-070 bağ kurulur; kısıt, ödeyici ve teslim alma varsayılan kapalı', () => {
    assert.deepEqual(link({ membershipId: 'm-new', relationship: 'other', custody: 'joint' }), {
      studentId: 's1',
      parentId: null,
      membershipId: 'm-new',
      relationship: 'other',
      custody: 'joint',
      contactRestricted: false,
      isPayer: false,
      canPickUp: false,
    })
    // Hesabı olmayan veli kaydı da bağlanır (kesin kayıt, ON-010).
    assert.equal(
      planGuardianLink({
        studentId: 's9',
        links: [],
        account: null,
        input: { parentId: 'p9', relationship: 'father', custody: 'full', isPayer: true },
      }).isPayer,
      true,
    )
  })

  test('DOM-ILT-070 girdi doğrulaması: veli kimliği, yakınlık ve velayet zorunlu; bilinmeyen alan red', () => {
    assert.throws(() => link({ relationship: 'mother', custody: 'full' }), ZodError)
    assert.throws(() => link({ parentId: 'p5', relationship: 'aunt', custody: 'full' }), ZodError)
    assert.throws(() => link({ parentId: 'p5', relationship: 'mother' }), ZodError)
    assert.throws(
      () => link({ parentId: 'p5', relationship: 'mother', custody: 'full', institutionId: 'x' }),
      ZodError,
    )
    assert.deepEqual(LINKS, [mother, father, sibling])
  })

  test('DOM-ILT-070 hesap veli rolünde olmalı; aynı veli ikinci kez bağlanmaz (409)', () => {
    assert.throws(
      () =>
        planGuardianLink({
          studentId: 's1',
          links: [],
          account: { role: 'ogretmen' },
          input: { membershipId: 'm-t', relationship: 'other', custody: 'full' },
        }),
      isDomainError('guardian_account_not_parent'),
    )
    assert.throws(
      () => link({ membershipId: 'm-ayse', relationship: 'mother', custody: 'full' }),
      isDomainError('guardian_link_exists', 'conflict'),
    )
    assert.throws(
      () => link({ parentId: 'p1', relationship: 'mother', custody: 'full' }),
      isDomainError('guardian_link_exists', 'conflict'),
    )
    // Kardeşin bağı başka öğrencidedir; aynı veli Deniz'e değil Ece'ye bağlıysa çakışmaz.
    assert.equal(
      planGuardianLink({
        studentId: 's2',
        links: [father],
        account: { role: 'veli' },
        input: { membershipId: 'm-kemal', relationship: 'father', custody: 'joint' },
      }).custody,
      'joint',
    )
  })

  test('DOM-ILT-070 veli kaydı ile hesap birlikte verilirse aynı kişinin eşlemesi olmalı (422)', () => {
    const plan = (input: Record<string, unknown>, identityLinks: readonly GuardianLink[]) =>
      planGuardianLink({
        studentId: 's9',
        links: [],
        identityLinks,
        account: { role: 'veli' },
        input: { relationship: 'mother', custody: 'full', ...input },
      })
    // Ayşe'nin kaydı (p1) başka öğrencide hesabı m-ayse ile eşli: başka hesapla 422.
    assert.throws(
      () => plan({ parentId: 'p1', membershipId: 'm-kemal' }, [mother, father]),
      isDomainError('guardian_identity_mismatch'),
    )
    // Hesap m-ayse başka kayıtla 422; öğrencinin kendi bağlarındaki eşleme de sayılır.
    assert.throws(
      () => plan({ parentId: 'p7', membershipId: 'm-ayse' }, [sibling]),
      isDomainError('guardian_identity_mismatch'),
    )
    assert.throws(
      () =>
        planGuardianLink({
          studentId: 's1',
          links: LINKS,
          account: { role: 'veli' },
          input: { parentId: 'p7', membershipId: 'm-ayse', relationship: 'other', custody: 'full' },
        }),
      isDomainError('guardian_identity_mismatch'),
    )
    // Aynı eşleme ve henüz eşlenmemiş kayıt ile hesap kabul edilir; tek kimlik denetlenmez.
    assert.equal(plan({ parentId: 'p1', membershipId: 'm-ayse' }, [mother]).parentId, 'p1')
    assert.equal(plan({ parentId: 'p7', membershipId: 'm-yeni' }, LINKS).membershipId, 'm-yeni')
    // Hesabı kısıtlı babanın bağında kayıt yok (parentId null): yeni kayıtla eşlenebilir.
    assert.equal(plan({ parentId: 'p8', membershipId: 'm-kemal' }, [father]).parentId, 'p8')
    assert.equal(plan({ parentId: 'p1' }, [father]).membershipId, null)
  })

  test('DOM-ILT-074 öğrencinin en çok bir ödeyicisi var; kısıtlı veli ödeyici, velayetli, teslim alan olamaz', () => {
    assert.throws(
      () => link({ parentId: 'p7', relationship: 'father', custody: 'joint', isPayer: true }),
      isDomainError('guardian_payer_exists', 'conflict'),
    )
    const restricted = { parentId: 'p7', relationship: 'father', contactRestricted: true }
    assert.throws(
      () => link({ ...restricted, custody: 'joint' }),
      isDomainError('guardian_restricted_custody'),
    )
    assert.throws(
      () => link({ ...restricted, custody: 'none', isPayer: true }),
      isDomainError('guardian_restricted_payer'),
    )
    assert.throws(
      () => link({ ...restricted, custody: 'none', canPickUp: true }),
      isDomainError('guardian_restricted_pickup'),
    )
    assert.equal(link({ ...restricted, custody: 'none' }).contactRestricted, true)
  })

  test('DOM-ILT-072 vasi velayetli kaydedilir', () => {
    assert.throws(
      () => link({ parentId: 'p7', relationship: 'legal_guardian', custody: 'none' }),
      isDomainError('guardian_legal_custody'),
    )
    assert.equal(
      link({ parentId: 'p7', relationship: 'legal_guardian', custody: 'full' }).custody,
      'full',
    )
  })

  test('DOM-ILT-075 bağı olan öğrencide en az bir velayetli bağ: ilk bağ velayetsiz olamaz', () => {
    assert.throws(
      () =>
        planGuardianLink({
          studentId: 's9',
          links: [],
          account: null,
          input: { parentId: 'p9', relationship: 'father', custody: 'none' },
        }),
      isDomainError('guardian_custody_required'),
    )
  })

  test('DOM-ILT-071 bağ değişir; yalnız gönderilen alanlar, değişmezler korunur', () => {
    const result = planGuardianUpdate({
      studentId: 's1',
      linkId: 'g1',
      links: LINKS,
      input: { custody: 'joint', canPickUp: false },
    })
    assert.deepEqual(result.fields, ['custody', 'canPickUp'])
    assert.deepEqual(result.link, { ...mother, custody: 'joint', canPickUp: false })
    assert.equal(mother.custody, 'full', 'girdi değişmez')
    // Son velayetli bağın velayeti kaldırılamaz.
    assert.throws(
      () =>
        planGuardianUpdate({
          studentId: 's1',
          linkId: 'g1',
          links: LINKS,
          input: { custody: 'none' },
        }),
      isDomainError('guardian_custody_required'),
    )
    // Kısıtlı velinin kısıtı kalkmadan ödeyici yapılamaz; ödeyici zaten var.
    assert.throws(
      () =>
        planGuardianUpdate({
          studentId: 's1',
          linkId: 'g2',
          links: LINKS,
          input: { isPayer: true },
        }),
      isDomainError('guardian_restricted_payer'),
    )
    assert.throws(
      () =>
        planGuardianUpdate({
          studentId: 's1',
          linkId: 'g2',
          links: LINKS,
          input: { contactRestricted: false, isPayer: true },
        }),
      isDomainError('guardian_payer_exists', 'conflict'),
    )
    // Ödeyici kendisi ödeyici kalır (kendisiyle çakışmaz).
    assert.equal(
      planGuardianUpdate({ studentId: 's1', linkId: 'g1', links: LINKS, input: { isPayer: true } })
        .link.isPayer,
      true,
    )
    assert.throws(
      () => planGuardianUpdate({ studentId: 's1', linkId: 'g1', links: LINKS, input: {} }),
      ZodError,
    )
    assert.throws(
      () =>
        planGuardianUpdate({
          studentId: 's1',
          linkId: 'g3',
          links: LINKS,
          input: { canPickUp: true },
        }),
      isDomainError('guardian_link_not_found', 'not_found'),
    )
  })

  test('DOM-ILT-075 bağ kaldırılır; son velayetli bağ başka bağ varken kaldırılamaz', () => {
    assert.equal(planGuardianUnlink({ studentId: 's1', linkId: 'g2', links: LINKS }), father)
    assert.throws(
      () => planGuardianUnlink({ studentId: 's1', linkId: 'g1', links: LINKS }),
      isDomainError('guardian_custody_required'),
    )
    // Tek bağ kaldırılabilir (yetişkin kursiyer, yanlış kayıt).
    assert.equal(planGuardianUnlink({ studentId: 's2', linkId: 'g3', links: LINKS }), sibling)
    assert.throws(
      () => planGuardianUnlink({ studentId: 's1', linkId: 'yok', links: LINKS }),
      isDomainError('guardian_link_not_found', 'not_found'),
    )
  })

  test('DOM-ILT-070, 074 yardımcılar: velayet, kısıt, ödeyici, erişilen öğrenciler, rıza bağı', () => {
    assert.equal(hasCustody(LINKS, 's1', 'm-ayse'), true)
    assert.equal(hasCustody(LINKS, 's1', 'm-kemal'), false)
    assert.equal(hasCustody(LINKS, 's3', 'm-ayse'), false)
    assert.equal(isContactRestricted(LINKS, 's1', 'm-kemal'), true)
    assert.equal(isContactRestricted(LINKS, 's1', 'm-ayse'), false)
    assert.equal(payerOf(LINKS, 's1'), mother)
    assert.equal(payerOf(LINKS, 's5'), null)
    assert.deepEqual(accessibleStudentIds(LINKS, 'm-ayse'), ['s1', 's2'])
    assert.deepEqual(accessibleStudentIds(LINKS, 'm-kemal'), [])
    assert.deepEqual(guardianBondsFor(LINKS, 'm-kemal'), [
      { studentId: 's1', verified: true, custody: false },
    ])
    assert.deepEqual(guardianBondsFor(LINKS, 'm-ayse'), [
      { studentId: 's1', verified: true, custody: true },
      { studentId: 's2', verified: true, custody: true },
    ])
  })

  test('IST-019 DOM-ILT-074 iletişim kısıtlı velinin çocuk bağlantısı okuma kapsamından düşer', () => {
    const links = [
      { kind: 'child', recordId: 's1' },
      { kind: 'child', recordId: 's2' },
    ] as const
    // Velayetli ve kısıtsız anne iki çocuğunu da görür.
    assert.deepEqual(guardedActorLinks(links, LINKS, 'm-ayse'), links)
    // Kısıtlı baba Deniz'i görmez; bağlantısı olsa da kapsam boştur.
    assert.deepEqual(guardedActorLinks(links.slice(0, 1), LINKS, 'm-kemal'), [])
    // Kısıt kaldırılıp velayet verilince yeniden görür.
    const lifted = { ...father, custody: 'joint' as const, contactRestricted: false }
    assert.deepEqual(guardedActorLinks(links.slice(0, 1), [mother, lifted], 'm-kemal'), [
      { kind: 'child', recordId: 's1' },
    ])
    // Başka hesabın bağı kapsam vermez.
    assert.deepEqual(guardedActorLinks(links, LINKS, 'm-baska'), [])
  })

  test('IST-019 DOM-ILT-070 velayeti olmayan kısıtsız veli de kapsam dışıdır; bağsız bağlantı kapalı başarısız', () => {
    const noCustody = { ...father, contactRestricted: false }
    const links = [{ kind: 'child', recordId: 's1' }] as const
    assert.deepEqual(guardedActorLinks(links, [mother, noCustody], 'm-kemal'), [])
    // Bağı kaldırılmış (yüklenmeyen) ya da hiç kurulmamış bağlantı kapsam vermez.
    assert.deepEqual(guardedActorLinks(links, [], 'm-ayse'), [])
    assert.deepEqual(guardedActorLinks([{ kind: 'child', recordId: 's9' }], LINKS, 'm-ayse'), [])
  })

  test('IST-019 öğrenci ve öğretmen bağlantıları velayetten etkilenmez', () => {
    const student = [{ kind: 'student', recordId: 's1' }] as const
    const teacher = [{ kind: 'teacher', recordId: 't1' }] as const
    assert.deepEqual(guardedActorLinks(student, [], 'm-deniz'), student)
    assert.deepEqual(guardedActorLinks(teacher, LINKS, 'm-kemal'), teacher)
    const mixed = [...student, { kind: 'child', recordId: 's1' }] as const
    assert.deepEqual(guardedActorLinks(mixed, [], 'm-x'), student)
  })

  test('DOM-ILT-073 rol kapsamı: yönetici ve ön büro hepsini, veli yalnız kendi bağını kısıtsız görür', () => {
    const deniz = [mother, father]
    assert.deepEqual(guardianLinksView(deniz, { role: 'yonetici', membershipId: 'm-a' }), deniz)
    assert.deepEqual(guardianLinksView(deniz, { role: 'onburo', membershipId: 'm-o' }), deniz)
    const own = guardianLinksView(deniz, { role: 'veli', membershipId: 'm-ayse' })
    assert.equal(own.length, 1)
    assert.equal(own[0]?.id, 'g1')
    assert.equal('contactRestricted' in (own[0] ?? {}), false)
    // Kısıtlı veli öğrencinin verisini görmez.
    assert.deepEqual(guardianLinksView(deniz, { role: 'veli', membershipId: 'm-kemal' }), [])
    for (const role of ['ogretmen', 'ogrenci'] as const)
      assert.deepEqual(guardianLinksView(deniz, { role, membershipId: 'm-ayse' }), [])
  })
})

describe('örnek veli bağları (IST-019)', () => {
  test('DOM-ILT-074, 075 örnek bağlar deterministik ve kurallara uyar: Ayşe velayetli ödeyici, ikinci veli kısıtlı', () => {
    const seed = createGuardianLinks()
    assert.deepEqual(createGuardianLinks(), seed)
    assert.equal(new Set(seed.map((item) => item.id)).size, seed.length)
    // Bağlar sırayla core işleminden geçer: hiçbiri değişmezleri bozmaz.
    const links: GuardianLink[] = []
    for (const { id, account, studentId, ...input } of seed) {
      const draft = planGuardianLink({
        studentId,
        links,
        account: { role: 'veli' },
        input: { ...input, parentId: input.parentId ?? undefined, membershipId: account },
      })
      links.push({ id, ...draft })
    }
    assert.equal(payerOf(links, 's1')?.membershipId, 'parent')
    assert.equal(payerOf(links, 's2')?.membershipId, 'parent')
    assert.equal(hasCustody(links, 's1', 'restrictedParent'), false)
    assert.equal(isContactRestricted(links, 's1', 'restrictedParent'), true)
    assert.equal(createGuardianLinks({ parentRelationship: 'father' })[0]?.relationship, 'father')
  })
})
