import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_STAFF_DOCUMENT_SETTINGS,
  isStaffDocumentRestricted,
  missingStaffDocumentTypes,
  planStaffDocument,
  requiredStaffDocumentTypes,
  resolveStaffDocumentSettings,
  staffDocumentInputSchema,
  staffDocumentSettingsUpdateSchema,
  staffDocumentStatus,
  staffDocumentValidUntil,
  type StaffDocumentChecks,
  type StaffDocumentInput,
} from '../packages/school-core/src/lib/finance-staff-documents.ts'

import { isDomainError } from './support/domain-error.ts'

// Özlük belgeleri ve geçerlilik takibi (DOM-FIN-113; ON-173). Kararlar K-372…K-374.

const TODAY = '2026-10-06'
const SETTINGS = resolveStaffDocumentSettings({})
const CRIMINAL: StaffDocumentInput = {
  membershipId: 'm-selin',
  documentType: 'criminal_record',
  documentDate: '2026-09-15',
}
const CERTIFICATE: StaffDocumentInput = {
  membershipId: 'm-selin',
  documentType: 'certificate',
  documentDate: '2026-05-01',
  note: 'CELTA',
}
const checks = (overrides: Partial<StaffDocumentChecks> = {}): StaffDocumentChecks => ({
  staff: { role: 'ogretmen', active: true },
  settings: SETTINGS,
  current: [],
  actorRole: 'yonetici',
  today: TODAY,
  ...overrides,
})
const plan = (input: StaffDocumentInput, overrides: Partial<StaffDocumentChecks> = {}) =>
  planStaffDocument(staffDocumentInputSchema.parse(input), checks(overrides))

test('DOM-FIN-113: varsayılan ayarlar ve kanunen özel nitelikli türün işareti kalkmaz (K-372)', () => {
  assert.deepEqual(requiredStaffDocumentTypes(SETTINGS), [
    'diploma',
    'health_report',
    'criminal_record',
    'id_copy',
  ])
  assert.equal(SETTINGS.criminal_record.validityMonths, 6)
  const stored = resolveStaffDocumentSettings({
    criminal_record: { required: false, validityMonths: 12, sensitive: false },
    certificate: { required: true, validityMonths: 24, sensitive: true },
  })
  assert.deepEqual(stored.criminal_record, { required: false, validityMonths: 12, sensitive: true })
  assert.deepEqual(stored.certificate, { required: true, validityMonths: 24, sensitive: true })
  assert.deepEqual(stored.diploma, DEFAULT_STAFF_DOCUMENT_SETTINGS.diploma)
})

test('DOM-FIN-113: tür ayarı şeması en az bir tür ister, süre 1–120 ay, özel nitelik kaldırılamaz', () => {
  assert.equal(staffDocumentSettingsUpdateSchema.safeParse({}).success, false)
  assert.equal(
    staffDocumentSettingsUpdateSchema.safeParse({
      certificate: { required: true, validityMonths: 121, sensitive: false },
    }).success,
    false,
  )
  const unflag = staffDocumentSettingsUpdateSchema.safeParse({
    health_report: { required: true, validityMonths: 60, sensitive: false },
  })
  assert.equal(unflag.success, false)
  assert.deepEqual(unflag.error?.issues[0]?.path, ['health_report', 'sensitive'])
  assert.equal(
    staffDocumentSettingsUpdateSchema.safeParse({ unknown: {} }).success,
    false,
    'bilinmeyen tür reddedilir',
  )
  const parsed = staffDocumentSettingsUpdateSchema.parse({
    criminal_record: { required: true, validityMonths: 12, sensitive: true },
  })
  assert.deepEqual(parsed.criminal_record, { required: true, validityMonths: 12, sensitive: true })
})

test('DOM-FIN-113: belge şeması sağlık raporu türünü ve geçerlilik bitişini denetler', () => {
  const health = { membershipId: 'm', documentType: 'health_report', documentDate: TODAY }
  assert.equal(staffDocumentInputSchema.safeParse(health).success, false)
  assert.equal(
    staffDocumentInputSchema.safeParse({ ...health, healthReportKind: 'periodic' }).success,
    true,
  )
  assert.equal(
    staffDocumentInputSchema.safeParse({ ...CRIMINAL, healthReportKind: 'periodic' }).success,
    false,
  )
  const before = staffDocumentInputSchema.safeParse({ ...CERTIFICATE, validUntil: '2026-04-30' })
  assert.deepEqual(before.error?.issues[0]?.path, ['validUntil'])
  assert.equal(staffDocumentInputSchema.parse({ ...CERTIFICATE, note: '  ' }).note, null)
})

test('DOM-FIN-113: geçerlilik bitişi türden hesaplanır, ay sonu taşmaz', () => {
  assert.equal(staffDocumentValidUntil('2026-01-15', 6), '2026-07-15')
  assert.equal(staffDocumentValidUntil('2025-08-31', 6), '2026-02-28')
  assert.equal(staffDocumentValidUntil('2026-01-15', null), null)
})

