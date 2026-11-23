import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  closeReasonError,
  contactText,
  meetingBody,
  meetingDefaults,
  meetingFormField,
  meetingFormSchema,
  mentorshipBody,
  mentorshipDefaults,
  mentorshipFormField,
  mentorshipFormSchema,
  onboardingOptions,
  overdueText,
  progressText,
  settingsBody,
} from '../src/pages/finance/finance-teacher-mentorship-forms.ts'

// Yeni öğretmen mentorluğu formları (DOM-FIN-136; ON-219). Kararlar K-463…K-465.

const TODAY = '2026-11-21'

test('DOM-FIN-136 K-463: eşleşme formu aynı kişiyi ve ters günleri alan altında reddeder', () => {
  const defaults = mentorshipDefaults(TODAY)
  assert.equal(defaults.endDate, '2027-05-20')
  const same = mentorshipFormSchema.safeParse({
    ...defaults,
    mentorMembershipId: 'm1',
    menteeMembershipId: 'm1',
    endDate: TODAY,
  })
  assert.equal(same.success, false)
  assert.deepEqual(
    same.error?.issues.map((issue) => issue.path.join('.')),
    ['menteeMembershipId', 'endDate'],
  )
  const empty = mentorshipFormSchema.safeParse(defaults)
  assert.equal(empty.success, false)
  const values = { ...defaults, mentorMembershipId: 'm1', menteeMembershipId: 'm2' }
  assert.equal(mentorshipFormSchema.safeParse(values).success, true)
  assert.deepEqual(mentorshipBody(values), {
    mentorMembershipId: 'm1',
    menteeMembershipId: 'm2',
    startDate: TODAY,
    endDate: '2027-05-20',
    onboardingOfferId: null,
  })
  assert.equal(mentorshipBody({ ...values, onboardingOfferId: 'o1' }).onboardingOfferId, 'o1')
  assert.equal(mentorshipFormField('endDate'), 'endDate')
  assert.equal(mentorshipFormField('institutionId'), undefined)
})

test('DOM-FIN-136 K-463: işe başlama listesi yalnız yeni öğretmenin hesabına bağlı teklifler', () => {
  const options = [
    { offerId: 'o1', membershipId: 'm2' },
    { offerId: 'o2', membershipId: 'm3' },
  ]
  assert.deepEqual(onboardingOptions(options, ''), [])
  assert.deepEqual(
    onboardingOptions(options, 'm2').map((option) => option.offerId),
    ['o1'],
  )
})

test('DOM-FIN-136 K-464: görüşme formu süreyi dakikaya çevirir, boş notu göndermez', () => {
  const defaults = meetingDefaults(TODAY)
  assert.equal(meetingFormSchema.safeParse(defaults).success, false)
  const values = { ...defaults, topic: ' Sınıf yönetimi ', duration: ' 30 ', nextStep: ' ' }
  assert.equal(meetingFormSchema.safeParse(values).success, true)
  assert.deepEqual(meetingBody(values), {
    meetingDate: TODAY,
    durationMinutes: 30,
    topic: 'Sınıf yönetimi',
    note: null,
    nextStep: null,
  })
  for (const duration of ['4', '481', '30,5', 'abc', ''])
    assert.equal(meetingFormSchema.safeParse({ ...values, duration }).success, false)
  assert.equal(meetingFormField('durationMinutes'), 'duration')
  assert.equal(meetingFormField('other'), undefined)
})

test('DOM-FIN-136 K-465: takip ve ilerleme metinleri sunucunun hesabını gösterir', () => {
  const base = { status: 'active' as const, lastMeetingDate: null, daysSinceContact: 0 }
  assert.equal(contactText({ ...base, overdue: false }), 'Görüşme yok')
  assert.equal(
    contactText({ ...base, lastMeetingDate: '2026-10-01', daysSinceContact: 51, overdue: true }),
    'Son görüşme 1 Eki 2026 · 51 gün',
  )
  assert.equal(
    contactText({
      status: 'completed',
      lastMeetingDate: '2026-10-01',
      daysSinceContact: null,
      overdue: false,
    }),
    'Son görüşme 1 Eki 2026',
  )
  assert.equal(overdueText({ overdue: true }), '30 günü aştı')
  assert.equal(overdueText({ overdue: false }), null)
  const progress = { total: 5, done: 3, requiredTotal: 4, requiredDone: 2, percent: 60 }
  assert.equal(progressText(progress), '3/5 madde · %60')
  assert.equal(progressText({ ...progress, total: 0, done: 0, percent: null }), 'Madde yok')
})

test('DOM-FIN-136 K-463: erken sonlandırma gerekçe ister, tamamlama istemez', () => {
  assert.equal(closeReasonError('complete', ''), null)
  assert.match(closeReasonError('end', ' kısa ') ?? '', /en az 5/)
  assert.match(closeReasonError('end', 'x'.repeat(501)) ?? '', /en çok 500/)
  assert.equal(closeReasonError('end', 'Kurumdan ayrıldı'), null)
})

test('DOM-FIN-136 K-463 K-465: ayar gövdesi boş satırı atar, sınırı ve yinelenen maddeyi denetler', () => {
  assert.deepEqual(
    settingsBody({
      maxActivePerMentor: ' 2 ',
      items: [
        { label: ' Tanışma ', required: true },
        { label: '', required: false },
      ],
    }),
    { body: { maxActivePerMentor: 2, checklistItems: [{ label: 'Tanışma', required: true }] } },
  )
  for (const load of ['0', '11', 'iki', ''])
    assert.ok('error' in settingsBody({ maxActivePerMentor: load, items: [] }))
  assert.deepEqual(
    settingsBody({
      maxActivePerMentor: '3',
      items: [
        { label: 'Tanışma', required: true },
        { label: 'TANIŞMA', required: false },
      ],
    }),
    { error: 'Aynı madde iki kez yazılamaz.' },
  )
  assert.ok(
    'error' in settingsBody({ maxActivePerMentor: '3', items: [{ label: 'a', required: true }] }),
  )
  assert.ok(
    'error' in
      settingsBody({
        maxActivePerMentor: '3',
        items: Array.from({ length: 21 }, (_, index) => ({
          label: `Madde ${String(index)}`,
          required: true,
        })),
      }),
  )
})
