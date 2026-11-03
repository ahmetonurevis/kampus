import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CourseCertificate } from '@kampus/react-shared/use-course-certificates.ts'
import {
  certificateLevelStatement,
  containsForbiddenPhrase,
} from '@kampus/school-core/cefr/certificates.ts'
import { COLORS, PAGE } from '../src/lib/pdf/layout.ts'
import { qrMatrix } from '../src/lib/pdf/qr.ts'
import {
  attendanceLabel,
  certificateVerificationUrl,
  courseCertificateDocument,
  documentTexts,
} from '../src/lib/pdf/templates/course-certificate.ts'
import { documentFilename } from '../src/lib/pdf/templates/shared.ts'
import { allTexts, measurer, texts } from './support/pdf-measurer.ts'

// Kurum başarı belgesi PDF'i (OG-088; IST-081; DOM-DIL-081, DOM-DIL-082).

const CODE = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345'
const URL_BASE = 'https://kampus.example/app/'
const VERIFY_URL = certificateVerificationUrl(URL_BASE, CODE)

function certificate(overrides: Partial<Record<string, unknown>> = {}): CourseCertificate {
  return {
    id: 'cert-test-1',
    number: 'KB-2026-000007',
    status: 'valid',
    verificationCode: CODE,
    enrollmentId: 'enr-test-1',
    groupId: 'grp-test-1',
    learnerId: 'stu-test-1',
    courseId: 'course-test-b1',
    decisionId: 'dec-test-1',
    content: {
      schemaVersion: 1,
      title: 'Kurum başarı belgesi',
      institutionName: 'Kampüs Dil Akademisi',
      learnerName: 'Deniz Yılmaz',
      courseId: 'course-test-b1',
      courseName: 'B1 Genel İngilizce',
      level: 'B1',
      levelStatement: certificateLevelStatement('B1'),
      totalHours: 120,
      attendance: { attendedHours: 110, totalHours: 120, permille: 916 },
      finalScore: 78,
      skills: [
        { skill: 'reading', score: 80 },
        { skill: 'listening', score: 74 },
        { skill: 'writing', score: 66 },
        { skill: 'speaking', score: 71 },
      ],
      decisionId: 'dec-test-1',
      approvedAt: '2026-11-01T09:00:00.000Z',
    },
    replacesCertificateId: null,
    issuedByUserId: 'u-test-1',
    // İstanbul'da 3 Kasım (UTC'de 2 Kasım 22:30).
    issuedAt: '2026-11-02T22:30:00.000Z',
    cancelledByUserId: null,
    cancelledAt: null,
    cancellationReason: null,
    rowVersion: 1,
    ...overrides,
  } as CourseCertificate
}

const OPTIONS = { verificationUrl: VERIFY_URL, qr: qrMatrix(VERIFY_URL) }
const joined = (document: ReturnType<typeof courseCertificateDocument>) =>
  allTexts(document).join(' ')

test('DOM-DIL-081: belge kurum, kursiyer, kur, saat, devam, seviye, beceri profili, numara ve tarihi yazar', () => {
  const document = courseCertificateDocument(measurer, certificate(), OPTIONS)
  const all = allTexts(document)
  const text = joined(document)
  assert.ok(all.includes('KURUM BAŞARI BELGESİ'))
  assert.ok(all.includes('Kurum başarı belgesi'))
  assert.ok(all.includes('KAMPÜS DİL AKADEMİSİ'))
  for (const value of [
    'Deniz Yılmaz',
    'B1 Genel İngilizce',
    '120 saat',
    '%91,6 (110 / 120 saat)',
    'kurum değerlendirmesine göre CEFR B1 düzeyinde',
    '78 / 100',
    'KB-2026-000007',
  ])
    assert.ok(text.includes(value), `eksik: ${value}`)
  for (const skill of ['Okuma', 'Dinleme', 'Yazma', 'Konuşma']) assert.ok(all.includes(skill))
  // Düzenlenme günü Europe/Istanbul'a göredir.
  assert.ok(all.includes('3 Kas 2026'))
  assert.ok(!all.includes('2 Kas 2026'))
  assert.ok(all.includes('Belge no: KB-2026-000007'))
  assert.equal(document.pages.length, 1)
  assert.ok(texts(document.pages[0]!).includes('1 / 1'))
  for (const op of document.pages[0]!.ops)
    if (op.kind === 'text' && op.y < 276) assert.ok(op.y <= PAGE.bottom + 5, `taştı: ${op.text}`)
  // Safir şerit ve turuncu köşe (marka düzeni) her sayfada.
  for (const page of document.pages)
    assert.deepEqual(
      page.ops
        .filter((op) => op.kind === 'rect' && op.y === 0)
        .map((op) => op.kind === 'rect' && op.fill),
      [COLORS.sapphire, COLORS.orange],
    )
})

