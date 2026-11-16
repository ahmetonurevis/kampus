import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ALUMNI_DOCUMENT_ROLES,
  alumniDocumentContentSchema,
  alumniDocumentNumber,
  alumniRequestActions,
  buildAlumniEducationCertificate,
  buildAlumniTranscript,
  isAdultOn,
  isAlumniContentEmpty,
  planAlumniDocumentRequest,
  planAlumniRequestDeliver,
  planAlumniRequestReady,
  planAlumniRequestReject,
  planAlumniRequestStart,
  updateAlumniDocumentFeesSchema,
  type AlumniRequestFacts,
  type AlumniRequestState,
} from '../packages/school-core/src/lib/enrollment-alumni-documents.ts'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'

// Mezun ve ayrılan öğrenci belge talebi (DOM-KAY-044; ON-260, K-328…K-331).

const FILE = '3f2a6c1e-8b7d-4a55-9c31-2d4e6f708192'
const base = {
  studentId: 's1',
  documentType: 'education_certificate',
  copies: 2,
  channel: 'petition',
  requesterKind: 'self',
  deliveryMethod: 'in_person',
}
const facts = (overrides: Partial<AlumniRequestFacts> = {}): AlumniRequestFacts => ({
  institutionType: 'school',
  status: 'graduated',
  adult: true,
  guardianBond: null,
  unitFeeCents: 5_000,
  ...overrides,
})
const rejects = (run: () => unknown, code: string, path?: string) =>
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof DomainError, String(error))
    assert.equal(error.code, code)
    if (path !== undefined) assert.deepEqual(error.path, [path])
    return true
  })
const zodRejects = (run: () => unknown, path: string) =>
  assert.throws(run, (error: unknown) => {
    const issues = (error as { issues?: { path: unknown[] }[] }).issues ?? []
    assert.ok(
      issues.some((issue) => issue.path.join('.') === path),
      JSON.stringify(issues),
    )
    return true
  })

test('DOM-KAY-044: talebi yönetici ve ön büro kaydeder', () => {
  assert.deepEqual([...ALUMNI_DOCUMENT_ROLES], ['yonetici', 'onburo'])
})

test('DOM-KAY-044 K-329: mezunun kendi talebi ücreti adetle çarpar, teslim yoluna ait olmayan iletişim silinir', () => {
  const plan = planAlumniDocumentRequest(
    {
      ...base,
      deliveryEmail: 'deniz@example.com',
      deliveryAddress: 'Atatürk Cad. No 1 Kadıköy İstanbul',
      guardianParentId: 'p1',
      proxyName: 'Ali Veli',
      authorizationFileId: FILE,
    },
    facts(),
  )
  assert.equal(plan.feeCents, 10_000)
  assert.equal(plan.deliveryEmail, null)
  assert.equal(plan.deliveryAddress, null)
  assert.equal(plan.guardianParentId, null)
  assert.equal(plan.proxyName, null)
  assert.equal(plan.authorizationFileId, null)
})

test('DOM-KAY-044: e-posta ve kargo yolu iletişim bilgisini ister', () => {
  zodRejects(
    () => planAlumniDocumentRequest({ ...base, deliveryMethod: 'email' }, facts()),
    'deliveryEmail',
  )
  zodRejects(
    () => planAlumniDocumentRequest({ ...base, deliveryMethod: 'cargo' }, facts()),
    'deliveryAddress',
  )
  const plan = planAlumniDocumentRequest(
    { ...base, deliveryMethod: 'cargo', deliveryAddress: '  Atatürk Cad. No 1 Kadıköy  ' },
    facts({ unitFeeCents: 0 }),
  )
  assert.equal(plan.deliveryAddress, 'Atatürk Cad. No 1 Kadıköy')
  assert.equal(plan.feeCents, 0)
  zodRejects(() => planAlumniDocumentRequest({ ...base, copies: 11 }, facts()), 'copies')
  zodRejects(() => planAlumniDocumentRequest({ ...base, extra: 1 }, facts()), '')
})

