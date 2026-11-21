import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PAYER_CHILD_PARAM,
  payerChildViewKey,
  resolveFinanceChild,
  withoutPayerChild,
  withPayerChildSwitch,
} from '../src/pages/finance/finance-child.ts'

// ON-313 (K-04; DOM-FIN-052, DOM-ILT-074): veli finans sayfalarında ödeyicisi olunan çocuğun seçimi.

const base = { shellChild: 's2', payerOnlyIds: ['s1'], requested: null, remembered: undefined }

test('ON-313 DOM-ILT-074 ödeyici çocuk yoksa seçim kabuğun çocuğudur', () => {
  assert.deepEqual(resolveFinanceChild({ ...base, payerOnlyIds: [] }), {
    childId: 's2',
    payerOnly: false,
    stale: false,
  })
  assert.deepEqual(resolveFinanceChild({ ...base, shellChild: '', payerOnlyIds: [] }), {
    childId: '',
    payerOnly: false,
    stale: false,
  })
})

test('ON-313 K-04 velayetli çocuk yokken ilk ödeyici çocuk seçilir', () => {
  assert.deepEqual(resolveFinanceChild({ ...base, shellChild: '', payerOnlyIds: ['s1', 's3'] }), {
    childId: 's1',
    payerOnly: true,
    stale: false,
  })
})

test('ON-313 K-04 adresteki ödeyici çocuk kabuk çocuğundan önce gelir', () => {
  assert.deepEqual(resolveFinanceChild({ ...base, requested: 's1' }), {
    childId: 's1',
    payerOnly: true,
    stale: false,
  })
  // Seçildiği andaki kabuk çocuğu aynıysa geçerlidir.
  assert.equal(resolveFinanceChild({ ...base, requested: 's1', remembered: 's2' }).childId, 's1')
})

test('ON-313 kabukta çocuk değişince ya da kimlik listede yoksa ödeyici seçimi bayatlar', () => {
  assert.deepEqual(resolveFinanceChild({ ...base, requested: 's1', remembered: 's9' }), {
    childId: 's2',
    payerOnly: false,
    stale: true,
  })
  // Velayetli çocuk ya da kapsam dışı öğrenci bu parametreyle seçilmez (DOM-ILT-070).
  for (const requested of ['s2', 's5'])
    assert.deepEqual(resolveFinanceChild({ ...base, requested }), {
      childId: 's2',
      payerOnly: false,
      stale: true,
    })
  assert.deepEqual(
    resolveFinanceChild({ ...base, shellChild: '', payerOnlyIds: [], requested: 's5' }),
    { childId: '', payerOnly: false, stale: true },
  )
})

test('ON-313 ödeyici çocuğa geçiş çocuğa bağlı panelleri kapatır, liste durumunu korur', () => {
  const next = new URLSearchParams(withPayerChildSwitch('?cocuk=s2&detay=inv-1&sayfa=2', 's1'))
  assert.equal(next.get(PAYER_CHILD_PARAM), 's1')
  assert.equal(next.get('cocuk'), 's2')
  assert.equal(next.get('sayfa'), '2')
  assert.equal(next.has('detay'), false)
  assert.equal(withoutPayerChild('?cocuk=s2&odenen=s1&sayfa=2'), '?cocuk=s2&sayfa=2')
  assert.equal(withoutPayerChild('?odenen=s1'), '')
  assert.notEqual(payerChildViewKey('s1'), payerChildViewKey('s2'))
})
