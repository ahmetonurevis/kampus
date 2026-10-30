// @ts-nocheck — TODO(ts): test tipleri dosya dosya tamamlanacak
import assert from 'node:assert/strict'
import test from 'node:test'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'

test('DomainError varsayılan olarak rule türündedir ve Error alt sınıfıdır', () => {
  const error = new DomainError('goal_already_open', 'Bu öğrenci için açık bir hedef zaten var.')
  assert.ok(error instanceof Error)
  assert.ok(error instanceof DomainError)
  assert.equal(error.name, 'DomainError')
  assert.equal(error.code, 'goal_already_open')
  assert.equal(error.kind, 'rule')
  assert.equal(error.path, undefined)
  assert.equal(error.message, 'Bu öğrenci için açık bir hedef zaten var.')
})

test('DomainError tür, yol ve neden bilgisini taşır', () => {
  const cause = new Error('iç')
  const error = new DomainError('record_not_found', 'Kayıt bulunamadı.', {
    kind: 'not_found',
    path: ['studentId'],
    cause,
  })
  assert.equal(error.kind, 'not_found')
  assert.deepEqual(error.path, ['studentId'])
  assert.equal(error.cause, cause)
})
