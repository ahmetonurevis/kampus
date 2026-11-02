import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  BLOCK_MESSAGES,
  canRerecord,
  canStart,
  clockLabel,
  durationLabel,
  elapsedMs,
  initialRecorderState,
  liveMessage,
  mediaErrorReason,
  phaseRemainingMs,
  pickRecordingMime,
  RECORDING_STOP_MARGIN_MS,
  recorderReducer,
  recordingFileName,
  REJECTED_NOTICE,
  takesLeft,
  TOO_SHORT_NOTICE,
  type RecorderEvent,
  type RecorderState,
  type Take,
} from '../src/pages/tasks/speaking-recorder-model.ts'

// Konuşma kaydı durum makinesi (IST-051; DOM-BEC-002, 040, 050, 054): izin, hazırlık, süre sınırı,
// deneme hakkı, gönderim adımları ve ekran okuyucu metni. Saat sabit `now` ile verilir.

const T0 = 1_000_000
const take = (durationMs = 4000): Take => ({
  blob: new Blob(['ses'], { type: 'audio/webm' }),
  durationMs,
  mimeType: 'audio/webm;codecs=opus',
})

const run = (events: RecorderEvent[], from: RecorderState = initialRecorderState) =>
  events.reduce(recorderReducer, from)

/** İzin verildi, hazırlık yok, kayıt başladı. */
const recording = (remaining = 2, speakingSeconds = 60) =>
  run([
    { type: 'start', remaining },
    { type: 'granted', now: T0, preparationSeconds: 0 },
    { type: 'recorder_started', now: T0, speakingSeconds },
  ])

const recorded = (remaining = 2) =>
  run(
    [
      { type: 'stop', by: 'user' },
      { type: 'recorded', take: take() },
    ],
    recording(remaining),
  )

describe('konuşma kaydı: izin ve hazırlık', () => {
  test('IST-051: kayda başlamak önce mikrofon izni ister', () => {
    const state = run([{ type: 'start', remaining: 1 }])
    assert.equal(state.phase.kind, 'requesting')
    assert.equal(liveMessage(state.phase, T0), 'Mikrofon izni isteniyor.')
  })

  test('IST-051: mikrofon reddedilirse açıklayıcı ileti; izin değişince yeniden denenebilir', () => {
    const state = run([
      { type: 'start', remaining: 1 },
      { type: 'blocked', reason: 'denied' },
    ])
    assert.deepEqual(state.phase, { kind: 'blocked', reason: 'denied' })
    assert.match(liveMessage(state.phase, T0), /Mikrofon izni verilmedi/)
    assert.equal(canStart(state, 1), true)
    assert.equal(run([{ type: 'start', remaining: 1 }], state).phase.kind, 'requesting')
  })

  test('IST-051: desteklenmeyen tarayıcı ve rıza yokluğu yeniden denemeyle açılmaz', () => {
    for (const reason of ['unsupported', 'consent'] as const) {
      const state: RecorderState = { phase: { kind: 'blocked', reason }, discarded: 0 }
      assert.equal(canStart(state, 3), false)
      assert.equal(run([{ type: 'start', remaining: 3 }], state), state)
    }
  })

  test('DOM-BEC-002: hazırlık süresi verildiyse geri sayım, bitince kayıt başlar', () => {
    const preparing = run([
      { type: 'start', remaining: 1 },
      { type: 'granted', now: T0, preparationSeconds: 30 },
    ])
    assert.deepEqual(preparing.phase, { kind: 'preparing', endsAt: T0 + 30_000 })
    assert.equal(phaseRemainingMs(preparing.phase, T0 + 10_000), 20_000)
    assert.equal(liveMessage(preparing.phase, T0 + 10_000), 'Hazırlık süresi başladı.')
    assert.equal(liveMessage(preparing.phase, T0 + 26_000), 'Kayıt birazdan başlıyor.')
    assert.equal(run([{ type: 'preparation_over' }], preparing).phase.kind, 'starting')
  })

  test('DOM-BEC-002: hazırlık süresi 0 ise doğrudan kayda geçilir', () => {
    const state = run([
      { type: 'start', remaining: 1 },
      { type: 'granted', now: T0, preparationSeconds: 0 },
    ])
    assert.equal(state.phase.kind, 'starting')
  })
})

