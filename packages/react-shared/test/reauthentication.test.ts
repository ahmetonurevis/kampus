import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { ApiError } from '@kampus/api-client/errors.ts'

import { isReauthenticationRequired, REAUTHENTICATION_CODE } from '../src/reauthentication.ts'

const apiError = (code: string, status = 403) => new ApiError({ status, code, message: 'Hata.' })

describe('taze oturum hata denetimi', () => {
  test('guvenlik-kvkk: sabit sunucu kodudur', () => {
    assert.equal(REAUTHENTICATION_CODE, 'reauthentication_required')
  })

  test('guvenlik-kvkk: reauthentication_required ApiError doğrulanır', () => {
    assert.equal(isReauthenticationRequired(apiError('reauthentication_required')), true)
  })

  test('diğer ApiError kodları ve yetkisizlik doğrulanmaz', () => {
    assert.equal(isReauthenticationRequired(apiError('forbidden')), false)
    assert.equal(isReauthenticationRequired(apiError('module_disabled')), false)
    assert.equal(isReauthenticationRequired(apiError('unauthenticated', 401)), false)
  })

  test('ApiError olmayan değerler doğrulanmaz', () => {
    assert.equal(isReauthenticationRequired(new Error('reauthentication_required')), false)
    assert.equal(isReauthenticationRequired({ code: 'reauthentication_required' }), false)
    assert.equal(isReauthenticationRequired(null), false)
    assert.equal(isReauthenticationRequired(undefined), false)
    assert.equal(isReauthenticationRequired('reauthentication_required'), false)
  })
})
