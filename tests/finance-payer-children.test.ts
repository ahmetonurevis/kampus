import assert from 'node:assert/strict'
import test from 'node:test'

import { payerChildren } from '../packages/school-core/src/lib/finance-payer-children.ts'

// ON-313 (K-04 kullanıcı kararı 2026-11-03; DOM-FIN-052, DOM-ILT-074): finans seçicisinin
// ödeyici çocukları yalnız kapsamdaki öğrencilerdir ve ad ile sınıf adı taşır.

const classes = [
  { id: 'c1', name: '9-A' },
  { id: 'c2', name: '   ' },
]
const students = [
  { id: 's2', name: 'Ece Yılmaz', classId: 'c1', birthDate: '2012-01-01', phone: '555' },
  { id: 's1', name: 'Çağla Demir', classId: 'c9' },
  { id: 's3', name: 'Ali Kaya', classId: 'c1' },
  { id: 's4', name: '', classId: 'c2' },
]

test('ON-313 DOM-ILT-074 yalnız ödeyici kapsamındaki öğrenciler döner', () => {
  const rows = payerChildren({ payerStudentIds: new Set(['s1', 's2']) }, students, classes)
  assert.deepEqual(
    rows.map((row) => row.id),
    ['s1', 's2'],
  )
  assert.deepEqual(payerChildren({ payerStudentIds: new Set() }, students, classes), [])
})

test('ON-313 KVKK asgarisi: satır yalnız kimlik, ad ve sınıf adı taşır', () => {
  const [row] = payerChildren({ payerStudentIds: new Set(['s2']) }, students, classes)
  assert.deepEqual(row, { id: 's2', name: 'Ece Yılmaz', className: '9-A' })
})

test('ON-313 sınıfı okunamayan öğrencide sınıf boş, adsız kayıtta ad yerine çizgi', () => {
  const rows = payerChildren({ payerStudentIds: new Set(['s1', 's4']) }, students, classes)
  assert.deepEqual(rows, [
    { id: 's4', name: '—', className: null },
    { id: 's1', name: 'Çağla Demir', className: null },
  ])
  assert.deepEqual(
    payerChildren({ payerStudentIds: new Set(['s5']) }, [{ id: 's5', name: 'Ada' }], classes),
    [{ id: 's5', name: 'Ada', className: null }],
  )
})

test('ON-313 sıralama Türkçe ada göre, eşit adda kimliğe göre', () => {
  const rows = payerChildren(
    { payerStudentIds: new Set(['s1', 's2', 's3', 's6']) },
    [...students, { id: 's6', name: 'Ali Kaya', classId: 'c1' }],
    classes,
  )
  assert.deepEqual(
    rows.map((row) => row.id),
    ['s3', 's6', 's1', 's2'],
  )
})
