import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  availableDiscounts,
  availableExtras,
  installmentOptions,
  PACKAGE_SALE_STATUS_VIEW,
  packageBody,
  packageDefaults,
  packageFormSchema,
  packageRow,
  packageUpdateBody,
  saleFormField,
  saleFormSchema,
  saleQuoteBody,
  type PackageFormValues,
  type SaleTariff,
} from '../src/pages/finance/package-forms.ts'

// IST-078; DOM-DIL-050, -051; DOM-FIN-013: paket formlarının saf mantığı.

const HOURS: PackageFormValues = {
  kind: 'hours',
  name: '40 saatlik paket',
  courseId: '',
  level: '',
  lessonHours: '40',
  hourlyAmount: '',
  validityDays: '180',
}
const COURSE_ID = '22222222-2222-4222-8222-222222222222'
const issuesOf = (values: PackageFormValues) => {
  const result = packageFormSchema.safeParse(values)
  return result.success ? [] : result.error.issues.map((issue) => String(issue.path[0]))
}
const TERMS: SaleTariff['paymentTerms'] = [
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
]
const TARIFF: SaleTariff = {
  id: 't1',
  items: [
    { kind: 'tuition', level: null, amountCents: 50_000 },
    { kind: 'tuition', level: 'B1', amountCents: 60_000 },
    { kind: 'stationery', level: null, amountCents: 75_000 },
  ],
  discounts: [{ kind: 'early_payment' }, { kind: 'sibling' }, { kind: 'staff_child' }],
  paymentTerms: TERMS,
}

test('DOM-DIL-050: paket tanımı gövdesi tutarı kuruşa çevirir, boş alanı null gönderir', () => {
  assert.deepEqual(packageBody({ ...HOURS, hourlyAmount: '450,50', validityDays: '' }), {
    kind: 'hours',
    name: '40 saatlik paket',
    courseId: null,
    level: null,
    lessonHours: 40,
    hourlyCents: 45_050,
    validityDays: null,
  })
})

test('DOM-DIL-006: kur ücreti paketinde saat, kura bağlı pakette seviye gönderilmez', () => {
  const body = packageBody({
    ...HOURS,
    kind: 'course',
    courseId: COURSE_ID,
    level: 'B1',
    lessonHours: '40',
  })
  assert.equal(body.lessonHours, null)
  assert.equal(body.level, null)
})

test('DOM-DIL-050: tanım formu core kuralıyla alan hatası verir', () => {
  assert.deepEqual(issuesOf(HOURS), [])
  assert.deepEqual(issuesOf({ ...HOURS, lessonHours: '' }), ['lessonHours'])
  assert.deepEqual(issuesOf({ ...HOURS, lessonHours: 'kırk' }), ['lessonHours'])
  assert.deepEqual(issuesOf({ ...HOURS, kind: 'course', lessonHours: '' }), ['courseId'])
  assert.deepEqual(issuesOf({ ...HOURS, name: 'A' }), ['name'])
  assert.deepEqual(issuesOf({ ...HOURS, hourlyAmount: 'ucuz' }), ['hourlyAmount'])
  assert.deepEqual(issuesOf({ ...HOURS, validityDays: '0' }), ['validityDays'])
})

test('DOM-DIL-050: düzeltme tür ve kur bağını göndermez, kur ücretinde saat ve seviye yazmaz', () => {
  assert.deepEqual(packageUpdateBody({ ...HOURS, level: 'A1' }), {
    name: '40 saatlik paket',
    hourlyCents: null,
    validityDays: 180,
    level: 'A1',
    lessonHours: 40,
  })
  assert.deepEqual(
    packageUpdateBody({ ...HOURS, kind: 'course', courseId: COURSE_ID, lessonHours: '' }),
    { name: '40 saatlik paket', hourlyCents: null, validityDays: 180 },
  )
})