test('DOM-KAY-044: aktif öğrenciye talep açılmaz; diploma örneği yalnız okulda ve mezuna', () => {
  rejects(
    () => planAlumniDocumentRequest(base, facts({ status: 'active' })),
    'alumni_document_student_active',
    'studentId',
  )
  const diploma = { ...base, documentType: 'diploma_copy' }
  rejects(
    () => planAlumniDocumentRequest(diploma, facts({ status: 'withdrawn' })),
    'alumni_document_not_graduated',
    'documentType',
  )
  rejects(
    () => planAlumniDocumentRequest(diploma, facts({ institutionType: 'language_school' })),
    'alumni_document_type_unavailable',
  )
  assert.equal(planAlumniDocumentRequest(diploma, facts()).documentType, 'diploma_copy')
  // Ayrılan öğrenci öğrenim belgesi ve not dökümü alır.
  assert.equal(
    planAlumniDocumentRequest(
      { ...base, documentType: 'transcript' },
      facts({ status: 'withdrawn' }),
    ).documentType,
    'transcript',
  )
})

test('DOM-KAY-044 K-328 H-53: reşit olmayanın talebini velisi yapar; yaşı bilinmeyen kendisi talep edebilir', () => {
  rejects(
    () => planAlumniDocumentRequest(base, facts({ adult: false })),
    'alumni_document_requester_minor',
    'requesterKind',
  )
  assert.equal(planAlumniDocumentRequest(base, facts({ adult: null })).requesterKind, 'self')
})

test('DOM-KAY-044 K-328 H-53: veli velayetli ve kısıtsız olmalı; reşit kişinin velisi yazılı rıza ister', () => {
  const guardian = { ...base, requesterKind: 'guardian', guardianParentId: 'p1' }
  zodRejects(
    () => planAlumniDocumentRequest({ ...base, requesterKind: 'guardian' }, facts()),
    'guardianParentId',
  )
  rejects(
    () => planAlumniDocumentRequest(guardian, facts({ adult: false })),
    'alumni_document_guardian_unknown',
    'guardianParentId',
  )
  for (const bond of [
    { custody: 'none' as const, contactRestricted: false },
    { custody: 'full' as const, contactRestricted: true },
  ])
    rejects(
      () => planAlumniDocumentRequest(guardian, facts({ adult: false, guardianBond: bond })),
      'alumni_document_guardian_not_authorized',
    )
  const bond = { custody: 'joint' as const, contactRestricted: false }
  assert.equal(
    planAlumniDocumentRequest(guardian, facts({ adult: false, guardianBond: bond }))
      .guardianParentId,
    'p1',
  )
  for (const adult of [true, null])
    rejects(
      () => planAlumniDocumentRequest(guardian, facts({ adult, guardianBond: bond })),
      'alumni_document_consent_required',
      'authorizationFileId',
    )
  const withConsent = planAlumniDocumentRequest(
    { ...guardian, authorizationFileId: FILE },
    facts({ guardianBond: bond }),
  )
  assert.equal(withConsent.authorizationFileId, FILE)
})

test('DOM-KAY-044 K-328 H-54: vekil adı ve vekâletname zorunlu', () => {
  zodRejects(
    () =>
      planAlumniDocumentRequest(
        { ...base, requesterKind: 'proxy', proxyName: 'Ali Kaya' },
        facts(),
      ),
    'authorizationFileId',
  )
  zodRejects(
    () =>
      planAlumniDocumentRequest(
        { ...base, requesterKind: 'proxy', authorizationFileId: FILE },
        facts(),
      ),
    'proxyName',
  )
  const plan = planAlumniDocumentRequest(
    { ...base, requesterKind: 'proxy', proxyName: 'Ali Kaya', authorizationFileId: FILE },
    facts({ adult: false }),
  )
  assert.equal(plan.proxyName, 'Ali Kaya')
})

const state = (overrides: Partial<AlumniRequestState> = {}): AlumniRequestState => ({
  status: 'received',
  documentType: 'education_certificate',
  feeCents: 0,
  ...overrides,
})

