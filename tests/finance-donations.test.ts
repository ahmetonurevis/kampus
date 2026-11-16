import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ANONYMOUS_DONOR_LABEL,
  createDonorSchema,
  donationCampaignProgress,
  donationReceiptLabel,
  donationSchema,
  donationSettingsSchema,
  donationsCsv,
  donorIdentityIssue,
  maskDonorIdentity,
  planDonation,
  planDonationCampaignClose,
  planDonationCampaignCreate,
  planDonationCampaignOpen,
  planDonationCampaignUpdate,
  planDonationCancel,
  planDonorCreate,
  planDonorUpdate,
  type DonationCampaignState,
  type DonationSettingsState,
  type DonationListRow,
} from '../packages/school-core/src/lib/finance-donations.ts'

import { isDomainError } from './support/domain-error.ts'

const ZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'
const TODAY = '2026-10-06'
const ACCOUNT = '6f2b6d1e-4c1a-4b8e-9a51-1f2d3c4b5a60'
const ACCOUNTS = new Set([ACCOUNT])
const CAMPAIGN_BODY = {
  name: ' Kütüphane Kampanyası ',
  purpose: 'Okul kütüphanesi yenilenecek.',
  targetCents: 10_000_000,
  startsOn: '2026-09-01',
  endsOn: '2026-12-31',
}
const OPEN: DonationCampaignState = {
  id: 'kampanya-1',
  name: 'Kütüphane Kampanyası',
  status: 'open',
  startsOn: '2026-09-01',
  endsOn: '2026-12-31',
  bankAccountId: null,
}
const DONOR = {
  id: '0b7c1d2e-3f40-4a51-8b62-7c83d94ea5f6',
  kind: 'person' as const,
  name: 'Ayşe Yılmaz',
  identityNumber: '10000000146',
}
const CASH = {
  donorId: null,
  kind: 'cash',
  donatedOn: '2026-10-01',
  amountCents: 250_000,
  method: 'cash',
}
const OFF = { taxNoticeEnabled: false, taxNoticeText: null }
const ON = {
  taxNoticeEnabled: true,
  taxNoticeText: 'GVK md. 89 kapsamında indirilebilir bağıştır.',
}
const context = (settings: DonationSettingsState = OFF) => ({
  accounts: ACCOUNTS,
  settings,
  today: TODAY,
})

test('DOM-FIN-097: kampanya ad, amaç, hedef ve günlerle taslak açılır; aynı ad ve yabancı hesap reddedilir (K-296)', () => {
  assert.deepEqual(planDonationCampaignCreate(CAMPAIGN_BODY, { taken: [], accounts: ACCOUNTS }), {
    name: 'Kütüphane Kampanyası',
    purpose: 'Okul kütüphanesi yenilenecek.',
    targetCents: 10_000_000,
    startsOn: '2026-09-01',
    endsOn: '2026-12-31',
    bankAccountId: null,
  })
  for (const bad of [
    { ...CAMPAIGN_BODY, endsOn: '2026-08-31' },
    { ...CAMPAIGN_BODY, targetCents: 1.5 },
    { ...CAMPAIGN_BODY, purpose: 'kısa' },
    { ...CAMPAIGN_BODY, extra: 1 },
  ])
    assert.throws(
      () => planDonationCampaignCreate(bad, { taken: [], accounts: ACCOUNTS }),
      ZodError,
    )
  assert.throws(
    () =>
      planDonationCampaignCreate(
        { ...CAMPAIGN_BODY, name: 'KÜTÜPHANE kampanyası' },
        { taken: [{ id: 'x', name: 'Kütüphane Kampanyası' }], accounts: ACCOUNTS },
      ),
    isDomainError('donation_campaign_exists', 'conflict'),
  )
  assert.throws(
    () =>
      planDonationCampaignCreate(
        { ...CAMPAIGN_BODY, bankAccountId: '1b7c1d2e-3f40-4a51-8b62-7c83d94ea5f6' },
        { taken: [], accounts: ACCOUNTS },
      ),
    isDomainError('bank_account_not_found', 'not_found'),
  )
})

