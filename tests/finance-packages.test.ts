import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import { INSTITUTION_TYPES } from '../packages/school-core/src/modules/collection-modules.ts'
import type { EnrollmentTariff } from '../packages/school-core/src/lib/enrollment.ts'
import type { FeeItem } from '../packages/school-core/src/lib/fee-tariffs.ts'
import {
  packageHourBalance,
  packageNameKey,
  packageSaleStatus,
  planPackageCreate,
  planPackageExtension,
  planPackageHourEntry,
  planPackageUpdate,
  quotePackageSale,
  sellPackage,
  type LessonPackage,
  type PackageCourse,
  type PackageHourEntry,
  type PackageSaleContext,
} from '../packages/school-core/src/lib/finance-packages.ts'

import { isDomainError } from './support/domain-error.ts'

const isZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'

const NOW = '2026-10-06T09:00:00.000Z'
const TODAY = '2026-10-06'
const COURSE_ID = '22222222-2222-4222-8222-222222222222'
const PACKAGE_ID = '33333333-3333-4333-8333-333333333333'
const HOURLY = 50_000

const item = (overrides: Partial<FeeItem>): FeeItem => ({
  kind: 'tuition',
  level: null,
  amountCents: HOURLY,
  unit: 'lesson_hour',
  vatBasisPoints: 1000,
  vatEffectiveDate: '2026-01-01',
  announcedAmountCents: null,
  ...overrides,
})
const TARIFF: EnrollmentTariff = {
  id: 'test-tariff',
  versionNumber: 2,
  items: [
    item({}),
    item({ level: 'B1', amountCents: 60_000 }),
    item({ kind: 'stationery', amountCents: 75_000, unit: 'item' }),
  ],
  discounts: [
    { kind: 'early_payment', percentBasisPoints: 1_000, amountCents: null },
    { kind: 'sibling', percentBasisPoints: 3_000, amountCents: null },
    { kind: 'corporate', percentBasisPoints: 6_000, amountCents: null },
    { kind: 'staff_child', percentBasisPoints: 6_000, amountCents: null },
  ],
}
const HOURS_PACKAGE: LessonPackage = {
  id: PACKAGE_ID,
  kind: 'hours',
  name: '40 saatlik paket',
  courseId: null,
  level: null,
  lessonHours: 40,
  hourlyCents: null,
  validityDays: 180,
}
const COURSE: PackageCourse = { id: COURSE_ID, level: 'B1', totalHours: 96, status: 'active' }
const COURSE_PACKAGE: LessonPackage = {
  ...HOURS_PACKAGE,
  kind: 'course',
  name: 'B1 kur ücreti',
  courseId: COURSE_ID,
  lessonHours: null,
  validityDays: null,
}
const CONTEXT: PackageSaleContext = {
  institutionType: 'language_school',
  package: HOURS_PACKAGE,
  course: null,
  tariff: TARIFF,
  academicYear: 2026,
  canApproveCapException: false,
}
const QUOTE = { packageId: PACKAGE_ID, studentId: 's3', installmentCount: 4 }
const SALE = { ...QUOTE, tariffId: TARIFF.id, firstDueDate: '2026-10-31' }
const SELL_CONTEXT = { ...CONTEXT, approvedByUserId: 'test-user' }

const makeIds = () => {
  let next = 0
  return (prefix: string) => `${prefix}-test-${String((next += 1))}`
}
const seed = (): State => createSeed(new Date(NOW))

/** Reddedilen işlem State'i değiştirmez. */
function unchangedOnFailure(state: State, action: () => unknown, check: (e: unknown) => boolean) {
  const before = structuredClone({ contracts: state.contracts, invoices: state.invoices })
  assert.throws(action, check)
  assert.deepEqual({ contracts: state.contracts, invoices: state.invoices }, before)
}

