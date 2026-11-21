import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  assertFinanceDayReportable,
  assertPaymentDayOpen,
  assertReversalDayOpen,
  closeFinanceDaySchema,
  financeDayCashNet,
  financeDayFormSchema,
  financeDayLines,
  financeDayStamp,
  financeDayRefunds,
  financeDaySummary,
  financeDaySupplierPayments,
  FINANCE_DAY_CLOSE_ROLES,
  FINANCE_DAY_REOPEN_ROLES,
  isCashCountRequired,
  parseCashCountInput,
  planFinanceDayClosing,
  planFinanceDayReopen,
  REFUND_PAYMENT_METHOD,
  SUPPLIER_PAYMENT_DAY_METHOD,
  type FinanceDayPayment,
  type FinanceDaySupplierPayment,
} from '../packages/school-core/src/lib/finance-day-closings.ts'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import { parseAmountInput, PAYMENT_METHODS } from '../packages/school-core/src/lib/payments.ts'

/** Kasa ve gün sonu kuralları (IST-113, DOM-FIN-036). Gün Europe/Istanbul günüdür. */

const DAY = '2026-10-06'
const today = { today: DAY, alreadyClosed: false, cashEnabled: true, suggestedOpeningCents: null }

const payment = (overrides: Partial<FinanceDayPayment> = {}): FinanceDayPayment => ({
  amountCents: 10_000,
  method: 'Nakit',
  paidAt: `${DAY}T09:00:00.000Z`,
  reversedAt: null,
  ...overrides,
})

function rejects(work: () => unknown, code: string, kind?: string) {
  assert.throws(work, (error: unknown) => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.code, code)
    if (kind !== undefined) assert.equal(error.kind, kind)
    return true
  })
}

const supplierPayment = (
  overrides: Partial<FinanceDaySupplierPayment> = {},
): FinanceDaySupplierPayment => ({
  amountCents: 8_000,
  paidDate: DAY,
  method: 'cash',
  cancelledAt: null,
  ...overrides,
})

const stampOf = (payments: FinanceDayPayment[]) => financeDayStamp(financeDaySummary(payments, DAY))

test('DOM-FIN-036: özet yöntem bazındadır; hareketi olmayan yöntem de sıfırla görünür', () => {
  const summary = financeDaySummary(
    [
      payment({ amountCents: 15_000 }),
      payment({ amountCents: 5_050 }),
      payment({ method: 'Kredi kartı', amountCents: 20_000 }),
      payment({ method: 'Banka havalesi', amountCents: 1 }),
    ],
    DAY,
  )
  assert.deepEqual(
    summary.methods.map((item) => item.method),
    [...PAYMENT_METHODS],
  )
  const cash = summary.methods.find((item) => item.method === 'Nakit')
  assert.deepEqual(cash, {
    method: 'Nakit',
    collectedCount: 2,
    collectedCents: 20_050,
    reversedCount: 0,
    reversedCents: 0,
    refundPaidCount: 0,
    refundPaidCents: 0,
    supplierPaidCount: 0,
    supplierPaidCents: 0,
    netCents: 20_050,
  })
  assert.equal(summary.methods.find((item) => item.method === 'Senet')?.collectedCount, 0)
  assert.equal(summary.collectedCount, 4)
  assert.equal(summary.collectedCents, 40_051)
  assert.equal(summary.netCents, 40_051)
})

test('DOM-FIN-036: gün Europe/Istanbul günüdür; UTC gece yarısı sınırı kaydırmaz', () => {
  const lateUtc = payment({ paidAt: '2026-10-05T21:30:00.000Z' }) // İstanbul 6 Ekim 00:30
  const earlyUtc = payment({ paidAt: '2026-10-06T20:59:59.000Z' }) // İstanbul 6 Ekim 23:59
  const nextDay = payment({ paidAt: '2026-10-06T21:00:00.000Z' }) // İstanbul 7 Ekim 00:00
  assert.equal(financeDaySummary([lateUtc, earlyUtc, nextDay], DAY).collectedCount, 2)
})

