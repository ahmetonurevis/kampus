import assert from 'node:assert/strict'
import test, { describe } from 'node:test'

import { createSeed } from '../packages/school-core/src/data/seed.ts'
import {
  enrollProspectSchema,
  enrollProspectWithTariff,
  type EnrollmentContext,
} from '../packages/school-core/src/lib/enrollment.ts'
import {
  adultPayerSchema,
  attachAdultPayer,
  newPayerParent,
  payerRelationshipOf,
  planAdultPayerLink,
  requireEligiblePayerParent,
  requireSeparatePayerAllowed,
  resolveAdultPayer,
} from '../packages/school-core/src/lib/finance-payers.ts'
import {
  guardedActorLinks,
  guardianBondsFor,
  hasCustody,
  payerActorLinks,
  scopedActorLinks,
  type GuardianLink,
} from '../packages/school-core/src/lib/guardianship.ts'
import { isMinorLearner } from '../packages/school-core/src/lib/notifications.ts'
import { financeStudentIds, scopeFor } from '../packages/school-core/src/lib/scope.ts'
import { isDomainError } from './support/domain-error.ts'

/**
 * Yetişkin kursiyerin ayrı ödeyicisi (ON-124; DOM-KAY-012, DOM-ILT-074, ADR 0008 karar 5;
 * kullanıcı kararı 2 Kasım 2026). Kursta 18 yaş ve üstü kursiyere velayetsiz ödeyici bağı kurulur;
 * ödeyici finansı görür, not ve devamı görmez, rıza veremez. Okulda ve 18 yaş altında ödeyici
 * velidir (eski kural).
 */

const NOW = '2026-10-06T09:00:00.000Z'
const TARIFF = {
  id: 'test-tariff',
  versionNumber: 1,
  items: [
    {
      kind: 'tuition',
      level: null,
      amountCents: 50_000,
      unit: 'lesson_hour',
      vatBasisPoints: 1000,
      vatEffectiveDate: '2026-01-01',
      announcedAmountCents: null,
    },
  ],
  discounts: [],
} as const satisfies EnrollmentContext['tariff']
const CONTEXT: EnrollmentContext = {
  institutionType: 'language_school',
  tariff: TARIFF,
  academicYear: 2026,
  identityHolderId: null,
  approvedByUserId: 'test-user',
  canApproveCapException: false,
  today: '2026-10-06',
}
const ADULT = {
  classId: 'c1',
  tariffId: 'test-tariff',
  installmentCount: 2,
  firstDueDate: '2026-11-15',
  lessonHours: 10,
  identity: { kind: 'tc', number: '10000000146', birthDate: '2000-01-01' },
  guardian: null,
}
const PAYER = { name: 'Test Ödeyici', phone: '05559990002', relationship: 'mother' } as const

function enroll(
  overrides: Record<string, unknown>,
  context: Partial<EnrollmentContext> = {},
  state = createSeed(new Date(NOW)),
) {
  let n = 0
  const result = enrollProspectWithTariff(
    state,
    'pr1',
    { ...ADULT, ...overrides },
    (prefix) => `${prefix}-test-${n++}`,
    NOW,
    { ...CONTEXT, ...context },
  )
  return { state, result }
}

function rejectsUnchanged(
  overrides: Record<string, unknown>,
  context: Partial<EnrollmentContext>,
  code: string,
  kind = 'rule',
  path: readonly string[] = ['payer'],
) {
  const state = createSeed(new Date(NOW))
  const before = JSON.stringify(state)
  assert.throws(
    () => enroll(overrides, context, state),
    (error: unknown) => {
      assert.ok(isDomainError(code, kind)(error), String(error))
      assert.deepEqual((error as { path?: unknown }).path, path)
      return true
    },
  )
  assert.equal(JSON.stringify(state), before)
}

const payerBond = (over: Partial<GuardianLink> = {}): GuardianLink => ({
  id: 'test-on124-g1',
  studentId: 'test-on124-s',
  parentId: 'test-on124-p',
  membershipId: 'm-odeyici',
  relationship: 'mother',
  custody: 'none',
  contactRestricted: false,
  isPayer: true,
  canPickUp: false,
  ...over,
})

