import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { EnrollmentTariff } from '../packages/school-core/src/lib/enrollment.ts'
import type { FeeItem } from '../packages/school-core/src/lib/fee-tariffs.ts'
import type { ScholarshipProgram } from '../packages/school-core/src/lib/finance-scholarships.ts'
import {
  previewRenewalBulk,
  RENEWAL_BULK_LIMIT,
  renewalBulkPlanSchema,
  renewalBulkPreviewSchema,
  renewalBulkProblem,
  renewalBulkRowPlan,
  renewalBulkSkipped,
  renewalCandidateLines,
  suggestRenewalTarget,
  type RenewalBulkContext,
} from '../packages/school-core/src/lib/renewal-bulk.ts'
import { planRenewal, quoteRenewal } from '../packages/school-core/src/lib/renewals.ts'

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
  items: [item({})],
  discounts: [
    { kind: 'early_payment', percentBasisPoints: 1_000, amountCents: null },
    { kind: 'sibling', percentBasisPoints: 3_000, amountCents: null },
  ],
}
const CONTEXT: RenewalBulkContext = {
  tariff: TARIFF,
  previousTariff: null,
  priceIndexes: [{ academicYear: YEAR, ppiBasisPoints: 4_000, cpiBasisPoints: 3_000 }],
  debts: new Map(),
}
const PROGRAM: ScholarshipProgram = {
  id: '11111111-1111-4111-8111-111111111111',
  academicYear: YEAR,
  percentBasisPoints: 5_000,
  amountCents: null,
  capacity: 1,
  notifiedDate: '2026-09-01',
}

/** s3 (6-A → 7-A) son sözleşmesi 50.000 ₺; ÜFE %40 + TÜFE %30 + 5 puan: tavan 70.000 ₺. */
function seeded() {
  const state = createSeed(new Date(NOW))
  state.academicYear = YEAR - 1
  state.renewals = []
  state.contracts = state.contracts.filter((c) => c.studentId !== 's3')
  state.contracts.push({
    id: 'test-contract',
    studentId: 's3',
    date: NOW,
    amount: 4_000_000,
    title: 'Özel okul eğitim sözleşmesi',
    academicYear: 2026,
    grossCents: 5_000_000,
  })
  return state
}

function makeIds() {
  let serial = 0
  return (prefix: string) => `${prefix}-test-${String(++serial)}`
}

/** s3'ün sınıfında, velisi ayrı, sözleşmesiz öğrenciler. */
function addClassmates(state: State, count: number) {
  const student = state.students.find((s) => s.id === 's3')
  assert.ok(student)
  for (let index = 0; index < count; index += 1)
    state.students.push({
      ...student,
      id: `test-s${String(index)}`,
      parentId: `test-p${String(index)}`,
    })
}

const body = (rows: readonly object[], extra: object = {}) => ({
  academicYear: YEAR,
  installmentCount: 7,
  firstDueDate: '2027-01-31',
  rows,
  ...extra,
})
const S3 = { studentId: 's3', targetClassId: 'c1' }

test('IST-105, ON-086: satır tek öğrenci önizlemesiyle aynı ücreti ve kuruş dağıtımını verir; toplam nete eşittir', () => {
  const single = quoteRenewal(
    seeded(),
    ADMIN,
    { ...S3, academicYear: YEAR, installmentCount: 3 },
    CONTEXT,
  )
  const [row] = previewRenewalBulk(
    seeded(),
    ADMIN,
    body([S3], { installmentCount: 3 }),
    makeIds(),
    NOW,
    CONTEXT,
  )
  assert.ok(row)
  assert.equal(row.outcome, 'ready')
  assert.deepEqual(row.price, single)
  assert.ok(row.price)
  // 3'e tam bölünmeyen net: kuruş kaybı yok (IST-105 kabulü).
  assert.notEqual(row.price.netCents % 3, 0)
  assert.equal(
    row.price.installments.reduce((sum, value) => sum + value, 0),
    row.price.netCents,
  )
})

