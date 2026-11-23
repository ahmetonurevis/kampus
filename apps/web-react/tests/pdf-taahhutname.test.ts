import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { documentData } from '@kampus/school-core/lib/document-data.ts'
import { PAGE } from '../src/lib/pdf/layout.ts'
import { paymentPlanDocument } from '../src/lib/pdf/templates/payment-plan.ts'
import { documentFilename } from '../src/lib/pdf/templates/shared.ts'
import { allTexts, measurer, texts } from './support/pdf-measurer.ts'

const NOW = new Date('2026-10-15T09:00:00.000Z')
const OPTIONS = { institution: 'Akademi Özel Okulları', generatedAt: NOW }

test('DOM-FIN-051 taksit taahhütnamesi özet bandı, taksit takvimi, imza ve belge numarası içerir', () => {
  const seed = createSeed(NOW)
  const data = documentData(seed, 'payment-plan', 's1')
  const document = paymentPlanDocument(measurer, data, OPTIONS)
  const all = allTexts(document)
  assert.ok(all.includes('TAKSİT TAAHHÜTNAMESİ'))
  assert.ok(all.includes('TOPLAM BEDEL'))
  assert.ok(all.includes('TAHSİL EDİLEN'))
  assert.ok(all.includes('KALAN BAKİYE'))
  assert.ok(all.includes('Taksit takvimi'))
  assert.ok(all.includes('Belge no: plan-s1'))
  assert.ok(all.includes('Okul muhasebesi · Kontrol / Tarih'))
  assert.equal(all.filter((text) => /^\d+\. taksit$/.test(text)).length, data.invoices.length)
  assert.ok(texts(document.pages[0]!).includes(`1 / ${document.pages.length}`))
  assert.equal(document.metadata.title, 'TAKSİT TAAHHÜTNAMESİ')
})

test('DOM-FIN-051 uzun taksit planı sayfalara bölünür; her sayfada tablo başlığı yinelenir', () => {
  const seed = createSeed(NOW)
  const template = seed.invoices.find((item) => item.studentId === 's1')!
  seed.invoices = Array.from({ length: 70 }, (_, index) => ({
    ...template,
    id: `inv-taahhut-${index}`,
    installment: index + 1,
  }))
  const document = paymentPlanDocument(measurer, documentData(seed, 'payment-plan', 's1'), OPTIONS)
  assert.ok(document.pages.length > 2)
  for (const page of document.pages)
    assert.ok(texts(page).includes('Vade tarihi'), 'tablo başlığı her sayfada vardır')
  assert.equal(allTexts(document).filter((text) => /^\d+\. taksit$/.test(text)).length, 70)
  document.pages.forEach((page, index) => {
    assert.ok(texts(page).includes(`${index + 1} / ${document.pages.length}`))
    for (const op of page.ops)
      if (op.kind === 'text' && op.y < 276) assert.ok(op.y <= PAGE.bottom + 5)
  })
})

test('taahhütname dosya adı öğrenci kimliğinden üretilir', () => {
  assert.equal(documentFilename('payment-plan', 's1'), 'taksit-plani-s1.pdf')
})
