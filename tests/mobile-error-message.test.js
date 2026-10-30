import test from 'node:test'
import assert from 'node:assert/strict'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import { userErrorMessage } from '../apps/mobile/src/lib/error-message.ts'

const fallback = 'Genel mesaj'

test('iş kuralı reddinde Türkçe kural mesajı gösterilir', () => {
  const error = new DomainError('slot_conflict', 'Bu saatte çakışma var.', { kind: 'conflict' })
  assert.equal(userErrorMessage(error, fallback), 'Bu saatte çakışma var.')
})

test('Zod sorunu varsa ilk mesaj gösterilir', () => {
  assert.equal(
    userErrorMessage({ issues: [{ message: 'Alan zorunlu' }] }, fallback),
    'Alan zorunlu',
  )
})

test('teknik hata ayrıntısı gösterilmez', () => {
  assert.equal(userErrorMessage(new Error('ECONNRESET db'), fallback), fallback)
  assert.equal(userErrorMessage(new TypeError('x is undefined'), fallback), fallback)
  assert.equal(userErrorMessage('metin', fallback), fallback)
})
