import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toSession } from '../src/auth/session-mapping.ts'
import { childScrollKey, resolveChild } from '../src/lib/child-selection.ts'
import { meFixture } from './fixtures/me.ts'

const children = toSession(meFixture('veli'))?.children ?? []

test('veli iki çocuk bağlantısıyla gelir; diğer rollerde çocuk yoktur', () => {
  assert.deepEqual(
    children.map((child) => child.id),
    ['s1', 's2'],
  )
  assert.deepEqual(toSession(meFixture('ogretmen'))?.children, [])
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