test('DOM-FIN-005: liste tavanı tek öğrenci kuralıyla hesaplar; önerilen ücret ilan ve tavanın küçüğü', () => {
  const [line] = renewalCandidateLines(
    seeded(),
    ADMIN,
    { studentIds: ['s3'], academicYear: YEAR },
    CONTEXT,
  )
  assert.ok(line)
  assert.equal(line.announcedCents, 10_000_000)
  assert.equal(line.ceiling?.status, 'applied')
  assert.equal(line.suggestedTuitionCents, 7_000_000)
  assert.deepEqual(line.previousContract, { academicYear: 2026, tuitionCents: 5_000_000 })
  assert.equal(line.planStatus, 'not_planned')
  assert.equal(line.targetClassId, 'c1')
  assert.equal(line.problem, null)
})

test('DOM-FIN-005: oran, tarife ya da düzey kalemi yoksa liste satırı düşmez, problem söyler', () => {
  const lines = (context: RenewalBulkContext) =>
    renewalCandidateLines(seeded(), ADMIN, { studentIds: ['s3'], academicYear: YEAR }, context)[0]
  const missing = lines({ ...CONTEXT, priceIndexes: [] })
  assert.equal(missing?.problem?.code, 'price_index_missing')
  assert.equal(missing?.announcedCents, 10_000_000)
  assert.equal(missing?.suggestedTuitionCents, null)
  assert.equal(lines({ ...CONTEXT, tariff: null })?.problem?.code, 'tariff_not_published')
  assert.equal(
    lines({ ...CONTEXT, tariff: { ...TARIFF, items: [item({ level: '99' })] } })?.problem?.code,
    'tariff_tuition_missing',
  )
})

test('IST-105: liste plan durumunu mevcut yenilemeden okur; rolü ve geçmiş yılı reddeder', () => {
  const state = seeded()
  planRenewal(
    state,
    ADMIN,
    renewalBulkRowPlan(renewalBulkPreviewSchema.parse(body([S3])), S3, TARIFF.id),
    makeIds(),
    NOW,
    { ...CONTEXT, approvedByUserId: 'u-test' },
  )
  const status = () =>
    renewalCandidateLines(state, DESK, { studentIds: ['s3'], academicYear: YEAR }, CONTEXT)[0]
  assert.equal(status()?.planStatus, 'planned')
  assert.ok(status()?.renewalId)
  assert.equal(status()?.renewalNetCents, 7_000_000)
  const entry = state.renewals[0]
  assert.ok(entry)
  entry.status = 'Tamamlandı'
  assert.equal(status()?.planStatus, 'completed')
  entry.status = 'İptal'
  assert.equal(status()?.planStatus, 'cancelled')
  assert.equal(
    renewalCandidateLines(state, ADMIN, { studentIds: ['yok'], academicYear: YEAR }, CONTEXT)
      .length,
    0,
  )
  assert.throws(
    () =>
      renewalCandidateLines(
        state,
        { role: 'veli' },
        { studentIds: ['s3'], academicYear: YEAR },
        CONTEXT,
      ),
    isDomainError('permission_denied', 'forbidden'),
  )
  assert.throws(
    () => renewalCandidateLines(state, ADMIN, { studentIds: ['s3'], academicYear: 2026 }, CONTEXT),
    isDomainError('renewal_year_invalid'),
  )
})

test('DOM-KAY-025: borçlu öğrenci önizlemede ücretiyle atlanır, "yönetici onayı gerekir" der, yer tutmaz', () => {
  const state = seeded()
  const [row] = previewRenewalBulk(state, ADMIN, body([S3]), makeIds(), NOW, {
    ...CONTEXT,
    debts: new Map([['s3', 150_000]]),
  })
  assert.equal(row?.outcome, 'skipped')
  assert.equal(row?.problem?.code, 'renewal_debt_unapproved')
  assert.match(row?.problem?.message ?? '', /yönetici onayı gerekir/)
  assert.equal(row?.price?.outstandingTuitionCents, 150_000)
  assert.equal(state.renewals.length, 0)
})

