import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  effectiveCustody,
  learnerConsentRequired,
  studentsNeedingLearnerFacts,
  withLearnerConsent,
  type LearnerAccessFacts,
} from '../packages/school-core/src/lib/enrollment-guardian-access.ts'
import {
  guardedActorLinks,
  scopedActorLinks,
  type GuardianLink,
} from '../packages/school-core/src/lib/guardianship.ts'

/**
 * Yetişkin kursiyerin veli erişimi (ON-129; DOM-KAY-012, DOM-ILT-070, DOM-ILT-074, DOM-YTK-057;
 * kullanıcı kararı 2 Kasım 2026). Kursta 18 yaş ve üstü kursiyerin velayetli bağı yalnız
 * kursiyerin geçerli rızasıyla kapsam verir; rıza geri çekilince kapsam daralır, bağ ve ödeyicilik
 * sürer. Okulda ve 18 yaş altında değişiklik yoktur.
 */

const MEMBERSHIP = 'm-anne'
const link = (overrides: Partial<GuardianLink> = {}): GuardianLink => ({
  id: 'g-1',
  studentId: 's1',
  parentId: 'p1',
  membershipId: MEMBERSHIP,
  relationship: 'mother',
  custody: 'full',
  contactRestricted: false,
  isPayer: true,
  canPickUp: false,
  ...overrides,
})
const ADULT_NO_CONSENT: LearnerAccessFacts = { minor: false, consented: false }
const ADULT_CONSENTED: LearnerAccessFacts = { minor: false, consented: true }
const MINOR: LearnerAccessFacts = { minor: true, consented: false }
const childLinks = (...ids: string[]) => ids.map((recordId) => ({ kind: 'child', recordId }))
const factsFor =
  (facts: Record<string, LearnerAccessFacts>) =>
  (studentId: string): LearnerAccessFacts | undefined =>
    facts[studentId]

/** Aktörün kapsam bağlantıları, kursiyer olguları uygulanarak (API'nin kuracağı sıra). */
const scopeWith = (links: readonly GuardianLink[], facts: Record<string, LearnerAccessFacts>) =>
  scopedActorLinks(
    childLinks(...new Set(links.map((item) => item.studentId))),
    withLearnerConsent(links, factsFor(facts)),
    MEMBERSHIP,
  )

