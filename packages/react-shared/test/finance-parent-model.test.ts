import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { CollectionRow } from '../src/collections.ts'
import { invoiceRow } from '../src/finance-model.ts'
import {
  balanceSummaryRows,
  familyInvoiceFacts,
  familyInvoiceItem,
  familyPaymentFacts,
  familyPaymentItem,
  filterFamilyPayments,
  invoiceOpenCents,
  nextDueText,
  receiptNumber,
  statementItems,
  statementNotes,
  statementTotalRows,
  type FamilyPayment,
  type StatementLineView,
} from '../src/finance-parent-model.ts'

const seed = createSeed(new Date('2026-09-01T09:00:00Z'))
const open = seed.invoices.find((item) => !item.paidAt)!
const TODAY = '2026-09-10'
const rowOf = (record: typeof open): CollectionRow<typeof open> => ({
  id: record.id,
  version: 1,
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
  archivedAt: null,
  record,
})

const balance = {
  studentId: 's1',
  totalCents: 300_000,
  paidCents: 120_000,
  openingImportCents: 0,
  openCents: 180_000,
  overdueCents: 50_000,
  overdueCount: 1,
  nextDue: { date: '2026-10-01', amountCents: 100_000 },
}

const payment: FamilyPayment = {
  id: 'pay-1',
  studentId: 's1',
  studentName: null,
  amountCents: 120_000,
  creditCents: 20_000,
  method: 'Banka havalesi',
  reference: 'DEK-1',
  paidAt: '2026-09-05T09:00:00.000Z',
  receiptYear: 2026,
  receiptNumber: 7,
  reversedAt: null,
  reversalReason: null,
  bankAccountLabel: null,
  mebbisRecordedAt: null,
  version: 1,
  allocations: [{ invoiceId: open.id, amountCents: 100_000 }],
}

const line = (over: Partial<StatementLineView>): StatementLineView => ({
  kind: 'installment',
  date: '2026-09-01',
  debitCents: 0,
  creditCents: 0,
  balanceCents: 0,
  invoiceId: null,
  installment: null,
  openCents: null,
  isOverdue: false,
  paymentId: null,
  method: null,
  reference: null,
  receiptYear: null,
  receiptNumber: null,
  unappliedCents: 0,
  ...over,
})

test('ON-078 IST-107 bakiye özeti sunucu kuruşunu yazar, gecikmiş taksit sayısını ekler', () => {
  assert.deepEqual(balanceSummaryRows(balance), [
    ['Toplam eğitim bedeli', '3.000,00 ₺'],
    ['Ödenen', '1.200,00 ₺'],
    ['Kalan bakiye', '1.800,00 ₺'],
    ['Gecikmiş tutar', '500,00 ₺ · 1 taksit'],
  ])
  assert.equal(nextDueText(balance), '1 Eki 2026 · 1.000,00 ₺')
  assert.equal(nextDueText({ nextDue: null }), null)
})

test('DOM-FIN-014 açılış aktarımı ödenenden ayrılır, gecikme yoksa sayı yazılmaz', () => {
  const rows = balanceSummaryRows({
    ...balance,
    openingImportCents: 20_000,
    overdueCents: 0,
    overdueCount: 0,
  })
  assert.deepEqual(rows[1], ['Ödenen', '1.000,00 ₺'])
  assert.deepEqual(rows[2], ['Açılış aktarımı', '200,00 ₺'])
  assert.deepEqual(rows.at(-1), ['Gecikmiş tutar', '0,00 ₺'])
})

test('DOM-FIN-030 kısmi ödenmiş taksitte kalan kısım gösterilir, öğrenci adı yazılmaz', () => {
  const row = invoiceRow(rowOf({ ...open, amount: 100_000, paidCents: 40_000 }), TODAY)
  assert.equal(invoiceOpenCents(row), 60_000)
  const item = familyInvoiceItem(row)
  assert.equal(item.title, `${String(open.installment)}. taksit`)
  assert.match(item.subtitle, /Kalan 600,00 ₺$/)
  assert.equal(item.amount, '1.000,00 ₺')
  assert.ok(!item.label.includes('—'))
  const facts = new Map(familyInvoiceFacts(row))
  assert.equal(facts.get('Ödenen'), '400,00 ₺')
  assert.equal(facts.get('Kalan tutar'), '600,00 ₺')
  assert.equal(facts.get('Tahsilat tarihi'), '—')
  assert.equal(facts.get('Ödeme yöntemi'), '—')
})