test('DOM-KAY-025: toplu gövde borç onayı almaz; üst sınır, boş ve yinelenen satır doğrulamada reddedilir', () => {
  assert.equal(
    renewalBulkPreviewSchema.safeParse(body([S3], { debtApproved: true })).success,
    false,
  )
  assert.equal(
    renewalBulkPlanSchema.safeParse(body([S3], { tariffId: 't', debtApproved: true })).success,
    false,
  )
  assert.equal(renewalBulkPlanSchema.safeParse(body([S3])).success, false)
  assert.equal(renewalBulkPreviewSchema.safeParse(body([])).success, false)
  assert.equal(renewalBulkPreviewSchema.safeParse(body([S3, S3])).success, false)
  const many = Array.from({ length: RENEWAL_BULK_LIMIT + 1 }, (_, index) => ({
    studentId: `test-${String(index)}`,
    targetClassId: 'c1',
  }))
  assert.equal(renewalBulkPreviewSchema.safeParse(body(many)).success, false)
  assert.equal(
    renewalBulkPreviewSchema.safeParse(body(many.slice(0, RENEWAL_BULK_LIMIT))).success,
    true,
  )
})

test('IST-105: bir satırın reddi öteki satırı etkilemez; öndeki satır sınıf kontenjanını doldurur', () => {
  const state = seeded()
  const target = state.classes.find((c) => c.id === 'c1')
  assert.ok(target)
  addClassmates(state, 2)
  target.capacity = state.students.filter((s) => s.isActive && s.classId === 'c1').length + 1
  const rows = previewRenewalBulk(
    state,
    ADMIN,
    body([
      { studentId: 'yok', targetClassId: 'c1' },
      { studentId: 'test-s0', targetClassId: 'c1' },
      { studentId: 'test-s1', targetClassId: 'c1' },
    ]),
    makeIds(),
    NOW,
    CONTEXT,
  )
  assert.deepEqual(
    rows.map((row) => [row.outcome, row.problem?.code ?? null]),
    [
      ['failed', 'not_found'],
      ['ready', null],
      ['failed', 'class_capacity_full'],
    ],
  )
})

test('DOM-FIN-025: burs kontenjanı satırlar arasında sayılır; ön büro burs atayamaz; yılda ikinci burs reddedilir', () => {
  const state = seeded()
  addClassmates(state, 1)
  const scholarship = { ...CONTEXT, scholarshipProgram: PROGRAM, scholarshipAwardedCount: 0 }
  const withProgram = { scholarshipProgramId: PROGRAM.id }
  const rows = previewRenewalBulk(
    state,
    ADMIN,
    body([S3, { studentId: 'test-s0', targetClassId: 'c1' }], withProgram),
    makeIds(),
    NOW,
    scholarship,
  )
  assert.equal(rows[0]?.outcome, 'ready')
  assert.equal(rows[0]?.price?.scholarship?.programId, PROGRAM.id)
  assert.deepEqual(
    [rows[1]?.outcome, rows[1]?.problem?.code],
    ['failed', 'scholarship_capacity_full'],
  )
  const [desk] = previewRenewalBulk(
    seeded(),
    DESK,
    body([S3], withProgram),
    makeIds(),
    NOW,
    scholarship,
  )
  assert.equal(desk?.problem?.code, 'scholarship_approval_required')
  const [twice] = previewRenewalBulk(seeded(), ADMIN, body([S3], withProgram), makeIds(), NOW, {
    ...scholarship,
    scholarshipStudents: new Set(['s3']),
  })
  assert.equal(twice?.problem?.code, 'scholarship_already_awarded')
})

test('DOM-FIN-022, DOM-FIN-013: kardeş ve peşin indirimi tek öğrenci kuralından geçer', () => {
  const [sibling] = previewRenewalBulk(
    seeded(),
    ADMIN,
    body([S3], { discounts: ['sibling'] }),
    makeIds(),
    NOW,
    CONTEXT,
  )
  assert.equal(sibling?.problem?.code, 'sibling_discount_ineligible')
  const upfront: RenewalBulkContext = {
    ...CONTEXT,
    tariff: {
      ...TARIFF,
      paymentTerms: [
        {
          kind: 'upfront',
          minInstallments: 1,
          maxInstallments: 1,
          discountPercentBasisPoints: null,
          discountAmountCents: null,
        },
      ],
    },
  }
  const [wrongCount] = previewRenewalBulk(seeded(), ADMIN, body([S3]), makeIds(), NOW, upfront)
  assert.equal(wrongCount?.problem?.code, 'payment_term_not_in_tariff')
  const [paid] = previewRenewalBulk(
    seeded(),
    ADMIN,
    body([S3], { installmentCount: 1, discounts: ['early_payment'] }),
    makeIds(),
    NOW,
    upfront,
  )
  assert.equal(paid?.outcome, 'ready')
  assert.deepEqual(paid?.price?.discounts, [{ kind: 'early_payment', amountCents: 1_000_000 }])
  assert.deepEqual(paid?.price?.installments, [6_000_000])
})

