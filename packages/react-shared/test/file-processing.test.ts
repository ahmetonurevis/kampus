import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { ApiError } from '@kampus/api-client/errors.ts'

import {
  FILE_POLL_INTERVAL_MS,
  FILE_POLL_MAX_INTERVAL_MS,
  FILE_REJECTED_MESSAGE,
  FILE_WAIT_LIMIT_MS,
  fileAttachField,
  fileBlocksAttach,
  fileProcessing,
  filePollInterval,
  pauseWaitClock,
  resumeWaitClock,
  startWaitClock,
  waitRemainingMs,
} from '../src/files.ts'

// Yüklenen dosyanın işlenmesini bekleme (ADR 0003 karar 8, 10; DOM-BEC-054; IST-027, IST-051;
// OG-987): istemci dosya `ready` olana kadar `GET /files/:id` ile yoklar; taramada reddedilen
// dosyada yükleyen 422 `file_rejected`, ses dönüşümünün reddettiği kayıtta 404 alır.

const error = (status: number, code = 'x') => new ApiError({ status, code, message: 'İleti.' })

describe('dosya işlenme durumu', () => {
  test('DOM-BEC-054: işlenen ve taranan dosya beklenir, yoklama sürer', () => {
    assert.equal(fileProcessing({ status: 'processing' }, null), 'processing')
    assert.equal(filePollInterval({ status: 'processing' }, null), FILE_POLL_INTERVAL_MS)
    // İlk yanıt gelmeden de beklenir.
    assert.equal(fileProcessing(undefined, null), 'processing')
  })

  test('IST-027: tarayıcısız ortamda (pending) yoklama yapılmaz, dosya bağlamayı kilitlemez', () => {
    assert.equal(fileProcessing({ status: 'pending' }, null), 'pending')
    assert.equal(fileProcessing({ status: 'pending' }, null, true), 'pending')
    assert.equal(filePollInterval({ status: 'pending' }, null), false)
    assert.equal(fileBlocksAttach('pending'), false)
  })

  test('DOM-BEC-054: hazır dosyada yoklama durur', () => {
    assert.equal(fileProcessing({ status: 'ready' }, null), 'ready')
    assert.equal(filePollInterval({ status: 'ready' }, null), false)
  })

  test('IST-027: taramada reddedilen dosya (422 file_rejected) red sayılır, yoklama durur', () => {
    assert.equal(fileProcessing(undefined, error(422, 'file_rejected')), 'rejected')
    assert.equal(filePollInterval(undefined, error(422, 'file_rejected')), false)
    assert.equal(fileProcessing(undefined, error(422, 'file_rejected'), true), 'rejected')
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
    assert.equal(fileProcessing(undefined, error(503)), 'processing')
    assert.equal(fileProcessing(undefined, new TypeError('ağ')), 'processing')
    assert.equal(filePollInterval(undefined, error(500)), FILE_POLL_INTERVAL_MS)
  })

  test('IST-051: bekleme üst süresi dolunca yoklama durur ve durum timed_out olur', () => {
    assert.equal(FILE_WAIT_LIMIT_MS, 120_000)
    assert.equal(fileProcessing({ status: 'processing' }, null, false), 'processing')
    assert.equal(fileProcessing({ status: 'processing' }, null, true), 'timed_out')
    assert.equal(filePollInterval({ status: 'processing' }, null, true), false)
    // Ağ ve sunucu hatası sürerken de süre dolunca beklemeyi bırakır.
    assert.equal(fileProcessing(undefined, error(503), true), 'timed_out')
    assert.equal(filePollInterval(undefined, new TypeError('ağ'), true), false)
  })

  test('IST-051: süre dolmuş olsa da kesin sonuç korunur (hazır, ret, yetki)', () => {
    assert.equal(fileProcessing({ status: 'ready' }, null, true), 'ready')
    assert.equal(fileProcessing({ status: 'rejected' }, null, true), 'rejected')
    assert.equal(fileProcessing(undefined, error(404, 'not_found'), true), 'rejected')
    assert.equal(fileProcessing(undefined, error(403, 'module_disabled'), true), 'failed')
  })
})

describe('yoklama aralığı ve bekleme saati', () => {
  test('IST-027: aralık her okumada geri çekilir ve üst sınırı geçmez', () => {
    const processing = { status: 'processing' } as const
    const intervals = [0, 1, 2, 3, 4, 5, 6, 10, 50].map((attempt) =>
      filePollInterval(processing, null, false, attempt),
    )
    assert.deepEqual(intervals.slice(0, 6), [1500, 1500, 2250, 3375, 5063, 7594])
    assert.equal(intervals[6], FILE_POLL_MAX_INTERVAL_MS)
    assert.equal(intervals.at(-1), FILE_POLL_MAX_INTERVAL_MS)
    for (let i = 1; i < intervals.length; i += 1)
      assert.ok((intervals[i] as number) >= (intervals[i - 1] as number))
  })

  test('IST-027: üst süre yalnız sekme görünürken işler', () => {
    let clock = startWaitClock(0, true)
    assert.equal(waitRemainingMs(clock, 30_000), 90_000)
    // Sekme 30. saniyede gizlenir; gizliyken geçen 10 dakika sayılmaz.
    clock = pauseWaitClock(clock, 30_000)
    assert.equal(waitRemainingMs(clock, 630_000), 90_000)
    // Görününce kaldığı yerden sürer, 90 saniye sonra dolar.
    clock = resumeWaitClock(clock, 630_000)
    assert.equal(waitRemainingMs(clock, 700_000), 20_000)
    assert.equal(waitRemainingMs(clock, 720_000), 0)
    assert.equal(waitRemainingMs(clock, 900_000), 0)
  })

  test('IST-027: gizli sekmede başlayan bekleme görününce işlemeye başlar; çift olay saati bozmaz', () => {
    let clock = startWaitClock(1_000, false)
    assert.equal(waitRemainingMs(clock, 500_000), FILE_WAIT_LIMIT_MS)
    clock = resumeWaitClock(clock, 500_000)
    assert.equal(resumeWaitClock(clock, 510_000), clock)
    clock = pauseWaitClock(clock, 520_000)
    assert.equal(pauseWaitClock(clock, 530_000), clock)
    assert.equal(waitRemainingMs(clock, 999_000), 100_000)
  })

  test('IST-027: işlenen, süresi dolan ve reddedilen dosya gönderimi kilitler', () => {
    assert.equal(fileBlocksAttach('processing'), true)
    assert.equal(fileBlocksAttach('timed_out'), true)
    assert.equal(fileBlocksAttach('rejected'), true)
    assert.equal(fileBlocksAttach('ready'), false)
    assert.equal(fileBlocksAttach('failed'), false)
  })
})

describe('dosya bağlama hatası alanı', () => {
  test('IST-027: 422 file_not_ready ve file_rejected dosya alanına yazılır, diğerleri sorulur', () => {
    const fieldFor = fileAttachField('fileIds', (e) => (e.code === 'x' ? 'note' : undefined))
    assert.equal(fieldFor(error(422, 'file_not_ready')), 'fileIds')
    assert.equal(fieldFor(error(422, 'file_rejected')), 'fileIds')
    assert.equal(fieldFor(error(422, 'x')), 'note')
    assert.equal(fieldFor(error(409, 'file_already_attached')), undefined)
    assert.equal(fileAttachField('files')(error(422, 'file_rejected')), 'files')
    assert.match(FILE_REJECTED_MESSAGE, /güvenlik taramasından geçmedi/)
  })
})
