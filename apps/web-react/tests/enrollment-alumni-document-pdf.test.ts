import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  alumniDocumentFilename,
  alumniDocumentPdf,
  alumniDocumentTitle,
  type AlumniDocumentPdfData,
} from '../src/lib/pdf/templates/enrollment-alumni-document.ts'
import {
  alumniFeesBody,
  alumniFeesDefaults,
  authorizationNeed,
  createAlumniRequestBody,
  documentTypeOptions,
  eligibleGuardians,
  ALUMNI_REQUEST_DEFAULTS,
} from '../src/pages/crm/enrollment-alumni-document-forms.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// Mezun belgeleri PDF'i ve form modeli (DOM-KAY-044; ON-260, K-328…K-331).

const learner = {
  institutionName: 'Akademi Özel Okulları',
  institutionType: 'school' as const,
  learnerName: 'Deniz Yılmaz',
  schoolNumber: '2022001',
  enrolledDate: '2022-09-12',
  leftDate: '2026-06-26',
  outcome: 'graduated' as const,
  lastClassName: '12-A',
}
const certificate = (overrides: Partial<AlumniDocumentPdfData> = {}): AlumniDocumentPdfData => ({
  documentNumber: 'MB-2026-0001',
  documentType: 'education_certificate',
  copies: 1,
  // İstanbul'da 7 Ekim 01.30.
  issuedAt: '2026-10-06T22:30:00.000Z',
  manualNote: null,
  content: { kind: 'education_certificate', ...learner },
  ...overrides,
})
const textOf = (data: AlumniDocumentPdfData) =>
  allTexts(alumniDocumentPdf(measurer, data)).join('\n')

test('DOM-KAY-044: öğrenim belgesi kayıt ve mezuniyet tarihini, numarayı ve ibareyi yazar; kimlik yazmaz', () => {
  const text = textOf(certificate())
  for (const expected of [
    'ÖĞRENİM BELGESİ',
    'Deniz Yılmaz',
    '2022001',
    'Mezuniyet tarihi',
    '12-A',
    'MB-2026-0001',
    'Bilgilendirme amaçlıdır',
    'e-Okul',
    '7 Eki 2026',
  ])
    assert.ok(text.includes(expected), expected)
  assert.match(text.replace(/\n/g, ' '), /mezun olmuştur\./)
  assert.doesNotMatch(text, /T\.C\.|mühür|imza/i)
  assert.equal(alumniDocumentFilename(certificate()), 'ogrenim-belgesi-mb-2026-0001.pdf')
})

test('DOM-KAY-044: not dökümü ders ortalamaları tablosunu ve açıklamayı yazar; ayrılan için ayrılış', () => {
  const data = certificate({
    documentType: 'transcript',
    manualNote: '9. sınıf notları önceki okuldadır.',
    content: {
      kind: 'transcript',
      ...learner,
      outcome: 'withdrawn',
      terms: [
        { className: '11-A', term: 1, subjects: [{ name: 'Matematik', average: 86, count: 2 }] },
      ],
      courses: [],
    },
  })
  const text = textOf(data)
  for (const expected of [
    'NOT DÖKÜMÜ',
    'Ders ortalamaları',
    '11-A',
    '1. dönem',
    'Matematik',
    '86',
    'Ayrılış tarihi',
    '9. sınıf notları önceki okuldadır.',
  ])
    assert.ok(text.includes(expected), expected)
  assert.match(text.replace(/\n/g, ' '), /ayrılmıştır\./)
  assert.equal(alumniDocumentTitle(data.content), 'Not dökümü')
  assert.equal(alumniDocumentFilename(data), 'not-dokumu-mb-2026-0001.pdf')
})

