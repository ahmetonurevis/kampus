import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import {
  amendContract,
  type AmendContractContext,
} from '../packages/school-core/src/lib/contract-approval.ts'
import {
  assertRenewalWithinTariff,
  enrollProspectWithTariff,
  previewEnrollment,
  priceEnrollment,
  priceEnrollmentOnTerm,
  type EnrollmentTariff,
} from '../packages/school-core/src/lib/enrollment.ts'
import {
  DISCOUNT_LINE_LABELS,
  emptyTariffForm,
  feeTariffFormSchema,
  nextYearTariffForm,
  planTariffCreate,
  planTariffPublish,
  planTariffUpdate,
  tariffFormToBody,
  tariffToForm,
  type FeeItem,
} from '../packages/school-core/src/lib/fee-tariffs.ts'
import {
  announcedPaymentTermLabel,
  contractPaymentTermLabel,
  defaultInstallmentCount,
  feePaymentTermSchema,
  installmentOptionLabel,
  offeredInstallmentCounts,
  PAYMENT_TERM_DISCOUNT_KIND,
  resolvePaymentTerm,
  type FeePaymentTerm,
} from '../packages/school-core/src/lib/payment-terms.ts'
import { planRenewal, quoteRenewal } from '../packages/school-core/src/lib/renewals.ts'
import { isDomainError } from './support/domain-error.ts'

const NOW = '2026-10-06T09:00:00.000Z'
const TODAY = '2026-10-06'
const UPFRONT: FeePaymentTerm = {
  kind: 'upfront',
  minInstallments: 1,
  maxInstallments: 1,
  discountPercentBasisPoints: null,
  discountAmountCents: null,
}
/** 2–4 taksitte ilan ücretinden %3 indirim. */
const SHORT: FeePaymentTerm = {
  kind: 'installment',
  minInstallments: 2,
  maxInstallments: 4,
  discountPercentBasisPoints: 300,
  discountAmountCents: null,
}
const LONG: FeePaymentTerm = {
  kind: 'installment',
  minInstallments: 5,
  maxInstallments: 8,
  discountPercentBasisPoints: null,
  discountAmountCents: null,
}
const TERMS = [UPFRONT, SHORT, LONG]
const tuition: FeeItem = {
  kind: 'tuition',
  level: null,
  amountCents: 10_000_000,
  unit: 'year',
  vatBasisPoints: 1000,
  vatEffectiveDate: '2026-01-01',
  announcedAmountCents: 10_000_000,
}
const TARIFF: EnrollmentTariff = {
  id: 'test-tariff',
  versionNumber: 2,
  items: [tuition],
  discounts: [
    { kind: 'early_payment', percentBasisPoints: 500, amountCents: null },
    { kind: 'referral', percentBasisPoints: 4_800, amountCents: null },
  ],
  paymentTerms: TERMS,
}
const LEGACY: EnrollmentTariff = { ...TARIFF, paymentTerms: [] }
const priceRequest = {
  level: '7',
  institutionType: 'school',
  discounts: [],
  extras: [],
  canApproveCapException: false,
} as const
const publishInput = { announcedDate: '2026-05-01', mebbisRecordedDate: null }
const school = { institutionType: 'school', today: TODAY } as const

function unchangedOnFailure(state: State, action: () => unknown, code: string) {
  const before = structuredClone(state)
  assert.throws(action, isDomainError(code))
  assert.deepEqual(state, before)
}

test('DOM-FIN-013: koşul şeması: peşin tek ödemedir ve fiyat farkı taşımaz, süreli en az 2 taksittir', () => {
  assert.equal(feePaymentTermSchema.safeParse(UPFRONT).success, true)
  assert.equal(feePaymentTermSchema.safeParse(SHORT).success, true)
  const rejected = [
    { ...UPFRONT, maxInstallments: 2 },
    { ...UPFRONT, discountPercentBasisPoints: 100 },
    { ...SHORT, minInstallments: 1 },
    { ...SHORT, minInstallments: 5, maxInstallments: 4 },
    { ...SHORT, discountAmountCents: 100 },
    { ...SHORT, maxInstallments: 13 },
  ]
  for (const term of rejected) assert.equal(feePaymentTermSchema.safeParse(term).success, false)
})

