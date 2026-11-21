import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LEGAL_INTEREST_RATES,
  legalInterest,
} from '../packages/school-core/src/lib/finance-legal-interest.ts'
import { isDomainError } from './support/domain-error.ts'

// Kanuni faiz (3095 sayılı Kanun md. 1; DOM-FIN-025, ON-283, K-266): basit faiz, yıl 365 gün,
// kuruş aşağı yuvarlanır, oran değişen aralık gün gün bölünür.

test('DOM-FIN-025, K-266: tek oranlı bir yıl yıllık oranın tamamıdır', () => {
  const result = legalInterest(10_000_000, '2025-01-01', '2026-01-01')
  assert.equal(result.days, 365)
  assert.equal(result.interestCents, 2_400_000)
  assert.deepEqual(
    result.segments.map((item) => [item.from, item.to, item.basisPoints]),
    [['2025-01-01', '2026-01-01', 2_400]],
  )
})

test('DOM-FIN-025, K-266: oran değişen aralık iki parçaya bölünür, ara toplam yuvarlanmaz', () => {
  const result = legalInterest(10_000_000, '2024-05-01', '2024-07-01')
  assert.deepEqual(
    result.segments.map((item) => [item.from, item.to, item.days, item.basisPoints]),
    [
      ['2024-05-01', '2024-06-01', 31, 900],
      ['2024-06-01', '2024-07-01', 30, 2_400],
    ],
  )
  // 10.000.000 × (31 × 900 + 30 × 2.400) / (10.000 × 365) = 273.698,63 → aşağı.
  assert.equal(result.interestCents, 273_698)
  assert.equal(result.days, 61)
})

test('DOM-FIN-025, K-266: kuruş aşağı yuvarlanır; boş aralık ve sıfır anapara faizsizdir', () => {
  assert.equal(legalInterest(1, '2025-01-01', '2025-01-02').interestCents, 0)
  // 15.209 × 2.400 × 1 / 3.650.000 = 10,0004 → 10.
  assert.equal(legalInterest(15_209, '2025-01-01', '2025-01-02').interestCents, 10)
  assert.deepEqual(legalInterest(500, '2025-03-01', '2025-03-01'), {
    interestCents: 0,
    days: 0,
    segments: [],
  })
  assert.equal(legalInterest(500, '2025-03-02', '2025-03-01').interestCents, 0)
  assert.equal(legalInterest(0, '2025-01-01', '2026-01-01').interestCents, 0)
})

test('DOM-FIN-025, K-266: büyük anapara ve uzun süre hassasiyet kaybetmez', () => {
  const principal = 10_000_000_000
  const result = legalInterest(principal, '2006-01-01', '2024-06-01')
  const expected = (BigInt(principal) * BigInt(result.days) * 900n) / 3_650_000n
  assert.equal(result.interestCents, Number(expected))
})

test('DOM-FIN-025, K-266: tablodan önceki gün oransızdır; geçersiz anapara programlama hatasıdır', () => {
  assert.throws(
    () => legalInterest(1_000, '2005-12-31', '2006-02-01'),
    isDomainError('legal_interest_rate_missing'),
  )
  assert.throws(() => legalInterest(-1, '2025-01-01', '2025-02-01'), RangeError)
  assert.throws(() => legalInterest(1.5, '2025-01-01', '2025-02-01'), RangeError)
  assert.throws(
    () => legalInterest(1_000, '2025-01-01', '2025-02-01', []),
    isDomainError('legal_interest_rate_missing'),
  )
})

test('DOM-FIN-025: oran tablosu yürürlük sırasındadır ve kaynağı yazılıdır', () => {
  const days = LEGAL_INTEREST_RATES.map((rate) => rate.from)
  assert.deepEqual(days, [...days].sort())
  assert.ok(LEGAL_INTEREST_RATES.every((rate) => rate.source.length > 0 && rate.basisPoints > 0))
})
