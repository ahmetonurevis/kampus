import assert from 'node:assert/strict'
import { test } from 'node:test'

import { payerOnlyChildren, withPayerChildren } from '../src/finance-payer-children.ts'

// ON-313 (K-04; DOM-FIN-052, DOM-ILT-074): finans seçicisi velayet listesine ödeyici çocukları ekler.

const payer = [
  { id: 's1', name: 'Deniz Yılmaz', className: '9-A' },
  { id: 's2', name: 'Ece Yılmaz', className: null },
]

test('ON-313 K-04 velayet listesinde olan ödeyici çocuk ikinci kez eklenmez', () => {
  assert.deepEqual(
    payerOnlyChildren(['s2'], payer).map((child) => child.id),
    ['s1'],
  )
  assert.deepEqual(payerOnlyChildren(new Set(['s1', 's2']), payer), [])
  assert.deepEqual(payerOnlyChildren([], []), [])
})

test('ON-313 K-04 seçenekler önce velayet listesi, sonra yalnız ödeyici çocuklar', () => {
  const options = withPayerChildren(
    [{ id: 's2', name: 'Ece Yılmaz', className: undefined as string | undefined }],
    payer,
    (child) => ({ id: child.id, name: child.name, className: child.className ?? undefined }),
  )
  assert.deepEqual(options, [
    { id: 's2', name: 'Ece Yılmaz', className: undefined },
    { id: 's1', name: 'Deniz Yılmaz', className: '9-A' },
  ])
})
