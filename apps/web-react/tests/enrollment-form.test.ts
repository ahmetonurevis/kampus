import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  enrollmentFormToBody,
  GUARDIAN_NOT_APPLICABLE_FORM_MESSAGE,
  GUARDIAN_REQUIRED_FORM_MESSAGE,
  type EnrollmentFormValues,
} from '@kampus/school-core/lib/enrollment.ts'
import { navigation } from '@kampus/school-core/modules/full-navigation.ts'
import {
  enrollmentFieldForCode,
  enrollmentServerError,
  guardianModeFor,
  paymentPlanHref,
  prospectChangeValues,
} from '../src/pages/crm/enrollment-form.ts'

const NOW = '2026-10-06T09:00:00.000Z'
const ADULT = '2001-10-06'
const MINOR = '2011-10-06'

const FORM: EnrollmentFormValues = {
  prospectId: 'pr-a',
  classId: 'c-diger-kampus',
  identityKind: 'tc',
  identityNumber: '10000000146',
  birthDate: MINOR,
  guardianMode: 'existing',
  guardianName: 'A Velisi',
  guardianPhone: '05551112233',
  relationship: 'mother',
  existingParentId: 'p-a',
  studentPhone: '05551112244',
  studentEmail: 'a@kampus.example',
  lessonHours: '40',
  discounts: [],
  extras: [],
  installmentCount: '3',
  firstDueDate: '2026-11-15',
  allCampuses: true,
  confirmOtherCampus: true,
}

test('class_campus_mismatch, DOM-KAY-013: aday değişince sınıf, kampüs onayı ve veli seçimi sıfırlanır', () => {
  const reset = prospectChangeValues('school', NOW)
  assert.deepEqual(reset, {
    classId: '',
    confirmOtherCampus: false,
    identityKind: 'tc',
    identityNumber: '',
    birthDate: '',
    existingParentId: '',
    guardianName: '',
    guardianPhone: '',
    relationship: 'mother',
    guardianMode: 'new',
    studentPhone: '',
    studentEmail: '',
  })
  // A adayının başka kampüs onayı B adayının gövdesine `allowOtherCampus` olarak gitmez.
  const next = { ...FORM, ...reset, prospectId: 'pr-b', classId: 'c1' }
  assert.equal('allowOtherCampus' in enrollmentFormToBody(next, 'tarife'), false)
})

test('ON-125, DOM-KAY-012: aday değişince önceki adayın kimlik no, doğum tarihi ve kişisel alanları formda kalmaz', () => {
  // A adayı yetişkin kursiyer olarak dolduruldu: yabancı kimlik, doğum tarihi, kendi iletişimi.
  const adultA: EnrollmentFormValues = {
    ...FORM,
    identityKind: 'foreign',
    identityNumber: 'YK123456',
    birthDate: ADULT,
    guardianMode: 'self',
    relationship: 'father',
  }
  for (const type of ['school', 'language_school'] as const) {
    const next = { ...adultA, ...prospectChangeValues(type, NOW), prospectId: 'pr-b' }
    // KVKK: A'nın kimliği, doğum tarihi, veli ve iletişim bilgisi B'nin formunda yoktur.
    assert.equal(next.identityNumber, '', type)
    assert.equal(next.identityKind, 'tc', type)
    assert.equal(next.birthDate, '', type)
    assert.equal(next.guardianName, '', type)
    assert.equal(next.guardianPhone, '', type)
    assert.equal(next.relationship, 'mother', type)
    assert.equal(next.existingParentId, '', type)
    assert.equal(next.studentPhone, '', type)
    assert.equal(next.studentEmail, '', type)
    // Doğum tarihi boşalınca A'nın "kendisi" seçimi kalmaz; veli zorunlu varsayılana döner.
    assert.equal(next.guardianMode, 'new', type)
    for (const value of Object.values(next))
      assert.ok(
        !['YK123456', ADULT, 'A Velisi', '05551112233', '05551112244', 'p-a'].includes(
          String(value),
        ),
        `${type}: A adayının değeri formda kaldı (${String(value)})`,
      )
  }
  // Adaydan bağımsız alanlar (ücret ve taksit seçimi) sıfırlama listesinde değildir.
  const reset = prospectChangeValues('school', NOW)
  for (const name of ['lessonHours', 'installmentCount', 'firstDueDate', 'allCampuses'])
    assert.equal(name in reset, false, name)
})