test('DOM-DIL-050: paket tanımı kur ücretinde kur ister, saat paketinde saat ister', () => {
  const plan = planPackageCreate(
    { kind: 'hours', name: '  40 saatlik paket ', lessonHours: 40, validityDays: 180 },
    { course: null, nameTaken: false },
  )
  assert.equal(plan.name, '40 saatlik paket')
  assert.equal(plan.courseId, null)
  assert.equal(plan.hourlyCents, null)
  const valid = { course: COURSE, nameTaken: false }
  assert.throws(() => planPackageCreate({ kind: 'course', name: 'Kur' }, valid), isZodError)
  assert.throws(() => planPackageCreate({ kind: 'hours', name: 'Saat' }, valid), isZodError)
  assert.throws(
    () =>
      planPackageCreate(
        { kind: 'course', name: 'Kur', courseId: COURSE_ID, lessonHours: 8 },
        valid,
      ),
    isZodError,
  )
  assert.throws(
    () =>
      planPackageCreate(
        { kind: 'private', name: 'Özel', courseId: COURSE_ID, lessonHours: 8, level: 'A1' },
        valid,
      ),
    isZodError,
  )
  assert.throws(
    () => planPackageCreate({ kind: 'hours', name: 'S', lessonHours: 8 }, valid),
    isZodError,
  )
  assert.throws(
    () => planPackageCreate({ kind: 'hours', name: 'Saat', lessonHours: 0 }, valid),
    isZodError,
  )
  assert.throws(
    () => planPackageCreate({ kind: 'hours', name: 'Saat', lessonHours: 8, extra: 1 }, valid),
    isZodError,
  )
})

test('DOM-DIL-006: pakete bağlanan kur kurumda bulunur ve arşivli olmaz; ad etkin pakette tekildir', () => {
  const body = { kind: 'course', name: 'B1 kur ücreti', courseId: COURSE_ID }
  assert.equal(planPackageCreate(body, { course: COURSE, nameTaken: false }).courseId, COURSE_ID)
  // Taslak kura paket tanımlanabilir; etkinlik satışta aranır.
  assert.equal(
    planPackageCreate(body, { course: { ...COURSE, status: 'draft' }, nameTaken: false }).courseId,
    COURSE_ID,
  )
  assert.throws(
    () => planPackageCreate(body, { course: null, nameTaken: false }),
    isDomainError('course_not_found', 'not_found'),
  )
  assert.throws(
    () => planPackageCreate(body, { course: { ...COURSE, status: 'archived' }, nameTaken: false }),
    isDomainError('package_course_inactive'),
  )
  assert.throws(
    () => planPackageCreate(body, { course: COURSE, nameTaken: true }),
    isDomainError('package_name_exists', 'conflict'),
  )
  assert.equal(packageNameKey('  İLERİ Paket '), packageNameKey('ileri paket'))
})

test('DOM-DIL-006: düzeltme kur ücretinde saati ve kura bağlı pakette seviyeyi değiştiremez', () => {
  assert.deepEqual(
    planPackageUpdate(HOURS_PACKAGE, { lessonHours: 60, validityDays: null }, { nameTaken: false }),
    { lessonHours: 60, validityDays: null },
  )
  assert.throws(
    () => planPackageUpdate(COURSE_PACKAGE, { lessonHours: 60 }, { nameTaken: false }),
    isDomainError('package_hours_from_course'),
  )
  assert.throws(
    () => planPackageUpdate(COURSE_PACKAGE, { level: 'A1' }, { nameTaken: false }),
    isDomainError('package_level_from_course'),
  )
  assert.throws(
    () => planPackageUpdate(HOURS_PACKAGE, { name: 'Dolu ad' }, { nameTaken: true }),
    isDomainError('package_name_exists', 'conflict'),
  )
  assert.throws(() => planPackageUpdate(HOURS_PACKAGE, {}, { nameTaken: false }), isZodError)
})

test('DOM-DIL-050: fiyat saat × tarife saat ücreti − ilanlı indirim; ek kalem ayrıdır', () => {
  const price = quotePackageSale(
    seed(),
    { ...QUOTE, discounts: ['early_payment'], extras: ['stationery'] },
    NOW,
    CONTEXT,
  )
  assert.equal(price.purchasedHours, 40)
  assert.equal(price.announcedHourlyCents, HOURLY)
  assert.equal(price.hourlyCents, HOURLY)
  assert.equal(price.grossCents, 2_000_000)
  assert.equal(price.discountCents, 200_000)
  assert.equal(price.netCents, 1_800_000)
  assert.deepEqual(price.extras, [{ kind: 'stationery', amountCents: 75_000 }])
  assert.deepEqual(price.installments, [450_000, 450_000, 450_000, 450_000])
})

