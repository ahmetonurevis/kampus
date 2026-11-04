import { useEffect, useRef, useState } from 'react'
import { Alert, View } from 'react-native'
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { isApiError } from '@kampus/api-client/errors.ts'
import { learnerSubmissionsQuery } from '@kampus/react-shared/use-learner-task-progress.ts'
import {
  isLearnerAssignment,
  isNotFoundError,
  writingBrief,
  writingProgress,
} from '@kampus/react-shared/student-task-model.ts'
import {
  RECORDING_NOTICE,
  clockLabel,
  durationLabel,
  elapsedMs,
  phaseRemainingMs,
  takesLeft,
  type RecorderPhase,
  type SpeakingLimits,
} from '@kampus/react-shared/speaking-recorder-model.ts'
import { dateTimeLabel } from '@kampus/react-shared/task-labels.ts'
import { useConsentStatus } from '@kampus/react-shared/use-consents.ts'
import { useFileProcessing } from '@kampus/react-shared/use-files.ts'
import { useTaskAssignment } from '@kampus/react-shared/use-task-assignments.ts'
import {
  useSubmitTaskSubmission,
  useTaskSubmission,
  useTaskSubmissions,
} from '@kampus/react-shared/use-task-submissions.ts'
import { Badge, Button, Sheet, T } from '../../ui/components.tsx'
import { DetailPair, Notice, Section } from '../../ui/SchoolLayout.tsx'
import { useNow } from '../../ui/use-now.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { useSubmissionUpload } from '../submission-files.ts'
import { mobileTone } from '../student-writing.ts'
import {
  FAILED_UPLOAD_TEXT,
  PHONE_BLOCK_MESSAGES,
  SPEAKING_DONE_TEXT,
  phoneLiveMessage,
  recordingClockSpoken,
  settleOutcome,
  speakingFailure,
  speakingLimits,
  speakingRemaining,
  speakingSettings,
  speakingSubmitInput,
  speakingUploadInput,
  leaveGuard,
  type LeaveGuard,
  type PhoneTake,
} from '../student-speaking-task.ts'
import { useApiSession } from '../auth.tsx'
import { useNotify } from '../toast.tsx'
import { usePhoneRecorder } from '../use-phone-recorder.ts'

const LEAVE_TITLE = 'Kaydın gönderilmedi'
const LEAVE_TEXT =
  'Kaydın gönderene kadar yalnız bu pencerede tutulur. Pencereyi kapatırsan kaydın cihazdan silinir ve gönderilmez.'
const SENDING_TITLE = 'Kayıt gönderiliyor'
const SENDING_TEXT = 'Kaydın sunucuya gönderiliyor. Gönderim bitene kadar pencereyi kapatamazsın.'

/**
 * Öğrencinin konuşma görevi penceresi (web `SpeakingTask`; IST-051, IST-124; DOM-BEC-002, 040, 050,
 * 054): yönerge, aydınlatma metni, rıza yoksa kayıt kapalı, izin, hazırlık geri sayımı, süre
 * sınırında kendiliğinden duran kayıt, dinleme, yeniden kayıt ve onaylı teslim (yükleme, işlenme,
 * teslim). Kural sunucudadır (rıza, süre ölçümü, deneme hakkı). Ses yalnız cihazın önbelleğindedir
 * (atılınca, teslimden sonra ve pencere kapanınca silinir); AsyncStorage'a hiçbir şey yazılmaz.
 */
