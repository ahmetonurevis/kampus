import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import {
  ENROLLMENT_CONTRACT_TITLES,
  ageOn,
  enrollProspect,
  enrollmentFromRegistration,
  isValidNationalId,
} from '../packages/school-core/src/lib/domain.ts'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'

// Kesin kayıt core kuralları (docs/domain/kayit-ve-crm.md DOM-KAY-003, -012, -013; kampüs onayı ve
// kuruş). 2026-10-06 salıdır. Seed: pr1 Alara Güven (b1, Yeni aday), pr2 (b2, İletişime
// geçildi), pr4 (b1, Teklif verildi); c1 7-A b1'dedir (kapasite 24).
const now = '2026-10-06T10:00:00.000Z'
const seed = () => createSeed(new Date(now))
let sequence = 0
const id = (prefix: string) => `${prefix}-enrollment-test-${++sequence}`
const language = { institutionType: 'language_school' } as const
/** Geçerli bir T.C. kimlik numarası (denetim haneleri doğru, gerçek kişiye ait değil). */
const NATIONAL_ID = '10000000146'

const enrollment = (prospectId: string, overrides: Record<string, unknown> = {}) => ({
  prospectId,
  classId: 'c1',
  totalCents: 3_600_000,
  count: 3,
  startDate: '2026-11-15',
  ...overrides,
})
const prospectOf = (state: State, prospectId: string) => {
  const found = state.prospects.find((p) => p.id === prospectId)
  assert.ok(found, prospectId)
  return found
}
const parentOf = (state: State, parentId: string) => {
  const found = state.parents.find((p) => p.id === parentId)
  assert.ok(found, parentId)
  return found
}
const codeIs = (code: string, path?: string) => (error: unknown) =>
  error instanceof DomainError &&
  error.code === code &&
  (path === undefined || error.path?.join('.') === path)
/** Başarısız işlem hiçbir kesin kayıt koleksiyonunu değiştirmez. */
function unchangedOnFailure(state: State, action: () => unknown, check: (e: unknown) => boolean) {
  const watched = () =>
    JSON.stringify([
      state.prospects,
      state.students,
      state.parents,
      state.invoices,
      state.contracts,
    ])
  const before = watched()
  assert.throws(action, check)
  assert.equal(watched(), before)
}

// --- Kuruş --------------------------------------------------------------------------------------

test('core-kurus: tutar kuruş tamsayıdır; kuruşlu toplam taksitlere kuruşu kuruşuna dağılır', () => {
  const state = seed()
  const { student, contract } = enrollProspect(
    state,
    enrollment('pr1', { totalCents: 1_250_050 }),
    id,
    now,
  )
  const amounts = state.invoices.filter((i) => i.studentId === student.id).map((i) => i.amount)
  assert.deepEqual(amounts, [416_684, 416_683, 416_683])
  assert.equal(contract.amount, 1_250_050)
})

test('core-kurus: lira veya metin tutar core girdisinde kabul edilmez', () => {
  const state = seed()
  for (const overrides of [
    { totalCents: '3600000' },
    { totalCents: 36000.5 },
    { totalCents: 9_999 },
    { totalCents: 100_000_001 },
    { totalCents: undefined, total: 36000 },
  ])
    unchangedOnFailure(
      state,
      () => enrollProspect(state, enrollment('pr1', overrides), id, now),
      (error) => error instanceof Error && error.name === 'ZodError',
    )
})

test('core-kurus: çevrimdışı demo formu tam lirayı kuruşa çevirir ve kampüs onayını korur', () => {
  assert.deepEqual(
    enrollmentFromRegistration({
      prospectId: 'pr2',
      classId: 'c1',
      total: '36000',
      count: '3',
      startDate: '2026-11-15',
    }),
    {
      prospectId: 'pr2',
      classId: 'c1',
      totalCents: 3_600_000,
      count: 3,
      startDate: '2026-11-15',
      allowOtherCampus: true,
    },
  )
  // Demo davranışı: başka kampüsün adayı c1'e kaydedilir, taksit toplamı kuruştur.
  const state = seed()
  const { contract } = enrollProspect(
    state,
    enrollmentFromRegistration({
      prospectId: 'pr2',
      classId: 'c1',
      total: 28501,
      count: 6,
      startDate: '2026-01-31',
    }),
    id,
    now,
  )
  assert.equal(contract.amount, 2_850_100)
})

// --- Kampüs -------------------------------------------------------------------------------------

test('class_campus_mismatch: adayın kampüsünden olmayan sınıf 422; bilinçli onayla kabul edilir', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => enrollProspect(state, enrollment('pr2'), id, now),
    codeIs('class_campus_mismatch', 'classId'),
  )
  unchangedOnFailure(
    state,
    () => enrollProspect(state, enrollment('pr2', { allowOtherCampus: false }), id, now),
    codeIs('class_campus_mismatch'),
  )
  const { student } = enrollProspect(state, enrollment('pr2', { allowOtherCampus: true }), id, now)
  assert.equal(student.classId, 'c1')
  assert.equal(prospectOf(state, 'pr2').stage, 'Kayıt oldu')
  // Aynı kampüsün sınıfı onay istemez.
  enrollProspect(state, enrollment('pr1'), id, now)
})

