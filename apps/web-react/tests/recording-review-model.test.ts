import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ApiError } from '@kampus/api-client/errors.ts'
import {
  DEFAULT_PLAYBACK_RATE,
  PLAYBACK_RATES,
  gradedVersionNote,
  isSpeakingSubmission,
  parsePlaybackRate,
  playbackRateLabel,
  recordingOpenError,
  recordingTitle,
  recordingView,
  versionRecording,
  type SubmissionFile,
} from '../src/pages/tasks/recording-review-model.ts'

const file = (overrides: Partial<SubmissionFile> = {}): SubmissionFile => ({
  id: 'f-1',
  purpose: 'speaking_recording',
  contentType: 'audio/mp4',
  byteSize: 1200,
  durationMs: 65_400,
  status: 'ready',
  ...overrides,
})

describe('konuşma değerlendirmesi: kaydın dinlenmesi', () => {
  test('IST-052: oynatma hızları sabittir, Türkçe ondalıkla yazılır; bilinmeyen değer varsayılana döner', () => {
    assert.deepEqual([...PLAYBACK_RATES], [0.75, 1, 1.25, 1.5])
    assert.equal(DEFAULT_PLAYBACK_RATE, 1)
    assert.equal(playbackRateLabel(0.75), '0,75×')
    assert.equal(playbackRateLabel(1), '1×')
    assert.equal(parsePlaybackRate('1.25'), 1.25)
    assert.equal(parsePlaybackRate('3'), 1)
    assert.equal(parsePlaybackRate('abc'), 1)
  })

  test('IST-052, DOM-BEC-053: sürümün kaydı yalnız konuşma kaydı amacındaki dosyadır; el yazısı ve metin sürümünde yok', () => {
    const recording = file()
    assert.equal(versionRecording({ files: [recording] }), recording)
    assert.equal(versionRecording({ files: [file({ purpose: 'submission' })] }), null)
    assert.equal(versionRecording({ files: [] }), null)
    assert.equal(isSpeakingSubmission([{ files: [] }, { files: [recording] }]), true)
    assert.equal(isSpeakingSubmission([{ files: [file({ purpose: 'submission' })] }]), false)
    assert.equal(isSpeakingSubmission([]), false)
  })

  test('DOM-BEC-052, DOM-BEC-054: hazır kayıt süresiyle dinlenir; işlenen kayıt bekletilir; imha edilen kaydın süresi ve puanın korunduğu yazılır', () => {
    assert.deepEqual(recordingView(file()), { kind: 'ready', duration: '01:05' })
    assert.deepEqual(recordingView(file({ durationMs: null })), { kind: 'ready', duration: null })
    assert.deepEqual(recordingView(file({ status: 'processing', durationMs: null })), {
      kind: 'unavailable',
      message: 'Kayıt işleniyor; birazdan dinlenebilir.',
    })
    assert.deepEqual(recordingView(file({ status: 'deleted' })), {
      kind: 'unavailable',
      message:
        'Kayıt saklama süresi dolduğu için silindi (süresi 01:05); puan ve geri bildirim korunur.',
    })
    assert.deepEqual(recordingView(file({ status: 'deleted', durationMs: null })), {
      kind: 'unavailable',
      message: 'Kayıt saklama süresi dolduğu için silindi; puan ve geri bildirim korunur.',
    })
  })

  test('IST-052: oynatıcının adı kitleye ve sürüme göredir', () => {
    assert.equal(recordingTitle('staff', 2), 'Sürüm 2 · Öğrencinin kaydı')
    assert.equal(recordingTitle('learner', 1), 'Sürüm 1 · Kaydınız')
    assert.equal(recordingTitle('parent', 3), 'Sürüm 3 · Çocuğunuzun kaydı')
  })

  test('DOM-BEC-053: erişilemeyen kayıt (404/403) varlığını sızdırmadan "erişilemiyor" der; diğer hata geçicidir', () => {
    const notFound = new ApiError({ status: 404, code: 'not_found', message: 'Bulunamadı.' })
    const forbidden = new ApiError({ status: 403, code: 'forbidden', message: 'Yetki yok.' })
    const server = new ApiError({ status: 500, code: 'internal', message: 'Hata.' })
    assert.equal(recordingOpenError(notFound), 'Bu kayda erişilemiyor.')
    assert.equal(recordingOpenError(forbidden), 'Bu kayda erişilemiyor.')
    assert.equal(recordingOpenError(server), 'Kayıt açılamadı. Biraz sonra yeniden deneyin.')
    assert.equal(
      recordingOpenError(new TypeError('ağ')),
      'Kayıt açılamadı. Biraz sonra yeniden deneyin.',
    )
  })

  test('DOM-BEC-021, IST-052: birden çok denemede yalnız son gönderilen kaydın puanlandığı yazılır; tek denemede not yok', () => {
    assert.equal(gradedVersionNote([{ number: 1 }]), null)
    assert.equal(gradedVersionNote([]), null)
    assert.equal(
      gradedVersionNote([{ number: 1 }, { number: 3 }, { number: 2 }]),
      'Yalnız son gönderilen kayıt (Sürüm 3) puanlanır; önceki kayıtlar karşılaştırma için dinlenebilir.',
    )
  })
})
