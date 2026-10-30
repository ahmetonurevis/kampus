import test from 'node:test'
import assert from 'node:assert/strict'
import {
  INVOICE_STATUS_KEYS,
  INVOICE_STATUS_LABELS,
  invoiceStatus,
  invoiceStatusKey,
} from '../packages/school-core/src/lib/format.ts'

// Taksit durumu `now` ile sabitlenir; gün Europe/Istanbul takvimine göre alınır.
const now = '2026-10-06T10:00:00.000Z'

test('Taksit durumu anahtarları ve Türkçe etiketleri dışa aktarılır', () => {
  assert.deepEqual(INVOICE_STATUS_KEYS, ['odendi', 'gecikmis', 'yaklasan'])
  assert.deepEqual(Object.values(INVOICE_STATUS_LABELS), ['Ödendi', 'Gecikmiş', 'Yaklaşan'])
})

test('Taksit durumu now parametresine göre ödendi, gecikmiş veya yaklaşan olur', () => {
  const paid = { paidAt: '2026-10-01T09:00:00.000Z', dueDate: '2026-09-01T06:00:00.000Z' }
  const overdue = { paidAt: null, dueDate: '2026-10-05T06:00:00.000Z' }
  const upcoming = { paidAt: null, dueDate: '2026-10-07T06:00:00.000Z' }
  assert.equal(invoiceStatus(paid, now), 'Ödendi')
  assert.equal(invoiceStatus(overdue, now), 'Gecikmiş')
  assert.equal(invoiceStatus(upcoming, now), 'Yaklaşan')
  assert.equal(invoiceStatusKey(paid, now), 'odendi')
  assert.equal(invoiceStatusKey(overdue, now), 'gecikmis')
  assert.equal(invoiceStatusKey(upcoming, now), 'yaklasan')
  // Aynı taksit, saat ilerleyince durum değiştirir.
  assert.equal(invoiceStatus(upcoming, '2026-10-08T10:00:00.000Z'), 'Gecikmiş')
})

test('Vade günü bitmeden taksit gecikmiş sayılmaz; gün Europe/Istanbul takvimidir', () => {
  const dueToday = { paidAt: null, dueDate: '2026-10-06T06:00:00.000Z' }
  assert.equal(invoiceStatus(dueToday, now), 'Yaklaşan')
  // 21:30 UTC İstanbul'da ertesi gündür (00:30): vade günü geçmiştir.
  assert.equal(invoiceStatus(dueToday, '2026-10-06T21:30:00.000Z'), 'Gecikmiş')
})

test('Eski çağıranların verdiği gün anahtarı (YYYY-MM-DD) çalışmaya devam eder', () => {
  const invoice = { paidAt: null, dueDate: '2026-10-05T06:00:00.000Z' }
  assert.equal(invoiceStatus(invoice, '2026-10-05'), 'Yaklaşan')
  assert.equal(invoiceStatus(invoice, '2026-10-06'), 'Gecikmiş')
  assert.equal(invoiceStatus(invoice, new Date(now)), 'Gecikmiş')
})
