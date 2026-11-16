import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DonationReceipt } from '@kampus/react-shared/use-finance-donations.ts'
import {
  createDonationCampaignSchema,
  createDonorSchema,
  donationSchema,
  donationSettingsSchema,
  updateDonorSchema,
} from '@kampus/school-core/lib/finance-donations.ts'
import {
  donationReceiptDocument,
  donationReceiptFilename,
  receiptDonor,
} from '../src/lib/pdf/templates/finance-donation-receipt.ts'
import {
  campaignBody,
  campaignDefaults,
  campaignFormSchema,
  donationBody,
  donationDefaults,
  donationFormSchema,
  donorBody,
  donorDefaults,
  donorFormSchema,
  donorUpdateBody,
  settingsBody,
  settingsFormSchema,
} from '../src/pages/finance/donation-forms.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

const ACCOUNT = '6f2b6d1e-4c1a-4b8e-9a51-1f2d3c4b5a60'
const DONOR = '0b7c1d2e-3f40-4a51-8b62-7c83d94ea5f6'

test('DOM-FIN-097: kampanya formu ₺ tutarı kuruşa çevirir; hesap seçilmezse hesapsızdır (K-296)', () => {
  const values = {
    ...campaignDefaults('2026-10-06'),
    name: ' Kütüphane ',
    purpose: 'Kütüphane yenilenecek.',
    target: '100.000,00',
    endsOn: '2026-12-31',
  }
  assert.equal(campaignFormSchema.safeParse(values).success, true)
  const body = campaignBody(values)
  assert.deepEqual(body, {
    name: 'Kütüphane',
    purpose: 'Kütüphane yenilenecek.',
    targetCents: 10_000_000,
    startsOn: '2026-10-06',
    endsOn: '2026-12-31',
    bankAccountId: null,
  })
  assert.equal(createDonationCampaignSchema.safeParse(body).success, true)
  assert.equal(campaignBody({ ...values, bankAccountId: ACCOUNT }).bankAccountId, ACCOUNT)
  assert.equal(campaignFormSchema.safeParse({ ...values, endsOn: '2026-10-05' }).success, false)
  assert.equal(campaignFormSchema.safeParse({ ...values, target: '12,345' }).success, false)
})

test('DOM-FIN-097: bağışçı formu kimliği türe göre denetler; düzeltmede boş kimlik değişmez (K-298)', () => {
  const values = {
    ...donorDefaults(),
    name: 'Ayşe Yılmaz',
    identityNumber: '10000000146',
    phone: '05551234567',
    studentId: 's1',
    relation: 'parent' as const,
  }
  assert.equal(donorFormSchema.safeParse(values).success, true)
  const body = donorBody(values)
  assert.deepEqual(body, {
    kind: 'person',
    name: 'Ayşe Yılmaz',
    identityNumber: '10000000146',
    phone: '05551234567',
    link: { studentId: 's1', relation: 'parent' },
  })
  assert.equal(createDonorSchema.safeParse(body).success, true)
  for (const bad of [
    { ...values, identityNumber: '10000000147' },
    { ...values, kind: 'organization' as const, identityNumber: '1234567891' },
    { ...values, relation: '' as const },
    { ...values, email: 'x' },
    { ...values, address: 'kısa' },
  ])
    assert.equal(donorFormSchema.safeParse(bad).success, false)
  const update = donorUpdateBody({
    ...values,
    identityNumber: '',
    phone: '',
    studentId: '',
    relation: '',
  })
  assert.deepEqual(update, {
    name: 'Ayşe Yılmaz',
    phone: null,
    email: null,
    address: null,
    link: null,
  })
  assert.equal(updateDonorSchema.safeParse(update).success, true)
})

test('DOM-FIN-097: bağış formu türe ait olmayan alanı göndermez; boş bağışçı anonimdir (K-297)', () => {
  const cash = {
    ...donationDefaults('2026-10-06'),
    amount: '2.500,00',
    method: 'bank_transfer' as const,
    bankAccountId: ACCOUNT,
    description: 'yok sayılır',
  }
  assert.equal(donationFormSchema.safeParse(cash).success, true)
  const cashBody = donationBody(cash)
  assert.deepEqual(cashBody, {
    donorId: null,
    donatedOn: '2026-10-06',
    kind: 'cash',
    amountCents: 250_000,
    method: 'bank_transfer',
    bankAccountId: ACCOUNT,
  })
  assert.equal(donationSchema.safeParse(cashBody).success, true)
  assert.equal('bankAccountId' in donationBody({ ...cash, method: 'cash' }), false)
  const inKind = {
    ...donationDefaults('2026-10-06'),
    donorId: DONOR,
    kind: 'in_kind' as const,
    amount: 'yok sayılır',
    description: '50 adet kitap',
    declaredValue: '1.000,00',
    reference: ' ',
  }
  assert.equal(donationFormSchema.safeParse(inKind).success, true)
  const inKindBody = donationBody(inKind)
  assert.deepEqual(inKindBody, {
    donorId: DONOR,
    donatedOn: '2026-10-06',
    kind: 'in_kind',
    description: '50 adet kitap',
    declaredValueCents: 100_000,
  })
  assert.equal(donationSchema.safeParse(inKindBody).success, true)
  assert.equal(donationFormSchema.safeParse({ ...inKind, description: 'yok' }).success, false)
  assert.equal(donationFormSchema.safeParse({ ...cash, amount: '' }).success, false)
})

