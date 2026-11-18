import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ENROLLMENT_DOCUMENT_ROLES,
  enrollmentDocumentGaps,
  enrollmentDocumentHeld,
  matchesEnrollmentDocumentSearch,
  planEnrollmentDocuments,
  type EnrollmentDocumentCandidate,
} from '../packages/school-core/src/lib/enrollment-documents.ts'
import { defaultProspectDocumentTypes } from '../packages/school-core/src/lib/prospect-documents.ts'

const doc = (
  id: string,
  overrides: Partial<EnrollmentDocumentCandidate> = {},
): EnrollmentDocumentCandidate => ({
  id,
  status: 'accepted',
  specialCategory: false,
  fileAvailable: true,
  linked: false,
  ...overrides,
})

test('DOM-KAY-045, K-384: kabul edilmiş belge bağlanır; reddedilen 30 gün sonraya, yerine geçen yok sayılır', () => {
  const plan = planEnrollmentDocuments(
    [
      doc('kimlik'),
      doc('karne', { status: 'rejected' }),
      doc('eski', { status: 'superseded' }),
      doc('foto', { status: 'uploaded' }),
    ],
    false,
  )
  assert.deepEqual(plan, {
    link: ['kimlik'],
    purgeLater: ['karne'],
    purgeNow: [],
    pending: ['foto'],
  })
})

test('DOM-KAY-045, K-384: dosyası imha edilmiş ya da zaten bağlı belge yeniden işlenmez', () => {
  const plan = planEnrollmentDocuments(
    [
      doc('imha', { fileAvailable: false }),
      doc('ret-imha', { status: 'rejected', fileAvailable: false }),
      doc('bekleyen-imha', { status: 'uploaded', fileAvailable: false }),
      doc('bagli', { linked: true }),
    ],
    true,
  )
  assert.deepEqual(plan, { link: [], purgeLater: [], purgeNow: [], pending: [] })
})

test('DOM-KAY-045, K-385: özel nitelikli belge yalnız etkin rızayla bağlanır, rızasız hemen imhaya gider', () => {
  const report = doc('saglik', { specialCategory: true })
  assert.deepEqual(planEnrollmentDocuments([report], true).link, ['saglik'])
  const withoutConsent = planEnrollmentDocuments([report, doc('kimlik')], false)
  assert.deepEqual(withoutConsent.link, ['kimlik'])
  assert.deepEqual(withoutConsent.purgeNow, ['saglik'])
})

test('DOM-KAY-045, K-386: imha yalnız bağlı, kabul edilmiş ve arşivlenmemiş belgede bekletilir', () => {
  assert.equal(enrollmentDocumentHeld({ linked: true, status: 'accepted', archived: false }), true)
  assert.equal(
    enrollmentDocumentHeld({ linked: false, status: 'accepted', archived: false }),
    false,
  )
  assert.equal(
    enrollmentDocumentHeld({ linked: true, status: 'superseded', archived: false }),
    false,
  )
  assert.equal(enrollmentDocumentHeld({ linked: true, status: 'accepted', archived: true }), false)
})

test('DOM-KAY-045, K-321: kayıt belgesi eksiği iki aşamanın zorunlu türlerini sayar', () => {
  const types = defaultProspectDocumentTypes('school').map((type) => ({
    id: type.id,
    label: type.label,
    stage: type.stage,
    required: type.required,
    archived: false,
  }))
  const gaps = enrollmentDocumentGaps(types, [
    { documentTypeId: 'identity', status: 'accepted', fileAvailable: true },
    { documentTypeId: 'report_card', status: 'uploaded', fileAvailable: true },
    { documentTypeId: 'photo', status: 'rejected', fileAvailable: true },
  ])
  assert.deepEqual(
    gaps.missing.map((item) => item.id),
    ['photo'],
  )
  assert.equal(gaps.awaitingReview, 1)
})

test('DOM-KAY-045: öğrenci araması Türkçe harf ve boşluk duyarsız', () => {
  assert.equal(matchesEnrollmentDocumentSearch('İpek  Işık', 'ipek ışık'), true)
  assert.equal(matchesEnrollmentDocumentSearch('Deniz Yılmaz', '  '), true)
  assert.equal(matchesEnrollmentDocumentSearch('Deniz Yılmaz', undefined), true)
  assert.equal(matchesEnrollmentDocumentSearch('Deniz Yılmaz', 'ece'), false)
})

test('DOM-KAY-045: kayıt belgelerini yönetici ve ön büro okur', () => {
  assert.deepEqual([...ENROLLMENT_DOCUMENT_ROLES], ['yonetici', 'onburo'])
})