test('DOM-FIN-033, DOM-FIN-036: iptal iptal gününe yazılır, tahsilatın günü değişmez', () => {
  const paidYesterdayReversedToday = payment({
    paidAt: '2026-10-05T09:00:00.000Z',
    reversedAt: `${DAY}T10:00:00.000Z`,
  })
  const summary = financeDaySummary([paidYesterdayReversedToday], DAY)
  assert.equal(summary.collectedCount, 0)
  assert.equal(summary.reversedCount, 1)
  assert.equal(summary.netCents, -10_000)
  const yesterday = financeDaySummary([paidYesterdayReversedToday], '2026-10-05')
  assert.equal(yesterday.collectedCents, 10_000, 'dünün tahsilatı sonraki iptalle düşmez')
  assert.equal(yesterday.reversedCount, 0)
})

test('DOM-FIN-036: aynı gün alınıp iptal edilen tahsilat iki listede görünür, net sıfırdır', () => {
  const both = payment({ reversedAt: `${DAY}T11:00:00.000Z` })
  const { collected, reversed } = financeDayLines([both], DAY)
  assert.deepEqual([collected.length, reversed.length], [1, 1])
  assert.equal(financeDaySummary([both], DAY).netCents, 0)
})

test('M-13, DOM-FIN-036: ödenen iade banka satırında ayrı sayılır, netten düşer; nakit ve kasa değişmez', () => {
  const payments = [
    payment({ method: 'Banka havalesi', amountCents: 50_000 }),
    payment({ amountCents: 20_000 }),
  ]
  const refunds = [
    { amountCents: 30_000, paidDate: DAY },
    { amountCents: 7_000, paidDate: DAY },
    { amountCents: 99_000, paidDate: '2026-10-05' },
  ]
  assert.equal(REFUND_PAYMENT_METHOD, 'Banka havalesi')
  assert.equal(financeDayRefunds(refunds, DAY).length, 2)
  const summary = financeDaySummary(payments, DAY, refunds)
  assert.deepEqual(
    summary.methods.find((item) => item.method === 'Banka havalesi'),
    {
      method: 'Banka havalesi',
      collectedCount: 1,
      collectedCents: 50_000,
      reversedCount: 0,
      reversedCents: 0,
      refundPaidCount: 2,
      refundPaidCents: 37_000,
      supplierPaidCount: 0,
      supplierPaidCents: 0,
      netCents: 13_000,
    },
  )
  for (const item of summary.methods.filter((line) => line.method !== 'Banka havalesi'))
    assert.deepEqual([item.refundPaidCount, item.refundPaidCents], [0, 0])
  assert.deepEqual(
    [summary.refundPaidCount, summary.refundPaidCents, summary.netCents],
    [2, 37_000, 70_000 - 37_000],
  )
  assert.equal(financeDayCashNet(summary), 20_000)
  // İadenin günü başka günse bu günün özetine girmez; iadesiz özet eski hâlindedir.
  assert.equal(financeDaySummary(payments, '2026-10-05', refunds).refundPaidCents, 99_000)
  assert.equal(financeDaySummary(payments, DAY).refundPaidCount, 0)
})

test('M-13, DOM-FIN-036: iade ödemesi damgayı değiştirir; net eşit kalsa da görülmemiş iade mühürlenmez', () => {
  const payments = [payment({ method: 'Banka havalesi', amountCents: 30_000 })]
  const before = financeDaySummary(payments, DAY)
  const after = financeDaySummary(
    [...payments, payment({ method: 'Banka havalesi', amountCents: 30_000 })],
    DAY,
    [{ amountCents: 30_000, paidDate: DAY }],
  )
  assert.equal(before.netCents, after.netCents)
  assert.notEqual(financeDayStamp(before), financeDayStamp(after))
  rejects(
    () =>
      planFinanceDayClosing(
        DAY,
        after,
        { reportStamp: financeDayStamp(before) },
        {
          ...today,
          cashEnabled: false,
        },
      ),
    'finance_day_report_changed',
    'conflict',
  )
})

