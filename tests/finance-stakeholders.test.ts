import assert from 'node:assert/strict'
import test from 'node:test'

import {
  agreementSchedule,
  assertStakeholderTaxNumberFree,
  canManageStakeholders,
  checkAgreementTerms,
  contributionSummary,
  maskStakeholderContact,
  normalizeStakeholderTag,
  planStakeholderAgreement,
  planStakeholderAgreementActivate,
  planStakeholderAgreementArchive,
  planStakeholderAgreementTerminate,
  planStakeholderAgreementUpdate,
  planStakeholderUpdate,
  stakeholderAgreementSchema,
  stakeholderAgreementsCsv,
  stakeholderSchema,
  stakeholdersCsv,
  terminateStakeholderAgreementSchema,
  updateStakeholderAgreementSchema,
  updateStakeholderSchema,
  type StakeholderAgreementInput,
} from '../packages/school-core/src/lib/finance-stakeholders.ts'

import { isDomainError } from './support/domain-error.ts'

// Paydaş ve sponsor kaydı (DOM-FIN-102; ON-262). Bugün 2026-10-06 (Europe/Istanbul).

const TODAY = '2026-10-06'
const VKN = '1111111114'
const AGREEMENT: StakeholderAgreementInput = {
  subject: 'Bahar şenliği sponsorluğu',
  startDate: '2026-09-01',
  endDate: '2027-06-30',
  contributionType: 'cash',
  contributionAmountCents: 15_000_000,
}
const money = (cents: number) => `${String(cents / 100)} TL`

test('DOM-FIN-102: yalnız yönetici paydaş kaydını yönetir (K-317)', () => {
  assert.equal(canManageStakeholders('yonetici'), true)
  for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'])
    assert.equal(canManageStakeholders(role), false)
})

test('DOM-FIN-102: paydaş şeması; VKN, iletişim ve etiketler isteğe bağlı, etiketler sadeleşir (K-316)', () => {
  const minimal = stakeholderSchema.parse({ name: ' Mavi Holding ', type: 'sponsor' })
  assert.deepEqual(minimal, {
    name: 'Mavi Holding',
    type: 'sponsor',
    taxNumber: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    tags: [],
  })
  const full = stakeholderSchema.parse({
    name: 'Ege Üniversitesi',
    type: 'university',
    taxNumber: VKN,
    contactName: 'Deniz Kara',
    contactEmail: 'deniz@ege.edu.tr',
    contactPhone: '05321234512',
    tags: ['  Bilim  Şenliği ', 'bilim şenliği', 'İzmir'],
  })
  assert.deepEqual(full.tags, ['bilim şenliği', 'izmir'])
  assert.equal(normalizeStakeholderTag('  YAZ   Okulu '), 'yaz okulu')
})

test('DOM-FIN-102: paydaş şemasında doğrulama hataları', () => {
  const bad = [
    { name: 'A', type: 'sponsor' },
    { name: 'Mavi', type: 'supplier' },
    { name: 'Mavi', type: 'sponsor', taxNumber: '123' },
    { name: 'Mavi', type: 'sponsor', taxNumber: '1111111115' },
    { name: 'Mavi', type: 'sponsor', contactPhone: '5321234512' },
    { name: 'Mavi', type: 'sponsor', contactEmail: 'deniz' },
    { name: 'Mavi', type: 'sponsor', tags: ['a'] },
    {
      name: 'Mavi',
      type: 'sponsor',
      tags: Array.from({ length: 11 }, (_, i) => `etiket ${String(i)}`),
    },
    { name: 'Mavi', type: 'sponsor', institutionId: 'baska' },
  ]
  for (const input of bad)
    assert.equal(stakeholderSchema.safeParse(input).success, false, JSON.stringify(input))
  assert.equal(updateStakeholderSchema.safeParse({}).success, false)
  assert.equal(updateStakeholderSchema.safeParse({ isActive: false }).success, true)
})

