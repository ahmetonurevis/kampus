import assert from 'node:assert/strict'
import test from 'node:test'

import {
  defaultPayrollExportProfile,
  PAYROLL_EXPORT_COLUMN_OPTIONS,
  payrollExportCsv,
  payrollExportLines,
  payrollExportProfileSchema,
  payrollItemLabel,
  payrollLessonHoursInputSchema,
  payrollLessonHoursUpdateSchema,
  payrollMonthRange,
  payrollMonthSchema,
  planPayrollLessonHours,
  planPayrollLessonHoursUpdate,
  setPayrollExportProfileSchema,
  type PayrollExportProfile,
  type PayrollLessonHours,
  type PayrollRate,
  type PayrollStaff,
} from '../packages/school-core/src/lib/finance-payroll-exports.ts'

import { isDomainError } from './support/domain-error.ts'

// Bordro programına aktarım (DOM-FIN-105; ON-202). Kararlar K-336…K-339.

const SELIN: PayrollStaff = {
  membershipId: 'm-selin',
  name: 'Selin Kaya',
  role: 'ogretmen',
  active: true,
}
const AHMET: PayrollStaff = {
  membershipId: 'm-ahmet',
  name: 'Ahmet Demir',
  role: 'onburo',
  active: false,
}
const CAN: PayrollStaff = {
  membershipId: 'm-can',
  name: 'Çağrı Uz',
  role: 'yonetici',
  active: true,
}

const rate = (overrides: Partial<PayrollRate>): PayrollRate => ({
  id: 'r-1',
  membershipId: 'm-selin',
  component: 'wage',
  rateType: 'monthly_gross',
  amountCents: 4_500_000,
  benefitForm: null,
  taxable: null,
  startDate: '2026-01-01',
  endDate: null,
  ...overrides,
})
const hours = (overrides: Partial<PayrollLessonHours>): PayrollLessonHours => ({
  id: 'h-1',
  membershipId: 'm-selin',
  lessonType: 'extra',
  hours: 12,
  note: null,
  version: 1,
  ...overrides,
})

