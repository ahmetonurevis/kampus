import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed } from '../packages/school-core/src/data/seed.ts'
import {
  assertRenewalWithinTariff,
  enrollmentFormSchema,
  enrollmentFormToBody,
  enrollProspectSchema,
  enrollProspectWithTariff,
  findParentMatches,
  isValidTurkishId,
  previewEnrollment,
  priceEnrollment,
  type EnrollmentContext,
  type EnrollmentTariff,
} from '../packages/school-core/src/lib/enrollment.ts'
import type { FeeItem } from '../packages/school-core/src/lib/fee-tariffs.ts'
import { isDomainError } from './support/domain-error.ts'

const NOW = '2026-10-06T09:00:00.000Z'
const item = (overrides: Partial<FeeItem>): FeeItem => ({
  kind: 'tuition',
  level: null,
  amountCents: 10_000_001,
  unit: 'year',
  vatBasisPoints: 1000,
  vatEffectiveDate: '2026-01-01',
  announcedAmountCents: null,
  ...overrides,
})
const TARIFF: EnrollmentTariff = {
  id: 'test-tariff',
  versionNumber: 2,
  items: [
    item({}),
    item({ level: '7', amountCents: 20_000_000 }),
    item({ kind: 'meal', amountCents: 1_000_000 }),
  ],
  discounts: [
    { kind: 'early_payment', percentBasisPoints: 1_000, amountCents: null },
    { kind: 'sibling', percentBasisPoints: 3_000, amountCents: null },
    { kind: 'referral', percentBasisPoints: 3_000, amountCents: null },
    { kind: 'corporate', percentBasisPoints: null, amountCents: 100_000 },
    { kind: 'staff_child', percentBasisPoints: 8_000, amountCents: null },
  ],
}
const request = {
  level: '7',
  institutionType: 'school',
  discounts: [],
  extras: [],
  canApproveCapException: false,
} as const
const CONTEXT: EnrollmentContext = {
  institutionType: 'school',
  tariff: TARIFF,
  academicYear: 2026,
  identityHolderId: null,
  approvedByUserId: 'test-user',
  canApproveCapException: false,
  today: '2026-10-06',
}
const INPUT = {
  classId: 'c1',
  tariffId: 'test-tariff',
  installmentCount: 3,
  firstDueDate: '2026-11-15',
  identity: { kind: 'tc', number: '10000000146', birthDate: '2013-03-01' },
  guardian: { name: 'Test Veli', phone: '05559990001', relationship: 'mother' },
}
function enroll(
  overrides: Record<string, unknown> = {},
  context: Partial<EnrollmentContext> = {},
  state = createSeed(new Date(NOW)),
) {
  let n = 0
  const result = enrollProspectWithTariff(
    state,
    'pr1',
    { ...INPUT, ...overrides },
    (prefix) => `${prefix}-test-${n++}`,
    NOW,
    { ...CONTEXT, ...context },
  )
  return { state, result }
}
function rejectsUnchanged(
  overrides: Record<string, unknown>,
  context: Partial<EnrollmentContext>,
  code: string,
  kind = 'rule',
) {
  const state = createSeed(new Date(NOW))
  const before = JSON.stringify(state)
  assert.throws(() => enroll(overrides, context, state), isDomainError(code, kind))
  assert.equal(JSON.stringify(state), before)
}

test('T.C. kimlik numarası denetim haneleriyle doğrulanır', () => {
  for (const valid of ['10000000146', '11111111110']) assert.equal(isValidTurkishId(valid), true)
  for (const invalid of ['10000000147', '01111111110', '1234', 'abcdefghijk'])
    assert.equal(isValidTurkishId(invalid), false)
  assert.throws(() =>
    enroll({ identity: { kind: 'tc', number: '10000000147', birthDate: '2013-03-01' } }),
  )
  assert.equal(
    enroll({ identity: { kind: 'foreign', number: 'P1234567', birthDate: '2013-03-01' } }).result
      .identity.kind,
    'foreign',
  )
})