test('K-166, DOM-FIN-036, DOM-FIN-076: nakit tedarikçi ödemesi nakit satırında ayrı sayılır, netten ve kasadan düşer', () => {
  const payments = [payment({ amountCents: 30_000 }), payment({ method: 'Banka havalesi' })]
  const suppliers = [
    supplierPayment(),
    supplierPayment({ amountCents: 2_000 }),
    // Havale, EFT ve çek kasaya dokunmaz; başka günün ve iptal edilmiş ödeme bu güne girmez.
    supplierPayment({ method: 'eft', amountCents: 50_000 }),
    supplierPayment({ method: 'cheque', amountCents: 40_000 }),
    supplierPayment({ paidDate: '2026-10-05', amountCents: 99_000 }),
    supplierPayment({ cancelledAt: `${DAY}T10:00:00.000Z`, amountCents: 7_000 }),
  ]
  assert.equal(SUPPLIER_PAYMENT_DAY_METHOD, 'Nakit')
  assert.equal(financeDaySupplierPayments(suppliers, DAY).length, 2)
  const summary = financeDaySummary(payments, DAY, [], suppliers)
  assert.deepEqual(
    summary.methods.find((item) => item.method === 'Nakit'),
    {
      method: 'Nakit',
      collectedCount: 1,
      collectedCents: 30_000,
      reversedCount: 0,
      reversedCents: 0,
      refundPaidCount: 0,
      refundPaidCents: 0,
      supplierPaidCount: 2,
      supplierPaidCents: 10_000,
      netCents: 20_000,
    },
  )
  for (const item of summary.methods.filter((line) => line.method !== 'Nakit'))
    assert.deepEqual([item.supplierPaidCount, item.supplierPaidCents], [0, 0])
  assert.deepEqual(
    [summary.supplierPaidCount, summary.supplierPaidCents, summary.netCents],
    [2, 10_000, 40_000 - 10_000],
  )
  assert.equal(financeDayCashNet(summary), 20_000)
  const plan = planFinanceDayClosing(
    DAY,
    summary,
    { reportStamp: financeDayStamp(summary), openingCashCents: 5_000, countedCashCents: 25_000 },
    today,
  )
  assert.deepEqual(plan.cash, {
    openingCents: 5_000,
    countedCents: 25_000,
    expectedCents: 25_000,
    differenceCents: 0,
  })
  // Ödemesi başka gün olan nakit tedarikçi ödemesi o günün özetindedir.
  assert.equal(financeDaySummary([], '2026-10-05', [], suppliers).supplierPaidCents, 99_000)
})

test('K-166, DOM-FIN-036: tedarikçi ödemesi ve iptali damgayı değiştirir; damga beş parçalıdır', () => {
  const payments = [payment({ amountCents: 30_000 })]
  const before = financeDaySummary(payments, DAY)
  const paid = financeDaySummary(payments, DAY, [], [supplierPayment()])
  assert.equal(financeDayStamp(before), '1:0:0:0:30000')
  assert.equal(financeDayStamp(paid), '1:0:0:1:22000')
  rejects(
    () =>
      planFinanceDayClosing(
        DAY,
        paid,
        { reportStamp: financeDayStamp(before), countedCashCents: 22_000 },
        today,
      ),
    'finance_day_report_changed',
    'conflict',
  )
  // İptal edilen ödeme günün raporundan çıkar; özet ödemesiz güne döner.
  const cancelled = financeDaySummary(
    payments,
    DAY,
    [],
    [supplierPayment({ cancelledAt: `${DAY}T11:00:00.000Z` })],
  )
  assert.deepEqual(cancelled, before)
})

test('K-166, DOM-FIN-032: yalnız nakit tedarikçi ödemesi olan günde nakit kapalı olsa da sayım gerekir', () => {
  const summary = financeDaySummary([], DAY, [], [supplierPayment()])
  assert.equal(isCashCountRequired(summary, false), true)
  rejects(
    () =>
      planFinanceDayClosing(
        DAY,
        summary,
        { reportStamp: financeDayStamp(summary) },
        { ...today, cashEnabled: false },
      ),
    'cash_count_required',
  )
  const eft = financeDaySummary([], DAY, [], [supplierPayment({ method: 'eft' })])
  assert.equal(isCashCountRequired(eft, false), false)
  assert.equal(eft.netCents, 0)
})