test('DOM-FIN-013: vade farkı alanı yoktur; süreli ödemede ilan ücretinin üstüne çıkan alan reddedilir', () => {
  assert.equal(feePaymentTermSchema.safeParse({ ...LONG, surchargeCents: 100 }).success, false)
  assert.equal(
    feePaymentTermSchema.safeParse({ ...LONG, discountPercentBasisPoints: -100 }).success,
    false,
  )
  assert.equal(
    feePaymentTermSchema.safeParse({ ...LONG, discountAmountCents: -100 }).success,
    false,
  )
  const price = priceEnrollmentOnTerm(TARIFF, { ...priceRequest, installmentCount: 8 })
  assert.equal(price.netCents, tuition.amountCents)
})

test('DOM-FIN-013: taslak koşulları saklar, çakışan taksit aralığı reddedilir', () => {
  const plan = planTariffCreate({ academicYear: 2026, items: [tuition], paymentTerms: TERMS }, [])
  assert.deepEqual(plan.paymentTerms, TERMS)
  assert.deepEqual(planTariffCreate({ academicYear: 2026, items: [tuition] }, []).paymentTerms, [])
  assert.throws(
    () =>
      planTariffCreate(
        {
          academicYear: 2026,
          items: [tuition],
          paymentTerms: [SHORT, { ...LONG, minInstallments: 4 }],
        },
        [],
      ),
    isDomainError('tariff_payment_term_overlap'),
  )
  const row = { status: 'draft', items: [tuition], discounts: [], paymentTerms: TERMS } as const
  assert.deepEqual(planTariffUpdate(row, { items: [tuition] }).paymentTerms, TERMS)
  assert.deepEqual(planTariffUpdate(row, { paymentTerms: [UPFRONT] }).paymentTerms, [UPFRONT])
  assert.throws(
    () => planTariffUpdate(row, { paymentTerms: [SHORT, SHORT] }),
    isDomainError('tariff_payment_term_overlap'),
  )
})

test('DOM-FIN-002, DOM-FIN-013: yayımlanan koşul değişmez, değişiklik yeni sürümle olur', () => {
  const row = { status: 'published', items: [tuition], discounts: [], paymentTerms: TERMS } as const
  assert.throws(
    () => planTariffUpdate(row, { paymentTerms: [UPFRONT] }),
    isDomainError('tariff_not_draft', 'conflict'),
  )
  const next = planTariffCreate({ academicYear: 2026, items: [tuition], paymentTerms: [UPFRONT] }, [
    { versionNumber: 1, status: 'published' },
  ])
  assert.equal(next.versionNumber, 2)
  assert.deepEqual(next.paymentTerms, [UPFRONT])
})

test('DOM-FIN-002, DOM-FIN-013: koşulsuz tarife ve peşin koşulsuz peşin indirimi yayımlanmaz', () => {
  const draft = { status: 'draft', items: [tuition] } as const
  assert.throws(
    () => planTariffPublish({ ...draft, paymentTerms: [] }, publishInput, school),
    isDomainError('tariff_payment_terms_required'),
  )
  assert.throws(
    () => planTariffPublish(draft, publishInput, school),
    isDomainError('tariff_payment_terms_required'),
  )
  const early = [{ kind: 'early_payment', percentBasisPoints: 500, amountCents: null }] as const
  assert.throws(
    () =>
      planTariffPublish({ ...draft, paymentTerms: [LONG], discounts: early }, publishInput, school),
    isDomainError('tariff_early_payment_without_upfront'),
  )
  assert.deepEqual(
    planTariffPublish({ ...draft, paymentTerms: TERMS, discounts: early }, publishInput, school),
    publishInput,
  )
  assert.deepEqual(
    planTariffPublish({ ...draft, paymentTerms: [LONG] }, publishInput, school),
    publishInput,
  )
})