test('DOM-FIN-002: fiyat düzeye özel kalemden, yoksa genel kalemden gelir', () => {
  assert.equal(priceEnrollment(TARIFF, request).grossCents, 20_000_000)
  assert.equal(priceEnrollment(TARIFF, { ...request, level: '9' }).grossCents, 10_000_001)
  assert.throws(
    () => priceEnrollment({ ...TARIFF, items: [] }, request),
    isDomainError('tariff_tuition_missing'),
  )
})

test('DOM-FIN-006: dil okulunda brüt ders saati × saat ücretidir', () => {
  const language = { ...request, institutionType: 'language_school' } as const
  assert.equal(priceEnrollment(TARIFF, { ...language, lessonHours: 3 }).grossCents, 60_000_000)
  assert.throws(() => priceEnrollment(TARIFF, language), isDomainError('lesson_hours_required'))
  assert.throws(
    () => priceEnrollment(TARIFF, { ...request, lessonHours: 3 }),
    isDomainError('lesson_hours_not_applicable'),
  )
})

test('DOM-FIN-020: indirim ilan ücretinden hesaplanır, zincirlenmez; ilansız ve tekrar reddedilir', () => {
  const price = priceEnrollment(TARIFF, { ...request, discounts: ['early_payment', 'corporate'] })
  assert.deepEqual(price.discounts, [
    { kind: 'early_payment', amountCents: 2_000_000 },
    { kind: 'corporate', amountCents: 100_000 },
  ])
  assert.equal(price.netCents, 17_900_000)
  assert.throws(
    () => priceEnrollment({ ...TARIFF, discounts: [] }, { ...request, discounts: ['sibling'] }),
    isDomainError('discount_not_in_tariff'),
  )
  assert.throws(
    () => priceEnrollment(TARIFF, { ...request, discounts: ['corporate', 'corporate'] }),
    isDomainError('discount_duplicate'),
  )
})

test('DOM-FIN-021: toplam indirim %50yi aşamaz; personel çocuğu yalnız yönetici onayıyla aşar', () => {
  assert.equal(
    priceEnrollment(TARIFF, { ...request, discounts: ['sibling', 'early_payment'] }).netCents,
    12_000_000,
  )
  assert.throws(
    () => priceEnrollment(TARIFF, { ...request, discounts: ['sibling', 'referral'] }),
    isDomainError('discount_cap_exceeded'),
  )
  assert.throws(
    () => priceEnrollment(TARIFF, { ...request, discounts: ['staff_child'] }),
    isDomainError('discount_approval_required'),
  )
  assert.equal(
    priceEnrollment(TARIFF, {
      ...request,
      discounts: ['staff_child'],
      canApproveCapException: true,
    }).netCents,
    4_000_000,
  )
})

test('DOM-FIN-010, DOM-FIN-011: sözleşme karar anını saklar; taksit toplamı nete, ek hizmet ayrı kaleme eşittir', () => {
  const { state, result } = enroll({ extras: ['meal'], discounts: ['early_payment'] })
  const { contract, student } = result
  assert.equal(contract.tariffId, 'test-tariff')
  assert.equal(contract.tariffVersion, 2)
  assert.equal(contract.grossCents, 20_000_000)
  assert.equal(contract.netCents, 18_000_000)
  assert.equal(contract.payer, 'guardian')
  assert.equal(contract.approvedByUserId, 'test-user')
  assert.equal(contract.academicYear, 2026)
  const invoices = state.invoices.filter((i) => i.studentId === student.id)
  const tuition = invoices.filter((i) => i.feeKind === 'tuition')
  assert.equal(tuition.length, 3)
  assert.equal(
    tuition.reduce((sum, i) => sum + i.amount, 0),
    18_000_000,
  )
  const meal = invoices.find((i) => i.feeKind === 'meal')
  assert.equal(meal?.amount, 1_000_000)
  assert.equal(meal?.installment, 4)
  assert.equal(contract.amount, 19_000_000)
  assert.deepEqual(
    contract.invoiceIds,
    invoices.map((i) => i.id),
  )
})

