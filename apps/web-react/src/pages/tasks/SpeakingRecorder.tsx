import { useEffect, useRef, type RefObject } from 'react'
import { Link } from 'react-router'
import { commandFeedback } from '@kampus/react-shared/commands.ts'
import { useConsentStatus } from '@kampus/react-shared/use-consents.ts'
import { useFileUpload } from '@kampus/react-shared/use-file-upload.ts'
import { useFileProcessing } from '@kampus/react-shared/use-files.ts'
import {
  TASK_SUBMISSION_MESSAGES,
  useSubmitTaskSubmission,
} from '@kampus/react-shared/use-task-submissions.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { useRouteDiscardGuard } from '@/hooks/use-route-discard-guard.tsx'
import { useStableCallback } from '@/hooks/use-stable-callback.ts'
import { notify } from '@/lib/notify.ts'
import {
  BLOCK_MESSAGES,
  clockLabel,
  durationLabel,
  elapsedMs,
  liveMessage,
  phaseRemainingMs,
  takesLeft,
  type RecorderPhase,
  type SpeakingLimits,
} from './speaking-recorder-model.ts'
import { useObjectUrlSource, useSpeakingRecorder } from './use-speaking-recorder.ts'

/** Kayıt öncesi aydınlatma (DOM-BEC-050, 051, 053, 054); kayıt başlamadan her zaman görünür. */
export const RECORDING_NOTICE =
  'Kaydınız yalnız bu görevin puanlanması, geri bildirimi ve itirazı için kullanılır. Kaydı siz, 18 yaşından küçükseniz veliniz ve görevi değerlendiren öğretmenler dinleyebilir. Kayıt kurum dışına gönderilmez, ses tanıma yapılmaz ve saklama süresi sonunda silinir. Gönderene kadar yalnız bu sayfada tutulur; sayfadan ayrılırsanız silinir.'

const FAILED_UPLOAD = 'Kaydınız gönderilemedi.'

type Props = {
  assignmentId: string
  limits: SpeakingLimits
  /** Sunucunun bildirdiği kalan deneme (`allowance.remaining`); kayıt yoksa sınırın tamamı. */
  remaining: number
  /** Sunucu yeni deneme kabul ediyor mu (`allowance.canSubmit`, teslim penceresi). */
  canSubmit: boolean
  blockedReason: string | null
}

/**
 * Konuşma görevi teslimi (IST-051; DOM-BEC-050): kayıt yalnız öğrencinin ses kaydı rızası
 * geçerliyse açılır. Rıza yoksa kayıt düğmesi hiç gösterilmez; görev yüz yüze değerlendirilir ve
 * kimin onay vereceği söylenir. Rıza okunamazsa kayıt açılır; son söz sunucunundur (403
 * `consent_required`).
 */
export function SpeakingTask(props: Props) {
  const { session } = useAuth()
  const ownStudentId = session?.links.find((link) => link.kind === 'student')?.recordId
  const status = useConsentStatus(ownStudentId, { enabled: ownStudentId !== undefined })
  if (ownStudentId !== undefined && status.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Ses kaydı onayı denetleniyor…
      </p>
    )
  const recording = status.data?.data.find((item) => item.purpose === 'speaking_recording')
  if (recording && !recording.valid)
    return (
      <div role="note" className="grid gap-2 text-sm">
        <p className="font-medium">{BLOCK_MESSAGES.consent}</p>
        {recording.grantor === 'self' ? (
          <p className="text-muted-foreground">
            Ses kaydı rızasını{' '}
            <Link to="/ogrenci/ayarlar" className="text-primary underline-offset-4 hover:underline">
              Ayarlar sayfasındaki Rızalarım bölümünden
            </Link>{' '}
            kendiniz verebilirsiniz. Rıza vermek zorunlu değildir.
          </p>
        ) : (
          <p className="text-muted-foreground">
            Ses kaydı rızasını veliniz Ayarlar sayfasındaki Rızalarım bölümünden verebilir. Rıza
            vermek zorunlu değildir.
          </p>
        )}
      </div>
    )
  return <SpeakingRecorder {...props} />
}