test('DOM-FIN-013: taksit sayısı ilanlı koşula bağlanır; ilanda olmayan sayı reddedilir', () => {
  assert.deepEqual(resolvePaymentTerm(TERMS, 1), { ...UPFRONT, installmentCount: 1 })
  assert.deepEqual(resolvePaymentTerm(TERMS, 3), { ...SHORT, installmentCount: 3 })
  assert.deepEqual(resolvePaymentTerm(TERMS, 8), { ...LONG, installmentCount: 8 })
  assert.throws(() => resolvePaymentTerm(TERMS, 9), isDomainError('payment_term_not_in_tariff'))
  assert.equal(resolvePaymentTerm([], 9), null)
  assert.equal(resolvePaymentTerm(undefined, 9), null)
  assert.equal(resolvePaymentTerm(TERMS, undefined), null)
})

test('DOM-FIN-013, DOM-FIN-021: koşulun fiyat farkı ilan ücretinden düşer, zincirlenmez ve tavana girer', () => {
  const short = priceEnrollmentOnTerm(TARIFF, { ...priceRequest, installmentCount: 3 })
  assert.deepEqual(short.discounts, [{ kind: PAYMENT_TERM_DISCOUNT_KIND, amountCents: 300_000 }])
  assert.equal(short.netCents, 9_700_000)
  const withReferral = priceEnrollmentOnTerm(TARIFF, {
    ...priceRequest,
    installmentCount: 8,
    discounts: ['referral'],
  })
  assert.equal(withReferral.netCents, 5_200_000)
  assert.throws(
    () =>
      priceEnrollmentOnTerm(TARIFF, {
        ...priceRequest,
        installmentCount: 3,
        discounts: ['referral'],
      }),
    isDomainError('discount_cap_exceeded'),
  )
  const fixed: EnrollmentTariff = {
    ...TARIFF,
    paymentTerms: [{ ...SHORT, discountPercentBasisPoints: null, discountAmountCents: 250_000 }],
  }
  assert.equal(
    priceEnrollmentOnTerm(fixed, { ...priceRequest, installmentCount: 2 }).netCents,
    9_750_000,
  )
})

test('DOM-FIN-013, DOM-FIN-020: peşin indirimi yalnız peşin koşulunda geçer', () => {
  const upfront = priceEnrollmentOnTerm(TARIFF, {
    ...priceRequest,
    installmentCount: 1,
    discounts: ['early_payment'],
  })
  assert.equal(upfront.paymentTerm?.kind, 'upfront')
  assert.deepEqual(upfront.discounts, [{ kind: 'early_payment', amountCents: 500_000 }])
  assert.throws(
    () =>
      priceEnrollmentOnTerm(TARIFF, {
        ...priceRequest,
        installmentCount: 3,
        discounts: ['early_payment'],
      }),
    isDomainError('early_payment_requires_upfront'),
  )
})

test('DOM-FIN-013: koşulsuz eski tarife eskisi gibi fiyatlanır, sözleşmeye koşul yazılmaz', () => {
  const price = priceEnrollmentOnTerm(LEGACY, {
    ...priceRequest,
    installmentCount: 12,
    discounts: ['early_payment'],
  })
  assert.equal(price.paymentTerm, null)
  assert.deepEqual(
    price.discounts,
    priceEnrollment(LEGACY, { ...priceRequest, discounts: ['early_payment'] }).discounts,
  )
  const withoutField: EnrollmentTariff = {
    id: 'old',
    versionNumber: 1,
    items: [tuition],
    discounts: [],
  }
  assert.equal(
    priceEnrollmentOnTerm(withoutField, { ...priceRequest, installmentCount: 12 }).paymentTerm,
    null,
  )
})

const ENROLLMENT_INPUT = {
  classId: 'c1',
  tariffId: 'test-tariff',
  firstDueDate: '2026-11-15',
  identity: { kind: 'tc', number: '10000000146', birthDate: '2013-03-01' },
  guardian: { name: 'Test Veli', phone: '05559990001', relationship: 'mother' },
}
function enroll(state: State, installmentCount: number, tariff: EnrollmentTariff = TARIFF) {
  let serial = 0
  return enrollProspectWithTariff(
    state,
    'pr1',
    { ...ENROLLMENT_INPUT, installmentCount },
    (prefix) => `${prefix}-test-${String(serial++)}`,
    NOW,
    {
      institutionType: 'school',
      tariff,
      academicYear: 2026,
      identityHolderId: null,
      approvedByUserId: 'test-user',
      canApproveCapException: false,
      today: TODAY,
    },
  )
}

