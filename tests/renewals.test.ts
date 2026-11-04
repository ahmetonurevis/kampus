import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { EnrollmentTariff } from '../packages/school-core/src/lib/enrollment.ts'
import type { FeeItem } from '../packages/school-core/src/lib/fee-tariffs.ts'
import type { ScholarshipProgram } from '../packages/school-core/src/lib/finance-scholarships.ts'
import {
  planPriceIndexCreate,
  planPriceIndexUpdate,
  planRenewal,
  quoteRenewal,
  type RenewalContext,
} from '../packages/school-core/src/lib/renewals.ts'
import {
  renewalCeiling,
  type PriceIndexEntry,
} from '../packages/school-core/src/lib/renewal-ceiling.ts'

import { isDomainError } from './support/domain-error.ts'

const NOW = '2026-10-06T09:00:00.000Z'
const YEAR = 2027
const ADMIN = { role: 'yonetici' } as const
const DESK = { role: 'onburo' } as const

const item = (overrides: Partial<FeeItem>): FeeItem => ({
  kind: 'tuition',
  level: null,
  amountCents: 10_000_000,
  unit: 'year',
  vatBasisPoints: 1000,
  vatEffectiveDate: '2026-01-01',
  announcedAmountCents: null,
  ...overrides,
})
const TARIFF: EnrollmentTariff = {
  id: 'test-tariff',
  versionNumber: 3,
  items: [item({}), item({ kind: 'meal', amountCents: 1_000_000 })],
  discounts: [
    { kind: 'early_payment', percentBasisPoints: 1_000, amountCents: null },
    { kind: 'sibling', percentBasisPoints: 3_000, amountCents: null },
    { kind: 'referral', percentBasisPoints: 6_000, amountCents: null },
  ],
}
/** ÜFE %40 + TÜFE %30 → ortalama %35, ek 5 puan: %40 artış. */
const RATES: PriceIndexEntry = { academicYear: YEAR, ppiBasisPoints: 4_000, cpiBasisPoints: 3_000 }
const PROGRAM: ScholarshipProgram = {
  id: '11111111-1111-4111-8111-111111111111',
  academicYear: YEAR,
  percentBasisPoints: 2_500,
  amountCents: null,
  capacity: 2,
  notifiedDate: '2026-09-01',
}
const CONTEXT: RenewalContext = { tariff: TARIFF, previousTariff: null, priceIndexes: [RATES] }
const QUOTE = {
  studentId: 's3',
  targetClassId: 'c1',
  academicYear: YEAR,
  installmentCount: 4,
}
const PLAN = { ...QUOTE, mode: 'renew', tariffId: TARIFF.id, firstDueDate: '2027-01-31' }

/** s3 (6-A → 7-A): baz sözleşmesi verilen tutarla; örnek veri sözleşmesinin yerini alır. */
function seeded(contract: Partial<State['contracts'][number]> = { grossCents: 5_000_000 }) {
  const state = createSeed(new Date(NOW))
  state.contracts = state.contracts.filter((c) => c.studentId !== 's3')
  state.contracts.push({
    id: 'test-contract',
    studentId: 's3',
    date: NOW,
    amount: 4_000_000,
    title: 'Özel okul eğitim sözleşmesi',
    academicYear: 2026,
    ...contract,
  })
  return state
}

function makeIds() {
  let serial = 0
  return (prefix: string) => `${prefix}-test-${String(++serial)}`
}

const plan = (
  state: State,
  input: object = PLAN,
  context: RenewalContext = CONTEXT,
  session: { role: 'yonetici' | 'onburo' | 'veli' | 'ogretmen' } = ADMIN,
) => planRenewal(state, session, input, makeIds(), NOW, { ...context, approvedByUserId: 'u-test' })

function unchangedOnFailure(state: State, action: () => unknown, code: string, kind = 'rule') {
  const before = structuredClone(state)
  assert.throws(action, isDomainError(code, kind))
  assert.deepEqual(state, before)
}