const RECORDING_ERRORS = new Set(['recording_empty', 'recording_too_long', 'file_unavailable'])

function SpeakingRecorder({ assignmentId, limits, remaining, canSubmit, blockedReason }: Props) {
  const recorder = useSpeakingRecorder(limits)
  const { state, now, dispatch } = recorder
  const { phase } = state
  const upload = useFileUpload()
  const submit = useSubmitTaskSubmission()
  const sending = phase.kind === 'sending' ? phase : null
  const processing = useFileProcessing(sending?.step === 'processing' ? (sending.fileId ?? '') : '')
  const abort = useRef<AbortController | null>(null)
  const primary = useRef<HTMLButtonElement>(null)
  const take = 'take' in phase ? phase.take : null
  const audioSource = useObjectUrlSource(take?.blob ?? null)

  const unsent =
    phase.kind === 'preparing' ||
    phase.kind === 'starting' ||
    phase.kind === 'recording' ||
    take !== null
  const guard = useRouteDiscardGuard(unsent, {
    title: 'Kaydınız gönderilmedi',
    description:
      'Sayfadan ayrılırsanız kaydınız silinir. Gönderilmeyen kayıt deneme hakkınızdan sayılabilir.',
    cancel: 'Sayfada kal',
    confirm: 'Kaydı sil ve ayrıl',
  })

  useEffect(() => () => abort.current?.abort(), [])

  // Evre değişince odak kaybolduysa (basılan düğme kalktı) yeni ana işleme taşınır.
  useEffect(() => {
    if (document.activeElement === document.body) primary.current?.focus()
  }, [phase.kind])

  const failWith = (error: ApiError) => {
    if (error.code === 'consent_required') dispatch({ type: 'blocked', reason: 'consent' })
    else if (RECORDING_ERRORS.has(error.code))
      dispatch({
        type: 'recording_rejected',
        message: commandFeedback(error, TASK_SUBMISSION_MESSAGES).message ?? FAILED_UPLOAD,
      })
    else
      dispatch({
        type: 'send_failed',
        message: commandFeedback(error, TASK_SUBMISSION_MESSAGES).message ?? FAILED_UPLOAD,
      })
  }

  // Dosya sunucuda işlenince (ADR 0003 karar 10) teslim kendiliğinden yapılır.
  const settle = useStableCallback((state: 'ready' | 'rejected' | 'failed', fileId: string) => {
    if (state === 'rejected') return dispatch({ type: 'file_rejected' })
    if (state === 'failed') return dispatch({ type: 'send_failed', message: FAILED_UPLOAD })
    dispatch({ type: 'file_ready' })
    void submit
      .submit(
        { assignmentId, submission: { submissionKind: 'audio', recordingFileId: fileId } },
        { silent: () => true },
      )
      .then((outcome) => {
        if (outcome.status === 'busy') return
        if (outcome.status === 'failed') return failWith(outcome.error)
        dispatch({ type: 'submitted' })
        notify.success('Konuşma kaydınız teslim edildi.')
      })
  })
  const fileState = processing.state
  const fileId = sending?.step === 'processing' ? sending.fileId : null
  useEffect(() => {
    if (fileId !== null && fileState !== 'waiting') settle(fileState, fileId)
  }, [fileId, fileState, settle])

  async function sendTake() {
    if (phase.kind !== 'recorded' && phase.kind !== 'send_failed') return
    const current = phase.take
    const uploaded = phase.kind === 'send_failed' ? phase.fileId : null
    dispatch({ type: 'send' })
    if (uploaded !== null) return
    abort.current = new AbortController()
    const outcome = await upload.upload(
      'speaking_recording',
      current.blob,
      { silent: () => true },
      abort.current.signal,
    )
    if ('ok' in outcome) return dispatch({ type: 'send_failed', message: outcome.message })
    if (outcome.status === 'busy') return
    if (outcome.status === 'failed') return failWith(outcome.error)
    const id = outcome.data.data?.id
    if (id) dispatch({ type: 'uploaded', fileId: id })
    else dispatch({ type: 'send_failed', message: FAILED_UPLOAD })
  }

  const left = phaseRemainingMs(phase, now)
  const showRecorder = canSubmit || phase.kind !== 'idle'

  return (
    <div className="grid gap-4">
      <p role="note" className="text-sm text-muted-foreground">
        {RECORDING_NOTICE}
      </p>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex gap-1">
          <dt className="text-muted-foreground">Hazırlık süresi:</dt>
          <dd>
            {limits.preparationSeconds > 0 ? durationLabel(limits.preparationSeconds) : 'Yok'}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-muted-foreground">Konuşma süresi:</dt>
          <dd>en çok {durationLabel(limits.speakingSeconds)}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-muted-foreground">Kalan deneme:</dt>
          <dd>{remaining}</dd>
        </div>
      </dl>

      {!recorder.supported ? (
        <p role="status" className="text-sm font-medium">
          {BLOCK_MESSAGES.unsupported}
        </p>
      ) : !showRecorder ? (
        <p role="status" className="text-sm text-muted-foreground">
          {blockedReason ?? 'Şu an yeni kayıt gönderilemez.'}
        </p>
      ) : (
        <section aria-label="Ses kaydı" className="grid gap-3 rounded-card border p-4">
          <PhaseClock phase={phase} left={left} elapsed={elapsedMs(phase, now)} limits={limits} />
          <p role="status" className="min-h-5 text-sm">
            {liveMessage(phase, now)}
          </p>
          {take ? (
            <div className="grid gap-1">
              <span id="kayit-dinle" className="text-sm font-medium">
                Kaydınızı dinleyin ({clockLabel(take.durationMs, 'down')})
              </span>
              <audio
                ref={audioSource}
                controls
                preload="metadata"
                aria-labelledby="kayit-dinle"
                className="w-full max-w-md"
              />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <PhaseActions
              phase={phase}
              primary={primary}
              limits={limits}
              canStart={recorder.canStart(remaining) && canSubmit}
              canRerecord={recorder.canRerecord(remaining) && canSubmit}
              canStartAgain={canSubmit && takesLeft(state, remaining) >= 1}
              canSubmit={canSubmit}
              busy={sending !== null}
              onStart={() => dispatch({ type: 'start', remaining })}
              onSkip={() => dispatch({ type: 'preparation_over' })}
              onStop={() => dispatch({ type: 'stop', by: 'user' })}
              onRerecord={() => dispatch({ type: 'rerecord', remaining })}
              onSend={() => void sendTake()}
              onReset={() => dispatch({ type: 'reset' })}
            />
          </div>
          {phase.kind === 'recorded' && !recorder.canRerecord(remaining) ? (
            <p className="text-sm text-muted-foreground">
              Deneme hakkınız yeniden kayda yetmiyor; bu kaydı gönderebilirsiniz.
            </p>
          ) : null}
          {(phase.kind === 'idle' || phase.kind === 'submitted') &&
          !recorder.canStart(remaining) &&
          canSubmit ? (
            <p className="text-sm text-muted-foreground">Bu sayfada deneme hakkınız doldu.</p>
          ) : null}
        </section>
      )}
      {guard.dialog}
    </div>
  )
}

/** Geri sayım saati: sessizdir (`role="timer"`); duyurular canlı bölgededir. */
function PhaseClock({
  phase,
  left,
  elapsed,
  limits,
}: {
  phase: RecorderPhase
  left: number | null
  elapsed: number
  limits: SpeakingLimits
}) {
  if (phase.kind === 'preparing' && left !== null)
    return (
      <div className="grid gap-0.5">
        <span className="text-sm text-muted-foreground">Hazırlık: kayda kalan süre</span>
        <span role="timer" className="font-mono text-2xl tabular-nums">
          {clockLabel(left)}
        </span>
      </div>
    )
  if (phase.kind === 'recording' && left !== null)
    return (
      <div className="grid gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium text-danger">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full bg-danger-solid motion-safe:animate-pulse"
          />
          Kaydediliyor
        </span>
        <span role="timer" className="font-mono text-2xl tabular-nums">
          {clockLabel(elapsed, 'down')} / {clockLabel(limits.speakingSeconds * 1000)}
        </span>
        <span className="text-sm text-muted-foreground">Kalan {clockLabel(left)}</span>
      </div>
    )
  return null
}

function PhaseActions({
  phase,
  primary,
  limits,
  canStart,
  canRerecord,
  canStartAgain,
  canSubmit,
  busy,
  onStart,
  onSkip,
  onStop,
  onRerecord,
  onSend,
  onReset,
}: {
  phase: RecorderPhase
  primary: RefObject<HTMLButtonElement | null>
  limits: SpeakingLimits
  canStart: boolean
  canRerecord: boolean
  /** Teslimden sonra yeni kayda yer var mı (sunucu hakkı ve bu sayfada atılanlar). */
  canStartAgain: boolean
  canSubmit: boolean
  busy: boolean
  onStart: () => void
  onSkip: () => void
  onStop: () => void
  onRerecord: () => void
  onSend: () => void
  onReset: () => void
}) {
  switch (phase.kind) {
    case 'idle':
    case 'blocked':
      return canStart ? (
        <Button ref={primary} type="button" onClick={onStart}>
          <Icon name="Mic" size={16} aria-hidden="true" />
          {phase.kind === 'blocked'
            ? 'Yeniden dene'
            : limits.preparationSeconds > 0
              ? 'Hazırlığa başla'
              : 'Kayda başla'}
        </Button>
      ) : null
    case 'requesting':
    case 'starting':
      return (
        <Button ref={primary} type="button" disabled aria-busy="true">
          <Icon name="Mic" size={16} aria-hidden="true" />
          {phase.kind === 'requesting' ? 'Mikrofon izni bekleniyor…' : 'Kayıt başlıyor…'}
        </Button>
      )
    case 'preparing':
      return (
        <Button ref={primary} type="button" onClick={onSkip}>
          <Icon name="Mic" size={16} aria-hidden="true" />
          Hazırım, kayda başla
        </Button>
      )
    case 'recording':
      return (
        <Button ref={primary} type="button" disabled={phase.stop !== null} onClick={onStop}>
          <Icon name="Square" size={16} aria-hidden="true" />
          Kaydı bitir
        </Button>
      )
    case 'recorded':
    case 'send_failed':
    case 'sending':
      return (
        <>
          <Button
            ref={primary}
            type="button"
            disabled={busy || !canSubmit}
            aria-busy={busy}
            onClick={onSend}
          >
            <Icon name="Send" size={16} aria-hidden="true" />
            {phase.kind === 'send_failed'
              ? 'Yeniden gönder'
              : busy
                ? 'Gönderiliyor…'
                : 'Kaydı gönder'}
          </Button>
          {phase.kind === 'recorded' && canRerecord ? (
            <Button type="button" variant="secondary" onClick={onRerecord}>
              <Icon name="RotateCcw" size={16} aria-hidden="true" />
              Yeniden kaydet
            </Button>
          ) : null}
        </>
      )
    case 'submitted':
      return canStartAgain ? (
        <Button ref={primary} type="button" variant="secondary" onClick={onReset}>
          <Icon name="Mic" size={16} aria-hidden="true" />
          Yeni kayıt yap
        </Button>
      ) : null
    default:
      return phase satisfies never
  }
}
