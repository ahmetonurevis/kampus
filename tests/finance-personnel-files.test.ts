import assert from 'node:assert/strict'
import test from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  assertPersonnelFileWritable,
  canRevealPersonnelNationalId,
  changedPersonnelFileFields,
  EMPTY_PERSONNEL_FILE,
  filledPersonnelFileGroups,
  FINANCE_PERSONNEL_FILE_READ_ROLES,
  FINANCE_PERSONNEL_FILE_WRITE_ROLES,
  mergePersonnelFile,
  PERSONNEL_FILE_ACCESS_MATRIX,
  PERSONNEL_FILE_GROUPS,
  personnelFileAccess,
  personnelFileInputSchema,
  personnelFileUpdateSchema,
  personnelFileView,
  planPersonnelFile,
  planPersonnelFileUpdate,
  readablePersonnelFileGroups,
  writablePersonnelFileGroups,
  type PersonnelFileValues,
} from '../packages/school-core/src/lib/finance-personnel-files.ts'

const TODAY = '2026-10-06'
const TCKN = '10000000146'
const IBAN = 'TR330006100519786457841326'
const staff = { role: 'ogretmen', active: true }

const full: PersonnelFileValues = {
  nationalId: TCKN,
  birthDate: '1990-05-12',
  address: 'Moda Caddesi No 12 Kadıköy İstanbul',
  phone: '05321234567',
  email: 'selin@example.com',
  education: [
    {
      level: 'bachelor',
      school: 'Boğaziçi Üniversitesi',
      department: 'Matematik',
      graduationYear: 2012,
    },
  ],
  iban: IBAN,
  accountHolder: 'Selin Kaya',
  emergencyContacts: [{ name: 'Ahmet Kaya', relation: 'Eşi', phone: '05329876543' }],
}

function domainCode(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof DomainError, String(error))
    return `${error.kind}:${error.code}`
  }
  assert.fail('DomainError bekleniyordu')
}

test('DOM-FIN-140 K-475: alan grubu × rol matrisi', () => {
  assert.deepEqual(readablePersonnelFileGroups('yonetici'), [...PERSONNEL_FILE_GROUPS])
  assert.deepEqual(writablePersonnelFileGroups('yonetici'), [...PERSONNEL_FILE_GROUPS])
  assert.deepEqual(readablePersonnelFileGroups('muhasebe'), ['identity', 'contact', 'bank'])
  assert.deepEqual(writablePersonnelFileGroups('muhasebe'), ['bank'])
  assert.deepEqual(readablePersonnelFileGroups('onburo'), ['emergencyContacts'])
  assert.deepEqual(writablePersonnelFileGroups('onburo'), [])
  for (const role of ['ogretmen', 'veli', 'ogrenci', 'bilinmeyen']) {
    assert.deepEqual(readablePersonnelFileGroups(role), [], role)
    assert.equal(personnelFileAccess(role).bank, 'none')
  }
  // Banka yalnız yönetici ve muhasebe.
  const bankReaders = Object.entries(PERSONNEL_FILE_ACCESS_MATRIX)
    .filter(([, access]) => access.bank !== 'none')
    .map(([role]) => role)
  assert.deepEqual(bankReaders, ['yonetici', 'muhasebe'])
  // Platform rolleri matristen türer.
  for (const role of FINANCE_PERSONNEL_FILE_READ_ROLES)
    assert.ok(readablePersonnelFileGroups(role).length > 0, role)
  for (const role of FINANCE_PERSONNEL_FILE_WRITE_ROLES)
    assert.ok(writablePersonnelFileGroups(role).length > 0, role)
  assert.equal(canRevealPersonnelNationalId('yonetici'), true)
  assert.equal(canRevealPersonnelNationalId('muhasebe'), false)
  assert.equal(canRevealPersonnelNationalId('onburo'), false)
})

