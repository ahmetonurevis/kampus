import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { isScrollable } from '../src/hooks/use-scrollable.ts'

const box = (scrollHeight: number, clientHeight: number, scrollWidth = 300, clientWidth = 300) => ({
  scrollHeight,
  clientHeight,
  scrollWidth,
  clientWidth,
})

describe('isScrollable', () => {
  test('içerik kutuya sığıyorsa bölge kaymaz, Tab durağı olmaz', () => {
    assert.equal(isScrollable(box(400, 400)), false)
    // Alt piksel yuvarlaması kayma sayılmaz.
    assert.equal(isScrollable(box(401, 400)), false)
  })

  test('içerik dikey ya da yatay taşarsa bölge kayar', () => {
    assert.equal(isScrollable(box(900, 600)), true)
    assert.equal(isScrollable(box(400, 400, 420, 300)), true)
  })
})