test('DOM-KAY-044: dil okulunda kur dökümü, kursiyer terimi ve e-Özel ibaresi', () => {
  const text = textOf(
    certificate({
      documentType: 'transcript',
      content: {
        kind: 'transcript',
        ...learner,
        institutionType: 'language_school',
        lastClassName: null,
        terms: [],
        courses: [
          {
            name: 'Genel İngilizce A2',
            level: 'A2',
            groupName: 'A2-Akşam',
            startDate: '2025-01-10',
            endDate: '2025-05-01',
          },
        ],
      },
    }),
  )
  for (const expected of ['KUR DÖKÜMÜ', 'Kursiyer', 'Katıldığı kurlar', 'A2-Akşam', 'e-Özel'])
    assert.ok(text.includes(expected), expected)
  assert.doesNotMatch(text, /Son sınıf/)
})

test('DOM-KAY-044 K-328: form gövdesi talep edene ve teslim yoluna ait olmayanı göndermez; yetki belgesi ihtiyacı', () => {
  const body = createAlumniRequestBody(
    {
      ...ALUMNI_REQUEST_DEFAULTS,
      studentId: 's1',
      copies: '3',
      requesterKind: 'proxy',
      proxyName: '  Av. Ali Kaya ',
      guardianParentId: 'p1',
      deliveryMethod: 'email',
      deliveryEmail: ' deniz@example.com ',
      deliveryAddress: 'Kadıköy İstanbul uzun adres',
    },
    'file-1',
  )
  assert.deepEqual(body, {
    studentId: 's1',
    documentType: 'education_certificate',
    copies: 3,
    channel: 'in_person',
    requesterKind: 'proxy',
    proxyName: 'Av. Ali Kaya',
    authorizationFileId: 'file-1',
    deliveryMethod: 'email',
    deliveryEmail: 'deniz@example.com',
  })
  assert.equal(
    createAlumniRequestBody({ ...ALUMNI_REQUEST_DEFAULTS, studentId: 's1' }, 'file-1')
      .authorizationFileId,
    undefined,
  )
  assert.equal(authorizationNeed({ adult: true }, 'guardian'), 'consent')
  assert.equal(authorizationNeed({ adult: null }, 'guardian'), 'consent')
  assert.equal(authorizationNeed({ adult: false }, 'guardian'), null)
  assert.equal(authorizationNeed(undefined, 'proxy'), 'proxy')
  assert.equal(authorizationNeed({ adult: true }, 'self'), null)
})

test('DOM-KAY-044 K-331: diploma örneği yalnız okulda ve mezuna; yalnız velayetli, kısıtsız veli seçilir', () => {
  assert.deepEqual(documentTypeOptions('school', { status: 'graduated' }), [
    'education_certificate',
    'transcript',
    'diploma_copy',
  ])
  assert.deepEqual(documentTypeOptions('school', { status: 'withdrawn' }), [
    'education_certificate',
    'transcript',
  ])
  assert.deepEqual(documentTypeOptions('language_school', { status: 'graduated' }), [
    'education_certificate',
    'transcript',
  ])
  const guardians = eligibleGuardians({
    id: 's1',
    name: 'Ece',
    schoolNumber: null,
    status: 'withdrawn',
    leftDate: null,
    lastClassName: null,
    adult: false,
    guardians: [
      { parentId: 'p1', name: 'Ayşe', custody: 'full', contactRestricted: false },
      { parentId: 'p2', name: 'Kemal', custody: 'none', contactRestricted: false },
      { parentId: 'p3', name: 'Ali', custody: 'joint', contactRestricted: true },
    ],
  })
  assert.deepEqual(
    guardians.map((guardian) => guardian.parentId),
    ['p1'],
  )
})

test('DOM-KAY-044 K-329: ücret formu kuruşa çevrilir, yalnız değişen tür gönderilir', () => {
  const current = { education_certificate: 0, transcript: 15_000, diploma_copy: 0 }
  const defaults = alumniFeesDefaults(current)
  assert.equal(defaults.transcript, '150,00')
  assert.deepEqual(alumniFeesBody({ ...defaults, education_certificate: '75,50' }, current), {
    education_certificate: 7_550,
  })
  assert.deepEqual(alumniFeesBody(defaults, current), {})
})
