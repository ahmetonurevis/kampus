import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { planPositions, POSITION_STEP, renumber } from '../src/db/positions.ts'

const S = POSITION_STEP

function assertIncreasing(values: readonly number[]) {
  for (let index = 1; index < values.length; index += 1)
    assert.ok((values[index - 1] ?? 0) < (values[index] ?? 0), `artan değil: ${values.join(',')}`)
}

describe('sıra planı', () => {
  test('değişmeyen dizide hiçbir değer değişmez', () => {
    assert.deepEqual(planPositions([0, S, 2 * S]), [0, S, 2 * S])
    assert.deepEqual(planPositions([]), [])
  })

  test('başa ekleme en küçükten, sona ekleme en büyükten bir adım öteye gider', () => {
    assert.deepEqual(planPositions([null, 0, S]), [-S, 0, S])
    assert.deepEqual(planPositions([null, null, 0]), [-2 * S, -S, 0])
    assert.deepEqual(planPositions([0, S, null, null]), [0, S, 2 * S, 3 * S])
    assert.deepEqual(planPositions([null, null]), [0, S])
  })

  test('araya ekleme komşuların arasındaki değeri alır', () => {
    assert.deepEqual(planPositions([0, null, S]), [0, S / 2, S])
    const three = planPositions([0, null, null, null, S])
    assertIncreasing(three)
    assert.equal(three[0], 0)
    assert.equal(three[4], S)
  })

  test('yer değiştiren kayıt dışında hiçbir değer değişmez', () => {
    // Son kayıt başa alındı: yalnız o yeni değer alır.
    const planned = planPositions([3 * S, 0, S, 2 * S])
    assert.deepEqual(planned.slice(1), [0, S, 2 * S])
    assert.ok((planned[0] ?? 0) < 0)
    // Ters sıra: en uzun artan alt dizi tek kayıttır, kalanlar onun çevresine yerleşir.
    assertIncreasing(planPositions([2 * S, S, 0]))
  })

  test('ara kalmayınca bütün dizi baştan numaralanır', () => {
    assert.deepEqual(planPositions([0, null, 1]), renumber(3))
    let positions: (number | null)[] = [0, S]
    // Aynı noktaya art arda ekleme aralığı tüketir; her adımda sonuç yine kesin artandır.
    for (let round = 0; round < 15; round += 1) {
      const planned = planPositions([positions[0] ?? 0, null, ...positions.slice(1)])
      assertIncreasing(planned)
      positions = planned
    }
    assert.equal(positions.length, 17)
  })

  test('eşit saklanan değerlerden yalnız biri yerinde kalır', () => {
    const planned = planPositions([0, 0, S])
    assertIncreasing(planned)
    assert.equal(planned[2], S)
  })
})
