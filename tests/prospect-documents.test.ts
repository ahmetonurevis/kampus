import test from 'node:test'
import assert from 'node:assert/strict'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  addProspectDocumentSchema,
  assertDocumentHistoryCapacity,
  assertDocumentReviewable,
  assertDocumentTypeCapacity,
  assertDocumentTypeLabelFree,
  assertDocumentTypeUsable,
  assertProspectAcceptsDocuments,
  assertSpecialDocumentConsent,
  canOpenProspectDocument,
  createDocumentTypeSchema,
  defaultProspectDocumentTypes,
  documentConsentGrantor,
  documentDue,
  documentRetentionUntil,
  documentTypeSpecialCategory,
  PROSPECT_DOCUMENT_HISTORY_LIMIT,
  PROSPECT_DOCUMENT_TYPE_LIMIT,
  prospectDocumentGaps,
  recordDocumentConsentSchema,
  reviewProspectDocumentSchema,
  updateDocumentTypeSchema,
  type GapDocument,
  type GapDocumentType,
} from '../packages/school-core/src/lib/prospect-documents.ts'

// Aday belgeleri (DOM-KAY-043; ON-263, K-320…K-323).

function rejects(code: string, run: () => unknown) {
  assert.throws(run, (error: unknown) => error instanceof DomainError && error.code === code)
}

const type = (id: string, overrides: Partial<GapDocumentType> = {}): GapDocumentType => ({
  id,
  label: `Tür ${id}`,
  stage: 'application',
  required: true,
  archived: false,
  ...overrides,
})
const doc = (documentTypeId: string, overrides: Partial<GapDocument> = {}): GapDocument => ({
  documentTypeId,
  status: 'uploaded',
  fileAvailable: true,
  ...overrides,
})

test('K-320: varsayılan türler okulda kimlik, karne, fotoğraf zorunlu; dil okulunda yalnız kimlik; sağlık raporu özel nitelikli', () => {
  const school = defaultProspectDocumentTypes('school')
  assert.deepEqual(
    school.map((item) => [item.id, item.required, item.stage, item.specialCategory]),
    [
      ['identity', true, 'enrollment', false],
      ['report_card', true, 'enrollment', false],
      ['photo', true, 'enrollment', false],
      ['health_report', false, 'enrollment', true],
      ['other', false, 'application', false],
    ],
  )
  assert.deepEqual(
    school.map((item) => item.position),
    [10, 20, 30, 40, 50],
  )
  const language = defaultProspectDocumentTypes('language_school')
  assert.deepEqual(
    language.filter((item) => item.required).map((item) => item.id),
    ['identity'],
  )
  assert.equal(language[0]?.label, 'Kimlik fotokopisi')
})

test('K-320: tür şemaları; sağlık raporunun özel nitelikli işareti kalkmaz', () => {
  const parsed = createDocumentTypeSchema.parse({
    kind: 'other',
    label: '  Burs belgesi ',
    required: true,
    stage: 'application',
  })
  assert.equal(parsed.label, 'Burs belgesi')
  assert.equal(documentTypeSpecialCategory('other', undefined), false)
  assert.equal(documentTypeSpecialCategory('other', true), true)
  assert.equal(documentTypeSpecialCategory('health_report', undefined), true)
  assert.equal(documentTypeSpecialCategory('health_report', true), true)
  rejects('document_type_special_required', () =>
    documentTypeSpecialCategory('health_report', false),
  )
  assert.equal(
    createDocumentTypeSchema.safeParse({ kind: 'x', label: 'Ad', required: true, stage: 'x' })
      .success,
    false,
  )
  assert.equal(updateDocumentTypeSchema.safeParse({}).success, false)
  assert.equal(updateDocumentTypeSchema.safeParse({ kind: 'photo' }).success, false)
  assert.equal(updateDocumentTypeSchema.safeParse({ required: false }).success, true)
})

test('K-320: tür adı arşivlenmemişler arasında tekil, sınır 30', () => {
  const types = [{ id: 'a', label: 'Burs Belgesi' }]
  rejects('document_type_exists', () => assertDocumentTypeLabelFree(types, ' burs   belgesi'))
  assert.doesNotThrow(() => assertDocumentTypeLabelFree(types, 'Burs belgesi', 'a'))
  assert.doesNotThrow(() => assertDocumentTypeLabelFree(types, 'Kimlik'))
  assert.doesNotThrow(() => assertDocumentTypeCapacity(PROSPECT_DOCUMENT_TYPE_LIMIT - 1))
  rejects('document_type_limit', () => assertDocumentTypeCapacity(PROSPECT_DOCUMENT_TYPE_LIMIT))
  rejects('document_type_archived', () => assertDocumentTypeUsable({ archived: true }))
  assert.doesNotThrow(() => assertDocumentTypeUsable({ archived: false }))
})

test('DOM-KAY-043: belge açık ve kayda dönmüş adaya eklenir; vazgeçen ya da tanınmayan aşamada 409', () => {
  for (const stage of ['Yeni aday', 'İletişime geçildi', 'Görüşme planlandı', 'Teklif verildi'])
    assert.doesNotThrow(() => assertProspectAcceptsDocuments(stage))
  assert.doesNotThrow(() => assertProspectAcceptsDocuments('Kayıt oldu'))
  rejects('prospect_closed', () => assertProspectAcceptsDocuments('Vazgeçti'))
  rejects('prospect_closed', () => assertProspectAcceptsDocuments(undefined))
  assert.doesNotThrow(() => assertDocumentHistoryCapacity(PROSPECT_DOCUMENT_HISTORY_LIMIT - 1))
  rejects('prospect_document_limit', () =>
    assertDocumentHistoryCapacity(PROSPECT_DOCUMENT_HISTORY_LIMIT),
  )
  assert.equal(
    addProspectDocumentSchema.safeParse({ documentTypeId: 'identity', fileId: 'x' }).success,
    false,
  )
})

