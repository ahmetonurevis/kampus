import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toSession } from '../src/auth/session-mapping.ts'
import {
  childScrollKey,
  resolveChild,
  resolveChildFrom,
  withChildNames,
  withChildParam,
} from '../src/lib/child-selection.ts'
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

test('adresteki çocuk bellekteki seçimden önce gelir; geçersiz aday atlanır', () => {
  assert.equal(resolveChildFrom(children, ['s2', 's1']), 's2')
  assert.equal(resolveChildFrom(children, ['s99', 's2']), 's2')
  assert.equal(resolveChildFrom(children, [null, undefined]), 's1')
  assert.equal(resolveChildFrom([], ['s1']), '')
})

test('çocuk parametresi diğer adres parametrelerini korur', () => {
  assert.equal(withChildParam('', 's2'), '?cocuk=s2')
  assert.equal(withChildParam('?q=mat&sayfa=2', 's2'), '?q=mat&sayfa=2&cocuk=s2')
  assert.equal(withChildParam('?cocuk=s1&q=mat', 's2'), '?cocuk=s2&q=mat')
})

test('çocuk adları kapsamlı öğrenci okumasından gelir; kapsamda olmayana ad uydurulmaz', () => {
  const named = withChildNames(children, [
    { id: 's1', name: 'Deniz Yılmaz' },
    { id: 's2', name: 'Ece Yılmaz' },
    { id: 's3', name: 'Başkası' },
  ])
  assert.deepEqual(named, [
    { id: 's1', name: 'Deniz Yılmaz' },
    { id: 's2', name: 'Ece Yılmaz' },
  ])
  assert.deepEqual(withChildNames(children, [{ id: 's2', name: 'Ece Yılmaz' }]), [
    { id: 's1' },
    { id: 's2', name: 'Ece Yılmaz' },
  ])
  assert.deepEqual(withChildNames(children, []), [{ id: 's1' }, { id: 's2' }])
})
