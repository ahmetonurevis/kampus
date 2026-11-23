import assert from 'node:assert/strict'
import test from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  EMPTY_PERSONNEL_FILE,
  type PersonnelFileValues,
} from '../packages/school-core/src/lib/finance-personnel-files.ts'
import {
  DEFAULT_STAFF_DOCUMENT_SETTINGS,
  resolveStaffDocumentSettings,
} from '../packages/school-core/src/lib/finance-staff-documents.ts'
import {
  assertStaffChangePending,
  myLeaveRequestInputSchema,
  normalizePersonName,
  planStaffChangeRequest,
  splitStaffChange,
  STAFF_CHANGE_APPROVER_ROLES,
  STAFF_CHANGE_DOCUMENT_PENDING_MAX,
  STAFF_SELF_SERVICE_ROLES,
  staffChangeFields,
  staffChangeProposal,
  staffChangeRejectSchema,
  staffChangeRequestInputSchema,
  staffChangeUpdate,
  storedStaffChangePayloadSchema,
  type StaffChangeChecks,
  type StaffChangeKind,
} from '../packages/school-core/src/lib/finance-staff-self-service.ts'

const TODAY = '2026-10-06'
const IBAN = 'TR330006100519786457841326'
const settings = resolveStaffDocumentSettings({})

const checks = (overrides: Partial<StaffChangeChecks> = {}): StaffChangeChecks => ({
  staff: { role: 'ogretmen', active: true, name: 'Selin Kaya' },
  pending: [],
  current: null,
  documentSettings: settings,
  today: TODAY,
  ...overrides,
})
const parse = (input: unknown) => staffChangeRequestInputSchema.parse(input)
function rejects(run: () => unknown, code: string, kind: DomainError['kind'] = 'rule') {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })
}
const card = (overrides: Partial<PersonnelFileValues> = {}): PersonnelFileValues => ({
  ...EMPTY_PERSONNEL_FILE,
  ...overrides,
})

test('DOM-FIN-166, K-553: self-servis personelde, onay yalnız yöneticide', () => {
  assert.deepEqual([...STAFF_SELF_SERVICE_ROLES], ['yonetici', 'ogretmen', 'onburo'])
  assert.deepEqual([...STAFF_CHANGE_APPROVER_ROLES], ['yonetici'])
  for (const role of ['ogrenci', 'veli'])
    assert.ok(!(STAFF_SELF_SERVICE_ROLES as readonly string[]).includes(role))
})

test('DOM-FIN-166, K-553: talep şeması türe göre alan alır; bilinmeyen alan ve tür 400', () => {
  const contact = parse({ kind: 'contact', phone: '0532 123 45 67' })
  assert.deepEqual(contact, { kind: 'contact', phone: '05321234567' })
  assert.equal(staffChangeRequestInputSchema.safeParse({ kind: 'contact' }).success, false)
  assert.equal(
    staffChangeRequestInputSchema.safeParse({ kind: 'contact', address: 'kısa' }).success,
    false,
  )
  assert.equal(
    staffChangeRequestInputSchema.safeParse({ kind: 'contact', phone: '05321234567', email: 'x' })
      .success,
    false,
  )
  assert.equal(staffChangeRequestInputSchema.safeParse({ kind: 'identity' }).success, false)
  assert.equal(
    staffChangeRequestInputSchema.safeParse({ kind: 'emergency_contacts', emergencyContacts: [] })
      .success,
    false,
  )
  // Üyelik kimliği gövdede alınmaz (tek giriş oturumdur).
  assert.equal(
    staffChangeRequestInputSchema.safeParse({
      kind: 'contact',
      phone: '05321234567',
      membershipId: 'm-1',
    }).success,
    false,
  )
})

test('DOM-FIN-166, K-554: IBAN TR mod-97 ile doğrulanır, boşluk ve küçük harf temizlenir', () => {
  const bank = parse({
    kind: 'bank',
    iban: 'tr33 0006 1005 1978 6457 8413 26',
    accountHolder: 'Selin Kaya',
  })
  assert.deepEqual(bank, { kind: 'bank', iban: IBAN, accountHolder: 'Selin Kaya' })
  const wrong = staffChangeRequestInputSchema.safeParse({
    kind: 'bank',
    iban: 'TR330006100519786457841327',
    accountHolder: 'Selin Kaya',
  })
  assert.equal(wrong.success, false)
  assert.equal(
    staffChangeRequestInputSchema.safeParse({ kind: 'bank', iban: IBAN }).success,
    false,
    'hesap sahibi zorunlu',
  )
})

test('DOM-FIN-166: belge talebinde sağlık raporu türü zorunlu, başka türde verilmez', () => {
  assert.equal(
    staffChangeRequestInputSchema.safeParse({
      kind: 'document',
      documentType: 'health_report',
      documentDate: '2026-09-01',
    }).success,
    false,
  )
  assert.equal(
    staffChangeRequestInputSchema.safeParse({
      kind: 'document',
      documentType: 'diploma',
      healthReportKind: 'periodic',
      documentDate: '2026-09-01',
    }).success,
    false,
  )
  const doc = parse({
    kind: 'document',
    documentType: 'diploma',
    documentDate: '2026-09-01',
    note: ' ',
  })
  assert.deepEqual(doc, {
    kind: 'document',
    documentType: 'diploma',
    healthReportKind: null,
    documentDate: '2026-09-01',
    fileId: null,
    note: null,
  })
})

