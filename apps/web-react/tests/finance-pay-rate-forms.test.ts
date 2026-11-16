import assert from 'node:assert/strict'
import test from 'node:test'

import type { PayRate } from '@kampus/react-shared/use-finance-pay-rates.ts'

import {
  AMOUNT_MASK,
  amountText,
  firstRateType,
  latestRateIds,
  payRateBody,
  payRateDefaults,
  payRateFormField,
  payRateFormSchema,
  periodText,
  rateTitle,
} from '../src/pages/finance/finance-pay-rate-forms.ts'

// Ücret tanımı formu ve gösterimi (DOM-FIN-099; ON-194).

const rate = (overrides: Partial<PayRate> = {}): PayRate => ({
  id: 'r1',
  membershipId: 'm1',
  component: 'wage',
  rateType: 'monthly_gross',
  amountCents: 4_500_000,
  currency: 'TRY',
  benefitForm: null,
  taxable: null,
  startDate: '2026-09-01',
  endDate: null,
  note: null,
  autoClosed: false,
  state: 'active',
  createdAt: '2026-09-01T09:00:00.000Z',
  version: 1,
  ...overrides,
})

test('DOM-FIN-099: form gövdesi bileşene göre yalnız ilgili alanları taşır; tutar kuruşa çevrilir', () => {
  const values = { ...payRateDefaults('2026-10-06'), amount: '45.000,50', note: '  ' }
  assert.deepEqual(payRateBody('m1', values), {
    component: 'wage',
    rateType: 'monthly_gross',
    membershipId: 'm1',
    amountCents: 4_500_050,
    startDate: '2026-10-06',
    endDate: null,
    note: null,
  })
  const benefit = payRateBody('m1', {
    ...values,
    component: 'benefit',
    rateType: 'meal',
    benefitForm: 'in_kind',
    taxable: 'false',
    endDate: '2027-06-30',
  })
  assert.deepEqual(
    [benefit.component, benefit.rateType, 'benefitForm' in benefit && benefit.benefitForm],
    ['benefit', 'meal', 'in_kind'],
  )
  assert.equal('taxable' in benefit && benefit.taxable, false)
  const lesson = payRateBody('m1', { ...values, component: 'lesson', rateType: 'duty' })
  assert.equal('benefitForm' in lesson, false)
  assert.equal(firstRateType('lesson'), 'extra')
  assert.equal(firstRateType('benefit'), 'meal')
})

test('DOM-FIN-099: form şeması tutar biçimini ve core gün/tür kurallarını denetler', () => {
  const schema = payRateFormSchema('m1')
  const ok = { ...payRateDefaults('2026-10-06'), amount: '1.000,00' }
  assert.equal(schema.safeParse(ok).success, true)
  const amount = schema.safeParse({ ...ok, amount: '0' })
  assert.deepEqual(amount.error?.issues[0]?.path, ['amount'])
  const order = schema.safeParse({ ...ok, endDate: '2026-10-05' })
  assert.deepEqual(order.error?.issues[0]?.path, ['endDate'])
  assert.equal(order.error?.issues[0]?.message, 'Bitiş günü başlangıç gününden önce olamaz.')
  const type = schema.safeParse({ ...ok, rateType: 'meal' })
  assert.deepEqual(type.error?.issues[0]?.path, ['rateType'])
  assert.equal(payRateFormField('amountCents'), 'amount')
  assert.equal(payRateFormField('membershipId'), undefined)
})

test('DOM-FIN-099: tutar, birim, yürürlük metni ve maske', () => {
  assert.equal(rateTitle(rate()), 'Ana ücret · Aylık brüt')
  assert.equal(amountText(rate()), '45.000,00 ₺ (aylık)')
  assert.equal(amountText({ ...rate(), amountCents: null }), AMOUNT_MASK)
  assert.equal(
    amountText(rate({ component: 'lesson', rateType: 'extra', amountCents: 30_000 })),
    '300,00 ₺ (saat başı)',
  )
  assert.equal(
    amountText(
      rate({
        component: 'benefit',
        rateType: 'meal',
        amountCents: 300_000,
        benefitForm: 'in_kind',
        taxable: false,
      }),
    ),
    '3.000,00 ₺ (aylık) · Ayni, vergiden istisna',
  )
  assert.equal(periodText(rate()), '1 Eyl 2026 itibarıyla, süresiz')
  assert.equal(periodText(rate({ endDate: '2027-08-31' })), '1 Eyl 2026 – 31 Ağu 2027')
})

test('DOM-FIN-099: bitiş ve iptal yalnız yuvanın son tanımında (K-304)', () => {
  const ids = latestRateIds([
    rate({ id: 'w0', startDate: '2026-01-01', endDate: '2026-08-31' }),
    rate({ id: 'w1', rateType: 'hourly', startDate: '2026-09-01' }),
    rate({ id: 'b0', component: 'benefit', rateType: 'meal', startDate: '2026-01-01' }),
    rate({ id: 'b1', component: 'benefit', rateType: 'transport', startDate: '2025-01-01' }),
  ])
  assert.deepEqual([...ids].sort(), ['b0', 'b1', 'w1'])
})
