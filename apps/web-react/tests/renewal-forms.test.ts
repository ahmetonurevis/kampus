import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  INSTITUTION_TYPES,
  MODULE_KEYS,
  moduleAvailableFor,
  type InstitutionType,
} from '@kampus/school-core/modules/collection-modules.ts'
import { visiblePages } from '../src/lib/navigation.ts'
import {
  ceilingLines,
  parseRateInput,
  priceIndexBody,
  priceIndexDefaults,
  priceIndexFormSchema,
  quoteLines,
  renewalDefaults,
  renewalFieldFor,
  renewalFormSchema,
  renewalPlanBody,
  renewalQuoteBody,
  studentOptions,
  targetClassOptions,
} from '../src/pages/finance/renewal-forms.ts'

/** API `/me` etkin modül haritası gibi: türde açılabilen her modül açık, diğerleri kapalı. */
const modulesOf = (type: InstitutionType) =>
  Object.fromEntries(MODULE_KEYS.map((key) => [key, moduleAvailableFor(key, type)]))

test('DOM-YTK-012, ADR 0008: kayıt yenileme ekranı yalnız okulda görünür; dil okulu ve kursta menüde yok', () => {
  const roles = ['yonetici', 'onburo', 'veli'] as const
  const paths = (type: InstitutionType, role: (typeof roles)[number]) =>
    visiblePages(role, modulesOf(type), type).map((page) => page.path)
  for (const role of roles) assert.ok(paths('school', role).includes('kayit-yenileme'), role)
  const withoutRenewal = INSTITUTION_TYPES.filter((type) => !moduleAvailableFor('renewal', type))
  assert.ok(withoutRenewal.includes('language_school'))
  for (const type of withoutRenewal)
    for (const role of roles)
      assert.equal(paths(type, role).includes('kayit-yenileme'), false, `${type} ${role}`)
})

const VALUES = {
  ...renewalDefaults(),
  studentId: 's3',
  targetClassId: 'c1',
  installmentCount: '6',
  firstDueDate: '2026-11-15',
}

test('IST-100: yenileme formu yeni sınıf, taksit ve vade ister; ücret boş ya da 1.234,56 biçiminde', () => {
  assert.equal(renewalFormSchema.safeParse(VALUES).success, true)
  const issues = (values: object) =>
    (renewalFormSchema.safeParse(values).error?.issues ?? []).map((issue) => issue.path[0])
  assert.deepEqual(issues({ ...VALUES, targetClassId: '' }), ['targetClassId'])
  assert.deepEqual(issues({ ...VALUES, installmentCount: '13' }), ['installmentCount'])
  assert.deepEqual(issues({ ...VALUES, firstDueDate: '' }), ['firstDueDate'])
  assert.deepEqual(issues({ ...VALUES, tuition: '12,345' }), ['tuition'])
  assert.deepEqual(issues({ ...VALUES, tuition: '28.000,50' }), [])
  // Mezuniyet sınıf, ücret ve taksit istemez.
  assert.deepEqual(
    issues({ ...renewalDefaults(), studentId: 's3', mode: 'graduate', installmentCount: '' }),
    [],
  )
})

test('DOM-FIN-002, -020, -025: gövde kuruşa çevrilir; boş ücret ve burs gönderilmez', () => {
  assert.deepEqual(renewalQuoteBody(VALUES, 2027), {
    studentId: 's3',
    targetClassId: 'c1',
    academicYear: 2027,
    installmentCount: 6,
    discounts: [],
    extras: [],
  })
  assert.deepEqual(
    renewalQuoteBody(
      {
        ...VALUES,
        tuition: '28.000',
        discounts: ['early_payment'],
        extras: ['meal'],
        scholarshipProgramId: 'p-1',
      },
      2027,
    ),
    {
      studentId: 's3',
      targetClassId: 'c1',
      academicYear: 2027,
      installmentCount: 6,
      discounts: ['early_payment'],
      extras: ['meal'],
      tuitionCents: 2_800_000,
      scholarshipProgramId: 'p-1',
    },
  )
  assert.deepEqual(renewalPlanBody(VALUES, 2027, 't-1'), {
    ...renewalQuoteBody(VALUES, 2027),
    mode: 'renew',
    tariffId: 't-1',
    firstDueDate: '2026-11-15',
  })
  assert.deepEqual(renewalPlanBody({ ...VALUES, mode: 'graduate' }, 2027, null), {
    mode: 'graduate',
    studentId: 's3',
    academicYear: 2027,
  })
})