test('DOM-FIN-166, K-553: talep açan etkin personel olmalı; öğrenci/veli üyeliği 404, ayrılmış 422', () => {
  const input = parse({ kind: 'contact', phone: '05321234567' })
  rejects(
    () => planStaffChangeRequest(input, checks({ staff: null })),
    'staff_self_service_not_staff',
    'not_found',
  )
  rejects(
    () =>
      planStaffChangeRequest(input, checks({ staff: { role: 'veli', active: true, name: 'A' } })),
    'staff_self_service_not_staff',
    'not_found',
  )
  rejects(
    () =>
      planStaffChangeRequest(
        input,
        checks({ staff: { role: 'ogretmen', active: false, name: 'Selin Kaya' } }),
      ),
    'staff_self_service_inactive',
  )
  planStaffChangeRequest(input, checks())
})

test('DOM-FIN-166, K-553: türde tek bekleyen talep (409); belge talebi en çok on bekler', () => {
  const contact = parse({ kind: 'contact', phone: '05321234567' })
  const pending = (kind: StaffChangeKind, count = 1) =>
    Array.from({ length: count }, () => ({ kind }))
  rejects(
    () => planStaffChangeRequest(contact, checks({ pending: pending('contact') })),
    'staff_change_request_pending_exists',
    'conflict',
  )
  // Başka türün bekleyeni engel değildir.
  planStaffChangeRequest(contact, checks({ pending: pending('bank') }))
  const doc = parse({ kind: 'document', documentType: 'diploma', documentDate: '2026-09-01' })
  planStaffChangeRequest(
    doc,
    checks({ pending: pending('document', STAFF_CHANGE_DOCUMENT_PENDING_MAX - 1) }),
  )
  rejects(
    () =>
      planStaffChangeRequest(
        doc,
        checks({ pending: pending('document', STAFF_CHANGE_DOCUMENT_PENDING_MAX) }),
      ),
    'staff_change_document_pending_limit',
  )
})

test('DOM-FIN-166: kartta zaten kayıtlı değer 422 staff_change_request_unchanged', () => {
  const current = card({
    address: 'Moda Caddesi No 12 Kadıköy',
    phone: '05321234567',
    emergencyContacts: [{ name: 'Ahmet Kaya', relation: 'Eşi', phone: '05329876543' }],
    iban: IBAN,
    accountHolder: 'Selin Kaya',
  })
  rejects(
    () =>
      planStaffChangeRequest(parse({ kind: 'contact', phone: '05321234567' }), checks({ current })),
    'staff_change_request_unchanged',
  )
  rejects(
    () =>
      planStaffChangeRequest(
        parse({
          kind: 'emergency_contacts',
          emergencyContacts: [{ name: 'Ahmet Kaya', relation: 'Eşi', phone: '05329876543' }],
        }),
        checks({ current }),
      ),
    'staff_change_request_unchanged',
  )
  rejects(
    () =>
      planStaffChangeRequest(
        parse({ kind: 'bank', iban: IBAN, accountHolder: 'Selin Kaya' }),
        checks({ current }),
      ),
    'staff_change_request_unchanged',
  )
  planStaffChangeRequest(parse({ kind: 'contact', phone: null }), checks({ current }))
  // Kart yoksa her değer yenidir.
  planStaffChangeRequest(parse({ kind: 'contact', phone: '05321234567' }), checks())
})

test('DOM-FIN-166, K-554: hesap sahibi personelin kendi adı olmalı (büyük/küçük harf ve boşluk yok sayılır)', () => {
  rejects(
    () =>
      planStaffChangeRequest(
        parse({ kind: 'bank', iban: IBAN, accountHolder: 'Ahmet Kaya' }),
        checks(),
      ),
    'staff_change_bank_holder_mismatch',
  )
  planStaffChangeRequest(
    parse({ kind: 'bank', iban: IBAN, accountHolder: '  SELİN   KAYA ' }),
    checks(),
  )
  assert.equal(normalizePersonName(' İsmail  IŞIK '), 'ismail ışık')
})

test('DOM-FIN-166, DOM-FIN-113: belge tarihi bugünden sonra olamaz; özel nitelikli belgeye not yazılmaz', () => {
  rejects(
    () =>
      planStaffChangeRequest(
        parse({ kind: 'document', documentType: 'diploma', documentDate: '2026-10-07' }),
        checks(),
      ),
    'staff_document_date_in_future',
  )
  rejects(
    () =>
      planStaffChangeRequest(
        parse({
          kind: 'document',
          documentType: 'health_report',
          healthReportKind: 'periodic',
          documentDate: '2026-09-01',
          note: 'Tansiyon',
        }),
        checks(),
      ),
    'staff_document_sensitive_note',
  )
  assert.equal(DEFAULT_STAFF_DOCUMENT_SETTINGS.health_report.sensitive, true)
  planStaffChangeRequest(
    parse({
      kind: 'document',
      documentType: 'health_report',
      healthReportKind: 'periodic',
      documentDate: TODAY,
    }),
    checks(),
  )
})