test('DOM-FIN-013: kesin kayıt sözleşmesi koşulun kopyasını taşır; ilanda olmayan sayıda kayıt yazılmaz', () => {
  const state = createSeed(new Date(NOW))
  const { contract } = enroll(state, 3)
  assert.deepEqual(contract.paymentTerm, { ...SHORT, installmentCount: 3 })
  assert.equal(contract.netCents, 9_700_000)
  assert.deepEqual(contract.discounts, [{ kind: PAYMENT_TERM_DISCOUNT_KIND, amountCents: 300_000 }])
  const invoices = state.invoices.filter((item) => contract.invoiceIds?.includes(item.id))
  assert.equal(
    invoices.reduce((sum, item) => sum + item.amount, 0),
    9_700_000,
  )
  assert.equal(invoices.length, 3)

  const other = createSeed(new Date(NOW))
  unchangedOnFailure(other, () => enroll(other, 9), 'payment_term_not_in_tariff')
})

test('DOM-FIN-013: eski tarifeyle kesin kayıt sözleşmesinde koşul alanı yoktur', () => {
  const { contract } = enroll(createSeed(new Date(NOW)), 12, LEGACY)
  assert.equal('paymentTerm' in contract, false)
})

test('DOM-FIN-013: önizleme sunucuyla aynı kuralla konuşur', () => {
  const options = { institutionType: 'school', level: '7' } as const
  const values = { lessonHours: '', discounts: [], extras: [] }
  const ok = previewEnrollment(TARIFF, { ...values, installmentCount: '3' }, options)
  assert.ok(ok.ok)
  assert.equal(ok.price.paymentTerm?.installmentCount, 3)
  assert.equal(ok.price.netCents, 9_700_000)
  const rejected = previewEnrollment(TARIFF, { ...values, installmentCount: '9' }, options)
  assert.deepEqual(rejected, {
    ok: false,
    message: 'Bu taksit sayısı tarifede ilan edilen ödeme koşullarında yok.',
  })
  const early = previewEnrollment(
    TARIFF,
    { ...values, discounts: ['early_payment'], installmentCount: '8' },
    options,
  )
  assert.equal(early.ok, false)
  assert.ok(previewEnrollment(TARIFF, values, options).ok, 'taksit sayısı verilmeyen önizleme')
})

const ADMIN = { role: 'yonetici' } as const
const RENEWAL_QUOTE = {
  studentId: 's3',
  targetClassId: 'c1',
  academicYear: 2027,
  installmentCount: 3,
}
const renewalContext = (tariff: EnrollmentTariff) => ({
  tariff,
  previousTariff: null,
  priceIndexes: [{ academicYear: 2027, ppiBasisPoints: 4_000, cpiBasisPoints: 3_000 }],
})
function renewalState() {
  const state = createSeed(new Date(NOW))
  state.contracts = state.contracts.filter((item) => item.studentId !== 's3')
  state.academicYear = 2026
  const student = state.students.find((item) => item.id === 's3')
  const fromClass = state.classes.find((item) => item.id === student?.classId)
  const target = state.classes.find(
    (item) => item.id !== fromClass?.id && item.grade === (fromClass?.grade ?? 0) + 1,
  )
  return { state, targetClassId: target?.id ?? 'c1' }
}

test('DOM-FIN-013: yenileme planı koşulun kopyasını sözleşme ve fiyat kararına yazar; ilanda olmayan sayı plan açmaz', () => {
  const { state, targetClassId } = renewalState()
  const input = { ...RENEWAL_QUOTE, targetClassId }
  const context = renewalContext({ ...TARIFF, items: [{ ...tuition, amountCents: 5_000_000 }] })
  const quote = quoteRenewal(state, ADMIN, input, context)
  assert.deepEqual(quote.paymentTerm, { ...SHORT, installmentCount: 3 })
  assert.deepEqual(quote.discounts, [{ kind: PAYMENT_TERM_DISCOUNT_KIND, amountCents: 150_000 }])
  const body = { ...input, mode: 'renew', tariffId: 'test-tariff', firstDueDate: '2027-09-15' }
  let serial = 0
  const makeId = (prefix: string) => `${prefix}-test-${String(serial++)}`
  const planContext = { ...context, approvedByUserId: 'u-test' }
  unchangedOnFailure(
    state,
    () => planRenewal(state, ADMIN, { ...body, installmentCount: 9 }, makeId, NOW, planContext),
    'payment_term_not_in_tariff',
  )
  const made = planRenewal(state, ADMIN, body, makeId, NOW, planContext)
  const contract = state.contracts.find((item) => item.id === made.contractId)
  assert.deepEqual(contract?.paymentTerm, { ...SHORT, installmentCount: 3 })
  assert.deepEqual(made.renewal.pricing?.paymentTerm, { ...SHORT, installmentCount: 3 })
})

