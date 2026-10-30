import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  financeLookups,
  INVOICE_STATUSES,
  invoiceCsvRow,
  invoiceListPlan,
  invoiceRow,
  isInvoiceStatusSlug,
  matchingStudentIds,
  searchKey,
  selectInvoicePage,
} from '../src/pages/finance/finance-rows.ts'
import { initialListState, type ListState } from '../src/lib/list-state.ts'

const NOW = new Date('2026-10-15T09:00:00.000Z')
const TODAY = dayKey(NOW)

const wrap = <T extends { id: string }>(records: readonly T[]) =>
  records.map((record) => ({
    id: record.id,
    version: 3,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    archivedAt: null,
    record,
  }))

function setup() {
  const seed = createSeed(NOW)
  const lookups = financeLookups(wrap(seed.students), wrap(seed.classes))
  const invoices = wrap(seed.invoices)
  return { seed, lookups, invoices }
}

const state = (patch: Partial<ListState> = {}): ListState => ({ ...initialListState(), ...patch })

test('taksit satırı öğrenci adı, sınıf, numara ve core durumunu eşlemeden alır', () => {
  const { lookups, invoices } = setup()
  const rows = invoices
    .filter((item) => item.record.studentId === 's1')
    .map((item) => invoiceRow(item, lookups, TODAY))

  assert.equal(rows.length, 8)
  const first = rows[0]!
  assert.equal(first.studentName, 'Deniz Yılmaz')
  assert.equal(first.className, '7-A')
  assert.equal(first.studentNumber, '2026001')
  assert.equal(first.version, 3)
  // Seed: ilk üç taksit ödenmiş, dördüncünün vadesi bu ayın 10'u (geçmiş), sonrakiler ileride.
  assert.deepEqual(
    rows.map((row) => row.status),
    ['Ödendi', 'Ödendi', 'Ödendi', 'Gecikmiş', 'Yaklaşan', 'Yaklaşan', 'Yaklaşan', 'Yaklaşan'],
  )
  assert.equal(first.paidAt !== null && first.method !== null, true)
  assert.equal(rows[3]!.paidAt, null)
})

test('öğrencisi bulunamayan taksit kırılmaz, yer tutucu gösterir', () => {
  const { lookups, invoices } = setup()
  const item = { ...invoices[0]!, record: { ...invoices[0]!.record, studentId: 'yok' } }
  const row = invoiceRow(item, lookups, TODAY)
  assert.equal(row.studentName, 'Öğrenci bulunamadı')
  assert.equal(row.className, '—')
  assert.equal(row.studentNumber, '—')
})

test('durum kısa adları core etiketlerine eşlenir; bilinmeyen ad reddedilir', () => {
  assert.deepEqual(Object.values(INVOICE_STATUSES), ['Ödendi', 'Gecikmiş', 'Yaklaşan'])
  assert.equal(isInvoiceStatusSlug('gecikmis'), true)
  assert.equal(isInvoiceStatusSlug('Gecikmiş'), false)
  assert.equal(isInvoiceStatusSlug('toString'), false)
  assert.equal(isInvoiceStatusSlug(undefined), false)
})

test('arama Türkçe ve aksan duyarsız; ad, okul numarası ve sınıfla eşleşir', () => {
  const { lookups } = setup()
  assert.equal(searchKey('İPEK Işık'), 'ipek isik')
  assert.deepEqual(matchingStudentIds(lookups, 'deniz yilmaz'), ['s1'])
  assert.deepEqual(matchingStudentIds(lookups, ' 2026001 '), ['s1'])
  const classIds = matchingStudentIds(lookups, '7-A')
  assert.ok(classIds.length > 1)
  assert.ok(classIds.every((id) => lookups.students.get(id)?.classId === 'c1'))
  assert.deepEqual(matchingStudentIds(lookups, 'zzzz-yok'), [])
})

test('plan: varsayılan sunucu sayfası, vadeye göre ve kimlikle kararlı sıra', () => {
  assert.deepEqual(invoiceListPlan(state({ page: 3 }), null), {
    kind: 'server',
    query: { sort: ['dueDate', 'id'], page: 3, pageSize: 8 },
  })
})

test('plan: kullanıcı sıralaması önce gelir; sıralanamayan sütun gönderilmez', () => {
  const sorted = invoiceListPlan(state({ sortKey: 'amount', sortDirection: -1 }), null)
  assert.equal(sorted.kind, 'server')
  if (sorted.kind === 'server') assert.deepEqual(sorted.query.sort, ['-amount', 'dueDate', 'id'])
  const unsortable = invoiceListPlan(state({ sortKey: 'studentName' }), null)
  if (unsortable.kind === 'server') assert.deepEqual(unsortable.query.sort, ['dueDate', 'id'])
})

test('plan: arama öğrenci kimliği filtresine çevrilir, `q` gönderilmez; eşleşme yoksa istek yok', () => {
  const plan = invoiceListPlan(state({ query: 'Deniz' }), ['s1', 's7'])
  assert.equal(plan.kind, 'server')
  if (plan.kind === 'server') {
    assert.deepEqual(plan.query.filters, { studentId: ['s1', 's7'] })
    assert.equal(plan.query.q, undefined)
  }
  assert.deepEqual(invoiceListPlan(state({ query: 'zzz' }), []), { kind: 'empty' })
})

test('plan: durum seçilince filtrenin bütün taksitleri sayfasız çekilir', () => {
  const plan = invoiceListPlan(state({ filters: { status: 'odendi' }, page: 2 }), ['s1'])
  assert.deepEqual(plan, {
    kind: 'all',
    query: { sort: ['dueDate', 'id'], filters: { studentId: ['s1'] } },
    status: 'Ödendi',
  })
  // Bozuk URL değeri filtre sayılmaz.
  assert.equal(invoiceListPlan(state({ filters: { status: 'hepsi' } }), null).kind, 'server')
})

test('durum sayfası süzer, sırayı korur ve sayfalar; toplam süzülmüş sayıdır', () => {
  const { lookups, invoices } = setup()
  const rows = invoices
    .filter((item) => ['s1', 's2'].includes(item.record.studentId))
    .map((item) => invoiceRow(item, lookups, TODAY))

  const first = selectInvoicePage(rows, { page: 1, pageSize: 4 }, 'Yaklaşan')
  assert.equal(first.total, 8)
  assert.equal(first.rows.length, 4)
  assert.ok(first.all.every((row) => row.status === 'Yaklaşan'))
  assert.deepEqual(
    first.rows.map((row) => row.id),
    first.all.slice(0, 4).map((row) => row.id),
  )
  const second = selectInvoicePage(rows, { page: 2, pageSize: 4 }, 'Yaklaşan')
  assert.deepEqual(
    second.rows.map((row) => row.id),
    first.all.slice(4).map((row) => row.id),
  )
})

test('CSV satırı tutarı TL, vadeyi okunur tarih olarak yazar', () => {
  const { lookups, invoices } = setup()
  const row = invoiceRow(invoices[0]!, lookups, TODAY)
  assert.deepEqual(invoiceCsvRow(row), {
    studentName: 'Deniz Yılmaz',
    installment: 1,
    dueDate: '10 Tem 2026',
    amount: '24.500,00 ₺',
    status: 'Ödendi',
  })
})