test('DOM-FIN-036: kasa farkı açılış + net nakde göre hesaplanır', () => {
  const payments = [payment({ amountCents: 30_000 }), payment({ method: 'Kredi kartı' })]
  const plan = planFinanceDayClosing(
    DAY,
    financeDaySummary(payments, DAY),
    {
      reportStamp: stampOf(payments),
      openingCashCents: 5_000,
      countedCashCents: 34_000,
      note: 'Bozuk para eksik çıktı',
    },
    today,
  )
  assert.deepEqual(plan.cash, {
    openingCents: 5_000,
    countedCents: 34_000,
    expectedCents: 35_000,
    differenceCents: -1_000,
  })
  assert.equal(plan.note, 'Bozuk para eksik çıktı')
})

test('DOM-FIN-036: fark sıfırsa açıklama gerekmez, açılış verilmezse önceki sayım kullanılır', () => {
  const payments = [payment({ amountCents: 30_000 })]
  const plan = planFinanceDayClosing(
    DAY,
    financeDaySummary(payments, DAY),
    { reportStamp: stampOf(payments), countedCashCents: 37_000 },
    { ...today, suggestedOpeningCents: 7_000 },
  )
  assert.equal(plan.cash?.openingCents, 7_000)
  assert.equal(plan.cash?.differenceCents, 0)
  assert.equal(plan.note, null)
})

test('DOM-FIN-036: kasa farkı ve önceki kapanıştan farklı açılış açıklamasız kapanmaz', () => {
  const payments = [payment({ amountCents: 30_000 })]
  const summary = financeDaySummary(payments, DAY)
  const reportStamp = stampOf(payments)
  rejects(
    () => planFinanceDayClosing(DAY, summary, { reportStamp, countedCashCents: 29_000 }, today),
    'cash_difference_note_required',
  )
  rejects(
    () =>
      planFinanceDayClosing(
        DAY,
        summary,
        { reportStamp, openingCashCents: 1_000, countedCashCents: 31_000 },
        { ...today, suggestedOpeningCents: 7_000 },
      ),
    'opening_cash_note_required',
  )
})

test('DOM-FIN-032, DOM-FIN-036: nakit kapalı ve hareketsiz günde sayım gerekmez, aksinde gerekir', () => {
  const card = [payment({ method: 'Kredi kartı' })]
  const cardSummary = financeDaySummary(card, DAY)
  assert.equal(isCashCountRequired(cardSummary, false), false)
  assert.equal(isCashCountRequired(cardSummary, true), true)
  const closed = planFinanceDayClosing(
    DAY,
    cardSummary,
    { reportStamp: stampOf(card) },
    { ...today, cashEnabled: false },
  )
  assert.equal(closed.cash, null)
  rejects(
    () => planFinanceDayClosing(DAY, cardSummary, { reportStamp: stampOf(card) }, today),
    'cash_count_required',
  )
  // Nakit sonradan kapatılmış olsa da o günkü nakit hareketi sayım ister.
  const cash = [payment()]
  rejects(
    () =>
      planFinanceDayClosing(
        DAY,
        financeDaySummary(cash, DAY),
        { reportStamp: stampOf(cash) },
        { ...today, cashEnabled: false },
      ),
    'cash_count_required',
  )
  const reversedCash = [
    payment({ paidAt: '2026-10-01T09:00:00.000Z', reversedAt: `${DAY}T09:00:00.000Z` }),
  ]
  assert.equal(isCashCountRequired(financeDaySummary(reversedCash, DAY), false), true)
  assert.equal(financeDayCashNet(financeDaySummary(reversedCash, DAY)), -10_000)
})

test('DOM-FIN-036: ileri gün, kapalı gün ve değişmiş rapor kapanmaz', () => {
  const summary = financeDaySummary([], DAY)
  const base = { reportStamp: financeDayStamp(summary), countedCashCents: 0 }
  rejects(
    () => planFinanceDayClosing('2026-10-07', summary, base, today),
    'finance_day_in_future',
    'rule',
  )
  rejects(
    () => planFinanceDayClosing(DAY, summary, base, { ...today, alreadyClosed: true }),
    'finance_day_already_closed',
    'conflict',
  )
  rejects(
    () => planFinanceDayClosing(DAY, summary, { ...base, reportStamp: '9:9:9' }, today),
    'finance_day_report_changed',
    'conflict',
  )
  assert.doesNotThrow(() => assertFinanceDayReportable(DAY, DAY))
  rejects(() => assertFinanceDayReportable('2026-10-07', DAY), 'finance_day_in_future')
})

