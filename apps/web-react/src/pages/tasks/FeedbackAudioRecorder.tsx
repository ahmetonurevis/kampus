import { useEffect, useId, useRef, useState } from 'react'
import { useFileUpload } from '@kampus/react-shared/use-file-upload.ts'
import { useFileProcessing } from '@kampus/react-shared/use-files.ts'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { useStableCallback } from '@/hooks/use-stable-callback.ts'
import {
  FEEDBACK_AUDIO_LIMITS,
  FEEDBACK_AUDIO_TAKES,
  FEEDBACK_BLOCK_MESSAGES,
  FEEDBACK_STILL_PROCESSING,
  FEEDBACK_UPLOAD_FAILED,
  NO_FEEDBACK_AUDIO,
  feedbackAudioValue,
  feedbackClock,
  feedbackLiveMessage,
  processingOutcome,
  type FeedbackAudioValue,
} from './feedback-audio-model.ts'
import { clockLabel, durationLabel, elapsedMs } from './speaking-recorder-model.ts'
import { useObjectUrlSource, useSpeakingRecorder } from './use-speaking-recorder.ts'

type Props = {
  disabled: boolean
  onChange: (value: FeedbackAudioValue) => void
}

/**
 * Puanlama penceresinde isteğe bağlı sesli geri bildirim (IST-052; DOM-BEC-056). Silme ve yeniden
 * kayıt kaydediciyi yeniden kurar (`key`): yüklenip puana bağlanmayan dosyayı sunucunun saatlik
 * bağsız dosya temizliği siler.
 */
export function FeedbackAudioField({ disabled, onChange }: Props) {
  const [generation, setGeneration] = useState(0)
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="grid gap-2 rounded-card border p-4">
      <h3 id={headingId} className="text-sm font-semibold">
        Sesli geri bildirim (isteğe bağlı)
      </h3>
      <p className="text-sm text-muted-foreground">
        En çok {durationLabel(FEEDBACK_AUDIO_LIMITS.speakingSeconds)}. Ses puanla birlikte
        kaydedilir ve yazılı geri bildirimle aynı anda öğrenciye ve velisine açılır; kurum dışına
        gönderilmez.
      </p>
      <FeedbackAudioRecorder
        key={generation}
        disabled={disabled}
        onChange={onChange}
        onDiscard={() => {
          onChange(NO_FEEDBACK_AUDIO)
          setGeneration((value) => value + 1)
        }}
      />
    </section>
  )
}

