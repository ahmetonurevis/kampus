import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  JobOfferDetail,
  OnboardingStep,
} from '@kampus/react-shared/use-finance-staff-onboarding.ts'

import {
  offerBody,
  offerChanges,
  offerDefaults,
  offerFormField,
  offerFormSchema,
  offerValues,
  onboardingText,
  orientationBody,
  quickActionOf,
  stepMetaText,
} from '../src/pages/finance/finance-staff-onboarding-forms.ts'

// İş teklifi ve işe başlama listesi formları (DOM-FIN-121; ON-179).

const TODAY = '2026-10-06'
const values = (overrides: Record<string, unknown> = {}) => ({
  ...offerDefaults(TODAY),
  candidateName: ' Ayşe Aday ',
  candidateEmail: '',
  candidatePhone: '0532 111 22 33',
  position: 'İngilizce öğretmeni',
  amount: '45.000,50',
  ...overrides,
})
const step = (overrides: Partial<OnboardingStep> = {}): OnboardingStep => ({
  id: 's-1',
  kind: 'pay_rate',
  documentType: null,
  label: 'Ücret tanımı girildi',
  required: true,
  responsible: null,
  dueDate: '2026-11-02',
  completedOn: null,
  completedAt: null,
  note: null,
  evidence: { state: 'missing', detail: 'Yok', warning: null },
  ...overrides,
})
const offer = (overrides: Partial<JobOfferDetail> = {}): JobOfferDetail => ({
  id: 'o-1',
  name: 'Ayşe Aday',
  isStaff: false,
  position: 'İngilizce öğretmeni',
  staffRole: 'ogretmen',
  startDate: '2026-10-05',
  status: 'accepted',
  sentOn: '2026-10-01',
  acceptedOn: '2026-10-03',
  closedOn: null,
  onboarding: {
    state: 'open',
    total: 1,
    done: 0,
    requiredTotal: 1,
    requiredDone: 0,
    completedAt: null,
  },
  version: 3,
  membershipId: 'm-1',
  candidateName: 'Ayşe Aday',
  candidateEmail: null,
  candidatePhone: null,
  wageType: 'monthly_gross',
  offeredAmountCents: 4_500_050,
  currency: 'TRY',
  respondBy: null,
  note: null,
  closeReason: null,
  createdAt: '2026-09-30T09:00:00.000Z',
  member: null,
  steps: [],
  ...overrides,
})

test('DOM-FIN-121: teklif formu aday ya da personel ister; gövde kuruş ve boş alanlar null', () => {
  assert.equal(offerFormSchema.safeParse(values()).success, true)
  const missing = offerFormSchema.safeParse(values({ candidateName: ' ' }))
  assert.deepEqual(missing.error?.issues[0]?.path, ['candidateName'])
  const staff = offerFormSchema.safeParse(values({ candidateKind: 'staff' }))
  assert.deepEqual(staff.error?.issues[0]?.path, ['membershipId'])
  assert.equal(offerFormSchema.safeParse(values({ amount: '0' })).success, false)
  assert.deepEqual(offerBody(values()), {
    membershipId: null,
    candidateName: 'Ayşe Aday',
    candidateEmail: null,
    candidatePhone: '0532 111 22 33',
    position: 'İngilizce öğretmeni',
    staffRole: 'ogretmen',
    startDate: TODAY,
    wageType: 'monthly_gross',
    offeredAmountCents: 4_500_050,
    respondBy: null,
    note: null,
  })
  const internal = offerBody(values({ candidateKind: 'staff', membershipId: 'm-9' }))
  assert.equal(internal.membershipId, 'm-9')
  assert.equal(internal.candidateName, null)
  assert.equal(internal.candidatePhone, null)
  assert.equal(offerFormField('offeredAmountCents'), 'amount')
  assert.equal(offerFormField('bilinmeyen'), undefined)
})

test('DOM-FIN-121: taslak düzeltmesinde yalnız değişen alanlar gönderilir', () => {
  const draft = offer({ status: 'draft', membershipId: null, candidatePhone: '05321112233' })
  const form = offerValues(draft)
  assert.equal(form.amount, '45000,50')
  assert.deepEqual(offerChanges(draft, form), {})
  assert.deepEqual(offerChanges(draft, { ...form, position: 'Müdür' }), { position: 'Müdür' })
  // Personel teklifinde aday alanları gönderilmez.
  const staff = offer({ status: 'draft' })
  assert.deepEqual(offerChanges(staff, { ...offerValues(staff), candidateName: 'X' }), {})
})

test('DOM-FIN-121: liste ve adım metinleri', () => {
  assert.equal(onboardingText(offer()), '0/1 zorunlu adım')
  assert.equal(
    onboardingText(offer({ onboarding: { ...offer().onboarding, state: 'completed' } })),
    'Tamamlandı',
  )
  assert.equal(onboardingText(offer({ onboarding: { ...offer().onboarding, state: 'none' } })), '—')
  assert.equal(
    stepMetaText(
      step({
        required: false,
        responsible: { membershipId: 'm-2', name: 'Selin Kaya' },
        completedOn: '2026-10-06',
      }),
    ),
    'İsteğe bağlı · son gün 2 Kas 2026 · sorumlu Selin Kaya · tamamlandı 6 Eki 2026',
  )
  assert.deepEqual(
    orientationBody({
      steps: [
        { label: ' Bina turu ', required: true },
        { label: '  ', required: false },
      ],
    }),
    { orientationSteps: [{ label: 'Bina turu', required: true }] },
  )
})

test('DOM-FIN-121: K-412 hızlı işlem yalnız bağlı hesapta ve kaynak yokken', () => {
  assert.equal(quickActionOf(step(), offer(), TODAY), 'pay_rate')
  assert.equal(quickActionOf(step({ kind: 'seniority' }), offer(), TODAY), 'seniority')
  // Kıdem başlangıcı bugünden sonra girilemez.
  assert.equal(
    quickActionOf(step({ kind: 'seniority' }), offer({ startDate: '2026-11-02' }), TODAY),
    null,
  )
  assert.equal(quickActionOf(step(), offer({ membershipId: null }), TODAY), null)
  assert.equal(quickActionOf(step(), offer({ status: 'withdrawn' }), TODAY), null)
  assert.equal(
    quickActionOf(step({ evidence: { state: 'met', detail: '', warning: null } }), offer(), TODAY),
    null,
  )
  assert.equal(quickActionOf(step({ kind: 'orientation' }), offer(), TODAY), null)
})