describe('yetişkin kursiyerin veli erişimi (ON-129)', () => {
  test('DOM-KAY-012 DOM-ILT-070 ON-129 rıza yalnız yetişkin kursiyerde aranır', () => {
    assert.equal(learnerConsentRequired({ minor: false }), true)
    assert.equal(learnerConsentRequired({ minor: true }), false)
  })

  test('DOM-ILT-070 ON-129 rızasız yetişkin kursiyerin velayetli bağı velayetsiz sayılır', () => {
    assert.equal(effectiveCustody(link(), ADULT_NO_CONSENT), 'none')
    assert.equal(effectiveCustody(link({ custody: 'joint' }), ADULT_NO_CONSENT), 'none')
  })

  test('DOM-YTK-057 ON-129 kursiyerin rızasıyla kayıtlı velayet geçerlidir', () => {
    assert.equal(effectiveCustody(link(), ADULT_CONSENTED), 'full')
    assert.equal(effectiveCustody(link({ custody: 'joint' }), ADULT_CONSENTED), 'joint')
  })

  test('DOM-ILT-070 ON-129 velayetsiz bağa rıza velayet açmaz', () => {
    assert.equal(effectiveCustody(link({ custody: 'none' }), ADULT_CONSENTED), 'none')
    assert.equal(effectiveCustody(link({ custody: 'none' }), MINOR), 'none')
  })

  test('DOM-KAY-012 ON-129 18 yaş altında rıza aranmaz, velayet değişmez', () => {
    assert.equal(effectiveCustody(link(), MINOR), 'full')
    assert.equal(effectiveCustody(link({ custody: 'joint' }), MINOR), 'joint')
  })

  test('DOM-ILT-070 DOM-ILT-074 ON-129 rızasız yetişkinde veli kapsamı kapanır, ödeyici finans bağlantısı sürer', () => {
    const scope = scopeWith([link()], { s1: ADULT_NO_CONSENT })
    assert.deepEqual(scope, [{ kind: 'payer', recordId: 's1' }])
  })

  test('DOM-ILT-070 ON-129 rıza verilince velayet bağlantısı açılır, ödeyici bağlantısı da kalır', () => {
    const scope = scopeWith([link()], { s1: ADULT_CONSENTED })
    assert.deepEqual(scope, [
      { kind: 'child', recordId: 's1' },
      { kind: 'payer', recordId: 's1' },
    ])
  })

  test('DOM-YTK-059 ON-129 rıza geri çekilince bir sonraki kapsamda velayet bağlantısı yine kapanır', () => {
    const bonds = [link({ isPayer: false })]
    assert.deepEqual(scopeWith(bonds, { s1: ADULT_CONSENTED }), [{ kind: 'child', recordId: 's1' }])
    assert.deepEqual(scopeWith(bonds, { s1: ADULT_NO_CONSENT }), [])
  })

  test('DOM-KAY-012 ON-129 18 yaş altı kardeşin bağı etkilenmez; kardeşler ayrı karar alır', () => {
    const bonds = [link(), link({ id: 'g-2', studentId: 's2', isPayer: false })]
    const scope = scopeWith(bonds, { s1: ADULT_NO_CONSENT, s2: MINOR })
    assert.deepEqual(scope, [
      { kind: 'child', recordId: 's2' },
      { kind: 'payer', recordId: 's1' },
    ])
  })

  test('DOM-ILT-074 ON-129 iletişim kısıtlı veliye rıza da kapsam açmaz', () => {
    const scope = scopeWith([link({ contactRestricted: true, isPayer: false })], {
      s1: ADULT_CONSENTED,
    })
    assert.deepEqual(scope, [])
  })

  test('ON-129 olgusu verilmeyen öğrencinin bağı olduğu gibi kalır; girdi değişmez', () => {
    const bonds = [link(), link({ id: 'g-2', studentId: 's2' })]
    const frozen = structuredClone(bonds)
    const result = withLearnerConsent(bonds, factsFor({ s1: ADULT_NO_CONSENT }))
    assert.equal(result[0]?.custody, 'none')
    assert.equal(result[0]?.isPayer, true)
    assert.equal(result[0]?.id, 'g-1')
    assert.equal(result[1], bonds[1])
    assert.deepEqual(bonds, frozen)
    // Değişmeyen bağ aynı nesnedir (gereksiz kopya yok).
    assert.equal(withLearnerConsent(bonds, factsFor({ s1: ADULT_CONSENTED }))[0], bonds[0])
  })

  test('ON-129 velayet bağlantısı süzgeci daraltılmış bağı okur', () => {
    const narrowed = withLearnerConsent([link()], factsFor({ s1: ADULT_NO_CONSENT }))
    assert.deepEqual(guardedActorLinks(childLinks('s1'), narrowed, MEMBERSHIP), [])
  })

  test('DOM-KAY-012 ON-129 olgu yalnız kursta ve velayetli bağı olan öğrenci için okunur', () => {
    const bonds = [
      link({ studentId: 's2' }),
      link({ id: 'g-2', studentId: 's1', custody: 'joint' }),
      link({ id: 'g-3', studentId: 's3', custody: 'none' }),
      link({ id: 'g-4', studentId: 's1' }),
    ]
    assert.deepEqual(studentsNeedingLearnerFacts(bonds, false), ['s1', 's2'])
    assert.deepEqual(studentsNeedingLearnerFacts(bonds, true), [])
    assert.deepEqual(studentsNeedingLearnerFacts([], false), [])
  })
})
