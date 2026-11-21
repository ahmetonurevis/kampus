import assert from 'node:assert/strict'
import test from 'node:test'

import type { HealthScreeningStudentRow } from '@kampus/react-shared/use-finance-health-screenings.ts'

import {
  classesText,
  draftOf,
  draftThreshold,
  entryPlan,
  measurementText,
  parseDecimal,
  referralCellText,
  screeningCreateBody,
  screeningDefaults,
  screeningFormField,
  screeningFormSchema,
  sessionStatusBadge,
  thresholdText,
} from '../src/pages/finance/finance-health-screening-forms.ts'

// Sağlık taramaları sekmesinin saf mantığı (DOM-FIN-153; ON-163; K-514…K-516).

const NOW = new Date('2026-10-06T09:00:00.000Z')

const student = (
  result: HealthScreeningStudentRow['result'] = null,
): HealthScreeningStudentRow => ({
  studentId: 's-1',
  studentName: 'Deniz Yılmaz',
  classId: '9-A',
  className: '9-A',
  inTargetClass: true,
  result,
})
const growthResult = (extra: Partial<NonNullable<HealthScreeningStudentRow['result']>> = {}) => ({
  id: 'r-1',
  outcome: 'screened' as const,
  measurement: { kind: 'growth' as const, heightCm: 150, weightKg: 30, bmi: 13.3 },
  referralRecommended: true,
  thresholdExceeded: true,
  note: 'Beslenme',
  notificationStatus: null,
  recordedByUserId: 'u-1',
  recordedByName: 'Ön Büro',
  updatedAt: NOW.toISOString(),
  version: 2,
  ...extra,
})

test('DOM-FIN-153: ondalık virgülle de girilir; metinler Türkçe biçimde', () => {
  assert.equal(parseDecimal('142,5'), 142.5)
  assert.equal(parseDecimal(' 38.2 '), 38.2)
  assert.equal(parseDecimal(''), null)
  assert.equal(parseDecimal('12a'), null)
  assert.equal(
    measurementText({ kind: 'growth', heightCm: 142.5, weightKg: 38.2, bmi: 18.8 }),
    '142,5 cm · 38,2 kg · BKİ 18,8',
  )
  assert.equal(
    measurementText({ kind: 'vision', rightAcuity: 1, leftAcuity: 0.7, wearsGlasses: true }),
    'Sağ 1 · Sol 0,7 · gözlüklü',
  )
  assert.equal(measurementText(null), '—')
  assert.equal(thresholdText({ bmiBelow: 14, bmiAbove: 25.5 }), 'BKİ < 14 ya da > 25,5')
  assert.equal(thresholdText({ bmiBelow: null, bmiAbove: null }), 'Eşik yok')
  assert.equal(thresholdText({ acuityBelow: 0.8 }), 'Görme < 0,8')
  assert.equal(thresholdText({ acuityBelow: null }), 'Eşik yok')
  assert.equal(referralCellText(null), 'Gizli (küçük grup)')
  assert.equal(referralCellText(0), '0')
  assert.deepEqual(sessionStatusBadge({ status: 'published' }), {
    text: 'Yayımlandı',
    tone: 'green',
  })
  assert.equal(sessionStatusBadge({ status: 'open' }).tone, 'amber')
  assert.equal(
    classesText({
      classes: [
        { id: '9-A', name: '9-A' },
        { id: '9-B', name: '9-B' },
      ],
    }),
    '9-A, 9-B',
  )
})

test('DOM-FIN-153: oturum formu gövdesi türe göre eşik taşır; core iletisi alana düşer (K-514)', () => {
  const values = { ...screeningDefaults(NOW), classIds: ['9-A'], performerName: ' ASM ' }
  assert.equal(values.screenedOn, '2026-10-06')
  assert.equal(screeningFormSchema.safeParse(values).success, true)
  assert.deepEqual(screeningCreateBody({ ...values, bmiBelow: '14,5' }), {
    kind: 'growth',
    screenedOn: '2026-10-06',
    classIds: ['9-A'],
    performer: { kind: 'external', name: 'ASM' },
    thresholds: { bmiBelow: 14.5, bmiAbove: null },
  })
  assert.deepEqual(
    screeningCreateBody({
      ...values,
      kind: 'vision',
      acuityBelow: '0,8',
      performerKind: 'staff',
      performerMembershipId: 'm-1',
    }),
    {
      kind: 'vision',
      screenedOn: '2026-10-06',
      classIds: ['9-A'],
      performer: { kind: 'staff', membershipId: 'm-1' },
      thresholds: { acuityBelow: 0.8 },
    },
  )
  const noClass = screeningFormSchema.safeParse({ ...values, classIds: [] })
  assert.equal(noClass.success, false)
  const badThreshold = screeningFormSchema.safeParse({ ...values, bmiBelow: '30', bmiAbove: '20' })
  assert.equal(badThreshold.success, false)
  assert.deepEqual(badThreshold.error?.issues[0]?.path, ['bmiBelow'])
  const noName = screeningFormSchema.safeParse({ ...values, performerName: '' })
  assert.deepEqual(noName.error?.issues[0]?.path, ['performerName'])
  assert.equal(screeningFormField('classIds.1'), 'classIds')
  assert.equal(screeningFormField('performer.membershipId'), 'performerMembershipId')
  assert.equal(screeningFormField('thresholds.acuityBelow'), 'acuityBelow')
  assert.equal(screeningFormField('thresholds'), 'bmiBelow')
  assert.equal(screeningFormField('unknown'), null)
})