test('DOM-FIN-102: VKN tekilliği 409, düzeltmede yalnız değişen alanlar (K-316)', () => {
  assert.throws(
    () => assertStakeholderTaxNumberFree(true),
    isDomainError('stakeholder_tax_number_exists', 'conflict'),
  )
  assert.doesNotThrow(() => assertStakeholderTaxNumberFree(false))
  const current = {
    ...stakeholderSchema.parse({ name: 'Mavi Holding', type: 'sponsor', tags: ['bahar'] }),
    isActive: true,
  }
  assert.deepEqual(
    planStakeholderUpdate(
      current,
      updateStakeholderSchema.parse({ name: 'Mavi Holding', isActive: false }),
    ),
    ['isActive'],
  )
  assert.throws(
    () => planStakeholderUpdate(current, updateStakeholderSchema.parse({ tags: ['Bahar'] })),
    isDomainError('stakeholder_unchanged'),
  )
})

test('DOM-FIN-102: listede e-posta ve telefon maskelidir (K-317)', () => {
  assert.deepEqual(
    maskStakeholderContact({ contactEmail: 'deniz@ege.edu.tr', contactPhone: '05321234512' }),
    {
      contactEmail: 'd***@ege.edu.tr',
      contactPhone: '0532 *** ** 12',
    },
  )
  assert.deepEqual(maskStakeholderContact({ contactEmail: null, contactPhone: null }), {
    contactEmail: null,
    contactPhone: null,
  })
})

test('DOM-FIN-102: anlaşma şeması varsayılanları ve karşılıkların sırası', () => {
  const parsed = stakeholderAgreementSchema.parse({
    ...AGREEMENT,
    benefits: ['event_naming', 'logo', 'logo'],
    benefitNote: ' Mavi Bahar Şenliği ',
    contributionDescription: '',
  })
  assert.equal(parsed.renewalNoticeDays, 30)
  assert.deepEqual(parsed.benefits, ['logo', 'event_naming'])
  assert.equal(parsed.benefitNote, 'Mavi Bahar Şenliği')
  assert.equal(parsed.contributionDescription, null)
  assert.equal(parsed.contractFileId, null)
  for (const input of [
    { ...AGREEMENT, subject: 'ab' },
    { ...AGREEMENT, startDate: '2026-02-30' },
    { ...AGREEMENT, renewalNoticeDays: 366 },
    { ...AGREEMENT, renewalNoticeDays: 1.5 },
    { ...AGREEMENT, contributionAmountCents: 0 },
    { ...AGREEMENT, contributionAmountCents: 12.5 },
    { ...AGREEMENT, contributionType: 'loan' },
    { ...AGREEMENT, benefits: ['billboard'] },
    { ...AGREEMENT, contractFileId: 'dosya' },
    { ...AGREEMENT, status: 'active' },
  ])
    assert.equal(stakeholderAgreementSchema.safeParse(input).success, false, JSON.stringify(input))
  assert.equal(updateStakeholderAgreementSchema.safeParse({}).success, false)
  assert.equal(
    terminateStakeholderAgreementSchema.safeParse({ terminationDate: TODAY, reason: 'kısa' })
      .success,
    false,
  )
})

test('DOM-FIN-102: tarih ve katkı uyumu 422; ayni ve hizmette açıklama, nakdide tutar', () => {
  const base = stakeholderAgreementSchema.parse(AGREEMENT)
  assert.throws(
    () => checkAgreementTerms({ ...base, endDate: '2026-08-31' }),
    isDomainError('stakeholder_agreement_dates_invalid'),
  )
  assert.doesNotThrow(() => checkAgreementTerms({ ...base, endDate: base.startDate }))
  assert.throws(
    () => checkAgreementTerms({ ...base, contributionAmountCents: null }),
    isDomainError('stakeholder_agreement_amount_required'),
  )
  assert.throws(
    () =>
      checkAgreementTerms({ ...base, contributionType: 'in_kind', contributionAmountCents: null }),
    isDomainError('stakeholder_agreement_description_required'),
  )
  assert.doesNotThrow(() =>
    checkAgreementTerms({
      ...base,
      contributionType: 'service',
      contributionAmountCents: null,
      contributionDescription: 'Yaz okulu eğitmenliği',
    }),
  )
})