test('DOM-FIN-140 K-476: görünüm role göre grup çıkarır, kimlik ve IBAN maskeli', () => {
  const manager = personnelFileView(full, 'yonetici')
  assert.deepEqual(Object.keys(manager), [...PERSONNEL_FILE_GROUPS])
  assert.equal(manager.identity?.nationalIdMasked, '*******0146')
  assert.equal(manager.bank?.ibanMasked, `TR${'*'.repeat(20)}1326`)
  assert.ok(!JSON.stringify(manager).includes(TCKN))
  assert.ok(!JSON.stringify(manager).includes(IBAN))

  const accountant = personnelFileView(full, 'muhasebe')
  assert.deepEqual(Object.keys(accountant), ['identity', 'contact', 'bank'])
  const frontDesk = personnelFileView(full, 'onburo')
  assert.deepEqual(Object.keys(frontDesk), ['emergencyContacts'])
  assert.deepEqual(personnelFileView(full, 'ogretmen'), {})

  const empty = personnelFileView(EMPTY_PERSONNEL_FILE, 'yonetici')
  assert.equal(empty.identity?.nationalIdMasked, null)
  assert.equal(empty.bank?.ibanMasked, null)
})

test('DOM-FIN-140: şema TCKN, IBAN mod-97, telefon ve listeleri doğrular', () => {
  const parsed = personnelFileInputSchema.parse({
    membershipId: 'm1',
    identity: { nationalId: '100 000 001 46', birthDate: '1990-05-12' },
    contact: { phone: '0532 123 45 67', email: 'selin@example.com' },
    bank: { iban: 'tr33 0006 1005 1978 6457 8413 26', accountHolder: ' Selin Kaya ' },
    education: [{ level: 'master', school: 'ODTÜ', department: '' }],
  })
  assert.equal(parsed.identity?.nationalId, TCKN)
  assert.equal(parsed.contact?.phone, '05321234567')
  assert.equal(parsed.bank?.iban, IBAN)
  assert.equal(parsed.bank?.accountHolder, 'Selin Kaya')
  assert.deepEqual(parsed.education?.[0], {
    level: 'master',
    school: 'ODTÜ',
    department: null,
    graduationYear: null,
  })

  const issue = (body: unknown) => {
    const result = personnelFileInputSchema.safeParse(body)
    assert.equal(result.success, false)
    return result.error?.issues[0]?.path.join('.')
  }
  assert.equal(
    issue({ membershipId: 'm1', identity: { nationalId: '12345678901' } }),
    'identity.nationalId',
  )
  assert.equal(
    issue({
      membershipId: 'm1',
      bank: { iban: 'TR330006100519786457841327', accountHolder: 'Ad Soyad' },
    }),
    'bank.iban',
  )
  assert.equal(issue({ membershipId: 'm1', contact: { phone: '5321234567' } }), 'contact.phone')
  assert.equal(
    issue({ membershipId: 'm1', identity: { birthDate: '1990-02-30' } }),
    'identity.birthDate',
  )
  assert.equal(
    issue({
      membershipId: 'm1',
      emergencyContacts: Array.from({ length: 6 }, () => ({
        name: 'Ad Soyad',
        relation: 'Eşi',
        phone: '05321234567',
      })),
    }),
    'emergencyContacts',
  )
  assert.equal(issue({ membershipId: 'm1', extra: true }), '')
  // En az bir grup.
  assert.equal(personnelFileInputSchema.safeParse({ membershipId: 'm1' }).success, false)
  assert.equal(personnelFileUpdateSchema.safeParse({}).success, false)
  assert.equal(personnelFileUpdateSchema.safeParse({ bank: null }).success, true)
})

