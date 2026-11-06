import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import { discountLines } from '../packages/school-core/src/lib/enrollment.ts'
import { REFERRAL_NOTIFICATION_TYPES } from '../packages/school-core/src/lib/finance-notifications.ts'
import {
  cancelledRenewalContractIds,
  isFirstInstallmentPaid,
  referralCancelReason,
  referralRewardDraft,
  referralUseOf,
  requireUsableReferralReward,
} from '../packages/school-core/src/lib/finance-referrals.ts'

/** Referans indirimi hakkının saf kuralları (DOM-FIN-024; ON-139). */

const NOW = new Date('2026-10-06T09:00:00.000Z')
const TARIFF = {
  id: 'tariff-1',
  discounts: [{ kind: 'referral' as const, percentBasisPoints: 1_000, amountCents: null }],
}
const FAMILY_PARENT = 'p3'

function seeded() {
  const state = createSeed(NOW)
  const prospect = state.prospects[0]
  assert.ok(prospect)
  prospect.source = 'Veli referansı'
  prospect.referrerStudentId = 's3'
  const student = state.students.find((item) => item.id === 's1')
  assert.ok(student)
  return { state, prospect, referred: student }
}

const isCode =
  (code: string, kind = 'rule') =>
  (error: unknown) =>
    error instanceof DomainError && error.code === code && error.kind === kind

test('DOM-FIN-024: taslak kim, hangi aday, yıl ve tarifenin oran ya da tutarını taşır', () => {
  const { state, prospect, referred } = seeded()
  assert.deepEqual(
    referralRewardDraft(state, {
      prospectId: prospect.id,
      studentId: referred.id,
      academicYear: 2026,
      tariff: TARIFF,
    }),
    {
      prospectId: prospect.id,
      referrerStudentId: 's3',
      referrerParentId: FAMILY_PARENT,
      referredStudentId: referred.id,
      academicYear: 2026,
      tariffId: 'tariff-1',
      percentBasisPoints: 1_000,
      amountCents: null,
    },
  )
})

test('DOM-FIN-024: ilan yoksa, referans yoksa ya da aynı aileyse hak açılmaz', () => {
  const { state, prospect, referred } = seeded()
  const draft = (tariff = TARIFF) =>
    referralRewardDraft(state, {
      prospectId: prospect.id,
      studentId: referred.id,
      academicYear: 2026,
      tariff,
    })
  assert.equal(draft({ ...TARIFF, discounts: [] }), null)

  // Kişi kendi çocuğu için referans olamaz.
  const parentId = referred.parentId
  referred.parentId = FAMILY_PARENT
  assert.equal(draft(), null)
  referred.parentId = parentId

  // Yeni veli satırıyla girilse de kardeş adayı aynı aileyi gösterir.
  prospect.siblingOfId = 's3'
  assert.equal(draft(), null)
  delete prospect.siblingOfId

  // Velinin telefonu aynıysa aynı kişidir.
  const phone = '05559990001'
  const parents = state.parents
  const own = parents.find((item) => item.id === parentId)
  const referrerParent = parents.find((item) => item.id === FAMILY_PARENT)
  assert.ok(own && referrerParent)
  own.phone = phone
  referrerParent.phone = phone
  assert.equal(draft(), null)
  referrerParent.phone = '05559990002'
  assert.notEqual(draft(), null)

  // Silinmiş referans öğrenci ve kaynak dışı aday.
  prospect.referrerStudentId = 'olmayan'
  assert.equal(draft(), null)
  delete prospect.referrerStudentId
  assert.equal(draft(), null)
})

const usable = { id: 'r1', status: 'available', referrerParentId: 'p3' } as const
const use = (overrides = {}) =>
  requireUsableReferralReward({
    kinds: ['referral'],
    rewardId: 'r1',
    reward: usable,
    ownerParentId: 'p3',
    ...overrides,
  })

test('DOM-FIN-024: hak yalnız sahibinin ailesinde, kullanılabilir durumda ve kalemle birlikte kullanılır', () => {
  assert.equal(use(), 'r1')
  assert.equal(use({ kinds: [], rewardId: undefined, reward: null }), null)
  assert.throws(() => use({ rewardId: undefined }), isCode('referral_reward_required'))
  assert.throws(() => use({ kinds: ['sibling'] }), isCode('referral_discount_required'))
  assert.throws(() => use({ reward: null }), isCode('referral_reward_not_found', 'not_found'))
  assert.throws(
    () => use({ reward: { ...usable, id: 'r2' } }),
    isCode('referral_reward_not_found', 'not_found'),
  )
  assert.throws(() => use({ ownerParentId: null }), isCode('referral_reward_not_owned'))
  assert.throws(() => use({ ownerParentId: 'p1' }), isCode('referral_reward_not_owned'))
  assert.throws(
    () => use({ reward: { ...usable, status: 'used' } }),
    isCode('referral_reward_used', 'conflict'),
  )
  assert.throws(
    () => use({ reward: { ...usable, status: 'cancelled' } }),
    isCode('referral_reward_cancelled'),
  )
  assert.throws(
    () => use({ reward: { ...usable, status: 'pending' } }),
    isCode('referral_reward_not_earned'),
  )
})