test('DOM-FIN-097: makbuz ayarı açıkken metin ister; kapalıyken boş metin null gider (K-299)', () => {
  assert.equal(
    settingsFormSchema.safeParse({ taxNoticeEnabled: true, taxNoticeText: 'kısa' }).success,
    false,
  )
  const off = settingsBody({ taxNoticeEnabled: false, taxNoticeText: ' ' })
  assert.deepEqual(off, { taxNoticeEnabled: false, taxNoticeText: null })
  assert.equal(donationSettingsSchema.safeParse(off).success, true)
})

const RECEIPT: DonationReceipt = {
  id: 'd1',
  campaignId: 'c1',
  donorId: DONOR,
  donorKind: 'person',
  donorName: 'Ayşe Yılmaz',
  maskedIdentityNumber: '*******0146',
  identityNumber: '10000000146',
  kind: 'cash',
  amountCents: 250_000,
  method: 'bank_transfer',
  bankAccountId: ACCOUNT,
  bankAccountLabel: 'Ziraat Bankası · 1326',
  reference: 'DK-1',
  description: null,
  declaredValueCents: null,
  donatedOn: '2026-10-01',
  note: null,
  receiptYear: 2026,
  receiptNumber: 7,
  hasTaxNotice: true,
  taxNotice: 'Bu bağış GVK md. 89 kapsamında indirilebilir.',
  createdAt: '2026-10-06T09:00:00.000Z',
  cancelledAt: null,
  cancelReason: null,
  version: 1,
  campaign: { id: 'c1', name: 'Kütüphane Kampanyası', purpose: 'Kütüphane yenilenecek.' },
}
const OPTIONS = {
  institution: 'Akademi Özel Okulları',
  generatedAt: new Date('2026-10-06T15:00:00.000Z'),
}

test('DOM-FIN-097: makbuz PDF numarayı, tam kimliği, tutarı ve kopyalanmış ibareyi taşır (K-297, K-299)', () => {
  const all = allTexts(donationReceiptDocument(measurer, RECEIPT, OPTIONS)).join('\n')
  for (const text of [
    'Bağış makbuzu',
    'BM-2026-7',
    'Ayşe Yılmaz (Kişi)',
    '10000000146',
    '2.500,00 ₺',
    'Banka havalesi / EFT',
    'Ziraat Bankası · 1326',
    'GVK md. 89',
  ])
    assert.ok(all.includes(text), text)
  assert.equal(donationReceiptFilename(RECEIPT), 'bagis-makbuzu-BM-2026-7.pdf')
})

test('DOM-FIN-097: anonim, ayni ve iptal edilmiş makbuz; ibare yoksa vergi belgesi olmadığı yazılır', () => {
  const receipt = {
    ...RECEIPT,
    donorId: null,
    donorKind: null,
    donorName: null,
    identityNumber: null,
    maskedIdentityNumber: null,
    kind: 'in_kind' as const,
    amountCents: null,
    method: null,
    bankAccountId: null,
    bankAccountLabel: null,
    reference: null,
    description: '50 adet kitap',
    declaredValueCents: null,
    taxNotice: null,
    hasTaxNotice: false,
    cancelledAt: '2026-10-07T09:00:00.000Z',
    cancelReason: 'Mükerrer kayıt',
  }
  assert.equal(receiptDonor(receipt), 'Anonim bağışçı')
  const all = allTexts(donationReceiptDocument(measurer, receipt, OPTIONS)).join('\n')
  for (const text of [
    'İPTAL EDİLDİ',
    'Anonim bağışçı',
    'Değer beyan edilmedi',
    '50 adet kitap',
    'Mükerrer kayıt',
    'vergi indirimi belgesi yerine geçmez',
  ])
    assert.ok(all.includes(text), text)
  assert.equal(all.includes('T.C. kimlik no'), false)
})