test('DOM-FIN-003: tarifede olmayan ek hizmet ve öğrenim ücreti ek hizmet olarak reddedilir', () => {
  rejectsUnchanged({ extras: ['transport'] }, {}, 'extra_not_in_tariff')
  rejectsUnchanged({ extras: ['tuition'] }, {}, 'extra_not_in_tariff')
})

test('DOM-FIN-002: yayımlanmış tarife yoksa kayıt oluşmaz', () => {
  rejectsUnchanged({}, { tariff: null }, 'tariff_not_published')
})

test('DOM-KAY-011: aynı kimlikle ikinci kayıt reddedilir, geçersiz doğum tarihi reddedilir', () => {
  const active = createSeed(new Date(NOW)).students.find((student) => student.isActive)!.id
  rejectsUnchanged({}, { identityHolderId: active }, 'student_identity_duplicate', 'conflict')
  rejectsUnchanged(
    { identity: { ...INPUT.identity, birthDate: '2026-10-06' } },
    {},
    'birth_date_invalid',
  )
})

test('DOM-KAY-012: okulda veli zorunlu; dil okulunda 18 yaş üstü kursiyer kendi ödeyicisidir', () => {
  rejectsUnchanged({ guardian: null }, {}, 'guardian_required')
  const language: Partial<EnrollmentContext> = { institutionType: 'language_school' }
  rejectsUnchanged(
    {
      guardian: null,
      lessonHours: 10,
      identity: { ...INPUT.identity, birthDate: '2008-10-07' },
    },
    language,
    'guardian_required',
  )
  const { state, result } = enroll(
    {
      guardian: null,
      lessonHours: 10,
      identity: { ...INPUT.identity, birthDate: '2008-10-06' },
    },
    language,
  )
  assert.equal(result.contract.payer, 'student')
  assert.equal(result.contract.title, 'Dil kursu eğitim sözleşmesi')
  assert.equal(
    state.parents.find((p) => p.id === result.student.parentId)?.name,
    result.student.name,
  )
})

test('DOM-KAY-012: veli adı, telefonu ve yakınlığı kaydedilir', () => {
  const { state, result } = enroll()
  const parent = state.parents.find((p) => p.id === result.student.parentId)
  assert.equal(parent?.name, 'Test Veli')
  assert.equal(parent?.phone, '05559990001')
  assert.equal(parent?.relationship, 'mother')
})

test('DOM-KAY-013, DOM-FIN-022: mevcut veliye bağlanır, yeni veli açılmaz; kardeş indirimi aktif kardeş ister', () => {
  const seed = createSeed(new Date(NOW))
  const parent = seed.parents[0]!
  const before = seed.parents.length
  const { state, result } = enroll(
    { guardian: { existingParentId: parent.id }, discounts: ['sibling'] },
    {},
    seed,
  )
  assert.equal(state.parents.length, before)
  assert.equal(result.student.parentId, parent.id)
  assert.ok(parent.studentIds.includes(result.student.id))

  rejectsUnchanged({ guardian: { existingParentId: 'yok' } }, {}, 'parent_not_found', 'not_found')
  rejectsUnchanged({ discounts: ['sibling'] }, {}, 'sibling_discount_ineligible')
  const lonely = createSeed(new Date(NOW))
  for (const student of lonely.students) student.isActive = false
  const snapshot = JSON.stringify(lonely)
  assert.throws(
    () =>
      enroll(
        { guardian: { existingParentId: lonely.parents[0]!.id }, discounts: ['sibling'] },
        {},
        lonely,
      ),
    isDomainError('sibling_discount_ineligible'),
  )
  assert.equal(JSON.stringify(lonely), snapshot)
})

