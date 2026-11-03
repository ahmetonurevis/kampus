import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  familyInvoiceCsvRow,
  familyInvoiceExportQuery,
  familyInvoiceListQuery,
  familyTotalsQuery,
  INVOICE_PRESETS,
  INVOICE_STATUS_OPTIONS,
  invoiceClassScope,
  invoiceCsvRow,
  invoiceExportQuery,
  invoiceFilterFields,
  invoiceListQuery,
  MAX_FILTER_VALUES,
  NO_CLASS,
  paidAtRange,
  invoiceRow,
  invoiceTotals,
  isInvoiceStatusKey,
  remainingAmount,
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
        ...(student ? { studentName: student.name, studentNumber: student.number } : {}),
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
  assert.equal(first.studentNumber, '2026001')
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
  assert.equal(row.studentNumber, '—')
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
  assert.deepEqual(invoiceListQuery(state({ sortKey: 'studentNumber' }), '').sort, [
    'studentNumber',
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
    studentNumber: '2026001',
    installment: 1,
    dueDate: '10 Tem 2026',
    amount: '24.500,00 ₺',
    status: 'Ödendi',
  })
})

test('DOM-FIN-052 veli sorgusu seçili çocuğa daralır; dekontlar yalnız ödenmişleri ister', () => {
  const plan = familyInvoiceListQuery(state(), '', { studentId: 's2', paidOnly: false })
  assert.equal(plan.filters?.studentId, 's2')
  assert.equal(plan.filters?.status, undefined)

  const receipts = familyInvoiceListQuery(state(), '', { studentId: 's2', paidOnly: true })
  assert.deepEqual(receipts.filters, { studentId: 's2', status: 'Ödendi' })
  // CSV aynı kapsamı ve sıralamayı kullanır, sayfa içermez.
  const exported = familyInvoiceExportQuery(state(), '', { studentId: 's2', paidOnly: true })
  assert.deepEqual(exported.filters, receipts.filters)
  assert.equal('page' in exported, false)
})

test('öğrenci sorgusu çocuk süzgeci eklemez; kapsamı sunucu daraltır', () => {
  const query = familyInvoiceListQuery(state(), '', { studentId: '', paidOnly: false })
  assert.equal('studentId' in (query.filters ?? {}), false)
  assert.deepEqual(familyTotalsQuery(''), { groupBy: 'status', sum: 'amount' })
  assert.deepEqual(familyTotalsQuery('s1'), {
    groupBy: 'status',
    sum: 'amount',
    filters: { studentId: 's1' },
  })
})

test('kalan tutar ödenmemişte taksit tutarı, ödenmişte sıfırdır; CSV okunur biçimdedir', () => {
  const { invoices } = setup()
  const [paid, unpaid] = ['inv-s1-0', 'inv-s1-4'].map((id) =>
    invoiceRow(
      invoices.find((item) => item.id === id)!,
      TODAY,
    ),
  )
  assert.equal(remainingAmount(paid!), 0)
  assert.equal(remainingAmount(unpaid!), unpaid!.amount)
  const csv = familyInvoiceCsvRow(unpaid!)
  assert.equal(csv.installment, '5. taksit')
  assert.equal(csv.remaining, csv.amount)
  assert.equal(familyInvoiceCsvRow(paid!).remaining, '0,00 ₺')
})

// --- ON-036: Vue Finance.vue eşitliği (hazır filtreler, kampüs/sınıf, tahsilat tarihi) ---------

const CLASS_REFS = createSeed(NOW).classes.map((item) => ({
  id: item.id,
  name: item.name,
  branchId: item.branchId,
}))
const BRANCH_REFS = createSeed(NOW).branches.map((item) => ({ id: item.id, name: item.name }))

test('ON-036: hazır ödeme filtreleri Vue çipleridir ve durum anahtarına eşlenir', () => {
  assert.deepEqual(
    INVOICE_PRESETS.map((preset) => preset.label),
    ['Tüm ödemeler', 'Geciken ödemeler', 'Yaklaşan taksitler', 'Ödenenler'],
  )
  for (const preset of INVOICE_PRESETS) {
    if (preset.value === '') continue
    assert.ok(isInvoiceStatusKey(preset.value), preset.value)
  }
  const overdue = invoiceListQuery(state({ filters: { status: INVOICE_PRESETS[1].value } }), '')
  assert.deepEqual(overdue.filters, { status: 'Gecikmiş' })
})

