import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed } from '../packages/school-core/src/data/seed.ts'
import {
  allowedGuardianModes,
  assertRenewalWithinTariff,
  enrollmentFormSchema,
  enrollmentFormToBody,
  enrollProspect,
  enrollProspectSchema,
  enrollProspectWithTariff,
  findParentMatches,
  GUARDIAN_NOT_APPLICABLE_FORM_MESSAGE,
  GUARDIAN_RELATIONSHIP_LABELS,
  GUARDIAN_RELATIONSHIPS,
  GUARDIAN_REQUIRED_FORM_MESSAGE,
  guardianRequired,
  isCourse,
  isNotGuardian,
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

/** Dil okulu kaydı; `minor` verilirse aday pr1'in yaş grubu seçimi olur. */
function languageEnroll(
  overrides: Record<string, unknown>,
  options: { minor?: boolean; now?: string } = {},
) {
  const state = createSeed(new Date(NOW))
  const prospect = state.prospects.find((item) => item.id === 'pr1')!
  if (options.minor !== undefined) prospect.minor = options.minor
  const before = JSON.stringify(state)
  let n = 0
  const run = () =>
    enrollProspectWithTariff(
      state,
      'pr1',
      { ...INPUT, lessonHours: 10, ...overrides },
      (prefix) => `${prefix}-test-${n++}`,
      options.now ?? NOW,
      { ...CONTEXT, institutionType: 'language_school' },
    )
  return { state, before, run }
}

test('DOM-KAY-012: 18 yaş doğum tarihinden ve işlem anının Europe/Istanbul gününden hesaplanır', () => {
  const adultBirthday = { identity: { ...INPUT.identity, birthDate: '2008-10-06' }, guardian: null }
  // 5 Ekim 22:30 UTC İstanbul'da 6 Ekim'dir: 18. doğum günü gelmiştir.
  const midnight = languageEnroll(adultBirthday, { now: '2026-10-05T22:30:00.000Z' })
  assert.equal(midnight.run().contract.payer, 'student')
  // 5 Ekim 20:30 UTC İstanbul'da hâlâ 5 Ekim'dir: kursiyer 18 yaş altıdır, veli gerekir.
  const evening = languageEnroll(adultBirthday, { now: '2026-10-05T20:30:00.000Z' })
  assert.throws(evening.run, isDomainError('guardian_required'))
  assert.equal(JSON.stringify(evening.state), evening.before)
})

test('DOM-KAY-012, DOM-KAY-003: dil okulunda adayın yaş grubu seçimi doğum tarihiyle uyuşmalıdır', () => {
  const adult = { identity: { ...INPUT.identity, birthDate: '2000-01-01' }, guardian: null }
  for (const [overrides, minor] of [
    [adult, true],
    [{ identity: { ...INPUT.identity, birthDate: '2013-03-01' } }, false],
  ] as const) {
    const attempt = languageEnroll(overrides, { minor })
    assert.throws(attempt.run, (error: unknown) => {
      assert.ok(isDomainError('birth_date_minor_mismatch')(error))
      assert.deepEqual((error as { path?: unknown }).path, ['identity', 'birthDate'])
      return true
    })
    assert.equal(JSON.stringify(attempt.state), attempt.before)
  }
  // Seçim doğum tarihiyle uyuşuyorsa ya da eski adayda seçim yoksa kayıt yazılır.
  assert.equal(languageEnroll(adult, { minor: false }).run().contract.payer, 'student')
  assert.equal(languageEnroll(adult).run().contract.payer, 'student')
  assert.equal(languageEnroll({}, { minor: true }).run().contract.payer, 'guardian')
})

test('DOM-KAY-012: yetişkin kursiyerde veli alınmaz (guardian_not_applicable); okulda 18 yaş üstünde de veli zorunludur', () => {
  const adultIdentity = { ...INPUT.identity, birthDate: '2000-01-01' }
  for (const guardian of [INPUT.guardian, { existingParentId: 'p1' }]) {
    const attempt = languageEnroll({ identity: adultIdentity, guardian })
    assert.throws(attempt.run, (error: unknown) => {
      assert.ok(isDomainError('guardian_not_applicable')(error))
      assert.deepEqual((error as { path?: unknown }).path, ['guardian'])
      return true
    })
    assert.equal(JSON.stringify(attempt.state), attempt.before)
  }
  // Okulda doğum tarihi ne olursa olsun ödeyici velidir; veli verilmezse kayıt yazılmaz.
  rejectsUnchanged({ identity: adultIdentity, guardian: null }, {}, 'guardian_required')
  assert.equal(enroll({ identity: adultIdentity }).result.contract.payer, 'guardian')
})

test('DOM-KAY-012: veli okulda her yaşta, kursta yalnız 18 yaş altında zorunludur (guardianRequired)', () => {
  const now = '2026-10-06T09:00:00.000Z'
  assert.equal(isCourse('school'), false)
  assert.equal(isCourse('language_school'), true)
  // Okul: 18 yaşını doldurmuş öğrencide de veli zorunlu.
  assert.equal(guardianRequired('school', '2013-03-01', now), true)
  assert.equal(guardianRequired('school', '2008-10-06', now), true)
  assert.equal(guardianRequired('school', '1990-01-01', now), true)
  // Kurs: 18 yaş günü (Europe/Istanbul) dolunca veli gerekmez.
  assert.equal(guardianRequired('language_school', '2008-10-07', now), true)
  assert.equal(guardianRequired('language_school', '2008-10-06', now), false)
})

test('DOM-KAY-012, DOM-KAY-003: okulda 18 yaşını doldurmuş öğrencide veli zorunlu; iletişim velide kalır, guardian_not_applicable dönmez', () => {
  const adultIdentity = { ...INPUT.identity, birthDate: '2007-01-01' }
  // Okul adayında yaş grubu seçimi veli kuralını değiştirmez; uyuşmazlık denetimi kurstadır.
  const seed = createSeed(new Date(NOW))
  seed.prospects.find((item) => item.id === 'pr1')!.minor = true
  const { state, result } = enroll({ identity: adultIdentity }, {}, seed)
  const prospect = state.prospects.find((item) => item.id === 'pr1')!
  assert.equal(result.contract.payer, 'guardian')
  assert.equal(result.student.email, '')
  assert.equal(result.student.phone, '')
  const parent = state.parents.find((p) => p.id === result.student.parentId)!
  assert.equal(parent.email, prospect.email)
  assert.equal(parent.phone, INPUT.guardian.phone)
  assert.notEqual(parent.relationship, 'self')
  rejectsUnchanged({ identity: adultIdentity, guardian: null }, {}, 'guardian_required')

  // Kardeşin mevcut velisine bağlanır.
  const linked = createSeed(new Date(NOW))
  const sibling = linked.parents[0]!
  const { result: second } = enroll(
    { identity: adultIdentity, guardian: { existingParentId: sibling.id } },
    {},
    linked,
  )
  assert.equal(second.student.parentId, sibling.id)
  assert.equal(second.contract.payer, 'guardian')
})

test('DOM-KAY-012: öğrencinin kendi iletişimi isteğe bağlı ve ayrıca alınır; adayın iletişimi velide kalır', () => {
  const contact = { phone: '05551234567', email: 'Ogrenci@Kampus.example' }
  const { state, result } = enroll({
    identity: { ...INPUT.identity, birthDate: '2007-01-01' },
    studentContact: contact,
  })
  const prospect = state.prospects.find((item) => item.id === 'pr1')!
  assert.equal(result.student.phone, contact.phone)
  assert.equal(result.student.email, 'ogrenci@kampus.example')
  assert.equal(state.parents.find((p) => p.id === result.student.parentId)?.email, prospect.email)
  // Yalnız telefon verilirse e-posta boş kalır.
  assert.equal(enroll({ studentContact: { phone: contact.phone } }).result.student.email, '')
  for (const bad of [{ phone: '123' }, { email: 'eposta' }, { phone: contact.phone, extra: 1 }])
    assert.equal(enrollProspectSchema.safeParse({ ...INPUT, studentContact: bad }).success, false)
})

test('DOM-KAY-003: 18 yaş altında adayın telefonu ve e-postası öğrenciye yazılmaz; yeni veliye adayın e-postası yazılır', () => {
  const { state, result } = enroll()
  const prospect = state.prospects.find((item) => item.id === 'pr1')!
  assert.equal(result.student.email, '')
  assert.equal(result.student.phone, '')
  const parent = state.parents.find((p) => p.id === result.student.parentId)
  assert.equal(parent?.email, prospect.email)
  // Telefon formdan gelir (ön büro adayınkini düzeltebilir).
  assert.equal(parent?.phone, INPUT.guardian.phone)
})

test('DOM-KAY-003: mevcut velinin eksik telefonu ve e-postası adayınkiyle tamamlanır; var olan değer ve ad değişmez', () => {
  const state = createSeed(new Date(NOW))
  const prospect = state.prospects.find((item) => item.id === 'pr1')!
  const empty = state.parents.find((p) => p.id === 'p1')!
  const name = empty.name
  enroll({ guardian: { existingParentId: 'p1' } }, {}, state)
  assert.equal(empty.phone, prospect.phone)
  assert.equal(empty.email, prospect.email)
  assert.equal(empty.name, name)

  const filled = createSeed(new Date(NOW))
  const parent = filled.parents.find((p) => p.id === 'p1')!
  Object.assign(parent, { phone: '05551234567', email: 'anne@kampus.example' })
  const { result } = enroll({ guardian: { existingParentId: 'p1' } }, {}, filled)
  assert.equal(parent.phone, '05551234567')
  assert.equal(parent.email, 'anne@kampus.example')
  assert.equal(result.student.phone, '')
  // Aday kaydı kendi iletişimini korur.
  assert.equal(filled.prospects.find((item) => item.id === 'pr1')?.phone, prospect.phone)
})

test('DOM-KAY-003: yetişkin kursiyerin iletişimi kendisine yazılır; yer tutucu veli iletişimsizdir', () => {
  const attempt = languageEnroll({
    identity: { ...INPUT.identity, birthDate: '2000-01-01' },
    guardian: null,
  })
  const result = attempt.run()
  const prospect = attempt.state.prospects.find((item) => item.id === 'pr1')!
  assert.equal(result.student.email, prospect.email)
  assert.equal(result.student.phone, prospect.phone)
  const parent = attempt.state.parents.find((p) => p.id === result.student.parentId)
  assert.equal(parent?.phone, undefined)
  assert.equal(parent?.email, undefined)
})

test('DOM-KAY-003: çevrimdışı demo kaydı yaş bilmez; öğrenci adayın iletişimini eski davranışla taşır', () => {
  const state = createSeed(new Date(NOW))
  const prospect = state.prospects.find((item) => item.id === 'pr1')!
  let n = 0
  const result = enrollProspect(
    state,
    { prospectId: 'pr1', classId: 'c1', total: 1000, count: 2, startDate: '2026-11-15' },
    (prefix) => `${prefix}-demo-${n++}`,
    NOW,
  )
  assert.equal(result.student.email, prospect.email)
  assert.equal(result.student.phone, prospect.phone)
})

test('class_campus_mismatch: başka kampüsün sınıfı açık onaysız reddedilir (422, classId); onayla yazılır', () => {
  const state = createSeed(new Date(NOW))
  const prospect = state.prospects.find((item) => item.id === 'pr1')!
  const other = state.classes.find(
    (item) => item.branchId !== prospect.branchId && item.grade === 7 && item.isActive,
  )!
  const before = JSON.stringify(state)
  for (const allowOtherCampus of [undefined, false]) {
    assert.throws(
      () =>
        enroll(
          { classId: other.id, ...(allowOtherCampus === undefined ? {} : { allowOtherCampus }) },
          {},
          state,
        ),
      (error: unknown) =>
        isDomainError('class_campus_mismatch')(error) &&
        JSON.stringify((error as { path?: unknown }).path) === JSON.stringify(['classId']),
    )
  }
  assert.equal(JSON.stringify(state), before)
  const { result } = enroll({ classId: other.id, allowOtherCampus: true })
  assert.equal(result.student.classId, other.id)
})

test('class_campus_mismatch: kampüs denetimi kontenjandan önce çalışır', () => {
  const state = createSeed(new Date(NOW))
  const prospect = state.prospects.find((item) => item.id === 'pr1')!
  const other = state.classes.find(
    (item) => item.branchId !== prospect.branchId && item.grade === 7 && item.isActive,
  )!
  other.capacity = 0
  assert.throws(
    () => enroll({ classId: other.id }, {}, state),
    isDomainError('class_campus_mismatch'),
  )
  assert.throws(
    () => enroll({ classId: other.id, allowOtherCampus: true }, {}, state),
    isDomainError('class_capacity_full'),
  )
})

test('class_campus_mismatch: çevrimdışı demo her kampüsün sınıfını eski davranışla kabul eder', () => {
  const state = createSeed(new Date(NOW))
  const prospect = state.prospects.find((item) => item.id === 'pr1')!
  const other = state.classes.find((item) => item.branchId !== prospect.branchId)!
  let n = 0
  const result = enrollProspect(
    state,
    { prospectId: 'pr1', classId: other.id, total: 1000, count: 2, startDate: '2026-11-15' },
    (prefix) => `${prefix}-demo-${n++}`,
    NOW,
  )
  assert.equal(result.student.classId, other.id)
})

test('DOM-ILT-070, DOM-ILT-074: veli varsa kayıt veli–öğrenci bağı taslağı döndürür; veli ödeyicidir, yetişkin kursiyerde bağ yoktur', () => {
  // Yeni veli: formdaki yakınlık bağın yakınlığıdır, bağ veli kaydına yazılır.
  const { result } = enroll()
  assert.deepEqual(result.guardianBond, {
    parentId: result.student.parentId,
    relationship: 'mother',
    isPayer: true,
  })
  const father = enroll({ guardian: { ...INPUT.guardian, relationship: 'legal_guardian' } })
  assert.equal(father.result.guardianBond?.relationship, 'legal_guardian')
  // Mevcut veli (kardeş): bağ mevcut veli kaydına ve onun kayıtlı yakınlığına yazılır.
  const state = createSeed(new Date(NOW))
  const parent = state.parents[0]
  assert.ok(parent)
  parent.relationship = 'father'
  const sibling = enroll({ guardian: { existingParentId: parent.id } }, {}, state)
  assert.deepEqual(sibling.result.guardianBond, {
    parentId: parent.id,
    relationship: 'father',
    isPayer: true,
  })
  // Tanınan yakınlığı olmayan eski veli kaydı `other` bağlanır.
  const legacy = createSeed(new Date(NOW))
  const legacyParent = legacy.parents[0]
  assert.ok(legacyParent)
  delete legacyParent.relationship
  assert.equal(
    enroll({ guardian: { existingParentId: legacyParent.id } }, {}, legacy).result.guardianBond
      ?.relationship,
    'other',
  )
  // Yetişkin kursiyerin kendisi veli değildir: bağ yoktur.
  const adult = languageEnroll({
    identity: { ...INPUT.identity, birthDate: '2000-01-01' },
    guardian: null,
  }).run()
  assert.equal(adult.guardianBond, null)
})

const SCHOLARSHIP_ID = '00000000-0000-4000-8000-000000000001'
const scholarshipContext = (percentBasisPoints: number): Partial<EnrollmentContext> => ({
  canApproveCapException: true,
  scholarshipProgram: {
    id: SCHOLARSHIP_ID,
    academicYear: 2026,
    percentBasisPoints,
    amountCents: null,
    capacity: 5,
    notifiedDate: '2026-09-01',
  },
  scholarshipAwardedCount: 0,
})

test('DOM-FIN-021, DOM-FIN-025: burs netten düşer, sözleşmeye yazılır, indirim tavanına girmez', () => {
  const { state, result } = enroll(
    { scholarshipProgramId: SCHOLARSHIP_ID },
    scholarshipContext(6000),
  )
  const gross = result.contract.grossCents ?? 0
  assert.ok(gross > 0)
  const amountCents = Math.floor((gross * 6000) / 10_000)
  // %60 burs %50 indirim tavanının üstündedir ama indirim değildir.
  assert.deepEqual(result.contract.scholarship, { programId: SCHOLARSHIP_ID, amountCents })
  assert.equal(result.contract.netCents, gross - amountCents)
  assert.deepEqual(result.scholarshipAward, { programId: SCHOLARSHIP_ID, amountCents })
  const invoices = state.invoices.filter((item) => item.studentId === result.student.id)
  assert.equal(
    invoices.reduce((sum, item) => sum + item.amount, 0),
    gross - amountCents,
  )
  assert.equal(enroll().result.scholarshipAward, null)
})

test('DOM-FIN-025: tam bursta öğrenim taksiti açılmaz, sözleşme yazılır', () => {
  const { state, result } = enroll(
    { scholarshipProgramId: SCHOLARSHIP_ID },
    scholarshipContext(10_000),
  )
  assert.equal(result.contract.netCents, 0)
  assert.equal(result.contract.amount, 0)
  assert.deepEqual(result.contract.invoiceIds, [])
  assert.equal(state.invoices.filter((item) => item.studentId === result.student.id).length, 0)
  assert.equal(
    state.students.some((item) => item.id === result.student.id),
    true,
  )
})

test('DOM-FIN-025: bursta kural reddi kayıt yazmaz; ön büro burs atayamaz', () => {
  const body = { scholarshipProgramId: SCHOLARSHIP_ID }
  rejectsUnchanged(
    body,
    { ...scholarshipContext(2500), canApproveCapException: false },
    'scholarship_approval_required',
  )
  rejectsUnchanged(
    body,
    { ...scholarshipContext(2500), scholarshipProgram: null },
    'scholarship_program_not_found',
    'not_found',
  )
  rejectsUnchanged(
    body,
    { ...scholarshipContext(2500), scholarshipAwardedCount: 5 },
    'scholarship_capacity_full',
    'conflict',
  )
})

test('DOM-KAY-012: veli adı, telefonu ve yakınlığı kaydedilir', () => {
  const { state, result } = enroll()
  const parent = state.parents.find((p) => p.id === result.student.parentId)
  assert.equal(parent?.name, 'Test Veli')
  assert.equal(parent?.phone, '05559990001')
  assert.equal(parent?.relationship, 'mother')
})

test('DOM-KAY-012: yasal vasi yakınlığı legal_guardian değeridir; ödeyici adı guardian yakınlık olarak reddedilir', () => {
  const guardian = { ...INPUT.guardian, relationship: 'legal_guardian' }
  const { state, result } = enroll({ guardian })
  assert.equal(
    state.parents.find((p) => p.id === result.student.parentId)?.relationship,
    'legal_guardian',
  )
  assert.equal(result.contract.payer, 'guardian')
  assert.equal(
    enrollProspectSchema.safeParse({
      ...INPUT,
      guardian: { ...guardian, relationship: 'guardian' },
    }).success,
    false,
  )
  assert.equal(GUARDIAN_RELATIONSHIP_LABELS.legal_guardian, 'Vasi')
  assert.deepEqual(Object.keys(GUARDIAN_RELATIONSHIP_LABELS), [...GUARDIAN_RELATIONSHIPS])
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

test('DOM-KAY-013, DOM-KAY-003: 18 yaş altı kardeşin telefonu öğrenciye yazılmadığından veli, kardeşin aday telefonuyla önerilir', () => {
  const { state, result } = enroll({
    guardian: { name: 'Test Veli', phone: '05559990001', relationship: 'mother' },
  })
  const family = state.prospects.find((item) => item.id === 'pr1')!.phone
  assert.equal(result.student.phone, '')
  // Veli telefonu formda başka yazıldı; eşleşme kardeşin aday kaydındaki aile telefonundandır.
  assert.deepEqual(
    findParentMatches(state, family).map((match) => match.parentId),
    [result.student.parentId],
  )
  // Aday listesi verilmezse yalnız veli ve öğrenci telefonuna bakılır.
  assert.deepEqual(
    findParentMatches({ parents: state.parents, students: state.students }, family),
    [],
  )
})

test('DOM-KAY-013, parent_not_guardian: yetişkin kursiyerin kendi satırı 18 yaş altı kardeşe veli olarak verilmez ve önerilmez', () => {
  const state = createSeed(new Date(NOW))
  const language = { ...CONTEXT, institutionType: 'language_school' as const }
  const adult = state.prospects.find((item) => item.id === 'pr4')!
  adult.minor = false
  const young = state.prospects.find((item) => item.id === 'pr1')!
  young.minor = true
  let n = 0
  const makeId = (prefix: string) => `${prefix}-test-${n++}`
  const grown = enrollProspectWithTariff(
    state,
    'pr4',
    {
      ...INPUT,
      lessonHours: 10,
      guardian: null,
      identity: { kind: 'tc', number: '10000000146', birthDate: '2000-01-01' },
    },
    makeId,
    NOW,
    language,
  )
  const self = state.parents.find((parent) => parent.id === grown.student.parentId)!
  assert.equal(self.relationship, 'self')
  assert.equal(isNotGuardian(self, state.prospects), true)
  // Yetişkinin telefonu öğrenci kaydındadır; yine de veli olarak önerilmez.
  assert.deepEqual(findParentMatches(state, adult.phone), [])

  const before = JSON.stringify(state)
  assert.throws(
    () =>
      enrollProspectWithTariff(
        state,
        'pr1',
        {
          ...INPUT,
          lessonHours: 10,
          identity: { kind: 'tc', number: '11111111110', birthDate: '2013-03-01' },
          guardian: { existingParentId: self.id },
        },
        makeId,
        NOW,
        { ...language, identityHolderId: null },
      ),
    (error: unknown) =>
      isDomainError('parent_not_guardian')(error) &&
      JSON.stringify((error as { path?: unknown }).path) === JSON.stringify(['guardian']),
  )
  assert.equal(JSON.stringify(state), before)
})

test('DOM-KAY-013, parent_not_guardian: eski yer tutucu (iletişimsiz, adayları yetişkin) veli sayılmaz; iletişimli veli sayılır', () => {
  const placeholder = { id: 'p-eski', name: 'Kursiyer velisi', studentIds: ['s-eski'] }
  const adultProspect = { studentId: 's-eski', minor: false }
  assert.equal(isNotGuardian(placeholder, [adultProspect]), true)
  // Adayı yoksa ya da adaylardan biri 18 yaş altıysa gerçek veli olabilir.
  assert.equal(isNotGuardian(placeholder, []), false)
  assert.equal(isNotGuardian(placeholder, [adultProspect, { studentId: 's-eski' }]), false)
  assert.equal(isNotGuardian({ ...placeholder, phone: '05550000000' }, [adultProspect]), false)
  assert.equal(
    isNotGuardian({ ...placeholder, email: 'veli@kampus.example' }, [adultProspect]),
    false,
  )

  const state = createSeed(new Date(NOW))
  state.parents.push({ ...placeholder })
  state.prospects.find((item) => item.id === 'pr4')!.studentId = 's-eski'
  state.prospects.find((item) => item.id === 'pr4')!.minor = false
  const before = JSON.stringify(state)
  assert.throws(
    () => enroll({ guardian: { existingParentId: 'p-eski' } }, {}, state),
    isDomainError('parent_not_guardian'),
  )
  assert.equal(JSON.stringify(state), before)
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
  studentPhone: '',
  studentEmail: '',
  lessonHours: '',
  discounts: [],
  extras: [],
  installmentCount: '3',
  firstDueDate: '2026-11-15',
  allCampuses: false,
  confirmOtherCampus: false,
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

test('DOM-KAY-012: kayıt formu veli kuralını sunucuyla aynı uygular (okul/kurs × 17/18/25 yaş × veli/kendisi)', () => {
  // NOW 2026-10-06: 2008-10-07 doğumlu 18 yaşına bir gün kala 17'dir; 2008-10-06 tam 18'dir.
  const births = { 17: '2008-10-07', 18: '2008-10-06', 25: '2001-10-06' } as const
  for (const type of ['school', 'language_school'] as const)
    for (const [age, birthDate] of Object.entries(births))
      for (const mode of ['new', 'self'] as const) {
        const parsed = enrollmentFormSchema(type, NOW).safeParse({
          ...FORM,
          birthDate,
          guardianMode: mode,
          lessonHours: '40',
        })
        const issues = parsed.success ? [] : parsed.error.issues
        const required = guardianRequired(type, birthDate, NOW)
        assert.equal(required, type === 'school' || Number(age) < 18, `${type} ${age}`)
        const rejected = required ? mode === 'self' : mode === 'new'
        assert.deepEqual(
          issues.map((issue) => [issue.path.join('.'), issue.message]),
          rejected
            ? [
                [
                  'guardianMode',
                  required ? GUARDIAN_REQUIRED_FORM_MESSAGE : GUARDIAN_NOT_APPLICABLE_FORM_MESSAGE,
                ],
              ]
            : [],
          `${type} ${age} ${mode}`,
        )
        assert.deepEqual(
          allowedGuardianModes(type, birthDate, NOW),
          required ? ['new', 'existing'] : ['self'],
        )
      }
  // Doğum tarihi girilmeden "kendisi" sunulmaz; yetişkine veli alanları ayrıca sorulmaz.
  assert.deepEqual(allowedGuardianModes('language_school', '', NOW), ['new', 'existing'])
  const adult = enrollmentFormSchema('language_school', NOW).safeParse({
    ...FORM,
    birthDate: '2001-10-06',
    guardianMode: 'existing',
    lessonHours: '40',
  })
  assert.deepEqual(adult.success ? [] : adult.error.issues.map((issue) => issue.path.join('.')), [
    'guardianMode',
  ])
})

test('DOM-KAY-012: yetişkin kursiyerin kendi iletişimi isteğe bağlıdır, yalnız "kendisi" seçiliyken gider', () => {
  const adult = {
    ...FORM,
    birthDate: '2001-10-06',
    guardianMode: 'self' as const,
    lessonHours: '40',
  }
  const issues = (values: object) => {
    const parsed = enrollmentFormSchema('language_school', NOW).safeParse({ ...adult, ...values })
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'))
  }
  assert.deepEqual(issues({}), [])
  assert.deepEqual(issues({ studentPhone: '123', studentEmail: 'yok' }), [
    'studentPhone',
    'studentEmail',
  ])
  const body = (values: Partial<Parameters<typeof enrollmentFormToBody>[0]>) =>
    enrollmentFormToBody({ ...adult, discounts: [], extras: [], ...values }, 'test-tariff')
  assert.equal('studentContact' in body({}), false)
  const filled = body({ studentPhone: '05551112233', studentEmail: 'kursiyer@kampus.example' })
  assert.deepEqual(filled.studentContact, {
    phone: '05551112233',
    email: 'kursiyer@kampus.example',
  })
  assert.equal(enrollProspectSchema.safeParse(filled).success, true)
  assert.deepEqual(body({ studentEmail: 'kursiyer@kampus.example' }).studentContact, {
    email: 'kursiyer@kampus.example',
  })
  // Veli seçiliyken kalmış iletişim gövdeye taşınmaz.
  assert.equal(
    'studentContact' in body({ guardianMode: 'new', studentPhone: '05551112233' }),
    false,
  )
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

test('class_campus_mismatch: form gövdesi allowOtherCampus yalnız açık onayla taşır; listeleme kutusu onay sayılmaz', () => {
  const body = (values: Partial<Parameters<typeof enrollmentFormToBody>[0]>) =>
    enrollmentFormToBody({ ...FORM, discounts: [], extras: [], ...values }, 'test-tariff')
  assert.equal('allowOtherCampus' in body({}), false)
  assert.equal('allowOtherCampus' in body({ allCampuses: true }), false)
  const confirmed = body({ allCampuses: true, confirmOtherCampus: true })
  assert.equal(confirmed.allowOtherCampus, true)
  assert.equal(enrollProspectSchema.safeParse(confirmed).success, true)
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