test('DOM-FIN-097: kampanya düzeltmesi kapanınca yok, günler bağışları kapsamalı, ad kendisiyle çakışmaz (K-296)', () => {
  const update = (
    campaign: DonationCampaignState,
    input: unknown,
    days: { first: string; last: string } | null = null,
  ) =>
    planDonationCampaignUpdate(campaign, input, {
      taken: [{ id: OPEN.id, name: OPEN.name }],
      accounts: ACCOUNTS,
      donationDays: days,
    })
  assert.deepEqual(update(OPEN, { name: 'kütüphane KAMPANYASI', targetCents: 5 }), {
    name: 'kütüphane KAMPANYASI',
    targetCents: 5,
  })
  assert.deepEqual(update(OPEN, { bankAccountId: null }), { bankAccountId: null })
  assert.throws(() => update(OPEN, {}), ZodError)
  assert.throws(
    () => update({ ...OPEN, status: 'closed' }, { targetCents: 5 }),
    isDomainError('donation_campaign_closed'),
  )
  assert.throws(
    () => update(OPEN, { endsOn: '2026-08-01' }),
    isDomainError('donation_campaign_dates_invalid'),
  )
  assert.throws(
    () => update(OPEN, { startsOn: '2027-01-02' }),
    (error: unknown) => isDomainError('donation_campaign_dates_invalid')(error),
  )
  const days = { first: '2026-09-10', last: '2026-10-01' }
  assert.throws(
    () => update(OPEN, { startsOn: '2026-09-11' }, days),
    isDomainError('donation_campaign_dates_conflict'),
  )
  assert.throws(
    () => update(OPEN, { endsOn: '2026-09-30' }, days),
    isDomainError('donation_campaign_dates_conflict'),
  )
  assert.deepEqual(update(OPEN, { startsOn: '2026-09-10', endsOn: '2026-10-01' }, days), {
    startsOn: '2026-09-10',
    endsOn: '2026-10-01',
  })
})

test('DOM-FIN-097: taslak açılır, açık kapanır; geri dönüş yok, bitmiş kampanya açılmaz (K-296)', () => {
  const draft = { ...OPEN, status: 'draft' as const }
  assert.doesNotThrow(() => planDonationCampaignOpen(draft, TODAY))
  assert.throws(
    () => planDonationCampaignOpen({ ...draft, endsOn: '2026-10-05' }, TODAY),
    isDomainError('donation_campaign_ended'),
  )
  assert.throws(
    () => planDonationCampaignOpen(OPEN, TODAY),
    isDomainError('donation_campaign_not_draft', 'conflict'),
  )
  assert.doesNotThrow(() => planDonationCampaignClose(OPEN))
  for (const status of ['draft', 'closed'] as const)
    assert.throws(
      () => planDonationCampaignClose({ ...OPEN, status }),
      isDomainError('donation_campaign_not_open', 'conflict'),
    )
})

test('DOM-FIN-097: ilerleme yalnız nakdi toplamdan, aşağı yuvarlanır ve hedefi aşabilir (K-297)', () => {
  assert.deepEqual(donationCampaignProgress(300, 100), { percent: 33, remainingCents: 200 })
  assert.deepEqual(donationCampaignProgress(100, 250), { percent: 250, remainingCents: 0 })
  assert.deepEqual(donationCampaignProgress(0, 10), { percent: 0, remainingCents: 0 })
})

test('DOM-FIN-097: bağışçı kimlik numarası türe göre denetlenir, tekildir ve maskelenir (K-298)', () => {
  assert.equal(donorIdentityIssue('person', '10000000146'), null)
  assert.notEqual(donorIdentityIssue('person', '1234567890'), null)
  assert.equal(donorIdentityIssue('organization', '1234567890'), null)
  assert.equal(donorIdentityIssue('organization', '10000000146'), null)
  assert.notEqual(donorIdentityIssue('organization', '1234567891'), null)
  assert.equal(donorIdentityIssue('person', null), null)
  const created = planDonorCreate(
    { kind: 'person', name: ' Ayşe Yılmaz ', identityNumber: '10000000146', address: '' },
    { identityTaken: false, studentExists: false },
  )
  assert.deepEqual(created, {
    kind: 'person',
    name: 'Ayşe Yılmaz',
    identityNumber: '10000000146',
    phone: null,
    email: null,
    address: null,
    link: null,
  })
  for (const bad of [
    { kind: 'anonymous', name: 'Ali' },
    { kind: 'person', name: 'Ali', identityNumber: '10000000147' },
    { kind: 'person', name: 'Ali', email: 'x' },
    { kind: 'person', name: 'Ali', address: 'kısa' },
    { kind: 'person', name: 'Ali', link: { studentId: 's1', relation: 'kardes' } },
  ])
    assert.throws(() => createDonorSchema.parse(bad), ZodError)
  assert.throws(
    () =>
      planDonorCreate(
        { kind: 'person', name: 'Ali', identityNumber: '10000000146' },
        { identityTaken: true, studentExists: false },
      ),
    isDomainError('donor_identity_exists', 'conflict'),
  )
  assert.throws(
    () =>
      planDonorCreate(
        { kind: 'person', name: 'Ali', link: { studentId: 's9', relation: 'parent' } },
        { identityTaken: false, studentExists: false },
      ),
    isDomainError('student_not_found', 'not_found'),
  )
  assert.deepEqual(
    planDonorUpdate(
      DONOR,
      { phone: null, link: null },
      { identityTaken: false, studentExists: false },
    ),
    { phone: null, link: null },
  )
  assert.throws(
    () =>
      planDonorUpdate(
        DONOR,
        { identityNumber: '1234567890' },
        { identityTaken: false, studentExists: false },
      ),
    isDomainError('donor_identity_invalid'),
  )
  assert.equal(maskDonorIdentity('10000000146'), '*******0146')
  assert.equal(maskDonorIdentity(null), null)
})

