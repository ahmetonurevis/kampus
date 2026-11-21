import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../packages/api-client/src/errors.ts'
import type { KampusClient } from '../packages/api-client/src/client.ts'
import { runRequest } from '../packages/react-shared/src/api-result.ts'
import { createCommandSession, runCommand } from '../packages/react-shared/src/commands.ts'
import {
  initialRecorderState,
  recorderReducer,
} from '../packages/react-shared/src/speaking-recorder-model.ts'
import type { TaskAssignmentLearner } from '../packages/react-shared/src/use-task-assignments.ts'
import { submitTaskSubmissionCommand } from '../packages/react-shared/src/use-task-submissions.ts'
import {
  FAILED_UPLOAD_TEXT,
  PHONE_RECORDING_MIME,
  SPEAKING_RECORDING_PURPOSE,
  STILL_PROCESSING_TEXT,
  canRecordOnPhone,
  leaveGuard,
  staleRecordingUri,
  classifySpeakingError,
  phoneTake,
  recordingFileName,
  recordingPickedFile,
  settleOutcome,
  speakingFailure,
  speakingLimits,
  speakingRemaining,
  speakingSettings,
  speakingSubmitInput,
  speakingUploadInput,
  PHONE_BLOCK_MESSAGES,
  permissionBlock,
  phoneLiveMessage,
  recordingClockSpoken,
  type PhoneRecorderEvent,
} from '../apps/mobile/src/api/student-speaking-task.ts'

// Mobil öğrenci konuşma görevi (OG-064; IST-051; DOM-BEC-040, 050, 054): telefonda kaydedilebilirlik,
// sınırlar, yükleme ve teslim istekleri, hata sınıfları ve Türkçe metinleri. Ses cihazdan çıkmaz.

const apiError = (status: number, code: string, message = 'Sunucu mesajı') =>
  new ApiError({ status, code, message })
const networkError = () => apiError(0, 'network_error')

type Submission = NonNullable<TaskAssignmentLearner['submission']>
const audio: Submission = {
  submissionKind: 'audio',
  maxVersions: 3,
  speakingAttempts: 2,
  preparationSeconds: 15,
  speakingSeconds: 90,
}
const forAssignment = (submission: Submission | null) => ({ submission })

describe('OG-064: görevin telefonda kaydedilebilirliği ve sınırlar', () => {
  test('yalnız ses teslimi bekleyen görev kaydedilir; yazma, dosya ve teslimsiz görev değil', () => {
    assert.equal(canRecordOnPhone(forAssignment(audio)), true)
    assert.equal(
      canRecordOnPhone(
        forAssignment({ submissionKind: 'text', maxVersions: 3, minWords: null, maxWords: null }),
      ),
      false,
    )
    assert.equal(canRecordOnPhone(forAssignment({ submissionKind: 'file', maxVersions: 3 })), false)
    assert.equal(canRecordOnPhone(forAssignment(null)), false)
    assert.equal(speakingSettings(forAssignment(null)), null)
  })

  test('süreler görev ayarından gelir', () => {
    const settings = speakingSettings(forAssignment(audio))
    assert.ok(settings)
    assert.deepEqual(speakingLimits(settings), { preparationSeconds: 15, speakingSeconds: 90 })
  })

  test('kalan hak sunucudan; ayrıntı yoksa en düşük sınırdan gönderilen sayı düşülür', () => {
    const settings = speakingSettings(forAssignment(audio))!
    assert.equal(speakingRemaining(settings, 1, 0), 1)
    assert.equal(speakingRemaining(settings, 0, 0), 0)
    assert.equal(speakingRemaining(settings, null, 0), 2)
    assert.equal(speakingRemaining(settings, undefined, 1), 1)
    assert.equal(speakingRemaining(settings, undefined, 5), 0)
    // Hak, sürüm sınırından büyük olamaz.
    assert.equal(
      speakingRemaining({ ...settings, maxVersions: 1, speakingAttempts: 3 }, null, 0),
      1,
    )
  })
})

