import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  ApiError,
  applyApiErrorToForm,
  apiErrorFromResponse,
  issuesToFieldIssues,
  ROOT_FIELD,
} from '../src/errors.ts'

describe('issuesToFieldIssues', () => {
  test('yolu noktalı alan adına çevirir, yolsuz maddeyi root.server yapar', () => {
    assert.deepEqual(
      issuesToFieldIssues([
        { path: ['items', 0, 'amount'], code: 'too_small', message: 'Çok küçük' },
        { path: [], code: 'custom', message: 'Genel hata' },
      ]),
      [
        { name: 'items.0.amount', type: 'too_small', message: 'Çok küçük' },
        { name: ROOT_FIELD, type: 'custom', message: 'Genel hata' },
      ],
    )
  })
})

describe('applyApiErrorToForm', () => {
  type Call = [string, { type: string; message: string }]

  test('doğrulama maddelerini alanlara aktarır', () => {
    const calls: Call[] = []
    const error = new ApiError({
      status: 400,
      code: 'validation_failed',
      message: 'Formda düzeltilmesi gereken alanlar var.',
      issues: [{ path: ['title'], code: 'too_small', message: 'Başlık boş olamaz' }],
    })

    const handled = applyApiErrorToForm(error, (name: string, detail) => calls.push([name, detail]))

    assert.equal(handled, true)
    assert.deepEqual(calls, [['title', { type: 'too_small', message: 'Başlık boş olamaz' }]])
  })

  test('maddesiz ApiError mesajını form düzeyi hataya yazar', () => {
    const calls: Call[] = []
    const error = new ApiError({
      status: 409,
      code: 'version_conflict',
      message: 'Kayıt başkası tarafından değiştirildi.',
    })

    assert.equal(
      applyApiErrorToForm(error, (name: string, detail) => calls.push([name, detail])),
      true,
    )
    assert.deepEqual(calls, [
      [ROOT_FIELD, { type: 'version_conflict', message: 'Kayıt başkası tarafından değiştirildi.' }],
    ])
  })

  test('ApiError olmayan hatada hiçbir şey yazmaz ve false döner', () => {
    const calls: Call[] = []

    assert.equal(
      applyApiErrorToForm(new Error('boom'), (name: string, detail) => calls.push([name, detail])),
      false,
    )
    assert.deepEqual(calls, [])
  })
})

describe('apiErrorFromResponse', () => {
  test('geçersiz issue maddelerini eler', () => {
    const error = apiErrorFromResponse(400, {
      code: 'validation_failed',
      message: 'm',
      issues: [{ path: ['a'], code: 'c', message: 'ok' }, { path: 'a' }, null],
      requestId: 'r',
    })

    assert.equal(error.issues.length, 1)
  })

  test('gövde zarf değilse unexpected_response üretir', () => {
    const error = apiErrorFromResponse(500, 'düz metin', 'hdr')

    assert.equal(error.code, 'unexpected_response')
    assert.equal(error.requestId, 'hdr')
  })
})