test('DOM-FIN-005: tavan baz ücrete (ÜFE + TÜFE) / 2 + 5 puan uygular; ilanın altındaysa ücret tavandır', () => {
  const state = seeded()
  const quote = quoteRenewal(state, ADMIN, QUOTE, CONTEXT)
  assert.equal(quote.ceiling.status, 'applied')
  assert.ok(quote.ceiling.status === 'applied')
  assert.equal(quote.ceiling.ceilingCents, 7_000_000)
  assert.equal(quote.ceiling.baseCents, 5_000_000)
  assert.equal(quote.ceiling.baseSource, 'contract')
  assert.equal(quote.announcedCents, 10_000_000)
  assert.equal(quote.maxTuitionCents, 7_000_000)
  assert.equal(quote.tuitionCents, 7_000_000)
  assert.equal(quote.netCents, 7_000_000)
  assert.deepEqual(quote.installments, [1_750_000, 1_750_000, 1_750_000, 1_750_000])
})

test('DOM-FIN-005: tavanı aşan tutarla plan oluşturulamaz, kayıt değişmez; tavanın altındaki tutar kabul edilir', () => {
  const state = seeded()
  unchangedOnFailure(
    state,
    () => plan(state, { ...PLAN, tuitionCents: 7_000_001 }),
    'renewal_above_ceiling',
  )
  const made = plan(state, { ...PLAN, tuitionCents: 6_000_000 })
  assert.equal(made.renewal.amount, 6_000_000)
})

test('DOM-FIN-002: ilanı aşan tutar reddedilir; tavan ilandan yüksekse ücret ilandır', () => {
  const state = seeded({ grossCents: 9_000_000 })
  const quote = quoteRenewal(state, ADMIN, QUOTE, CONTEXT)
  assert.equal(quote.maxTuitionCents, 10_000_000)
  unchangedOnFailure(
    state,
    () => plan(state, { ...PLAN, tuitionCents: 10_000_001 }),
    'renewal_above_tariff',
  )
})

test('DOM-FIN-002: yayımlı tarife yoksa plan ve önizleme reddedilir; tarife değiştiyse 409', () => {
  const state = seeded()
  unchangedOnFailure(
    state,
    () => quoteRenewal(state, ADMIN, QUOTE, { ...CONTEXT, tariff: null }),
    'tariff_not_published',
  )
  unchangedOnFailure(
    state,
    () => plan(state, { ...PLAN, tariffId: 'test-eski' }),
    'tariff_changed',
    'conflict',
  )
})

test('DOM-FIN-005: oran girilmemiş yılda plan reddedilir; yıl atlanmışsa her yılın oranı sırayla uygulanır', () => {
  const state = seeded({ academicYear: 2025, grossCents: 5_000_000 })
  unchangedOnFailure(state, () => plan(state), 'price_index_missing')
  const chained = quoteRenewal(state, ADMIN, QUOTE, {
    ...CONTEXT,
    priceIndexes: [{ ...RATES, academicYear: 2026 }, RATES],
  })
  assert.ok(chained.ceiling.status === 'applied')
  assert.equal(chained.ceiling.baseYear, 2025)
  // 50.000 ₺ × 1,40 × 1,40 = 98.000 ₺
  assert.equal(chained.ceiling.ceilingCents, 9_800_000)
})

test('DOM-FIN-005: sözleşmesi olmayan öğrencide baz önceki yılın ilan ücreti; o da yoksa tavan hesaplanamaz', () => {
  const state = seeded()
  state.contracts = state.contracts.filter((c) => c.studentId !== 's3')
  const previous = quoteRenewal(state, ADMIN, QUOTE, {
    ...CONTEXT,
    previousTariff: { items: [item({ amountCents: 6_000_000, announcedAmountCents: 5_500_000 })] },
  })
  assert.ok(previous.ceiling.status === 'applied')
  assert.equal(previous.ceiling.baseSource, 'previous_tariff')
  assert.equal(previous.ceiling.ceilingCents, 7_700_000)
  const none = quoteRenewal(state, ADMIN, QUOTE, CONTEXT)
  assert.deepEqual(none.ceiling, { status: 'no_base' })
  assert.equal(none.tuitionCents, 10_000_000)
})