// --- 18 yaş altı iletişim (DOM-KAY-003) -------------------------------------------------------

test('DOM-KAY-003: okulda iletişim bilgisi ve veli adı veliye yazılır, öğrenciye yazılmaz', () => {
  const state = seed()
  const pr1 = prospectOf(state, 'pr1')
  pr1.guardianName = 'Gül Güven'
  const parents = state.parents.length
  const { student, parent, contract } = enrollProspect(state, enrollment('pr1'), id, now)
  assert.equal(student.phone, '')
  assert.equal(student.email, '')
  assert.equal(state.parents.length, parents + 1)
  assert.deepEqual(parentOf(state, student.parentId), {
    id: student.parentId,
    name: 'Gül Güven',
    studentIds: [student.id],
    phone: pr1.phone,
    email: pr1.email,
  })
  assert.equal(parent.id, student.parentId)
  assert.equal(contract.payer, 'guardian')
  assert.equal(contract.title, ENROLLMENT_CONTRACT_TITLES.school)
})

test('DOM-KAY-003: veli adı olmayan eski adayda veli "<ad> velisi" olur; boş e-posta yazılmaz', () => {
  const state = seed()
  const pr1 = prospectOf(state, 'pr1')
  pr1.email = ''
  const { student } = enrollProspect(state, enrollment('pr1'), id, now)
  const parent = parentOf(state, student.parentId)
  assert.equal(parent.name, `${pr1.name} velisi`)
  assert.equal(parent.phone, pr1.phone)
  assert.equal('email' in parent, false)
})

test('DOM-KAY-003, DOM-KAY-009: dil okulunda 18 yaş altı adayın iletişimi veliye, yetişkininki kursiyere yazılır', () => {
  const state = seed()
  const minor = prospectOf(state, 'pr1')
  Object.assign(minor, { minor: true, guardianName: 'Gül Güven' })
  const adult = prospectOf(state, 'pr4')
  adult.minor = false
  const young = enrollProspect(state, enrollment('pr1'), id, now, language)
  assert.equal(young.student.phone, '')
  assert.equal(parentOf(state, young.student.parentId).phone, minor.phone)
  assert.equal(young.contract.payer, 'guardian')
  assert.equal(young.contract.title, 'Dil kursu eğitim sözleşmesi')

  const grown = enrollProspect(state, enrollment('pr4'), id, now, language)
  assert.equal(grown.student.phone, adult.phone)
  assert.equal(grown.student.email, adult.email)
  const parent = parentOf(state, grown.student.parentId)
  assert.equal('phone' in parent, false)
  assert.equal('email' in parent, false)
  assert.equal(grown.contract.payer, 'student')
  assert.equal(grown.contract.title, ENROLLMENT_CONTRACT_TITLES.language_school)
})

// --- Yaş sınırı ve DOM-KAY-012 alanları --------------------------------------------------------

test('DOM-KAY-012: yaş Europe/Istanbul gününe göre hesaplanır; 18. doğum günü sınırı', () => {
  assert.equal(ageOn('2008-10-06', now), 18)
  assert.equal(ageOn('2008-10-07', now), 17)
  // 2026-10-06T22:00Z İstanbul'da 7 Ekim'dir.
  assert.equal(ageOn('2008-10-07', '2026-10-06T22:00:00.000Z'), 18)
  assert.equal(ageOn('2010-02-28', '2026-02-27T12:00:00.000Z'), 15)
  assert.equal(ageOn('2010-02-28', '2026-02-28T12:00:00.000Z'), 16)
})

test('DOM-KAY-012: dil okulunda doğum tarihi adayın 18 yaş seçimiyle uyuşmalı; eski adayda yaşı belirler', () => {
  const state = seed()
  const adult = prospectOf(state, 'pr4')
  adult.minor = false
  // 17 yaşındaki doğum tarihi yetişkin seçimiyle uyuşmaz.
  unchangedOnFailure(
    state,
    () => enrollProspect(state, enrollment('pr4', { birthDate: '2008-10-07' }), id, now, language),
    codeIs('birth_date_minor_mismatch', 'birthDate'),
  )
  unchangedOnFailure(
    state,
    () => enrollProspect(state, enrollment('pr4', { birthDate: '2027-01-01' }), id, now, language),
    codeIs('invalid_birth_date', 'birthDate'),
  )
  const { student } = enrollProspect(
    state,
    enrollment('pr4', { birthDate: '2008-10-06' }),
    id,
    now,
    language,
  )
  assert.equal(student.birthDate, '2008-10-06')
  assert.equal(student.phone, adult.phone)
  // Seçimi olmayan eski adayda doğum tarihi 18 yaş üstünü gösterirse kursiyer yetişkindir.
  const legacy = prospectOf(state, 'pr1')
  assert.equal(legacy.minor, undefined)
  const grown = enrollProspect(
    state,
    enrollment('pr1', { birthDate: '1990-05-01' }),
    id,
    now,
    language,
  )
  assert.equal(grown.student.phone, legacy.phone)
  assert.equal(grown.contract.payer, 'student')
})

