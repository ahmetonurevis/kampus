import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enrollmentFormToBody } from '@kampus/school-core/lib/enrollment.ts'
import { enrollmentServerError } from '../src/pages/crm/enrollment-form.ts'
import {
  awardablePrograms,
  parsePercentInput,
  programBody,
  programDefaults,
  programFormSchema,
  programValueLabel,
} from '../src/pages/finance/scholarship-forms.ts'

const VALID = {
  ...programDefaults(),
  name: 'Başarı Bursu',
  conditions: 'Sınav puanı 90 ve üstü.',
  terminationConditions: 'Disiplin cezası alan öğrencinin bursu kesilir.',
  percent: '25',
  capacity: '3',
}

test('DOM-FIN-025: oran yüzde olarak girilir, on binde birliğe çevrilir; aralık dışı reddedilir', () => {
  assert.equal(parsePercentInput('25'), 2500)
  assert.equal(parsePercentInput('12,5'), 1250)
  assert.equal(parsePercentInput('0,01'), 1)
  assert.equal(parsePercentInput('100'), 10_000)
  for (const bad of ['', '0', '100,01', '101', 'abc', '1,234'])
    assert.equal(parsePercentInput(bad), null, bad)
})

test('DOM-FIN-025: form seçilen miktar türünü doğrular; gövde yalnız onu taşır', () => {
  const percent = programFormSchema.parse(VALID)
  const body = programBody(percent, 2026)
  assert.equal(body.percentBasisPoints, 2500)
  assert.equal(body.amountCents, undefined)
  assert.equal(body.capacity, 3)
  assert.equal(body.academicYear, 2026)
  const amount = programFormSchema.parse({
    ...VALID,
    valueKind: 'amount',
    percent: '',
    amount: '1.000,50',
  })
  const amountBody = programBody(amount, 2026)
  assert.equal(amountBody.amountCents, 100_050)
  assert.equal(amountBody.percentBasisPoints, undefined)
  const pathsOf = (values: unknown) => {
    const parsed = programFormSchema.safeParse(values)
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path[0])
  }
  assert.deepEqual(pathsOf({ ...VALID, percent: '' }), ['percent'])
  assert.deepEqual(pathsOf({ ...VALID, valueKind: 'amount', amount: 'x' }), ['amount'])
  assert.deepEqual(pathsOf({ ...VALID, capacity: '0' }), ['capacity'])
  assert.deepEqual(pathsOf({ ...VALID, name: 'x' }), ['name'])
})

test('DOM-FIN-025: miktar etiketi oran ya da tutar gösterir', () => {
  assert.equal(programValueLabel({ percentBasisPoints: 2500, amountCents: null }), '%25')
  assert.equal(programValueLabel({ percentBasisPoints: 1250, amountCents: null }), '%12,5')
  assert.match(programValueLabel({ percentBasisPoints: null, amountCents: 100_000 }), /1\.000,00/)
})

test('DOM-FIN-025: kayıtta yalnız bildirilmiş ve kontenjanı dolmamış program seçilir', () => {
  const programs = [
    { id: 'a', notifiedDate: '2026-09-01', awardedCount: 0, capacity: 1 },
    { id: 'b', notifiedDate: null, awardedCount: 0, capacity: 1 },
    { id: 'c', notifiedDate: '2026-09-01', awardedCount: 1, capacity: 1 },
  ]
  assert.deepEqual(
    awardablePrograms(programs).map((item) => item.id),
    ['a'],
  )
})

test('DOM-FIN-025: kayıt gövdesi burs seçilmişse taşır; sunucu reddi ücret adımındaki alana döner', () => {
  const base = {
    classId: 'c1',
    installmentCount: '3',
    firstDueDate: '2026-11-15',
    lessonHours: '',
    discounts: [],
    extras: [],
    confirmOtherCampus: false,
    identityKind: 'tc',
    identityNumber: '10000000146',
    birthDate: '2013-03-01',
    guardianMode: 'new',
    guardianName: 'Veli Kişi',
    guardianPhone: '05559990001',
    relationship: 'mother',
    existingParentId: '',
    studentPhone: '',
    studentEmail: '',
  } as unknown as Parameters<typeof enrollmentFormToBody>[0]
  assert.equal(enrollmentFormToBody(base, 't1').scholarshipProgramId, undefined)
  assert.equal(
    enrollmentFormToBody({ ...base, scholarshipProgramId: '' }, 't1').scholarshipProgramId,
    undefined,
  )
  assert.equal(
    enrollmentFormToBody({ ...base, scholarshipProgramId: 'p1' }, 't1').scholarshipProgramId,
    'p1',
  )
  assert.deepEqual(
    enrollmentServerError('scholarshipProgramId', {
      type: 'scholarship_capacity_full',
      message: 'Dolu.',
    }),
    { field: 'scholarshipProgramId', step: 2, type: 'scholarship_capacity_full', message: 'Dolu.' },
  )
})