test('ON-036: süzgeç paneli kampüs, sınıf ve tahsilat tarihidir; sınıf seçenekleri kampüse daralır', () => {
  const all = invoiceFilterFields(BRANCH_REFS, CLASS_REFS, '')
  assert.deepEqual(
    all.map((field) => [field.key, field.label, field.type ?? 'select']),
    [
      ['branchId', 'Kampüs', 'select'],
      ['classId', 'Sınıf', 'select'],
      ['paidAt', 'Tahsilat tarihi', 'date'],
    ],
  )
  assert.equal(all[0]?.options?.length, 3)
  assert.equal(all[1]?.options?.length, 24)
  // Kampüs seçilmemişken farklı kampüslerin aynı adlı sınıfları ayırt edilir.
  assert.equal(all[1]?.options?.[0]?.label, '7-A · Kadıköy Kampüsü')

  const b2 = invoiceFilterFields(BRANCH_REFS, CLASS_REFS, 'b2')
  assert.equal(b2[1]?.options?.length, 8)
  assert.ok(b2[1]?.options?.every((option) => String(option.label).endsWith('-B')))
})

test('ON-036: kampüs süzgeci kampüsün sınıflarına, sınıf süzgeci tek sınıfa çevrilir', () => {
  assert.deepEqual(invoiceClassScope({}, CLASS_REFS), { kind: 'all' })
  const b1 = invoiceClassScope({ branchId: 'b1' }, CLASS_REFS)
  assert.deepEqual(b1, {
    kind: 'classes',
    classIds: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'],
  })
  assert.deepEqual(invoiceClassScope({ classId: 'c9' }, CLASS_REFS), {
    kind: 'classes',
    classIds: ['c9'],
  })
  assert.deepEqual(invoiceClassScope({ branchId: 'b2', classId: 'c9' }, CLASS_REFS), {
    kind: 'classes',
    classIds: ['c9'],
  })
  // Kampüs dışı sınıf ve sınıfı olmayan kampüs boş sonuç verir; süzgeç yok sayılmaz.
  assert.deepEqual(invoiceClassScope({ branchId: 'b1', classId: 'c9' }, CLASS_REFS), {
    kind: 'classes',
    classIds: [NO_CLASS],
  })
  assert.deepEqual(invoiceClassScope({ branchId: 'b-yok' }, CLASS_REFS), {
    kind: 'classes',
    classIds: [NO_CLASS],
  })
  // Uç tek süzgeçte en çok 20 değer alır: daha çok sınıflı kampüs gönderilmez.
  const many = Array.from({ length: MAX_FILTER_VALUES + 1 }, (_, index) => ({
    id: `test-c${String(index)}`,
    name: `Sınıf ${String(index)}`,
    branchId: 'test-b',
  }))
  assert.deepEqual(invoiceClassScope({ branchId: 'test-b' }, many), { kind: 'too_many' })
  const query = invoiceListQuery(state({ filters: { branchId: 'test-b' } }), '', many)
  assert.equal(query.filters, undefined)
})

test('ON-036: tahsilat tarihi aralığı paidAt günüyle gider; ters ve biçimsiz aralık gönderilmez', () => {
  assert.deepEqual(paidAtRange({ min: '2026-09-01', max: '2026-09-30' }), {
    dateField: 'paidAt',
    dateFrom: '2026-09-01',
    dateTo: '2026-09-30',
  })
  assert.deepEqual(paidAtRange({ min: '2026-09-01' }), {
    dateField: 'paidAt',
    dateFrom: '2026-09-01',
  })
  assert.deepEqual(paidAtRange({ max: '2026-09-30' }), {
    dateField: 'paidAt',
    dateTo: '2026-09-30',
  })
  assert.deepEqual(paidAtRange({ min: '2026-09-30', max: '2026-09-01' }), {})
  assert.deepEqual(paidAtRange({ min: '30.09.2026' }), {})
  assert.deepEqual(paidAtRange('2026-09-01'), {})
  assert.deepEqual(paidAtRange(undefined), {})
})

test('ON-036: liste ve CSV sorgusu durum, sınıf ve tahsilat tarihini birlikte taşır', () => {
  const listState = state({
    filters: { status: 'odendi', branchId: 'b1', classId: 'c1', paidAt: { min: '2026-09-01' } },
  })
  const expected = {
    status: 'Ödendi',
    classId: ['c1'],
    dateField: 'paidAt',
    dateFrom: '2026-09-01',
  }
  assert.deepEqual(invoiceListQuery(listState, '', CLASS_REFS).filters, expected)
  assert.deepEqual(invoiceExportQuery(listState, '', CLASS_REFS).filters, expected)
  assert.equal(invoiceExportQuery(listState, '', CLASS_REFS).sort?.[0], 'dueDate')
})
