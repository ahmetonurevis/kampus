import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  ALL_BRANCHES,
  branchValue,
  collectionSpark,
  collectionWindow,
  currentMonthAmount,
  DEFAULT_PERIOD,
  periodLabel,
  periodValue,
  sparkLabel,
  type MonthlyCollection,
} from '../src/pages/dashboard/dashboard-filter-model.ts'
import { gradeSpark } from '../src/pages/dashboard/dashboard-grade-trend-model.ts'

// Genel Bakış süzgeçleri ve mini grafikler. Aylık seri sunucudan 12 ay gelir (apps/api/test/
// dashboard.test.ts); burada adres değerleri, dönem kesimi ve mini grafik koşulu sınanır.

const MONTH_KEYS = [
  '2025-11',
  '2025-12',
  '2026-01',
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
  '2026-08',
  '2026-09',
  '2026-10',
]

/** Her ay `index + 1` taksit ve `(index + 1) * 1000` kuruş; istenirse ay tutarı sıfırlanır. */
function monthly(zeroed = false): MonthlyCollection {
  const months = MONTH_KEYS.map((month, index) => ({
    month,
    count: zeroed ? 0 : index + 1,
    amount: zeroed ? 0 : (index + 1) * 1000,
  }))
  return {
    months,
    count: months.reduce((sum, item) => sum + item.count, 0),
    amount: months.reduce((sum, item) => sum + item.amount, 0),
  }
}

describe('adres süzgeçleri', () => {
  test('kampüs yalnız listede varsa süzgeçtir; bilinmeyen değer tüm kampüslerdir', () => {
    const ids = ['b1', 'b2']
    assert.equal(branchValue('b2', ids), 'b2')
    assert.equal(branchValue('arsivli', ids), ALL_BRANCHES)
    assert.equal(branchValue(null, ids), ALL_BRANCHES)
    assert.equal(branchValue('b1', []), ALL_BRANCHES)
  })

  test('dönem 6 ya da 12 aydır; bozuk değer varsayılan 6', () => {
    assert.equal(periodValue('12'), 12)
    assert.equal(periodValue('6'), 6)
    for (const raw of [null, '', '3', '12abc', 'x']) assert.equal(periodValue(raw), DEFAULT_PERIOD)
    assert.equal(periodLabel(6), 'Son 6 ay')
    assert.equal(periodLabel(12), 'Son 12 ay')
  })
})

describe('tahsilat dönemi', () => {
  test('son 6 ay serinin son altı ayıdır, toplamlar pencereden hesaplanır', () => {
    const result = collectionWindow(monthly(), 6)
    assert.deepEqual(
      result.months.map((item) => item.month),
      MONTH_KEYS.slice(-6),
    )
    assert.equal(result.count, 7 + 8 + 9 + 10 + 11 + 12)
    assert.equal(result.amount, (7 + 8 + 9 + 10 + 11 + 12) * 1000)
  })

  test('son 12 ay bütün seridir; kısa seri olduğu kadarını verir', () => {
    const all = monthly()
    const result = collectionWindow(all, 12)
    assert.equal(result.months.length, 12)
    assert.equal(result.amount, all.amount)
    const short = { ...all, months: all.months.slice(-3) }
    assert.equal(collectionWindow(short, 12).months.length, 3)
  })
})

describe('mini grafikler', () => {
  test('tahsilat mini grafiği son 6 ayın gerçek değerleridir, bu ay son noktadır', () => {
    const points = collectionSpark(monthly())
    assert.equal(points.length, 6)
    assert.deepEqual(
      points.map((point) => point.value),
      [7000, 8000, 9000, 10000, 11000, 12000],
    )
    assert.equal(currentMonthAmount(monthly()), 12000)
  })

  test('hiç tahsilat ya da veri yoksa mini grafik çizilmez', () => {
    assert.deepEqual(collectionSpark(monthly(true)), [])
    assert.deepEqual(collectionSpark(undefined), [])
    assert.equal(currentMonthAmount(undefined), 0)
  })

  test('not mini grafiği son 6 ay; iki aydan az veride çizilmez', () => {
    const groups = MONTH_KEYS.map((value, index) => ({
      value,
      count: 2,
      sum: 2 * (60 + index),
    }))
    const points = gradeSpark(groups)
    assert.equal(points.length, 6)
    assert.deepEqual(
      points.map((point) => point.value),
      [66, 67, 68, 69, 70, 71],
    )
    assert.deepEqual(gradeSpark(groups.slice(0, 1)), [])
    assert.deepEqual(gradeSpark([]), [])
  })

  test('erişilebilir etiket başlığı ve ay ay değerleri taşır; nokta yoksa yalnız başlık', () => {
    const label = sparkLabel(
      'Aylık not ortalaması',
      [
        { label: 'Eyl 26', value: 70 },
        { label: 'Eki 26', value: 72 },
      ],
      (value) => `${value}/100`,
    )
    assert.equal(label, 'Aylık not ortalaması: Eyl 26 70/100, Eki 26 72/100')
    assert.equal(sparkLabel('Son 6 ayın tahsilatı', [], String), 'Son 6 ayın tahsilatı')
  })
})