test('DOM-FIN-022: kardeşler aynı istekte seçilse de her satır tek öğrenci planıyla aynı kararı verir', () => {
  const state = seeded()
  const student = state.students.find((s) => s.id === 's3')
  assert.ok(student)
  state.students.push({ ...student, id: 'test-sibling', name: 'Test Kardeş', isActive: true })
  state.contracts.push({
    id: 'test-sibling-contract',
    studentId: 'test-sibling',
    date: NOW,
    amount: 4_000_000,
    title: 'Özel okul eğitim sözleşmesi',
    academicYear: 2026,
    grossCents: 4_000_000,
  })
  const before = state.contracts.length
  const rows = previewRenewalBulk(
    state,
    ADMIN,
    body([S3, { studentId: 'test-sibling', targetClassId: 'c1' }], { discounts: ['sibling'] }),
    makeIds(),
    NOW,
    CONTEXT,
  )
  assert.deepEqual(
    rows.map((row) => row.outcome),
    ['ready', 'ready'],
  )
  assert.equal(state.contracts.length, before)
})

test('DOM-KAY-021: planı olan öğrenci atlanır, başka yılda açık planı olan başarısızdır', () => {
  const state = seeded()
  const first = previewRenewalBulk(state, ADMIN, body([S3]), makeIds(), NOW, CONTEXT)
  assert.equal(first[0]?.outcome, 'ready')
  const again = previewRenewalBulk(state, ADMIN, body([S3]), makeIds(), NOW, CONTEXT)
  assert.deepEqual(
    [again[0]?.outcome, again[0]?.problem?.code],
    ['skipped', 'renewal_already_exists'],
  )
  const other = previewRenewalBulk(
    state,
    ADMIN,
    body([S3], { academicYear: YEAR + 1 }),
    makeIds(),
    NOW,
    { ...CONTEXT, priceIndexes: [] },
  )
  assert.deepEqual(
    [other[0]?.outcome, other[0]?.problem?.code],
    ['failed', 'transition_planned_exists'],
  )
})

test('IST-105: hedef sınıf önerisi aynı kampüs ve şubedir; birden çok aday varsa öneri yok', () => {
  const six = { id: 'a', name: '6-A', grade: 6, branchId: 'b1' }
  const sevenA = { id: 'b', name: '7-A', grade: 7, branchId: 'b1' }
  const sevenB = { id: 'c', name: '7-B', grade: 7, branchId: 'b1' }
  const other = { id: 'd', name: '7-A', grade: 7, branchId: 'b2' }
  assert.equal(suggestRenewalTarget([six, sevenB, sevenA, other], six)?.id, 'b')
  assert.equal(suggestRenewalTarget([sevenB], six)?.id, 'c')
  assert.equal(suggestRenewalTarget([sevenB, { ...sevenA, id: 'e', name: '7-C' }], six), null)
  assert.equal(suggestRenewalTarget([{ ...sevenA, isActive: false }], six), null)
  assert.equal(suggestRenewalTarget([sevenA], { ...six, name: 'Altı' })?.id, 'b')
  assert.equal(
    suggestRenewalTarget([sevenB, { ...sevenA, name: '7 Mavi', section: 'A' }], {
      ...six,
      section: 'A',
    })?.id,
    'b',
    'şube alanı varsa addan önce gelir',
  )
  assert.equal(suggestRenewalTarget([other], six), null)
})

test('IST-105: atlanan kodlar yalnız borç ve mevcut plandır; borç iletisi toplu yola özgüdür', () => {
  assert.equal(renewalBulkSkipped('renewal_debt_unapproved'), true)
  assert.equal(renewalBulkSkipped('renewal_already_exists'), true)
  assert.equal(renewalBulkSkipped('class_capacity_full'), false)
  assert.match(renewalBulkProblem('renewal_debt_unapproved', 'x').message, /yönetici onayı gerekir/)
  assert.equal(renewalBulkProblem('class_capacity_full', 'x').message, 'x')
})
