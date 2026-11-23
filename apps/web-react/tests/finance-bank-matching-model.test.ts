import assert from 'node:assert/strict'
import test from 'node:test'

import {
  amountNote,
  confidenceLabel,
  importSummary,
  reasonText,
  statementFileProblem,
  STATEMENT_FILE_MESSAGE,
  statusLabel,
} from '../src/pages/finance/bank-matching-model.ts'

// Banka eşleştirme ekranının metinleri (IST-115, ON-099; DOM-FIN-069).

const plain = (text: string) => text.replaceAll(' ', ' ')
const suggestion = (amountFit: 'exact' | 'multiple' | 'partial' | 'over', creditCents = 0) => ({
  studentId: 's1',
  studentName: 'Deniz Yılmaz',
  invoiceId: 'i1',
  installment: 1,
  dueDate: '2026-10-15',
  openCents: 1_000_000,
  studentOpenCents: 3_000_000,
  creditCents,
  amountFit,
  score: 90,
  confidence: 'high' as const,
  reasons: ['national_id' as const, 'amount_exact' as const],
})

test('DOM-FIN-069: durum, güven ve gerekçe etiketleri değer taşımaz', () => {
  assert.equal(statusLabel('unmatched'), 'Eşleşmedi')
  assert.equal(confidenceLabel('medium'), 'Orta güven')
  assert.equal(reasonText(['national_id', 'amount_exact']), 'T.C. kimlik no, Tutar taksite eşit')
})

test('DOM-FIN-030: tutar notu kısmi ve fazla ödemede kalanı ve iade alacağını söyler', () => {
  assert.match(amountNote(suggestion('exact'), 1_000_000), /taksit kapanır/)
  assert.match(amountNote(suggestion('multiple'), 2_000_000), /birden çok taksit/)
  assert.equal(
    plain(amountNote(suggestion('partial'), 400_000)),
    'Kısmi ödeme: taksitte 6.000,00 ₺ kalır.',
  )
  assert.match(plain(amountNote(suggestion('over', 50_000), 3_050_000)), /500,00 ₺ iade alacağı/)
  assert.match(amountNote(suggestion('over'), 1_500_000), /sonraki taksitlere/)
})

test('DOM-FIN-069: önizleme özeti yalnız dolu sayıları yazar', () => {
  const base = {
    dryRun: true,
    format: 'csv' as const,
    headers: [],
    columns: {},
    rowCount: 5,
    readyCount: 2,
    skippedCount: 1,
    outgoingCount: 1,
    ignoredCount: 0,
    invalidCount: 0,
    totalCents: 250_000,
    rows: [],
  }
  assert.equal(
    plain(importSummary(base)),
    '2 gelen hareket aktarılacak (2.500,00 ₺) · 1 daha önce aktarılmış · 1 giden hareket alınmaz.',
  )
})

test('DOM-FIN-069: ekstre dosyası türü ve boyutu denetlenir', () => {
  assert.equal(statementFileProblem({ name: 'ekstre.csv', size: 10 }), null)
  assert.equal(statementFileProblem({ name: 'EKSTRE.STA', size: 10 }), null)
  assert.equal(statementFileProblem({ name: 'ekstre.pdf', size: 10 }), STATEMENT_FILE_MESSAGE)
  assert.equal(statementFileProblem({ name: 'ekstre.csv', size: 0 }), STATEMENT_FILE_MESSAGE)
  assert.equal(
    statementFileProblem({ name: 'ekstre.xlsx', size: 6 * 1024 * 1024 }),
    STATEMENT_FILE_MESSAGE,
  )
})
