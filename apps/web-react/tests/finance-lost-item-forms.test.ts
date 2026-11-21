import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canUploadLostItemPhotos,
  disposalFormSchema,
  handoverBody,
  handoverDefaults,
  handoverFormSchema,
  lostItemStatusBadge,
  lostReportStatusBadge,
  recordBody,
  recordDefaults,
  recordFormField,
  recordFormSchema,
  settingsBody,
  settingsDefaults,
  settingsFormSchema,
} from '../src/pages/finance/finance-lost-item-forms.ts'

// Kayıp eşya sekmesinin saf mantığı (DOM-FIN-145; ON-171; K-490…K-492).

const issuesOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? []

test('DOM-FIN-145: hızlı kayıt bugünü ve son saklama yerini önerir; boş bulan null olur (K-490)', () => {
  const values = recordDefaults('2026-10-06', 'Ön büro dolabı')
  assert.equal(values.foundOn, '2026-10-06')
  assert.equal(values.storageLocation, 'Ön büro dolabı')
  assert.deepEqual(issuesOf(recordFormSchema.safeParse(values)), ['description', 'foundLocation'])
  const filled = { ...values, description: ' Mavi suluk ', foundLocation: 'Kantin' }
  assert.equal(recordFormSchema.safeParse(filled).success, true)
  const body = recordBody(filled, ['f1'])
  assert.equal(body.description, 'Mavi suluk')
  assert.equal(body.finderMembershipId, null)
  assert.deepEqual(body.photoFileIds, ['f1'])
  assert.equal(recordFormField('storageLocation'), 'storageLocation')
  assert.equal(recordFormField('photoFileIds'), undefined)
})

test('DOM-FIN-145: teslim gövdesi teslim alan türüne göre alan taşır (K-490)', () => {
  const defaults = handoverDefaults('s1')
  assert.equal(defaults.recipientType, 'student')
  assert.deepEqual(handoverBody(defaults), { recipientType: 'student', studentId: 's1' })
  assert.deepEqual(issuesOf(handoverFormSchema.safeParse(handoverDefaults(null))), ['studentId'])
  const guardian = { ...defaults, recipientType: 'guardian' as const }
  assert.deepEqual(issuesOf(handoverFormSchema.safeParse(guardian)), ['guardianLinkId'])
  assert.deepEqual(handoverBody({ ...guardian, guardianLinkId: 'g1' }), {
    recipientType: 'guardian',
    studentId: 's1',
    guardianLinkId: 'g1',
  })
  const other = { ...defaults, recipientType: 'other' as const, recipientName: ' Ali Usta ' }
  assert.equal(handoverFormSchema.safeParse(other).success, true)
  assert.deepEqual(handoverBody(other), { recipientType: 'other', recipientName: 'Ali Usta' })
  assert.deepEqual(issuesOf(handoverFormSchema.safeParse({ ...other, recipientName: 'A' })), [
    'recipientName',
  ])
})

test('DOM-FIN-145: rozetler; fotoğraf yükleme amacın rolüne bağlı (K-490, K-491)', () => {
  const base = { status: 'pending' as const, retentionDue: false, matchedReport: null }
  assert.equal(lostItemStatusBadge(base).text, 'Bekliyor')
  assert.equal(lostItemStatusBadge({ ...base, retentionDue: true }).tone, 'red')
  assert.equal(
    lostItemStatusBadge({
      ...base,
      matchedReport: { id: 'r', studentId: 's1', studentName: null, version: 1 },
    }).text,
    'Sahibi bulundu',
  )
  assert.equal(lostItemStatusBadge({ ...base, status: 'handed_over' }).tone, 'green')
  assert.equal(lostItemStatusBadge({ ...base, status: 'destroyed' }).text, 'İmha edildi')
  assert.equal(lostReportStatusBadge({ status: 'matched' }).text, 'Bulundu, teslim bekliyor')
  assert.equal(canUploadLostItemPhotos('yonetici'), true)
  assert.equal(canUploadLostItemPhotos(undefined), false)
})

test('DOM-FIN-145: bağış/imha gerekçe ister; ayar yalnız değişeni gönderir (K-492)', () => {
  assert.deepEqual(issuesOf(disposalFormSchema.safeParse({ outcome: 'donated', reason: ' ' })), [
    'reason',
  ])
  const current = { retentionDays: 30, familyGalleryEnabled: true, version: 1 }
  const values = settingsDefaults(current)
  assert.equal(settingsBody(current, values), null)
  assert.deepEqual(settingsBody(current, { ...values, retentionDays: '60' }), {
    retentionDays: 60,
  })
  assert.deepEqual(settingsBody(current, { ...values, familyGalleryEnabled: false }), {
    familyGalleryEnabled: false,
  })
  assert.deepEqual(issuesOf(settingsFormSchema.safeParse({ ...values, retentionDays: '5' })), [
    'retentionDays',
  ])
})
