import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  enrollmentFormToBody,
  GUARDIAN_NOT_APPLICABLE_FORM_MESSAGE,
  GUARDIAN_REQUIRED_FORM_MESSAGE,
  type EnrollmentFormValues,
} from '@kampus/school-core/lib/enrollment.ts'
import {
  enrollmentServerError,
  guardianModeFor,
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
  const reset = prospectChangeValues(FORM, 'school', NOW)
  assert.deepEqual(reset, {
    classId: '',
    confirmOtherCampus: false,
    existingParentId: '',
    guardianName: '',
    guardianPhone: '',
    guardianMode: 'new',
    studentPhone: '',
    studentEmail: '',
  })
  // A adayının başka kampüs onayı B adayının gövdesine `allowOtherCampus` olarak gitmez.
  const next = { ...FORM, ...reset, prospectId: 'pr-b', classId: 'c1' }
  assert.equal('allowOtherCampus' in enrollmentFormToBody(next, 'tarife'), false)
  // Girilmiş doğum tarihi yetişkin kursiyeri gösteriyorsa varsayılan "kendisi"dir (DOM-KAY-012).
  assert.equal(
    prospectChangeValues({ birthDate: ADULT }, 'language_school', NOW).guardianMode,
    'self',
  )
  assert.equal(prospectChangeValues({ birthDate: ADULT }, 'school', NOW).guardianMode, 'new')
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