test('DOM-FIN-013: eski tarifeyle yenileme önizlemesinde koşul boştur', () => {
  const { state, targetClassId } = renewalState()
  const quote = quoteRenewal(
    state,
    ADMIN,
    { ...RENEWAL_QUOTE, targetClassId, installmentCount: 12 },
    renewalContext({ ...LEGACY, items: [{ ...tuition, amountCents: 5_000_000 }] }),
  )
  assert.equal(quote.paymentTerm, null)
})

test('DOM-FIN-013: iş akışı köprüsü de taksit sayısını ve fiyat farkını ilana bağlar', () => {
  const state = createSeed(new Date(NOW))
  const student = state.students.find((item) => item.id === 's1')
  const target = state.classes.find((item) => item.id !== student?.classId && item.isActive)
  assert.ok(target)
  state.contracts = state.contracts.filter((item) => item.studentId !== 's1')
  const renewal = {
    studentId: 's1',
    targetClassId: target.id,
    year: 2026,
    mode: 'renew',
    total: 90_000,
    discount: 0,
    scholarship: 0,
    count: 3,
    startDate: '2026-09-15',
  }
  const tariff = {
    items: [{ ...tuition, amountCents: 10_000_000 }],
    paymentTerms: TERMS,
    priceIndexes: [],
  }
  const check = (input: object) => assertRenewalWithinTariff(state, input, tariff, 'school')
  assert.throws(() => check({ ...renewal, count: 9 }), isDomainError('payment_term_not_in_tariff'))
  // 3 taksitte %3 indirim: üst sınır 97.000 ₺.
  assert.throws(() => check({ ...renewal, total: 97_001 }), isDomainError('renewal_above_tariff'))
  assert.throws(
    () =>
      assertRenewalWithinTariff(
        state,
        { ...renewal, total: 100_001 },
        { ...tariff, paymentTerms: [] },
        'school',
      ),
    isDomainError('renewal_above_tariff'),
  )
})

const amendState = (
  paymentTerm: object,
  discounts: { kind: string; amountCents: number }[] = [],
) => {
  const state = createSeed(new Date(NOW))
  const student = state.students[0]
  assert.ok(student)
  state.renewals = []
  const invoice = (id: string, installment: number) => ({
    id,
    studentId: student.id,
    installment,
    amount: 3_000_000,
    dueDate: `2026-${String(9 + installment).padStart(2, '0')}-15T09:00:00.000Z`,
    paidAt: null as string | null,
    method: null as string | null,
    reminderAt: null,
    feeKind: 'tuition',
  })
  state.invoices = [invoice('t-1', 1), invoice('t-2', 2), invoice('t-3', 3)]
  state.contracts = [
    {
      id: 'contract-1',
      studentId: student.id,
      date: '2026-09-01T09:00:00.000Z',
      amount: 9_000_000,
      title: 'Özel okul eğitim sözleşmesi',
      invoiceIds: ['t-1', 't-2', 't-3'],
      academicYear: 2026,
      tariffId: 'tariff-1',
      tariffVersion: 2,
      grossCents: 10_000_000,
      netCents: 9_000_000,
      discounts,
      extras: [],
      approvedByUserId: 'u-admin',
      payer: 'guardian',
      paymentTerm,
      approval: {
        method: 'wet_signature',
        approvedAt: '2026-09-02T09:00:00.000Z',
        approvedByUserId: 'u-desk',
        payerName: 'Veli',
        plan: [],
      },
    } as State['contracts'][number],
  ]
  return state
}
const amender = (overrides: Partial<AmendContractContext> = {}): AmendContractContext => {
  let serial = 0
  return {
    tariff: TARIFF,
    canApproveCapException: false,
    allocated: new Map(),
    userId: 'u-admin',
    now: NOW,
    makeId: (prefix) => `${prefix}-amend-${String(serial++)}`,
    ...overrides,
  }
}
const AMEND = { reason: 'Veli planı değiştirmek istedi', firstDueDate: '2026-12-15' }