test('DOM-FIN-005: kademenin başlangıç sınıfında tavan uygulanmaz; iptal edilen yenileme baz olmaz', () => {
  const state = seeded()
  assert.deepEqual(
    renewalCeiling(state, {
      studentId: 's3',
      targetGrade: 9,
      year: YEAR,
      previousAnnouncedCents: null,
      priceIndexes: [],
    }),
    { status: 'entry_grade' },
  )
  state.contracts.push({
    id: 'test-iptal',
    studentId: 's3',
    date: NOW,
    amount: 1,
    title: 'İptal',
    academicYear: 2026,
    grossCents: 1,
  })
  state.renewals.push({
    id: 'test-yenileme',
    studentId: 's3',
    fromClassId: 'c3',
    targetClassId: 'c1',
    year: 2026,
    mode: 'renew',
    amount: 1,
    status: 'İptal',
    contractId: 'test-iptal',
    createdAt: NOW,
    updatedAt: NOW,
  })
  const ceiling = renewalCeiling(state, {
    studentId: 's3',
    targetGrade: 7,
    year: YEAR,
    previousAnnouncedCents: null,
    priceIndexes: [RATES],
  })
  assert.ok(ceiling.status === 'applied')
  assert.equal(ceiling.baseCents, 5_000_000)
})

test('DOM-FIN-023: kardeş indirimi koşulu kalkınca baz kayıt yılındaki indirimsiz ücrettir; gerekçe gösterilir, cari sözleşme değişmez', () => {
  const state = seeded({
    academicYear: 2025,
    grossCents: 4_000_000,
    discounts: [{ kind: 'sibling', amountCents: 1_200_000 }],
  })
  const student = state.students.find((s) => s.id === 's3')
  assert.ok(student)
  for (const other of state.students)
    if (other.id !== 's3' && other.parentId === student.parentId) other.isActive = false
  state.contracts.push({
    id: 'test-contract-2',
    studentId: 's3',
    date: NOW,
    amount: 3_920_000,
    title: 'Özel okul eğitim sözleşmesi',
    academicYear: 2026,
    grossCents: 5_000_000,
    discounts: [{ kind: 'sibling', amountCents: 1_080_000 }],
  })
  const before = structuredClone(state.contracts)
  const quote = quoteRenewal(state, ADMIN, QUOTE, {
    ...CONTEXT,
    priceIndexes: [{ ...RATES, academicYear: 2026 }, RATES],
  })
  assert.ok(quote.ceiling.status === 'applied')
  assert.equal(quote.ceiling.baseSource, 'enrollment_contract')
  assert.equal(quote.ceiling.baseYear, 2025)
  // Kayıt yılı indirimsiz 40.000 ₺ × 1,40 × 1,40 = 78.400 ₺
  assert.equal(quote.ceiling.ceilingCents, 7_840_000)
  assert.match(quote.ceiling.discountLoss?.reason ?? '', /Kardeş indirimi koşulu kalktı/)
  assert.deepEqual(state.contracts, before)
})

test('DOM-FIN-020, -021, -022: indirim tarifedeki türden ve ilandan hesaplanır; tavan, kardeş ve ilansız tür reddedilir', () => {
  const state = seeded({ grossCents: 9_000_000 })
  const quote = quoteRenewal(state, ADMIN, { ...QUOTE, discounts: ['early_payment'] }, CONTEXT)
  assert.deepEqual(quote.discounts, [{ kind: 'early_payment', amountCents: 1_000_000 }])
  assert.equal(quote.netCents, 9_000_000)
  const withDiscounts = (discounts: string[]) => () =>
    quoteRenewal(state, ADMIN, { ...QUOTE, discounts }, CONTEXT)
  unchangedOnFailure(state, withDiscounts(['referral']), 'discount_cap_exceeded')
  unchangedOnFailure(state, withDiscounts(['corporate']), 'discount_not_in_tariff')
  const student = state.students.find((s) => s.id === 's3')
  assert.ok(student)
  for (const other of state.students)
    if (other.id !== 's3' && other.parentId === student.parentId) other.isActive = false
  unchangedOnFailure(state, withDiscounts(['sibling']), 'sibling_discount_ineligible')
})

test('DOM-FIN-021: tavanla düşen ücret indirimi karşılayamıyorsa reddedilir', () => {
  const state = seeded({ grossCents: 500_000 })
  unchangedOnFailure(
    state,
    () => quoteRenewal(state, ADMIN, { ...QUOTE, discounts: ['early_payment'] }, CONTEXT),
    'discount_exceeds_gross',
  )
})

