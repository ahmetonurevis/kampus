import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertApprovalTurn,
  canDecideApprovalStep,
  currentApprovalStep,
  isStepApprover,
  planApprovalDecision,
  planPurchaseApprovalSettings,
  purchaseApprovalSettingsSchema,
  requiredApprovalSteps,
  type PurchaseApprovalStepState,
  type PurchaseApprovalTier,
  type PurchaseApproverMember,
} from '../packages/school-core/src/lib/finance-purchase-approvals.ts'
import {
  planPurchaseRequestWithdraw,
  purchaseRequestActions,
  type PurchaseRequestState,
} from '../packages/school-core/src/lib/finance-purchase-requests.ts'

import { isDomainError } from './support/domain-error.ts'

// Satın alma talebinin kademeli onayı (DOM-FIN-071; ON-223, K-260…K-263).

const ZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'
const issuePaths = (error: unknown) =>
  (error as { issues: { path: (string | number)[] }[] }).issues.map((issue) => issue.path.join('.'))

const REQUESTER = { userId: 'test-front', role: 'onburo' }
const ADMIN_A = { userId: 'test-admin-a', role: 'yonetici' }
const ADMIN_B = { userId: 'test-admin-b', role: 'yonetici' }
const FOUNDER = { userId: 'test-founder', role: 'yonetici' }

/** 0–5.000 TL tek onay, 5.000–20.000 TL iki onay, 20.000 TL üstü üç onay (kurucu temsilcisi). */
const TIERS: PurchaseApprovalTier[] = [
  { minTotalCents: 0, approverRole: 'yonetici', approverUserId: null },
  { minTotalCents: 500_000, approverRole: 'yonetici', approverUserId: null },
  { minTotalCents: 2_000_000, approverRole: null, approverUserId: FOUNDER.userId },
]

const members = (
  entries: [string, PurchaseApproverMember][] = [
    [FOUNDER.userId, { role: 'yonetici', active: true }],
  ],
) => new Map(entries)

const stepsFor = (
  totalCents: number,
  decisions: Partial<Record<number, [PurchaseApprovalStepState['decision'], string]>> = {},
): PurchaseApprovalStepState[] =>
  requiredApprovalSteps(TIERS, totalCents).map((step) => {
    const decided = decisions[step.position]
    return {
      ...step,
      decision: decided?.[0] ?? null,
      decidedByUserId: decided?.[1] ?? null,
    }
  })

test('ON-223, K-260: eşik ayarı şeması; boş liste kademeli onayı kapatır', () => {
  assert.deepEqual(purchaseApprovalSettingsSchema.parse({ tiers: [] }), { tiers: [] })
  const parsed = purchaseApprovalSettingsSchema.parse({
    tiers: [
      { minTotalCents: 0, approverRole: 'yonetici' },
      { minTotalCents: 100, approverUserId: '  test-founder ' },
    ],
  })
  assert.deepEqual(parsed.tiers, [
    { minTotalCents: 0, approverRole: 'yonetici', approverUserId: null },
    { minTotalCents: 100, approverRole: null, approverUserId: 'test-founder' },
  ])
})

test('ON-223, K-260: ilk kademe 0 ile başlar, alt sınırlar kesin artar, aynı kişi iki kademede olmaz', () => {
  assert.throws(
    () =>
      purchaseApprovalSettingsSchema.parse({
        tiers: [{ minTotalCents: 100, approverRole: 'yonetici' }],
      }),
    (error) => ZodError(error) && issuePaths(error).includes('tiers.0.minTotalCents'),
  )
  assert.throws(
    () =>
      purchaseApprovalSettingsSchema.parse({
        tiers: [
          { minTotalCents: 0, approverRole: 'yonetici' },
          { minTotalCents: 500, approverRole: 'yonetici' },
          { minTotalCents: 500, approverRole: 'yonetici' },
        ],
      }),
    (error) => ZodError(error) && issuePaths(error).includes('tiers.2.minTotalCents'),
  )
  assert.throws(
    () =>
      purchaseApprovalSettingsSchema.parse({
        tiers: [
          { minTotalCents: 0, approverUserId: 'test-founder' },
          { minTotalCents: 500, approverUserId: 'test-founder' },
        ],
      }),
    (error) => ZodError(error) && issuePaths(error).includes('tiers.1.approverUserId'),
  )
})

