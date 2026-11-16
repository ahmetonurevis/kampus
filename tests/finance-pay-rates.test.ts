import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isPayRateInEffect,
  latestPayRate,
  payRateCancelSchema,
  payRateEndSchema,
  payRateInputSchema,
  payRateSlot,
  payRateState,
  payRatesOn,
  payRateUnitLabel,
  planPayRate,
  planPayRateCancel,
  planPayRateEnd,
  previousDay,
  severancePaySuggestion,
  wageOn,
  type PayRateChecks,
  type PayRateInput,
} from '../packages/school-core/src/lib/finance-pay-rates.ts'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import { isDomainError } from './support/domain-error.ts'

// Personel ücret tanımı (DOM-FIN-099; ON-194). Kararlar K-304…K-307.

const WAGE: PayRateInput = {
  component: 'wage',
  membershipId: 'm-selin',
  rateType: 'monthly_gross',
  amountCents: 4_500_000,
  startDate: '2026-09-01',
}
const MEAL: PayRateInput = {
  component: 'benefit',
  membershipId: 'm-selin',
  rateType: 'meal',
  benefitForm: 'in_kind',
  taxable: false,
  amountCents: 300_000,
  startDate: '2026-09-01',
}
const checks = (overrides: Partial<PayRateChecks> = {}): PayRateChecks => ({
  staff: { role: 'ogretmen', active: true },
  slotRates: [],
  ...overrides,
})
const plan = (input: PayRateInput, overrides: Partial<PayRateChecks> = {}) =>
  planPayRate(payRateInputSchema.parse(input), checks(overrides))
const rejects = (run: () => unknown, code: string) => assert.throws(run, isDomainError(code))

test('DOM-FIN-099: şema ana ücret, ek ders ve yan hak ister; not kırpılır, bitiş başlangıçtan önce olamaz', () => {
  const wage = payRateInputSchema.parse({ ...WAGE, note: '  ' })
  assert.equal(wage.note, null)
  assert.equal(wage.endDate, null)
  const meal = payRateInputSchema.parse(MEAL)
  assert.equal(meal.component === 'benefit' ? meal.benefitForm : null, 'in_kind')
  const lesson = payRateInputSchema.parse({
    component: 'lesson',
    membershipId: 'm-selin',
    rateType: 'duty',
    amountCents: 25_000,
    startDate: '2026-09-01',
    endDate: '2026-09-01',
  })
  assert.equal(lesson.rateType, 'duty')
  for (const bad of [
    { ...WAGE, rateType: 'extra' },
    { ...WAGE, amountCents: 0 },
    { ...WAGE, amountCents: 10.5 },
    { ...WAGE, amountCents: 1_000_000_001 },
    { ...WAGE, membershipId: ' ' },
    { ...WAGE, startDate: '2026-02-30' },
    { ...WAGE, endDate: '2026-08-31' },
    { ...WAGE, benefitForm: 'cash' },
    { ...MEAL, taxable: undefined },
    { ...MEAL, benefitForm: 'card' },
    { ...WAGE, component: 'bonus' },
    { ...WAGE, note: 'x'.repeat(201) },
  ])
    assert.equal(payRateInputSchema.safeParse(bad).success, false, JSON.stringify(bad))
  const wrongEnd = payRateInputSchema.safeParse({ ...WAGE, endDate: '2026-08-31' })
  assert.deepEqual(wrongEnd.error?.issues[0]?.path, ['endDate'])
  assert.equal(payRateEndSchema.safeParse({ endDate: null }).success, true)
  assert.equal(payRateEndSchema.safeParse({}).success, false)
  assert.equal(payRateCancelSchema.safeParse({ reason: ' kısa ' }).success, false)
  assert.equal(payRateCancelSchema.parse({ reason: ' Yanlış tutar ' }).reason, 'Yanlış tutar')
})

test('DOM-FIN-099: yuva ana ücrette tek, ek ders ve yan hakta tür başına (K-304)', () => {
  assert.equal(payRateSlot('wage', 'monthly_gross'), 'wage')
  assert.equal(payRateSlot('wage', 'hourly'), 'wage')
  assert.equal(payRateSlot('lesson', 'extra'), 'lesson:extra')
  assert.equal(payRateSlot('benefit', 'meal'), 'benefit:meal')
  assert.equal(payRateUnitLabel('wage', 'monthly_net'), 'aylık')
  assert.equal(payRateUnitLabel('wage', 'hourly'), 'saat başı')
  assert.equal(payRateUnitLabel('wage', 'lesson_hour'), 'ders saati başı')
  assert.equal(payRateUnitLabel('lesson', 'duty'), 'saat başı')
  assert.equal(payRateUnitLabel('benefit', 'meal'), 'aylık')
})