test('DOM-KAY-021: yeni sınıf bir üst düzeyin etkin sınıflarıdır; öğrenci seçeneği sınıf adı taşır', () => {
  const classes = [
    { id: 'c3', name: '6-A', grade: 6, branchId: 'b1' },
    { id: 'c1', name: '7-A', grade: 7, branchId: 'b1' },
    { id: 'c2', name: '7-B', grade: 7, branchId: 'b2', isActive: false },
    { id: 'c4', name: '8-A', grade: 8, branchId: 'b1' },
  ]
  const branches = new Map([['b1', 'Kadıköy Kampüsü']])
  assert.deepEqual(targetClassOptions(classes, branches, 'c3'), [
    { value: 'c1', label: '7-A · Kadıköy Kampüsü' },
  ])
  assert.deepEqual(targetClassOptions(classes, branches, undefined), [])
  assert.deepEqual(
    studentOptions(
      [
        { id: 's3', name: 'Zeynep Demir', classId: 'c3' },
        { id: 's9', name: 'Ali Ak', classId: 'c3', isActive: false },
      ],
      new Map([['c3', '6-A']]),
    ),
    [{ value: 's3', label: 'Zeynep Demir · 6-A' }],
  )
})

test('DOM-FIN-005, -023: tavan özeti bazı, oranları ve indirim kaybının gerekçesini yazar', () => {
  assert.match(ceilingLines({ status: 'entry_grade' })[0] ?? '', /başlangıç sınıfı/)
  assert.match(ceilingLines({ status: 'no_base' })[0] ?? '', /hesaplanamadı/)
  const lines = ceilingLines({
    status: 'applied',
    baseCents: 2_000_000,
    baseSource: 'enrollment_contract',
    baseYear: 2025,
    rates: [{ academicYear: 2027, ppiBasisPoints: 4_250, cpiBasisPoints: 3_000 }],
    extraBasisPoints: 500,
    ceilingCents: 2_800_000,
    discountLoss: { kinds: ['sibling'], reason: 'Kardeş indirimi koşulu kalktı.' },
  })
  assert.match(lines[0] ?? '', /Artış tavanı: 28\.000,00 ₺ \(baz 20\.000,00 ₺, kayıt yılındaki/)
  assert.match(lines[1] ?? '', /2027: ÜFE %42,5, TÜFE %30 · ek %5/)
  assert.equal(lines[2], 'Kardeş indirimi koşulu kalktı.')
})

test('ödeme özeti net tutarı ve taksiti verir; tam bursta taksit açılmaz', () => {
  const base = {
    tariffCarriedOverFromYear: null,
    announcedCents: 3_000_000,
    ceiling: { status: 'no_base' as const },
    tuitionCents: 3_000_000,
    discounts: [{ kind: 'early_payment', amountCents: 300_000 }],
    discountCents: 300_000,
    scholarship: { amountCents: 200_000 },
    netCents: 2_500_000,
    extras: [{ kind: 'meal', amountCents: 500_000 }],
    installments: [1_250_000, 1_250_000],
    outstandingTuitionCents: 0,
  }
  const lines = quoteLines(base)
  assert.equal(lines.net, 'Net eğitim bedeli: 25.000,00 ₺')
  assert.equal(lines.installments, '2 taksit')
  assert.ok(lines.pricing.includes('Peşin ödeme indirimi: −3.000,00 ₺'))
  assert.ok(lines.pricing.includes('Burs: −2.000,00 ₺'))
  assert.deepEqual(lines.extras, ['Yemek: 5.000,00 ₺ (ayrı taksit)'])
  assert.equal(
    quoteLines({ ...base, netCents: 0, installments: [] }).installments,
    'Tam burs: öğrenim taksiti açılmaz',
  )
})

test('DOM-FIN-002, K-11: önceki yılın tarifesi uygulanınca ödeme özeti bunu kaynak yılıyla yazar', () => {
  const base = {
    tariffCarriedOverFromYear: null,
    announcedCents: 3_000_000,
    ceiling: { status: 'no_base' as const },
    tuitionCents: 3_000_000,
    discounts: [],
    discountCents: 0,
    scholarship: null,
    netCents: 3_000_000,
    extras: [],
    installments: [3_000_000],
    outstandingTuitionCents: 0,
  }
  assert.ok(!quoteLines(base).pricing.some((line) => line.includes('tarifesi uygulanır')))
  const [first] = quoteLines({ ...base, tariffCarriedOverFromYear: 2026 }).pricing
  assert.match(first ?? '', /önceki yılın \(2026–2027\) tarifesi uygulanır/)
})

test('DOM-FIN-013: ödeme özeti planın ilanlı koşulunu yazar; koşulsuz eski tarifede satır yok', () => {
  const base = {
    tariffCarriedOverFromYear: null,
    announcedCents: 3_000_000,
    ceiling: { status: 'no_base' as const },
    tuitionCents: 3_000_000,
    discounts: [{ kind: 'payment_term', amountCents: 90_000 }],
    discountCents: 90_000,
    scholarship: null,
    netCents: 2_910_000,
    extras: [],
    installments: [970_000, 970_000, 970_000],
    outstandingTuitionCents: 0,
  }
  const { pricing } = quoteLines({
    ...base,
    paymentTerm: {
      kind: 'installment',
      minInstallments: 2,
      maxInstallments: 4,
      discountPercentBasisPoints: 300,
      discountAmountCents: null,
      installmentCount: 3,
    },
  })
  assert.ok(pricing.includes('Ödeme koşulu: Süreli · 3 taksit · %3 indirim'))
  assert.ok(pricing.includes('Ödeme koşulu indirimi: −900,00 ₺'))
  for (const line of quoteLines({ ...base, paymentTerm: null }).pricing)
    assert.doesNotMatch(line, /^Ödeme koşulu:/)
})

test('sunucu alanları form alanına eşlenir', () => {
  assert.equal(renewalFieldFor('tuitionCents'), 'tuition')
  assert.equal(renewalFieldFor('scholarshipProgramId'), 'scholarshipProgramId')
  assert.equal(renewalFieldFor('academicYear'), null)
})

test('DOM-FIN-005: ÜFE/TÜFE yüzde olarak girilir, on binde birliğe çevrilir', () => {
  assert.equal(parseRateInput('42,5'), 4_250)
  assert.equal(parseRateInput('120'), 12_000)
  assert.equal(parseRateInput('0'), 0)
  assert.equal(parseRateInput('-1'), null)
  assert.equal(parseRateInput('1000,01'), null)
  assert.equal(parseRateInput('4,255'), null)
  const values = {
    ...priceIndexDefaults(2027),
    ppi: '40',
    cpi: '30,25',
    source: 'TÜİK bülteni 53607',
    bulletinDate: '2026-02-03',
  }
  const parsed = priceIndexFormSchema.parse(values)
  assert.deepEqual(priceIndexBody(parsed), {
    academicYear: 2027,
    ppiBasisPoints: 4_000,
    cpiBasisPoints: 3_025,
    source: 'TÜİK bülteni 53607',
    bulletinDate: '2026-02-03',
  })
  assert.equal(priceIndexFormSchema.safeParse({ ...values, ppi: 'x' }).success, false)
  assert.deepEqual(
    priceIndexDefaults(2027, {
      ppiBasisPoints: 4_250,
      cpiBasisPoints: 3_000,
      source: 'TÜİK',
      bulletinDate: '2026-02-03',
    }),
    {
      academicYear: '2027',
      ppi: '42,5',
      cpi: '30',
      source: 'TÜİK',
      bulletinDate: '2026-02-03',
    },
  )
})

test('ON-057, DOM-KAY-025: borç onayı yalnız işaretlenince plan gövdesine girer', () => {
  const approved = renewalPlanBody(VALUES, 2027, 't-1', true)
  assert.equal('debtApproved' in approved && approved.debtApproved, true)
  assert.equal('debtApproved' in renewalPlanBody(VALUES, 2027, 't-1'), false)
  assert.equal('debtApproved' in renewalPlanBody(VALUES, 2027, 't-1', false), false)
})