test('ON-223, K-260: kademe ya rol ya adlandırılmış kişi taşır; sınır, sayı ve tür denetlenir', () => {
  const invalid: unknown[] = [
    { tiers: [{ minTotalCents: 0 }] },
    { tiers: [{ minTotalCents: 0, approverRole: 'yonetici', approverUserId: 'test-founder' }] },
    { tiers: [{ minTotalCents: 0, approverRole: 'onburo' }] },
    { tiers: [{ minTotalCents: -1, approverRole: 'yonetici' }] },
    { tiers: [{ minTotalCents: 0.5, approverRole: 'yonetici' }] },
    { tiers: [{ minTotalCents: 0, approverUserId: '   ' }] },
    { tiers: [{ minTotalCents: 0, approverRole: 'yonetici', extra: true }] },
    {
      tiers: Array.from({ length: 6 }, (_, index) => ({
        minTotalCents: index * 100,
        approverRole: 'yonetici',
      })),
    },
    {},
  ]
  for (const input of invalid)
    assert.throws(() => purchaseApprovalSettingsSchema.parse(input), ZodError)
})

test('ON-223, K-260: adlandırılmış onaylayan kurumun etkin yöneticisi olmalıdır', () => {
  const input = { tiers: TIERS }
  assert.deepEqual(planPurchaseApprovalSettings(input, members()).tiers, TIERS)
  for (const map of [
    members([]),
    members([[FOUNDER.userId, { role: 'onburo', active: true }]]),
    members([[FOUNDER.userId, { role: 'yonetici', active: false }]]),
  ])
    assert.throws(
      () => planPurchaseApprovalSettings(input, map),
      (error) =>
        isDomainError('purchase_approval_approver_invalid')(error) &&
        (error as { path?: string[] }).path?.join('.') === 'tiers.2.approverUserId',
    )
  assert.deepEqual(planPurchaseApprovalSettings({ tiers: [] }, members([])), { tiers: [] })
})

test('ON-223, K-260: tutar eşiklere göre kademe listesine çevrilir; sınıra eşit tutar kademeye girer', () => {
  assert.deepEqual(requiredApprovalSteps([], 9_999_999), [])
  assert.equal(requiredApprovalSteps(TIERS, 0).length, 1)
  assert.equal(requiredApprovalSteps(TIERS, 499_999).length, 1)
  assert.equal(requiredApprovalSteps(TIERS, 500_000).length, 2)
  assert.equal(requiredApprovalSteps(TIERS, 1_999_999).length, 2)
  assert.deepEqual(requiredApprovalSteps(TIERS, 2_000_000), [
    { position: 1, minTotalCents: 0, approverRole: 'yonetici', approverUserId: null },
    { position: 2, minTotalCents: 500_000, approverRole: 'yonetici', approverUserId: null },
    { position: 3, minTotalCents: 2_000_000, approverRole: null, approverUserId: FOUNDER.userId },
  ])
  // Sıra kayıttan değil alt sınırdan gelir.
  assert.deepEqual(
    requiredApprovalSteps([...TIERS].reverse(), 600_000).map((step) => step.minTotalCents),
    [0, 500_000],
  )
})

test('ON-223, K-262: sıradaki kademe ve onaylayan eşleşmesi', () => {
  const steps = stepsFor(2_500_000, { 1: ['approved', ADMIN_A.userId] })
  assert.equal(currentApprovalStep(steps)?.position, 2)
  assert.equal(currentApprovalStep([]), null)
  assert.equal(currentApprovalStep(stepsFor(100, { 1: ['approved', ADMIN_A.userId] })), null)
  assert.equal(currentApprovalStep(stepsFor(2_500_000, { 1: ['rejected', ADMIN_A.userId] })), null)
  assert.equal(isStepApprover(TIERS[0]!, ADMIN_A), true)
  assert.equal(isStepApprover(TIERS[0]!, REQUESTER), false)
  assert.equal(isStepApprover(TIERS[2]!, FOUNDER), true)
  assert.equal(isStepApprover(TIERS[2]!, ADMIN_A), false)
})