test('DOM-FIN-105: ay biçimi ve aralığı (artık yıl dahil)', () => {
  assert.deepEqual(payrollMonthRange('2026-10'), { from: '2026-10-01', to: '2026-10-31', days: 31 })
  assert.deepEqual(payrollMonthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29', days: 29 })
  assert.deepEqual(payrollMonthRange('2026-02').days, 28)
  assert.equal(payrollMonthSchema.safeParse('2026-10').success, true)
  for (const bad of ['2026-13', '2026-1', '2019-12', '2100-01', '2026-10-01', 202610])
    assert.equal(payrollMonthSchema.safeParse(bad).success, false, String(bad))
})

test('DOM-FIN-105: tam ay aylık ücret ve yan hak tutarı, satır alanları (K-336)', () => {
  const result = payrollExportLines({
    month: '2026-10',
    staff: [SELIN],
    rates: [
      rate({}),
      rate({
        id: 'r-meal',
        component: 'benefit',
        rateType: 'meal',
        amountCents: 300_000,
        benefitForm: 'in_kind',
        taxable: false,
      }),
    ],
    lessonHours: [],
  })
  assert.equal(result.from, '2026-10-01')
  assert.equal(result.days, 31)
  const [wage, meal] = result.lines
  assert.equal(wage?.itemCode, 'wage.monthly_gross')
  assert.equal(wage?.unit, 'month')
  assert.equal(wage?.direction, 'earning')
  assert.equal(wage?.totalCents, 4_500_000)
  assert.equal(wage?.startDate, '2026-10-01')
  assert.equal(wage?.endDate, '2026-10-31')
  assert.equal(wage?.days, 31)
  assert.deepEqual(wage?.warnings, [])
  assert.equal(meal?.itemCode, 'benefit.meal')
  assert.equal(meal?.benefitForm, 'in_kind')
  assert.equal(meal?.taxable, false)
  assert.equal(meal?.totalCents, 300_000)
  assert.deepEqual(result.totals, {
    lineCount: 2,
    staffCount: 1,
    earningCents: 4_800_000,
    deductionCents: 0,
    missingTotalCount: 0,
  })
  assert.equal(payrollItemLabel(meal!), 'Yan hak · Yemek')
})

test('DOM-FIN-105: ay içinde değişen ana ücret iki satır, gün bilgisi verilir, tutar orantılanmaz (K-336)', () => {
  const result = payrollExportLines({
    month: '2026-10',
    staff: [SELIN],
    rates: [
      rate({ id: 'r-old', endDate: '2026-10-14' }),
      rate({ id: 'r-new', startDate: '2026-10-15', amountCents: 5_000_000 }),
    ],
    lessonHours: [],
  })
  const [first, second] = result.lines
  assert.equal(first?.key, 'rate:r-old')
  assert.deepEqual(
    [first?.startDate, first?.endDate, first?.days],
    ['2026-10-01', '2026-10-14', 14],
  )
  assert.deepEqual(
    [second?.startDate, second?.endDate, second?.days],
    ['2026-10-15', '2026-10-31', 17],
  )
  for (const line of result.lines) {
    assert.equal(line.totalCents, null)
    assert.equal(line.monthDays, 31)
    assert.deepEqual(line.warnings, ['partial_month'])
  }
  assert.equal(first?.rateCents, 4_500_000)
  assert.equal(result.totals.earningCents, 0)
  assert.equal(result.totals.missingTotalCount, 2)
})

test('DOM-FIN-105: aylık net ve saatlik ana ücret uyarı taşır; saatlikte tutar boş; pasif personel', () => {
  const result = payrollExportLines({
    month: '2026-10',
    staff: [SELIN, AHMET],
    rates: [
      rate({ rateType: 'monthly_net', amountCents: 3_500_000 }),
      rate({ id: 'r-ahmet', membershipId: 'm-ahmet', rateType: 'hourly', amountCents: 25_000 }),
      rate({
        id: 'r-lh',
        membershipId: 'm-ahmet',
        rateType: 'lesson_hour',
        startDate: '2027-01-01',
      }),
    ],
    lessonHours: [],
  })
  // Ada göre sıralı: Ahmet önce; ayla kesişmeyen (ileri tarihli) tanım satır vermez.
  assert.deepEqual(
    result.lines.map((line) => [line.staffName, line.unit, line.totalCents, line.warnings]),
    [
      ['Ahmet Demir', 'hour', null, ['hourly_wage', 'staff_inactive']],
      ['Selin Kaya', 'month', 3_500_000, ['net_wage']],
    ],
  )
  const lessonHour = payrollExportLines({
    month: '2026-10',
    staff: [SELIN],
    rates: [rate({ rateType: 'lesson_hour', amountCents: 40_000 })],
    lessonHours: [],
  })
  assert.equal(lessonHour.lines[0]?.unit, 'lesson_hour')
  assert.equal(lessonHour.lines[0]?.totalCents, null)
})

test('DOM-FIN-105: ek ders saati × birim ücret; tanım yoksa tutar boş; ay içinde değişen ücrette son tanım (K-337)', () => {
  const result = payrollExportLines({
    month: '2026-10',
    staff: [SELIN, CAN],
    rates: [
      rate({
        id: 'l-1',
        component: 'lesson',
        rateType: 'extra',
        amountCents: 30_000,
        endDate: '2026-10-09',
      }),
      rate({
        id: 'l-2',
        component: 'lesson',
        rateType: 'extra',
        amountCents: 35_000,
        startDate: '2026-10-10',
      }),
      // Saat girilmemiş ek ders tanımı satır vermez.
      rate({ id: 'l-duty', component: 'lesson', rateType: 'duty', amountCents: 20_000 }),
      // Başka personelin ek ders tanımı Selin'e karışmaz.
      rate({
        id: 'l-can',
        membershipId: 'm-can',
        component: 'lesson',
        rateType: 'extra',
        amountCents: 99_000,
      }),
    ],
    lessonHours: [
      hours({ id: 'h-selin', hours: 10, note: 'Yedek ders dahil', version: 3 }),
      hours({ id: 'h-can', membershipId: 'm-can', lessonType: 'duty', hours: 4 }),
    ],
  })
  const selin = result.lines.find((line) => line.key === 'hours:h-selin')
  assert.equal(selin?.rateCents, 35_000)
  assert.equal(selin?.quantity, 10)
  assert.equal(selin?.totalCents, 350_000)
  assert.equal(selin?.lessonHoursVersion, 3)
  assert.equal(selin?.note, 'Yedek ders dahil')
  assert.deepEqual(selin?.warnings, ['lesson_rate_changed'])
  assert.equal(selin?.startDate, null)
  assert.equal(selin?.days, null)
  const can = result.lines.find((line) => line.key === 'hours:h-can')
  assert.equal(can?.itemCode, 'lesson.duty')
  assert.equal(can?.rateCents, null)
  assert.equal(can?.totalCents, null)
  assert.deepEqual(can?.warnings, ['lesson_rate_missing'])
  assert.equal(result.lines.length, 2)
  assert.deepEqual(result.totals, {
    lineCount: 2,
    staffCount: 2,
    earningCents: 350_000,
    deductionCents: 0,
    missingTotalCount: 1,
  })
})

test('DOM-FIN-105: satır sırası personel adı (Türkçe), bileşen ve tür; personel eksikse programlama hatası', () => {
  const result = payrollExportLines({
    month: '2026-10',
    staff: [SELIN, CAN],
    rates: [
      rate({
        id: 'b',
        component: 'benefit',
        rateType: 'transport',
        amountCents: 1,
        benefitForm: 'cash',
        taxable: true,
      }),
      rate({ id: 'w' }),
      rate({ id: 'c', membershipId: 'm-can' }),
    ],
    lessonHours: [hours({ id: 'h' })],
  })
  assert.deepEqual(
    result.lines.map((line) => line.key),
    ['rate:c', 'rate:w', 'hours:h', 'rate:b'],
  )
  assert.throws(
    () => payrollExportLines({ month: '2026-10', staff: [], rates: [rate({})], lessonHours: [] }),
    /payroll staff missing/,
  )
})

test('DOM-FIN-105: ek ders saati girişi şeması (K-337)', () => {
  const valid = payrollLessonHoursInputSchema.parse({
    membershipId: ' m-selin ',
    month: '2026-10',
    lessonType: 'duty',
    hours: 8,
    note: '  ',
  })
  assert.deepEqual(valid, {
    membershipId: 'm-selin',
    month: '2026-10',
    lessonType: 'duty',
    hours: 8,
    note: null,
  })
  for (const bad of [
    { hours: 0 },
    { hours: 401 },
    { hours: 1.5 },
    { lessonType: 'lesson_hour' },
    { month: '2026-13' },
    { membershipId: '' },
    { note: 'x'.repeat(201) },
    { institutionId: 'b' },
  ])
    assert.equal(
      payrollLessonHoursInputSchema.safeParse({
        membershipId: 'm-selin',
        month: '2026-10',
        lessonType: 'extra',
        hours: 8,
        ...bad,
      }).success,
      false,
      JSON.stringify(bad),
    )
  assert.equal(payrollLessonHoursUpdateSchema.safeParse({}).success, false)
  assert.deepEqual(payrollLessonHoursUpdateSchema.parse({ note: '' }), { note: null })
  assert.deepEqual(payrollLessonHoursUpdateSchema.parse({ hours: 5 }), { hours: 5 })
})

test('DOM-FIN-105: ek ders saati kuralları: personel, gelecek ay, mükerrer kayıt (K-337)', () => {
  const input = payrollLessonHoursInputSchema.parse({
    membershipId: 'm-selin',
    month: '2026-10',
    lessonType: 'extra',
    hours: 8,
  })
  const ok = { staff: { role: 'ogretmen' }, exists: false, today: '2026-10-06' }
  assert.doesNotThrow(() => planPayrollLessonHours(input, ok))
  assert.throws(
    () => planPayrollLessonHours(input, { ...ok, staff: null }),
    isDomainError('payroll_lesson_hours_staff_not_found'),
  )
  assert.throws(
    () => planPayrollLessonHours(input, { ...ok, staff: { role: 'veli' } }),
    isDomainError('payroll_lesson_hours_not_staff'),
  )
  assert.throws(
    () => planPayrollLessonHours(input, { ...ok, today: '2026-09-30' }),
    isDomainError('payroll_lesson_hours_future_month'),
  )
  assert.throws(
    () => planPayrollLessonHours(input, { ...ok, exists: true }),
    isDomainError('payroll_lesson_hours_exist', 'conflict'),
  )
})

test('DOM-FIN-105: ek ders saati düzeltmesi; değişiklik yoksa 422', () => {
  const current = { hours: 8, note: 'Not' }
  assert.deepEqual(planPayrollLessonHoursUpdate(current, { hours: 9 }), { hours: 9, note: 'Not' })
  assert.deepEqual(planPayrollLessonHoursUpdate(current, { note: null }), { hours: 8, note: null })
  assert.throws(
    () => planPayrollLessonHoursUpdate(current, { hours: 8, note: 'Not' }),
    isDomainError('payroll_lesson_hours_unchanged'),
  )
})

test('DOM-FIN-105: genel CSV: ; ayırıcı, ondalık virgül, boş tutar boş hücre, formül kaçışı (K-336)', () => {
  const result = payrollExportLines({
    month: '2026-10',
    staff: [{ ...SELIN, name: '=HYPERLINK("x")' }],
    rates: [
      rate({}),
      rate({
        id: 'r-meal',
        component: 'benefit',
        rateType: 'meal',
        amountCents: 300_050,
        benefitForm: 'cash',
        taxable: true,
        startDate: '2026-10-10',
      }),
    ],
    lessonHours: [hours({ hours: 3 })],
  })
  const csv = payrollExportCsv(result.lines, null)
  const rows = csv.split('\r\n')
  assert.equal(rows.length, 4)
  assert.equal(
    rows[0],
    PAYROLL_EXPORT_COLUMN_OPTIONS.map((column) => `"${column.label}"`).join(';'),
  )
  assert.equal(
    rows[1],
    `"2026-10";"m-selin";"'=HYPERLINK(""x"")";"Öğretmen";"wage.monthly_gross";"Ana ücret · Aylık brüt";"Kazanç";"Aylık";45000,00;;45000,00;"";"";"2026-10-01";"2026-10-31";31;31;""`,
  )
  assert.equal(
    rows[2],
    `"2026-10";"m-selin";"'=HYPERLINK(""x"")";"Öğretmen";"lesson.extra";"Ek ders ücreti · Ek ders";"Kazanç";"Saat";;3;;"";"";;;;31;"Ek ders ücreti tanımı yok; tutar boş"`,
  )
  assert.ok(rows[3]?.includes(';3000,50;;;"Evet";"Nakdi";"2026-10-10";"2026-10-31";22;31;'))
})

test('DOM-FIN-105: sütun eşleme şablonu: ad, sıra, sabit sütun, TR tarih ve nokta ondalık (K-339)', () => {
  const profile: PayrollExportProfile = payrollExportProfileSchema.parse({
    separator: '\t',
    dateFormat: 'tr',
    decimal: '.',
    columns: [
      { source: 'fixed', header: 'Şube', value: 'MERKEZ' },
      { source: 'staffNumber', header: 'Sicil' },
      { source: 'itemCode', header: 'Kod' },
      { source: 'total', header: 'Tutar' },
      { source: 'startDate', header: 'Giriş' },
      { source: 'quantity', header: 'Saat' },
    ],
  })
  const result = payrollExportLines({
    month: '2026-10',
    staff: [SELIN],
    rates: [rate({ amountCents: 4_500_005 })],
    lessonHours: [],
  })
  assert.equal(
    payrollExportCsv(result.lines, profile),
    `"Şube"\t"Sicil"\t"Kod"\t"Tutar"\t"Giriş"\t"Saat"\r\n"MERKEZ"\t"m-selin"\t"wage.monthly_gross"\t45000.05\t"01.10.2026"\t`,
  )
  // Profil yoksa ve satır yoksa yalnız başlık.
  assert.equal(payrollExportCsv([], defaultPayrollExportProfile()).split('\r\n').length, 1)
})

test('DOM-FIN-105: şablon doğrulaması: bilinmeyen sütun, boş sabit, yinelenen başlık, ayırıcı = ondalık', () => {
  const base = { separator: ';', dateFormat: 'iso', decimal: ',' }
  const issues = (body: unknown) => {
    const parsed = payrollExportProfileSchema.safeParse(body)
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)
  }
  assert.deepEqual(issues({ ...base, columns: [{ source: 'iban', header: 'IBAN' }] }), [
    'Bu sütun dosyada bulunmuyor.',
  ])
  assert.deepEqual(issues({ ...base, columns: [{ source: 'fixed', header: 'Kod' }] }), [
    'Sabit değeri girin.',
  ])
  assert.deepEqual(
    issues({
      ...base,
      columns: [
        { source: 'staffName', header: 'Ad' },
        { source: 'role', header: 'ad' },
      ],
    }),
    ['Aynı başlık iki kez kullanılamaz.'],
  )
  assert.deepEqual(issues({ ...base, columns: [] }), ['En az bir sütun seçin.'])
  assert.deepEqual(
    issues({ ...base, separator: ',', columns: [{ source: 'total', header: 'T' }] }),
    ['Ondalık işareti ayırıcıyla aynı olamaz.'],
  )
  assert.equal(setPayrollExportProfileSchema.safeParse({ profile: null }).success, true)
  assert.equal(
    setPayrollExportProfileSchema.safeParse({ profile: defaultPayrollExportProfile() }).success,
    true,
  )
})