test('DOM-DIL-006: kur ücretinde saat ve seviye kurdan gelir, tarife düzeyi kurun seviyesidir', () => {
  const price = quotePackageSale(seed(), QUOTE, NOW, {
    ...CONTEXT,
    package: COURSE_PACKAGE,
    course: COURSE,
  })
  assert.equal(price.purchasedHours, 96)
  assert.equal(price.level, 'B1')
  assert.equal(price.hourlyCents, 60_000)
  assert.equal(price.grossCents, 5_760_000)
  assert.equal(price.expiresDate, null)
})

test('DOM-DIL-006: kuru etkin olmayan paket satılmaz', () => {
  for (const course of [{ ...COURSE, status: 'draft' as const }, null])
    assert.throws(
      () => quotePackageSale(seed(), QUOTE, NOW, { ...CONTEXT, package: COURSE_PACKAGE, course }),
      isDomainError('package_course_inactive'),
    )
})

test('DOM-DIL-050: ilan üstü saat ücreti reddedilir, ilan altı girilebilir', () => {
  const at = (hourlyCents: number) => ({
    ...CONTEXT,
    package: { ...HOURS_PACKAGE, hourlyCents },
  })
  assert.throws(
    () => quotePackageSale(seed(), QUOTE, NOW, at(HOURLY + 1)),
    isDomainError('package_above_tariff'),
  )
  const below = quotePackageSale(seed(), QUOTE, NOW, at(40_000))
  assert.equal(below.announcedHourlyCents, HOURLY)
  assert.equal(below.hourlyCents, 40_000)
  assert.equal(below.grossCents, 1_600_000)
  assert.equal(below.netCents, 1_600_000)
})

test('DOM-FIN-021: ilan altı fiyat ve indirim toplamı ilan ücretinin %50sini aşamaz', () => {
  const sibling = { ...QUOTE, studentId: 's2', discounts: ['early_payment'] }
  // %30 ilan altı + %10 indirim: %40, geçer.
  const allowed = quotePackageSale(seed(), sibling, NOW, {
    ...CONTEXT,
    package: { ...HOURS_PACKAGE, hourlyCents: 35_000 },
  })
  assert.equal(allowed.netCents, 1_200_000)
  // %45 ilan altı + %10 indirim: %55, indirim tek başına tavanı aşmasa da reddedilir.
  assert.throws(
    () =>
      quotePackageSale(seed(), sibling, NOW, {
        ...CONTEXT,
        package: { ...HOURS_PACKAGE, hourlyCents: 27_500 },
      }),
    isDomainError('discount_cap_exceeded'),
  )
  // Tek başına ilan altı fiyat da tavana tabidir.
  assert.throws(
    () =>
      quotePackageSale(seed(), QUOTE, NOW, {
        ...CONTEXT,
        package: { ...HOURS_PACKAGE, hourlyCents: 20_000 },
      }),
    isDomainError('discount_cap_exceeded'),
  )
  assert.throws(
    () => quotePackageSale(seed(), { ...QUOTE, discounts: ['corporate'] }, NOW, CONTEXT),
    isDomainError('discount_cap_exceeded'),
  )
})

test('DOM-FIN-024: referans indirimi paket satışında kullanılmaz; hak yalnız sözleşmede işaretlenir', () => {
  assert.throws(
    () => quotePackageSale(seed(), { ...QUOTE, discounts: ['referral'] }, NOW, CONTEXT),
    isDomainError('referral_reward_required'),
  )
})

test('DOM-FIN-021: personel çocuğu istisnasını yalnız yönetici onaylar; net sıfır olamaz', () => {
  const body = { ...QUOTE, discounts: ['staff_child'] }
  assert.throws(
    () => quotePackageSale(seed(), body, NOW, CONTEXT),
    isDomainError('discount_approval_required'),
  )
  const approved = { ...CONTEXT, canApproveCapException: true }
  assert.equal(quotePackageSale(seed(), body, NOW, approved).netCents, 800_000)
  assert.throws(
    () =>
      quotePackageSale(seed(), body, NOW, {
        ...approved,
        package: { ...HOURS_PACKAGE, hourlyCents: 25_000 },
      }),
    isDomainError('discount_exceeds_gross'),
  )
})

