import assert from 'node:assert/strict'
import test from 'node:test'

import {
  badgeText,
  checkInBody,
  checkInDefaults,
  checkInFormField,
  checkInFormSchema,
  parseBadgeList,
  settingsBody,
  settingsDefaults,
  settingsFormSchema,
  visitorStatusBadge,
} from '../src/pages/finance/finance-visitor-forms.ts'

// Ziyaretçiler sekmesinin saf mantığı (DOM-FIN-141; ON-166; K-478…K-480).

const issuesOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? []

test('DOM-FIN-141: giriş formu aydınlatma işaretini ve görülen belgeyi ister (K-478)', () => {
  const values = { ...checkInDefaults('2026/1'), visitorName: 'Ayşe Veli' }
  assert.equal(values.privacyNoticeVersion, '2026/1')
  assert.deepEqual(issuesOf(checkInFormSchema.safeParse(values)), ['privacyNoticeShown'])
  const shown = { ...values, privacyNoticeShown: true }
  assert.equal(checkInFormSchema.safeParse(shown).success, true)
  assert.deepEqual(issuesOf(checkInFormSchema.safeParse({ ...shown, identityDocumentType: '' })), [
    'identityDocumentType',
  ])
  assert.deepEqual(issuesOf(checkInFormSchema.safeParse({ ...shown, purpose: 'other' })), [
    'purposeNote',
  ])
  assert.deepEqual(issuesOf(checkInFormSchema.safeParse({ ...shown, phone: '532' })), ['phone'])
})

test('DOM-FIN-141: giriş gövdesi boşları null yapar; öğrenci yalnız veli görüşmesinde (K-478)', () => {
  const values = {
    ...checkInDefaults(null),
    visitorName: ' Ayşe Veli ',
    phone: '0532 123 45 67',
    studentId: 's1',
    badgeNumber: 'A1',
    privacyNoticeVersion: ' v1 ',
    privacyNoticeShown: true,
  }
  assert.deepEqual(checkInBody(values), {
    visitorName: 'Ayşe Veli',
    identityVerified: true,
    identityDocumentType: 'national_id',
    phone: '05321234567',
    purpose: 'parent_meeting',
    purposeNote: null,
    hostMembershipId: null,
    studentId: 's1',
    badgeNumber: 'A1',
    privacyNoticeVersion: 'v1',
  })
  const supplier = checkInBody({ ...values, purpose: 'supplier', identityVerified: false })
  assert.equal(supplier.studentId, null)
  assert.equal(supplier.identityDocumentType, null)
  assert.equal(checkInFormField('badgeNumber'), 'badgeNumber')
  assert.equal(checkInFormField('visitorIds'), null)
})

test('DOM-FIN-141: kart havuzu metni ayrıştırılır, yalnız değişen ayar gönderilir (K-479, K-480)', () => {
  assert.deepEqual(parseBadgeList(' z1, Z2\nz-3 ;'), ['Z1', 'Z2', 'Z-3'])
  const current = {
    retentionDays: 30,
    privacyNoticeVersion: null,
    badgeNumbers: ['Z1'],
    version: 1,
  }
  const defaults = settingsDefaults(current)
  assert.deepEqual(defaults, { retentionDays: '30', privacyNoticeVersion: '', badgeNumbers: 'Z1' })
  assert.equal(settingsBody(current, defaults), null)
  assert.deepEqual(
    settingsBody(current, {
      retentionDays: '15',
      privacyNoticeVersion: 'v2',
      badgeNumbers: 'z1 z2',
    }),
    { retentionDays: 15, privacyNoticeVersion: 'v2', badgeNumbers: ['Z1', 'Z2'] },
  )
  assert.equal(settingsFormSchema.safeParse({ ...defaults, retentionDays: '0' }).success, false)
  assert.equal(settingsFormSchema.safeParse({ ...defaults, badgeNumbers: 'Z1 z1' }).success, false)
  assert.equal(settingsFormSchema.safeParse({ ...defaults, badgeNumbers: 'Z_1' }).success, false)
})

test('DOM-FIN-141: durum rozeti ve kart metni (K-479)', () => {
  assert.deepEqual(visitorStatusBadge({ inside: true, overdue: true, anonymized: false }), {
    text: 'Çıkış yapılmadı',
    tone: 'red',
  })
  assert.equal(
    visitorStatusBadge({ inside: true, overdue: false, anonymized: false }).text,
    'İçeride',
  )
  assert.equal(
    visitorStatusBadge({ inside: false, overdue: false, anonymized: false }).text,
    'Çıktı',
  )
  assert.equal(
    visitorStatusBadge({ inside: false, overdue: false, anonymized: true }).text,
    'Anonimleştirildi',
  )
  assert.equal(badgeText({ badgeNumber: null, badgeStatus: 'none' }), '—')
  assert.equal(badgeText({ badgeNumber: 'A1', badgeStatus: 'out' }), 'A1 · ziyaretçide')
  assert.equal(badgeText({ badgeNumber: 'A1', badgeStatus: 'lost' }), 'A1 · kayıp')
})
