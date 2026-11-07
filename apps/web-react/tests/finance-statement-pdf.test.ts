import assert from 'node:assert/strict'
import { test } from 'node:test'
import { studentStatement } from '@kampus/school-core/lib/finance-statement.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import {
  statementFilename,
  studentStatementDocument,
} from '../src/lib/pdf/templates/finance-statement.ts'
import { allTexts, measurer, texts } from './support/pdf-measurer.ts'

const OPTIONS = {
  institution: 'Akademi Özel Okulları',
  generatedAt: new Date('2026-11-20T09:00:00.000Z'),
  studentName: 'Deniz Yılmaz',
}
const invoices = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `inv-${String(index)}`,
    installment: index + 1,
    amount: 10_000,
    paidAt: null,
    dueDate: `2026-10-${String((index % 27) + 1).padStart(2, '0')}T09:00:00.000Z`,
  }))
const payment = {
  id: 'p1',
  amountCents: 12_500,
  method: 'Senet',
  reference: 'SNT-1',
  paidAt: '2026-10-02T09:00:00.000Z',
  receiptYear: 2026,
  receiptNumber: 7,
  reversedAt: null,
  allocations: [{ invoiceId: 'inv-0', amountCents: 10_000 }],
}

test('IST-107: ekstre özeti, hareketleri, toplamları ve iade alacağı yazılır', () => {
  const statement = studentStatement('s1', invoices(2), [payment], '2026-11-20')
  const all = allTexts(studentStatementDocument(measurer, statement, OPTIONS))
  for (const text of [
    'CARİ EKSTRE',
    'Deniz Yılmaz',
    'TOPLAM BORÇ',
    'Hesap hareketleri',
    '2. taksit · Gecikmiş',
    money(statement.debitTotalCents),
    money(statement.openCents),
  ])
    assert.ok(all.includes(text), text)
  assert.ok(all.some((text) => text.includes('Dekont 2026-7') || text.includes('2026-7')))
  assert.ok(all.some((text) => text.includes('iade alacağıdır') || text.includes('dağıtılmayan')))
})

test('IST-107: uzun ekstre sayfalanır; her sayfada tablo başlığı ve numara vardır', () => {
  const statement = studentStatement('s1', invoices(70), [], '2026-11-20')
  const document = studentStatementDocument(measurer, statement, OPTIONS)
  assert.ok(document.pages.length > 2)
  document.pages.forEach((page, index) => {
    assert.ok(texts(page).includes('Bakiye'))
    assert.ok(texts(page).includes(`${String(index + 1)} / ${String(document.pages.length)}`))
  })
})

test('ekstre dosya adı güvenli karakterlere indirilir', () => {
  assert.equal(statementFilename('s/1 x'), 'cari-ekstre-s-1-x.pdf')
})