test('DOM-FIN-022: kardeş indirimi ilk çocuğa uygulanmaz, ikinci çocukta geçer', () => {
  const state = seed()
  const siblings = state.students.filter((s) => s.parentId === 'p1')
  assert.ok(siblings.length >= 2)
  state.contracts = state.contracts.filter((c) => !siblings.some((s) => s.id === c.studentId))
  state.contracts.push({
    id: 'test-c-pahali',
    studentId: 's1',
    date: NOW,
    amount: 9_000_000,
    title: 'Sözleşme',
    grossCents: 9_000_000,
  } as State['contracts'][number])
  const second = quotePackageSale(
    state,
    { ...QUOTE, studentId: 's2', discounts: ['sibling'] },
    NOW,
    CONTEXT,
  )
  assert.equal(second.discountCents, 600_000)
  const alone = seed()
  alone.students = alone.students.filter((s) => s.id === 's3')
  assert.throws(
    () => quotePackageSale(alone, { ...QUOTE, discounts: ['sibling'] }, NOW, CONTEXT),
    isDomainError('sibling_discount_ineligible'),
  )
})

test('DOM-FIN-022, K-22: paket satışında kardeşin bu yıl kaydı yoksa indirim uygulanmaz', () => {
  const state = seed()
  const siblings = state.students.filter((s) => s.parentId === 'p1')
  state.contracts = state.contracts.filter((c) => !siblings.some((s) => s.id === c.studentId))
  state.contracts.push({
    id: 'test-c-gecen-yil',
    studentId: 's1',
    date: NOW,
    amount: 9_000_000,
    title: 'Sözleşme',
    academicYear: CONTEXT.academicYear - 1,
    grossCents: 9_000_000,
  } as State['contracts'][number])
  const quote = () =>
    quotePackageSale(state, { ...QUOTE, studentId: 's2', discounts: ['sibling'] }, NOW, CONTEXT)
  assert.throws(quote, isDomainError('sibling_discount_ineligible'))
  state.contracts.at(-1)!.academicYear = CONTEXT.academicYear
  assert.equal(quote().discountCents, 600_000)
})

test('DOM-FIN-002, DOM-FIN-003: tarife, düzey ve ek kalem ilanda yoksa satış yok', () => {
  assert.throws(
    () => quotePackageSale(seed(), QUOTE, NOW, { ...CONTEXT, tariff: null }),
    isDomainError('tariff_not_published'),
  )
  assert.throws(
    () =>
      quotePackageSale(seed(), QUOTE, NOW, {
        ...CONTEXT,
        tariff: { ...TARIFF, items: [item({ level: 'C1' })] },
      }),
    isDomainError('tariff_tuition_missing'),
  )
  assert.throws(
    () => quotePackageSale(seed(), { ...QUOTE, extras: ['meal'] }, NOW, CONTEXT),
    isDomainError('extra_not_in_tariff'),
  )
  assert.throws(
    () =>
      quotePackageSale(seed(), { ...QUOTE, extras: ['stationery', 'stationery'] }, NOW, CONTEXT),
    isDomainError('extra_duplicate'),
  )
  assert.throws(
    () =>
      quotePackageSale(seed(), QUOTE, NOW, {
        ...CONTEXT,
        package: { ...HOURS_PACKAGE, lessonHours: null },
      }),
    isDomainError('lesson_hours_required'),
  )
})

test('DOM-YTK-012: paket yalnız dil okulunda; olmayan paket ve öğrenci 404, pasif kursiyer 422', () => {
  for (const institutionType of INSTITUTION_TYPES.filter((item) => item !== 'language_school'))
    assert.throws(
      () => quotePackageSale(seed(), QUOTE, NOW, { ...CONTEXT, institutionType }),
      isDomainError('package_not_available', 'not_found'),
    )
  assert.throws(
    () => quotePackageSale(seed(), QUOTE, NOW, { ...CONTEXT, package: null }),
    isDomainError('package_not_found', 'not_found'),
  )
  assert.throws(
    () => quotePackageSale(seed(), { ...QUOTE, studentId: 'yok' }, NOW, CONTEXT),
    isDomainError('student_not_found', 'not_found'),
  )
  const state = seed()
  const student = state.students.find((s) => s.id === 's3')
  assert.ok(student)
  student.isActive = false
  assert.throws(
    () => quotePackageSale(state, QUOTE, NOW, CONTEXT),
    isDomainError('student_inactive'),
  )
})

