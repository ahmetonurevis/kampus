import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { documentData } from '@kampus/school-core/lib/document-data.ts'
import {
  COLORS,
  DocumentLayout,
  PAGE,
  rgb,
  type PdfDocument,
  type PdfOp,
  type TextMeasurer,
} from '../src/lib/pdf/layout.ts'
import { contractDocument, documentFilename, receiptDocument } from '../src/lib/pdf/templates.ts'

/** Sahte ölçer: karakter başına sabit genişlik (jsPDF ve yazı tipi gerekmez). */
const measurer: TextMeasurer = {
  width: (text, size) => text.length * size * 0.18,
  wrap(text, width, size) {
    const perLine = Math.max(1, Math.floor(width / (size * 0.18)))
    const lines: string[] = []
    let current = ''
    for (const word of text.split(' ')) {
      const next = current ? `${current} ${word}` : word
      if (next.length > perLine && current) {
        lines.push(current)
        current = word
      } else current = next
    }
    lines.push(current)
    return lines
  },
}

const NOW = new Date('2026-10-15T09:00:00.000Z')
const OPTIONS = { institution: 'Akademi Özel Okulları', generatedAt: NOW }

function texts(page: PdfDocument['pages'][number]) {
  return page.ops.flatMap((op) => (op.kind === 'text' ? [op.text] : []))
}

function textOps(document: PdfDocument) {
  return document.pages.flatMap((page) => page.ops.filter((op) => op.kind === 'text'))
}

/** Altbilgi dışı içerik işlemleri; hiçbiri içerik alt sınırını aşmamalıdır. */
function bodyOps(page: PdfDocument['pages'][number]): PdfOp[] {
  return page.ops.filter((op) => op.y < 276)
}

function seedWithPaidInvoice() {
  const seed = createSeed(NOW)
  const invoice = seed.invoices.find((item) => item.paidAt)
  assert.ok(invoice, 'örnek veride ödenmiş taksit olmalı')
  return { seed, invoice }
}

test('marka renkleri hex değerlerinden okunur', () => {
  assert.deepEqual(rgb('#1E3A8A'), [30, 58, 138])
  assert.deepEqual(rgb('#F97316'), [249, 115, 22])
  assert.deepEqual(COLORS.sapphire, [30, 58, 138])
  assert.deepEqual(COLORS.orange, [249, 115, 22])
  assert.throws(() => rgb('turuncu'))
})

test('dekont tek sayfadır; belge no, sayfa numarası ve marka şeridi vardır', () => {
  const { seed, invoice } = seedWithPaidInvoice()
  const document = receiptDocument(measurer, documentData(seed, 'receipt', invoice.id), OPTIONS)
  assert.equal(document.pages.length, 1)
  const page = document.pages[0]!
  const all = texts(page)
  assert.ok(all.includes('TAHSİLAT DEKONTU'))
  assert.ok(all.includes('TAHSİL EDİLEN TUTAR'))
  assert.ok(all.includes('1 / 1'))
  assert.ok(all.includes(`Belge no: ${invoice.id}`))
  assert.ok(all.includes('AKADEMİ ÖZEL OKULLARI'))
  // Üst şerit safir, sağ köşesi turuncu.
  const bars = page.ops.filter((op) => op.kind === 'rect' && op.y === 0)
  assert.deepEqual(
    bars.map((op) => op.kind === 'rect' && op.fill),
    [COLORS.sapphire, COLORS.orange],
  )
  assert.equal(document.metadata.title, 'TAHSİLAT DEKONTU')
})

test('dekont ödenmemiş taksit için üretilmez (core kuralı)', () => {
  const seed = createSeed(NOW)
  const unpaid = seed.invoices.find((item) => !item.paidAt)
  assert.ok(unpaid)
  assert.throws(() => documentData(seed, 'receipt', unpaid.id), /yalnızca tamamlanan/)
})

test('sözleşme iki sayfadır: metin ve Ek 1 ödeme planı, sayfa numaraları n / toplam', () => {
  const seed = createSeed(NOW)
  const contract = seed.contracts[0]!
  const document = contractDocument(measurer, documentData(seed, 'contract', contract.id), OPTIONS)
  assert.equal(document.pages.length, 2)
  const [first, second] = document.pages as [
    PdfDocument['pages'][number],
    PdfDocument['pages'][number],
  ]
  assert.ok(texts(first).includes('1 / 2'))
  assert.ok(texts(second).includes('2 / 2'))
  assert.ok(texts(first).includes('EĞİTİM SÖZLEŞMESİ'))
  assert.ok(texts(second).includes('EĞİTİM SÖZLEŞMESİ · Devam'))
  assert.ok(texts(second).includes('Ek 1 / Ödeme planı'))
  assert.ok(texts(first).includes(`Belge no: ${contract.id}`))
  assert.ok(texts(second).includes(`Belge no: ${contract.id}`))
})