test('ON-223, K-262: kademeler sırayla onaylanır; son kademe talebi kapatır', () => {
  const total = 2_500_000
  const first = planApprovalDecision(stepsFor(total), REQUESTER.userId, ADMIN_A, 'approved')
  assert.deepEqual(first, { position: 1, decision: 'approved', completes: false })
  const second = planApprovalDecision(
    stepsFor(total, { 1: ['approved', ADMIN_A.userId] }),
    REQUESTER.userId,
    ADMIN_B,
    'approved',
  )
  assert.deepEqual(second, { position: 2, decision: 'approved', completes: false })
  const last = planApprovalDecision(
    stepsFor(total, { 1: ['approved', ADMIN_A.userId], 2: ['approved', ADMIN_B.userId] }),
    REQUESTER.userId,
    FOUNDER,
    'approved',
  )
  assert.deepEqual(last, { position: 3, decision: 'approved', completes: true })
  // Tek kademeli talep ilk onayla kapanır.
  assert.deepEqual(planApprovalDecision(stepsFor(100), REQUESTER.userId, ADMIN_A, 'approved'), {
    position: 1,
    decision: 'approved',
    completes: true,
  })
})

test('ON-223, K-262: herhangi bir kademedeki ret talebi reddeder', () => {
  assert.deepEqual(
    planApprovalDecision(
      stepsFor(2_500_000, { 1: ['approved', ADMIN_A.userId] }),
      REQUESTER.userId,
      ADMIN_B,
      'rejected',
    ),
    { position: 2, decision: 'rejected', completes: true },
  )
  assert.throws(
    () =>
      planApprovalDecision(
        stepsFor(2_500_000, { 1: ['rejected', ADMIN_A.userId] }),
        REQUESTER.userId,
        ADMIN_B,
        'approved',
      ),
    isDomainError('purchase_approval_no_pending_step'),
  )
})

test('ON-223, K-262: talep eden hiçbir kademede karar veremez', () => {
  const ownRequest = ADMIN_A.userId
  for (const decision of ['approved', 'rejected'] as const)
    assert.throws(
      () => planApprovalDecision(stepsFor(100), ownRequest, ADMIN_A, decision),
      isDomainError('purchase_approval_requester', 'forbidden'),
    )
  assert.equal(canDecideApprovalStep(stepsFor(100), ownRequest, ADMIN_A), false)
  assert.equal(canDecideApprovalStep(stepsFor(100), ownRequest, ADMIN_B), true)
})

test('ON-223, K-262: aynı kişi iki kademeyi onaylayamaz', () => {
  const steps = stepsFor(2_500_000, { 1: ['approved', ADMIN_A.userId] })
  assert.throws(
    () => assertApprovalTurn(steps, REQUESTER.userId, ADMIN_A),
    isDomainError('purchase_approval_same_approver', 'forbidden'),
  )
  assert.equal(canDecideApprovalStep(steps, REQUESTER.userId, ADMIN_A), false)
  // Adlandırılmış kişi de daha önce onay verdiyse sonrakini onaylayamaz.
  const founderFirst = stepsFor(2_500_000, {
    1: ['approved', FOUNDER.userId],
    2: ['approved', ADMIN_B.userId],
  })
  assert.throws(
    () => assertApprovalTurn(founderFirst, REQUESTER.userId, FOUNDER),
    isDomainError('purchase_approval_same_approver', 'forbidden'),
  )
})

