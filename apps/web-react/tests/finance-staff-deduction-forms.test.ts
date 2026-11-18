import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  advanceForm,
  basisPointsText,
  fieldOf,
  garnishmentBalanceForm,
  garnishmentForm,
  pensionForm,
  pensionPauseForm,
  percentToBasisPoints,
  previewForm,
  validateDeductionForm,
} from '../src/pages/finance/finance-staff-deduction-forms.ts'

// Avans ve kesinti formları (DOM-FIN-101; ON-199): metin → gövde çevirisi ve core doğrulaması.

test('DOM-FIN-101: yüzde metni onbinde orana çevrilir', () => {
  assert.equal(percentToBasisPoints('25'), 2500)
  assert.equal(percentToBasisPoints('2,5'), 250)
  assert.equal(percentToBasisPoints(' 3 '), 300)
  assert.equal(percentToBasisPoints('abc'), null)
  assert.equal(percentToBasisPoints('2,555'), null)
  assert.equal(basisPointsText(2500), '25')
  assert.equal(basisPointsText(250), '2,5')
})

test('DOM-FIN-101: avans formu tutarı kuruşa çevirir, core kurallarıyla denetler', () => {
  const values = {
    membershipId: 'm-1',
    amount: '10.000,00',
    givenDate: '2026-10-01',
    paymentMethod: 'bank_transfer',
    installmentCount: '3',
    firstMonth: '2026-10',
  }
  const ok = validateDeductionForm(advanceForm, values)
  assert.deepEqual(ok.errors, {})
  assert.equal(ok.body.amountCents, 1_000_000)
  assert.equal(ok.body.installmentCount, 3)

  assert.match(
    validateDeductionForm(advanceForm, { ...values, amount: '0' }).errors.amount ?? '',
    /1\.234,56/,
  )
  assert.equal(
    validateDeductionForm(advanceForm, { ...values, installmentCount: '30' }).errors
      .installmentCount,
    'En çok 24 taksit olabilir.',
  )
  assert.equal(
    validateDeductionForm(advanceForm, { ...values, membershipId: '' }).errors.root,
    'Personel seçin.',
  )
})

test('DOM-FIN-101: icra formu oran, nafaka ve alacağı çevirir', () => {
  const values = {
    membershipId: 'm-1',
    office: 'İstanbul 12. İcra Dairesi',
    fileNumber: '2026/1234',
    claim: '50.000',
    rate: '25',
    isAlimony: 'true',
    receivedDate: '2026-10-01',
  }
  const { body, errors } = validateDeductionForm(garnishmentForm, values)
  assert.deepEqual(errors, {})
  assert.equal(body.claimCents, 5_000_000)
  assert.equal(body.rateBasisPoints, 2500)
  assert.equal(body.isAlimony, true)
  assert.match(
    validateDeductionForm(garnishmentForm, { ...values, rate: 'x' }).errors.rate ?? '',
    /yüzde/,
  )
  assert.ok(validateDeductionForm(garnishmentForm, { ...values, office: 'A' }).errors.office)
})

test('DOM-FIN-101: BES, ara verme, kalan alacak ve ay listesi formları', () => {
  assert.ok(
    validateDeductionForm(pensionForm, { membershipId: 'm-1', rate: '2', startDate: '2026-09-01' })
      .errors.rate,
  )
  assert.equal(
    validateDeductionForm(pensionPauseForm, { fromMonth: '2026-01', toMonth: '2027-01' }).errors
      .toMonth,
    'Ara verme en çok 12 ay sürebilir.',
  )
  assert.equal(
    validateDeductionForm(garnishmentBalanceForm, { remaining: '0' }).body.remainingCents,
    0,
  )
  assert.ok(validateDeductionForm(garnishmentBalanceForm, { remaining: '' }).errors.remaining)
  const preview = validateDeductionForm(previewForm, { month: '2026-10', net: '', pensionBase: '' })
  assert.deepEqual(preview.errors, {})
  assert.equal(preview.body.netCents, null)
  assert.equal(
    validateDeductionForm(previewForm, { month: '2026-10', net: '40.000', pensionBase: '' }).body
      .netCents,
    4_000_000,
  )
})

test('DOM-FIN-101: sunucu alan yolu forma döner', () => {
  assert.equal(fieldOf(advanceForm, 'amountCents'), 'amount')
  assert.equal(fieldOf(advanceForm, 'firstMonth'), 'firstMonth')
  assert.equal(fieldOf(advanceForm, 'membershipId'), null)
  assert.equal(fieldOf(garnishmentForm, 'rateBasisPoints'), 'rate')
})
