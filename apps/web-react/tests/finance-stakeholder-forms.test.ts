import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  AgreementDetail,
  StakeholderDetail,
} from '@kampus/react-shared/use-finance-stakeholders.ts'
import {
  agreementBody,
  agreementChanges,
  agreementDefaults,
  agreementFormField,
  agreementFormSchema,
  contributionText,
  parseNoticeDays,
  parseTags,
  remainingText,
  stakeholderBody,
  stakeholderChanges,
  stakeholderDefaults,
  stakeholderFormField,
  stakeholderFormSchema,
  terminateFormSchema,
} from '../src/pages/finance/finance-stakeholder-forms.ts'

// ON-262 (DOM-FIN-102): paydaş ve sponsorluk anlaşması form modeli.

const TODAY = '2026-10-06'
const FILE = '6b0d3c1e-0a4e-4d8f-9a55-0b3e1c2d4f60'
const STAKEHOLDER: StakeholderDetail = {
  id: 'st-1',
  name: 'Mavi Holding',
  type: 'sponsor',
  taxNumber: null,
  contactName: 'Deniz Kara',
  contactEmail: 'deniz@mavi.com.tr',
  contactPhone: '05321234512',
  tags: ['bahar şenliği'],
  isActive: true,
  createdAt: '2026-10-01T09:00:00.000Z',
  version: 2,
}
const AGREEMENT: AgreementDetail = {
  id: 'ag-1',
  stakeholder: { id: 'st-1', name: 'Mavi Holding', type: 'sponsor' },
  subject: 'Bahar şenliği sponsorluğu',
  startDate: '2026-09-01',
  endDate: '2026-10-20',
  renewalNoticeDays: 30,
  contributionType: 'cash',
  contributionAmountCents: 15_000_050,
  contributionDescription: null,
  benefits: ['logo'],
  benefitNote: null,
  contractFileId: null,
  status: 'active',
  daysLeft: 14,
  noticeDate: '2026-09-20',
  renewalDue: true,
  terminationDate: null,
  contractFile: null,
  activatedAt: '2026-09-01T09:00:00.000Z',
  terminationReason: null,
  terminatedAt: null,
  createdAt: '2026-09-01T09:00:00.000Z',
  version: 3,
}

test('DOM-FIN-102: etiketler virgülle ayrılır, sadeleşir ve tekilleşir', () => {
  assert.deepEqual(parseTags(' Bahar  Şenliği, bahar şenliği,, İzmir '), ['bahar şenliği', 'izmir'])
  assert.deepEqual(parseTags(''), [])
})

test('DOM-FIN-102: paydaş formu; isteğe bağlı alanlar boşsa null, düzeltmede yalnız değişenler', () => {
  const values = stakeholderDefaults()
  assert.equal(values.type, 'sponsor')
  assert.equal(stakeholderFormSchema.safeParse({ ...values, name: 'Mavi Holding' }).success, true)
  for (const field of [
    { taxNumber: '1111111115' },
    { contactPhone: '5321234512' },
    { contactEmail: 'deniz' },
    { tags: 'a' },
    { tags: Array.from({ length: 11 }, (_, i) => `etiket ${String(i)}`).join(',') },
  ])
    assert.equal(
      stakeholderFormSchema.safeParse({ ...values, name: 'Mavi', ...field }).success,
      false,
      JSON.stringify(field),
    )
  assert.deepEqual(stakeholderBody({ ...values, name: ' Mavi ', tags: 'Bilim, bilim' }), {
    name: 'Mavi',
    type: 'sponsor',
    taxNumber: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    tags: ['bilim'],
  })
  const edited = { ...stakeholderDefaults(STAKEHOLDER), contactPhone: '', tags: 'bahar şenliği' }
  assert.deepEqual(stakeholderChanges(edited, STAKEHOLDER), { contactPhone: null })
  assert.deepEqual(stakeholderChanges(stakeholderDefaults(STAKEHOLDER), STAKEHOLDER), {})
  assert.equal(stakeholderFormField('tags.0'), 'tags')
  assert.equal(stakeholderFormField('bilinmeyen'), undefined)
})

test('DOM-FIN-102: anlaşma formu; nakdide tutar, ayni ve hizmette açıklama, tarih sırası', () => {
  const values = agreementDefaults(TODAY)
  assert.equal(values.startDate, TODAY)
  assert.equal(values.endDate, '2027-10-06')
  assert.equal(values.renewalNoticeDays, '30')
  const ok = { ...values, subject: 'Bahar şenliği', amount: '1.500,50' }
  assert.equal(agreementFormSchema.safeParse(ok).success, true)
  const issues = (input: object) =>
    agreementFormSchema.safeParse(input).error?.issues.map((issue) => issue.path.join('.')) ?? []
  assert.deepEqual(issues({ ...ok, amount: '' }), ['amount'])
  assert.deepEqual(issues({ ...ok, amount: 'abc' }), ['amount'])
  assert.deepEqual(issues({ ...ok, endDate: '2026-01-01' }), ['endDate'])
  assert.deepEqual(issues({ ...ok, contributionType: 'in_kind', amount: '' }), [
    'contributionDescription',
  ])
  assert.deepEqual(issues({ ...ok, renewalNoticeDays: '400' }), ['renewalNoticeDays'])
  assert.equal(parseNoticeDays('0'), 0)
  assert.equal(parseNoticeDays('1.5'), null)

  assert.deepEqual(agreementBody(ok, FILE), {
    subject: 'Bahar şenliği',
    startDate: TODAY,
    endDate: '2027-10-06',
    renewalNoticeDays: 30,
    contributionType: 'cash',
    contributionAmountCents: 150_050,
    contributionDescription: null,
    benefits: [],
    benefitNote: null,
    contractFileId: FILE,
  })
  const edit = agreementDefaults(TODAY, AGREEMENT)
  assert.equal(edit.amount, '150000,50')
  assert.deepEqual(agreementChanges(edit, null, AGREEMENT, TODAY), {})
  assert.deepEqual(agreementChanges({ ...edit, endDate: '2027-06-30' }, FILE, AGREEMENT, TODAY), {
    endDate: '2027-06-30',
    contractFileId: FILE,
  })
  assert.equal(agreementFormField('contributionAmountCents'), 'amount')
  assert.equal(agreementFormField('subject'), 'subject')
  assert.equal(
    terminateFormSchema.safeParse({ terminationDate: TODAY, reason: 'kısa' }).success,
    false,
  )
})

test('DOM-FIN-102: kalan gün ve katkı metni', () => {
  assert.equal(remainingText({ daysLeft: 14 }), '14 gün kaldı')
  assert.equal(remainingText({ daysLeft: 0 }), 'Bugün bitiyor')
  assert.equal(remainingText({ daysLeft: null }), '')
  assert.equal(contributionText(AGREEMENT), 'Nakdi · 150.000,50 ₺')
  assert.equal(
    contributionText({
      contributionType: 'service',
      contributionAmountCents: null,
      contributionDescription: 'Robotik eğitmenliği',
    }),
    'Hizmet · Robotik eğitmenliği',
  )
})