test('DOM-FIN-102: pasif paydaşla anlaşma açılmaz ve yürürlüğe alınmaz (K-316)', () => {
  const input = stakeholderAgreementSchema.parse(AGREEMENT)
  assert.throws(
    () => planStakeholderAgreement(input, { isActive: false }),
    isDomainError('stakeholder_inactive'),
  )
  assert.deepEqual(planStakeholderAgreement(input, { isActive: true }), input)
  assert.throws(
    () => planStakeholderAgreementActivate({ status: 'draft' }, { isActive: false }),
    isDomainError('stakeholder_inactive'),
  )
  assert.doesNotThrow(() =>
    planStakeholderAgreementActivate({ status: 'draft' }, { isActive: true }),
  )
  for (const status of ['active', 'terminated'] as const)
    assert.throws(
      () => planStakeholderAgreementActivate({ status }, { isActive: true }),
      isDomainError('stakeholder_agreement_not_draft'),
    )
})

test('DOM-FIN-102: anlaşma düzeltmesi birleşik değerle denetlenir; feshedilmiş değişmez (K-318)', () => {
  const current = { ...stakeholderAgreementSchema.parse(AGREEMENT), status: 'active' as const }
  assert.deepEqual(
    planStakeholderAgreementUpdate(
      current,
      updateStakeholderAgreementSchema.parse({ endDate: '2027-08-31', subject: AGREEMENT.subject }),
    ),
    ['endDate'],
  )
  assert.throws(
    () =>
      planStakeholderAgreementUpdate(
        current,
        updateStakeholderAgreementSchema.parse({ endDate: '2026-01-01' }),
      ),
    isDomainError('stakeholder_agreement_dates_invalid'),
  )
  assert.throws(
    () =>
      planStakeholderAgreementUpdate(
        current,
        updateStakeholderAgreementSchema.parse({ contributionType: 'in_kind' }),
      ),
    isDomainError('stakeholder_agreement_description_required'),
  )
  assert.throws(
    () =>
      planStakeholderAgreementUpdate(
        current,
        updateStakeholderAgreementSchema.parse({ subject: AGREEMENT.subject }),
      ),
    isDomainError('stakeholder_agreement_unchanged'),
  )
  assert.throws(
    () =>
      planStakeholderAgreementUpdate(
        { ...current, status: 'terminated' },
        updateStakeholderAgreementSchema.parse({ subject: 'Yeni konu' }),
      ),
    isDomainError('stakeholder_agreement_terminated'),
  )
})

test('DOM-FIN-102: fesih yalnız yürürlükteki, bitmemiş anlaşmada ve dönem içinde (K-318)', () => {
  const active = { status: 'active' as const, startDate: '2026-09-01', endDate: '2027-06-30' }
  assert.doesNotThrow(() =>
    planStakeholderAgreementTerminate(active, { terminationDate: TODAY }, TODAY),
  )
  assert.doesNotThrow(() =>
    planStakeholderAgreementTerminate(active, { terminationDate: '2027-06-30' }, TODAY),
  )
  assert.throws(
    () => planStakeholderAgreementTerminate(active, { terminationDate: '2026-08-31' }, TODAY),
    isDomainError('stakeholder_agreement_termination_date_invalid'),
  )
  assert.throws(
    () => planStakeholderAgreementTerminate(active, { terminationDate: '2027-07-01' }, TODAY),
    isDomainError('stakeholder_agreement_termination_date_invalid'),
  )
  assert.throws(
    () =>
      planStakeholderAgreementTerminate(
        { ...active, endDate: '2026-10-05' },
        { terminationDate: TODAY },
        TODAY,
      ),
    isDomainError('stakeholder_agreement_ended'),
  )
  assert.throws(
    () =>
      planStakeholderAgreementTerminate(
        { ...active, status: 'draft' },
        { terminationDate: TODAY },
        TODAY,
      ),
    isDomainError('stakeholder_agreement_not_active'),
  )
  assert.throws(
    () =>
      planStakeholderAgreementTerminate(
        { ...active, status: 'terminated' },
        { terminationDate: TODAY },
        TODAY,
      ),
    isDomainError('stakeholder_agreement_terminated'),
  )
  assert.doesNotThrow(() => planStakeholderAgreementArchive({ status: 'draft' }))
  for (const status of ['active', 'terminated'] as const)
    assert.throws(
      () => planStakeholderAgreementArchive({ status }),
      isDomainError('stakeholder_agreement_not_draft'),
    )
})

