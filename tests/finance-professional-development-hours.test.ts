import assert from 'node:assert/strict'
import test from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import { professionalDevelopmentEnrollmentUpdateSchema } from '../packages/school-core/src/lib/finance-professional-development.ts'
import {
  assertAttendanceKeepsDocuments,
  assertCertificateLink,
  assertDocumentAllowed,
  assertDocumentFile,
  assertGoalLink,
  attendanceDay,
  FINANCE_PROFESSIONAL_DEVELOPMENT_HOURS_ROLES,
  hoursProgress,
  PROFESSIONAL_DEVELOPMENT_DOCUMENT_MAX_BYTES,
  professionalDevelopmentCertificateInputSchema,
  professionalDevelopmentDocumentInputSchema,
  professionalDevelopmentTargetInputSchema,
  professionalDevelopmentYearOf,
  professionalDevelopmentYearRange,
  targetAppliesTo,
} from '../packages/school-core/src/lib/finance-professional-development-hours.ts'

/** Mesleki gelişim saati, belge ve sertifika kuralları (DOM-FIN-144; ON-215; K-487…K-489). */

const FILE_ID = '00000000-0000-4000-8000-000000000001'
const DOC_ID = '00000000-0000-4000-8000-000000000002'

function rejects(run: () => void, code: string, kind?: string) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.code, code)
    if (kind !== undefined) assert.equal(error.kind, kind)
    return true
  })
}

test('DOM-FIN-144: K-487 hedef ayarı ve özeti yalnız yönetici', () => {
  assert.deepEqual([...FINANCE_PROFESSIONAL_DEVELOPMENT_HOURS_ROLES], ['yonetici'])
})

test('DOM-FIN-144: K-487 hedef tam saat, 1–500; roller tekilleşir, varsayılan öğretmen', () => {
  assert.deepEqual(professionalDevelopmentTargetInputSchema.parse({ targetHours: 40 }), {
    targetHours: 40,
    appliesToRoles: ['ogretmen'],
  })
  assert.deepEqual(
    professionalDevelopmentTargetInputSchema.parse({
      targetHours: null,
      appliesToRoles: ['ogretmen', 'yonetici', 'ogretmen'],
    }).appliesToRoles,
    ['ogretmen', 'yonetici'],
  )
  for (const targetHours of [0, 1.5, 501, '40'])
    assert.equal(professionalDevelopmentTargetInputSchema.safeParse({ targetHours }).success, false)
  assert.equal(
    professionalDevelopmentTargetInputSchema.safeParse({ targetHours: 10, appliesToRoles: [] })
      .success,
    false,
  )
  assert.equal(
    professionalDevelopmentTargetInputSchema.safeParse({
      targetHours: 10,
      appliesToRoles: ['ogrenci'],
    }).success,
    false,
  )
})

test('DOM-FIN-144: K-487 öğretim yılı aralığı kayıtlı yıldan, yoksa Eylül–Ağustos', () => {
  assert.deepEqual(professionalDevelopmentYearRange(2026, null), {
    startDate: '2026-09-01',
    endDate: '2027-08-31',
  })
  const registered = { startDate: '2026-09-14', endDate: '2027-06-30' }
  assert.deepEqual(professionalDevelopmentYearRange(2026, registered), registered)
  const years = [{ startYear: 2026, ...registered }]
  assert.equal(professionalDevelopmentYearOf('2026-11-21', years), 2026)
  assert.equal(professionalDevelopmentYearOf('2026-09-05', years), 2026)
  assert.equal(professionalDevelopmentYearOf('2026-09-05', []), 2026)
  assert.equal(professionalDevelopmentYearOf('2026-08-31', []), 2025)
  assert.equal(professionalDevelopmentYearOf('2027-07-15', years), 2026)
})

test('DOM-FIN-144: K-487 katılım günü bitiş günü; sürekli eğitimde işaret günü', () => {
  assert.equal(
    attendanceDay({ ongoing: false, endDate: '2026-11-11', statusChangedDay: '2026-12-01' }),
    '2026-11-11',
  )
  assert.equal(
    attendanceDay({ ongoing: true, endDate: null, statusChangedDay: '2026-12-01' }),
    '2026-12-01',
  )
})

test('DOM-FIN-144: K-487 tamamlanan, hedef ve eksik saat', () => {
  assert.deepEqual(hoursProgress({ completedMinutes: 90, targetMinutes: null }), {
    completedHours: 1.5,
    targetHours: null,
    missingHours: null,
    met: null,
  })
  assert.deepEqual(hoursProgress({ completedMinutes: 90, targetMinutes: 240 }), {
    completedHours: 1.5,
    targetHours: 4,
    missingHours: 2.5,
    met: false,
  })
  assert.deepEqual(hoursProgress({ completedMinutes: 300, targetMinutes: 240 }), {
    completedHours: 5,
    targetHours: 4,
    missingHours: 0,
    met: true,
  })
  assert.equal(targetAppliesTo(null, 'ogretmen'), false)
  assert.equal(targetAppliesTo({ appliesToRoles: ['ogretmen'] }, 'ogretmen'), true)
  assert.equal(targetAppliesTo({ appliesToRoles: ['ogretmen'] }, 'onburo'), false)
})