test('DOM-FIN-024: DOM-FIN-021 tavanını aşan referans kalemi düşer, kalem yoksa ya da yer yoksa kısaltılmaz', () => {
  const rules = [
    { kind: 'referral' as const, percentBasisPoints: 6_000, amountCents: null },
    { kind: 'sibling' as const, percentBasisPoints: 5_000, amountCents: null },
    { kind: 'early_payment' as const, percentBasisPoints: 2_000, amountCents: null },
  ]
  const lines = (kinds: ('referral' | 'sibling' | 'early_payment')[], trim = true) =>
    discountLines(rules, 100_000, kinds, { canApproveCapException: false, trimReferralToCap: trim })
  assert.deepEqual(lines(['referral']), [{ kind: 'referral', amountCents: 50_000 }])
  assert.deepEqual(lines(['early_payment', 'referral']), [
    { kind: 'early_payment', amountCents: 20_000 },
    { kind: 'referral', amountCents: 30_000 },
  ])
  // Yer kalmadıysa hak boşa harcanmaz, tavan reddi kalır.
  assert.throws(() => lines(['sibling', 'referral']), isCode('discount_cap_exceeded'))
  // Hak yoksa eski davranış: reddedilir.
  assert.throws(() => lines(['referral'], false), isCode('discount_cap_exceeded'))
  // Referans kalemi yoksa kısaltacak bir şey yoktur.
  assert.throws(() => lines(['sibling', 'early_payment']), isCode('discount_cap_exceeded'))
})

test('DOM-FIN-024: kullanım tutarı sözleşmenin referans kalemidir', () => {
  assert.equal(referralUseOf(null, []), null)
  assert.deepEqual(referralUseOf('r1', [{ kind: 'referral', amountCents: 1_000 }]), {
    rewardId: 'r1',
    amountCents: 1_000,
  })
  assert.deepEqual(referralUseOf('r1', []), { rewardId: 'r1', amountCents: 0 })
})

test('DOM-FIN-024: hakkı doğuran taksit o yılın en küçük numaralı taksitidir', () => {
  const paid = '2026-10-01T09:00:00.000Z'
  assert.equal(isFirstInstallmentPaid([], 2026), false)
  assert.equal(
    isFirstInstallmentPaid(
      [
        { installment: 2, paidAt: paid, academicYear: 2026 },
        { installment: 1, paidAt: null, academicYear: 2026 },
      ],
      2026,
    ),
    false,
  )
  assert.equal(
    isFirstInstallmentPaid(
      [
        { installment: 2, paidAt: null, academicYear: 2026 },
        { installment: 1, paidAt: paid, academicYear: 2026 },
      ],
      2026,
    ),
    true,
  )
  assert.equal(
    isFirstInstallmentPaid([{ installment: 1, paidAt: paid, academicYear: 2027 }], 2026),
    false,
    'başka yılın taksiti sayılmaz',
  )
  assert.equal(isFirstInstallmentPaid([{ installment: 1, paidAt: paid }], 2026), true)
})

test('DOM-FIN-024: ayrılışta iptal kararı; kullanılmış hak geri istenmez', () => {
  const before = { started: false, refundCents: 500 }
  const beforeNoRefund = { started: false, refundCents: 0 }
  const after = { started: true, refundCents: 500 }
  assert.equal(referralCancelReason('available', before), 'refunded_before_start')
  assert.equal(referralCancelReason('pending', before), 'refunded_before_start')
  assert.equal(referralCancelReason('available', beforeNoRefund), null)
  assert.equal(referralCancelReason('pending', beforeNoRefund), 'withdrawn_before_earned')
  assert.equal(referralCancelReason('available', after), null)
  assert.equal(referralCancelReason('pending', after), 'withdrawn_before_earned')
  assert.equal(referralCancelReason('used', before), null)
  assert.equal(referralCancelReason('cancelled', before), null)
})

test('DOM-FIN-024: iptal edilen planlanmış yenilemenin sözleşmesi hakkı geri açar', () => {
  const renewals = [
    { studentId: 's1', status: 'İptal', contractId: 'c-1' },
    { studentId: 's1', status: 'Planlandı', contractId: 'c-2' },
    { studentId: 's1', status: 'İptal' },
    { studentId: 's2', status: 'İptal', contractId: 'c-3' },
  ]
  assert.deepEqual(
    cancelledRenewalContractIds(
      { renewals } as unknown as Parameters<typeof cancelledRenewalContractIds>[0],
      's1',
    ),
    ['c-1'],
  )
})

test('DOM-FIN-024: bildirim verisi yalnız hak kimliğidir; başlıkta tutar ve aday yok', () => {
  const spec = REFERRAL_NOTIFICATION_TYPES.referral_reward_earned
  assert.equal(spec.category, 'service')
  assert.equal(spec.module, 'finance')
  assert.deepEqual(spec.audiences, { minor: ['parent'], adult: ['student'] })
  assert.deepEqual(spec.data.parse({ rewardId: 'r1' }), { rewardId: 'r1' })
  for (const extra of [{ amountCents: 1 }, { prospectId: 'pr1' }, { name: 'Aday' }])
    assert.equal(spec.data.safeParse({ rewardId: 'r1', ...extra }).success, false)
  for (const title of Object.values(spec.titles)) assert.doesNotMatch(title, /₺|\d|aday/i)
})
