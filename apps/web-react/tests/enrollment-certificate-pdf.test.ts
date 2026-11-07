import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { EnrollmentCertificate } from '@kampus/school-core/lib/enrollment-certificate.ts'
import {
  enrollmentCertificateDocument,
  enrollmentCertificateFilename,
  enrollmentCertificateTitle,
} from '../src/lib/pdf/templates/enrollment-certificate.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

const DOCUMENT_ID = '3f2a6c1e-8b7d-4a55-9c31-2d4e6f708192'
const certificate = (overrides: Partial<EnrollmentCertificate> = {}): EnrollmentCertificate => ({
  documentId: DOCUMENT_ID,
  // İstanbul'da 7 Ekim 01.30: gün sunucu UTC'si değil, Europe/Istanbul günüdür.
  issuedAt: '2026-10-06T22:30:00.000Z',
  institutionName: 'Akademi Özel Okulları',
  institutionType: 'school',
  learnerName: 'Deniz Yılmaz',
  schoolNumber: '2026001',
  className: '6-A',
  courseNames: [],
  academicYear: 2026,
  ...overrides,
})
const textOf = (data: EnrollmentCertificate) =>
  allTexts(enrollmentCertificateDocument(measurer, data)).join('\n')

test('DOM-KAY-027: okul belgesi kurum, ad, numara, sınıf, yıl, tarih ve belge kimliğini yazar', () => {
  const text = textOf(certificate())
  for (const expected of [
    'ÖĞRENCİ BELGESİ',
    'Akademi Özel Okulları',
    'Deniz Yılmaz',
    'Okul numarası',
    '2026001',
    'Sınıf',
    '6-A',
    '2026–2027',
    'Belge kimliği',
    DOCUMENT_ID,
  ])
    assert.ok(text.includes(expected), expected)
  assert.match(text.replace(/\n/g, ' '), /kayıtlı öğrencisidir\./)
})

test('DOM-KAY-027: düzenleme tarihi Europe/Istanbul günüdür', () => {
  const text = textOf(certificate())
  assert.match(text, /7 Eki 2026/)
  assert.doesNotMatch(text, /6 Eki 2026/)
})

test('DOM-KAY-027: dil okulunda kursiyer terimi ve kur yazılır, sınıf satırı yerine geçer', () => {
  const data = certificate({
    institutionType: 'language_school',
    institutionName: 'Kampüs Dil Akademisi',
    courseNames: ['Genel İngilizce B1.1', 'IELTS Hazırlık'],
  })
  const text = textOf(data)
  for (const expected of ['KURSİYER BELGESİ', 'Kursiyer numarası', 'Kur', 'e-Özel'])
    assert.ok(text.includes(expected), expected)
  assert.ok(text.includes('Genel İngilizce B1.1, IELTS Hazırlık'))
  assert.match(text.replace(/\n/g, ' '), /kayıtlı kursiyeridir\./)
  assert.doesNotMatch(text, /Öğrenci|öğrenci|e-Okul|\b6-A\b/)
})

test('DOM-KAY-027: kuru olmayan kursiyerde sınıf yazılır', () => {
  const text = textOf(certificate({ institutionType: 'language_school' }))
  assert.ok(text.includes('Sınıf'))
  assert.ok(text.includes('6-A'))
})

test('DOM-KAY-027, DOM-AKD-050: resmî belgeyle karışmaz: ibare var; mühür, imza ve resmî ad iddiası yok', () => {
  const data = enrollmentCertificateDocument(measurer, certificate())
  const text = allTexts(data).join(' ')
  assert.match(text, /Bilgilendirme amaçlıdır; e-Okul ve MEB belgesi yerine geçmez\./)
  assert.match(text, /resmî belge yerine geçmez\./)
  assert.doesNotMatch(text, /mühür|imza|T\.C\.|Millî Eğitim Bakanlığı|onaylı|TÜRKİYE CUMHURİYETİ/i)
  // Altbilgi kırılmadan yazılır: sayfa numarasıyla çakışmayacak kadar kısa.
  const footer = allTexts(data).find((line) => line.startsWith('Bilgilendirme amaçlıdır'))
  assert.ok(footer && measurer.width(footer, 7) < 150, footer)
})

test('DOM-KAY-027: kimlik, sağlık, ücret ve disiplin bilgisi şablonda yazmaz', () => {
  const leaky = {
    ...certificate(),
    nationalId: '10000000146',
    birthDate: '2012-03-04',
    balanceCents: 123_456,
    health: 'fıstık alerjisi',
    discipline: 'kınama',
  }
  const text = textOf(leaky)
  for (const secret of ['10000000146', '2012', '1.234', 'alerji', 'kınama', '₺', 'Kimlik no'])
    assert.ok(!text.includes(secret), secret)
})

test('DOM-KAY-027: eksik numara, sınıf ve yıl tire yazılır, cümle yılsız kurulur', () => {
  const text = textOf(certificate({ schoolNumber: null, className: null, academicYear: null }))
  assert.ok(text.includes('—'))
  assert.doesNotMatch(text, /eğitim yılında|null|undefined/)
  assert.match(text.replace(/\n/g, ' '), /kurumunun kayıtlı öğrencisidir\./)
})

test('DOM-KAY-027: başlık ve dosya adı türe göre; dosya adında kişi verisi yok', () => {
  assert.equal(enrollmentCertificateTitle('school'), 'Öğrenci belgesi')
  assert.equal(enrollmentCertificateTitle('language_school'), 'Kursiyer belgesi')
  assert.equal(enrollmentCertificateFilename('school', DOCUMENT_ID), 'ogrenci-belgesi-3f2a6c1e.pdf')
  assert.equal(
    enrollmentCertificateFilename('language_school', DOCUMENT_ID),
    'kursiyer-belgesi-3f2a6c1e.pdf',
  )
})