test('DOM-FIN-097: nakdi bağış tutar ve yöntem, ayni bağış açıklama ister; alanlar türe göre ayrılır (K-297)', () => {
  const inKind = { donorId: null, kind: 'in_kind', donatedOn: TODAY, description: '50 adet kitap' }
  assert.doesNotThrow(() => donationSchema.parse(CASH))
  assert.doesNotThrow(() => donationSchema.parse({ ...inKind, declaredValueCents: 100 }))
  for (const bad of [
    { ...CASH, amountCents: undefined },
    { ...CASH, method: undefined },
    { ...CASH, method: 'online' },
    { ...CASH, description: 'Kitap seti' },
    { ...CASH, declaredValueCents: 100 },
    { ...CASH, bankAccountId: ACCOUNT },
    { ...inKind, description: undefined },
    { ...inKind, amountCents: 100 },
    { ...inKind, method: 'cash' },
    { ...inKind, bankAccountId: ACCOUNT },
    { ...CASH, donorId: undefined },
  ])
    assert.throws(() => donationSchema.parse(bad), ZodError)
})

test('DOM-FIN-097: bağış açık kampanyaya, kampanya günleri içinde ve geçmiş ya da bugünkü güne yazılır', () => {
  const plan = planDonation(OPEN, null, context(), CASH)
  assert.deepEqual(plan, {
    donorId: null,
    donorKind: null,
    donorName: null,
    donorIdentityNumber: null,
    kind: 'cash',
    amountCents: 250_000,
    method: 'cash',
    bankAccountId: null,
    reference: null,
    description: null,
    declaredValueCents: null,
    donatedOn: '2026-10-01',
    note: null,
    taxNotice: null,
  })
  for (const status of ['draft', 'closed'] as const)
    assert.throws(
      () => planDonation({ ...OPEN, status }, null, context(), CASH),
      isDomainError('donation_campaign_not_open'),
    )
  assert.throws(
    () => planDonation(OPEN, null, context(), { ...CASH, donatedOn: '2026-10-07' }),
    isDomainError('donation_date_future'),
  )
  assert.throws(
    () => planDonation(OPEN, null, context(), { ...CASH, donatedOn: '2026-08-31' }),
    isDomainError('donation_date_outside_campaign'),
  )
  const inKind = planDonation(OPEN, DONOR, context(), {
    donorId: DONOR.id,
    kind: 'in_kind',
    donatedOn: TODAY,
    description: '50 adet kitap',
    declaredValueCents: 10_000,
  })
  assert.deepEqual(
    [
      inKind.amountCents,
      inKind.method,
      inKind.description,
      inKind.declaredValueCents,
      inKind.donorName,
    ],
    [null, null, '50 adet kitap', 10_000, 'Ayşe Yılmaz'],
  )
})