test('DOM-FIN-013: ek protokol ilanda olmayan taksit sayısıyla açılmaz, koşul değişince fiyat farkı yeniden hesaplanır', () => {
  const short = { ...SHORT, installmentCount: 3 }
  const lines = [{ kind: PAYMENT_TERM_DISCOUNT_KIND, amountCents: 300_000 }]
  const state = amendState(short, lines)
  unchangedOnFailure(
    state,
    () => amendContract(state, 'contract-1', { ...AMEND, installmentCount: 9 }, amender()),
    'payment_term_not_in_tariff',
  )
  // Aynı koşulda (fiyat farkı aynı) yalnız sayı değişir.
  const same = amendContract(state, 'contract-1', { ...AMEND, installmentCount: 4 }, amender())
  assert.deepEqual(same.paymentTerm, { ...SHORT, installmentCount: 4 })
  assert.deepEqual(same.discounts, lines)

  // Farksız koşula geçince indirim kalkar, net ilan ücretine döner.
  const longer = amendState(short, lines)
  const amended = amendContract(longer, 'contract-1', { ...AMEND, installmentCount: 6 }, amender())
  assert.deepEqual(amended.paymentTerm, { ...LONG, installmentCount: 6 })
  assert.deepEqual(amended.discounts, [])
  assert.equal(amended.netCents, 10_000_000)
})

test('DOM-FIN-013: peşin sözleşme süreliye dönerken peşin indirimi kalmaz', () => {
  const state = amendState({ ...UPFRONT, installmentCount: 1 }, [
    { kind: 'early_payment', amountCents: 500_000 },
  ])
  unchangedOnFailure(
    state,
    () => amendContract(state, 'contract-1', { ...AMEND, installmentCount: 6 }, amender()),
    'early_payment_requires_upfront',
  )
  const amended = amendContract(
    state,
    'contract-1',
    { ...AMEND, installmentCount: 6, discounts: [] },
    amender(),
  )
  assert.deepEqual(amended.discounts, [])
  assert.equal(amended.paymentTerm?.kind, 'installment')
})

test('DOM-FIN-013: tahsil edilmiş taksit koşul sayısına girer', () => {
  const state = amendState({ ...SHORT, installmentCount: 3 })
  const allocated = new Map([['t-1', 3_000_000]])
  assert.throws(
    () =>
      amendContract(state, 'contract-1', { ...AMEND, installmentCount: 8 }, amender({ allocated })),
    isDomainError('payment_term_not_in_tariff'),
  )
  const amended = amendContract(
    state,
    'contract-1',
    { ...AMEND, installmentCount: 3 },
    amender({ allocated, tariff: { ...TARIFF, paymentTerms: [SHORT] } }),
  )
  assert.equal(amended.paymentTerm?.installmentCount, 4)
})

test('DOM-FIN-013: tarifesiz eski sözleşmenin ek protokolü koşul aramaz', () => {
  const state = amendState({ ...SHORT, installmentCount: 3 })
  const contract = state.contracts[0]
  assert.ok(contract)
  delete contract.paymentTerm
  const amended = amendContract(
    state,
    'contract-1',
    { ...AMEND, installmentCount: 12 },
    amender({ tariff: null }),
  )
  assert.equal('paymentTerm' in amended, false)
})

