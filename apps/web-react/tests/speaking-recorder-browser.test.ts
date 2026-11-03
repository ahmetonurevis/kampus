import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  mediaErrorReason,
  pickRecordingMime,
  recordingFileName,
} from '../src/pages/tasks/speaking-recorder-model.ts'

describe('konuşma kaydı tarayıcı yardımcıları', () => {
  test('DOM-BEC-054: kayıt biçimi sunucunun kabul ettiği türlerden seçilir; uzantı tutarlıdır', () => {
    assert.equal(
      pickRecordingMime(() => true),
      'audio/webm;codecs=opus',
    )
    assert.equal(
      pickRecordingMime((type) => type.startsWith('audio/mp4')),
      'audio/mp4;codecs=mp4a.40.2',
    )
    assert.equal(
      pickRecordingMime(() => false),
      null,
    )
    assert.equal(recordingFileName('audio/webm;codecs=opus'), 'konusma-kaydi.webm')
    assert.equal(recordingFileName('audio/mp4'), 'konusma-kaydi.m4a')
    assert.equal(recordingFileName('audio/mpeg'), 'konusma-kaydi.mp3')
  })

  test('IST-051: mikrofon hataları nedenlere ayrılır', () => {
    const named = (name: string) => Object.assign(new Error('x'), { name })
    assert.equal(mediaErrorReason(named('NotAllowedError')), 'denied')
    assert.equal(mediaErrorReason(new DOMException('x', 'NotAllowedError')), 'denied')
    assert.equal(mediaErrorReason(named('NotFoundError')), 'no_device')
    assert.equal(mediaErrorReason(named('NotReadableError')), 'failed')
    assert.equal(mediaErrorReason('bilinmeyen'), 'failed')
  })
})
