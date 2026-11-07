import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  academicYearLabel,
  buildEnrollmentCertificate,
  ENROLLMENT_CERTIFICATE_FAMILY_ROLES,
  ENROLLMENT_CERTIFICATE_ROLES,
  enrollmentCertificateSchema,
  type EnrollmentCertificateInput,
} from '../packages/school-core/src/lib/enrollment-certificate.ts'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'

const NOW = new Date('2026-10-06T22:30:00.000Z')
const input = (
  overrides: Partial<EnrollmentCertificateInput> = {},
): EnrollmentCertificateInput => ({
  documentId: '3f2a6c1e-8b7d-4a55-9c31-2d4e6f708192',
  issuedAt: NOW,
  institution: { name: 'Akademi Özel Okulları', type: 'school' },
  student: { id: 's1', name: 'Deniz Yılmaz', classId: 'c1', number: '2026001', isActive: true },
  className: '6-A',
  courseNames: [],
  academicYear: 2026,
  renewals: [],
  ...overrides,
})
const graduation = {
  id: 'r1',
  studentId: 's1',
  mode: 'graduate' as const,
  status: 'Mezun',
  year: 2026,
  fromClassId: 'c1',
  targetClassId: 'c1',
  createdAt: NOW.toISOString(),
}

test('DOM-KAY-027: aktif öğrencinin belgesi şemaya uyar', () => {
  const certificate = buildEnrollmentCertificate(input())
  assert.deepEqual(enrollmentCertificateSchema.parse(certificate), certificate)
  assert.equal(certificate.issuedAt, NOW.toISOString())
  assert.equal(certificate.schoolNumber, '2026001')
})

test('DOM-KAY-027: şema izin listesidir; kimlik ve ücret alanı kabul edilmez', () => {
  const certificate = buildEnrollmentCertificate(input())
  for (const field of ['nationalId', 'birthDate', 'balanceCents', 'parentName', 'health'])
    assert.equal(
      enrollmentCertificateSchema.safeParse({ ...certificate, [field]: 'x' }).success,
      false,
      field,
    )
})

test('DOM-KAY-027: boş ya da boşluklu numara null olur', () => {
  for (const number of [undefined, null, '', '   ']) {
    const student = { id: 's1', name: 'Deniz', classId: 'c1', number }
    assert.equal(buildEnrollmentCertificate(input({ student })).schoolNumber, null)
  }
})

test('DOM-KAY-027: alanı olmayan eski kayıt aktiftir', () => {
  const student = { id: 's1', name: 'Deniz', classId: 'c1' }
  assert.equal(buildEnrollmentCertificate(input({ student })).learnerName, 'Deniz')
})

test('DOM-KAY-027: kur adları tekilleşir ve Türkçe sıralanır', () => {
  const certificate = buildEnrollmentCertificate(
    input({ courseNames: ['Şirket İngilizcesi', 'Çocuk İngilizcesi', 'Çocuk İngilizcesi', 'A1'] }),
  )
  assert.deepEqual(certificate.courseNames, ['A1', 'Çocuk İngilizcesi', 'Şirket İngilizcesi'])
})

test('DOM-KAY-024, DOM-KAY-026: ayrılan öğrenciye belge düzenlenmez', () => {
  const student = { id: 's1', name: 'Deniz', classId: 'c1', isActive: false }
  assert.throws(
    () => buildEnrollmentCertificate(input({ student })),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === 'enrollment_certificate_inactive' &&
      error.kind === 'rule' &&
      error.message.includes('Ayrıldı'),
  )
})

test('DOM-KAY-022, DOM-KAY-026: mezun öğrenciye belge düzenlenmez', () => {
  const student = { id: 's1', name: 'Deniz', classId: 'c1', isActive: false }
  assert.throws(
    () => buildEnrollmentCertificate(input({ student, renewals: [graduation] })),
    (error: unknown) => error instanceof DomainError && error.message.includes('Mezun'),
  )
})

test('DOM-KAY-027: eğitim yılı etiketi; ayar yoksa null', () => {
  assert.equal(academicYearLabel(2026), '2026–2027')
  assert.equal(academicYearLabel(null), null)
})

test('DOM-KAY-027: personelde yalnız yönetici ve ön büro düzenler', () => {
  assert.deepEqual([...ENROLLMENT_CERTIFICATE_ROLES], ['yonetici', 'onburo'])
})

test('DOM-KAY-027, K-32: aile rolleri veli ve öğrencidir, personelle kesişmez', () => {
  assert.deepEqual([...ENROLLMENT_CERTIFICATE_FAMILY_ROLES], ['veli', 'ogrenci'])
  const staff: readonly string[] = ENROLLMENT_CERTIFICATE_ROLES
  assert.ok(ENROLLMENT_CERTIFICATE_FAMILY_ROLES.every((role) => !staff.includes(role)))
})