function FeedbackAudioRecorder({
  disabled,
  onChange,
  onDiscard,
}: Props & { onDiscard: () => void }) {
  const recorder = useSpeakingRecorder(FEEDBACK_AUDIO_LIMITS)
  const { state, now, dispatch } = recorder
  const { phase } = state
  const upload = useFileUpload()
  const sending = phase.kind === 'sending' ? phase : null
  const processing = useFileProcessing(sending?.step === 'processing' ? (sending.fileId ?? '') : '')
  const abort = useRef<AbortController | null>(null)
  const primary = useRef<HTMLButtonElement>(null)
  const take = 'take' in phase ? phase.take : null
  const audioSource = useObjectUrlSource(take?.blob ?? null)
  const listenId = useId()

  // Form değeri yalnız türü ya da dosyası değişince bildirilir (her çizimde değil).
  const value = feedbackAudioValue(phase)
  const kind = value.kind
  const readyFileId = value.kind === 'ready' ? value.fileId : null
  const report = useStableCallback(onChange)
  useEffect(() => {
    report(
      readyFileId !== null
        ? { kind: 'ready', fileId: readyFileId }
        : kind === 'pending'
          ? { kind: 'pending' }
          : NO_FEEDBACK_AUDIO,
    )
  }, [kind, readyFileId, report])

  useEffect(() => () => abort.current?.abort(), [])

  // Evre değişince basılan düğme kalktıysa odak yeni ana işleme taşınır.
  useEffect(() => {
    if (document.activeElement === document.body) primary.current?.focus()
  }, [phase.kind])

  // Kayıt bitince kendiliğinden yüklenir; dinleme ve silme yüklemeyi beklemez.
  async function send() {
    if (phase.kind !== 'recorded' && phase.kind !== 'send_failed') return
    const uploaded = phase.kind === 'send_failed' ? phase.fileId : null
    const blob = phase.take.blob
    dispatch({ type: 'send' })
    if (uploaded !== null) return
    abort.current = new AbortController()
    const outcome = await upload.upload(
      'feedback_audio',
      blob,
      { silent: () => true },
      abort.current.signal,
    )
    if ('ok' in outcome) return dispatch({ type: 'send_failed', message: outcome.message })
    if (outcome.status === 'busy') return
    if (outcome.status === 'failed')
      return dispatch({ type: 'send_failed', message: FEEDBACK_UPLOAD_FAILED })
    const id = outcome.data.data?.id
    dispatch(
      id
        ? { type: 'uploaded', fileId: id }
        : { type: 'send_failed', message: FEEDBACK_UPLOAD_FAILED },
    )
  }
  const autoSend = useStableCallback(() => void send())
  useEffect(() => {
    if (phase.kind === 'recorded') autoSend()
  }, [phase.kind, autoSend])

  // Dosya sunucuda işlenince (ADR 0003 karar 10) ses forma eklenir; ret yeniden kayıt ister.
  const settle = useStableCallback(() => {
    if (phase.kind !== 'sending' || phase.step !== 'processing' || phase.fileId === null) return
    const outcome = processingOutcome(processing.state)
    if (outcome === null) return
    if (outcome === 'rejected') return dispatch({ type: 'file_rejected' })
    if (outcome === 'still_processing')
      return dispatch({ type: 'send_failed', message: FEEDBACK_STILL_PROCESSING })
    if (outcome === 'retry')
      return dispatch({ type: 'send_failed', message: FEEDBACK_UPLOAD_FAILED })
    dispatch({ type: 'file_ready' })
  })
  const fileId = sending?.step === 'processing' ? sending.fileId : null
  const fileState = processing.state
  useEffect(() => {
    if (fileId !== null && fileState !== 'processing') settle()
  }, [fileId, fileState, settle])

  const message = feedbackLiveMessage(phase)

  if (!recorder.supported)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {FEEDBACK_BLOCK_MESSAGES.unsupported}
      </p>
    )

  return (
    <div className="grid gap-3">
      {phase.kind === 'recording' ? (
        <span className="flex items-center gap-2 text-sm font-medium text-danger">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full bg-danger-solid motion-safe:animate-pulse"
          />
          Kaydediliyor
          <span role="timer" className="font-mono tabular-nums">
            {feedbackClock(elapsedMs(phase, now))}
          </span>
        </span>
      ) : null}
      <p role="status" className="min-h-5 text-sm">
        {message}
      </p>
      {take ? (
        <div className="grid gap-1">
          <span id={listenId} className="text-sm font-medium">
            Sesli geri bildiriminizi dinleyin ({clockLabel(take.durationMs, 'down')})
          </span>
          <audio
            ref={audioSource}
            controls
            preload="metadata"
            aria-labelledby={listenId}
            className="w-full max-w-md"
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {phase.kind === 'idle' || phase.kind === 'blocked' ? (
          phase.kind === 'blocked' && phase.reason === 'consent' ? null : (
            <Button
              ref={primary}
              type="button"
              variant="secondary"
              disabled={disabled}
              onClick={() => dispatch({ type: 'start', remaining: FEEDBACK_AUDIO_TAKES })}
            >
              <Icon name="Mic" size={16} aria-hidden="true" />
              {phase.kind === 'blocked' ? 'Yeniden dene' : 'Sesli geri bildirim kaydet'}
            </Button>
          )
        ) : null}
        {phase.kind === 'requesting' || phase.kind === 'starting' || phase.kind === 'preparing' ? (
          <Button ref={primary} type="button" variant="secondary" disabled aria-busy="true">
            <Icon name="Mic" size={16} aria-hidden="true" />
            {phase.kind === 'requesting' ? 'Mikrofon izni bekleniyor…' : 'Kayıt başlıyor…'}
          </Button>
        ) : null}
        {phase.kind === 'recording' ? (
          <Button
            ref={primary}
            type="button"
            disabled={phase.stop !== null}
            onClick={() => dispatch({ type: 'stop', by: 'user' })}
          >
            <Icon name="Square" size={16} aria-hidden="true" />
            Kaydı bitir
          </Button>
        ) : null}
        {phase.kind === 'send_failed' ? (
          <Button ref={primary} type="button" variant="secondary" onClick={() => void send()}>
            <Icon name="RotateCcw" size={16} aria-hidden="true" />
            Yeniden yükle
          </Button>
        ) : null}
        {take !== null ? (
          <Button type="button" variant="secondary" disabled={disabled} onClick={onDiscard}>
            <Icon name="Trash2" size={16} aria-hidden="true" />
            Sesi sil
          </Button>
        ) : null}
      </div>
    </div>
  )
}