test('ON-223, K-262: sırası gelmeyen ya da atanmamış kişi karar veremez', () => {
  const atFounder = stepsFor(2_500_000, {
    1: ['approved', ADMIN_A.userId],
    2: ['approved', ADMIN_B.userId],
  })
  const other = { userId: 'test-admin-c', role: 'yonetici' }
  assert.throws(
    () => planApprovalDecision(atFounder, REQUESTER.userId, other, 'rejected'),
    (error) =>
      isDomainError('purchase_approval_not_your_turn', 'forbidden')(error) &&
      (error as Error).message.includes('3. kademe'),
  )
  assert.equal(canDecideApprovalStep(stepsFor(2_500_000), REQUESTER.userId, REQUESTER), false)
  assert.equal(canDecideApprovalStep([], REQUESTER.userId, ADMIN_A), false)
  assert.equal(planApprovalDecision([], REQUESTER.userId, ADMIN_A, 'approved'), null)
})

test('ON-223, K-262: sonraki kademede adlandırılan kişi önceki rol kademesine karar veremez', () => {
  // Kurucu temsilcisi 3. kademede adlandırılmıştır; 1. ve 2. rol kademesini o veremez.
  assert.throws(
    () => planApprovalDecision(stepsFor(2_500_000), REQUESTER.userId, FOUNDER, 'approved'),
    (error) =>
      isDomainError('purchase_approval_reserved', 'forbidden')(error) &&
      (error as Error).message.includes('1. kademe'),
  )
  assert.equal(canDecideApprovalStep(stepsFor(2_500_000), REQUESTER.userId, FOUNDER), false)
  // Kurucunun kademesi gerekmeyen tutarda (2 kademe) rol kademesine karar verebilir.
  assert.equal(canDecideApprovalStep(stepsFor(600_000), REQUESTER.userId, FOUNDER), true)
})

const submitted = (overrides: Partial<PurchaseRequestState> = {}): PurchaseRequestState => ({
  status: 'submitted',
  requestedByUserId: REQUESTER.userId,
  ...overrides,
})

test('ON-223, K-262: ekran kararı yalnız sıradaki onaylayana açar; tek adımlıda her yönetici (K-129)', () => {
  assert.equal(purchaseRequestActions(submitted(), ADMIN_A).decide, true)
  assert.equal(
    purchaseRequestActions(submitted({ requestedByUserId: ADMIN_A.userId }), ADMIN_A).decide,
    true,
  )
  const steps = stepsFor(2_500_000, { 1: ['approved', ADMIN_A.userId] })
  assert.equal(purchaseRequestActions(submitted(), ADMIN_A, steps).decide, false)
  assert.equal(purchaseRequestActions(submitted(), ADMIN_B, steps).decide, true)
  assert.equal(purchaseRequestActions(submitted(), REQUESTER, steps).decide, false)
  assert.equal(
    purchaseRequestActions(submitted({ requestedByUserId: ADMIN_B.userId }), ADMIN_B, steps).decide,
    false,
  )
  assert.equal(
    purchaseRequestActions(submitted({ status: 'approved' }), ADMIN_B, steps).decide,
    false,
  )
})

test('ON-223, K-261: gönderilmiş talep taslağa geri çekilir; ön büro yalnız kendi talebini', () => {
  assert.deepEqual(planPurchaseRequestWithdraw(submitted(), undefined, REQUESTER), {})
  assert.deepEqual(planPurchaseRequestWithdraw(submitted(), {}, ADMIN_A), {})
  assert.throws(
    () => planPurchaseRequestWithdraw(submitted(), {}, { userId: 'test-other', role: 'onburo' }),
    isDomainError('purchase_request_not_owner', 'forbidden'),
  )
  for (const status of ['draft', 'approved', 'rejected', 'cancelled'] as const)
    assert.throws(
      () => planPurchaseRequestWithdraw(submitted({ status }), {}, ADMIN_A),
      isDomainError('purchase_request_not_submitted'),
    )
  assert.throws(() => planPurchaseRequestWithdraw(submitted(), { reason: 'x' }, ADMIN_A), ZodError)
  assert.equal(purchaseRequestActions(submitted(), REQUESTER).withdraw, true)
  assert.equal(
    purchaseRequestActions(submitted(), { userId: 'test-other', role: 'onburo' }).withdraw,
    false,
  )
  assert.equal(purchaseRequestActions(submitted({ status: 'draft' }), REQUESTER).withdraw, false)
})