describe('yetişkin kursiyerin ayrı ödeyicisi (ON-124)', () => {
  test('DOM-KAY-012 ON-124 kesin kayıtta yeni kişi yetişkin kursiyerin velayetsiz ödeyicisi olur; sözleşmenin tarafı kursiyer kalır', () => {
    const { state, result } = enroll({ payer: PAYER })
    assert.equal(result.contract.payer, 'student')
    assert.equal(result.guardianBond, null)
    const created = state.parents.find((parent) => parent.id === result.payerBond?.parentId)
    assert.ok(created)
    assert.equal(created.name, 'Test Ödeyici')
    assert.equal(created.phone, '05559990002')
    assert.equal(created.relationship, 'mother')
    // Öğrenci ödeyicinin veli kaydı öğrencilerine yazılmaz: öğretmen ve kursiyer onu veli görmez.
    assert.deepEqual(created.studentIds, [])
    // Kursiyerin kendi satırı yerinde kalır; ödeyici o satır değildir.
    const self = state.parents.find((parent) => parent.id === result.student.parentId)
    assert.equal(self?.relationship, 'self')
    assert.notEqual(self?.id, created.id)
    assert.deepEqual(result.payerBond, {
      studentId: result.student.id,
      parentId: created.id,
      membershipId: null,
      relationship: 'mother',
      custody: 'none',
      contactRestricted: false,
      isPayer: true,
      canPickUp: false,
    })
  })

  test('DOM-KAY-013 ON-124 mevcut veli kaydı ödeyici seçilir; kaydı ve öğrencileri değişmez', () => {
    const seed = createSeed(new Date(NOW))
    const parent = seed.parents.find((item) => item.id === 'p1')!
    const before = JSON.stringify(parent)
    const { state, result } = enroll({ payer: { existingParentId: 'p1' } }, {}, seed)
    assert.equal(JSON.stringify(state.parents.find((item) => item.id === 'p1')), before)
    assert.equal(result.payerBond?.parentId, 'p1')
    assert.equal(result.payerBond?.custody, 'none')
    assert.equal(
      result.payerBond?.relationship,
      payerRelationshipOf({ existingParentId: 'p1' }, parent),
    )
    assert.equal(result.contract.payer, 'student')
  })

  test('DOM-KAY-012 ON-124 okulda ve 18 yaş altında ayrı ödeyici 422 payer_not_applicable; kayıt yazılmaz', () => {
    const minorGuardian = { name: 'Test Veli', phone: '05559990001', relationship: 'mother' }
    // Kursta 18 yaş altında veli ödeyicidir.
    rejectsUnchanged(
      {
        identity: { ...ADULT.identity, birthDate: '2013-03-01' },
        guardian: minorGuardian,
        payer: PAYER,
      },
      {},
      'payer_not_applicable',
    )
    // Okulda 18 yaş üstünde de veli zorunlu ve ödeyicidir.
    rejectsUnchanged(
      { lessonHours: undefined, guardian: minorGuardian, payer: PAYER },
      {
        institutionType: 'school',
        tariff: { ...TARIFF, items: [{ ...TARIFF.items[0], unit: 'year' }] },
      },
      'payer_not_applicable',
    )
    // Yetişkine veli verilirse önce eski kural çalışır.
    rejectsUnchanged(
      { guardian: minorGuardian, payer: PAYER },
      {},
      'guardian_not_applicable',
      'rule',
      ['guardian'],
    )
  })

  test('DOM-ILT-074 ON-124 kısıtlı ya da kursiyerin kendi kaydı ödeyici olamaz; olmayan kayıt 404', () => {
    rejectsUnchanged(
      { payer: { existingParentId: 'p1' } },
      { payerBonds: [{ contactRestricted: true }] },
      'payer_not_eligible',
    )
    rejectsUnchanged({ payer: { existingParentId: 'yok' } }, {}, 'parent_not_found', 'not_found')
    const seed = createSeed(new Date(NOW))
    seed.parents.find((item) => item.id === 'p1')!.relationship = 'self'
    const before = JSON.stringify(seed)
    assert.throws(
      () => enroll({ payer: { existingParentId: 'p1' } }, {}, seed),
      isDomainError('payer_not_eligible'),
    )
    assert.equal(JSON.stringify(seed), before)
    // Velayetsiz bağı olan kişi ödeyici olabilir: ödeyicilik velayet istemez (K-04).
    assert.doesNotThrow(() => requireEligiblePayerParent([{ contactRestricted: false }], false))
  })

  test('ON-124 ödeyici gövdesi: yeni kişi ya da mevcut kayıt; vasi ve eksik alan 400', () => {
    assert.ok(adultPayerSchema.safeParse(PAYER).success)
    assert.ok(adultPayerSchema.safeParse({ existingParentId: 'p1' }).success)
    for (const invalid of [
      { ...PAYER, relationship: 'legal_guardian' },
      { ...PAYER, phone: '555' },
      { name: 'Test Ödeyici' },
      { existingParentId: 'p1', name: 'Test Ödeyici' },
    ])
      assert.equal(adultPayerSchema.safeParse(invalid).success, false, JSON.stringify(invalid))
    assert.equal(enrollProspectSchema.safeParse({ ...ADULT, payer: PAYER }).success, true)
    assert.equal(enrollProspectSchema.safeParse(ADULT).data?.payer, undefined)
    assert.equal(payerRelationshipOf({ existingParentId: 'p1' }, { id: 'p1' }), 'other')
    assert.equal(
      payerRelationshipOf({ existingParentId: 'p1' }, { id: 'p1', relationship: 'father' }),
      'father',
    )
    assert.deepEqual(newPayerParent('test-p', PAYER).studentIds, [])
  })

  test('DOM-ILT-074 ON-124 sonradan eklenen ödeyici: tek ödeyici (409), aynı kişi (409), yalnız yetişkin kursiyer (422)', () => {
    const base = {
      studentId: 'test-on124-s',
      parentId: 'test-on124-p',
      relationship: 'other' as const,
      minor: false,
      links: [] as GuardianLink[],
    }
    assert.equal(planAdultPayerLink(base).custody, 'none')
    assert.throws(
      () => planAdultPayerLink({ ...base, links: [payerBond({ parentId: 'test-baska' })] }),
      isDomainError('guardian_payer_exists', 'conflict'),
    )
    assert.throws(
      () => planAdultPayerLink({ ...base, links: [payerBond({ isPayer: false })] }),
      isDomainError('guardian_link_exists', 'conflict'),
    )
    // Başka öğrencinin bağı bu öğrencinin değişmezine girmez.
    assert.equal(
      planAdultPayerLink({ ...base, links: [payerBond({ studentId: 'test-baska' })] }).isPayer,
      true,
    )
    assert.throws(
      () => planAdultPayerLink({ ...base, minor: true }),
      isDomainError('payer_not_applicable'),
    )
    assert.throws(() => requireSeparatePayerAllowed(true), isDomainError('payer_not_applicable'))
    // Yaş kuralı bildirim ve rızayla ortaktır: okulda her öğrenci 18 yaş altı sayılır.
    const options = { now: NOW }
    assert.equal(
      isMinorLearner({ birthDate: '2000-01-01' }, { ...options, institutionType: 'school' }),
      true,
    )
    assert.equal(
      isMinorLearner(
        { birthDate: '2000-01-01' },
        { ...options, institutionType: 'language_school' },
      ),
      false,
    )
  })

  test('DOM-ILT-070 DOM-ILT-074 ON-124 ödeyici bağı finansı açar; not, devam ve rıza kapsamı vermez', () => {
    const state = createSeed(new Date(NOW))
    const bond = payerBond({ studentId: 's1' })
    const stored = [{ kind: 'child' as const, recordId: 's1' }]
    // Velayetsiz bağ çocuk bağlantısını kapsamdan düşürür, ödeyici bağlantısı kalır.
    assert.deepEqual(guardedActorLinks(stored, [bond], 'm-odeyici'), [])
    assert.deepEqual(payerActorLinks(stored, [bond], 'm-odeyici'), [
      { kind: 'payer', recordId: 's1' },
    ])
    const scope = scopeFor(state, {
      role: 'veli',
      links: scopedActorLinks(stored, [bond], 'm-odeyici'),
    })
    assert.deepEqual([...financeStudentIds(scope)], ['s1'])
    assert.deepEqual([...scope.studentIds], [])
    assert.equal(hasCustody([bond], 's1', 'm-odeyici'), false)
    assert.deepEqual(guardianBondsFor([bond], 'm-odeyici'), [
      { studentId: 's1', verified: true, custody: false },
    ])
  })

  test('DOM-ILT-074 ON-124 sonradan ekleme: ödeyici doğrulanır, bağ reddedilirse yeni kişi yazılmaz', () => {
    const notSelf = () => false
    const options = { minor: false, parentBonds: [], isSelfRecord: notSelf }
    const state = createSeed(new Date(NOW))
    const resolved = resolveAdultPayer(state.parents, PAYER, options)
    assert.deepEqual(resolved, { kind: 'new', ...PAYER })
    const before = JSON.stringify(state.parents)
    // Öğrencinin ödeyicisi varken yeni kişi açılmaz.
    assert.throws(
      () =>
        attachAdultPayer(state, resolved, {
          studentId: 'test-on124-s',
          minor: false,
          links: [payerBond({ parentId: 'test-baska' })],
          makeId: () => 'test-on124-p2',
        }),
      isDomainError('guardian_payer_exists', 'conflict'),
    )
    assert.equal(JSON.stringify(state.parents), before)
    const draft = attachAdultPayer(state, resolved, {
      studentId: 'test-on124-s',
      minor: false,
      links: [],
      makeId: () => 'test-on124-p2',
    })
    assert.equal(draft.parentId, 'test-on124-p2')
    assert.equal(state.parents.at(-1)?.id, 'test-on124-p2')
    // Mevcut kayıt: yakınlık kayıttan, kayıt değişmez; olmayan kayıt 404, okulda/18 altında 422.
    const existing = resolveAdultPayer(state.parents, { existingParentId: 'p1' }, options)
    assert.equal(existing.kind, 'existing')
    const count = state.parents.length
    assert.equal(
      attachAdultPayer(state, existing, {
        studentId: 'test-on124-s',
        minor: false,
        links: [],
        makeId: () => 'kullanilmaz',
      }).parentId,
      'p1',
    )
    assert.equal(state.parents.length, count)
    assert.throws(
      () => resolveAdultPayer(state.parents, { existingParentId: 'yok' }, options),
      isDomainError('parent_not_found', 'not_found'),
    )
    assert.throws(
      () => resolveAdultPayer(state.parents, PAYER, { ...options, minor: true }),
      isDomainError('payer_not_applicable'),
    )
    assert.throws(
      () =>
        resolveAdultPayer(
          state.parents,
          { existingParentId: 'p1' },
          {
            ...options,
            isSelfRecord: () => true,
          },
        ),
      isDomainError('payer_not_eligible'),
    )
  })
})