test('DOM-FIN-140: kart açılışı personel, tekillik ve değer kuralları', () => {
  const input = personnelFileInputSchema.parse({
    membershipId: 'm1',
    identity: { nationalId: TCKN, birthDate: '1990-05-12' },
    bank: { iban: IBAN, accountHolder: 'Selin Kaya' },
  })
  const values = planPersonnelFile('yonetici', input, { staff, exists: false, today: TODAY })
  assert.equal(values.nationalId, TCKN)
  assert.equal(values.iban, IBAN)
  assert.deepEqual(filledPersonnelFileGroups(values), ['identity', 'bank'])

  const plan = (overrides: Partial<Parameters<typeof planPersonnelFile>[2]>, role = 'yonetici') =>
    domainCode(() =>
      planPersonnelFile(role, input, { staff, exists: false, today: TODAY, ...overrides }),
    )
  assert.equal(plan({ staff: null }), 'rule:personnel_file_staff_not_found')
  assert.equal(plan({ staff: { role: 'veli', active: true } }), 'rule:personnel_file_not_staff')
  assert.equal(
    plan({ staff: { role: 'ogretmen', active: false } }),
    'rule:personnel_file_staff_inactive',
  )
  assert.equal(plan({ exists: true }), 'conflict:personnel_file_exists')
  // Muhasebe kimlik grubunu yazamaz; ön büro hiçbir grubu.
  assert.equal(plan({}, 'muhasebe'), 'forbidden:personnel_file_group_forbidden')
  assert.equal(plan({}, 'onburo'), 'forbidden:personnel_file_group_forbidden')

  const birth = (birthDate: string) =>
    domainCode(() =>
      planPersonnelFile(
        'yonetici',
        personnelFileInputSchema.parse({ membershipId: 'm1', identity: { birthDate } }),
        {
          staff,
          exists: false,
          today: TODAY,
        },
      ),
    )
  assert.equal(birth('2026-10-07'), 'rule:personnel_file_birth_date_invalid')
  assert.equal(birth('1919-12-31'), 'rule:personnel_file_birth_date_invalid')
  assert.equal(birth('2012-10-07'), 'rule:personnel_file_birth_date_invalid')
  assert.equal(
    planPersonnelFile(
      'yonetici',
      personnelFileInputSchema.parse({ membershipId: 'm1', identity: { birthDate: '2012-10-06' } }),
      {
        staff,
        exists: false,
        today: TODAY,
      },
    ).birthDate,
    '2012-10-06',
  )
  const halfBank = personnelFileInputSchema.parse({ membershipId: 'm1', bank: { iban: IBAN } })
  assert.equal(
    domainCode(() =>
      planPersonnelFile('yonetici', halfBank, { staff, exists: false, today: TODAY }),
    ),
    'rule:personnel_file_bank_incomplete',
  )
  const futureGraduation = personnelFileInputSchema.parse({
    membershipId: 'm1',
    education: [{ level: 'doctorate', school: 'İTÜ', graduationYear: 2040 }],
  })
  assert.equal(
    domainCode(() =>
      planPersonnelFile('yonetici', futureGraduation, { staff, exists: false, today: TODAY }),
    ),
    'rule:personnel_file_graduation_year_invalid',
  )
})

test('DOM-FIN-140: düzeltme kısmi birleşir, değişen alan adlarını verir', () => {
  const update = personnelFileUpdateSchema.parse({
    identity: { birthDate: '1991-01-01' },
    contact: { email: null },
    bank: { accountHolder: 'Selin Kaya Demir' },
  })
  const { values, changed } = planPersonnelFileUpdate('yonetici', full, update, TODAY)
  assert.equal(values.nationalId, TCKN, 'verilmeyen alan değişmez')
  assert.equal(values.iban, IBAN)
  assert.equal(values.email, null)
  assert.deepEqual(changed, ['identity.birthDate', 'contact.email', 'bank.accountHolder'])

  const cleared = mergePersonnelFile(
    full,
    personnelFileUpdateSchema.parse({ bank: null, education: [] }),
  )
  assert.equal(cleared.iban, null)
  assert.equal(cleared.accountHolder, null)
  assert.deepEqual(cleared.education, [])
  assert.deepEqual(changedPersonnelFileFields(full, cleared), [
    'education',
    'bank.iban',
    'bank.accountHolder',
  ])

  assert.equal(
    domainCode(() =>
      planPersonnelFileUpdate(
        'yonetici',
        full,
        personnelFileUpdateSchema.parse({ identity: { nationalId: TCKN } }),
        TODAY,
      ),
    ),
    'rule:personnel_file_unchanged',
  )
  // Muhasebe yalnız bankayı düzeltir.
  const bankOnly = personnelFileUpdateSchema.parse({ bank: { iban: 'TR320010009999901234567890' } })
  assert.deepEqual(planPersonnelFileUpdate('muhasebe', full, bankOnly, TODAY).changed, [
    'bank.iban',
  ])
  assert.equal(
    domainCode(() =>
      planPersonnelFileUpdate(
        'muhasebe',
        full,
        personnelFileUpdateSchema.parse({ contact: { phone: null } }),
        TODAY,
      ),
    ),
    'forbidden:personnel_file_group_forbidden',
  )
  assert.doesNotThrow(() => assertPersonnelFileWritable('onburo', {}))
})