test('DOM-DIL-081: şablon metni yasak ifade içermez; "CEFR sertifikası" ve "Avrupa Konseyi" yok', () => {
  for (const status of ['valid', 'cancelled'] as const) {
    const document = courseCertificateDocument(
      measurer,
      certificate({ status, cancelledAt: '2026-11-03T08:00:00.000Z' }),
      OPTIONS,
    )
    const texts = documentTexts(document)
    assert.equal(texts.some(containsForbiddenPhrase), false)
    assert.equal(containsForbiddenPhrase(texts.join(' ')), false)
    assert.ok(!/sertifika/i.test(texts.join(' ')))
    assert.ok(!/MEB amblem/i.test(texts.join(' ')))
  }
})

test('DOM-DIL-081: yasak ifade taşıyan içerik PDF olarak üretilmez', () => {
  const content = {
    ...certificate().content,
    courseName: 'Avrupa Konseyi onaylı B1',
  }
  assert.throws(
    () => courseCertificateDocument(measurer, certificate({ content }), OPTIONS),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'certificate_wording_forbidden',
  )
  // İki satıra bölünmüş ifade de yakalanır.
  const split = { ...certificate().content, courseName: `${'Uzun '.repeat(30)}CEFR sertifikası` }
  assert.throws(() => courseCertificateDocument(measurer, certificate({ content: split }), OPTIONS))
})

test('DOM-DIL-082: doğrulama kodu ve QR doğrulama sayfasının adresini taşır', () => {
  assert.equal(VERIFY_URL, `https://kampus.example/app/belge-dogrula/${CODE}`)
  assert.equal(
    certificateVerificationUrl('http://127.0.0.1:5174/', 'A B'),
    'http://127.0.0.1:5174/belge-dogrula/A%20B',
  )
  const document = courseCertificateDocument(measurer, certificate(), OPTIONS)
  const all = allTexts(document)
  assert.ok(all.includes(CODE))
  assert.ok(joined(document).includes(VERIFY_URL))
  // QR: beyaz zemin + koyu modüller; bütün modüller zeminin içindedir ve gövde alanındadır.
  const qr = OPTIONS.qr
  assert.ok(qr.size >= 21)
  const page = document.pages.find((p) =>
    p.ops.some((op) => op.kind === 'text' && op.text === CODE),
  )!
  const modules = page.ops.filter(
    (op) => op.kind === 'rect' && op.fill === COLORS.ink && op.radius === 0,
  )
  const darkCount = qr.dark.flat().filter(Boolean).length
  const area = modules.reduce((sum, op) => sum + (op.kind === 'rect' ? op.width * op.height : 0), 0)
  const cell = 34 / (qr.size + 8)
  assert.ok(Math.abs(area - darkCount * cell * cell) < 1e-6)
  for (const op of modules)
    if (op.kind === 'rect') {
      assert.ok(op.x >= PAGE.left && op.x + op.width <= PAGE.left + 34 + 1e-9)
      assert.ok(op.y + op.height <= PAGE.bottom)
    }
})

test('DOM-DIL-082: iptal edilmiş belge "İPTAL EDİLDİ" işaretiyle ve iptal tarihiyle üretilir', () => {
  const document = courseCertificateDocument(
    measurer,
    certificate({ status: 'cancelled', cancelledAt: '2026-11-03T08:00:00.000Z' }),
    OPTIONS,
  )
  const all = allTexts(document)
  // Rozet ve gövde işareti; belge iptalde de tek sayfadır.
  assert.equal(document.pages.length, 1)
  assert.equal(all.filter((text) => text === 'İPTAL EDİLDİ').length, 2)
  assert.ok(joined(document).includes('3 Kas 2026 tarihinde iptal edilmiştir; geçerli değildir.'))
  const valid = allTexts(courseCertificateDocument(measurer, certificate(), OPTIONS))
  assert.ok(!valid.includes('İPTAL EDİLDİ'))
  assert.ok(valid.includes('BAŞARI BELGESİ'))
})

test('DOM-DIL-081: öğrencinin dar belgesi de aynı şablonla üretilir; dosya adı belge numarasından', () => {
  const { content } = certificate()
  const learner = {
    id: 'cert-test-1',
    number: 'KB-2026-000007',
    status: 'valid',
    verificationCode: CODE,
    courseId: 'course-test-b1',
    content,
    issuedAt: '2026-11-02T22:30:00.000Z',
  } as CourseCertificate
  assert.ok(allTexts(courseCertificateDocument(measurer, learner, OPTIONS)).includes(CODE))
  assert.equal(
    documentFilename('course-certificate', 'KB-2026-000007'),
    'basari-belgesi-KB-2026-000007.pdf',
  )
  assert.equal(attendanceLabel(1000), '%100')
  assert.equal(attendanceLabel(805), '%80,5')
})
