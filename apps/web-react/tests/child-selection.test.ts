import assert from 'node:assert/strict'
import { test } from 'node:test'
import { devSession } from '../src/auth/dev-auth.ts'
import { childScrollKey, resolveChild } from '../src/lib/child-selection.ts'

const children = devSession('veli').children

test('örnek veli iki çocukla gelir; diğer rollerde çocuk yoktur', () => {
  assert.deepEqual(
    children.map((child) => child.name),
    ['Deniz Yılmaz', 'Ece Yılmaz'],
  )
  assert.deepEqual(devSession('ogretmen').children, [])
})

test('kayıtlı seçim yalnız hesabın çocuğuysa korunur', () => {
  assert.equal(resolveChild(children, 's2'), 's2')
  assert.equal(resolveChild(children, 's99'), 's1')
  assert.equal(resolveChild(children, undefined), 's1')
  assert.equal(resolveChild(children, 42), 's1')
  assert.equal(resolveChild([], 's1'), '')
})

test('kaydırma anahtarı çocuk bazındadır', () => {
  assert.notEqual(childScrollKey('/veli/finans', 's1'), childScrollKey('/veli/finans', 's2'))
})