test('K-322: özel nitelikli belge rızasız yüklenmez; yalnız yönetici açar; rızayı veren adaydan türer', () => {
  rejects('document_consent_required', () => assertSpecialDocumentConsent(true, false))
  assert.doesNotThrow(() => assertSpecialDocumentConsent(true, true))
  assert.doesNotThrow(() => assertSpecialDocumentConsent(false, false))
  assert.equal(canOpenProspectDocument('yonetici', true), true)
  assert.equal(canOpenProspectDocument('onburo', true), false)
  assert.equal(canOpenProspectDocument('onburo', false), true)
  assert.equal(canOpenProspectDocument('ogretmen', false), false)
  assert.equal(documentConsentGrantor({ minor: false }, 'school'), 'guardian')
  assert.equal(documentConsentGrantor({ minor: false }, 'language_school'), 'self')
  assert.equal(documentConsentGrantor({ minor: true }, 'language_school'), 'guardian')
  assert.equal(documentConsentGrantor({}, 'language_school'), 'guardian')
  assert.equal(recordDocumentConsentSchema.safeParse({ method: 'wet_signature' }).success, true)
  assert.equal(recordDocumentConsentSchema.safeParse({ method: 'verbal' }).success, false)
})

test('DOM-KAY-043: inceleme yalnız bekleyen güncel belgede; ret gerekçesi zorunlu', () => {
  assert.doesNotThrow(() => assertDocumentReviewable({ status: 'uploaded', fileAvailable: true }))
  rejects('prospect_document_reviewed', () =>
    assertDocumentReviewable({ status: 'accepted', fileAvailable: true }),
  )
  rejects('prospect_document_reviewed', () =>
    assertDocumentReviewable({ status: 'rejected', fileAvailable: true }),
  )
  rejects('prospect_document_superseded', () =>
    assertDocumentReviewable({ status: 'superseded', fileAvailable: true }),
  )
  rejects('prospect_document_file_missing', () =>
    assertDocumentReviewable({ status: 'uploaded', fileAvailable: false }),
  )
  assert.equal(reviewProspectDocumentSchema.safeParse({ decision: 'accept' }).success, true)
  assert.equal(reviewProspectDocumentSchema.safeParse({ decision: 'reject' }).success, false)
  assert.equal(
    reviewProspectDocumentSchema.safeParse({ decision: 'reject', reason: ' x ' }).success,
    false,
  )
  assert.equal(
    reviewProspectDocumentSchema.safeParse({ decision: 'reject', reason: 'Okunmuyor.' }).success,
    true,
  )
  assert.equal(
    reviewProspectDocumentSchema.safeParse({ decision: 'accept', reason: 'Fazla' }).success,
    false,
  )
})

test('K-321: belge aşaması; ön başvuru açık adayda, kesin kayıt teklifte ve kayıttan sonra', () => {
  assert.equal(documentDue('application', 'Yeni aday'), true)
  assert.equal(documentDue('enrollment', 'Yeni aday'), false)
  assert.equal(documentDue('enrollment', 'Görüşme planlandı'), false)
  assert.equal(documentDue('enrollment', 'Teklif verildi'), true)
  assert.equal(documentDue('enrollment', 'Kayıt oldu'), true)
  assert.equal(documentDue('application', 'Kayıt oldu'), true)
  assert.equal(documentDue('application', 'Vazgeçti'), false)
  assert.equal(documentDue('application', undefined), false)
})

test('K-321: eksik belge; reddedilen ve imha edilen eksik, bekleyen eksik değil, yerine geçen sayılmaz', () => {
  const types = [
    type('a'),
    type('b'),
    type('c'),
    type('d'),
    type('optional', { required: false }),
    type('archived', { archived: true }),
    type('later', { stage: 'enrollment' }),
  ]
  const gaps = prospectDocumentGaps(
    types,
    [
      doc('a'),
      doc('b', { status: 'rejected' }),
      doc('c', { fileAvailable: false }),
      doc('d', { status: 'superseded' }),
      doc('optional', { status: 'accepted' }),
    ],
    'İletişime geçildi',
  )
  assert.deepEqual(
    gaps.missing.map((item) => item.id),
    ['b', 'c', 'd'],
  )
  assert.equal(gaps.awaitingReview, 1)
  assert.deepEqual(
    prospectDocumentGaps(types, [], 'Teklif verildi').missing.map((item) => item.id),
    ['a', 'b', 'c', 'd', 'later'],
  )
  assert.deepEqual(prospectDocumentGaps(types, [], 'Vazgeçti'), { missing: [], awaitingReview: 0 })
})

test('K-323: imha anı 30 gün sonra', () => {
  assert.equal(
    documentRetentionUntil(new Date('2026-10-06T09:00:00.000Z')).toISOString(),
    '2026-11-05T09:00:00.000Z',
  )
})