test('DOM-KAY-044 K-330: durum akışı alındı → hazırlanıyor → hazır → teslim; ret teslimden önce', () => {
  assert.deepEqual(alumniRequestActions('received'), ['start', 'reject'])
  assert.deepEqual(alumniRequestActions('preparing'), ['ready', 'reject'])
  assert.deepEqual(alumniRequestActions('ready'), ['deliver', 'reject'])
  assert.deepEqual(alumniRequestActions('delivered'), [])
  assert.deepEqual(alumniRequestActions('rejected'), [])
  planAlumniRequestStart(state())
  rejects(
    () => planAlumniRequestStart(state({ status: 'preparing' })),
    'alumni_document_invalid_status',
  )
  rejects(() => planAlumniRequestReady(state(), {}, null), 'alumni_document_invalid_status')
  rejects(
    () =>
      planAlumniRequestDeliver(state({ status: 'preparing' }), {
        identityCheckNote: 'Kimlik kartı',
      }),
    'alumni_document_invalid_status',
  )
  rejects(
    () => planAlumniRequestReject(state({ status: 'delivered' }), { reason: 'Yanlış talep' }),
    'alumni_document_invalid_status',
  )
  assert.equal(
    planAlumniRequestReject(state({ status: 'ready' }), { reason: '  Kimlik doğrulanamadı ' })
      .reason,
    'Kimlik doğrulanamadı',
  )
  zodRejects(() => planAlumniRequestReject(state(), { reason: 'kısa' }), 'reason')
})

test('DOM-KAY-044 K-330: diploma örneği dosya ister, üretilen belgeye dosya eklenmez; boş dökümde not zorunlu', () => {
  const preparing = state({ status: 'preparing' })
  rejects(
    () => planAlumniRequestReady({ ...preparing, documentType: 'diploma_copy' }, {}, null),
    'alumni_document_file_required',
    'fileId',
  )
  assert.equal(
    planAlumniRequestReady({ ...preparing, documentType: 'diploma_copy' }, { fileId: FILE }, null)
      .fileId,
    FILE,
  )
  const learner = {
    institution: { name: 'Akademi Özel Okulları', type: 'school' as const },
    student: { name: 'Deniz Yılmaz', number: ' ' },
    outcome: 'graduated' as const,
    enrolledDate: '2022-09-12',
    leftDate: '2026-06-26',
    lastClassName: '12-A',
  }
  const certificate = buildAlumniEducationCertificate(learner)
  rejects(
    () => planAlumniRequestReady(preparing, { fileId: FILE }, certificate),
    'alumni_document_file_not_allowed',
  )
  assert.equal(planAlumniRequestReady(preparing, undefined, certificate).manualNote, null)
  const empty = buildAlumniTranscript({
    ...learner,
    grades: [],
    classNames: new Map(),
    courses: [],
  })
  assert.ok(isAlumniContentEmpty(empty))
  assert.ok(!isAlumniContentEmpty(certificate))
  const transcriptState = { ...preparing, documentType: 'transcript' as const }
  rejects(
    () => planAlumniRequestReady(transcriptState, {}, empty),
    'alumni_document_transcript_empty',
    'manualNote',
  )
  assert.equal(
    planAlumniRequestReady(
      transcriptState,
      { manualNote: '2019 notları e-Okul dökümündedir.' },
      empty,
    ).manualNote,
    '2019 notları e-Okul dökümündedir.',
  )
})

test('DOM-KAY-044 K-329: ücretli belge ödeme yöntemi seçilmeden teslim edilmez; ücretsizde ödeme yok sayılır', () => {
  const ready = state({ status: 'ready', feeCents: 5_000 })
  rejects(
    () => planAlumniRequestDeliver(ready, { identityCheckNote: 'Nüfus cüzdanı görüldü' }),
    'alumni_document_payment_required',
    'paymentMethod',
  )
  assert.equal(
    planAlumniRequestDeliver(ready, {
      identityCheckNote: 'Nüfus cüzdanı görüldü',
      paymentMethod: 'cash',
    }).paymentMethod,
    'cash',
  )
  assert.equal(
    planAlumniRequestDeliver(state({ status: 'ready' }), {
      identityCheckNote: 'Nüfus cüzdanı görüldü',
      paymentMethod: 'card',
    }).paymentMethod,
    null,
  )
  zodRejects(() => planAlumniRequestDeliver(ready, { identityCheckNote: ' ' }), 'identityCheckNote')
})

test('DOM-KAY-044: belge numarası yıl bazlı sıralı, yaş Europe/Istanbul gününe göre', () => {
  assert.equal(alumniDocumentNumber(2026, 7), 'MB-2026-0007')
  assert.equal(alumniDocumentNumber(2027, 12345), 'MB-2027-12345')
  assert.equal(isAdultOn('2008-10-06', '2026-10-05'), false)
  assert.equal(isAdultOn('2008-10-06', '2026-10-06'), true)
  assert.equal(isAdultOn(null, '2026-10-06'), null)
  assert.equal(isAdultOn('bozuk', '2026-10-06'), null)
})

