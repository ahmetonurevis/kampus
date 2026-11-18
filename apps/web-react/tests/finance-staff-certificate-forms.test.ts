import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  CertificateStaffRow,
  StaffCertificateDocument,
} from '@kampus/react-shared/use-finance-staff-certificates.ts'
import {
  staffCertificateDocument,
  staffCertificateFilename,
} from '../src/lib/pdf/templates/finance-staff-certificate.ts'
import {
  emptyStaffCertificateForm,
  staffCertificateBody,
  staffCertificateDefaults,
  staffCertificateFormField,
  staffCertificateFormSchema,
  staffOptionText,
  type StaffCertificateFormValues,
} from '../src/pages/finance/finance-staff-certificate-forms.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// Personel belgesi formu ve PDF'i (DOM-FIN-106; ON-175; K-340…K-343).

const TCKN = '10000000146'
const STAFF: CertificateStaffRow = {
  membershipId: 'm-selin',
  name: 'Selin Kaya',
  role: 'ogretmen',
  active: true,
  leftDate: null,
  lastPosition: null,
  lastHireDate: null,
}
const LEFT: CertificateStaffRow = {
  membershipId: 'm-ahmet',
  name: 'Ahmet Ayrılan',
  role: 'onburo',
  active: false,
  leftDate: '2026-06-30',
  lastPosition: 'Ön büro görevlisi',
  lastHireDate: '2023-02-15',
}
const filled = (overrides: Partial<StaffCertificateFormValues> = {}) => ({
  ...staffCertificateDefaults(STAFF, emptyStaffCertificateForm()),
  hireDate: '2021-09-01',
  ...overrides,
})
const issuesOf = (values: StaffCertificateFormValues) => {
  const result = staffCertificateFormSchema.safeParse(values)
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((issue) => [issue.path[0], issue.message]))
}

test('DOM-FIN-106: personel seçimi türü durumdan, görevi ve günleri son belgeden önerir (K-340)', () => {
  const working = staffCertificateDefaults(STAFF, {
    ...emptyStaffCertificateForm(),
    addressee: 'X Bankası',
    includeWage: true,
  })
  assert.equal(working.kind, 'employment')
  assert.equal(working.position, 'Öğretmen')
  assert.equal(working.hireDate, '')
  assert.equal(working.addressee, 'X Bankası')
  assert.equal(working.includeWage, true)
  const left = staffCertificateDefaults(LEFT, working)
  assert.equal(left.kind, 'service')
  assert.equal(left.position, 'Ön büro görevlisi')
  assert.equal(left.hireDate, '2023-02-15')
  assert.equal(left.exitDate, '2026-06-30')
  assert.equal(left.includeWage, false)
  assert.equal(staffOptionText(STAFF), 'Selin Kaya · Öğretmen')
  assert.equal(staffOptionText(LEFT), 'Ahmet Ayrılan · Ön büro · ayrıldı')
})

test('DOM-FIN-106: gövde türe göre kurulur; çalışma belgesinde çıkış, hizmette ücret gitmez', () => {
  assert.deepEqual(staffCertificateBody(filled({ includeWage: true, exitDate: '2026-01-01' })), {
    kind: 'employment',
    membershipId: 'm-selin',
    position: 'Öğretmen',
    hireDate: '2021-09-01',
    identityNumber: '',
    addressee: '',
    includeWage: true,
  })
  const service = staffCertificateBody({
    ...staffCertificateDefaults(LEFT, emptyStaffCertificateForm()),
    includeWage: true,
  })
  assert.equal(service.kind, 'service')
  assert.equal('includeWage' in service, false)
})