export function SpeakingSheet({
  assignmentId,
  onClose,
}: {
  assignmentId: string
  onClose: () => void
}) {
  const assignmentQuery = useTaskAssignment(assignmentId)
  const listQuery = useTaskSubmissions(learnerSubmissionsQuery(assignmentId))
  const summary = listQuery.data?.data[0]
  const detailQuery = useTaskSubmission(summary?.id ?? '')
  const session = useApiSession()
  // Rıza öğrencinin kendi kaydına bağlıdır; kimlik yoksa sorgulanmaz ve kayıt açılmaz.
  const studentId = session.studentId
  const consent = useConsentStatus(studentId ?? undefined, { enabled: studentId !== null })
  const now = useNow()
  // Kayıt bileşeni kapatma durumunu buraya bildirir: gönderilmemiş kayıtta sorulur, gönderim
  // sürerken pencere kapanmaz.
  const [guard, setGuard] = useState<LeaveGuard>('free')

  const assignment =
    assignmentQuery.data && isLearnerAssignment(assignmentQuery.data.data)
      ? assignmentQuery.data.data
      : undefined
  const detail = detailQuery.data?.data
  const missing = isNotFoundError(assignmentQuery.error)
  const settings = assignment ? speakingSettings(assignment) : null
  const waitingDetail = summary !== undefined && !detail && !detailQuery.error
  const ready = !!assignment && !!listQuery.data && !waitingDetail && !consent.isPending
  // İlk teslimden sonra özet belirir ve ayrıntı yüklenirken kayıt durumu (teslim bilgisi) kaybolmasın.
  const [shown, setShown] = useState(false)
  if (ready && !shown) setShown(true)
  const loaded = ready || (shown && !!assignment && !!listQuery.data)
  // Teslim listesi `useQuery` ile okunur (hata tipi genel); istek katmanı yalnız `ApiError` fırlatır.
  const listError = isApiError(listQuery.error) ? listQuery.error : null
  const error = missing ? null : (assignmentQuery.error ?? listError ?? detailQuery.error)

  function close() {
    if (guard === 'free') return onClose()
    if (guard === 'sending') return Alert.alert(SENDING_TITLE, SENDING_TEXT, [{ text: 'Tamam' }])
    Alert.alert(LEAVE_TITLE, LEAVE_TEXT, [
      { text: 'Pencerede kal', style: 'cancel' },
      { text: 'Kaydı sil ve kapat', style: 'destructive', onPress: onClose },
    ])
  }

  const progress = assignment ? writingProgress(assignment, detail ?? summary ?? null, now) : null
  const recordingConsent = consent.data?.data.find((item) => item.purpose === 'speaking_recording')

  return (
    <Sheet visible title={assignment?.title ?? 'Konuşma görevi'} onClose={close}>
      {missing || (assignmentQuery.data && !assignment) ? (
        <Notice title="Görev bulunamadı" text="Bu görev sana atanmamış ya da teslim beklemiyor." />
      ) : error ? (
        <QueryError
          error={error}
          onRetry={() => {
            if (assignmentQuery.error) void assignmentQuery.refetch()
            if (listError) void listQuery.refetch()
            if (detailQuery.error) void detailQuery.refetch()
          }}
        />
      ) : !loaded || !assignment || !progress ? (
        <ListLoading label="Görev yükleniyor…" />
      ) : (
        <>
          <Brief assignment={assignment} progress={progress} />
          {studentId === null ? (
            <Notice
              title="Öğrenci kaydı bulunamadı"
              text="Hesabın bir öğrenci kaydına bağlı değil; kayıt yapılamaz."
            />
          ) : !settings ? (
            <Notice title="Telefonda açılmıyor" text="Bu görev ses kaydıyla teslim edilmiyor." />
          ) : recordingConsent && !recordingConsent.valid ? (
            <ConsentMissing grantor={recordingConsent.grantor} />
          ) : (
            <Recorder
              key={assignmentId}
              assignmentId={assignmentId}
              limits={speakingLimits(settings)}
              remaining={speakingRemaining(
                settings,
                detail?.allowance?.remaining,
                summary?.versionCount ?? 0,
              )}
              canSubmit={progress.canAct}
              blockedReason={progress.blockedReason}
              onGuard={setGuard}
              onSubmitted={() => {
                void detailQuery.refetch()
                void listQuery.refetch()
              }}
              onStale={() => {
                void detailQuery.refetch()
                void listQuery.refetch()
              }}
            />
          )}
        </>
      )}
    </Sheet>
  )
}