test('IST-078, DOM-DIL-051: satış sözleşme ve taksit yazar, son kullanma günü süreden çıkar', () => {
  const state = seed()
  const contractCount = state.contracts.length
  const invoiceCount = state.invoices.length
  const sale = sellPackage(
    state,
    { ...SALE, discounts: ['early_payment'], extras: ['stationery'] },
    makeIds(),
    NOW,
    SELL_CONTEXT,
  )
  assert.equal(state.contracts.length, contractCount + 1)
  assert.equal(state.invoices.length, invoiceCount + 5)
  const contract = state.contracts.at(-1)
  assert.ok(contract)
  assert.equal(contract.id, sale.contractId)
  assert.equal(contract.studentId, 's3')
  assert.equal(contract.grossCents, 2_000_000)
  assert.equal(contract.netCents, 1_800_000)
  assert.equal(contract.amount, 1_875_000)
  assert.equal(contract.tariffVersion, 2)
  assert.equal(contract.payer, 'guardian')
  assert.deepEqual(contract.discounts, [{ kind: 'early_payment', amountCents: 200_000 }])
  const invoices = state.invoices.slice(-5)
  assert.deepEqual(
    invoices.map((row) => [row.installment, row.amount, row.feeKind]),
    [
      [1, 450_000, 'tuition'],
      [2, 450_000, 'tuition'],
      [3, 450_000, 'tuition'],
      [4, 450_000, 'tuition'],
      [5, 75_000, 'stationery'],
    ],
  )
  assert.deepEqual(
    contract.invoiceIds,
    invoices.map((row) => row.id),
  )
  // Ay sonu ayın son gününe çekilir (kesin kayıtla aynı plan).
  assert.equal(invoices[1]?.dueDate, '2026-11-30T09:00:00.000Z')
  assert.equal(sale.purchasedHours, 40)
  assert.equal(sale.hourlyCents, HOURLY)
  assert.equal(sale.expiresDate, '2027-04-04')
  assert.equal(sale.packageName, HOURS_PACKAGE.name)
})

test('DOM-DIL-051: gün Europe/Istanbul gününden sayılır; süresiz pakette son kullanma yok', () => {
  // 21:30 UTC Istanbul'da ertesi gündür.
  const late = quotePackageSale(seed(), QUOTE, '2026-10-06T21:30:00.000Z', {
    ...CONTEXT,
    package: { ...HOURS_PACKAGE, validityDays: 1 },
  })
  assert.equal(late.expiresDate, '2026-10-08')
  const open = quotePackageSale(seed(), QUOTE, NOW, {
    ...CONTEXT,
    package: { ...HOURS_PACKAGE, validityDays: null },
  })
  assert.equal(open.expiresDate, null)
})

test('DOM-KAY-012: yetişkin kursiyerin ödeyicisi kendisidir', () => {
  const state = seed()
  const student = state.students.find((s) => s.id === 's3')
  assert.ok(student)
  const parent = state.parents.find((p) => p.id === student.parentId)
  assert.ok(parent)
  parent.relationship = 'self'
  sellPackage(state, SALE, makeIds(), NOW, SELL_CONTEXT)
  assert.equal(state.contracts.at(-1)?.payer, 'student')
  const orphan = seed()
  const alone = orphan.students.find((s) => s.id === 's3')
  assert.ok(alone)
  alone.parentId = 'olmayan-veli'
  sellPackage(orphan, SALE, makeIds(), NOW, SELL_CONTEXT)
  assert.equal(orphan.contracts.at(-1)?.payer, 'student')
})