test('DOM-FIN-025: burs bildirilmiş programdan, yalnız yönetici onayıyla atanır; oran ilandan hesaplanır, kontenjan ve yıl denetlenir', () => {
  const state = seeded({ grossCents: 9_000_000 })
  const context = { ...CONTEXT, scholarshipProgram: PROGRAM, scholarshipAwardedCount: 0 }
  const input = { ...PLAN, scholarshipProgramId: PROGRAM.id }
  const blocked = (
    code: string,
    ctx: RenewalContext,
    session: { role: 'onburo' | 'yonetici' },
    kind = 'rule',
  ) => unchangedOnFailure(state, () => plan(state, input, ctx, session), code, kind)
  blocked('scholarship_approval_required', context, DESK)
  blocked(
    'scholarship_program_not_found',
    { ...context, scholarshipProgram: null },
    ADMIN,
    'not_found',
  )
  blocked(
    'scholarship_program_not_found',
    { ...context, scholarshipProgram: { ...PROGRAM, academicYear: 2026 } },
    ADMIN,
    'not_found',
  )
  blocked(
    'scholarship_program_not_notified',
    { ...context, scholarshipProgram: { ...PROGRAM, notifiedDate: null } },
    ADMIN,
  )
  blocked(
    'scholarship_capacity_full',
    { ...context, scholarshipAwardedCount: 2 },
    ADMIN,
    'conflict',
  )
  blocked(
    'scholarship_already_awarded',
    { ...context, scholarshipStudentAwarded: true },
    ADMIN,
    'conflict',
  )
  const made = plan(state, input, { ...context, scholarshipStudentAwarded: false })
  assert.deepEqual(made.scholarshipAward, { programId: PROGRAM.id, amountCents: 2_500_000 })
  assert.equal(made.renewal.amount, 7_500_000)
  const contract = state.contracts.find((c) => c.id === made.contractId)
  assert.deepEqual(contract?.scholarship, { programId: PROGRAM.id, amountCents: 2_500_000 })
})

test('DOM-FIN-025: tam bursta öğrenim taksiti açılmaz; ek hizmet ayrı taksittir', () => {
  const state = seeded({ grossCents: 9_000_000 })
  const made = plan(
    state,
    { ...PLAN, extras: ['meal'], scholarshipProgramId: PROGRAM.id },
    {
      ...CONTEXT,
      scholarshipProgram: { ...PROGRAM, percentBasisPoints: 10_000 },
      scholarshipAwardedCount: 0,
    },
  )
  assert.equal(made.renewal.amount, 0)
  const invoices = state.invoices.filter((i) => i.contractId === made.contractId)
  assert.deepEqual(
    invoices.map((i) => [i.feeKind, i.amount]),
    [['meal', 1_000_000]],
  )
})

test('DOM-KAY-020, DOM-FIN-010, -012: plan sözleşme ve kendi taksitlerini yazar; sınıf değişmez, ücret kararı kayıtta kalır', () => {
  const state = seeded()
  const invoiceCount = state.invoices.length
  const made = plan(state, { ...PLAN, discounts: ['early_payment'], extras: ['meal'] })
  assert.equal(state.students.find((s) => s.id === 's3')?.classId, 'c3')
  const contract = state.contracts.find((c) => c.id === made.contractId)
  assert.ok(contract)
  assert.equal(contract.classId, 'c1')
  assert.equal(contract.academicYear, YEAR)
  assert.equal(contract.title, '2027–2028 eğitim sözleşmesi')
  assert.equal(contract.tariffId, TARIFF.id)
  assert.equal(contract.tariffVersion, TARIFF.versionNumber)
  assert.equal(contract.grossCents, 7_000_000)
  assert.equal(contract.netCents, 6_000_000)
  assert.equal(contract.approvedByUserId, 'u-test')
  assert.equal(state.invoices.length, invoiceCount + 5)
  const own = state.invoices.filter((i) => contract.invoiceIds?.includes(i.id))
  assert.equal(own.length, 5)
  assert.ok(own.every((i) => i.contractId === contract.id && i.academicYear === YEAR))
  assert.equal(
    own.filter((i) => i.feeKind === 'tuition').reduce((sum, i) => sum + i.amount, 0),
    6_000_000,
  )
  assert.equal(contract.amount, 7_000_000)
  assert.equal(made.renewal.status, 'Planlandı')
  assert.equal(made.renewal.pricing?.announcedCents, 10_000_000)
  assert.equal(made.renewal.pricing?.ceiling.status, 'applied')
})

