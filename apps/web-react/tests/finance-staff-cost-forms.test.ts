import assert from 'node:assert/strict'
import test from 'node:test'

import {
  allocationHoursText,
  allocationPeriodText,
  basisPointsToPercent,
  percentToBasisPoints,
  sharesText,
  staffCostAllocationBody,
  staffCostAllocationDefaults,
  staffCostAllocationFormSchema,
  staffCostFormField,
  type StaffCostAllocationFormValues,
} from '../src/pages/finance/finance-staff-cost-forms.ts'

// Personel maliyet ataması formu (DOM-FIN-104; K-332).

const LISE = '00000000-0000-4000-8000-000000000001'
const ORTA = '00000000-0000-4000-8000-000000000002'
const VALUES: StaffCostAllocationFormValues = {
  startMonth: '2026-09',
  shares: [
    { costCenterId: LISE, percent: '60' },
    { costCenterId: ORTA, percent: '40' },
  ],
  wageHours: '',
  extraLessonHours: '12',
  dutyHours: ' ',
}
const messages = (values: unknown) => {
  const result = staffCostAllocationFormSchema.safeParse(values)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

test('DOM-FIN-104: yüzde metni on binde bire çevrilir', () => {
  assert.equal(percentToBasisPoints('60'), 6000)
  assert.equal(percentToBasisPoints('33,33'), 3333)
  assert.equal(percentToBasisPoints('12.5'), 1250)
  assert.equal(percentToBasisPoints('0'), null)
  assert.equal(percentToBasisPoints('101'), null)
  assert.equal(percentToBasisPoints('%60'), null)
  assert.equal(basisPointsToPercent(3333), '33,33')
  assert.equal(basisPointsToPercent(10_000), '100')
})

test('DOM-FIN-104: form payların toplamını, tekil merkezi ve saati denetler; gövde kurulur (K-332)', () => {
  assert.deepEqual(messages(VALUES), [])
  assert.deepEqual(staffCostAllocationBody('m-1', VALUES), {
    membershipId: 'm-1',
    startMonth: '2026-09',
    shares: [
      { costCenterId: LISE, shareBasisPoints: 6000 },
      { costCenterId: ORTA, shareBasisPoints: 4000 },
    ],
    wageHours: null,
    extraLessonHours: 12,
    dutyHours: null,
  })
  assert.deepEqual(messages({ ...VALUES, shares: [{ costCenterId: LISE, percent: '60' }] }), [
    'Payların toplamı %100 olmalıdır (şu an %60).',
  ])
  assert.deepEqual(
    messages({
      ...VALUES,
      shares: [
        { costCenterId: LISE, percent: '50' },
        { costCenterId: LISE, percent: '50' },
      ],
    }),
    ['Bir maliyet merkezi atamada bir kez seçilir.'],
  )
  assert.deepEqual(messages({ ...VALUES, dutyHours: '301' }), [
    'Aylık nöbet saati 0 ile 300 arasında tam sayı olmalıdır.',
  ])
  assert.deepEqual(messages({ ...VALUES, shares: [{ costCenterId: '', percent: 'x' }] }), [
    'Maliyet merkezi seçin.',
    'Payı 60 ya da 33,33 biçiminde, 0 ile 100 arasında girin.',
  ])
})

test('DOM-FIN-104: varsayılan değerler bu ayki atamayı kopyalar; sunucu yolu forma eşlenir', () => {
  assert.deepEqual(staffCostAllocationDefaults('2026-10', null).shares, [
    { costCenterId: '', percent: '100' },
  ])
  const copied = staffCostAllocationDefaults('2026-10', {
    id: 'a',
    membershipId: 'm',
    startMonth: '2026-01',
    endMonth: null,
    shares: [
      { costCenterId: LISE, code: 'LISE', name: 'Lise', isActive: true, shareBasisPoints: 3333 },
    ],
    wageHours: 80,
    extraLessonHours: null,
    dutyHours: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    version: 1,
  })
  assert.deepEqual(copied, {
    startMonth: '2026-10',
    shares: [{ costCenterId: LISE, percent: '33,33' }],
    wageHours: '80',
    extraLessonHours: '',
    dutyHours: '4',
  })
  assert.equal(staffCostFormField('shares.1.shareBasisPoints'), 'shares.1.percent')
  assert.equal(staffCostFormField('shares.0.costCenterId'), 'shares.0.costCenterId')
  assert.equal(staffCostFormField('startMonth'), 'startMonth')
  assert.equal(staffCostFormField('membershipId'), null)
  assert.equal(staffCostFormField('shares'), null)
})

test('DOM-FIN-104: atama metinleri', () => {
  const allocation = {
    startMonth: '2026-01',
    endMonth: '2026-08',
    shares: [
      { costCenterId: LISE, code: 'LISE', name: 'Lise', isActive: true, shareBasisPoints: 6000 },
      {
        costCenterId: ORTA,
        code: 'ORTA',
        name: 'Ortaokul',
        isActive: true,
        shareBasisPoints: 4000,
      },
    ],
    wageHours: null,
    extraLessonHours: 12,
    dutyHours: 4,
  }
  assert.equal(sharesText(allocation), 'LISE %60 · ORTA %40')
  assert.equal(allocationPeriodText(allocation), 'Ocak 2026 – Ağustos 2026')
  assert.equal(
    allocationPeriodText({ startMonth: '2026-09', endMonth: null }),
    'Eylül 2026 itibarıyla, süresiz',
  )
  assert.equal(allocationPeriodText({ startMonth: '2026-09', endMonth: '2026-09' }), 'Eylül 2026')
  assert.equal(allocationHoursText(allocation), 'Ek ders 12 sa · Nöbet 4 sa')
  assert.equal(
    allocationHoursText({ wageHours: null, extraLessonHours: null, dutyHours: null }),
    '',
  )
})
