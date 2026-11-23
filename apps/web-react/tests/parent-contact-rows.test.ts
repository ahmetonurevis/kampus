import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parentContactRows } from '../src/pages/academic/parent-contact-rows.ts'

test('DOM-YTK-055: veli satırı sınıf öğrencisi başına; sınıf dışı bağ atlanır, maskeli değer aynen kalır', () => {
  const rows = parentContactRows(
    [
      { id: 'p1', name: 'Ayşe Yılmaz', studentIds: ['s1', 's2'], phone: '0532 *** ** 12' },
      { id: 'p9', name: 'Ali Can', studentIds: ['s9'] },
      { id: 'p3', name: 'Zeynep Ak', studentIds: ['s3'], email: 'z***@x.com' },
    ],
    [
      { id: 's3', name: 'Çağla Ak' },
      { id: 's1', name: 'Deniz Yılmaz' },
    ],
  )
  assert.deepEqual(
    rows.map((row) => [row.key, row.phone, row.email]),
    [
      ['p3:s3', undefined, 'z***@x.com'],
      ['p1:s1', '0532 *** ** 12', undefined],
    ],
  )
})