describe('konuşma kaydı: süre sınırı', () => {
  test('IST-051: kayıt süre sınırından biraz önce durmak üzere planlanır (sunucu toleranssız ölçer)', () => {
    const state = recording(1, 60)
    assert.equal(state.phase.kind, 'recording')
    if (state.phase.kind !== 'recording') return
    assert.equal(state.phase.stopAt, T0 + 60_000 - RECORDING_STOP_MARGIN_MS)
    assert.equal(elapsedMs(state.phase, T0 + 12_400), 12_400)
    assert.equal(liveMessage(state.phase, T0 + 1000), 'Kayıt sürüyor.')
    assert.equal(liveMessage(state.phase, T0 + 51_000), 'Son 10 saniye.')
  })

  test('IST-051: sınırda kendiliğinden duran kayıt bunu söyler; elle durdurulan söylemez', () => {
    const auto = run(
      [
        { type: 'stop', by: 'limit' },
        { type: 'recorded', take: take() },
      ],
      recording(),
    )
    assert.equal(auto.phase.kind === 'recorded' && auto.phase.autoStopped, true)
    assert.match(liveMessage(auto.phase, T0), /Süre sınırına ulaşıldı/)
    const manual = recorded()
    assert.equal(manual.phase.kind === 'recorded' && manual.phase.autoStopped, false)
    assert.match(liveMessage(manual.phase, T0), /^Kayıt tamamlandı/)
  })

  test('IST-051: durdurma bir kez işlenir; ikinci istek ilk nedeni değiştirmez', () => {
    const state = run(
      [
        { type: 'stop', by: 'user' },
        { type: 'stop', by: 'limit' },
      ],
      recording(),
    )
    assert.equal(state.phase.kind === 'recording' && state.phase.stop, 'user')
    assert.equal(liveMessage(state.phase, T0), 'Kayıt durduruluyor.')
  })

  test('DOM-BEC-054: 1 saniyeden kısa kayıt alınmaz ve hak düşürmez', () => {
    const state = run(
      [
        { type: 'stop', by: 'user' },
        { type: 'recorded', take: take(600) },
      ],
      recording(1),
    )
    assert.deepEqual(state.phase, { kind: 'idle', notice: TOO_SHORT_NOTICE })
    assert.equal(takesLeft(state, 1), 1)
    assert.equal(canStart(state, 1), true)
  })

  test('IST-051: kayıt sırasında mikrofon kesilirse kayıt düşer, yeniden denenebilir', () => {
    const state = run([{ type: 'blocked', reason: 'failed' }], recording(1))
    assert.deepEqual(state.phase, { kind: 'blocked', reason: 'failed' })
    assert.equal(canStart(state, 1), true)
  })
})

describe('konuşma kaydı: deneme hakkı', () => {
  test('IST-051: tek hakta yeniden kayıt yoktur; elde tutulan kayıt hakkı kullanır', () => {
    const state = recorded(1)
    assert.equal(takesLeft(state, 1), 0)
    assert.equal(canRerecord(state, 1), false)
    assert.equal(run([{ type: 'rerecord', remaining: 1 }], state), state)
  })

  test('IST-051: atılan kayıt bir hak düşürür; hak bitince yeniden kayıt kapanır', () => {
    const first = recorded(3)
    assert.equal(canRerecord(first, 3), true)
    const second = run(
      [
        { type: 'rerecord', remaining: 3 },
        { type: 'granted', now: T0, preparationSeconds: 0 },
        { type: 'recorder_started', now: T0, speakingSeconds: 60 },
        { type: 'stop', by: 'user' },
        { type: 'recorded', take: take() },
      ],
      first,
    )
    assert.equal(second.discarded, 1)
    assert.equal(second.phase.kind, 'recorded')
    assert.equal(takesLeft(second, 3), 1)
    const third = run(
      [
        { type: 'rerecord', remaining: 3 },
        { type: 'granted', now: T0, preparationSeconds: 0 },
        { type: 'recorder_started', now: T0, speakingSeconds: 60 },
        { type: 'stop', by: 'user' },
        { type: 'recorded', take: take() },
      ],
      second,
    )
    assert.equal(third.discarded, 2)
    assert.equal(canRerecord(third, 3), false)
  })

  test('IST-051: sunucuda hak kalmadıysa kayıt başlamaz', () => {
    assert.equal(canStart(initialRecorderState, 0), false)
    assert.equal(run([{ type: 'start', remaining: 0 }]), initialRecorderState)
  })

  test('DOM-BEC-040: teslimden sonra yeni kayıt sunucunun güncel hakkıyla açılır', () => {
    const sent = run(
      [
        { type: 'send' },
        { type: 'uploaded', fileId: 'f1' },
        { type: 'file_ready' },
        { type: 'submitted' },
      ],
      recorded(2),
    )
    assert.equal(sent.phase.kind, 'submitted')
    assert.equal(liveMessage(sent.phase, T0), 'Kaydınız teslim edildi.')
    const again = run([{ type: 'reset' }], sent)
    assert.deepEqual(again.phase, { kind: 'idle', notice: null })
    // Sunucu artık 1 hak bildirir: yeni kayıt açık; 0 bildirirse kapalı.
    assert.equal(canStart(again, 1), true)
    assert.equal(canStart(again, 0), false)
  })
})

