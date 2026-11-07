import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DISTANCE_SALE_RULE,
  distanceSaleLastWithdrawalDate,
  distanceSalePreInformation,
  distanceSaleWithdrawal,
  isDistanceSale,
} from '../packages/school-core/src/lib/finance-distance-sale.ts'
import { isDomainError } from './support/domain-error.ts'

const SALE = {
  institutionType: 'language_school',
  channel: 'online',
  contractDate: '2026-10-06',
  withdrawalDate: '2026-10-10',
  paidCents: 500_000,
} as const

test('DOM-FIN-042: kural yalnız dil okulu paketinin çevrim içi satışına uygulanır', () => {
  assert.equal(isDistanceSale(SALE), true)
  assert.equal(isDistanceSale({ ...SALE, channel: 'in_person' }), false)
  assert.equal(isDistanceSale({ ...SALE, institutionType: 'school' }), false)
  assert.deepEqual(distanceSaleWithdrawal({ ...SALE, channel: 'in_person' }), { applies: false })
  assert.deepEqual(distanceSaleWithdrawal({ ...SALE, institutionType: 'school' }), {
    applies: false,
  })
})

test('DOM-FIN-042: süre içindeki ayrılışta kesinti yoktur, ödenen iade edilir; son gün dahildir', () => {
  assert.equal(distanceSaleLastWithdrawalDate('2026-10-06'), '2026-10-20')
  assert.equal(distanceSaleLastWithdrawalDate('2026-12-25'), '2027-01-08')
  const within = distanceSaleWithdrawal(SALE)
  assert.ok(within.applies)
  assert.equal(within.withinPeriod, true)
  assert.equal(within.refundCents, 500_000)
  const lastDay = distanceSaleWithdrawal({ ...SALE, withdrawalDate: '2026-10-20' })
  assert.ok(lastDay.applies)
  assert.equal(lastDay.withinPeriod, true)
  const late = distanceSaleWithdrawal({ ...SALE, withdrawalDate: '2026-10-21' })
  assert.ok(late.applies)
  assert.equal(late.withinPeriod, false)
  assert.equal(late.refundCents, null, 'süre dışında hesap DOM-FIN-040 ile yapılır')
})

test('DOM-FIN-042: süre kuraldan gelir, doğrulanmalı etiketi (H-17) sonuçta ve bilgilendirmede kalır', () => {
  assert.equal(DISTANCE_SALE_RULE.withdrawalDays, 14)
  assert.equal(DISTANCE_SALE_RULE.verification.status, 'doğrulanmalı')
  assert.equal(DISTANCE_SALE_RULE.verification.questionId, 'H-17')
  const result = distanceSaleWithdrawal(SALE)
  assert.ok(result.applies)
  assert.equal(result.verification.questionId, 'H-17')
  const info = distanceSalePreInformation({
    institutionType: 'language_school',
    channel: 'online',
    packageName: 'A2 Saat Paketi',
    totalCents: 500_000,
    contractDate: '2026-10-06',
  })
  assert.ok(info)
  assert.match(info.verificationNotice, /H-17/)
  assert.equal(info.withdrawalDays, DISTANCE_SALE_RULE.withdrawalDays)
  assert.equal(info.lastWithdrawalDate, '2026-10-20')
  const value = (label: string) => info.lines.find((line) => line.label === label)?.value
  assert.equal(value('Paket'), 'A2 Saat Paketi')
  assert.match(value('Toplam bedel') ?? '', /5\.000,00/)
  assert.equal(value('Cayma süresi'), 'Sözleşme gününden itibaren 14 gün')
  assert.equal(value('Süre içinde ayrılış'), 'Kesinti yapılmaz.')
})

test('DOM-FIN-042: kural dışı satışta ön bilgilendirme üretilmez', () => {
  assert.equal(
    distanceSalePreInformation({
      institutionType: 'language_school',
      channel: 'in_person',
      packageName: 'A2 Saat Paketi',
      totalCents: 1,
      contractDate: '2026-10-06',
    }),
    null,
  )
})

test('DOM-FIN-042: geçersiz tarih ve tutar reddedilir', () => {
  for (const contractDate of ['2026-02-30', '06.10.2026', ''])
    assert.throws(
      () => distanceSaleLastWithdrawalDate(contractDate),
      isDomainError('distance_sale_date_invalid'),
    )
  assert.throws(
    () => distanceSaleWithdrawal({ ...SALE, withdrawalDate: 'dün' }),
    isDomainError('distance_sale_date_invalid'),
  )
  assert.throws(
    () => distanceSaleWithdrawal({ ...SALE, withdrawalDate: '2026-10-05' }),
    isDomainError('distance_sale_withdrawal_before_contract'),
  )
  for (const paidCents of [-1, 1.5])
    assert.throws(
      () => distanceSaleWithdrawal({ ...SALE, paidCents }),
      isDomainError('distance_sale_amount_invalid'),
    )
})