describe('OG-064: kayıt dosyası ve istekler', () => {
  const take = phoneTake('file:///cache/Audio/rec.m4a', 12_000)

  test('kayıt speaking_recording amacıyla mevcut yükleyiciye verilir', () => {
    const controller = new AbortController()
    const input = speakingUploadInput(take, controller.signal)
    assert.equal(input.purpose, SPEAKING_RECORDING_PURPOSE)
    assert.equal(input.signal, controller.signal)
    assert.deepEqual(input.file, {
      uri: 'file:///cache/Audio/rec.m4a',
      name: 'konusma-kaydi.m4a',
      size: null,
      mimeType: PHONE_RECORDING_MIME,
    })
    assert.equal('signal' in speakingUploadInput(take), false)
  })

  test('dosya adı uzantısı içerikle tutarlıdır', () => {
    assert.equal(recordingFileName('audio/mp4'), 'konusma-kaydi.m4a')
    assert.equal(recordingFileName('audio/x-m4a'), 'konusma-kaydi.m4a')
    assert.equal(recordingFileName('audio/mpeg'), 'konusma-kaydi.mp3')
    assert.equal(recordingFileName('audio/webm;codecs=opus'), 'konusma-kaydi.webm')
    assert.equal(recordingPickedFile(phoneTake('x', 1000, 'audio/webm')).name, 'konusma-kaydi.webm')
  })

  test('teslim gövdesi ses sürümü ve kayıt dosyası kimliğidir', () => {
    assert.deepEqual(speakingSubmitInput('a1', 'f1'), {
      assignmentId: 'a1',
      submission: { submissionKind: 'audio', recordingFileId: 'f1' },
    })
  })
})

describe('OG-064: kayıt işlenme sonucu', () => {
  test('hazır kayıt teslim edilir, işlenen beklenir, reddedilen hak düşürmez', () => {
    assert.equal(settleOutcome('processing'), null)
    assert.equal(settleOutcome('ready'), 'submit')
    assert.equal(settleOutcome('pending'), 'submit')
    assert.deepEqual(settleOutcome('rejected'), { type: 'file_rejected' })
    assert.deepEqual(settleOutcome('missing'), { type: 'file_rejected' })
    assert.deepEqual(settleOutcome('failed'), { type: 'send_failed', message: FAILED_UPLOAD_TEXT })
    assert.deepEqual(settleOutcome('timed_out'), {
      type: 'send_failed',
      message: STILL_PROCESSING_TEXT,
    })
  })
})