test('DOM-KAY-013: telefon eşleşmesi öneri döndürür, boş telefon eşleşmez', () => {
  const state = createSeed(new Date(NOW))
  const parent = state.parents[0]!
  const child = state.students.find((student) => student.id === parent.studentIds[0])!
  const matches = findParentMatches(state, child.phone)
  assert.ok(matches.some((match) => match.parentId === parent.id))
  assert.deepEqual(findParentMatches(state, ''), [])
  assert.deepEqual(findParentMatches(state, '05000000000'), [])
})

test('DOM-KAY-011: kimliğin sahibi pasifse veya kayıt yoksa yeni kayıt açılır, eski kimlik bildirilir', () => {
  const seed = createSeed(new Date(NOW))
  const holder = seed.students[0]!
  holder.isActive = false
  const { result } = enroll({}, { identityHolderId: holder.id }, seed)
  assert.equal(result.supersededStudentId, holder.id)
  assert.equal(enroll({}, { identityHolderId: 'silinmis' }).result.supersededStudentId, 'silinmis')
  assert.equal(enroll().result.supersededStudentId, null)
})

test('DOM-FIN-006: dil okulunda fiyat sınıfın CEFR düzeyinden gelir', () => {
  const seed = createSeed(new Date(NOW))
  const cls = seed.classes.find((item) => item.id === 'c1')!
  cls.level = 'B1'
  const tariff: EnrollmentTariff = {
    ...TARIFF,
    items: [item({}), item({ level: 'B1', amountCents: 70_000 })],
  }
  const { result } = enroll(
    { lessonHours: 10, guardian: null, identity: { ...INPUT.identity, birthDate: '2000-01-01' } },
    { institutionType: 'language_school', tariff },
    seed,
  )
  assert.equal(result.contract.grossCents, 700_000)
})

const FORM = {
  prospectId: 'pr1',
  classId: 'c1',
  identityKind: 'tc',
  identityNumber: '10000000146',
  birthDate: '2013-03-01',
  guardianMode: 'new',
  guardianName: 'Test Veli',
  guardianPhone: '05559990001',
  relationship: 'mother',
  existingParentId: '',
  lessonHours: '',
  discounts: [],
  extras: [],
  installmentCount: '3',
  firstDueDate: '2026-11-15',
} as const
const formIssues = (values: unknown, type: 'school' | 'language_school' = 'school') => {
  const parsed = enrollmentFormSchema(type).safeParse(values)
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'))
}

test('DOM-KAY-012: kayıt formu kimlik, veli ve dil okulunda saat ister', () => {
  assert.deepEqual(formIssues(FORM), [])
  assert.deepEqual(formIssues({ ...FORM, identityNumber: '10000000147' }), ['identityNumber'])
  assert.deepEqual(formIssues({ ...FORM, identityKind: 'foreign', identityNumber: 'P1' }), [
    'identityNumber',
  ])
  assert.deepEqual(formIssues({ ...FORM, guardianName: '', guardianPhone: '1' }), [
    'guardianName',
    'guardianPhone',
  ])
  assert.deepEqual(formIssues({ ...FORM, guardianMode: 'existing' }), ['existingParentId'])
  assert.deepEqual(formIssues(FORM, 'language_school'), ['lessonHours'])
  assert.deepEqual(formIssues({ ...FORM, lessonHours: '40' }, 'language_school'), [])
  assert.deepEqual(formIssues({ ...FORM, installmentCount: '13' }), ['installmentCount'])
})