test('DOM-DIL-050: form varsayılanı ve satır etiketleri paketten türer', () => {
  const pkg = {
    id: 'p1',
    kind: 'private' as const,
    name: 'Özel ders',
    courseId: COURSE_ID,
    level: null,
    lessonHours: 10,
    hourlyCents: 45_050,
    validityDays: null,
    version: 2,
  }
  assert.equal(packageDefaults(pkg).hourlyAmount, '450,50')
  assert.equal(packageDefaults().kind, 'hours')
  const row = packageRow(pkg, new Map([[COURSE_ID, 'Genel İngilizce']]))
  assert.equal(row.kindLabel, 'Özel ders paketi')
  assert.equal(row.courseName, 'Genel İngilizce')
  assert.equal(row.hoursLabel, '10 saat')
  assert.equal(row.validityLabel, 'Süresiz')
  assert.equal(
    packageRow({ ...pkg, courseId: null, hourlyCents: null }, new Map()).hourlyLabel,
    'Tarifeden',
  )
})

test('DOM-DIL-051, H-19: süresi dolan satış saat silinmiş gibi gösterilmez', () => {
  assert.equal(PACKAGE_SALE_STATUS_VIEW.expired.label, 'Süresi doldu')
  assert.equal(PACKAGE_SALE_STATUS_VIEW.depleted.label, 'Saati bitti')
})

test('DOM-FIN-013: taksit seçenekleri ilanlı koşullardan, koşulsuz eski tarifede bütün aralık', () => {
  assert.deepEqual(
    installmentOptions(TERMS).map((option) => option.value),
    ['1', '2', '3', '4'],
  )
  assert.equal(installmentOptions(TERMS)[0]?.label, 'Peşin · tek ödeme')
  assert.equal(installmentOptions(TERMS)[2]?.label, 'Süreli · 3 taksit · %3 indirim')
  assert.equal(installmentOptions(undefined).length, 12)
})

test('DOM-FIN-013, DOM-FIN-021: peşin indirimi yalnız peşin koşulunda, personel çocuğu yalnız yöneticide', () => {
  const kinds = (count: number, manager: boolean) =>
    availableDiscounts(TARIFF, count, manager).map((option) => option.value)
  assert.deepEqual(kinds(1, true), ['early_payment', 'sibling', 'staff_child'])
  assert.deepEqual(kinds(3, true), ['sibling', 'staff_child'])
  assert.deepEqual(kinds(1, false), ['early_payment', 'sibling'])
  assert.deepEqual(
    availableDiscounts({ ...TARIFF, paymentTerms: [] }, 8, false).map((option) => option.value),
    ['early_payment', 'sibling'],
  )
})

test('DOM-FIN-024: referans indirimi paket satış formunda sunulmaz', () => {
  const tariff = {
    ...TARIFF,
    discounts: [...TARIFF.discounts, { kind: 'referral' as const }],
  }
  assert.ok(!availableDiscounts(tariff, 1, true).some((option) => option.value === 'referral'))
})

test('DOM-FIN-003: ek kalem seçenekleri öğrenim dışı türlerdir ve tekildir', () => {
  assert.deepEqual(
    availableExtras(TARIFF).map((option) => option.value),
    ['stationery'],
  )
})

test('K-07, K-19: satış gövdesi kanal ve burs taşımaz; kalkan indirim gönderilmez', () => {
  const body = saleQuoteBody(
    {
      studentId: 's3',
      packageId: 'p1',
      installmentCount: '3',
      firstDueDate: '2026-10-31',
      discounts: ['early_payment', 'sibling'],
      extras: ['stationery'],
    },
    ['sibling'],
  )
  assert.deepEqual(body, {
    packageId: 'p1',
    studentId: 's3',
    installmentCount: 3,
    discounts: ['sibling'],
    extras: ['stationery'],
  })
})

test('IST-078: satış formu öğrenci ve paket ister, sunucu alanını eşler', () => {
  const result = saleFormSchema.safeParse({
    studentId: '',
    packageId: '',
    installmentCount: '4',
    firstDueDate: '2026-10-31',
    discounts: [],
    extras: [],
  })
  assert.equal(result.success, false)
  assert.deepEqual(
    result.error?.issues.map((issue) => issue.message),
    ['Kursiyer seçin.', 'Paket seçin.'],
  )
  assert.equal(saleFormField('installmentCount'), 'installmentCount')
  assert.equal(saleFormField('discounts'), null)
})
