import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { documentData, type DocumentType } from '../packages/school-core/src/lib/document-data.ts'
import { renderDocument } from '../apps/web/src/lib/pdf-layout.js'
import { filterRows, pageNumbers } from '../apps/web/src/lib/list-query.js'
import { isDomainError } from './support/domain-error.ts'
const { jsPDF } = createRequire(new URL('../apps/web/package.json', import.meta.url))('jspdf')
const font = readFileSync(
  new URL('../apps/web/public/fonts/NotoSans-Regular.ttf', import.meta.url),
).toString('base64')

type Doc = ReturnType<typeof documentData>

function asPlan(data: Doc) {
  if (!('invoices' in data)) throw new Error('Ödeme planı verisi bekleniyordu.')
  return data
}
function asReceipt(data: Doc) {
  if (!('invoice' in data)) throw new Error('Dekont verisi bekleniyordu.')
  return data
}
function asHomework(data: Doc) {
  if (!('homework' in data)) throw new Error('Ödev verisi bekleniyordu.')
  return data
}

function generate(type: DocumentType, data: Doc) {
  const pdf = new jsPDF({ compress: true })
  pdf.addFileToVFS('NotoSans.ttf', font)
  pdf.addFont('NotoSans.ttf', 'NotoSans', 'normal')
  pdf.setFont('NotoSans')
  const text: { value: unknown; page: number }[] = [],
    original = pdf.text.bind(pdf)
  pdf.text = (value: unknown, x: number, y: number, options?: { align?: string }) => {
    const width = pdf.getTextWidth(String(value))
    const left = options?.align === 'right' ? x - width : x
    assert.ok(left >= 17 && left + width <= 193, `Yatay taşma: ${value}`)
    assert.ok(y >= 3 && y <= 287, `Dikey taşma: ${value}`)
    text.push({ value, page: pdf.getCurrentPageInfo().pageNumber })
    return original(value, x, y, options)
  }
  renderDocument(pdf, type, data)
  assert.ok(pdf.output().startsWith('%PDF'))
  return { pdf, text }
}

test('Finans belgeleri aynı öğrenci, veli ve kuruş cinsinden toplamları kullanır; ödenmeyen taksitin dekontu oluşmaz', () => {
  const state = createSeed()
  const plan = asPlan(documentData(state, 'payment-plan', 's1'))
  const contract = asPlan(documentData(state, 'contract', 'contract-s1'))
  assert.equal(plan.parent!.name, 'Ayşe Yılmaz')
  assert.equal(plan.total, contract.contract!.amount)
  assert.equal(
    plan.total,
    plan.invoices.reduce((total, i) => total + i.amount, 0),
  )
  assert.equal(
    plan.paid,
    plan.invoices.filter((i) => i.paidAt).reduce((total, i) => total + i.amount, 0),
  )
  const paid = plan.invoices.find((i) => i.paidAt),
    unpaid = plan.invoices.find((i) => !i.paidAt)
  const receipt = asReceipt(documentData(state, 'receipt', paid!.id))
  assert.equal(receipt.invoice.amount, paid!.amount)
  assert.equal(receipt.student.id, 's1')
  assert.throws(() => documentData(state, 'receipt', unpaid!.id), /tamamlanan/)
  assert.throws(() => documentData(state, 'contract', 'missing'), /bulunamadı/)
  assert.throws(() => documentData(state, 'submission', 'missing'), /bulunamadı/)
})

test('Altı belge türü gerçek PDF üretir; kısa belgeler tek sayfa, sözleşme ayrı ödeme planı ekidir', () => {
  const state = createSeed()
  const samples: [DocumentType, string, string, number][] = [
    [
      'receipt',
      state.invoices.find((i) => i.studentId === 's1' && i.paidAt)!.id,
      'TAHSİL EDİLEN TUTAR',
      1,
    ],
    ['contract', 'contract-s1', 'Ek 1 / Ödeme planı', 2],
    ['payment-plan', 's1', 'KALAN BAKİYE', 1],
    ['material', 'mat-7-math', '03 / Çözüm ve çalışma alanı', 1],
    ['homework', 'hw1', '02 / Çalışmam', 1],
    ['submission', state.submissions[0]!.id, 'Öğretmen geri bildirimi', 1],
    [
      'submission',
      state.submissions.find((s) => s.score != null && s.studentId === 's1')!.id,
      'Öğretmen geri bildirimi',
      1,
    ],
  ]
  for (const [type, id, heading, pages] of samples) {
    const { pdf, text } = generate(type!, documentData(state, type!, id, 's1'))
    assert.equal(pdf.getNumberOfPages(), pages, `${type} sayfa sayısı`)
    assert.ok(
      text.some((t) => t.value === heading),
      `${type} kendi bölümlerini içermeli`,
    )
    for (let page = 1; page <= pages!; page++) {
      assert.ok(text.some((t) => t.page === page && t.value === `${page} / ${pages}`))
      assert.ok(text.some((t) => t.page === page && String(t.value).startsWith('Belge no:')))
    }
  }
})