function Brief({
  assignment,
  progress,
}: {
  assignment: Parameters<typeof writingBrief>[0]
  progress: NonNullable<ReturnType<typeof writingProgress>>
}) {
  const brief = writingBrief(assignment)
  return (
    <Section title="Görev bilgileri" panel>
      {!!brief.instructions && (
        <View style={{ gap: 4 }}>
          <T bold size={14}>
            Yönerge
          </T>
          <T size={15}>{brief.instructions}</T>
        </View>
      )}
      {!!brief.notice && (
        <T muted size={14}>
          {brief.notice}
        </T>
      )}
      {brief.attributions.length > 0 && (
        <View style={{ gap: 4 }}>
          <T bold size={14}>
            Kaynak gösterimi
          </T>
          {brief.attributions.map((item) => (
            <T key={`${item.work}:${item.author}:${item.source}`} muted size={13}>
              {item.work} — {item.author}, {item.source}
              {item.year ? ` (${item.year})` : ''}
            </T>
          ))}
        </View>
      )}
      <View style={{ gap: 12 }}>
        <DetailPair
          label="Durum"
          value={<Badge text={progress.status} tone={mobileTone(progress.tone)} />}
        />
        <DetailPair label="Deneme hakkı" value={progress.rights} />
        <DetailPair
          label="Son teslim"
          value={
            assignment.deadline.dueAt ? dateTimeLabel(assignment.deadline.dueAt) : 'Belirtilmemiş'
          }
        />
        <DetailPair label="Puan" value={progress.score} />
      </View>
    </Section>
  )
}

/** Rıza yoksa kayıt düğmesi hiç gösterilmez; görev yüz yüze değerlendirilir (DOM-BEC-050). */
function ConsentMissing({ grantor }: { grantor: string | null | undefined }) {
  return (
    <Notice title={PHONE_BLOCK_MESSAGES.consent}>
      <T size={14}>
        {grantor === 'self'
          ? 'Ses kaydı rızasını web sürümünde Ayarlar sayfasındaki Rızalarım bölümünden kendin verebilirsin.'
          : 'Ses kaydı rızasını velin web sürümünde Ayarlar sayfasındaki Rızalarım bölümünden verebilir.'}{' '}
        Rıza vermek zorunlu değildir.
      </T>
    </Notice>
  )
}

type RecorderProps = {
  assignmentId: string
  limits: SpeakingLimits
  /** Sunucunun bildirdiği kalan deneme; kayıt yoksa sınırın tamamı. */
  remaining: number
  canSubmit: boolean
  blockedReason: string | null
  onGuard: (guard: LeaveGuard) => void
  onSubmitted: () => void
  onStale: () => void
}

