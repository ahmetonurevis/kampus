import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  DocumentTypeRow,
  ProspectDocumentRow,
  ProspectDocuments,
} from '@kampus/react-shared/use-prospect-documents.ts'
import {
  byteSizeLabel,
  consentLabel,
  documentRowView,
  gapBadgeLabel,
  gapCounts,
  hasSpecialTypes,
  missingLabel,
  reminderNote,
  SPECIAL_HIDDEN_NAME,
  typeOptionLabel,
  typeSummary,
  uploadableTypes,
} from '../src/pages/crm/prospect-documents.ts'

// Aday belgeleri ekranlarının saf kuralları (DOM-KAY-043; ON-263, K-322, K-323).

const TYPE: DocumentTypeRow = {
  id: 'identity',
  kind: 'identity',
  label: 'Nüfus kayıt örneği',
  required: true,
  stage: 'enrollment',
  specialCategory: false,
  archived: false,
  version: 1,
}
const HEALTH: DocumentTypeRow = {
  ...TYPE,
  id: 'health_report',
  kind: 'health_report',
  label: 'Sağlık raporu',
  required: false,
  specialCategory: true,
}

const document = (overrides: Partial<ProspectDocumentRow> = {}): ProspectDocumentRow => ({
  id: 'd1',
  documentTypeId: 'identity',
  status: 'uploaded',
  specialCategory: false,
  canOpen: true,
  file: {
    status: 'ready',
    available: true,
    name: 'kimlik.pdf',
    contentType: 'application/pdf',
    byteSize: 1536,
    purgeAt: null,
  },
  linkedToStudent: false,
  linkedAt: null,
  rejectionReason: null,
  uploadedAt: '2026-10-06T09:00:00.000Z',
  reviewedAt: null,
  supersededAt: null,
  version: 1,
  ...overrides,
})

test('DOM-KAY-043: belge satırı; bekleyen belge incelenir, kararlı ya da imha edilmiş belge incelenmez', () => {
  const view = documentRowView(document(), [TYPE], true)
  assert.equal(view.typeLabel, 'Nüfus kayıt örneği')
  assert.equal(view.statusLabel, 'İnceleme bekliyor')
  assert.equal(view.tone, 'amber')
  assert.equal(view.detail, '2 KB')
  assert.equal(view.reviewable, true)
  assert.equal(view.current, true)
  assert.equal(documentRowView(document(), [TYPE], false).reviewable, false)
  assert.equal(documentRowView(document({ status: 'accepted' }), [TYPE], true).reviewable, false)
  const superseded = documentRowView(document({ status: 'superseded' }), [TYPE], true)
  assert.equal(superseded.current, false)
  assert.equal(superseded.tone, 'gray')
  const purged = documentRowView(
    document({ file: { ...document().file, available: false, status: 'deleted' } }),
    [TYPE],
    true,
  )
  assert.equal(purged.statusLabel, 'Dosya imha edildi')
  assert.equal(purged.detail, 'Yeniden yükleyin')
  assert.equal(purged.reviewable, false)
  assert.equal(
    documentRowView(document({ documentTypeId: 'yok' }), [TYPE], true).typeLabel,
    'Belge',
  )
})

test('K-322: özel nitelikli belgeyi açamayan ön büro adı görmez ve inceleyemez', () => {
  const hidden = documentRowView(
    document({
      documentTypeId: 'health_report',
      specialCategory: true,
      canOpen: false,
      file: { ...document().file, name: null },
    }),
    [HEALTH],
    true,
  )
  assert.equal(hidden.name, SPECIAL_HIDDEN_NAME)
  assert.equal(hidden.canOpen, false)
  assert.equal(hidden.reviewable, false)
  assert.equal(hasSpecialTypes([TYPE]), false)
  assert.equal(hasSpecialTypes([TYPE, HEALTH]), true)
  assert.equal(hasSpecialTypes([{ ...HEALTH, archived: true }]), false)
})

test('K-320: tür seçenekleri arşivlenmemiş türler; metin aşama, zorunluluk ve işareti taşır', () => {
  assert.deepEqual(
    uploadableTypes([TYPE, { ...HEALTH, archived: true }]).map((type) => type.id),
    ['identity'],
  )
  assert.equal(typeOptionLabel(TYPE), 'Nüfus kayıt örneği (Kesin kayıt, zorunlu)')
  assert.equal(typeOptionLabel(HEALTH), 'Sağlık raporu (Kesin kayıt, özel nitelikli)')
  assert.equal(typeSummary(TYPE), 'Kimlik / nüfus kayıt örneği · Kesin kayıt')
})

test('K-321, K-323: eksik belge rozeti, eksik listesi ve hatırlatma notu', () => {
  assert.equal(gapBadgeLabel(0), null)
  assert.equal(gapBadgeLabel(2), '2 eksik belge')
  const missing = [
    { id: 'identity', label: 'Kimlik', stage: 'enrollment' as const },
    { id: 'other', label: 'Diğer', stage: 'application' as const },
  ]
  assert.deepEqual([...gapCounts([{ prospectId: 'p1', missing }]).entries()], [['p1', 2]])
  assert.equal(missingLabel(missing), 'Kimlik (Kesin kayıt), Diğer (Ön başvuru)')
  assert.equal(reminderNote(missing), 'Eksik belgeler için hatırlatma yapıldı: Kimlik, Diğer.')
  const long = reminderNote(
    Array.from({ length: 200 }, (_, index) => ({
      id: String(index),
      label: 'Çok uzun belge adı',
      stage: 'application' as const,
    })),
  )
  assert.equal(long.length, 2000)
  assert.ok(long.endsWith('…'))
})

test('K-322: rıza metni veren kişiye göre', () => {
  const consent: ProspectDocuments['consent'] = { grantor: 'guardian', active: null, history: [] }
  assert.match(consentLabel(consent), /^Veli açık rızası kayıtlı değil/)
  assert.equal(
    consentLabel({
      grantor: 'self',
      active: {
        id: 'c1',
        grantor: 'self',
        method: 'wet_signature',
        grantedAt: '2026-10-06T09:00:00.000Z',
        withdrawnAt: null,
        version: 1,
      },
      history: [],
    }),
    'Aday açık rızası kayıtlı (ıslak imzalı form).',
  )
  assert.equal(byteSizeLabel(500), '500 B')
  assert.equal(byteSizeLabel(3 * 1024 * 1024), '3 MB')
})
