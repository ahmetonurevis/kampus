import assert from 'node:assert/strict'
import test from 'node:test'

import type { PayrollLine } from '@kampus/react-shared/use-finance-payroll-exports.ts'

import {
  isPayrollMonth,
  lessonHoursBody,
  lessonHoursDefaults,
  lessonHoursEditSchema,
  lessonHoursFormField,
  lessonHoursFormSchema,
  payrollFileName,
  payrollPeriodText,
  payrollRow,
} from '../src/pages/finance/finance-payroll-export-forms.ts'

// Bordro aktarımı ekranı (DOM-FIN-105; ON-202).

const line = (overrides: Partial<PayrollLine> = {}): PayrollLine => ({
  key: 'rate:r1',
  kind: 'rate',
  month: '2026-10',
  membershipId: 'm1',
  staffName: 'Selin Kaya',
  role: 'ogretmen',
  staffActive: true,
  component: 'wage',
  rateType: 'monthly_gross',
  itemCode: 'wage.monthly_gross',
  direction: 'earning',
  unit: 'month',
  rateCents: 4_500_000,
  quantity: null,
  totalCents: null,
  taxable: null,
  benefitForm: null,
  startDate: '2026-10-01',
  endDate: '2026-10-14',
  days: 14,
  monthDays: 31,
  lessonHoursId: null,
  lessonHoursVersion: null,
  note: null,
  deductionKind: null,
  deductionOrder: null,
  rateBasisPoints: null,
  deductionBase: null,
  capCents: null,
  installmentNo: null,
  installmentCount: null,
  adjustmentItem: null,
  sourceMonth: null,
  warnings: ['partial_month'],
  ...overrides,
})

test('DOM-FIN-105: ay seçimi ve dosya adı', () => {
  assert.equal(isPayrollMonth('2026-10'), true)
  assert.equal(isPayrollMonth(''), false)
  assert.equal(isPayrollMonth('2019-12'), false)
  assert.equal(payrollFileName('2026-10'), 'bordro-girdi-2026-10.csv')
})

test('DOM-FIN-105: önizleme satırı: kısmi ay tutarı bordroda, dönem gün bilgisiyle (K-336)', () => {
  const row = payrollRow(line())
  assert.equal(row.item, 'Ana ücret · Aylık brüt')
  assert.equal(row.period, '01.10–14.10 · 14/31 gün')
  assert.equal(row.total, 'Bordroda hesaplanır')
  assert.equal(row.quantity, '—')
  assert.match(row.rate, /45\.000,00 ₺/)
  assert.match(row.warnings, /gün oranıyla/)
  assert.equal(row.lessonHoursId, null)
})

test('DOM-FIN-105: ek ders satırı saat ve tutarla; pasif personel işaretli (K-337)', () => {
  const lesson = line({
    key: 'hours:h1',
    staffActive: false,
    component: 'lesson',
    rateType: 'extra',
    unit: 'hour',
    rateCents: null,
    quantity: 12,
    totalCents: null,
    startDate: null,
    endDate: null,
    days: null,
    lessonHoursId: 'h1',
    lessonHoursVersion: 2,
    warnings: ['lesson_rate_missing', 'staff_inactive'],
  })
  const row = payrollRow(lesson)
  assert.equal(row.staff, 'Selin Kaya (pasif)')
  assert.equal(row.period, 'Ay toplamı')
  assert.equal(payrollPeriodText(lesson), 'Ay toplamı')
  assert.equal(row.rate, '—')
  assert.equal(row.quantity, '12 saat')
  assert.equal(row.lessonHoursId, 'h1')
  assert.match(payrollRow({ ...lesson, totalCents: 420_000 }).total, /4\.200,00 ₺/)
})