function Recorder({
  assignmentId,
  limits,
  remaining,
  canSubmit,
  blockedReason,
  onGuard,
  onSubmitted,
  onStale,
}: RecorderProps) {
  const notify = useNotify()
  const recorder = usePhoneRecorder(limits)
  const { state, now, dispatch } = recorder
  const { phase } = state
  const uploader = useSubmissionUpload()
  const submit = useSubmitTaskSubmission()
  const sending = phase.kind === 'sending' ? phase : null
  const processing = useFileProcessing(sending?.step === 'processing' ? (sending.fileId ?? '') : '')
  const abort = useRef<AbortController | null>(null)
  const take = 'take' in phase ? phase.take : null
  const guard = leaveGuard(phase)
  const busy = sending !== null

  useEffect(() => {
    onGuard(guard)
    // Kayıt bileşeni kalkınca (ör. rıza engeli) kapatma uyarısı da kalkar.
    return () => onGuard('free')
  }, [guard, onGuard])
  useEffect(() => () => abort.current?.abort(), [])

  const fail = (error: Parameters<typeof speakingFailure>[0], step: 'upload' | 'submit') => {
    const failure = speakingFailure(error, step)
    dispatch(failure.event)
    // Zaten gönderilmiş ya da hak/pencere değişmiş: ekran sunucudaki durumla tazelenir.
    if (failure.kind === 'duplicate' || failure.kind === 'limit' || failure.kind === 'closed')
      onStale()
  }

  // Dosya sunucuda işlenince teslim kendiliğinden yapılır; bekleme dolarsa `fileId` korunur.
  const fileState = processing.state
  const fileId = sending?.step === 'processing' ? sending.fileId : null
  const submitRef = useRef(submit.submit)
  submitRef.current = submit.submit
  const failRef = useRef(fail)
  failRef.current = fail
  useEffect(() => {
    if (fileId === null) return
    const outcome = settleOutcome(fileState)
    if (outcome === null) return
    if (outcome !== 'submit') return dispatch(outcome)
    dispatch({ type: 'file_ready' })
    void submitRef
      .current(speakingSubmitInput(assignmentId, fileId), { silent: () => true })
      .then((result) => {
        if (result.status === 'busy') return
        if (result.status === 'failed') return failRef.current(result.error, 'submit')
        dispatch({ type: 'submitted' })
        onSubmitted()
        notify(SPEAKING_DONE_TEXT)
      })
  }, [assignmentId, dispatch, fileId, fileState, notify, onSubmitted])

  async function sendTake() {
    if (phase.kind !== 'recorded' && phase.kind !== 'send_failed') return
    const current = phase.take
    const uploaded = phase.kind === 'send_failed' ? phase.fileId : null
    dispatch({ type: 'send' })
    if (uploaded !== null) return
    abort.current = new AbortController()
    const outcome = await uploader.upload(speakingUploadInput(current, abort.current.signal))
    if (outcome.status === 'busy') return
    if (outcome.status === 'failed') return fail(outcome.error, 'upload')
    const id = outcome.data.data?.id
    if (id) dispatch({ type: 'uploaded', fileId: id })
    else dispatch({ type: 'send_failed', message: FAILED_UPLOAD_TEXT })
  }

  const left = phaseRemainingMs(phase, now)
  const showRecorder = canSubmit || phase.kind !== 'idle'
  const startable = recorder.canStart(remaining) && canSubmit
  const rerecordable = recorder.canRerecord(remaining) && canSubmit
  const noMoreTakes = takesLeft(state, remaining) < 1

  return (
    <View style={{ gap: 12 }}>
      <T muted size={14}>
        {RECORDING_NOTICE}
      </T>
      <Section title="Süreler" panel>
        <DetailPair
          label="Hazırlık süresi"
          value={limits.preparationSeconds > 0 ? durationLabel(limits.preparationSeconds) : 'Yok'}
        />
        <DetailPair
          label="Konuşma süresi"
          value={`en çok ${durationLabel(limits.speakingSeconds)}`}
        />
        <DetailPair label="Kalan deneme" value={String(remaining)} />
      </Section>
      {!showRecorder ? (
        <T muted size={14} accessibilityLiveRegion="polite">
          {blockedReason ?? 'Şu an yeni kayıt gönderilemez.'}
        </T>
      ) : (
        <Section title="Ses kaydı" panel>
          <Clock phase={phase} left={left} elapsed={elapsedMs(phase, now)} limits={limits} />
          <T size={14} accessibilityLiveRegion="polite">
            {phoneLiveMessage(phase, now)}
          </T>
          {take && <TakePlayer key={take.blob.uri} take={take} />}
          <Actions
            phase={phase}
            startable={startable}
            rerecordable={rerecordable}
            canSubmit={canSubmit}
            busy={busy}
            onStart={() => dispatch({ type: 'start', remaining })}
            onSkip={() => dispatch({ type: 'preparation_over' })}
            onStop={() => dispatch({ type: 'stop', by: 'user' })}
            onRerecord={() => dispatch({ type: 'rerecord', remaining })}
            onSend={() => void sendTake()}
            onReset={() => dispatch({ type: 'reset' })}
          />
          {phase.kind === 'recorded' && !rerecordable && (
            <T muted size={13}>
              Deneme hakkın yeniden kayda yetmiyor; bu kaydı gönderebilirsin.
            </T>
          )}
          {(phase.kind === 'idle' || phase.kind === 'submitted') && noMoreTakes && canSubmit && (
            <T muted size={13}>
              Bu pencerede deneme hakkın doldu.
            </T>
          )}
        </Section>
      )}
    </View>
  )
}

/**
 * Geri sayım saati: görünen yazı sık değişir, ekran okuyucu etiketi yalnız dakikada bir (son
 * dakikada on saniyede bir) değişir; duyurular canlı bölgededir.
 */