test('DOM-FIN-166: yük IBAN taşımaz; karta uygulanacak güncelleme ve denetim alan adları', () => {
  const bank = splitStaffChange(parse({ kind: 'bank', iban: IBAN, accountHolder: 'Selin Kaya' }))
  assert.deepEqual(bank, {
    payload: { kind: 'bank', accountHolder: 'Selin Kaya' },
    iban: IBAN,
    fileId: null,
  })
  assert.ok(!JSON.stringify(bank.payload).includes(IBAN))
  assert.deepEqual(staffChangeUpdate(bank.payload, IBAN), {
    bank: { iban: IBAN, accountHolder: 'Selin Kaya' },
  })
  assert.throws(() => staffChangeUpdate(bank.payload, null))
  assert.deepEqual(staffChangeFields(bank.payload), ['bank.iban', 'bank.accountHolder'])

  const contact = splitStaffChange(parse({ kind: 'contact', address: null }))
  assert.deepEqual(contact.payload, { kind: 'contact', address: null })
  assert.deepEqual(staffChangeUpdate(contact.payload, null), { contact: { address: null } })
  assert.deepEqual(staffChangeFields(contact.payload), ['contact.address'])

  const people = [{ name: 'Ahmet Kaya', relation: 'Eşi', phone: '05329876543' }]
  const emergency = splitStaffChange(
    parse({ kind: 'emergency_contacts', emergencyContacts: people }),
  )
  assert.deepEqual(staffChangeUpdate(emergency.payload, null), { emergencyContacts: people })
  assert.deepEqual(staffChangeFields(emergency.payload), ['emergencyContacts'])

  const fileId = '6f1d0a1e-5a3f-4c4b-9a35-2f0d8c1b7e11'
  const doc = splitStaffChange(
    parse({ kind: 'document', documentType: 'certificate', documentDate: '2026-09-01', fileId }),
  )
  assert.equal(doc.fileId, fileId)
  assert.equal(staffChangeUpdate(doc.payload, null), null)
  assert.deepEqual(staffChangeFields(doc.payload), ['documentType', 'documentDate'])
  // Saklanan yük okumada şemadan geçer.
  assert.deepEqual(storedStaffChangePayloadSchema.parse(doc.payload), doc.payload)
})

test('DOM-FIN-166, K-554: öneri görünümünde IBAN maskeli, belge dosyası var/yok', () => {
  const bank = staffChangeProposal(
    { kind: 'bank', accountHolder: 'Selin Kaya' },
    { iban: IBAN, hasFile: false },
  )
  assert.deepEqual(bank, {
    kind: 'bank',
    ibanMasked: 'TR********************1326',
    accountHolder: 'Selin Kaya',
  })
  assert.ok(!JSON.stringify(bank).includes('0006100519786457'))
  const doc = staffChangeProposal(
    {
      kind: 'document',
      documentType: 'diploma',
      healthReportKind: null,
      documentDate: '2026-09-01',
      note: null,
    },
    { iban: null, hasFile: true },
  )
  assert.equal(doc.kind === 'document' && doc.hasFile, true)
  const contact = staffChangeProposal(
    { kind: 'contact', phone: '05321234567' },
    { iban: null, hasFile: false },
  )
  assert.deepEqual(contact, { kind: 'contact', phone: '05321234567' })
})

test('DOM-FIN-166: yalnız bekleyen talep karar alır; ret gerekçesi 5–500', () => {
  assertStaffChangePending('pending')
  for (const status of ['approved', 'rejected', 'cancelled'] as const)
    rejects(() => assertStaffChangePending(status), 'staff_change_request_not_pending')
  assert.equal(staffChangeRejectSchema.safeParse({ reason: 'kısa' }).success, false)
  assert.equal(staffChangeRejectSchema.safeParse({ reason: 'x'.repeat(501) }).success, false)
  assert.deepEqual(staffChangeRejectSchema.parse({ reason: '  Belge okunmuyor  ' }), {
    reason: 'Belge okunmuyor',
  })
})

test('DOM-FIN-166, DOM-FIN-116: kendi izin talebinde personel ve yedek alınmaz; bitiş başlangıçtan önce olamaz', () => {
  const parsed = myLeaveRequestInputSchema.parse({
    typeCode: 'annual',
    startDate: '2026-10-12',
    endDate: '2026-10-14',
    days: 3,
  })
  assert.deepEqual(parsed, {
    typeCode: 'annual',
    startDate: '2026-10-12',
    endDate: '2026-10-14',
    days: 3,
    description: null,
  })
  assert.equal(
    myLeaveRequestInputSchema.safeParse({ ...parsed, membershipId: 'm-1' }).success,
    false,
  )
  assert.equal(myLeaveRequestInputSchema.safeParse({ ...parsed, substitutes: [] }).success, false)
  assert.equal(
    myLeaveRequestInputSchema.safeParse({ ...parsed, endDate: '2026-10-11' }).success,
    false,
  )
})