test('DOM-FIN-013: tarife formu koşulları taşır; boş fiyat farkı, hatalı aralık ve oran ayrıştırılır', () => {
  const stored = {
    academicYear: 2026,
    items: [tuition],
    discounts: [],
    paymentTerms: [
      UPFRONT,
      SHORT,
      { ...LONG, discountAmountCents: 100_050, discountPercentBasisPoints: null },
    ],
  }
  const form = tariffToForm(stored)
  assert.deepEqual(form.paymentTerms[1], {
    kind: 'installment',
    minInstallments: '2',
    maxInstallments: '4',
    mode: 'percent',
    value: '3,00',
  })
  assert.equal(form.paymentTerms[2]?.mode, 'amount')
  assert.equal(feeTariffFormSchema.safeParse(form).success, true)
  assert.deepEqual(tariffFormToBody(form), stored)

  const base = emptyTariffForm(2026, TODAY)
  assert.deepEqual(tariffFormToBody({ ...base, items: form.items }).paymentTerms, [
    UPFRONT,
    { ...LONG, minInstallments: 2, maxInstallments: 12 },
  ])
  const row = form.paymentTerms[1]
  assert.ok(row)
  const withRow = (changes: object) => ({ ...form, paymentTerms: [{ ...row, ...changes }] })
  const issuePath = (changes: object) =>
    feeTariffFormSchema.safeParse(withRow(changes)).error?.issues[0]?.path.at(-1)
  assert.equal(issuePath({ maxInstallments: '1' }), 'maxInstallments')
  assert.equal(issuePath({ minInstallments: '1' }), 'minInstallments')
  assert.equal(issuePath({ value: '101' }), 'value')
  assert.equal(issuePath({ mode: 'amount', value: 'on' }), 'value')
  // Peşin satırında taksit ve fiyat farkı alanları yok sayılır.
  assert.equal(
    feeTariffFormSchema.safeParse(
      withRow({ kind: 'upfront', maxInstallments: '9', mode: 'percent', value: '5' }),
    ).success,
    true,
  )
  assert.deepEqual(
    tariffFormToBody({
      ...form,
      paymentTerms: [
        { ...row, kind: 'upfront', maxInstallments: '9', mode: 'percent', value: '5' },
      ],
    }).paymentTerms,
    [UPFRONT],
  )
})

test('DOM-FIN-013: eski tarife yeni sürüme koşulsuz gelir, sonraki yıla koşullar taşınır', () => {
  const legacy = { academicYear: 2026, items: [tuition], discounts: [] }
  assert.deepEqual(tariffToForm(legacy).paymentTerms, [])
  assert.deepEqual(
    tariffFormToBody(nextYearTariffForm({ ...legacy, paymentTerms: TERMS })).paymentTerms,
    TERMS,
  )
})

test('DOM-FIN-013: seçenekler ve etiketler ilandan çıkar', () => {
  assert.deepEqual(offeredInstallmentCounts(TERMS), [1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual(offeredInstallmentCounts([UPFRONT]), [1])
  assert.equal(offeredInstallmentCounts([]).length, 12)
  assert.equal(offeredInstallmentCounts(undefined).length, 12)
  assert.equal(defaultInstallmentCount(TERMS), 8)
  assert.equal(defaultInstallmentCount([UPFRONT, SHORT]), 4)
  assert.equal(defaultInstallmentCount([UPFRONT]), 1)
  assert.equal(defaultInstallmentCount([]), 8)
  assert.equal(announcedPaymentTermLabel(UPFRONT), 'Peşin · tek ödeme')
  assert.equal(announcedPaymentTermLabel(SHORT), 'Süreli · 2–4 taksit · %3 indirim')
  assert.equal(
    announcedPaymentTermLabel({ ...SHORT, maxInstallments: 2 }),
    'Süreli · 2 taksit · %3 indirim',
  )
  assert.equal(
    announcedPaymentTermLabel({ ...LONG, discountPercentBasisPoints: 250 }),
    'Süreli · 5–8 taksit · %2,5 indirim',
  )
  assert.match(
    announcedPaymentTermLabel({ ...LONG, discountAmountCents: 100_000 }),
    /^Süreli · 5–8 taksit · 1\.000,00.*indirim$/,
  )
  assert.equal(contractPaymentTermLabel({ ...UPFRONT, installmentCount: 1 }), 'Peşin · tek ödeme')
  assert.equal(contractPaymentTermLabel({ ...LONG, installmentCount: 6 }), 'Süreli · 6 taksit')
  assert.equal(installmentOptionLabel(3, TERMS), 'Süreli · 3 taksit · %3 indirim')
  assert.equal(installmentOptionLabel(3, []), '3 taksit')
  assert.equal(DISCOUNT_LINE_LABELS[PAYMENT_TERM_DISCOUNT_KIND], 'Ödeme koşulu')
})
