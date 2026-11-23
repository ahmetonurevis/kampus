import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertSupplierTaxNumberFree,
  isValidSupplierTaxNumber,
  maskIban,
  maskSupplierTaxNumber,
  supplierDocumentAlerts,
  supplierDocumentStatus,
  supplierSchema,
  updateSupplierSchema,
} from '../packages/school-core/src/lib/finance-suppliers.ts'

import { isDomainError } from './support/domain-error.ts'

// Tedarikçi kaydı (DOM-FIN-070; ON-221).

const VKN = '1234567890'
const TCKN = '10000000146'
const IBAN = 'TR330006100519786457841326'
const COMPANY = {
  name: 'Örnek Kırtasiye Ltd. Şti.',
  type: 'company',
  taxNumber: VKN,
  taxOffice: 'Kadıköy',
  categories: ['stationery'],
}

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? []

test('DOM-FIN-070: şirkette 10 haneli VKN, şahısta 11 haneli TCKN; kontrol haneleri denetlenir', () => {
  assert.equal(isValidSupplierTaxNumber('company', VKN), true)
  assert.equal(isValidSupplierTaxNumber('company', '1234567891'), false)
  assert.equal(isValidSupplierTaxNumber('company', TCKN), false)
  assert.equal(isValidSupplierTaxNumber('individual', TCKN), true)
  assert.equal(isValidSupplierTaxNumber('individual', '10000000147'), false)
  assert.equal(isValidSupplierTaxNumber('individual', '00000000146'), false)
  assert.equal(isValidSupplierTaxNumber('individual', VKN), false)
})

test('DOM-FIN-070: şema türe uymayan ya da geçersiz vergi numarasını alan mesajıyla reddeder', () => {
  const wrongLength = supplierSchema.safeParse({ ...COMPANY, taxNumber: TCKN })
  assert.equal(wrongLength.success, false)
  assert.deepEqual(messages(wrongLength), [
    'Şirket tedarikçide 10 haneli vergi kimlik numarası (VKN) girin.',
  ])
  assert.deepEqual(wrongLength.error?.issues[0]?.path, ['taxNumber'])
  const badTckn = supplierSchema.safeParse({
    ...COMPANY,
    type: 'individual',
    taxNumber: '10000000147',
  })
  assert.deepEqual(messages(badTckn), ['T.C. kimlik numarası geçersiz; hanelerini kontrol edin.'])
  const badVkn = supplierSchema.safeParse({ ...COMPANY, taxNumber: '1234567891' })
  assert.deepEqual(messages(badVkn), ['Vergi kimlik numarası geçersiz; hanelerini kontrol edin.'])
  assert.equal(
    supplierSchema.safeParse({ ...COMPANY, type: 'individual', taxNumber: TCKN }).success,
    true,
  )
})

test('DOM-FIN-070: isteğe bağlı alanlar boşsa null, kategoriler sabit sırada ve tekil, IBAN boşluksuz', () => {
  const parsed = supplierSchema.parse({
    ...COMPANY,
    categories: ['other', 'stationery', 'other'],
    iban: 'tr33 0006 1005 1978 6457 8413 26',
  })
  assert.deepEqual(parsed.categories, ['stationery', 'other'])
  assert.equal(parsed.iban, IBAN)
  assert.deepEqual(
    [parsed.contactName, parsed.contactPhone, parsed.contactEmail, parsed.address],
    [null, null, null, null],
  )
  assert.deepEqual(parsed.documents, [])
})

test('DOM-FIN-070: IBAN mod-97 denetimi, kategori zorunlu, telefon ve e-posta biçimi', () => {
  assert.equal(
    supplierSchema.safeParse({ ...COMPANY, iban: 'TR330006100519786457841327' }).success,
    false,
  )
  assert.equal(
    supplierSchema.safeParse({ ...COMPANY, iban: 'DE89370400440532013000' }).success,
    false,
  )
  assert.deepEqual(messages(supplierSchema.safeParse({ ...COMPANY, categories: [] })), [
    'En az bir kategori seçin.',
  ])
  assert.equal(supplierSchema.safeParse({ ...COMPANY, contactPhone: '5321234567' }).success, false)
  assert.equal(supplierSchema.safeParse({ ...COMPANY, contactEmail: 'yanlış' }).success, false)
  assert.equal(supplierSchema.safeParse({ ...COMPANY, extra: true }).success, false)
})

