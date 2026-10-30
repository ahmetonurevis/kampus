import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FilterField } from '../src/lib/list-query.ts'
import { initialListState, listReducer } from '../src/lib/list-state.ts'
import {
  activeFields,
  filterSelectionLabel,
  listView,
  mobileColumnSplit,
  orderRows,
  presetActive,
  tableFields,
  tableSearchKeys,
} from '../src/lib/list-view.ts'

const columns = [
  { key: 'name', label: 'Öğrenci' },
  { key: 'class', label: 'Sınıf' },
  { key: 'dueDate', label: 'Vade' },
  { key: 'amount', label: 'Tutar' },
  { key: 'status', label: 'Durum' },
  { key: 'actions', label: 'İşlemler' },
]

const rows = Array.from({ length: 23 }, (_, i) => ({
  id: `r${i + 1}`,
  name: `Öğrenci ${i + 1}`,
  class: i % 2 ? '7-A' : '8-B',
  dueDate: `2026-10-${String(1 + i).padStart(2, '0')}T09:00:00.000Z`,
  amount: (i + 1) * 10_000,
  status: i % 3 ? 'Ödendi' : 'Gecikmiş',
}))

test('tablo alanları sütunlardan türetilir; hariç tutulan çıkar, açık tanım ezer', () => {
  const custom: FilterField = {
    key: 'class',
    label: 'Şube',
    options: [{ value: '7-A', label: '7/A' }],
  }
  const fields = tableFields(columns, [custom], ['status'])
  assert.deepEqual(
    fields.map((field) => [field.key, field.label]),
    [
      ['class', 'Şube'],
      ['dueDate', 'Vade'],
      ['amount', 'Tutar (₺)'],
    ],
  )
  assert.deepEqual(tableSearchKeys(columns, ['phone', 'name']), [
    'name',
    'class',
    'dueDate',
    'amount',
    'status',
    'phone',
  ])
})

test('dar ekran kartı: başlık, temel bilgiler ve ayrıntılar ayrılır; işlem sütunu girmez', () => {
  const split = mobileColumnSplit(columns)
  assert.equal(split.title?.key, 'name')
  assert.deepEqual(
    split.main.map((c) => c.key),
    ['class', 'dueDate', 'amount'],
  )
  assert.deepEqual(
    split.details.map((c) => c.key),
    ['status'],
  )
  const chosen = mobileColumnSplit(columns, ['status'])
  assert.deepEqual(
    chosen.main.map((c) => c.key),
    ['status'],
  )
  assert.deepEqual(
    chosen.details.map((c) => c.key),
    ['class', 'dueDate', 'amount'],
  )
})

test('görünüm: tüm filtrelenmiş ve sıralanmış sonuç CSV için, sayfa yalnız görünür dilim', () => {
  const fields = tableFields(columns)
  const searchKeys = tableSearchKeys(columns)
  let state = listReducer(initialListState(5), { type: 'filter', key: 'status', value: 'Ödendi' })
  state = listReducer(state, { type: 'sort', key: 'amount' })
  state = listReducer(state, { type: 'sort', key: 'amount' })
  state = listReducer(state, { type: 'page', page: 2 })
  const view = listView(rows, state, { fields, searchKeys })
  assert.equal(view.total, 15)
  assert.equal(view.rows.length, 15, 'CSV tüm sonuçları alır')
  assert.ok(view.rows.every((row) => row.status === 'Ödendi'))
  assert.equal(view.rows[0]?.amount, 230_000, 'azalan sıralama')
  assert.equal(view.pageCount, 3)
  assert.deepEqual(
    view.visible.map((row) => row.id),
    view.rows.slice(5, 10).map((row) => row.id),
  )
})

test('veri azalınca görünüm geçerli son sayfaya iner', () => {
  const state = { ...initialListState(5), page: 5 }
  const view = listView(rows.slice(0, 7), state, { fields: [], searchKeys: ['name'] })
  assert.equal(view.page, 2)
  assert.equal(view.visible.length, 2)
  assert.equal(listView([], state, { fields: [], searchKeys: [] }).page, 1)
})

test('kart listesi hazır sıralaması Türkçe ve doğal sırayla, boşlar başta', () => {
  const items = [
    { id: 1, title: 'Ödev 10' },
    { id: 2, title: 'ödev 2' },
    { id: 3, title: 'Çalışma' },
    { id: 4, title: '' },
  ]
  const options = [
    { value: 'az', label: 'A–Z', key: 'title' },
    { value: 'za', label: 'Z–A', key: 'title', direction: -1 as const },
  ]
  assert.deepEqual(
    orderRows(items, options, 'az').map((i) => i.id),
    [4, 3, 2, 1],
  )
  assert.deepEqual(
    orderRows(items, options, 'za').map((i) => i.id),
    [1, 2, 3, 4],
  )
  assert.deepEqual(
    orderRows(items, options, '').map((i) => i.id),
    [1, 2, 3, 4],
  )
})

test('filtre çipleri: etkin alanlar ve okunur etiketler', () => {
  const fields = tableFields(columns)
  const values = { class: '7-A', dueDate: { min: '2026-10-01', max: '' }, amount: { min: 5 } }
  assert.deepEqual(
    activeFields(fields, values).map((f) => f.key),
    ['class', 'dueDate', 'amount'],
  )
  const [classField, dateField, amountField] = fields
  assert.equal(filterSelectionLabel(classField!, '7-A', rows), '7-A')
  assert.equal(filterSelectionLabel(dateField!, values.dueDate, rows), '2026-10-01 → Bitiş yok')
  assert.equal(filterSelectionLabel(amountField!, values.amount, rows), '5 – ')
  const labelled: FilterField = { key: 'x', label: 'X', options: [{ value: 1, label: 'Bir' }] }
  assert.equal(filterSelectionLabel(labelled, '1', []), 'Bir')
})

test('hazır filtre yalnız aynı etkin değerlerde seçili görünür', () => {
  assert.equal(presetActive({}, {}), true)
  assert.equal(presetActive({ status: '' }, {}), true)
  assert.equal(
    presetActive({ status: 'Ödendi', class: '7-A' }, { class: '7-A', status: 'Ödendi' }),
    true,
  )
  assert.equal(presetActive({ status: 'Ödendi' }, {}), false)
  assert.equal(presetActive({}, { status: 'Ödendi' }), false)
})
