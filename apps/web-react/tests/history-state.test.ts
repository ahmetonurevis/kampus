import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keptHistoryState } from '../src/lib/history-state.ts'

test('OG-205: liste yazımı geri dönüş adresini korur, panel işaretçisini taşımaz', () => {
  assert.deepEqual(keptHistoryState({ from: '/ogretmen/siniflarim?sinif=c1' }), {
    from: '/ogretmen/siniflarim?sinif=c1',
  })
  assert.deepEqual(keptHistoryState({ from: '/ogretmen/siniflarim', detailPanel: 'sinif' }), {
    from: '/ogretmen/siniflarim',
  })
})

test('OG-205: korunacak durum yoksa undefined döner', () => {
  assert.equal(keptHistoryState(null), undefined)
  assert.equal(keptHistoryState(undefined), undefined)
  assert.equal(keptHistoryState('metin'), undefined)
  assert.equal(keptHistoryState(['from']), undefined)
  assert.equal(keptHistoryState({ detailPanel: 'sinif' }), undefined)
})
