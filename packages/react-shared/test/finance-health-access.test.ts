import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  healthReasonHeaders,
  healthReasonKey,
  optionalHealthReasonHeaders,
} from '../src/use-finance-health-access.ts'

// Sağlık okuması kancalarının gerekçe yardımcıları (DOM-FIN-156; ON-164; K-523).

test('DOM-FIN-156: gerekçe sorgu anahtarının ve başlığın parçasıdır', () => {
  const other = { code: 'other' as const, note: 'Okul hekimi istedi' }
  assert.deepEqual(healthReasonKey(null), [])
  assert.deepEqual(healthReasonKey(other), ['reason', 'other', 'Okul hekimi istedi'])
  assert.deepEqual(healthReasonHeaders({ code: 'first_aid', note: null }), {
    'x-access-reason': 'first_aid',
  })
  assert.deepEqual(healthReasonHeaders(other), {
    'x-access-reason': 'other',
    'x-access-reason-note': encodeURIComponent('Okul hekimi istedi'),
  })
  assert.throws(() => healthReasonHeaders(null), TypeError)
  assert.deepEqual(optionalHealthReasonHeaders(null), {})
  assert.deepEqual(optionalHealthReasonHeaders(other), healthReasonHeaders(other))
})