test('DOM-FIN-102: durum ve yenileme uyarısı bugüne göre hesaplanır, bitiş günü dahil (K-318, K-319)', () => {
  const agreement = { status: 'active' as const, endDate: '2026-11-05', renewalNoticeDays: 30 }
  assert.deepEqual(agreementSchedule(agreement, TODAY), {
    status: 'active',
    daysLeft: 30,
    noticeDate: '2026-10-06',
    renewalDue: true,
  })
  assert.equal(agreementSchedule({ ...agreement, endDate: '2026-11-06' }, TODAY).renewalDue, false)
  assert.deepEqual(agreementSchedule({ ...agreement, endDate: TODAY }, TODAY), {
    status: 'active',
    daysLeft: 0,
    noticeDate: '2026-09-06',
    renewalDue: true,
  })
  assert.equal(
    agreementSchedule({ ...agreement, endDate: TODAY, renewalNoticeDays: 0 }, TODAY).renewalDue,
    true,
  )
  assert.deepEqual(agreementSchedule({ ...agreement, endDate: '2026-10-05' }, TODAY), {
    status: 'ended',
    daysLeft: null,
    noticeDate: null,
    renewalDue: false,
  })
  for (const status of ['draft', 'terminated'] as const)
    assert.deepEqual(agreementSchedule({ ...agreement, status }, TODAY), {
      status,
      daysLeft: null,
      noticeDate: null,
      renewalDue: false,
    })
})

test('DOM-FIN-102: katkı özeti ve CSV (formül kaçışı, iletişim yok)', () => {
  const cash = stakeholderAgreementSchema.parse(AGREEMENT)
  assert.equal(contributionSummary(cash, money), 'Nakdi · 150000 TL')
  assert.equal(
    contributionSummary(
      {
        contributionType: 'in_kind',
        contributionAmountCents: 4_000_000,
        contributionDescription: '40 tablet',
      },
      money,
    ),
    'Ayni · 40 tablet · tahmini 40000 TL',
  )
  assert.equal(
    contributionSummary(
      {
        contributionType: 'service',
        contributionAmountCents: null,
        contributionDescription: 'Eğitmen',
      },
      money,
    ),
    'Hizmet · Eğitmen',
  )
  const stakeholders = stakeholdersCsv([
    {
      name: '=Mavi Holding',
      type: 'sponsor',
      taxNumber: VKN,
      tags: ['bahar', 'izmir'],
      isActive: true,
      activeAgreementCount: 2,
      renewalDueCount: 1,
    },
  ])
  assert.equal(
    stakeholders,
    '"Paydaş";"Tür";"VKN";"Etiketler";"Durum";"Yürürlükteki anlaşma";"Yenileme uyarısı"\r\n' +
      `"'=Mavi Holding";"Sponsor";"${VKN}";"bahar, izmir";"Etkin";2;1\r\n`,
  )
  const agreements = stakeholderAgreementsCsv([
    {
      stakeholderName: 'Mavi Holding',
      stakeholderType: 'sponsor',
      subject: 'Bahar şenliği',
      startDate: '2026-09-01',
      endDate: '2027-06-30',
      renewalNoticeDays: 30,
      contributionType: 'cash',
      contributionAmountCents: 15_000_050,
      contributionDescription: null,
      benefits: ['logo', 'event_naming'],
      benefitNote: null,
      status: 'active',
      daysLeft: 267,
      terminationDate: null,
    },
  ])
  const [, line] = agreements.split('\r\n')
  assert.equal(
    line,
    '"Mavi Holding";"Sponsor";"Bahar şenliği";"2026-09-01";"2027-06-30";30;"Nakdi";150000,50;"";"Logo kullanımı, Etkinlik adı";"";"Yürürlükte";267;""',
  )
})