test('IST-078: tarife değiştiyse ve doğrulama hatasında sözleşme ve taksit yazılmaz', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => sellPackage(state, { ...SALE, tariffId: 'eski' }, makeIds(), NOW, SELL_CONTEXT),
    isDomainError('tariff_changed', 'conflict'),
  )
  unchangedOnFailure(
    state,
    () => sellPackage(state, { ...SALE, installmentCount: 13 }, makeIds(), NOW, SELL_CONTEXT),
    isZodError,
  )
  unchangedOnFailure(
    state,
    () => sellPackage(state, { ...SALE, extras: ['meal'] }, makeIds(), NOW, SELL_CONTEXT),
    isDomainError('extra_not_in_tariff'),
  )
})

const lesson = (hours: number, sourceId = 'ders-1'): PackageHourEntry => ({
  kind: 'consumed',
  hours,
  sourceType: 'lesson',
  sourceId,
})
const ENTRY = {
  kind: 'consumed',
  hours: 2,
  occurredDate: TODAY,
  sourceType: 'lesson',
  sourceId: 'ders-9',
}
const LIVE = { purchasedHours: 10, expiresDate: '2027-01-01' }

test('DOM-DIL-051: bakiye satın alınan − tüketilen − iade edilendir', () => {
  assert.deepEqual(packageHourBalance(40, []), {
    purchasedHours: 40,
    consumedHours: 0,
    refundedHours: 0,
    remainingHours: 40,
  })
  assert.deepEqual(
    packageHourBalance(40, [lesson(3), lesson(2, 'ders-2'), { ...lesson(5), kind: 'refunded' }]),
    { purchasedHours: 40, consumedHours: 5, refundedHours: 5, remainingHours: 30 },
  )
})

test('DOM-DIL-051, H-19: süre dolunca kalan saat silinmez, durum yalnız expired olur', () => {
  const remaining = packageHourBalance(10, [lesson(4)]).remainingHours
  assert.equal(remaining, 6)
  assert.equal(
    packageSaleStatus({ expiresDate: TODAY, remainingHours: remaining }, TODAY),
    'active',
  )
  assert.equal(
    packageSaleStatus({ expiresDate: '2026-10-05', remainingHours: remaining }, TODAY),
    'expired',
  )
  assert.equal(packageSaleStatus({ expiresDate: null, remainingHours: remaining }, TODAY), 'active')
  assert.equal(
    packageSaleStatus({ expiresDate: '2026-10-05', remainingHours: 0 }, TODAY),
    'depleted',
  )
})

test('IST-078: bakiye sıfırın altına inmez; tam bakiye kadar tüketim geçer', () => {
  assert.equal(planPackageHourEntry(LIVE, [lesson(8)], ENTRY, TODAY)?.hours, 2)
  assert.throws(
    () => planPackageHourEntry(LIVE, [lesson(9)], ENTRY, TODAY),
    isDomainError('package_balance_insufficient'),
  )
  assert.throws(
    () =>
      planPackageHourEntry(
        LIVE,
        [lesson(8), { ...lesson(1, 'iade'), kind: 'refunded' }],
        ENTRY,
        TODAY,
      ),
    isDomainError('package_balance_insufficient'),
  )
})

test('DOM-DIL-051: aynı ders iki kez düşmez; aynı kaynağa farklı saat çakışmadır', () => {
  const existing: PackageHourEntry[] = [{ ...lesson(2, 'ders-9') }]
  assert.equal(planPackageHourEntry(LIVE, existing, ENTRY, TODAY), null)
  assert.throws(
    () => planPackageHourEntry(LIVE, existing, { ...ENTRY, hours: 3 }, TODAY),
    isDomainError('package_hours_source_conflict', 'conflict'),
  )
  assert.throws(
    () => planPackageHourEntry(LIVE, existing, { ...ENTRY, kind: 'refunded' }, TODAY),
    isDomainError('package_hours_source_conflict', 'conflict'),
  )
})