describe('konuşma kaydı: gönderim', () => {
  test('IST-051: gönderim yükleme → işlenme → teslim adımlarından geçer', () => {
    const uploading = run([{ type: 'send' }], recorded())
    assert.equal(uploading.phase.kind === 'sending' && uploading.phase.step, 'uploading')
    assert.equal(liveMessage(uploading.phase, T0), 'Kaydınız yükleniyor…')
    const processing = run([{ type: 'uploaded', fileId: 'f1' }], uploading)
    assert.equal(processing.phase.kind === 'sending' && processing.phase.fileId, 'f1')
    assert.equal(liveMessage(processing.phase, T0), 'Kaydınız işleniyor…')
    // Dosya hazır olmadan teslim adımına geçilmez; hazır olunca geçilir.
    assert.equal(run([{ type: 'file_ready' }], uploading), uploading)
    const submitting = run([{ type: 'file_ready' }], processing)
    assert.equal(submitting.phase.kind === 'sending' && submitting.phase.step, 'submitting')
  })

  test('IST-051: yükleme kesilirse kayıt kaybolmaz; yeniden deneme yeniden yükler', () => {
    const failed = run(
      [{ type: 'send' }, { type: 'send_failed', message: 'Bağlantı kurulamadı.' }],
      recorded(),
    )
    assert.equal(failed.phase.kind, 'send_failed')
    assert.ok(failed.phase.kind === 'send_failed' && failed.phase.take.blob)
    assert.match(liveMessage(failed.phase, T0), /Kaydınız bu sayfada duruyor/)
    const retry = run([{ type: 'send' }], failed)
    assert.equal(retry.phase.kind === 'sending' && retry.phase.step, 'uploading')
  })

  test('IST-051: yüklenmiş kaydın teslimi başarısızsa yeniden deneme yeniden yüklemez', () => {
    const failed = run(
      [
        { type: 'send' },
        { type: 'uploaded', fileId: 'f1' },
        { type: 'file_ready' },
        { type: 'send_failed', message: 'Sunucuya ulaşılamadı.' },
      ],
      recorded(),
    )
    const retry = run([{ type: 'send' }], failed)
    assert.equal(retry.phase.kind === 'sending' && retry.phase.step, 'processing')
    assert.equal(retry.phase.kind === 'sending' && retry.phase.fileId, 'f1')
  })

  test('DOM-BEC-054: sunucunun reddettiği kayıt hak düşürmez, Türkçe ileti gösterilir', () => {
    const state = run(
      [{ type: 'send' }, { type: 'uploaded', fileId: 'f1' }, { type: 'file_rejected' }],
      recorded(1),
    )
    assert.deepEqual(state.phase, { kind: 'idle', notice: REJECTED_NOTICE })
    assert.doesNotMatch(REJECTED_NOTICE, /media_|ffmpeg|404/)
    assert.equal(canStart(state, 1), true)
    const tooLong = run(
      [
        { type: 'send' },
        { type: 'uploaded', fileId: 'f1' },
        { type: 'file_ready' },
        { type: 'recording_rejected', message: 'Kayıt en fazla 60 saniye olabilir.' },
      ],
      recorded(1),
    )
    assert.equal(
      tooLong.phase.kind === 'idle' && tooLong.phase.notice,
      'Kayıt en fazla 60 saniye olabilir. Deneme hakkınızdan düşülmedi.',
    )
  })

  test('DOM-BEC-050: rıza gönderim sırasında geri çekilirse kayıt durur ve yüz yüze yol söylenir', () => {
    const state = run([{ type: 'send' }, { type: 'blocked', reason: 'consent' }], recorded())
    assert.deepEqual(state.phase, { kind: 'blocked', reason: 'consent' })
    assert.match(BLOCK_MESSAGES.consent, /yüz yüze/)
    assert.equal(canStart(state, 3), false)
  })
})

describe('konuşma kaydı: yardımcılar', () => {
  test('IST-051: saat ve süre metinleri', () => {
    assert.equal(clockLabel(0), '00:00')
    assert.equal(clockLabel(59_001), '01:00')
    assert.equal(clockLabel(59_999, 'down'), '00:59')
    assert.equal(clockLabel(180_000), '03:00')
    assert.equal(durationLabel(45), '45 saniye')
    assert.equal(durationLabel(180), '3 dakika')
    assert.equal(durationLabel(90), '1 dakika 30 saniye')
    assert.equal(phaseRemainingMs({ kind: 'idle', notice: null }, T0), null)
  })

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
