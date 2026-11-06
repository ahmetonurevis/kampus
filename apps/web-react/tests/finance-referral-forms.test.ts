import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  enrollmentFormToBody,
  previewEnrollment,
  type EnrollmentFormValues,
} from '@kampus/school-core/lib/enrollment.ts'
import { enrollmentServerError, prospectChangeValues } from '../src/pages/crm/enrollment-form.ts'
import { referralOptionLabel } from '../src/pages/finance/referral-forms.ts'
import {
  renewalDefaults,
  renewalFieldFor,
  renewalQuoteBody,
} from '../src/pages/finance/renewal-forms.ts'

const NOW = '2026-10-06T09:00:00.000Z'
const REWARD_ID = '11111111-1111-4111-8111-111111111111'
const ENROLLMENT = {
  prospectId: 'pr1',
  classId: 'c1',
  identityKind: 'tc',
  identityNumber: '10000000146',
  birthDate: '2013-03-01',
  guardianMode: 'existing',
  guardianName: '',
  guardianPhone: '',
  relationship: 'mother',
  existingParentId: 'p3',
  studentPhone: '',
  studentEmail: '',
  lessonHours: '',
  discounts: ['referral'],
  referralRewardId: REWARD_ID,
  extras: [],
  installmentCount: '8',
  firstDueDate: '2026-11-15',
  allCampuses: false,
  confirmOtherCampus: false,
} as unknown as EnrollmentFormValues

test('DOM-FIN-024: kesin kayıt gövdesi hakkı yalnız referans kalemiyle gönderir', () => {
  assert.equal(enrollmentFormToBody(ENROLLMENT, 't1').referralRewardId, REWARD_ID)
  const withoutKind = enrollmentFormToBody({ ...ENROLLMENT, discounts: [] }, 't1')
  assert.equal('referralRewardId' in withoutKind, false)
  const empty = enrollmentFormToBody({ ...ENROLLMENT, referralRewardId: '' }, 't1')
  assert.equal('referralRewardId' in empty, false)
})

test('DOM-FIN-024: aday değişince seçili hak taşınmaz; sunucu hatası alanına yazılır', () => {
  assert.equal(prospectChangeValues('school', NOW).referralRewardId, '')
  const error = enrollmentServerError('referralRewardId', {
    type: 'referral_reward_used',
    message: 'Bu referans hakkı daha önce kullanılmış.',
  })
  assert.equal(error.field, 'referralRewardId')
  assert.equal(error.step, 2)
})

test('DOM-FIN-024, K-14: önizleme hakkın sabit tutarını gösterir, tavanı aşan kısmı düşürür, hak yokken reddeder', () => {
  const tariff = {
    id: 't1',
    versionNumber: 1,
    items: [
      {
        kind: 'tuition',
        level: null,
        amountCents: 1_000_000,
        unit: 'year',
        vatBasisPoints: 1000,
        vatEffectiveDate: '2026-01-01',
        announcedAmountCents: 1_000_000,
      },
    ],
    discounts: [{ kind: 'referral', percentBasisPoints: 1_000, amountCents: null }],
  } as Parameters<typeof previewEnrollment>[0]
  const options = { institutionType: 'school', level: '7' } as const
  const values = { lessonHours: '', discounts: ['referral'], extras: [] } as Pick<
    EnrollmentFormValues,
    'lessonHours' | 'discounts' | 'extras'
  >
  const fixed = previewEnrollment(tariff, values, { ...options, referralRewardCents: 250_000 })
  assert.equal(fixed.ok && fixed.price.netCents, 750_000)
  const trimmed = previewEnrollment(tariff, values, { ...options, referralRewardCents: 600_000 })
  assert.equal(trimmed.ok && trimmed.price.netCents, 500_000)
  assert.equal(previewEnrollment(tariff, values, options).ok, false)
})

test('DOM-FIN-024: yenileme gövdesi hakkı yalnız referans kalemiyle gönderir; hata alanına bağlanır', () => {
  const values = {
    ...renewalDefaults(),
    studentId: 's3',
    targetClassId: 'c1',
    discounts: ['referral' as const],
    referralRewardId: REWARD_ID,
  }
  assert.equal(renewalQuoteBody(values, 2027).referralRewardId, REWARD_ID)
  const without = renewalQuoteBody({ ...values, discounts: [] }, 2027)
  assert.equal('referralRewardId' in without, false)
  assert.equal(renewalFieldFor('referralRewardId'), 'referralRewardId')
})

test('DOM-FIN-024, K-14: seçenek metninde aday yok; değer hakkın sabit tutarı', () => {
  assert.match(
    referralOptionLabel({
      academicYear: 2026,
      referrerStudentName: 'Zeynep Demir',
      amountCents: 150_000,
    }),
    /^2026 · Zeynep Demir · .*1\.500,00/,
  )
  assert.match(
    referralOptionLabel({ academicYear: 2026, referrerStudentName: null, amountCents: 150_000 }),
    /Öğrenci/,
  )
})