test('DOM-DIL-051: süresi dolan pakete ders yazılmaz, iade yazılır; gelecek gün reddedilir', () => {
  const expired = { purchasedHours: 10, expiresDate: '2026-10-01' }
  assert.throws(
    () => planPackageHourEntry(expired, [], ENTRY, TODAY),
    isDomainError('package_expired'),
  )
  // Süre içindeki dersin yoklaması sonradan işlenebilir.
  assert.equal(
    planPackageHourEntry(expired, [], { ...ENTRY, occurredDate: '2026-10-01' }, TODAY)?.hours,
    2,
  )
  assert.equal(
    planPackageHourEntry(
      expired,
      [],
      { ...ENTRY, kind: 'refunded', sourceType: 'withdrawal', sourceId: 'ayrilis-1' },
      TODAY,
    )?.kind,
    'refunded',
  )
  assert.throws(
    () => planPackageHourEntry(LIVE, [], { ...ENTRY, occurredDate: '2026-10-07' }, TODAY),
    isDomainError('package_hours_date_future'),
  )
  assert.throws(() => planPackageHourEntry(LIVE, [], { ...ENTRY, hours: 0 }, TODAY), isZodError)
})

test('DOM-DIL-051: süre uzatma yeni günü ister; süresiz ve saati biten pakette reddedilir', () => {
  const sale = { expiresDate: '2026-10-01', remainingHours: 4 }
  const body = { expiresDate: '2026-12-01', reason: 'Kursiyerin talebi' }
  assert.equal(planPackageExtension(sale, body, TODAY).expiresDate, '2026-12-01')
  assert.throws(
    () => planPackageExtension({ ...sale, expiresDate: null }, body, TODAY),
    isDomainError('package_no_expiry'),
  )
  assert.throws(
    () => planPackageExtension({ ...sale, remainingHours: 0 }, body, TODAY),
    isDomainError('package_depleted'),
  )
  for (const expiresDate of ['2026-10-01', '2026-09-30', '2026-10-05'])
    assert.throws(
      () => planPackageExtension(sale, { ...body, expiresDate }, TODAY),
      isDomainError('package_extension_not_later'),
    )
  assert.throws(() => planPackageExtension(sale, { ...body, reason: ' ' }, TODAY), isZodError)
  assert.throws(() => planPackageExtension(sale, { expiresDate: '2026-12-01' }, TODAY), isZodError)
})

test('DOM-FIN-013, DOM-DIL-050: paket satışında taksit sayısı ilanlı koşula bağlanır, koşulun fiyat farkı indirim olur', () => {
  const state = seed()
  const context: PackageSaleContext = {
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
        {
          kind: 'installment',
          minInstallments: 2,
          maxInstallments: 4,
          discountPercentBasisPoints: 300,
          discountAmountCents: null,
        },
      ],
    },
  }
  const body = { packageId: PACKAGE_ID, studentId: 's3' }

  const term = quotePackageSale(state, { ...body, installmentCount: 3 }, NOW, context)
  assert.equal(term.paymentTerm?.kind, 'installment')
  assert.equal(term.paymentTerm?.installmentCount, 3)
  assert.deepEqual(term.discounts, [{ kind: 'payment_term', amountCents: 60_000 }])
  assert.equal(term.netCents, term.grossCents - 60_000)

  assert.throws(
    () => quotePackageSale(state, { ...body, installmentCount: 6 }, NOW, context),
    isDomainError('payment_term_not_in_tariff'),
  )
  assert.throws(
    () =>
      quotePackageSale(
        state,
        { ...body, installmentCount: 3, discounts: ['early_payment'] },
        NOW,
        context,
      ),
    isDomainError('early_payment_requires_upfront'),
  )
  const upfront = quotePackageSale(
    state,
    { ...body, installmentCount: 1, discounts: ['early_payment'] },
    NOW,
    context,
  )
  assert.equal(upfront.paymentTerm?.kind, 'upfront')

  sellPackage(
    state,
    { ...body, installmentCount: 3, tariffId: TARIFF.id, firstDueDate: TODAY },
    makeIds(),
    NOW,
    { ...context, approvedByUserId: 'test-user' },
  )
  assert.equal(state.contracts.at(-1)?.paymentTerm?.installmentCount, 3)
})

test('DOM-FIN-013: koşulsuz eski tarifede paket satışı önceki gibi hesaplanır', () => {
  const quote = quotePackageSale(seed(), { ...QUOTE, installmentCount: 12 }, NOW, CONTEXT)
  assert.equal(quote.paymentTerm, null)
  assert.deepEqual(quote.discounts, [])
})