test('DOM-FIN-097: havale kampanyanın hesabını alır, hesap yoksa reddedilir; yabancı hesap 404', () => {
  const transfer = { ...CASH, method: 'bank_transfer' }
  assert.throws(
    () => planDonation(OPEN, null, context(), transfer),
    isDomainError('donation_bank_account_required'),
  )
  assert.equal(
    planDonation({ ...OPEN, bankAccountId: ACCOUNT }, null, context(), transfer).bankAccountId,
    ACCOUNT,
  )
  assert.equal(
    planDonation(OPEN, null, context(), { ...transfer, bankAccountId: ACCOUNT }).bankAccountId,
    ACCOUNT,
  )
  assert.throws(
    () =>
      planDonation(OPEN, null, context(), {
        ...transfer,
        bankAccountId: '1b7c1d2e-3f40-4a51-8b62-7c83d94ea5f6',
      }),
    isDomainError('bank_account_not_found', 'not_found'),
  )
  assert.equal(
    planDonation({ ...OPEN, bankAccountId: ACCOUNT }, null, context(), {
      ...CASH,
      method: 'card_slip',
    }).bankAccountId,
    null,
  )
})

test('DOM-FIN-097: vergi ibaresi yalnız ayar açıkken ve anonim olmayan bağışa kopyalanır (K-299)', () => {
  const named = { ...CASH, donorId: DONOR.id }
  assert.equal(planDonation(OPEN, DONOR, context(ON), named).taxNotice, ON.taxNoticeText)
  assert.equal(planDonation(OPEN, DONOR, context(OFF), named).taxNotice, null)
  assert.equal(planDonation(OPEN, null, context(ON), CASH).taxNotice, null)
  assert.equal(planDonation(OPEN, DONOR, context(ON), named).donorIdentityNumber, '10000000146')
  assert.deepEqual(donationSettingsSchema.parse({ taxNoticeEnabled: false, taxNoticeText: '' }), {
    taxNoticeEnabled: false,
    taxNoticeText: null,
  })
  assert.throws(
    () => donationSettingsSchema.parse({ taxNoticeEnabled: true, taxNoticeText: 'kısa' }),
    ZodError,
  )
})

test('DOM-FIN-097: iptal gerekçe ister, ikinci iptal reddedilir; makbuz numarası BM-<yıl>-<sıra> (K-297)', () => {
  assert.deepEqual(planDonationCancel({ cancelledAt: null }, { reason: ' Yanlış tutar ' }), {
    reason: 'Yanlış tutar',
  })
  assert.throws(() => planDonationCancel({ cancelledAt: null }, { reason: 'kısa' }), ZodError)
  assert.throws(
    () =>
      planDonationCancel({ cancelledAt: '2026-10-06T09:00:00.000Z' }, { reason: 'Yanlış tutar' }),
    isDomainError('donation_cancelled', 'conflict'),
  )
  assert.equal(donationReceiptLabel({ receiptYear: 2026, receiptNumber: 12 }), 'BM-2026-12')
})

test('DOM-FIN-097: döküm CSV kimliği maskeli verir, formül kaçar ve geçerli nakdi toplamı yazar (K-298)', () => {
  const base: DonationListRow = {
    donorKind: 'person',
    donorName: '=HYPERLINK("x")',
    maskedIdentityNumber: '*******0146',
    kind: 'cash',
    amountCents: 150_050,
    method: 'bank_transfer',
    reference: 'DK-1',
    description: null,
    declaredValueCents: null,
    donatedOn: '2026-10-01',
    receiptYear: 2026,
    receiptNumber: 1,
    cancelledAt: null,
    cancelReason: null,
  }
  const rows: DonationListRow[] = [
    base,
    {
      ...base,
      donorKind: null,
      donorName: null,
      maskedIdentityNumber: null,
      receiptNumber: 2,
      cancelledAt: '2026-10-02T09:00:00.000Z',
      cancelReason: 'Mükerrer',
    },
    {
      ...base,
      kind: 'in_kind',
      amountCents: null,
      method: null,
      reference: null,
      description: 'Kitap',
      declaredValueCents: 5_000,
      receiptNumber: 3,
    },
  ]
  const lines = donationsCsv({ name: 'Kütüphane' }, rows).split('\r\n')
  assert.equal(lines.length, 5)
  assert.equal(
    lines[1],
    '"Kütüphane";"BM-2026-1";"2026-10-01";"\'=HYPERLINK(""x"")";"*******0146";"Nakdi";"Banka havalesi / EFT";"DK-1";1500,50;"";"";"Geçerli";""',
  )
  assert.match(lines[2] ?? '', new RegExp(`"${ANONYMOUS_DONOR_LABEL}".*"İptal edildi";"Mükerrer"$`))
  assert.match(lines[3] ?? '', /"Ayni";"";"";"";"Kitap";50,00;"Geçerli"/)
  assert.match(lines[4] ?? '', /^"Kütüphane";"";"Toplam nakdi bağış";"";"";"";"";"";1500,50;/)
})