test('uzun taksit tablosu sayfalara bölünür ve her sayfada tablo başlığı tekrarlanır', () => {
  const seed = createSeed(NOW)
  const contract = seed.contracts[0]!
  const template = seed.invoices.find((item) => item.studentId === contract.studentId)!
  seed.invoices = Array.from({ length: 60 }, (_, index) => ({
    ...template,
    id: `inv-uzun-${index}`,
    installment: index + 1,
    contractId: contract.id,
  }))
  const document = contractDocument(measurer, documentData(seed, 'contract', contract.id), OPTIONS)
  assert.ok(document.pages.length > 2, 'taksit tablosu birden çok sayfaya yayılmalı')
  // Ek 1 ikinci sayfada başlar; tablo başlığı o sayfadan sonuna kadar her sayfada bulunur.
  for (const page of document.pages.slice(1))
    assert.ok(texts(page).includes('Vade tarihi'), 'tablo başlığı her tablo sayfasında yinelenir')
  // Her taksit tam bir kez yazılır.
  const rows = textOps(document).filter((op) => /^\d+\. taksit$/.test(op.text))
  assert.equal(rows.length, 60)
  // Sayfa numaraları ardışık ve toplam doğru.
  document.pages.forEach((page, index) =>
    assert.ok(texts(page).includes(`${index + 1} / ${document.pages.length}`)),
  )
})

test('içerik hiçbir sayfada alt sınırı ve sağ kenarı aşmaz', () => {
  const seed = createSeed(NOW)
  const contract = seed.contracts[0]!
  const template = seed.invoices.find((item) => item.studentId === contract.studentId)!
  seed.invoices = Array.from({ length: 45 }, (_, index) => ({
    ...template,
    id: `inv-sinir-${index}`,
    installment: index + 1,
    contractId: contract.id,
  }))
  const document = contractDocument(measurer, documentData(seed, 'contract', contract.id), OPTIONS)
  for (const page of document.pages)
    for (const op of bodyOps(page)) {
      if (op.kind === 'text')
        assert.ok(op.y <= PAGE.bottom + 5, `metin alt sınırı aştı: ${op.text} (${op.y})`)
      assert.ok(op.x >= 0 && op.x <= PAGE.width)
    }
})

test('ensure: sığmayan blok yeni sayfaya geçer ve devam başlığı yazılır', () => {
  const layout = new DocumentLayout(measurer, {
    label: 'DENEME',
    badge: 'D',
    institution: 'Kurum',
    generatedAt: NOW,
    reference: 'ref-1',
    footerNote: 'not',
  })
  assert.equal(layout.ensure(10), false)
  layout.y = PAGE.bottom - 5
  assert.equal(layout.ensure(10), true)
  assert.equal(layout.pages.length, 2)
  assert.equal(layout.y, 51)
  assert.ok(texts(layout.pages[1]!).includes('DENEME · Devam'))
})

test('paragraf sayfa sonunda son iki satırı tek başına bırakmaz', () => {
  const layout = new DocumentLayout(measurer, {
    label: 'DENEME',
    badge: 'D',
    institution: 'Kurum',
    generatedAt: NOW,
    reference: 'ref-1',
    footerNote: 'not',
  })
  // Üç satırlık paragraf ancak iki satır sığacak yerde başlar: tamamı yeni sayfaya geçer.
  layout.y = PAGE.bottom - 12
  const words = Array.from({ length: 200 }, () => 'kelime').join(' ')
  layout.paragraph(words.slice(0, 250))
  const firstPage = texts(layout.pages[0]!).filter((text) => text.startsWith('kelime'))
  assert.equal(firstPage.length, 0)
  assert.ok(layout.pages.length >= 2)
})

test('dosya adı kayıt kimliğinden güvenli üretilir', () => {
  assert.equal(documentFilename('receipt', 'inv-12'), 'dekont-inv-12.pdf')
  assert.equal(documentFilename('contract', 'c/../x y'), 'sozlesme-c-..-x-y.pdf')
})
