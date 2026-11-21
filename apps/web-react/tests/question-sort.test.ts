import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sortRows } from '../src/lib/list-query.ts'

test('DOM-ILT-093: yanıt süresi sütunu sayısal sıralanır; yanıtlananlar (boş süre) her yönde sona düşer', () => {
  const rows = [
    { id: 'answered', remainingMinutes: null },
    { id: 'late', remainingMinutes: -60 },
    { id: 'fresh', remainingMinutes: 120 },
  ]
  assert.deepEqual(
    sortRows(rows, 'remainingMinutes', 1).map((item) => item.id),
    ['late', 'fresh', 'answered'],
  )
  assert.deepEqual(
    sortRows(rows, 'remainingMinutes', -1).map((item) => item.id),
    ['fresh', 'late', 'answered'],
  )
})
