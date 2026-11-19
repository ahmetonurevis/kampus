import assert from 'node:assert/strict'
import test from 'node:test'

import {
  payrollCalcRow,
  payrollMonthParameters,
} from '@kampus/school-core/lib/finance-payroll-calc.ts'
import {
  defaultPayrollMonth,
  PAYROLL_CARRYOVER_DEFAULTS,
  payrollCarryoverBody,
  payrollCarryoverField,
  payrollCarryoverFormSchema,
  payrollDetailSections,
  payrollWarningText,
  payrollWarningTone,
  validPayrollMonth,
} from '../src/pages/finance/finance-payroll-calc-forms.ts'

// Bordro hesabı formu ve gösterimi (DOM-FIN-115; ON-198).

test('DOM-FIN-115: varsayılan ay içinde bulunulan ay, geçersiz ay istek atmaz', () => {
  assert.equal(defaultPayrollMonth('2026-11-19'), '2026-11')
  assert.equal(validPayrollMonth('2026-10'), '2026-10')
  assert.equal(validPayrollMonth(''), null)
  assert.equal(validPayrollMonth('2026-13'), null)
  assert.equal(validPayrollMonth('2019-12'), null)
})

test('DOM-FIN-115 K-388: matrah devri formu ve gövdesi', () => {
  const ok = (values: unknown) => payrollCarryoverFormSchema.safeParse(values).success
  assert.equal(ok(PAYROLL_CARRYOVER_DEFAULTS), false)
  assert.equal(ok({ amount: '0', note: '' }), false)
  assert.equal(ok({ amount: 'abc', note: '' }), false)
  assert.equal(ok({ amount: '180.000,50', note: 'x'.repeat(201) }), false)
  assert.equal(ok({ amount: '180.000,50', note: '' }), true)
  assert.deepEqual(
    payrollCarryoverBody('m-1', 2026, { amount: '180.000,50', note: '  Önceki işyeri ' }),
    { membershipId: 'm-1', year: 2026, incomeTaxBaseCents: 18_000_050, note: 'Önceki işyeri' },
  )
  assert.equal(payrollCarryoverBody('m-1', 2026, { amount: '1', note: ' ' }).note, null)
  assert.equal(payrollCarryoverField('incomeTaxBaseCents'), 'amount')
  assert.equal(payrollCarryoverField('note'), 'note')
  assert.equal(payrollCarryoverField('year'), null)
})

test('DOM-FIN-115: uyarı metni ve tonu', () => {
  assert.equal(payrollWarningTone('entry_in_month'), 'purple')
  assert.equal(payrollWarningTone('hourly_wage'), 'amber')
  assert.match(payrollWarningText('above_ceiling'), /tavan/)
})

test('DOM-FIN-115, DOM-FIN-120: onaylanmamış ek ders çizelgesi uyarısı tutarı etkiler (K-423)', () => {
  assert.equal(payrollWarningTone('lesson_hours_unapproved'), 'amber')
  assert.equal(
    payrollWarningText('lesson_hours_unapproved'),
    'Ek ders çizelgesi onaylanmadı; ek ders hesaba girmedi',
  )
})

test('DOM-FIN-115: ayrıntı paneli bölümleri asgari ücretli satırı gösterir', () => {
  const row = payrollCalcRow('2026-01', payrollMonthParameters('2026-01', []), {
    member: { membershipId: 'm-1', name: 'Deniz Yılmaz', role: 'onburo', active: true },
    rates: [
      {
        id: 'w',
        membershipId: 'm-1',
        component: 'wage',
        rateType: 'monthly_gross',
        amountCents: 3_303_000,
        benefitForm: null,
        taxable: null,
        startDate: '2026-01-01',
        endDate: null,
      },
      {
        id: 'b',
        membershipId: 'm-1',
        component: 'benefit',
        rateType: 'service',
        amountCents: 100_000,
        benefitForm: 'in_kind',
        taxable: false,
        startDate: '2026-01-01',
        endDate: null,
      },
    ],
    missing: [],
    dates: null,
    lessonHours: [],
    lessonHoursUnapproved: false,
    adjustments: [{ item: 'deduction', amountCents: -5_000 }],
    cumulativeIncomeTaxBaseBeforeCents: 0,
    unsavedPreviousMonths: [],
    medicalReportDays: 0,
    deductionSources: { advances: [], garnishments: [], pensions: [] },
  })
  const sections = payrollDetailSections(row)
  assert.deepEqual(
    sections.map((section) => section.title),
    ['Brüt kalemleri', 'SGK', 'Vergi', 'Net ve kesintiler', 'İşveren'],
  )
  const flat = Object.fromEntries(sections.flatMap((section) => section.rows))
  assert.equal(flat['Brüt'], '33.030,00 ₺')
  assert.equal(flat['Ödenecek gelir vergisi'], '0,00 ₺')
  assert.equal(flat['Net ücret'], '28.075,50 ₺')
  assert.equal(flat['Net düzeltme'], '-50,00 ₺')
  assert.equal(flat['Ödenecek net'], '28.025,50 ₺')
  assert.equal(flat['Ayni yan haklar'], '1.000,00 ₺')
})