test('DOM-KAY-012: doğum tarihi değişince veli seçimi yaşa ve kurum türüne uyar', () => {
  assert.equal(guardianModeFor('new', 'language_school', ADULT, NOW), 'self')
  assert.equal(guardianModeFor('existing', 'language_school', ADULT, NOW), 'self')
  assert.equal(guardianModeFor('self', 'language_school', MINOR, NOW), 'new')
  assert.equal(guardianModeFor('existing', 'language_school', MINOR, NOW), 'existing')
  // Okulda 18 yaş ve üstünde de veli zorunludur; "kendisi" seçilemez.
  assert.equal(guardianModeFor('self', 'school', ADULT, NOW), 'new')
  assert.equal(guardianModeFor('existing', 'school', ADULT, NOW), 'existing')
  // Doğum tarihi henüz yokken veli zorunlu sayılır.
  assert.equal(guardianModeFor('self', 'language_school', '', NOW), 'new')
})

test('DOM-KAY-012: sunucunun veli hataları "Veli ve ödeyici" alanına Türkçe iletiyle ve adımına döner', () => {
  assert.deepEqual(
    enrollmentServerError('guardian', {
      type: 'guardian_required',
      message: 'Veli bilgisi zorunludur.',
    }),
    {
      field: 'guardianMode',
      step: 1,
      type: 'guardian_required',
      message: GUARDIAN_REQUIRED_FORM_MESSAGE,
    },
  )
  assert.deepEqual(
    enrollmentServerError('guardian', { type: 'guardian_not_applicable', message: 'x' }),
    {
      field: 'guardianMode',
      step: 1,
      type: 'guardian_not_applicable',
      message: GUARDIAN_NOT_APPLICABLE_FORM_MESSAGE,
    },
  )
  // Diğer veli ve kimlik hataları sunucu iletisiyle kendi alanına gider.
  assert.deepEqual(
    enrollmentServerError('guardian', { type: 'parent_not_guardian', message: 'Veli değil.' }),
    { field: 'guardianMode', step: 1, type: 'parent_not_guardian', message: 'Veli değil.' },
  )
  assert.equal(
    enrollmentServerError('identity.birthDate', { type: 'birth_date_minor_mismatch', message: 'm' })
      .field,
    'birthDate',
  )
  assert.equal(
    enrollmentServerError('studentContact.email', { type: 'invalid_format', message: 'm' }).field,
    'studentEmail',
  )
  // Bağlanmayan yol formun genel hatasıdır; adım değişmez.
  assert.deepEqual(
    enrollmentServerError('discounts', { type: 'sibling_required', message: 'Kardeş yok.' }),
    { field: 'root.server', step: null, type: 'sibling_required', message: 'Kardeş yok.' },
  )
})

test('ON-035, DOM-KAY-035: kesin kayıttan sonra ödeme planı bağlantısı rolün taksit listesine gider', () => {
  assert.equal(paymentPlanHref('onburo'), '/onburo/tahsilat-takip')
  // Yöneticide Tahsilat Takibi yoktur; taksitler Finans & Tahsilat sayfasındadır.
  assert.equal(paymentPlanHref('yonetici'), '/yonetici/finans')
  for (const role of ['onburo', 'yonetici'] as const) {
    const path = paymentPlanHref(role)?.split('/').at(-1)
    const page = navigation[role].find((item) => item.path === path)
    assert.equal(page?.module, 'finance', `${role} menüsünde ${String(path)} finans sayfası`)
  }
  assert.equal(paymentPlanHref('ogretmen'), null)
  assert.equal(paymentPlanHref(undefined), null)
})

test('DOM-KAY-010, class_campus_mismatch: sınıf hataları sınıf alanına ve ilk adıma döner', () => {
  // `class_campus_mismatch` yollu gelir (`classId`); `class_capacity_full` yolsuzdur, koduyla bağlanır.
  assert.deepEqual(
    enrollmentServerError('classId', {
      type: 'class_campus_mismatch',
      message: 'Seçilen sınıf adayın kampüsünde değil.',
    }),
    {
      field: 'classId',
      step: 0,
      type: 'class_campus_mismatch',
      message: 'Seçilen sınıf adayın kampüsünde değil.',
    },
  )
  assert.equal(enrollmentFieldForCode('class_capacity_full'), 'classId')
  assert.deepEqual(
    enrollmentServerError(enrollmentFieldForCode('class_capacity_full') ?? '', {
      type: 'class_capacity_full',
      message: 'Seçilen sınıfın kontenjanı dolu.',
    }),
    {
      field: 'classId',
      step: 0,
      type: 'class_capacity_full',
      message: 'Seçilen sınıfın kontenjanı dolu.',
    },
  )
  // Başka kodlar alana bağlanmaz; toast'ta kalır.
  assert.equal(enrollmentFieldForCode('tariff_changed'), undefined)
})