test('DOM-KAY-012: okulda doğum tarihi yaş durumunu değiştirmez; öğrenci her zaman 18 yaş altıdır', () => {
  const state = seed()
  const { student, contract } = enrollProspect(
    state,
    enrollment('pr1', { birthDate: '2007-01-01' }),
    id,
    now,
  )
  assert.equal(student.phone, '')
  assert.equal(contract.payer, 'guardian')
})

test('DOM-KAY-012: kimlik no denetim haneleriyle doğrulanır; kimlik, doğum tarihi ve yakınlık öğrenciye yazılır', () => {
  assert.equal(isValidNationalId(NATIONAL_ID), true)
  for (const invalid of ['10000000145', '00000000146', '1000000014', 'abcdefghijk', '10000000156'])
    assert.equal(isValidNationalId(invalid), false, invalid)
  const state = seed()
  for (const nationalId of ['10000000145', '1234', '00000000000'])
    unchangedOnFailure(
      state,
      () => enrollProspect(state, enrollment('pr1', { nationalId }), id, now),
      (error) => error instanceof Error && error.name === 'ZodError',
    )
  const { student } = enrollProspect(
    state,
    enrollment('pr1', {
      nationalId: NATIONAL_ID,
      birthDate: '2013-04-12',
      guardianRelation: 'mother',
      payer: 'guardian',
    }),
    id,
    now,
  )
  assert.equal(student.nationalId, NATIONAL_ID)
  assert.equal(student.birthDate, '2013-04-12')
  assert.equal(student.guardianRelation, 'mother')
})

test('DOM-KAY-012: 18 yaş altında ödeyici veli, yetişkin kursiyerde kendisidir; yetişkinde veli alanı alınmaz', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => enrollProspect(state, enrollment('pr1', { payer: 'student' }), id, now),
    codeIs('payer_must_be_guardian', 'payer'),
  )
  const adult = prospectOf(state, 'pr4')
  adult.minor = false
  unchangedOnFailure(
    state,
    () => enrollProspect(state, enrollment('pr4', { payer: 'guardian' }), id, now, language),
    codeIs('payer_must_be_student', 'payer'),
  )
  for (const [field, value] of [
    ['guardianRelation', 'father'],
    ['parentId', 'p1'],
  ] as const)
    unchangedOnFailure(
      state,
      () => enrollProspect(state, enrollment('pr4', { [field]: value }), id, now, language),
      codeIs('guardian_not_applicable', field),
    )
})

// --- Kardeş (DOM-KAY-013) ------------------------------------------------------------------------

test('DOM-KAY-013: kardeş adayın kayıtlı öğrencisinin velisi kullanılır; yeni veli açılmaz', () => {
  const state = seed()
  prospectOf(state, 'pr4').siblingOfId = 'pr1'
  const first = enrollProspect(state, enrollment('pr1'), id, now)
  const parents = state.parents.length
  const second = enrollProspect(state, enrollment('pr4'), id, now)
  assert.equal(state.parents.length, parents)
  assert.equal(second.student.parentId, first.student.parentId)
  assert.deepEqual(parentOf(state, first.student.parentId).studentIds, [
    first.student.id,
    second.student.id,
  ])
  assert.equal(second.parent.id, first.parent.id)
})

test('DOM-KAY-013: kardeş ilişkisi ters yönde de bulunur (önce kardeşi işaretlenen aday kaydolur)', () => {
  const state = seed()
  prospectOf(state, 'pr4').siblingOfId = 'pr1'
  const first = enrollProspect(state, enrollment('pr4'), id, now)
  const parents = state.parents.length
  const second = enrollProspect(state, enrollment('pr1'), id, now)
  assert.equal(state.parents.length, parents)
  assert.equal(second.student.parentId, first.student.parentId)
})

test('DOM-KAY-013: açıkça seçilen mevcut veliye bağlanır; veli verisi değişmez; olmayan veli 404', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => enrollProspect(state, enrollment('pr1', { parentId: 'p-yok' }), id, now),
    (error) =>
      codeIs('parent_not_found', 'parentId')(error) &&
      error instanceof DomainError &&
      error.kind === 'not_found',
  )
  const parents = state.parents.length
  const { student } = enrollProspect(state, enrollment('pr1', { parentId: 'p1' }), id, now)
  assert.equal(state.parents.length, parents)
  const ayse = parentOf(state, 'p1')
  assert.deepEqual(ayse, { id: 'p1', name: 'Ayşe Yılmaz', studentIds: ['s1', 's2', student.id] })
  assert.equal(student.parentId, 'p1')
  assert.equal(student.phone, '')
})

test('DOM-KAY-013: iletişim eşleşmesi otomatik birleştirmez; kardeş işareti yoksa yeni veli açılır', () => {
  const state = seed()
  const first = enrollProspect(state, enrollment('pr1'), id, now)
  const pr4 = prospectOf(state, 'pr4')
  pr4.phone = prospectOf(state, 'pr1').phone
  const second = enrollProspect(state, enrollment('pr4'), id, now)
  assert.notEqual(second.student.parentId, first.student.parentId)
})
