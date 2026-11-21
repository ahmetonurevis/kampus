import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  StaffDocument,
  StaffDocumentTypeSettingRow,
} from '@kampus/react-shared/use-finance-staff-documents.ts'

import {
  alertBadges,
  documentTitle,
  missingText,
  replaceOptions,
  sortDocuments,
  staffDocumentBody,
  staffDocumentDefaults,
  staffDocumentFormField,
  staffDocumentFormSchema,
  typeSettingsBody,
  typeSettingsDefaults,
  validityText,
} from '../src/pages/finance/finance-staff-document-forms.ts'

// Özlük belgesi formu ve gösterimi (DOM-FIN-113; ON-173).

const DOC: StaffDocument = {
  id: 'd-1',
  membershipId: 'm-1',
  documentType: 'certificate',
  healthReportKind: null,
  documentDate: '2026-05-01',
  validUntil: '2026-10-20',
  validUntilSource: 'manual',
  status: 'expiring',
  daysLeft: 14,
  sensitive: false,
  restricted: false,
  hasFile: false,
  file: null,
  note: null,
  replacesId: null,
  supersededAt: null,
  createdAt: '2026-05-01T09:00:00.000Z',
}

test('DOM-FIN-113: belge başlığı ve geçerlilik metni', () => {
  assert.equal(documentTitle(DOC), 'Sertifika / kurs belgesi')
  assert.equal(
    documentTitle({ documentType: 'health_report', healthReportKind: 'periodic' }),
    'Sağlık raporu · Periyodik',
  )
  assert.equal(validityText(DOC), '20 Eki 2026 bitiş · 14 gün kaldı')
  assert.equal(validityText({ ...DOC, daysLeft: 0 }), '20 Eki 2026 bitiş · bugün son gün')
  assert.equal(
    validityText({ ...DOC, daysLeft: -3, status: 'expired' }),
    '20 Eki 2026 bitiş · 3 gün geçti',
  )
  assert.equal(validityText({ ...DOC, status: 'superseded' }), '20 Eki 2026 bitiş')
  assert.equal(validityText({ ...DOC, validUntil: null, daysLeft: null }), 'Süresiz')
})

test('DOM-FIN-113: uyarı rozetleri sıfırları göstermez; eksik metni', () => {
  assert.deepEqual(alertBadges(undefined), [])
  assert.deepEqual(
    alertBadges({ withinDays: 30, expiredCount: 2, expiringCount: 0, staffMissingCount: 1 }).map(
      (badge) => badge.text,
    ),
    ['2 belgenin süresi geçti', '1 personelin zorunlu belgesi eksik'],
  )
  assert.equal(missingText([]), null)
  assert.equal(
    missingText(['diploma', 'id_copy']),
    'Diploma / mezuniyet belgesi, Kimlik fotokopisi',
  )
})

test('DOM-FIN-113: geçmiş sıralaması ve çoklu türde yerine geçme seçenekleri', () => {
  const old = {
    ...DOC,
    id: 'd-0',
    documentDate: '2024-01-01',
    supersededAt: '2025-01-01T00:00:00Z',
  }
  const diploma = { ...DOC, id: 'd-2', documentType: 'diploma' as const }
  assert.deepEqual(
    sortDocuments([old, DOC, diploma]).map((doc) => doc.id),
    ['d-2', 'd-1', 'd-0'],
  )
  assert.deepEqual(
    replaceOptions([old, DOC, diploma], 'certificate').map((doc) => doc.id),
    ['d-1'],
  )
  assert.deepEqual(replaceOptions([DOC], 'criminal_record'), [])
})

test('DOM-FIN-113: form şeması ve gövde', () => {
  const values = staffDocumentDefaults('2026-10-06')
  assert.equal(staffDocumentFormSchema.safeParse(values).success, true)
  const health = staffDocumentFormSchema.safeParse({ ...values, documentType: 'health_report' })
  assert.deepEqual(health.error?.issues[0]?.path, ['healthReportKind'])
  const before = staffDocumentFormSchema.safeParse({ ...values, validUntil: '2026-01-01' })
  assert.deepEqual(before.error?.issues[0]?.path, ['validUntil'])
  assert.deepEqual(
    staffDocumentBody(
      'm-1',
      {
        ...values,
        documentType: 'certificate',
        healthReportKind: 'periodic',
        note: ' CELTA ',
        replacesDocumentId: 'd-1',
      },
      'f-1',
    ),
    {
      membershipId: 'm-1',
      documentType: 'certificate',
      healthReportKind: null,
      documentDate: '2026-10-06',
      validUntil: null,
      fileId: 'f-1',
      note: 'CELTA',
      replacesDocumentId: 'd-1',
    },
  )
  const criminal = staffDocumentBody(
    'm-1',
    { ...values, documentType: 'criminal_record', replacesDocumentId: 'd-1' },
    null,
  )
  assert.equal(criminal.replacesDocumentId, null)
  assert.equal(staffDocumentFormField('documentDate'), 'documentDate')
  assert.equal(staffDocumentFormField('membershipId'), null)
})

test('DOM-FIN-113: tür ayarı formu yalnız değişen satırı gönderir, süreyi denetler', () => {
  const original: StaffDocumentTypeSettingRow[] = [
    {
      documentType: 'criminal_record',
      required: true,
      validityMonths: 6,
      sensitive: true,
      sensitiveLocked: true,
      customized: false,
      updatedAt: null,
    },
    {
      documentType: 'certificate',
      required: false,
      validityMonths: null,
      sensitive: false,
      sensitiveLocked: false,
      customized: false,
      updatedAt: null,
    },
  ]
  const rows = typeSettingsDefaults(original)
  assert.deepEqual(typeSettingsBody(rows, original), { ok: true, body: null })
  const changed = rows.map((row) =>
    row.documentType === 'certificate' ? { ...row, required: true, validityMonths: '24' } : row,
  )
  assert.deepEqual(typeSettingsBody(changed, original), {
    ok: true,
    body: { certificate: { required: true, validityMonths: 24, sensitive: false } },
  })
  const invalid = rows.map((row) =>
    row.documentType === 'criminal_record' ? { ...row, validityMonths: '0' } : row,
  )
  const result = typeSettingsBody(invalid, original)
  assert.equal(result.ok, false)
})