describe('OG-064: hata sınıfları ve Türkçe mesajlar', () => {
  test('rıza yok: kayıt kapanır, yeniden denenmez', () => {
    const failure = speakingFailure(apiError(403, 'consent_required'))
    assert.equal(failure.kind, 'consent')
    assert.deepEqual(failure.event, { type: 'blocked', reason: 'consent' })
    assert.match(failure.message, /onay bulunmuyor/)
    // Yükleme adımında da aynı sınıf.
    assert.equal(classifySpeakingError(apiError(403, 'consent_required'), 'upload'), 'consent')
  })

  test('kayıt reddi (boş, süre aşımı, kullanılamıyor) hak düşürmez', () => {
    const tooLong = speakingFailure(
      apiError(422, 'recording_too_long', 'Kayıt süre sınırını aşıyor.'),
    )
    assert.equal(tooLong.kind, 'recording')
    assert.equal(tooLong.message, 'Kayıt süre sınırını aşıyor.')
    assert.deepEqual(tooLong.event, {
      type: 'recording_rejected',
      message: 'Kayıt süre sınırını aşıyor.',
    })
    assert.equal(speakingFailure(apiError(422, 'recording_empty')).kind, 'recording')
    assert.equal(speakingFailure(apiError(422, 'file_unavailable')).kind, 'recording')
    assert.match(speakingFailure(apiError(422, 'file_unavailable')).message, /yeniden kaydedin/)
  })

  test('yüklemede 413 ve 422 kayıt reddidir; teslimde aynı kodlar genel hata', () => {
    assert.equal(classifySpeakingError(apiError(413, 'payload_too_large'), 'upload'), 'recording')
    assert.equal(classifySpeakingError(apiError(422, 'unknown'), 'upload'), 'recording')
    assert.equal(classifySpeakingError(apiError(422, 'unknown'), 'submit'), 'other')
    assert.equal(
      speakingFailure(apiError(413, 'file_too_large'), 'upload').message.includes('çok büyük'),
      true,
    )
  })

  test('kurum dosya kotası dolu: kayıt reddi değil, kurum sorunu', () => {
    const failure = speakingFailure(apiError(422, 'storage_quota_exceeded'), 'upload')
    assert.equal(failure.kind, 'other')
    assert.equal(failure.event.type, 'send_failed')
    assert.match(failure.message, /depolama alanı/)
  })

  test('pencere kapatma: gönderilmemiş kayıt sorulur, gönderim sürerken kapatılamaz', () => {
    const take = phoneTake('file:///cache/Audio/rec.m4a', 12_000)
    const sending = { kind: 'sending', take, step: 'uploading', fileId: null } as const
    assert.equal(leaveGuard(initialRecorderState.phase), 'free')
    assert.equal(leaveGuard({ kind: 'recording', stop: null } as never), 'unsent')
    assert.equal(leaveGuard({ kind: 'recorded', take, autoStopped: false }), 'unsent')
    assert.equal(leaveGuard({ kind: 'send_failed', take, fileId: null, message: 'x' }), 'unsent')
    assert.equal(leaveGuard(sending), 'sending')
    assert.equal(leaveGuard({ kind: 'submitted' }), 'free')
  })

  test('atılan kaydın dosyası silinir: yeniden kayıt, bırakma; aynı kayıt korunur', () => {
    assert.equal(staleRecordingUri(null, 'a'), null)
    assert.equal(staleRecordingUri('a', 'a'), null)
    assert.equal(staleRecordingUri('a', 'b'), 'a')
    assert.equal(staleRecordingUri('a', null), 'a')
    assert.equal(staleRecordingUri(null, null), null)
  })

  test('deneme hakkı doldu ve süre doldu sunucu mesajıyla, yeniden denenmez', () => {
    const limit = speakingFailure(
      apiError(422, 'version_limit_reached', 'Konuşma deneme hakkınız doldu (2/2).'),
    )
    assert.equal(limit.kind, 'limit')
    assert.equal(limit.message, 'Konuşma deneme hakkınız doldu (2/2).')
    const closed = speakingFailure(apiError(422, 'submission_closed'))
    assert.equal(closed.kind, 'closed')
    assert.equal(closed.message, 'Bu görevin teslim süresi doldu.')
    assert.equal(speakingFailure(apiError(409, 'submission_locked')).kind, 'closed')
  })

  test('mükerrer teslim: kayıt zaten bağlı, teslim kaybolmadı', () => {
    const failure = speakingFailure(apiError(409, 'file_already_attached'))
    assert.equal(failure.kind, 'duplicate')
    assert.equal(failure.message, 'Bu kayıt zaten gönderildi; sayfayı yenileyin.')
  })

  test('kayıt henüz işleniyor: aynı kayıtla yeniden denenir', () => {
    const failure = speakingFailure(apiError(422, 'file_not_ready'))
    assert.equal(failure.kind, 'processing')
    assert.match(failure.message, /işleniyor/)
  })

  test('ağ ve sunucu hatası belirsizdir: teknik ayrıntı gösterilmez, yeniden denenir', () => {
    for (const error of [networkError(), apiError(503, 'unavailable', 'upstream connect error')]) {
      const failure = speakingFailure(error)
      assert.equal(failure.kind, 'network')
      assert.equal(failure.message, FAILED_UPLOAD_TEXT)
    }
    assert.equal(classifySpeakingError(apiError(409, 'idempotency_in_progress')), 'network')
  })

  test('bilinmeyen kod sunucunun Türkçe mesajıyla gösterilir', () => {
    const failure = speakingFailure(apiError(400, 'bad_request', 'Gövde geçersiz.'))
    assert.equal(failure.kind, 'other')
    assert.equal(failure.message, 'Gövde geçersiz.')
  })
})