test('DOM-KAY-044: not dökümü sınıf ve dönem başına ders ortalaması, dil okulunda kur listesi', () => {
  const transcript = buildAlumniTranscript({
    institution: { name: 'Akademi', type: 'school' },
    student: { name: 'Deniz Yılmaz', number: '2026001' },
    outcome: 'withdrawn',
    enrolledDate: null,
    leftDate: '2026-03-02',
    lastClassName: '11-A',
    classNames: new Map([
      ['c10', '10-A'],
      ['c11', '11-A'],
    ]),
    grades: [
      {
        classId: 'c11',
        term: 1,
        subjectId: 'mat',
        subject: 'Matematik',
        score: 70,
        date: '2025-10-01',
      },
      {
        classId: 'c10',
        term: 2,
        subjectId: 'tr',
        subject: 'Türkçe',
        score: 90,
        date: '2025-03-01',
      },
      {
        classId: 'c10',
        term: 1,
        subjectId: 'mat',
        subject: 'Matematik',
        score: 81,
        date: '2024-11-01',
      },
      {
        classId: 'c10',
        term: 1,
        subjectId: 'mat',
        subject: 'Matematik',
        score: 90,
        date: '2024-12-01',
      },
      {
        classId: 'c10',
        term: 1,
        subjectId: 'bio',
        subject: 'Biyoloji',
        score: 60,
        date: '2024-12-02',
      },
      {
        classId: 'cx',
        term: 1,
        subjectId: 'bio',
        subject: 'Biyoloji',
        score: 50,
        date: '2026-01-02',
      },
    ],
    courses: [],
  })
  assert.deepEqual(
    transcript.terms.map((term) => [term.className, term.term]),
    [
      ['10-A', 1],
      ['10-A', 2],
      ['11-A', 1],
      ['—', 1],
    ],
  )
  assert.deepEqual(transcript.terms[0]?.subjects, [
    { name: 'Biyoloji', average: 60, count: 1 },
    { name: 'Matematik', average: 86, count: 2 },
  ])
  assert.equal(transcript.schoolNumber, '2026001')
  assert.equal(alumniDocumentContentSchema.parse(transcript).kind, 'transcript')

  const language = buildAlumniTranscript({
    institution: { name: 'Kampüs Dil Akademisi', type: 'language_school' },
    student: { name: 'Ece' },
    outcome: 'withdrawn',
    enrolledDate: '2025-01-01',
    leftDate: '2026-01-01',
    lastClassName: null,
    classNames: new Map(),
    grades: [],
    courses: [
      {
        name: 'B1',
        level: 'B1',
        groupName: 'B1-Sabah',
        startDate: '2025-06-01',
        endDate: '2025-09-01',
      },
      {
        name: 'A2',
        level: 'A2',
        groupName: 'A2-Akşam',
        startDate: '2025-01-10',
        endDate: '2025-05-01',
      },
      {
        name: 'A2',
        level: 'A2',
        groupName: 'A2-Akşam',
        startDate: '2025-01-10',
        endDate: '2025-05-01',
      },
    ],
  })
  assert.deepEqual(
    language.courses.map((course) => course.groupName),
    ['A2-Akşam', 'B1-Sabah'],
  )
  assert.equal(language.schoolNumber, null)
})

test('DOM-KAY-044 K-329: ücret ayarı kuruş, eksi ve üst sınır dışı reddedilir, boş güncelleme yok', () => {
  assert.deepEqual(updateAlumniDocumentFeesSchema.parse({ transcript: 15_000 }), {
    transcript: 15_000,
  })
  assert.equal(updateAlumniDocumentFeesSchema.safeParse({}).success, false)
  assert.equal(updateAlumniDocumentFeesSchema.safeParse({ transcript: -1 }).success, false)
  assert.equal(updateAlumniDocumentFeesSchema.safeParse({ transcript: 1.5 }).success, false)
  assert.equal(updateAlumniDocumentFeesSchema.safeParse({ diploma_copy: 1_000_001 }).success, false)
})
