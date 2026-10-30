import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  INVOICE_STATUS_OPTIONS,
  invoiceCsvRow,
  invoiceExportQuery,
  invoiceListQuery,
  invoiceRow,
  invoiceTotals,
  isInvoiceStatusKey,
} from '../src/pages/finance/finance-rows.ts'
import { initialListState, type ListState } from '../src/lib/list-state.ts'

const NOW = new Date('2026-10-15T09:00:00.000Z')
const TODAY = dayKey(NOW)

/** Sunucunun `joined` alanı: seed öğrencisi ve sınıfından kurulur. */
function setup() {
  const seed = createSeed(NOW)
  const invoices = seed.invoices.map((record) => {
    const student = seed.students.find((item) => item.id === record.studentId)
    const schoolClass = seed.classes.find((item) => item.id === student?.classId)
    return {
      id: record.id,
      version: 3,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      archivedAt: null,
      record,
      joined: {
        ...(student ? { studentName: student.name } : {}),
        ...(schoolClass ? { className: schoolClass.name } : {}),
      },
    }
  })
  return { seed, invoices }
}

const state = (patch: Partial<ListState> = {}): ListState => ({ ...initialListState(), ...patch })

test('taksit satırı öğrenci adı ve sınıfı `joined` alanından, core durumunu kayıttan alır', () => {
  const { invoices } = setup()
  const rows = invoices
    .filter((item) => item.record.studentId === 's1')
    .map((item) => invoiceRow(item, TODAY))

  assert.equal(rows.length, 8)
  const first = rows[0]!
  assert.equal(first.studentName, 'Deniz Yılmaz')
  assert.equal(first.className, '7-A')
  assert.equal(first.version, 3)
  // Seed: ilk üç taksit ödenmiş, dördüncünün vadesi bu ayın 10'u (geçmiş), sonrakiler ileride.
  assert.deepEqual(
    rows.map((row) => row.status),
    ['Ödendi', 'Ödendi', 'Ödendi', 'Gecikmiş', 'Yaklaşan', 'Yaklaşan', 'Yaklaşan', 'Yaklaşan'],
  )
  assert.equal(first.paidAt !== null && first.method !== null, true)
  assert.equal(rows[3]!.paidAt, null)
})

test('bağlı ad gelmeyen (kapsam dışı) taksit kırılmaz, "—" gösterir', () => {
  const { invoices } = setup()
  const { id, version, createdAt, updatedAt, archivedAt, record } = invoices[0]!
  const item = { id, version, createdAt, updatedAt, archivedAt, record }
  const row = invoiceRow(item, TODAY)
  assert.equal(row.studentName, '—')
  assert.equal(row.className, '—')
})

test('durum seçenekleri core etiketleridir; bilinmeyen anahtar reddedilir', () => {
  assert.deepEqual(
    INVOICE_STATUS_OPTIONS.map((option) => option.label),
    ['Ödendi', 'Gecikmiş', 'Yaklaşan'],
  )
  assert.equal(isInvoiceStatusKey('gecikmis'), true)
  assert.equal(isInvoiceStatusKey('Gecikmiş'), false)
  assert.equal(isInvoiceStatusKey('toString'), false)
  assert.equal(isInvoiceStatusKey(undefined), false)
})

test('sorgu: varsayılan sunucu sayfası, vadeye göre ve kimlikle kararlı sıra', () => {
  assert.deepEqual(invoiceListQuery(state({ page: 3 }), ''), {
    sort: ['dueDate', 'id'],
    page: 3,
    pageSize: 8,
  })
})

test('sorgu: kullanıcı sıralaması önce gelir; öğrenci adı sunucuda sıralanır', () => {
  assert.deepEqual(invoiceListQuery(state({ sortKey: 'amount', sortDirection: -1 }), '').sort, [
    '-amount',
    'dueDate',
    'id',
  ])
  assert.deepEqual(invoiceListQuery(state({ sortKey: 'studentName' }), '').sort, [
    'studentName',
    'dueDate',
    'id',
  ])
  // Durum türetilmiş sütundur; sıralama alanı olarak gönderilmez.
  assert.deepEqual(invoiceListQuery(state({ sortKey: 'status' }), '').sort, ['dueDate', 'id'])
})

test('sorgu: arama doğrudan q olur; öğrenci kimliği süzgeci kurulmaz', () => {
  const query = invoiceListQuery(state({ query: 'Deniz' }), 'Deniz')
  assert.equal(query.q, 'Deniz')
  assert.equal(query.filters, undefined)
  // Gecikmeli arama metni durumdaki yazıdan önceliklidir; kısa arama gönderilmez.
  assert.equal(invoiceListQuery(state({ query: 'Deniz' }), '').q, undefined)
  assert.equal(invoiceListQuery(state(), 'D').q, undefined)
})

test('sorgu: durum anahtarı core etiketiyle status süzgecine gider; bozuk değer yok sayılır', () => {
  const query = invoiceListQuery(state({ filters: { status: 'gecikmis' }, page: 2 }), '')
  assert.deepEqual(query.filters, { status: 'Gecikmiş' })
  assert.equal(query.page, 2)
  assert.equal(invoiceListQuery(state({ filters: { status: 'hepsi' } }), '').filters, undefined)
})

test('CSV sorgusu sayfasızdır; arama, durum ve sıralamayı taşır', () => {
  assert.deepEqual(
    invoiceExportQuery(
      state({ query: 'Deniz', filters: { status: 'odendi' }, sortKey: 'studentName' }),
      'Deniz',
    ),
    {
      q: 'Deniz',
      sort: ['studentName', 'dueDate', 'id'],
      filters: { status: 'Ödendi' },
    },
  )
})

test('toplam kartları sayım yanıtından kuruş olarak hesaplanır', () => {
  const totals = invoiceTotals({
    total: 10,
    sum: 100_000,
    groups: [
      { value: 'Gecikmiş', count: 2, sum: 20_000 },
      { value: 'Yaklaşan', count: 5, sum: 50_000 },
      { value: 'Ödendi', count: 3, sum: 30_000 },
    ],
  })
  assert.deepEqual(totals, { total: 100_000, paid: 30_000, remaining: 70_000, overdue: 20_000 })
  // Kayıt yoksa sıfır; grup eksikse o kart sıfırdır.
  assert.deepEqual(invoiceTotals({ total: 0, groups: [] }), {
    total: 0,
    paid: 0,
    remaining: 0,
    overdue: 0,
  })
})

test('CSV satırı tutarı TL, vadeyi okunur tarih olarak yazar', () => {
  const { invoices } = setup()
  const row = invoiceRow(invoices[0]!, TODAY)
  assert.deepEqual(invoiceCsvRow(row), {
    studentName: 'Deniz Yılmaz',
    installment: 1,
    dueDate: '10 Tem 2026',
    amount: '24.500,00 ₺',
    status: 'Ödendi',
  })
})
