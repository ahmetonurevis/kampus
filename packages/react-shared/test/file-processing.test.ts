import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { ApiError } from '@kampus/api-client/errors.ts'

import { FILE_POLL_INTERVAL_MS, fileProcessing, filePollInterval } from '../src/files.ts'

// Yüklenen sesin işlenmesini bekleme (ADR 0003 karar 10; DOM-BEC-054; IST-051): istemci dosya
// `ready` olana kadar `GET /files/:id` ile yoklar; reddedilen dosya okumada 404'tür.

const error = (status: number, code = 'x') => new ApiError({ status, code, message: 'İleti.' })

describe('dosya işlenme durumu', () => {
  test('DOM-BEC-054: işlenen ve taranan dosya beklenir, yoklama sürer', () => {
    for (const status of ['pending', 'processing'] as const) {
      assert.equal(fileProcessing({ status }, null), 'waiting')
      assert.equal(filePollInterval({ status }, null), FILE_POLL_INTERVAL_MS)
    }
    // İlk yanıt gelmeden de beklenir.
    assert.equal(fileProcessing(undefined, null), 'waiting')
  })

  test('DOM-BEC-054: hazır dosyada yoklama durur', () => {
    assert.equal(fileProcessing({ status: 'ready' }, null), 'ready')
    assert.equal(filePollInterval({ status: 'ready' }, null), false)
  })

  test('DOM-BEC-054: reddedilen dosya (404 ya da durum) red sayılır, yoklama durur', () => {
    assert.equal(fileProcessing(undefined, error(404, 'not_found')), 'rejected')
    assert.equal(fileProcessing({ status: 'rejected' }, null), 'rejected')
    assert.equal(fileProcessing({ status: 'deleted' }, null), 'rejected')
    assert.equal(filePollInterval(undefined, error(404, 'not_found')), false)
  })

  test('IST-051: yetki ve modül hatası beklemeyi bitirir; ağ ve sunucu hatası beklemeyi bozmaz', () => {
    assert.equal(fileProcessing(undefined, error(403, 'module_disabled')), 'failed')
    assert.equal(filePollInterval(undefined, error(403, 'module_disabled')), false)
    assert.equal(fileProcessing(undefined, error(503)), 'waiting')
    assert.equal(fileProcessing(undefined, new TypeError('ağ')), 'waiting')
    assert.equal(filePollInterval(undefined, error(500)), FILE_POLL_INTERVAL_MS)
  })
})