test('DOM-FIN-036: gövde katıdır; sayımsız açılış ve geçersiz tutar reddedilir', () => {
  const reportStamp = '0:0:0'
  assert.equal(closeFinanceDaySchema.safeParse({ reportStamp }).success, true)
  for (const body of [
    {},
    { reportStamp, institutionId: 'b' },
    { reportStamp, openingCashCents: 100 },
    { reportStamp, countedCashCents: -1 },
    { reportStamp, countedCashCents: 1.5 },
    { reportStamp, countedCashCents: 1_000_000_001 },
    { reportStamp, countedCashCents: 0, note: 'kısa' },
  ])
    assert.equal(closeFinanceDaySchema.safeParse(body).success, false, JSON.stringify(body))
})

test('DOM-FIN-036: yeniden açma gerekçe ister, yalnız kapalı gün açılır', () => {
  assert.deepEqual(planFinanceDayReopen(true, { reason: '  Yanlış sayım girildi  ' }), {
    reason: 'Yanlış sayım girildi',
  })
  assert.throws(() => planFinanceDayReopen(true, { reason: 'kısa' }))
  assert.throws(() => planFinanceDayReopen(true, {}))
  rejects(
    () => planFinanceDayReopen(false, { reason: 'Yanlış sayım girildi' }),
    'finance_day_not_closed',
    'conflict',
  )
})

test('DOM-FIN-052, DOM-FIN-036: kapatma yönetici ve ön büro, yeniden açma yalnız yönetici', () => {
  assert.deepEqual([...FINANCE_DAY_CLOSE_ROLES], ['yonetici', 'onburo'])
  assert.deepEqual([...FINANCE_DAY_REOPEN_ROLES], ['yonetici'])
})

test('IST-113: kapatılmış güne tahsilat ve kapalı bugüne iptal reddedilir', () => {
  assert.doesNotThrow(() => assertPaymentDayOpen(false))
  assert.doesNotThrow(() => assertReversalDayOpen(false))
  assert.throws(
    () => assertPaymentDayOpen(true),
    (error: unknown) => {
      assert.ok(error instanceof DomainError)
      assert.equal(error.code, 'finance_day_closed')
      assert.deepEqual(error.path, ['paidDate'])
      return true
    },
  )
  rejects(() => assertReversalDayOpen(true), 'finance_day_closed')
})

test('DOM-FIN-036: kasa sayımı sıfırı kabul eder, tahsilat tutarı etmez', () => {
  assert.equal(parseCashCountInput('0'), 0)
  assert.equal(parseCashCountInput('0,00'), 0)
  assert.equal(parseCashCountInput('1.234,56'), 123_456)
  assert.equal(parseCashCountInput('2.000.000'), 200_000_000, 'tek tahsilat sınırının üstü geçerli')
  assert.equal(parseCashCountInput('10.000.001'), null)
  assert.equal(parseCashCountInput('abc'), null)
  assert.equal(parseAmountInput('0'), null)
  assert.equal(parseAmountInput('2.000.000'), null)
})

test('DOM-FIN-036: form yalnız geçerli tutarı ve sayımlı açılışı kabul eder', () => {
  const valid = { openingCash: '100,00', countedCash: '150', note: '' }
  assert.equal(financeDayFormSchema.safeParse(valid).success, true)
  assert.equal(
    financeDayFormSchema.safeParse({ openingCash: '', countedCash: '', note: '' }).success,
    true,
    'sayım gerekmeyen gün boş kapanır; sunucu gerekliyse alanı işaretler',
  )
  assert.equal(financeDayFormSchema.safeParse({ ...valid, countedCash: 'x' }).success, false)
  assert.equal(financeDayFormSchema.safeParse({ ...valid, openingCash: '-1' }).success, false)
  assert.equal(financeDayFormSchema.safeParse({ ...valid, countedCash: '' }).success, false)
})
