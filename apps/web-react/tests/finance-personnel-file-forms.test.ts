import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bankBody,
  bankFormSchema,
  contactBody,
  contactFormSchema,
  educationBody,
  educationDefaults,
  educationFormSchema,
  educationText,
  emergencyBody,
  emergencyFormSchema,
  filledGroupsText,
  identityBody,
  identityDefaults,
  identityFormSchema,
  personnelFormField,
} from '../src/pages/finance/finance-personnel-file-forms.ts'

test('DOM-FIN-140: kimlik formu boş numarayı göndermez, silme ve yeni numara ayrı', () => {
  const defaults = identityDefaults({ nationalIdMasked: '*******0146', birthDate: '1990-05-12' })
  assert.deepEqual(defaults, { nationalId: '', birthDate: '1990-05-12', removeNationalId: false })
  assert.deepEqual(identityBody(defaults), { identity: { birthDate: '1990-05-12' } })
  assert.deepEqual(identityBody({ ...defaults, nationalId: '100 000 001 46', birthDate: '' }), {
    identity: { nationalId: '10000000146', birthDate: null },
  })
  assert.deepEqual(identityBody({ ...defaults, removeNationalId: true }), {
    identity: { nationalId: null, birthDate: '1990-05-12' },
  })
  assert.equal(
    identityFormSchema.safeParse({ ...defaults, nationalId: '12345678901' }).success,
    false,
  )
  assert.equal(identityDefaults(undefined).birthDate, '')
})

test('DOM-FIN-140: iletişim ve banka formu biçimi düzeltir, boşu null yapar', () => {
  const contact = { address: '  ', phone: '0532 123 45 67', email: '' }
  assert.equal(contactFormSchema.safeParse(contact).success, true)
  assert.deepEqual(contactBody(contact), {
    contact: { address: null, phone: '05321234567', email: null },
  })
  assert.equal(contactFormSchema.safeParse({ ...contact, phone: '532' }).success, false)
  assert.equal(contactFormSchema.safeParse({ ...contact, address: 'kısa' }).success, false)
  assert.equal(contactFormSchema.safeParse({ ...contact, email: 'yanlis' }).success, false)

  // Banka yokken IBAN zorunlu; varken boş IBAN değişmez.
  const holder = { iban: '', accountHolder: 'Selin Kaya' }
  assert.equal(bankFormSchema(false).safeParse(holder).success, false)
  assert.equal(bankFormSchema(true).safeParse(holder).success, true)
  assert.deepEqual(bankBody(holder), { bank: { accountHolder: 'Selin Kaya' } })
  const iban = { iban: 'tr33 0006 1005 1978 6457 8413 26', accountHolder: ' Selin Kaya ' }
  assert.equal(bankFormSchema(false).safeParse(iban).success, true)
  assert.deepEqual(bankBody(iban), {
    bank: { iban: 'TR330006100519786457841326', accountHolder: 'Selin Kaya' },
  })
  assert.equal(
    bankFormSchema(false).safeParse({ ...iban, iban: 'TR330006100519786457841327' }).success,
    false,
  )
})

test('DOM-FIN-140: eğitim ve acil durum listeleri bütün olarak yazılır', () => {
  const view = [
    { level: 'bachelor' as const, school: 'ODTÜ', department: null, graduationYear: 2012 },
  ]
  const defaults = educationDefaults(view)
  assert.deepEqual(defaults.rows[0], {
    level: 'bachelor',
    school: 'ODTÜ',
    department: '',
    graduationYear: '2012',
  })
  assert.deepEqual(educationBody({ rows: [{ ...defaults.rows[0]!, graduationYear: '' }] }), {
    education: [{ level: 'bachelor', school: 'ODTÜ', department: null, graduationYear: null }],
  })
  assert.equal(
    educationFormSchema.safeParse({ rows: [{ ...defaults.rows[0]!, graduationYear: '12' }] })
      .success,
    false,
  )
  assert.equal(educationText(view[0]!), 'Lisans · ODTÜ · 2012')
  assert.equal(
    educationText({ level: 'master', school: 'İTÜ', department: 'Fizik', graduationYear: null }),
    'Yüksek lisans · İTÜ, Fizik · sürüyor',
  )

  const contact = { name: ' Ahmet Kaya ', relation: 'Eşi', phone: '(0532) 987-65-43' }
  assert.equal(emergencyFormSchema.safeParse({ rows: [contact] }).success, true)
  assert.deepEqual(emergencyBody({ rows: [contact] }), {
    emergencyContacts: [{ name: 'Ahmet Kaya', relation: 'Eşi', phone: '05329876543' }],
  })
  assert.equal(
    emergencyFormSchema.safeParse({ rows: Array.from({ length: 6 }, () => contact) }).success,
    false,
  )
})

test('DOM-FIN-140: sunucu alan yolu grup formuna eşlenir; liste metni', () => {
  assert.equal(personnelFormField('identity', 'identity.nationalId'), 'nationalId')
  assert.equal(personnelFormField('bank', 'bank.iban'), 'iban')
  assert.equal(personnelFormField('education', 'education.0.school'), 'rows.0.school')
  assert.equal(personnelFormField('emergencyContacts', 'emergencyContacts.1.phone'), 'rows.1.phone')
  assert.equal(personnelFormField('identity', 'membershipId'), null)
  assert.equal(personnelFormField('education', 'education'), null)

  assert.equal(filledGroupsText({ hasFile: false, filledGroups: [] }), 'Kart açılmadı')
  assert.equal(filledGroupsText({ hasFile: true, filledGroups: [] }), 'Görebildiğiniz bilgi yok')
  assert.equal(
    filledGroupsText({ hasFile: true, filledGroups: ['bank', 'identity'] }),
    'Kimlik · Banka',
  )
})
