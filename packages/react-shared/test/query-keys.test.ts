import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { institutionKey, isInstitutionKey, ME_QUERY_KEY, sessionKey } from '../src/query-keys.ts'

describe('sorgu anahtarları', () => {
  test('kuruma bağlı anahtar etkin kurumla başlar', () => {
    assert.deepEqual(institutionKey('inst-a', 'goals', { page: 2 }), [
      'inst',
      'inst-a',
      'goals',
      { page: 2 },
    ])
  })

  test('farklı kurumun aynı sorgusu farklı anahtar üretir', () => {
    assert.notDeepEqual(institutionKey('inst-a', 'goals'), institutionKey('inst-b', 'goals'))
  })

  test('kurum bilinmiyorsa null taşır', () => {
    assert.deepEqual(institutionKey(null, 'goals'), ['inst', null, 'goals'])
  })

  test('oturum anahtarı kurum kökünde değildir; /me kuruma bağlı sayılmaz', () => {
    assert.deepEqual(sessionKey('me'), ['session', 'me'])
    assert.deepEqual(ME_QUERY_KEY, ['session', 'me'])
    assert.equal(isInstitutionKey(ME_QUERY_KEY), false)
    assert.equal(isInstitutionKey(institutionKey('x')), true)
  })
})
