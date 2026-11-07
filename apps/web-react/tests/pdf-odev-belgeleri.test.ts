import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { documentData } from '@kampus/school-core/lib/document-data.ts'
import { COLORS, PAGE } from '../src/lib/pdf/layout.ts'
import { homeworkDocument } from '../src/lib/pdf/templates/homework.ts'
import { documentFilename } from '../src/lib/pdf/templates/shared.ts'
import { submissionDocument } from '../src/lib/pdf/templates/submission.ts'
import { allTexts, measurer, texts } from './support/pdf-measurer.ts'

const NOW = new Date('2026-10-15T09:00:00.000Z')
const OPTIONS = { institution: 'Akademi Özel Okulları', generatedAt: NOW }

function body(document: ReturnType<typeof homeworkDocument>) {
  return document.pages.flatMap((page) => page.ops.filter((op) => op.y < 276))
}

test('ödev çalışma kâğıdı öğrenci adı ve numarasıyla, yazı alanları ve belge numarasıyla üretilir', () => {
  const seed = createSeed(NOW)
  const homework = seed.homework.find((item) => item.id === 'hw1')!
  const student = seed.students.find((item) => item.classId === homework.classId)!
  const document = homeworkDocument(
    measurer,
    documentData(seed, 'homework', homework.id, student.id),
    OPTIONS,
  )
  const all = allTexts(document)
  assert.ok(all.includes('ÖDEV ÇALIŞMA KÂĞIDI'))
  assert.ok(all.includes(homework.title))
  assert.ok(all.includes(student.name))
  assert.ok(all.includes('01 / Görev ve yönerge'))
  assert.ok(all.includes('02 / Çalışmam'))
  assert.ok(all.includes('03 / Kontrol ve öz değerlendirme'))
  assert.ok(all.includes(`Belge no: ${homework.id}`))
  assert.ok(texts(document.pages[0]!).includes(`1 / ${document.pages.length}`))
  // Safir şerit ve turuncu köşe her sayfada.
  for (const page of document.pages)
    assert.deepEqual(
      page.ops
        .filter((op) => op.kind === 'rect' && op.y === 0)
        .map((op) => op.kind === 'rect' && op.fill),
      [COLORS.sapphire, COLORS.orange],
    )
})

test('öğretmen belgesinde öğrenci alanları doldurulacak boşluk olarak kalır', () => {
  const seed = createSeed(NOW)
  const document = homeworkDocument(measurer, documentData(seed, 'homework', 'hw1'), OPTIONS)
  const blanks = allTexts(document).filter((text) => text.startsWith('....'))
  assert.equal(blanks.length, 2)
})

test('çok sayfalı ödev açıklaması sayfa numaralarını ve alt sınırı korur', () => {
  const seed = createSeed(NOW)
  const homework = seed.homework.find((item) => item.id === 'hw1')!
  homework.description = Array.from({ length: 400 }, (_, index) => `adım${index}`).join(' ')
  const document = homeworkDocument(measurer, documentData(seed, 'homework', 'hw1'), OPTIONS)
  assert.ok(document.pages.length > 1)
  document.pages.forEach((page, index) => {
    assert.ok(texts(page).includes(`${index + 1} / ${document.pages.length}`))
    assert.ok(texts(page).includes(`Belge no: hw1`))
  })
  for (const op of body(document))
    if (op.kind === 'text') assert.ok(op.y <= PAGE.bottom + 5, `taştı: ${op.text}`)
  assert.ok(texts(document.pages[1]!).includes('ÖDEV ÇALIŞMA KÂĞIDI · Devam'))
})

test('ödev dosya adı kayıt kimliğinden üretilir', () => {
  assert.equal(documentFilename('homework', 'hw1'), 'odev-hw1.pdf')
})

test('değerlendirilmiş teslim formu puan, geri bildirim ve teslim bilgisini yazar', () => {
  const seed = createSeed(NOW)
  const submission = seed.submissions.find((item) => item.id === 'sub-deniz')!
  const document = submissionDocument(
    measurer,
    documentData(seed, 'submission', submission.id),
    OPTIONS,
  )
  const all = allTexts(document)
  assert.ok(all.includes('ÖDEV DEĞERLENDİRME FORMU'))
  assert.ok(all.includes('DEĞERLENDİRME PUANI'))
  assert.ok(all.includes('88 / 100'))
  assert.ok(all.includes('Değerlendirildi'))
  assert.ok(all.includes('deniz-denklemler.pdf'))
  assert.ok(all.includes('Öğretmen geri bildirimi'))
  assert.ok(all.some((text) => text.includes('Denklemin iki tarafına')))
  assert.ok(all.includes(`Belge no: ${submission.id}`))
  assert.ok(all.includes('Deniz Yılmaz'))
  assert.equal(document.metadata.title, 'ÖDEV DEĞERLENDİRME FORMU')
})

test('değerlendirilmemiş teslimde puan "Bekliyor", geri bildirim yerine bilgi notu yazılır', () => {
  const seed = createSeed(NOW)
  const submission = seed.submissions.find((item) => item.id === 'sub-deniz')!
  submission.score = null
  submission.feedback = ''
  const document = submissionDocument(
    measurer,
    documentData(seed, 'submission', submission.id),
    OPTIONS,
  )
  const all = allTexts(document)
  assert.ok(all.includes('Bekliyor'))
  assert.ok(all.includes('Öğretmen değerlendirmesi bekleniyor'))
  assert.ok(all.includes('Bu teslim için henüz geri bildirim paylaşılmadı.'))
})

test('uzun geri bildirim çok sayfalı formda sayfa numaralarını ve alt sınırı korur', () => {
  const seed = createSeed(NOW)
  const submission = seed.submissions.find((item) => item.id === 'sub-deniz')!
  submission.feedback = Array.from({ length: 500 }, (_, index) => `not${index}`).join(' ')
  const document = submissionDocument(
    measurer,
    documentData(seed, 'submission', submission.id),
    OPTIONS,
  )
  assert.ok(document.pages.length > 1)
  document.pages.forEach((page, index) =>
    assert.ok(texts(page).includes(`${index + 1} / ${document.pages.length}`)),
  )
  for (const op of body(document))
    if (op.kind === 'text') assert.ok(op.y <= PAGE.bottom + 5, `taştı: ${op.text}`)
})

test('teslim yoksa ya da çalışma kâğıdı kaydı verilmişse form üretilmez', () => {
  const seed = createSeed(NOW)
  assert.throws(() => documentData(seed, 'submission', 'yok'), /bulunamadı/)
  assert.throws(
    () => submissionDocument(measurer, documentData(seed, 'homework', 'hw1') as never, OPTIONS),
    /bulunamadı/,
  )
})

test('değerlendirme formu dosya adı teslim kimliğinden üretilir', () => {
  assert.equal(documentFilename('submission', 'sub-deniz'), 'odev-degerlendirme-sub-deniz.pdf')
})