test('DOM-FIN-105: ek ders saati formu ve gövdesi', () => {
  const values = { ...lessonHoursDefaults(), membershipId: 'm1', hours: ' 12 ', note: '  ' }
  assert.equal(lessonHoursFormSchema.safeParse(values).success, true)
  assert.deepEqual(lessonHoursBody('2026-10', values), {
    membershipId: 'm1',
    month: '2026-10',
    lessonType: 'extra',
    hours: 12,
    note: null,
  })
  for (const hours of ['', '0', '401', '1,5', 'on'])
    assert.equal(lessonHoursFormSchema.safeParse({ ...values, hours }).success, false, hours)
  assert.equal(lessonHoursFormSchema.safeParse({ ...values, membershipId: '' }).success, false)
  assert.equal(
    lessonHoursEditSchema.safeParse({ hours: '3', note: 'x'.repeat(201) }).success,
    false,
  )
  assert.equal(lessonHoursFormField('hours'), 'hours')
  assert.equal(lessonHoursFormField('month'), undefined)
})

test('DOM-FIN-105: kesinti satırı: avans taksiti eksi tutarla, icra oran, matrah ve üst sınırla (DOM-FIN-101, K-392)', () => {
  const deduction = {
    kind: 'deduction' as const,
    component: null,
    rateType: null,
    direction: 'deduction' as const,
    rateCents: null,
    startDate: null,
    endDate: null,
    days: null,
    warnings: [],
  }
  const advance = payrollRow(
    line({
      ...deduction,
      key: 'deduction:advance:a1',
      itemCode: 'deduction.advance',
      totalCents: 333_333,
      deductionKind: 'advance',
      deductionOrder: 1,
      installmentNo: 2,
      installmentCount: 3,
    }),
  )
  assert.equal(advance.item, 'Kesinti · Avans taksiti (2/3)')
  assert.equal(advance.direction, 'Kesinti')
  assert.equal(advance.period, 'Taksit 2/3')
  assert.equal(advance.rate, '—')
  assert.match(advance.total, /^-3\.333,33 ₺$/)
  const garnishment = payrollRow(
    line({
      ...deduction,
      key: 'deduction:garnishment:g1',
      itemCode: 'deduction.garnishment',
      totalCents: null,
      deductionKind: 'garnishment',
      deductionOrder: 2,
      rateBasisPoints: 2500,
      deductionBase: 'net_wage',
      capCents: 5_000_000,
      warnings: ['deduction_on_net'],
    }),
  )
  assert.equal(garnishment.item, 'Kesinti · İcra kesintisi')
  assert.equal(garnishment.period, 'Ay toplamı')
  assert.match(garnishment.rate, /^%25 · Net ücret · en çok 50\.000,00 ₺$/)
  assert.equal(garnishment.total, 'Bordroda hesaplanır')
  assert.match(garnishment.warnings, /kalan alacak üst sınırdır/)
})

test('DOM-FIN-105: düzeltme satırı: ait olduğu ay, yön işaretiyle tutar (DOM-FIN-108, K-393)', () => {
  const adjustment = (direction: 'earning' | 'deduction') =>
    payrollRow(
      line({
        key: 'adjustment:j1',
        kind: 'adjustment',
        component: null,
        rateType: null,
        itemCode: 'adjustment.lesson',
        direction,
        unit: 'once',
        rateCents: null,
        totalCents: 125_000,
        startDate: null,
        endDate: null,
        days: null,
        adjustmentItem: 'lesson',
        sourceMonth: '2026-09',
        warnings: ['prior_month_adjustment'],
      }),
    )
  const extra = adjustment('earning')
  assert.equal(extra.item, 'Düzeltme · Ek ders (Eylül 2026)')
  assert.equal(extra.period, 'Eylül 2026 farkı')
  assert.equal(extra.direction, 'Kazanç')
  assert.equal(extra.unit, 'Tek sefer')
  assert.match(extra.total, /^1\.250,00 ₺$/)
  assert.match(adjustment('deduction').total, /^-1\.250,00 ₺$/)
})
