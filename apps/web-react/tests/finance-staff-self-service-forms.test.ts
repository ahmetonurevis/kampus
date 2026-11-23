import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bankBody,
  bankDefaults,
  bankFormSchema,
  changeStatusTone,
  contactBody,
  contactFormSchema,
  documentBody,
  documentDefaults,
  documentFormSchema,
  emergencyBody,
  emergencyDefaults,
  emergencyFormField,
  emergencyFormSchema,
  payslipMonthText,
  proposalText,
  rejectFormSchema,
} from '../src/pages/finance/finance-staff-self-service-forms.ts'

// Personel self-servisi formlarının saf mantığı (DOM-FIN-166; ON-189; K-553…K-555).

const issuesOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? []
const IBAN = 'TR330006100519786457841326'

test('DOM-FIN-166, K-553: boş iletişim alanı değişmez; ikisi boşsa adres alanında hata', () => {
  assert.deepEqual(issuesOf(contactFormSchema.safeParse({ address: '', phone: '' })), ['address'])
  assert.deepEqual(contactBody({ address: '', phone: ' 0532 123 45 67 ' }), {
    kind: 'contact',
    phone: '0532 123 45 67',
  })
  assert.deepEqual(issuesOf(contactFormSchema.safeParse({ address: 'kısa', phone: '' })), [
    'address',
  ])
  assert.deepEqual(issuesOf(contactFormSchema.safeParse({ address: '', phone: '123' })), ['phone'])
  assert.equal(contactFormSchema.safeParse({ address: '', phone: '05321234567' }).success, true)
})

test('DOM-FIN-166: acil durum listesi bütün olarak gider; sunucu yolu forma eşlenir', () => {
  const empty = emergencyDefaults(undefined)
  assert.equal(empty.contacts.length, 1)
  assert.deepEqual(issuesOf(emergencyFormSchema.safeParse(empty)).sort(), [
    'contacts.0.name',
    'contacts.0.phone',
    'contacts.0.relation',
  ])
  const filled = emergencyDefaults([{ name: 'Ahmet Kaya', relation: 'Eşi', phone: '05329876543' }])
  assert.equal(emergencyFormSchema.safeParse(filled).success, true)
  assert.deepEqual(emergencyBody(filled), {
    kind: 'emergency_contacts',
    emergencyContacts: [{ name: 'Ahmet Kaya', relation: 'Eşi', phone: '05329876543' }],
  })
  assert.equal(emergencyFormField('emergencyContacts.2.phone'), 'contacts.2.phone')
  assert.equal(emergencyFormField('emergencyContacts'), 'contacts')
  assert.equal(emergencyFormField('kind'), undefined)
})

test('DOM-FIN-166, K-554: banka formu IBAN mod-97 ister; hesap sahibi varsayılanı personelin adı', () => {
  const values = bankDefaults('Selin Kaya')
  assert.deepEqual(values, { iban: '', accountHolder: 'Selin Kaya' })
  assert.deepEqual(issuesOf(bankFormSchema.safeParse(values)), ['iban'])
  assert.deepEqual(
    issuesOf(bankFormSchema.safeParse({ ...values, iban: 'TR330006100519786457841327' })),
    ['iban'],
  )
  assert.equal(bankFormSchema.safeParse({ ...values, iban: IBAN }).success, true)
  assert.deepEqual(bankBody({ iban: IBAN, accountHolder: ' Selin Kaya ' }), {
    kind: 'bank',
    iban: IBAN,
    accountHolder: 'Selin Kaya',
  })
})

test('DOM-FIN-166, DOM-FIN-113: belge formu; sağlık raporunda rapor türü zorunlu, özel nitelikli türde not gitmez', () => {
  const values = documentDefaults('2026-10-06')
  assert.equal(documentFormSchema.safeParse(values).success, true)
  assert.deepEqual(
    issuesOf(documentFormSchema.safeParse({ ...values, documentType: 'health_report' })),
    ['healthReportKind'],
  )
  const health = {
    ...values,
    documentType: 'health_report',
    healthReportKind: 'periodic',
    note: 'Tansiyon',
  }
  assert.deepEqual(documentBody(health, 'f-1', true), {
    kind: 'document',
    documentType: 'health_report',
    healthReportKind: 'periodic',
    documentDate: '2026-10-06',
    fileId: 'f-1',
    note: null,
  })
  // Sağlık raporundan başka türe geçilirse rapor türü gönderilmez.
  const diploma = documentBody({ ...health, documentType: 'diploma' }, null, false)
  assert.equal(diploma.kind === 'document' ? diploma.healthReportKind : 'yok', null)
})

test('DOM-FIN-166: ret gerekçesi 5–500; durum rengi ve öneri özeti', () => {
  assert.equal(rejectFormSchema.safeParse({ reason: 'kısa' }).success, false)
  assert.equal(rejectFormSchema.safeParse({ reason: 'Belge okunmuyor' }).success, true)
  assert.equal(changeStatusTone('pending'), 'amber')
  assert.equal(changeStatusTone('approved'), 'green')
  assert.equal(changeStatusTone('rejected'), 'red')
  assert.equal(changeStatusTone('cancelled'), 'gray')
  assert.equal(
    proposalText({ kind: 'contact', address: null, phone: '05321234567' }),
    'Adres: silinsin · Telefon: 05321234567',
  )
  assert.equal(
    proposalText({ kind: 'bank', ibanMasked: 'TR****1326', accountHolder: 'Selin Kaya' }),
    'TR****1326 · Selin Kaya',
  )
  assert.match(
    proposalText({
      kind: 'document',
      documentType: 'health_report',
      healthReportKind: 'periodic',
      documentDate: '2026-09-01',
      note: null,
      hasFile: true,
    }),
    /^Sağlık raporu · Periyodik · .+ · dosyalı$/,
  )
  assert.equal(payslipMonthText('2026-03'), 'Mart 2026')
})