test('DOM-FIN-030 ödenmiş taksitte kalan sıfır, açılış aktarımı ödeme tarihiyle yazılır', () => {
  const paid = invoiceRow(
    rowOf({ ...open, amount: 100_000, paidAt: '2026-09-03T08:00:00.000Z', method: 'Kredi kartı' }),
    TODAY,
  )
  assert.equal(invoiceOpenCents(paid), 0)
  assert.equal(familyInvoiceItem(paid).subtitle.includes('Kalan'), false)
  const facts = new Map(familyInvoiceFacts(paid))
  assert.equal(facts.get('Ödenen'), '1.000,00 ₺')
  assert.equal(facts.get('Tahsilat tarihi'), '3 Eyl 2026')
  assert.equal(facts.get('Ödeme yöntemi'), 'Kredi kartı')
  const imported = new Map(
    familyInvoiceFacts(
      invoiceRow(
        rowOf({ ...open, paidAt: '2026-08-01T08:00:00.000Z', method: 'Açılış aktarımı' }),
        TODAY,
      ),
    ),
  )
  assert.equal(imported.get('Ödeme tarihi'), '1 Ağu 2026')
  assert.equal(imported.get('Ödeme yöntemi'), 'Açılış aktarımı')
})

test('DOM-FIN-050 tahsilat satırı dekont numarasını, iade alacağını ve durumu verir', () => {
  assert.equal(receiptNumber(payment), '2026-7')
  const item = familyPaymentItem(payment)
  assert.equal(item.title, 'Dekont 2026-7')
  assert.equal(item.subtitle, '5 Eyl 2026 · Banka havalesi')
  assert.equal(item.status, 'Geçerli')
  const facts = new Map(familyPaymentFacts(payment))
  assert.equal(facts.get('İade alacağı'), '200,00 ₺')
  assert.equal(facts.get('İşlem referansı'), 'DEK-1')
  assert.equal(facts.has('İptal tarihi'), false)
})

test('DOM-FIN-033 DOM-FIN-052 iptal edilen tahsilat kalır, gerekçe ve MEBBİS satırı yoktur', () => {
  const reversed = { ...payment, creditCents: 0, reversedAt: '2026-09-06T10:00:00.000Z' }
  const facts = familyPaymentFacts(reversed)
  const labels = facts.map(([label]) => label)
  assert.ok(labels.includes('İptal tarihi'))
  assert.ok(!labels.some((label) => /gerekçe|MEBBİS|İade/i.test(label)))
  assert.equal(familyPaymentItem(reversed).status, 'İptal edildi')
  const all = [payment, reversed]
  assert.deepEqual(filterFamilyPayments(all, 'valid'), [payment])
  assert.deepEqual(filterFamilyPayments(all, 'reversed'), [reversed])
  assert.deepEqual(filterFamilyPayments(all, ''), all)
})

test('DOM-FIN-054 ekstre satırları yürüyen bakiyeyi ve web ile aynı açıklamayı yazar', () => {
  const items = statementItems([
    line({ kind: 'installment', installment: 1, debitCents: 100_000, balanceCents: 100_000 }),
    line({
      kind: 'payment',
      date: '2026-09-05T09:00:00.000Z',
      creditCents: 40_000,
      balanceCents: 60_000,
      method: 'Nakit',
      receiptYear: 2026,
      receiptNumber: 7,
    }),
  ])
  assert.deepEqual(
    items.map((item) => [item.label, item.movement, item.balance]),
    [
      ['1. taksit', 'Borç 1.000,00 ₺', '1.000,00 ₺'],
      ['Tahsilat · Nakit · Dekont 2026-7', 'Alacak 400,00 ₺', '600,00 ₺'],
    ],
  )
  assert.deepEqual(
    statementTotalRows({
      debitTotalCents: 100_000,
      creditTotalCents: 40_000,
      openCents: 60_000,
      refundDueCents: 0,
    }),
    [
      ['Borç toplamı', '1.000,00 ₺'],
      ['Alacak toplamı', '400,00 ₺'],
      ['Kalan bakiye', '600,00 ₺'],
    ],
  )
})

test('IST-107, DOM-FIN-040: ödenmemiş ayrılış iadesi toplamda ve notta yazılır', () => {
  const statement = { unappliedCents: 0, openingImportCents: 0, refundDueCents: 150_000 }
  assert.deepEqual(
    statementTotalRows({
      debitTotalCents: 100_000,
      creditTotalCents: 250_000,
      openCents: 0,
      refundDueCents: 150_000,
    }).at(-1),
    ['Ödenecek iade', '1.500,00 ₺'],
  )
  assert.deepEqual(statementNotes(statement), [
    'Ayrılış iadesi olarak 1.500,00 ₺ ödenecektir; bakiyede alacak olarak görünür.',
  ])
})

test('DOM-FIN-014 ekstre notları iade alacağını ve açılış aktarımını ayrıca anlatır', () => {
  assert.deepEqual(
    statementNotes({ unappliedCents: 0, openingImportCents: 0, refundDueCents: 0 }),
    [],
  )
  const notes = statementNotes({
    unappliedCents: 20_000,
    openingImportCents: 30_000,
    refundDueCents: 0,
  })
  assert.equal(notes.length, 2)
  assert.match(notes[0]!, /200,00 ₺ iade alacağıdır/)
  assert.match(notes[1]!, /300,00 ₺ kısmı açılış aktarımıdır/)
})
