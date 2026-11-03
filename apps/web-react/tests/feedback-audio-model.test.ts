import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { FILE_PURPOSES } from '@kampus/school-core/content/taxonomy.ts'
import {
  FEEDBACK_AUDIO_LIMITS,
  FEEDBACK_AUDIO_TAKES,
  FEEDBACK_BLOCK_MESSAGES,
  NO_FEEDBACK_AUDIO,
  feedbackAudioBody,
  feedbackAudioValue,
  feedbackClock,
  feedbackLiveMessage,
  processingOutcome,
} from '../src/pages/tasks/feedback-audio-model.ts'
import {
  REJECTED_NOTICE,
  TOO_SHORT_NOTICE,
  initialRecorderState,
  recorderReducer,
  type RecorderEvent,
  type RecorderState,
  type Take,
} from '../src/pages/tasks/speaking-recorder-model.ts'

// Öğretmenin sesli geri bildirimi (IST-052; DOM-BEC-056): konuşma kayıt makinesi hazırlıksız ve
// hak sınırsız kullanılır; formun değeri evreden türetilir, iletiler öğretmene göredir.

const T0 = 1_000_000
const take: Take = {
  blob: new Blob(['ses'], { type: 'audio/webm' }),
  durationMs: 12_000,
  mimeType: 'audio/webm;codecs=opus',
}
const run = (events: RecorderEvent[], from: RecorderState = initialRecorderState) =>
  events.reduce(recorderReducer, from)

const recorded = () =>
  run([
    { type: 'start', remaining: FEEDBACK_AUDIO_TAKES },
    { type: 'granted', now: T0, preparationSeconds: FEEDBACK_AUDIO_LIMITS.preparationSeconds },
    { type: 'recorder_started', now: T0, speakingSeconds: FEEDBACK_AUDIO_LIMITS.speakingSeconds },
    { type: 'stop', by: 'user' },
    { type: 'recorded', take },
  ])

describe('sesli geri bildirim modeli', () => {
  test('DOM-BEC-056: sınır core `FILE_PURPOSES.feedback_audio`dan gelir, hazırlık yoktur; izin hemen kayda geçer', () => {
    assert.equal(
      FEEDBACK_AUDIO_LIMITS.speakingSeconds,
      FILE_PURPOSES.feedback_audio.maxDurationSeconds,
    )
    assert.equal(FEEDBACK_AUDIO_LIMITS.preparationSeconds, 0)
    const granted = run([
      { type: 'start', remaining: FEEDBACK_AUDIO_TAKES },
      { type: 'granted', now: T0, preparationSeconds: 0 },
    ])
    assert.equal(granted.phase.kind, 'starting')
    assert.equal(feedbackClock(42_000), '00:42 / 03:00')
  })

  test('DOM-BEC-056: form değeri evreden türer; yükleme ve işlenme sürerken bekler, işlenen dosya hazırdır, silinen ses gövdeye girmez', () => {
    assert.deepEqual(feedbackAudioValue(initialRecorderState.phase), NO_FEEDBACK_AUDIO)
    const afterRecording = recorded()
    assert.deepEqual(feedbackAudioValue(afterRecording.phase), { kind: 'pending' })
    const uploading = run([{ type: 'send' }], afterRecording)
    assert.deepEqual(feedbackAudioValue(uploading.phase), { kind: 'pending' })
    const processing = run([{ type: 'uploaded', fileId: 'f-1' }], uploading)
    assert.deepEqual(feedbackAudioValue(processing.phase), { kind: 'pending' })
    const ready = run([{ type: 'file_ready' }], processing)
    assert.deepEqual(feedbackAudioValue(ready.phase), { kind: 'ready', fileId: 'f-1' })
    assert.deepEqual(feedbackAudioBody(feedbackAudioValue(ready.phase)), {
      feedbackAudioFileId: 'f-1',
    })
    assert.deepEqual(feedbackAudioBody({ kind: 'pending' }), {})
    assert.deepEqual(feedbackAudioBody(NO_FEEDBACK_AUDIO), {})
    const failed = run([{ type: 'send_failed', message: 'Yüklenemedi.' }], processing)
    assert.deepEqual(feedbackAudioValue(failed.phase), { kind: 'pending' })
  })

  test('DOM-BEC-056: mikrofon izni reddi ses yok sayılır; puan yazılı geri bildirimle kaydedilebilir ve ileti Türkçedir', () => {
    const denied = run([
      { type: 'start', remaining: FEEDBACK_AUDIO_TAKES },
      { type: 'blocked', reason: 'denied' },
    ])
    assert.deepEqual(feedbackAudioValue(denied.phase), NO_FEEDBACK_AUDIO)
    assert.equal(feedbackLiveMessage(denied.phase), FEEDBACK_BLOCK_MESSAGES.denied)
    assert.match(FEEDBACK_BLOCK_MESSAGES.denied, /Mikrofon izni verilmedi; yazılı geri bildirim/)
    assert.match(FEEDBACK_BLOCK_MESSAGES.unsupported, /yazılı geri bildirimle puanlayabilirsiniz/)
  })

  test('DOM-BEC-056: hak sınırsızdır; reddedilen ve kısa kayıt öğretmene göre anlatılır, deneme hakkından söz edilmez', () => {
    for (let index = 0; index < 5; index += 1) {
      const again = run([{ type: 'start', remaining: FEEDBACK_AUDIO_TAKES }], {
        ...initialRecorderState,
        discarded: index * 100,
      })
      assert.equal(again.phase.kind, 'requesting')
    }
    const short = feedbackLiveMessage({ kind: 'idle', notice: TOO_SHORT_NOTICE })
    const rejected = feedbackLiveMessage({ kind: 'idle', notice: REJECTED_NOTICE })
    for (const text of [short, rejected]) assert.equal(/deneme hakkı/i.test(text), false)
    assert.match(rejected, /3 dakika sınırını/)
    assert.equal(feedbackLiveMessage(initialRecorderState.phase), '')
  })

  test('DOM-BEC-056, ADR 0003 karar 10: işlenme sonucu; hazır ve tarayıcısız dosya eklenir, ret yeniden kayıt, bekleme ve hata yeniden deneme ister', () => {
    assert.equal(processingOutcome('processing'), null)
    assert.equal(processingOutcome('ready'), 'ready')
    assert.equal(processingOutcome('pending'), 'ready')
    assert.equal(processingOutcome('rejected'), 'rejected')
    assert.equal(processingOutcome('missing'), 'rejected')
    assert.equal(processingOutcome('timed_out'), 'still_processing')
    assert.equal(processingOutcome('failed'), 'retry')
  })

  test('DOM-BEC-056: canlı bölge evreyi söyler; hazır ses puanla birlikte kaydedileceğini duyurur', () => {
    const sending = run([{ type: 'send' }], recorded())
    assert.equal(feedbackLiveMessage(sending.phase), 'Sesli geri bildirim yükleniyor…')
    const processing = run([{ type: 'uploaded', fileId: 'f-1' }], sending)
    assert.equal(feedbackLiveMessage(processing.phase), 'Sesli geri bildirim işleniyor…')
    const ready = run([{ type: 'file_ready' }], processing)
    assert.match(feedbackLiveMessage(ready.phase), /puanla birlikte kaydedilecek/)
    const failed = run([{ type: 'send_failed', message: 'Yüklenemedi.' }], processing)
    assert.match(feedbackLiveMessage(failed.phase), /^Yüklenemedi\. Ses bu pencerede duruyor/)
  })
})
