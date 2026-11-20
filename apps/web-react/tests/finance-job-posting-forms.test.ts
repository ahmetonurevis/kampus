import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applicationCountText,
  jobApplicationBody,
  jobApplicationDefaults,
  jobApplicationEditBody,
  jobApplicationFormField,
  jobApplicationFormSchema,
  jobPostingBody,
  jobPostingDefaults,
  jobPostingFormField,
  jobPostingFormSchema,
  jobSettingsBody,
  jobSettingsDefaults,
  jobSettingsFormSchema,
  nextStages,
  postingStatusBadge,
  retentionText,
} from '../src/pages/finance/finance-job-posting-forms.ts'

// İş ilanları sekmesinin saf mantığı (DOM-FIN-128; ON-177; K-439…K-441).

test('DOM-FIN-128: yeni ilan formu bugünden 30 gün açık; nitelik boşsa null (K-439)', () => {
  const values = jobPostingDefaults('2026-10-06', null)
  assert.equal(values.publishOn, '2026-10-06')
  assert.equal(values.deadlineOn, '2026-11-05')
  const filled = {
    ...values,
    title: ' İngilizce öğretmeni ',
    position: 'İngilizce',
    description: 'Ortaokul İngilizce dersleri.',
    requirements: '  ',
  }
  assert.equal(jobPostingFormSchema.safeParse(filled).success, true)
  assert.deepEqual(jobPostingBody(filled), {
    title: 'İngilizce öğretmeni',
    position: 'İngilizce',
    employmentType: 'full_time',
    description: 'Ortaokul İngilizce dersleri.',
    requirements: null,
    publishOn: '2026-10-06',
    deadlineOn: '2026-11-05',
  })
  const bad = jobPostingFormSchema.safeParse({ ...filled, deadlineOn: '2026-10-05' })
  assert.equal(bad.success, false)
  assert.deepEqual(bad.error?.issues[0]?.path, ['deadlineOn'])
  assert.equal(jobPostingFormField('deadlineOn'), 'deadlineOn')
  assert.equal(jobPostingFormField('status'), null)
})

test('DOM-FIN-128: başvuru formu iletişimden birini ve aydınlatma sürümünü ister (K-440)', () => {
  const values = jobApplicationDefaults('2026-10-06', 'p-1', 'v2')
  assert.equal(values.privacyNoticeVersion, 'v2')
  assert.equal(jobApplicationDefaults('2026-10-06', 'p-1', null).privacyNoticeVersion, '')
  const filled = { ...values, candidateName: 'Deniz Aday', phone: '0532 123 45 67' }
  assert.equal(jobApplicationFormSchema.safeParse(filled).success, true)
  assert.deepEqual(jobApplicationBody(filled, 'f-1'), {
    jobPostingId: 'p-1',
    candidateName: 'Deniz Aday',
    email: null,
    phone: '0532 123 45 67',
    channel: 'email',
    receivedOn: '2026-10-06',
    cvFileId: 'f-1',
    privacyNoticeVersion: 'v2',
    privacyNoticeShownOn: '2026-10-06',
    note: null,
  })
  const noContact = jobApplicationFormSchema.safeParse({ ...filled, phone: '' })
  assert.equal(noContact.success, false)
  assert.deepEqual(noContact.error?.issues[0]?.path, ['email'])
  assert.equal(
    jobApplicationFormSchema.safeParse({ ...filled, privacyNoticeVersion: ' ' }).success,
    false,
  )
  assert.equal(jobApplicationFormSchema.safeParse({ ...filled, phone: '123' }).success, false)
  assert.equal(jobApplicationFormField('privacyNoticeShownOn'), 'privacyNoticeShownOn')
  assert.equal(jobApplicationFormField('cvFileId'), null)
})

test('DOM-FIN-128: düzeltme yalnız değişen alanları gönderir', () => {
  const detail = { candidateName: 'Deniz Aday', email: 'deniz@ornek.com', phone: null, note: null }
  assert.equal(
    jobApplicationEditBody(detail, {
      candidateName: 'Deniz Aday',
      email: 'deniz@ornek.com',
      phone: '',
      note: '',
    }),
    null,
  )
  assert.deepEqual(
    jobApplicationEditBody(detail, {
      candidateName: 'Deniz Aday',
      email: 'Deniz@Ornek.com',
      phone: '0532 123 45 67',
      note: 'Referanslı',
    }),
    { phone: '05321234567', note: 'Referanslı' },
  )
})

test('DOM-FIN-128: aşama seçenekleri yalnız ileri ve ret; son aşamada boş (K-440)', () => {
  assert.deepEqual(nextStages('new'), ['screening', 'interview', 'offer', 'hired', 'rejected'])
  assert.deepEqual(nextStages('offer'), ['hired', 'rejected'])
  assert.deepEqual(nextStages('hired'), [])
  assert.deepEqual(nextStages('rejected'), [])
})

test('DOM-FIN-128: saklama ayarı 1–60 ay, yalnız değişen alanlar (K-441)', () => {
  const current = { retentionMonths: 12, privacyNoticeVersion: null }
  const values = jobSettingsDefaults(current)
  assert.deepEqual(values, { retentionMonths: '12', privacyNoticeVersion: '' })
  assert.equal(jobSettingsBody(current, values), null)
  assert.deepEqual(jobSettingsBody(current, { retentionMonths: '6', privacyNoticeVersion: 'v1' }), {
    retentionMonths: 6,
    privacyNoticeVersion: 'v1',
  })
  for (const retentionMonths of ['0', '61', '1.5', 'x'])
    assert.equal(
      jobSettingsFormSchema.safeParse({ retentionMonths, privacyNoticeVersion: '' }).success,
      false,
    )
})

test('DOM-FIN-128: ilan rozeti, başvuru sayısı ve saklama sonu metinleri', () => {
  assert.equal(
    postingStatusBadge({ status: 'published', deadlinePassed: true }).text,
    'Son başvuru geçti',
  )
  assert.equal(postingStatusBadge({ status: 'published', deadlinePassed: false }).text, 'Yayında')
  assert.equal(postingStatusBadge({ status: 'closed', deadlinePassed: false }).text, 'Kapandı')
  assert.equal(
    applicationCountText({ applicationCount: 0, openApplicationCount: 0 }),
    'Başvuru yok',
  )
  assert.equal(
    applicationCountText({ applicationCount: 3, openApplicationCount: 2 }),
    '3 başvuru · 2 süren',
  )
  assert.equal(retentionText(null), '—')
  assert.match(retentionText('2027-10-06'), /2027/)
})