function Clock({
  phase,
  left,
  elapsed,
  limits,
}: {
  phase: RecorderPhase<unknown>
  left: number | null
  elapsed: number
  limits: SpeakingLimits
}) {
  if (phase.kind === 'preparing' && left !== null)
    return (
      <View style={{ gap: 2 }}>
        <T muted size={13}>
          Hazırlık: kayda kalan süre
        </T>
        <T
          bold
          size={28}
          accessibilityRole="timer"
          accessibilityLabel={recordingClockSpoken(left, 'Hazırlık')}
        >
          {clockLabel(left)}
        </T>
      </View>
    )
  if (phase.kind === 'recording' && left !== null)
    return (
      <View style={{ gap: 2 }}>
        <T bold size={14}>
          Kaydediliyor
        </T>
        <T
          bold
          size={28}
          accessibilityRole="timer"
          accessibilityLabel={recordingClockSpoken(left, 'Kayıt')}
        >
          {clockLabel(elapsed, 'down')} / {clockLabel(limits.speakingSeconds * 1000)}
        </T>
        <T muted size={13}>
          Kalan {clockLabel(left)}
        </T>
      </View>
    )
  return null
}

/** Alınan kaydı dinletir; kayıt adresi yalnız oynatıcıya verilir. */
function TakePlayer({ take }: { take: PhoneTake }) {
  const player = useAudioPlayer(take.blob.uri)
  const status = useAudioPlayerStatus(player)
  const length = clockLabel(take.durationMs, 'down')
  function toggle() {
    if (status.playing) return player.pause()
    // Bittiyse baştan çalar.
    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration))
      void player.seekTo(0)
    player.play()
  }
  return (
    <View style={{ gap: 6 }}>
      <T bold size={14}>
        Kaydını dinle ({length})
      </T>
      <Button
        icon="Play"
        label={status.playing ? 'Kaydı duraklat' : `Kaydı dinle, ${length}`}
        onPress={toggle}
      >
        {status.playing ? 'Duraklat' : 'Dinle'}
      </Button>
    </View>
  )
}

function Actions({
  phase,
  startable,
  rerecordable,
  canSubmit,
  busy,
  onStart,
  onSkip,
  onStop,
  onRerecord,
  onSend,
  onReset,
}: {
  phase: RecorderPhase<unknown>
  startable: boolean
  rerecordable: boolean
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
    case 'submitted':
      return phase.kind === 'submitted' ? (
        <Button icon="Mic" disabled={!startable} onPress={onReset}>
          Yeni kayıt yap
        </Button>
      ) : (
        <Button primary icon="Mic" disabled={!startable} onPress={onStart}>
          Kaydı başlat
        </Button>
      )
    case 'blocked':
      return phase.reason === 'unsupported' || phase.reason === 'consent' ? null : (
        <Button primary icon="Mic" disabled={!startable} onPress={onStart}>
          Yeniden dene
        </Button>
      )
    case 'requesting':
    case 'starting':
      return (
        <Button disabled label="Kayıt hazırlanıyor">
          Hazırlanıyor…
        </Button>
      )
    case 'preparing':
      return <Button onPress={onSkip}>Hazırlığı atla, kaydı başlat</Button>
    case 'recording':
      return (
        <Button
          danger
          icon="Square"
          disabled={phase.stop !== null}
          label="Kaydı durdur"
          onPress={onStop}
        >
          Kaydı durdur
        </Button>
      )
    case 'recorded':
    case 'send_failed':
      return (
        <View style={{ gap: 8 }}>
          <Button primary icon="Send" disabled={!canSubmit} onPress={onSend}>
            {phase.kind === 'send_failed' ? 'Yeniden dene' : 'Kaydı gönder'}
          </Button>
          {phase.kind === 'recorded' && (
            <Button icon="RotateCcw" disabled={!rerecordable} onPress={onRerecord}>
              Yeniden kaydet
            </Button>
          )}
        </View>
      )
    case 'sending':
      return (
        <Button primary disabled={busy} label="Kayıt gönderiliyor">
          Gönderiliyor…
        </Button>
      )
    default:
      return phase satisfies never
  }
}
