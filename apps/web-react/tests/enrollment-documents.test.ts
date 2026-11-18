import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  EnrollmentDocument,
  EnrollmentDocumentRow,
} from '@kampus/react-shared/use-enrollment-documents.ts'
import {
  canReadEnrollmentDocuments,
  enrollmentConsentLabel,
  enrollmentDocumentView,
  enrollmentListRow,
} from '../src/pages/crm/enrollment-documents.ts'

const row = (overrides: Partial<EnrollmentDocumentRow> = {}): EnrollmentDocumentRow => ({
  studentId: 's-1',
  prospectId: 'pr-1',
  name: 'Deniz Yılmaz',
  documentCount: 2,
  missing: [],
  awaitingReview: 0,
  ...overrides,
})

const document = (overrides: Partial<EnrollmentDocument> = {}): EnrollmentDocument => ({
  id: '00000000-0000-4000-8000-000000000001',
  prospectId: 'pr-1',
  documentTypeId: 'identity',
  typeLabel: 'Nüfus kayıt örneği / kimlik',
  specialCategory: false,
  canOpen: true,
  file: { available: true, name: 'kimlik.pdf', contentType: 'application/pdf', byteSize: 2048 },
  reviewedAt: '2026-10-06T09:00:00.000Z',
  linkedAt: '2026-10-06T09:00:00.000Z',
  ...overrides,
})

test('DOM-KAY-045: liste satırı bağlı belge sayısını, eksikleri ve bekleyen incelemeyi yazar', () => {
  assert.deepEqual(enrollmentListRow(row()), {
    id: 's-1',
    prospectId: 'pr-1',
    name: 'Deniz Yılmaz',
    documents: '2 belge',
    missingCount: 'Tam',
    missing: '—',
    awaiting: '—',
  })
  const gap = enrollmentListRow(
    row({
      documentCount: 0,
      missing: [{ id: 'photo', label: 'Vesikalık fotoğraf', stage: 'enrollment' }],
      awaitingReview: 1,
    }),
  )
  assert.equal(gap.documents, 'Belge yok')
  assert.equal(gap.missingCount, '1 eksik belge')
  assert.equal(gap.missing, 'Vesikalık fotoğraf (Kesin kayıt)')
  assert.equal(gap.awaiting, '1 inceleme bekliyor')
})

test('DOM-KAY-045, K-385: özel nitelikli belgeyi açamayan dosya adını görmez, nedeni yazılır', () => {
  assert.deepEqual(enrollmentDocumentView(document()), {
    id: '00000000-0000-4000-8000-000000000001',
    prospectId: 'pr-1',
    typeLabel: 'Nüfus kayıt örneği / kimlik',
    name: 'kimlik.pdf',
    detail: '2 KB',
    canOpen: true,
    locked: null,
  })
  const hidden = enrollmentDocumentView(
    document({
      specialCategory: true,
      canOpen: false,
      typeLabel: 'Sağlık raporu',
      file: { available: true, name: null, contentType: 'application/pdf', byteSize: 10 },
    }),
  )
  assert.equal(hidden.name, 'Özel nitelikli belge')
  assert.equal(hidden.locked, 'Yalnız yönetici açar')
  const gone = enrollmentDocumentView(
    document({
      canOpen: false,
      file: { available: false, name: 'kimlik.pdf', contentType: 'application/pdf', byteSize: 1 },
    }),
  )
  assert.equal(gone.detail, 'Dosya imha edildi')
  assert.equal(gone.locked, null)
})

test('DOM-KAY-045: rıza metni ve okuyan roller', () => {
  assert.equal(enrollmentConsentLabel(null), null)
  assert.equal(
    enrollmentConsentLabel({
      grantor: 'guardian',
      grantedAt: '2026-10-06T09:00:00.000Z',
      linkedAt: '2026-10-06T09:00:00.000Z',
    }),
    'Veli açık rızası öğrenci dosyasına bağlı (ıslak imzalı form).',
  )
  assert.equal(canReadEnrollmentDocuments('onburo'), true)
  assert.equal(canReadEnrollmentDocuments('yonetici'), true)
  assert.equal(canReadEnrollmentDocuments('ogretmen'), false)
  assert.equal(canReadEnrollmentDocuments(undefined), false)
})