test('DOM-FIN-153: hızlı giriş satırı; boş ve değişmeyen gönderilmez, düzeltme sürümle (K-514)', () => {
  const empty = student()
  assert.deepEqual(entryPlan('growth', empty, draftOf(empty)), { status: 'unchanged' })
  assert.deepEqual(
    entryPlan('growth', empty, { ...draftOf(empty), outcome: 'screened', first: '150' }),
    { status: 'invalid', message: 'Boy ve kiloyu girin.' },
  )
  assert.deepEqual(entryPlan('growth', empty, { ...draftOf(empty), note: 'x' }), {
    status: 'invalid',
    message: 'Durumu seçin.',
  })
  assert.deepEqual(
    entryPlan('growth', empty, {
      ...draftOf(empty),
      outcome: 'screened',
      first: '150,25',
      second: '40',
    }),
    { status: 'invalid', message: 'Boy en çok 1 ondalık basamak alır.' },
  )
  assert.deepEqual(
    entryPlan('growth', empty, {
      ...draftOf(empty),
      outcome: 'screened',
      first: '150,5',
      second: '40',
      note: '  ',
    }),
    {
      status: 'ready',
      item: {
        studentId: 's-1',
        expectedVersion: null,
        outcome: 'screened',
        measurement: { heightCm: 150.5, weightKg: 40 },
        referralRecommended: false,
        note: null,
      },
    },
  )
  assert.deepEqual(
    entryPlan('vision', empty, {
      ...draftOf(empty),
      outcome: 'screened',
      first: '1',
      second: '0,7',
      wearsGlasses: true,
      referral: true,
    }),
    {
      status: 'ready',
      item: {
        studentId: 's-1',
        expectedVersion: null,
        outcome: 'screened',
        measurement: { rightAcuity: 1, leftAcuity: 0.7, wearsGlasses: true },
        referralRecommended: true,
        note: null,
      },
    },
  )
  assert.equal(
    entryPlan('vision', empty, { ...draftOf(empty), outcome: 'screened', first: '1' }).status,
    'invalid',
  )
  const absent = entryPlan('growth', empty, {
    ...draftOf(empty),
    outcome: 'absent',
    first: '150',
    referral: true,
  })
  assert.deepEqual(absent.status === 'ready' && absent.item.measurement, null)
  assert.equal(absent.status === 'ready' && absent.item.referralRecommended, false)

  const saved = student(growthResult())
  const draft = draftOf(saved)
  assert.deepEqual(draft, {
    outcome: 'screened',
    first: '150',
    second: '30',
    wearsGlasses: false,
    referral: false,
    note: 'Beslenme',
  })
  assert.deepEqual(entryPlan('growth', saved, draft), { status: 'unchanged' })
  const corrected = entryPlan('growth', saved, { ...draft, second: '45' })
  assert.equal(corrected.status === 'ready' && corrected.item.expectedVersion, 2)
  const manual = draftOf(student(growthResult({ thresholdExceeded: false })))
  assert.equal(manual.referral, true)
  const vision = draftOf(
    student(
      growthResult({
        measurement: { kind: 'vision', rightAcuity: 0.5, leftAcuity: 1, wearsGlasses: true },
      }),
    ),
  )
  assert.deepEqual([vision.first, vision.second, vision.wearsGlasses], ['0,5', '1', true])
  const refused = draftOf(student(growthResult({ outcome: 'refused', measurement: null })))
  assert.deepEqual([refused.first, refused.second], ['', ''])
})

test('DOM-FIN-153: taslakta eşik sunucuyla aynı kuralla gösterilir (K-514)', () => {
  const draft = { ...draftOf(student()), outcome: 'screened' as const, first: '150', second: '30' }
  assert.equal(draftThreshold('growth', { bmiBelow: 14, bmiAbove: null }, draft), true)
  assert.equal(draftThreshold('growth', { bmiBelow: 13, bmiAbove: null }, draft), false)
  assert.equal(
    draftThreshold('growth', { bmiBelow: 14, bmiAbove: null }, { ...draft, second: '' }),
    false,
  )
  assert.equal(
    draftThreshold('growth', { bmiBelow: 14, bmiAbove: null }, { ...draft, outcome: 'absent' }),
    false,
  )
  assert.equal(
    draftThreshold('vision', { acuityBelow: 0.8 }, { ...draft, first: '1', second: '0,7' }),
    true,
  )
})