describe('OG-064: teslim akışı (kayıt makinesi + gerçek komut)', () => {
  type Step = 'ok' | ApiError

  function setup(script: Step[]) {
    const bodies: unknown[] = []
    const keys: Array<string | undefined> = []
    const client = {
      POST: async (
        _path: string,
        init: { params: { header: Record<string, string> }; body: unknown },
      ): Promise<unknown> => {
        keys.push(init.params.header['idempotency-key'])
        bodies.push(init.body)
        const step = script.shift() ?? 'ok'
        if (step instanceof ApiError) throw step
        return { data: { data: {} }, response: new Response(null, { status: 201 }) }
      },
    } as unknown as KampusClient
    const session = createCommandSession()
    const send = () =>
      runCommand(
        session,
        {
          execute: (input, headers) =>
            runRequest(() => submitTaskSubmissionCommand.request(client, input, headers)),
          messages: submitTaskSubmissionCommand.messages,
          exclusive: true,
          refresh: async () => {},
        },
        speakingSubmitInput('a1', 'f1'),
      )
    return { bodies, keys, send }
  }

  const reduce = (events: PhoneRecorderEvent[]) =>
    events.reduce(recorderReducer<{ uri: string }>, initialRecorderState)

  const toSending = () =>
    reduce([
      { type: 'start', remaining: 2 },
      { type: 'granted', now: 0, preparationSeconds: 0 },
      { type: 'recorder_started', now: 0, speakingSeconds: 90 },
      { type: 'stop', by: 'user' },
      { type: 'recorded', take: phoneTake('file:///rec.m4a', 5000) },
      { type: 'send' },
      { type: 'uploaded', fileId: 'f1' },
      { type: 'file_ready' },
    ])

  test('başarılı yol: kayıt yüklenir, işlenir, ses gövdesiyle teslim edilir', async () => {
    const { bodies, send } = setup(['ok'])
    const sending = toSending()
    assert.equal(sending.phase.kind, 'sending')
    const outcome = await send()
    assert.equal(outcome.status, 'success')
    assert.deepEqual(bodies, [{ submissionKind: 'audio', recordingFileId: 'f1' }])
    const done = recorderReducer(sending, { type: 'submitted' })
    assert.equal(done.phase.kind, 'submitted')
  })

  test('ağ hatasından sonra aynı kayıt aynı Idempotency-Key ile gider (mükerrer teslim oluşmaz)', async () => {
    const { keys, send } = setup([networkError(), 'ok'])
    const first = await send()
    assert.equal(first.status, 'failed')
    if (first.status !== 'failed') return
    const failure = speakingFailure(first.error)
    const failed = recorderReducer(toSending(), failure.event)
    assert.equal(failed.phase.kind, 'send_failed')
    const second = await send()
    assert.equal(second.status, 'success')
    assert.equal(keys.length, 2)
    assert.equal(keys[0], keys[1])
  })

  test('mükerrer teslim 409: kayıt makinesi gönderilemedi durumunda kalır, ekran tazelenir', async () => {
    const { send } = setup([apiError(409, 'file_already_attached')])
    const outcome = await send()
    assert.equal(outcome.status, 'failed')
    if (outcome.status !== 'failed') return
    const failure = speakingFailure(outcome.error)
    assert.equal(failure.kind, 'duplicate')
    const state = recorderReducer(toSending(), failure.event)
    assert.equal(state.phase.kind, 'send_failed')
  })

  test('süre/hak hatası kayıt reddi değil, rıza yoksa kayıt kapanır', async () => {
    const limit = speakingFailure(apiError(422, 'version_limit_reached', 'Hak doldu.'))
    assert.equal(recorderReducer(toSending(), limit.event).phase.kind, 'send_failed')
    const consent = speakingFailure(apiError(403, 'consent_required'))
    const blocked = recorderReducer(toSending(), consent.event)
    assert.deepEqual(blocked.phase, { kind: 'blocked', reason: 'consent' })
    const rejected = speakingFailure(apiError(422, 'recording_too_long', 'Süre aşıldı.'))
    const idle = recorderReducer(toSending(), rejected.event)
    assert.equal(idle.phase.kind, 'idle')
  })
})

describe('telefon metinleri', () => {
  test('izin reddi telefona özgü metinle anlatılır, tarayıcıdan söz edilmez', () => {
    assert.equal(permissionBlock(true), null)
    assert.equal(permissionBlock(false), 'denied')
    for (const reason of ['denied', 'unsupported'] as const)
      assert.doesNotMatch(PHONE_BLOCK_MESSAGES[reason], /[Tt]arayıcı/)
    const phase = { kind: 'blocked', reason: 'denied' } as const
    assert.equal(phoneLiveMessage(phase, 0), PHONE_BLOCK_MESSAGES.denied)
    assert.equal(phoneLiveMessage({ kind: 'requesting' }, 0), 'Mikrofon izni isteniyor.')
  })

  test('sayaç etiketi her saniye değişmez', () => {
    const labels = new Set<string>()
    for (let ms = 60_000; ms > 50_000; ms -= 1000) labels.add(recordingClockSpoken(ms, 'Kayıt'))
    assert.equal(labels.size, 1)
    assert.equal(recordingClockSpoken(150_000, 'Hazırlık'), 'Hazırlık: kalan 3 dakika')
    assert.equal(recordingClockSpoken(0, 'Kayıt'), 'Kayıt: kalan 0 saniye')
  })
})