test('Uzun ödev ve çok taksitli plan taşmadan sayfalanır; tablo başlıkları devam sayfalarında tekrarlanır', () => {
  const state = createSeed()
  const homework = asHomework(documentData(state, 'homework', 'hw1', 's1'))
  homework.homework = {
    ...homework.homework,
    title:
      'Çok adımlı problem çözme ve farklı çözüm yöntemlerinin karşılaştırılması üzerine dönem çalışması',
    description: 'İşlem adımlarını açıkla ve sonucu kontrol et. '.repeat(80),
  }
  assert.ok(generate('homework', homework).pdf.getNumberOfPages() > 1)
  const plan = asPlan(documentData(state, 'payment-plan', 's1'))
  plan.invoices = Array.from({ length: 40 }, (_, i) => ({
    ...plan.invoices[i % 8]!,
    installment: i + 1,
  }))
  const { pdf, text } = generate('payment-plan', plan)
  assert.ok(pdf.getNumberOfPages() > 1)
  for (const page of new Set(
    text.filter((t) => /^\d+\. taksit$/.test(String(t.value))).map((t) => t.page),
  ))
    assert.ok(text.some((t) => t.page === page && t.value === 'Vade tarihi'))
})

test('Arama ve filtreler birlikte çalışır; sıfır puanı ve İstanbul tarih sınırını korur', () => {
  const rows = [
    { id: 1, name: 'İpek Yılmaz', subject: 'Türkçe', score: 0, date: '2026-09-25T21:30:00Z' },
    { id: 2, name: 'İpek Yılmaz', subject: 'Matematik', score: 50, date: '2026-09-25T20:30:00Z' },
    { id: 3, name: 'Deniz Yılmaz', subject: 'Türkçe', score: null, date: null },
  ]
  const fields = [
    { key: 'subject' },
    { key: 'score', type: 'number' },
    { key: 'date', type: 'date' },
  ]
  const keys = ['name', 'subject']
  assert.deepEqual(
    filterRows(rows, 'İPEK türkçe', fields, {}, keys).map((r: { id: number }) => r.id),
    [1],
  )
  assert.deepEqual(
    filterRows(rows, '', fields, { score: { min: 0, max: 0 } }, keys).map(
      (r: { id: number }) => r.id,
    ),
    [1],
  )
  assert.deepEqual(
    filterRows(rows, '', fields, { date: { min: '2026-09-26', max: '2026-09-26' } }, keys).map(
      (r: { id: number }) => r.id,
    ),
    [1],
  )
  assert.equal(filterRows(rows, '', fields, { score: { min: 90, max: 10 } }, keys).length, 0)
  assert.equal(
    filterRows(rows, '', fields, { subject: 'Türkçe', score: { min: '', max: '' } }, keys).length,
    2,
  )
  assert.equal(rows.length, 3)
})

test('Sayfa bağlantıları ilk, son ve geçerli sayfayı içerir; arada atlanan sayfaları belirtir', () => {
  assert.deepEqual(pageNumbers(1, 1), [1])
  assert.deepEqual(pageNumbers(1, 3), [1, 2, 3])
  assert.deepEqual(pageNumbers(24, 24), [1, 'gap-23', 23, 24])
  assert.deepEqual(pageNumbers(12, 24), [1, 'gap-11', 11, 12, 13, 'gap-24', 24])
})

test('Belge verisi bulunamayan kaydı DomainError ile reddeder', () => {
  const state = createSeed()
  assert.throws(
    () => documentData(state, 'contract', 'missing'),
    isDomainError('contract_not_found', 'not_found'),
  )
  assert.throws(
    // @ts-expect-error — bilinçli desteklenmeyen belge türü
    () => documentData(state, 'unknown-type', 'x', 's1'),
    isDomainError('unsupported_document_type'),
  )
})