test('DOM-FIN-099: ilk tanım kapatma gerektirmez; personel etkin personel olmalı', () => {
  assert.deepEqual(plan(WAGE), { slot: 'wage', close: null })
  rejects(() => plan(WAGE, { staff: null }), 'pay_rate_staff_not_found')
  rejects(() => plan(WAGE, { staff: { role: 'veli', active: true } }), 'pay_rate_not_staff')
  rejects(() => plan(WAGE, { staff: { role: 'ogrenci', active: true } }), 'pay_rate_not_staff')
  rejects(() => plan(WAGE, { staff: { role: 'onburo', active: false } }), 'pay_rate_staff_inactive')
})

test('DOM-FIN-099: yeni tanım öncekinin bitişini bir gün önceye kapatır (K-304)', () => {
  const open = { id: 'r1', startDate: '2026-01-01', endDate: null }
  assert.deepEqual(plan(WAGE, { slotRates: [open] }).close, {
    id: 'r1',
    endDate: '2026-08-31',
    previousEndDate: null,
  })
  // Bitişi yeni başlangıçtan sonraysa da kısalır; eski bitiş iptalde geri yazılmak üzere döner.
  const long = { id: 'r1', startDate: '2026-01-01', endDate: '2026-12-31' }
  assert.deepEqual(plan(WAGE, { slotRates: [long] }).close, {
    id: 'r1',
    endDate: '2026-08-31',
    previousEndDate: '2026-12-31',
  })
  const sameDay = { id: 'r1', startDate: '2026-01-01', endDate: '2026-09-01' }
  assert.equal(plan(WAGE, { slotRates: [sameDay] }).close?.endDate, '2026-08-31')
  // Bitişi yeni başlangıçtan önceyse boşluk kalır, kapatma yok.
  const ended = { id: 'r1', startDate: '2026-01-01', endDate: '2026-06-30' }
  assert.equal(plan(WAGE, { slotRates: [ended] }).close, null)
  // Yalnız son tanım kapanır; önceki kapalı tanımlara dokunulmaz.
  const history = [
    { id: 'r0', startDate: '2025-01-01', endDate: '2025-12-31' },
    { id: 'r1', startDate: '2026-01-01', endDate: null },
  ]
  assert.equal(plan(WAGE, { slotRates: history }).close?.id, 'r1')
  assert.equal(previousDay('2026-03-01'), '2026-02-28')
  assert.equal(previousDay('2028-03-01'), '2028-02-29')
  assert.equal(previousDay('2027-01-01'), '2026-12-31')
})