test('DOM-FIN-144: K-488 belge yalnız katıldı atamaya; PDF ve en çok 10 MB', () => {
  assertDocumentAllowed('attended')
  rejects(() => assertDocumentAllowed('assigned'), 'professional_development_document_not_attended')
  rejects(
    () => assertDocumentAllowed('not_completed'),
    'professional_development_document_not_attended',
  )
  assertDocumentFile({
    mimeType: 'application/pdf',
    byteSize: PROFESSIONAL_DEVELOPMENT_DOCUMENT_MAX_BYTES,
  })
  rejects(
    () => assertDocumentFile({ mimeType: 'image/png', byteSize: 10 }),
    'professional_development_document_format',
  )
  rejects(
    () =>
      assertDocumentFile({
        mimeType: 'application/pdf',
        byteSize: PROFESSIONAL_DEVELOPMENT_DOCUMENT_MAX_BYTES + 1,
      }),
    'professional_development_document_too_large',
  )
  assert.deepEqual(professionalDevelopmentDocumentInputSchema.parse({ fileId: FILE_ID }), {
    fileId: FILE_ID,
  })
  assert.equal(professionalDevelopmentDocumentInputSchema.safeParse({ fileId: 'x' }).success, false)
})

test('DOM-FIN-144: K-488 sertifika var olan özlük belgesine ya da yüklemeden', () => {
  assert.deepEqual(
    professionalDevelopmentCertificateInputSchema.parse({
      source: 'existing',
      staffDocumentId: DOC_ID,
    }),
    { source: 'existing', staffDocumentId: DOC_ID },
  )
  assert.deepEqual(
    professionalDevelopmentCertificateInputSchema.parse({
      source: 'upload',
      fileId: FILE_ID,
      documentDate: '2026-11-11',
    }),
    { source: 'upload', fileId: FILE_ID, documentDate: '2026-11-11', validUntil: null },
  )
  assert.equal(
    professionalDevelopmentCertificateInputSchema.safeParse({ source: 'upload', fileId: FILE_ID })
      .success,
    false,
  )
  assert.equal(
    professionalDevelopmentCertificateInputSchema.safeParse({
      source: 'existing',
      staffDocumentId: DOC_ID,
      fileId: FILE_ID,
    }).success,
    false,
  )
  assert.equal(professionalDevelopmentCertificateInputSchema.safeParse({}).success, false)

  const base = {
    enrollmentMembershipId: 'm1',
    hasCertificate: false,
    document: { membershipId: 'm1', documentType: 'certificate', superseded: false },
    linkedElsewhere: false,
  }
  assertCertificateLink(base)
  rejects(
    () => assertCertificateLink({ ...base, hasCertificate: true }),
    'professional_development_certificate_exists',
    'conflict',
  )
  rejects(
    () => assertCertificateLink({ ...base, document: null }),
    'professional_development_certificate_not_found',
  )
  rejects(
    () => assertCertificateLink({ ...base, document: { ...base.document, membershipId: 'm2' } }),
    'professional_development_certificate_not_found',
  )
  rejects(
    () =>
      assertCertificateLink({ ...base, document: { ...base.document, documentType: 'diploma' } }),
    'professional_development_certificate_wrong_type',
  )
  rejects(
    () => assertCertificateLink({ ...base, document: { ...base.document, superseded: true } }),
    'professional_development_certificate_superseded',
  )
  rejects(
    () => assertCertificateLink({ ...base, linkedElsewhere: true }),
    'professional_development_certificate_linked',
    'conflict',
  )
})

test('DOM-FIN-144: K-488 belgesi olan katılım katıldıdan çıkarılamaz', () => {
  assertAttendanceKeepsDocuments({
    nextStatus: 'attended',
    hasDocument: true,
    hasCertificate: true,
  })
  assertAttendanceKeepsDocuments({
    nextStatus: 'not_completed',
    hasDocument: false,
    hasCertificate: false,
  })
  rejects(
    () =>
      assertAttendanceKeepsDocuments({
        nextStatus: 'assigned',
        hasDocument: true,
        hasCertificate: false,
      }),
    'professional_development_attendance_has_documents',
    'conflict',
  )
  rejects(
    () =>
      assertAttendanceKeepsDocuments({
        nextStatus: 'not_completed',
        hasDocument: false,
        hasCertificate: true,
      }),
    'professional_development_attendance_has_documents',
  )
})

test('DOM-FIN-144: K-489 gelişim hedefi aynı personelin açık ya da süren hedefi', () => {
  assertGoalLink({ enrollmentMembershipId: 'm1', goal: { membershipId: 'm1', status: 'open' } })
  assertGoalLink({
    enrollmentMembershipId: 'm1',
    goal: { membershipId: 'm1', status: 'in_progress' },
  })
  rejects(
    () => assertGoalLink({ enrollmentMembershipId: 'm1', goal: null }),
    'professional_development_goal_not_found',
  )
  rejects(
    () =>
      assertGoalLink({
        enrollmentMembershipId: 'm1',
        goal: { membershipId: 'm2', status: 'open' },
      }),
    'professional_development_goal_not_found',
  )
  for (const status of ['achieved', 'dropped'])
    rejects(
      () => assertGoalLink({ enrollmentMembershipId: 'm1', goal: { membershipId: 'm1', status } }),
      'professional_development_goal_closed',
    )
  // Verilmezse bağ değişmez, `null` kaldırır.
  const base = { status: 'attended', attendedHours: 2 }
  assert.equal(
    professionalDevelopmentEnrollmentUpdateSchema.parse(base).developmentGoalId,
    undefined,
  )
  assert.equal(
    professionalDevelopmentEnrollmentUpdateSchema.parse({ ...base, developmentGoalId: null })
      .developmentGoalId,
    null,
  )
  assert.equal(
    professionalDevelopmentEnrollmentUpdateSchema.safeParse({ ...base, developmentGoalId: 'x' })
      .success,
    false,
  )
})