test('DOM-KAY-012, -013: form gövdesi API şemasından geçer, veli türüne göre değişir', () => {
  const parse = (values: Parameters<typeof enrollmentFormToBody>[0]) => {
    const body = enrollmentFormToBody(values, 'test-tariff')
    assert.equal(enrollProspectSchema.safeParse(body).success, true)
    return body
  }
  const fresh = parse({ ...FORM, discounts: [], extras: [] })
  assert.deepEqual(fresh.guardian, {
    name: 'Test Veli',
    phone: '05559990001',
    relationship: 'mother',
  })
  assert.equal('lessonHours' in fresh, false)
  assert.deepEqual(
    parse({ ...FORM, discounts: [], extras: [], guardianMode: 'existing', existingParentId: 'p1' })
      .guardian,
    { existingParentId: 'p1' },
  )
  const self = parse({
    ...FORM,
    discounts: [],
    extras: [],
    guardianMode: 'self',
    lessonHours: '40',
  })
  assert.equal(self.guardian, null)
  assert.equal(self.lessonHours, 40)
})

test('DOM-FIN-020: önizleme sunucu kuralıyla hesaplar, reddi mesaj olarak döner', () => {
  const school = { institutionType: 'school', level: '7' } as const
  const ok = previewEnrollment(
    TARIFF,
    { lessonHours: '', discounts: ['early_payment'], extras: [] },
    school,
  )
  assert.equal(ok.ok && ok.price.netCents, 18_000_000)
  const capped = previewEnrollment(
    TARIFF,
    { lessonHours: '', discounts: ['sibling', 'referral'], extras: [] },
    school,
  )
  assert.equal(capped.ok, false)
  assert.equal(!capped.ok && capped.message.includes('%50'), true)
  assert.throws(() =>
    previewEnrollment(null as never, { lessonHours: '', discounts: [], extras: [] }, school),
  )
})

test('DOM-FIN-010: form açıkken tarife değiştiyse kayıt yazılmaz (409)', () => {
  rejectsUnchanged({ tariffId: 'eski-tarife' }, {}, 'tariff_changed', 'conflict')
})

test('DOM-FIN-003: aynı ek hizmet iki kez borç açmaz', () => {
  rejectsUnchanged({ extras: ['meal', 'meal'] }, {}, 'extra_duplicate')
})

const RENEWAL = {
  studentId: 's1',
  targetClassId: 'c1',
  year: 2027,
  mode: 'renew',
  total: 200_000,
  discount: 0,
  scholarship: 0,
  count: 3,
  startDate: '2027-09-15',
}

test('DOM-FIN-002, -021: yenileme yayımlı tarife ister, ilanı ve indirim tavanını aşamaz', () => {
  const state = createSeed(new Date(NOW))
  const check = (input: object, tariff: EnrollmentTariff | null = TARIFF) =>
    assertRenewalWithinTariff(state, input, tariff, 'school')
  assert.doesNotThrow(() => check(RENEWAL))
  assert.throws(() => check(RENEWAL, null), isDomainError('tariff_not_published'))
  assert.throws(
    () => check(RENEWAL, { ...TARIFF, items: [item({ kind: 'meal' })] }),
    isDomainError('tariff_tuition_missing'),
  )
  assert.throws(() => check({ ...RENEWAL, total: 200_001 }), isDomainError('renewal_above_tariff'))
  assert.throws(
    () => check({ ...RENEWAL, discount: 100_001 }),
    isDomainError('discount_cap_exceeded'),
  )
  assert.doesNotThrow(() => check({ ...RENEWAL, discount: 100_000 }))
})

test('DOM-KAY-022: mezuniyet ve biçimsiz girdi tarife denetimine takılmaz; dil okulu tutarı serbest', () => {
  const state = createSeed(new Date(NOW))
  assert.doesNotThrow(() =>
    assertRenewalWithinTariff(state, { ...RENEWAL, mode: 'graduate' }, null, 'school'),
  )
  assert.doesNotThrow(() => assertRenewalWithinTariff(state, { year: 'x' }, null, 'school'))
  assert.doesNotThrow(() =>
    assertRenewalWithinTariff(state, { ...RENEWAL, total: 999_999 }, TARIFF, 'language_school'),
  )
})