test('DOM-FIN-099: son tanımdan önce ya da aynı gün başlayan tanım reddedilir (K-304)', () => {
  const open = { id: 'r1', startDate: '2026-09-01', endDate: null }
  rejects(() => plan(WAGE, { slotRates: [open] }), 'pay_rate_start_not_after_latest')
  rejects(
    () => plan({ ...WAGE, startDate: '2026-05-01', endDate: '2026-05-31' }, { slotRates: [open] }),
    'pay_rate_start_not_after_latest',
  )
  assert.throws(
    () => plan(WAGE, { slotRates: [open] }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.path?.[0] === 'startDate' &&
      error.message.includes('1 Eyl 2026'),
  )
})

test('DOM-FIN-099: bitiş yalnız son tanımda değişir, başlangıçtan önce olamaz (K-304)', () => {
  const latest = { startDate: '2026-09-01', endDate: null, isLatest: true }
  assert.doesNotThrow(() => planPayRateEnd(latest, { endDate: '2026-12-31' }))
  assert.doesNotThrow(() => planPayRateEnd(latest, { endDate: '2026-09-01' }))
  assert.doesNotThrow(() => planPayRateEnd({ ...latest, endDate: '2026-12-31' }, { endDate: null }))
  rejects(() => planPayRateEnd(latest, { endDate: '2026-08-31' }), 'pay_rate_end_before_start')
  rejects(() => planPayRateEnd(latest, { endDate: null }), 'pay_rate_end_unchanged')
  rejects(
    () => planPayRateEnd({ ...latest, isLatest: false }, { endDate: '2026-12-31' }),
    'pay_rate_not_latest',
  )
})

test('DOM-FIN-099: iptal yalnız son tanımda; kapattığı tanımın eski bitişini geri yazar (K-304)', () => {
  const latest = { startDate: '2026-09-01', endDate: null, isLatest: true }
  assert.deepEqual(planPayRateCancel(latest, null), { reopen: null })
  assert.deepEqual(planPayRateCancel(latest, { id: 'r0', previousEndDate: null }), {
    reopen: { id: 'r0', endDate: null },
  })
  assert.deepEqual(planPayRateCancel(latest, { id: 'r0', previousEndDate: '2026-12-31' }), {
    reopen: { id: 'r0', endDate: '2026-12-31' },
  })
  rejects(() => planPayRateCancel({ ...latest, isLatest: false }, null), 'pay_rate_not_latest')
})

const RATES = [
  {
    id: 'w0',
    component: 'wage' as const,
    rateType: 'monthly_gross',
    amountCents: 4_000_000,
    startDate: '2026-01-01',
    endDate: '2026-08-31',
  },
  {
    id: 'w1',
    component: 'wage' as const,
    rateType: 'monthly_gross',
    amountCents: 4_500_000,
    startDate: '2026-09-01',
    endDate: null,
  },
  {
    id: 'b1',
    component: 'benefit' as const,
    rateType: 'transport',
    amountCents: 150_000,
    startDate: '2026-03-01',
    endDate: null,
  },
  {
    id: 'b0',
    component: 'benefit' as const,
    rateType: 'meal',
    amountCents: 300_000,
    startDate: '2026-02-01',
    endDate: '2026-06-30',
  },
  {
    id: 'l1',
    component: 'lesson' as const,
    rateType: 'extra',
    amountCents: 25_000,
    startDate: '2026-10-01',
    endDate: null,
  },
]

test('DOM-FIN-099: şu tarihte geçerli ücret: başlangıç ve bitiş dahil, ana ücret önce', () => {
  assert.deepEqual(
    payRatesOn(RATES, '2026-05-15').map((rate) => rate.id),
    ['w0', 'b0', 'b1'],
  )
  assert.deepEqual(
    payRatesOn(RATES, '2026-10-01').map((rate) => rate.id),
    ['w1', 'l1', 'b1'],
  )
  assert.equal(wageOn(RATES, '2026-08-31')?.id, 'w0')
  assert.equal(wageOn(RATES, '2026-09-01')?.id, 'w1')
  assert.equal(wageOn(RATES, '2025-12-31'), null)
  assert.equal(isPayRateInEffect(RATES[0]!, '2026-08-31'), true)
  assert.equal(isPayRateInEffect(RATES[0]!, '2026-09-01'), false)
  assert.equal(latestPayRate(RATES.filter((rate) => rate.component === 'wage'))?.id, 'w1')
  assert.equal(latestPayRate([]), null)
})

test('DOM-FIN-099: durum bugüne göre hesaplanır', () => {
  assert.equal(payRateState({ startDate: '2026-11-01', endDate: null }, '2026-10-06'), 'scheduled')
  assert.equal(payRateState({ startDate: '2026-10-06', endDate: null }, '2026-10-06'), 'active')
  assert.equal(
    payRateState({ startDate: '2026-01-01', endDate: '2026-10-06' }, '2026-10-06'),
    'active',
  )
  assert.equal(
    payRateState({ startDate: '2026-01-01', endDate: '2026-10-05' }, '2026-10-06'),
    'ended',
  )
})

test('DOM-FIN-099: kıdem önerisi aylık brüt ve yürürlükteki yan hakların toplamıdır (DOM-FIN-094)', () => {
  assert.deepEqual(severancePaySuggestion(RATES, '2026-05-15'), {
    grossWageCents: 4_000_000,
    regularBenefitsCents: 450_000,
  })
  assert.deepEqual(severancePaySuggestion(RATES, '2026-10-01'), {
    grossWageCents: 4_500_000,
    regularBenefitsCents: 150_000,
  })
  const net = RATES.map((rate) => (rate.id === 'w1' ? { ...rate, rateType: 'monthly_net' } : rate))
  assert.deepEqual(severancePaySuggestion(net, '2026-10-01'), {
    grossWageCents: null,
    regularBenefitsCents: 150_000,
  })
  assert.deepEqual(severancePaySuggestion([], '2026-10-01'), {
    grossWageCents: null,
    regularBenefitsCents: 0,
  })
})