test('DOM-FIN-113: durum bugüne göre; bitiş günü dahil, yaklaşma penceresi seçilebilir', () => {
  const doc = (validUntil: string | null, supersededAt: string | null = null) => ({
    validUntil,
    supersededAt,
  })
  assert.deepEqual(staffDocumentStatus(doc(null), TODAY), { status: 'valid', daysLeft: null })
  assert.deepEqual(staffDocumentStatus(doc('2026-10-06'), TODAY), {
    status: 'expiring',
    daysLeft: 0,
  })
  assert.deepEqual(staffDocumentStatus(doc('2026-10-05'), TODAY), {
    status: 'expired',
    daysLeft: -1,
  })
  assert.deepEqual(staffDocumentStatus(doc('2026-11-05'), TODAY), {
    status: 'expiring',
    daysLeft: 30,
  })
  assert.equal(staffDocumentStatus(doc('2026-11-06'), TODAY).status, 'valid')
  assert.equal(staffDocumentStatus(doc('2026-11-06'), TODAY, 31).status, 'expiring')
  assert.equal(
    staffDocumentStatus(doc('2026-01-01', '2026-02-01T00:00:00Z'), TODAY).status,
    'superseded',
  )
})

test('DOM-FIN-113: eksik zorunlu belgeler yerine geçilmemiş belgeye bakar; süresi geçen eksik sayılmaz', () => {
  assert.deepEqual(
    missingStaffDocumentTypes(SETTINGS, [
      { documentType: 'diploma', supersededAt: null },
      { documentType: 'criminal_record', supersededAt: '2026-01-01T00:00:00Z' },
      { documentType: 'certificate', supersededAt: null },
    ]),
    ['health_report', 'criminal_record', 'id_copy'],
  )
})

test('DOM-FIN-113: özel nitelikli belgenin dosyası listede herkese, ayrıntıda yönetici dışına gizli (K-374)', () => {
  assert.equal(isStaffDocumentRestricted(false, 'onburo', 'list'), false)
  assert.equal(isStaffDocumentRestricted(true, 'yonetici', 'list'), true)
  assert.equal(isStaffDocumentRestricted(true, 'yonetici', 'detail'), false)
  assert.equal(isStaffDocumentRestricted(true, 'onburo', 'detail'), true)
})

test('DOM-FIN-113: yeni belgede bitiş türden ya da elle; tekil türde geçerli belgenin yerine geçer (K-373)', () => {
  assert.deepEqual(plan(CRIMINAL), {
    validUntil: '2027-03-15',
    validUntilSource: 'type',
    supersedes: null,
    sensitive: true,
  })
  assert.deepEqual(plan({ ...CRIMINAL, validUntil: '2026-12-31' }), {
    validUntil: '2026-12-31',
    validUntilSource: 'manual',
    supersedes: null,
    sensitive: true,
  })
  const current = [{ id: 'old', documentDate: '2026-03-01' }]
  assert.equal(plan(CRIMINAL, { current }).supersedes, 'old')
  assert.equal(plan({ ...CRIMINAL, replacesDocumentId: null }, { current }).supersedes, 'old')
  assert.throws(
    () => plan({ ...CRIMINAL, replacesDocumentId: crypto.randomUUID() }, { current }),
    isDomainError('staff_document_replace_not_found'),
  )
  assert.throws(
    () => plan({ ...CRIMINAL, documentDate: '2026-02-01' }, { current }),
    isDomainError('staff_document_older_than_current'),
  )
})

test('DOM-FIN-113: çoklu türde yerine geçme yalnız seçilince (K-373)', () => {
  const id = crypto.randomUUID()
  const current = [{ id, documentDate: '2025-05-01' }]
  assert.equal(plan(CERTIFICATE, { current }).supersedes, null)
  assert.equal(plan({ ...CERTIFICATE, replacesDocumentId: id }, { current }).supersedes, id)
  assert.throws(
    () => plan({ ...CERTIFICATE, replacesDocumentId: crypto.randomUUID() }, { current }),
    isDomainError('staff_document_replace_not_found'),
  )
  assert.equal(plan(CERTIFICATE).validUntil, null)
})

test('DOM-FIN-113: personel, gelecek tarih, özel nitelikli tür ve not kuralları', () => {
  assert.throws(
    () => plan(CRIMINAL, { staff: null }),
    isDomainError('staff_document_staff_not_found'),
  )
  assert.throws(
    () => plan(CRIMINAL, { staff: { role: 'veli', active: true } }),
    isDomainError('staff_document_not_staff'),
  )
  assert.throws(
    () => plan(CRIMINAL, { staff: { role: 'onburo', active: false } }),
    isDomainError('staff_document_staff_inactive'),
  )
  assert.throws(
    () => plan({ ...CERTIFICATE, documentDate: '2026-10-07' }),
    isDomainError('staff_document_date_in_future'),
  )
  assert.throws(
    () => plan(CRIMINAL, { actorRole: 'onburo' }),
    isDomainError('staff_document_sensitive_forbidden', 'forbidden'),
  )
  assert.equal(plan(CERTIFICATE, { actorRole: 'onburo' }).sensitive, false)
  assert.throws(
    () => plan({ ...CRIMINAL, note: 'Kaydı temiz' }),
    isDomainError('staff_document_sensitive_note'),
  )
  const flagged = resolveStaffDocumentSettings({
    certificate: { required: false, validityMonths: null, sensitive: true },
  })
  assert.throws(
    () => plan({ ...CERTIFICATE, note: null }, { settings: flagged, actorRole: 'onburo' }),
    isDomainError('staff_document_sensitive_forbidden', 'forbidden'),
  )
})