test('DOM-FIN-070: belge listesi ad, geçerlilik günü ve nottur; en çok 20 belge', () => {
  const parsed = supplierSchema.parse({
    ...COMPANY,
    documents: [
      { name: 'Vergi levhası', expiryDate: '2027-04-30', note: '' },
      { name: 'İmza sirküleri' },
    ],
  })
  assert.deepEqual(parsed.documents, [
    { name: 'Vergi levhası', expiryDate: '2027-04-30', note: null },
    { name: 'İmza sirküleri', expiryDate: null, note: null },
  ])
  const many = Array.from({ length: 21 }, (_, index) => ({ name: `Belge ${String(index)}` }))
  assert.equal(supplierSchema.safeParse({ ...COMPANY, documents: many }).success, false)
  assert.equal(
    supplierSchema.safeParse({ ...COMPANY, documents: [{ name: 'X', expiryDate: '2027-13-01' }] })
      .success,
    false,
  )
})

test('DOM-FIN-070: düzeltmede tür ve vergi numarası birlikte gelir; boş düzeltme reddedilir', () => {
  assert.deepEqual(messages(updateSupplierSchema.safeParse({ taxNumber: VKN })), [
    'Tedarikçi türü ve vergi numarası birlikte değiştirilir.',
  ])
  assert.deepEqual(messages(updateSupplierSchema.safeParse({ type: 'individual' })), [
    'Tedarikçi türü ve vergi numarası birlikte değiştirilir.',
  ])
  assert.equal(
    updateSupplierSchema.safeParse({ type: 'individual', taxNumber: VKN }).success,
    false,
  )
  assert.equal(
    updateSupplierSchema.safeParse({ type: 'individual', taxNumber: TCKN }).success,
    true,
  )
  assert.equal(updateSupplierSchema.safeParse({}).success, false)
  assert.deepEqual(updateSupplierSchema.parse({ isActive: false }), { isActive: false })
})

test('DOM-FIN-070: vergi numarası kurumda tekil (409)', () => {
  assert.doesNotThrow(() => assertSupplierTaxNumberFree(false))
  assert.throws(
    () => assertSupplierTaxNumberFree(true),
    isDomainError('supplier_tax_number_exists', 'conflict'),
  )
})

test('DOM-FIN-070: şahıs TCKN ve IBAN listede maskelenir, şirket VKN açık kalır', () => {
  assert.equal(maskSupplierTaxNumber('individual', TCKN), '*******0146')
  assert.equal(maskSupplierTaxNumber('company', VKN), VKN)
  assert.equal(maskIban(IBAN), `TR${'*'.repeat(20)}1326`)
})

test('DOM-FIN-070: belge durumu bugüne göre; 30 gün içinde biten yaklaşıyor, son gün geçerli', () => {
  const today = '2026-10-06'
  assert.equal(supplierDocumentStatus({ expiryDate: null }, today), 'open-ended')
  assert.equal(supplierDocumentStatus({ expiryDate: '2026-10-05' }, today), 'expired')
  assert.equal(supplierDocumentStatus({ expiryDate: today }, today), 'expiring')
  assert.equal(supplierDocumentStatus({ expiryDate: '2026-11-05' }, today), 'expiring')
  assert.equal(supplierDocumentStatus({ expiryDate: '2026-11-06' }, today), 'valid')
  assert.deepEqual(
    supplierDocumentAlerts(
      [
        { expiryDate: '2026-01-01' },
        { expiryDate: '2026-10-20' },
        { expiryDate: null },
        { expiryDate: '2027-10-20' },
      ],
      today,
    ),
    { expired: 1, expiring: 1 },
  )
})
