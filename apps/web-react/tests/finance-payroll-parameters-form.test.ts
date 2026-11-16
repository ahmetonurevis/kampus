import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PAYROLL_PLATFORM_DEFAULTS,
  payrollParameterSetSchema,
} from '@kampus/school-core/lib/finance-payroll-parameters.ts'
import {
  nextPeriodMonth,
  parseScaledInput,
  payrollBody,
  payrollFormDefaults,
  payrollFormPath,
  payrollFormSchema,
} from '../src/pages/finance/finance-payroll-parameters-form.ts'

// Bordro parametresi formu (DOM-FIN-100; ON-197): metin ↔ gövde dönüşümü ve core kuralları.

const platform = PAYROLL_PLATFORM_DEFAULTS.find((set) => set.effectiveFrom === '2025-07-01')
assert.ok(platform)
const VALUES = payrollParameterSetSchema.parse(
  Object.fromEntries(
    Object.entries(platform).filter(([key]) => key !== 'id' && key !== 'unverifiedFields'),
  ),
)

test('DOM-FIN-100: form varsayılanı setten üretilir, gövdeye geri döner', () => {
  const values = payrollFormDefaults(VALUES)
  assert.equal(values.effectiveMonth, '2025-07')
  assert.equal(values.minimumWageGross, '26.005,50')
  assert.equal(values.sgkEmployer, '20,75')
  assert.equal(values.ceilingMultiplier, '7,5')
  assert.equal(values.stampTax, '7,59')
  assert.equal(values.brackets[1]?.lowerBound, '158.000,00')
  assert.equal(values.brackets[4]?.rate, '40')
  assert.deepEqual(payrollBody(values), VALUES)
  assert.equal(payrollFormDefaults(VALUES, '2026-03').effectiveMonth, '2026-03')
  assert.equal(payrollBody({ ...values, incomeTaxExempt: 'no' }).minimumWageIncomeTaxExempt, false)
})

test('DOM-FIN-100: ölçekli giriş — yüzde, binde ve kat', () => {
  assert.equal(parseScaledInput('20,75', 100, 2), 2075)
  assert.equal(parseScaledInput('14', 100, 2), 1400)
  assert.equal(parseScaledInput('7.5', 10_000, 4), 75_000)
  assert.equal(parseScaledInput('7,123', 100, 2), null)
  assert.equal(parseScaledInput('-1', 100, 2), null)
  assert.equal(parseScaledInput('', 100, 2), null)
})

test('DOM-FIN-100: form şeması biçim ve core kurallarını alan yoluna yazar (K-311)', () => {
  const base = payrollFormDefaults(VALUES)
  const pathsOf = (values: typeof base) =>
    payrollFormSchema
      .safeParse(values)
      .error?.issues.map((issue) => [issue.path.join('.'), issue.message]) ?? []
  assert.deepEqual(pathsOf(base), [])
  assert.deepEqual(pathsOf({ ...base, sgkEmployer: 'yirmi' }), [
    ['sgkEmployer', 'SGK işveren payını yüzde olarak girin (ör. 20,75).'],
  ])
  const swapped = [...base.brackets]
  swapped[2] = { lowerBound: '100.000,00', rate: '27' }
  assert.deepEqual(pathsOf({ ...base, brackets: swapped }), [
    ['brackets.2.lowerBound', 'Dilim alt sınırları artan sırada olmalı; dilimler çakışamaz.'],
  ])
  assert.deepEqual(pathsOf({ ...base, brackets: [] }), [
    ['brackets.root', 'En az bir gelir vergisi dilimi girin.'],
  ])
  assert.deepEqual(pathsOf({ ...base, sgkIncentive: '25' }), [
    ['sgkIncentive', 'İşveren prim indirimi işveren payından büyük olamaz.'],
  ])
  assert.ok(pathsOf({ ...base, source: '' }).some(([path]) => path === 'source'))
})

test('DOM-FIN-100: sunucu yolu form yoluna çevrilir; yeni dönem ayı önerisi', () => {
  assert.equal(payrollFormPath('incomeTaxBrackets.1.rateBasisPoints'), 'brackets.1.rate')
  assert.equal(payrollFormPath('incomeTaxBrackets.1.lowerBoundCents'), 'brackets.1.lowerBound')
  assert.equal(payrollFormPath('incomeTaxBrackets'), 'brackets.root')
  assert.equal(payrollFormPath('incomeTaxBrackets.1'), 'brackets.root')
  assert.equal(payrollFormPath('incomeTaxBrackets.x.rate'), null)
  assert.equal(payrollFormPath('effectiveFrom'), 'effectiveMonth')
  assert.equal(payrollFormPath('effectiveFrom.0'), null)
  assert.equal(payrollFormPath('institutionId'), null)
  assert.equal(nextPeriodMonth(2026, '2026-01-01'), '2026-02')
  assert.equal(nextPeriodMonth(2026, '2026-12-01'), '2026-12')
  assert.equal(nextPeriodMonth(2027, '2027-01-01'), '2027-02')
  assert.equal(nextPeriodMonth(2027, undefined), '2027-01')
  assert.equal(nextPeriodMonth(2027, '2026-07-01'), '2027-01')
})