test('ay sonunu aşan vade ayın son gününe çekilir', () => {
  const state = seeded()
  const made = plan(state)
  const dues = state.invoices
    .filter((i) => i.contractId === made.contractId)
    .map((i) => i.dueDate.slice(0, 10))
  assert.deepEqual(dues, ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
})

test('DOM-KAY-021: aynı yıla ikinci yenileme ve açık plan reddedilir, geçmiş ve düşük yıl reddedilir', () => {
  const state = seeded()
  plan(state)
  unchangedOnFailure(state, () => plan(state), 'renewal_already_exists', 'conflict')
  unchangedOnFailure(
    state,
    () => plan(state, { ...PLAN, academicYear: YEAR + 1 }),
    'transition_planned_exists',
    'conflict',
  )
  const other = seeded()
  unchangedOnFailure(
    other,
    () => plan(other, { ...PLAN, academicYear: other.academicYear }),
    'renewal_year_invalid',
  )
})

test('DOM-KAY-010, -021: üst düzey olmayan sınıf ve dolu sınıf reddedilir', () => {
  const state = seeded()
  unchangedOnFailure(
    state,
    () => plan(state, { ...PLAN, targetClassId: 'c3' }),
    'new_class_level_invalid',
  )
  const target = state.classes.find((c) => c.id === 'c1')
  assert.ok(target)
  target.capacity = 1
  unchangedOnFailure(state, () => plan(state), 'class_capacity_full')
})

test('DOM-KAY-022: mezuniyet yalnız 12. sınıfta, borç ve sözleşme açmaz', () => {
  const state = seeded()
  const graduate = { mode: 'graduate', studentId: 's3', academicYear: YEAR }
  unchangedOnFailure(state, () => plan(state, graduate), 'graduation_grade_invalid')
  const senior = state.classes.find((c) => c.id === 'c3')
  assert.ok(senior)
  senior.grade = 12
  const contracts = state.contracts.length
  const invoices = state.invoices.length
  const made = plan(state, graduate)
  assert.equal(made.contractId, null)
  assert.equal(made.renewal.amount, 0)
  assert.equal(made.renewal.targetClassId, '')
  assert.equal(state.contracts.length, contracts)
  assert.equal(state.invoices.length, invoices)
})

test('DOM-YTK-001: yenileme yalnız yönetici ve ön büroda; kapsam dışı rol kayıt değiştiremez', () => {
  const state = seeded()
  for (const role of ['veli', 'ogretmen'] as const)
    unchangedOnFailure(
      state,
      () => plan(state, PLAN, CONTEXT, { role }),
      'permission_denied',
      'forbidden',
    )
  assert.throws(
    () => quoteRenewal(state, { role: 'ogrenci' }, QUOTE, CONTEXT),
    isDomainError('permission_denied', 'forbidden'),
  )
  assert.equal(plan(state, PLAN, CONTEXT, DESK).renewal.status, 'Planlandı')
})

test('biçim hatasında kayıt değişmez', () => {
  const state = seeded()
  const before = structuredClone(state)
  assert.throws(() => plan(state, { ...PLAN, installmentCount: 13 }))
  assert.throws(() => plan(state, { ...PLAN, extra: true }))
  assert.throws(() => quoteRenewal(state, ADMIN, { ...QUOTE, tuitionCents: 0 }, CONTEXT))
  assert.deepEqual(state, before)
})

test('DOM-FIN-005: ÜFE/TÜFE satırı yıl başına tektir, gelecek bülten tarihi reddedilir', () => {
  const input = {
    academicYear: YEAR,
    ppiBasisPoints: 4_000,
    cpiBasisPoints: 3_000,
    source: 'TÜİK bülteni 12345',
    bulletinDate: '2026-02-03',
  }
  assert.equal(planPriceIndexCreate(input, false, '2026-10-06').academicYear, YEAR)
  assert.throws(
    () => planPriceIndexCreate(input, true, '2026-10-06'),
    isDomainError('price_index_exists', 'conflict'),
  )
  assert.throws(
    () => planPriceIndexCreate({ ...input, bulletinDate: '2026-10-07' }, false, '2026-10-06'),
    isDomainError('price_index_date_future'),
  )
  assert.deepEqual(planPriceIndexUpdate({ ppiBasisPoints: 1 }, '2026-10-06'), { ppiBasisPoints: 1 })
  assert.throws(
    () => planPriceIndexUpdate({ bulletinDate: '2026-10-07' }, '2026-10-06'),
    isDomainError('price_index_date_future'),
  )
  assert.throws(() => planPriceIndexUpdate({}, '2026-10-06'))
})