test('DOM-FIN-106: form core şemasıyla doğrulanır; hata alana düşer', () => {
  assert.deepEqual(issuesOf(filled()), {})
  assert.deepEqual(Object.keys(issuesOf(emptyStaffCertificateForm())).sort(), [
    'hireDate',
    'membershipId',
    'position',
  ])
  assert.equal(
    issuesOf(filled({ identityNumber: '12345678901' })).identityNumber,
    'Geçerli bir T.C. kimlik no girin.',
  )
  assert.equal(
    issuesOf({
      ...staffCertificateDefaults(LEFT, emptyStaffCertificateForm()),
      exitDate: '2023-01-01',
    }).exitDate,
    'Ayrılış günü işe giriş gününden önce olamaz.',
  )
  assert.equal(staffCertificateFormField('includeWage'), 'includeWage')
  assert.equal(staffCertificateFormField('institutionId'), null)
})

const document = (overrides: Partial<StaffCertificateDocument> = {}): StaffCertificateDocument => ({
  id: '3f2a6c1e-8b7d-4a55-9c31-2d4e6f708192',
  membershipId: 'm-selin',
  kind: 'employment',
  certificateYear: 2026,
  certificateNumber: 7,
  staffName: 'Selin Kaya',
  position: 'İngilizce öğretmeni',
  hireDate: '2021-09-01',
  exitDate: null,
  addressee: 'İlgili makama',
  includesWage: true,
  hasIdentityNumber: true,
  issuedByName: 'Okul Yöneticisi',
  createdAt: '2026-10-06T09:00:00.000Z',
  cancelledAt: null,
  cancelReason: null,
  version: 1,
  institutionName: 'Akademi Özel Okulları',
  identityNumber: TCKN,
  wageRateType: 'monthly_gross',
  wageAmountCents: 4_500_000,
  currency: 'TRY',
  ...overrides,
})
const textOf = (data: StaffCertificateDocument) =>
  allTexts(staffCertificateDocument(measurer, data)).join('\n')

test('DOM-FIN-106: çalışma belgesi PDF kurum başlığı, numara, tarih, muhatap, TCKN, ücret ve imza alanı yazar', () => {
  const text = textOf(document())
  for (const expected of [
    'ÇALIŞMA BELGESİ',
    'Akademi Özel Okulları',
    'PB-2026-7',
    'İLGİLİ MAKAMA',
    TCKN,
    'İngilizce öğretmeni',
    '45.000,00',
    'Düzenleyen: Okul Yöneticisi',
    'kaşe',
    'Geçerli',
  ])
    assert.ok(text.includes(expected), expected)
  assert.equal(text.includes('md. 28'), false)
  assert.equal(staffCertificateFilename(document()), 'calisma-belgesi-PB-2026-7.pdf')
})

test('DOM-FIN-106: hizmet belgesi PDF giriş–çıkış, hizmet süresi ve md. 28 yazar; ücret ve TCKN yoksa satır yok', () => {
  const service = document({
    kind: 'service',
    staffName: 'Ahmet Ayrılan',
    exitDate: '2026-06-30',
    hireDate: '2023-02-15',
    identityNumber: null,
    wageRateType: null,
    wageAmountCents: null,
  })
  const text = textOf(service)
  for (const expected of ['HİZMET BELGESİ', 'İşten ayrılış', '3 yıl 4 ay 16 gün', 'md. 28'])
    assert.ok(text.includes(expected), expected)
  assert.equal(text.includes('T.C. kimlik no'), false)
  assert.equal(text.includes('Ücret'), false)
  assert.equal(staffCertificateFilename(service), 'hizmet-belgesi-PB-2026-7.pdf')
})

test('DOM-FIN-106: iptal edilen belge İPTAL EDİLDİ rozeti ve gerekçeyle basılır (K-341)', () => {
  const text = textOf(
    document({ cancelledAt: '2026-10-07T10:00:00.000Z', cancelReason: 'Görev yanlış yazıldı' }),
  )
  assert.ok(text.includes('İPTAL EDİLDİ'))
  assert.ok(text.includes('İptal gerekçesi: Görev yanlış yazıldı'))
})
