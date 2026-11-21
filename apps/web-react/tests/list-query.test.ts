import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  columnFilters,
  filterOptions,
  filterRows,
  isInvalidRange,
  pageCount,
  pageNumbers,
  pageSlice,
  sortRows,
  type FilterField,
} from '../src/lib/list-query.ts'

const rows = [
  { id: 'lq-1', name: 'Deniz Yılmaz', status: 'Ödendi', amount: 150000, date: '2026-09-01' },
  { id: 'lq-2', name: 'Ece Yılmaz', status: 'Gecikmiş', amount: 90000, date: '2026-10-15' },
  { id: 'lq-3', name: 'İlker Şahin', status: 'Ödendi', amount: null, date: '2026-10-20' },
  { id: 'lq-4', name: 'Çağla Öz', status: 'Yaklaşan', amount: 30000, date: '2026-11-02' },
] as const

const fields: FilterField[] = [
  { key: 'status', label: 'Durum' },
  { key: 'amount', label: 'Tutar', type: 'number', divisor: 100 },
  { key: 'date', label: 'Tarih', type: 'date' },
]

test('arama tüm terimleri Türkçe küçük harfle arar', () => {
  assert.deepEqual(
    filterRows(rows, 'YILMAZ ece', fields, {}, ['name']).map((row) => row.id),
    ['lq-2'],
  )
  assert.deepEqual(
    filterRows(rows, 'ilker', fields, {}, ['name']).map((row) => row.id),
    ['lq-3'],
  )
})

test('seçim, sayı ve tarih aralığı filtreleri birlikte uygulanır', () => {
  const select = filterRows(rows, '', fields, { status: 'Ödendi' }, ['name'])
  assert.deepEqual(
    select.map((row) => row.id),
    ['lq-1', 'lq-3'],
  )
  const amount = filterRows(rows, '', fields, { amount: { min: 500, max: 1000 } }, ['name'])
  assert.deepEqual(
    amount.map((row) => row.id),
    ['lq-2'],
  )
  const date = filterRows(rows, '', fields, { date: { min: '2026-10-01' } }, ['name'])
  assert.deepEqual(
    date.map((row) => row.id),
    ['lq-2', 'lq-3', 'lq-4'],
  )
})

test('ters aralık geçersiz sayılır', () => {
  const amount = fields[1]!
  assert.equal(isInvalidRange(amount, { min: 10, max: 2 }), true)
  assert.equal(isInvalidRange(amount, { min: 2, max: 10 }), false)
  assert.equal(isInvalidRange(amount, { min: 2 }), false)
})

test('sıralama Türkçe ve sayısal çalışır, boşlar sona gider', () => {
  assert.deepEqual(
    sortRows(rows, 'name', 1).map((row) => row.id),
    ['lq-4', 'lq-1', 'lq-2', 'lq-3'],
  )
  assert.deepEqual(
    sortRows(rows, 'amount', -1).map((row) => row.id),
    ['lq-1', 'lq-2', 'lq-4', 'lq-3'],
  )
  assert.deepEqual(
    sortRows(rows, '', 1).map((row) => row.id),
    rows.map((row) => row.id),
  )
})

test('sayfa sayısı, dilim ve sayfa numaraları', () => {
  assert.equal(pageCount(0, 8), 1)
  assert.equal(pageCount(17, 8), 3)
  assert.deepEqual(pageSlice([1, 2, 3, 4, 5], 2, 2), [3, 4])
  assert.deepEqual(pageNumbers(1, 5), [1, 2, 3, 4, 5])
  assert.deepEqual(pageNumbers(5, 10), [1, 'gap-4', 4, 5, 6, 'gap-10', 10])
  assert.deepEqual(pageNumbers(1, 10), [1, 2, 'gap-10', 10])
  assert.deepEqual(pageNumbers(3, 10), [1, 2, 3, 4, 'gap-10', 10])
})

test('sütunlardan filtre alanları ve seçenekleri türetilir', () => {
  assert.deepEqual(
    columnFilters([
      { key: 'name', label: 'Ad' },
      { key: 'status', label: 'Durum' },
      { key: 'amount', label: 'Tutar' },
      { key: 'dueDate', label: 'Vade' },
    ]),
    [
      { key: 'status', label: 'Durum' },
      { key: 'amount', label: 'Tutar (₺)', type: 'number', divisor: 100 },
      { key: 'dueDate', label: 'Vade', type: 'date' },
    ],
  )
  assert.deepEqual(
    filterOptions({ key: 'status', label: 'Durum' }, rows).map((option) => option.value),
    ['Gecikmiş', 'Ödendi', 'Yaklaşan'],
  )
})
