import { useCallback, useEffect, useId, useRef, useState, type SyntheticEvent } from 'react'
import {
  allowanceOf,
  linkUsable,
  listeningAllowance,
  listeningCounterText,
  listeningErrorCode,
  listeningErrorMessage,
  type AttemptListening,
  type ListeningAllowance,
  type ListeningRecording as Recording,
} from '@kampus/react-shared/listening.ts'
import { useListeningUrlFetcher } from '@kampus/react-shared/use-files.ts'
import { Icon } from '@/components/Icon.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useNow } from '@/hooks/use-now.ts'
import { notify } from '@/lib/notify.ts'
import { cn } from '@/lib/utils'
import {
  listeningPhase,
  reviewRefusal,
  transcriptVisible,
  type ListeningLink,
  type ListeningMode,
} from './listening-model.ts'
import type { ResultAudience } from './student-task-model.ts'

type Props = {
  recording: Recording
  /** Denemenin hak özeti (`attempt.listening`); sınırsızsa `null`. */
  listening: AttemptListening
  /** `attempt`: öğrencinin süren denemesi (hak sayılır); `review`: sonuç, personel, veli. */
  mode: ListeningMode
  /** Hakkın düşeceği süren deneme; yalnız `attempt` kipinde gönderilir. */
  attemptId?: string
  audience?: ResultAudience
  headingLevel?: 2 | 3 | 4
  className?: string
}

/** Oynatıcı hata verirse aynı bağlantıyla yeniden bağlanma sayısı (yeni istek atılmaz). */
const RECONNECT_LIMIT = 2

/**
 * Dinleme etkinliğinin kaydı (OG-052; IST-045, DOM-BEC-005, DOM-KYN-003, DOM-KYN-024): başlık,
 * seviye, kalan hak, oynatıcı, altyazı, döküm ve kaynak gösterimi. İçerik yüzeyi opaktır.
 *
 * Bağlantı kullanıcı "Kaydı dinle" deyince istenir; denemede `attemptId` ile istenir ve hak orada
 * sayılır. Bir dinleme bir bağlantı ömrüdür: oynatıcı koparsa bağlantı geçerliyken aynı adresle
 * yeniden bağlanır (yeni istek yok); sayfa yenilenince yeni istek aynı pencerede sayılmaz. Kayıt
 * çalarken bağlantı bitimine yaklaşılsa da oynatıcı kaldırılmaz. Hak bitince oynatıcı kilitlenir.
 * Sayılan dinleme deneme ayrıntısını eskitir (`useListeningUrlFetcher`). Sayaç `aria-live="polite"`
 * ile okunur, sınırsız hakta yoktur. Altyazı (`captionsVtt`) Blob adresiyle `<track>` olur ve
 * bölüm kapanınca adres bırakılır; `<audio>` altyazıyı çizmediğinden döküm açıkken etkin satır
 * oynatıcının altında opak satırda gösterilir (`aria-live="polite"`). Döküm yalnız açıkken
 * katlanır bölümdedir.
 */
export function ListeningRecording({
  recording,
  listening,
  mode,
  attemptId,
  audience = 'learner',
  headingLevel = 2,
  className,
}: Props) {
  const headingId = useId()
  const fetchUrl = useListeningUrlFetcher()
  const audioRef = useRef<HTMLAudioElement>(null)
  const reconnects = useRef(0)
  const [link, setLink] = useState<ListeningLink | null>(null)
  const [grant, setGrant] = useState<ListeningAllowance | null>(null)
  const [exhausted, setExhausted] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const [playError, setPlayError] = useState(false)
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [cue, setCue] = useState('')
  const now = useNow(link !== null, 5_000)
  // Altyazı satırı yalnız döküm açıkken gösterilir (DOM-BEC-005: döküm görev kapanmadan gizli).
  const showCaptions = recording.transcriptShown && !!recording.captionsVtt
  const captions = useCaptionsSource(recording.captionsVtt, showCaptions ? setCue : null)
  const [transcriptOpen, setTranscriptOpen] = useState(false)

  const allowance =
    mode === 'attempt' ? (grant ?? listeningAllowance(listening, recording.fileId)) : null
  const refusal =
    mode === 'review' ? (refused ?? reviewRefusal(audience, recording, listening)) : null
  const phase = listeningPhase({ mode, allowance, link, exhausted, refusal, audioPlaying, now })
  const playingUrl = phase.kind === 'playing' ? phase.url : null

  // Yeni bağlantı gelince oynatma başlatılır; tarayıcı izin vermezse oynatıcı düğmesi kalır.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || playingUrl === null) return
    reconnects.current = 0
    audio.play().then(
      () => setAutoplayBlocked(false),
      () => setAutoplayBlocked(true),
    )
  }, [playingUrl])

  async function listen() {
    // Geçerli bağlantı varken yeni istek atılmaz (aynı dinleme penceresi).
    if (linkUsable(link, Date.now())) return
    setPending(true)
    try {
      const result = await fetchUrl(
        recording.fileId,
        mode === 'attempt' && attemptId ? attemptId : undefined,
      )
      if (result.listening) setGrant(allowanceOf(result.listening))
      setRefused(null)
      setPlayError(false)
      setLink({ url: result.url, expiresAt: result.expiresAt })
    } catch (error) {
      const code = listeningErrorCode(error)
      if (mode === 'attempt' && code === 'listening_plays_exhausted') {
        setExhausted(true)
        return
      }
      if (mode === 'review' && code !== null && code !== 'file_processing') {
        setRefused(listeningErrorMessage(error))
        return
      }
      notify.error(listeningErrorMessage(error), error)
    } finally {
      setPending(false)
    }
  }

  /**
   * Oynatıcı koparsa bağlantı geçerliyken aynı adresle, kaldığı yerden yeniden bağlanır; yeni
   * bağlantı istenmez. Sınır aşılırsa sakin not çıkar, oynatıcı bağlantının ömrü boyunca kalır.
   */
  function reconnect(event: SyntheticEvent<HTMLAudioElement>) {
    const audio = event.currentTarget
    if (!linkUsable(link, Date.now()) || reconnects.current >= RECONNECT_LIMIT) {
      setAudioPlaying(false)
      setPlayError(true)
      return
    }
    reconnects.current += 1
    const position = audio.currentTime
    audio.load()
    audio.currentTime = position
    void audio.play().catch(() => setAutoplayBlocked(true))
  }

  const Heading = `h${headingLevel}` as const
  const played = allowance !== null && allowance.used > 0
  return (
    <section
      aria-labelledby={headingId}
      className={cn('panel rounded-card border bg-surface p-6 max-[650px]:p-4', className)}
    >
      <header className="mb-4 grid gap-2">
        <p className="text-xs font-medium text-muted-foreground">Dinleme kaydı</p>
        <Heading
          id={headingId}
          lang="en"
          className="text-lg font-semibold [overflow-wrap:anywhere]"
        >
          {recording.title}
        </Heading>
        {recording.cefrLevel ? (
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge text={`CEFR ${recording.cefrLevel}`} tone="purple" />
          </div>
        ) : null}
      </header>

      {allowance ? (
        <p aria-live="polite" className="mb-3 text-sm text-muted-foreground">
          {listeningCounterText(allowance)}
        </p>
      ) : null}

      {phase.kind === 'playing' ? (
        <div className="grid gap-2">
          <audio
            ref={audioRef}
            controls
            preload="auto"
            src={phase.url}
            aria-label={`Dinleme kaydı: ${recording.title}`}
            onError={reconnect}
            onPlay={() => setAudioPlaying(true)}
            onPause={() => setAudioPlaying(false)}
            onEnded={() => setAudioPlaying(false)}
            className="w-full"
          >
            {recording.captionsVtt ? (
              <track
                ref={captions}
                kind="captions"
                srcLang="en"
                label="İngilizce"
                default={!showCaptions}
              />
            ) : null}
          </audio>
          {showCaptions ? (
            <p
              aria-live="polite"
              aria-label="Altyazı"
              lang="en"
              className="min-h-10 rounded-md border bg-muted px-3 py-2 text-sm leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]"
            >
              {cue}
            </p>
          ) : null}
          {playError ? (
            <p role="status" className="text-xs text-muted-foreground">
              Kayıt oynatılamadı. Bağlantınızı kontrol edip oynatıcıdan yeniden deneyin.
            </p>
          ) : autoplayBlocked ? (
            <p className="text-xs text-muted-foreground">
              Kaydı başlatmak için oynatıcıdaki oynat düğmesine basın.
            </p>
          ) : null}
        </div>
      ) : phase.kind === 'locked' ? (
        <p role="status" className="flex items-center gap-2 text-sm">
          <Icon name="Lock" size={16} aria-hidden="true" />
          Dinleme hakkınız doldu; kayıt bu denemede yeniden açılmaz.
        </p>
      ) : phase.kind === 'unavailable' ? (
        <p role="status" className="text-sm text-muted-foreground">
          {phase.message}
        </p>
      ) : (
        <div className="grid gap-2">
          {phase.kind === 'resume' ? (
            <p className="text-xs text-muted-foreground">
              Yarım kalan dinlemeniz varsa sürdürebilirsiniz; yeni dinleme hakkı kullanılmaz.
            </p>
          ) : null}
          <Button
            type="button"
            className="justify-self-start"
            variant={phase.kind === 'resume' ? 'secondary' : 'default'}
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={() => void listen()}
          >
            <Icon name="Play" size={16} aria-hidden="true" />
            {phase.kind === 'resume'
              ? 'Dinlemeyi sürdür'
              : played
                ? 'Yeniden dinle'
                : 'Kaydı dinle'}
          </Button>
          {mode === 'attempt' && allowance && allowance.remaining > 0 ? (
            <p className="text-xs text-muted-foreground">
              Kaydı başlattığınızda bir dinleme hakkı kullanılır; sayfayı yenilemek yeni hak
              harcamaz.
            </p>
          ) : null}
        </div>
      )}

      {transcriptVisible(recording) ? (
        <Collapsible
          open={transcriptOpen}
          onOpenChange={setTranscriptOpen}
          className="mt-4 border-t pt-4"
        >
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="group px-2">
              <Icon
                name="ChevronDown"
                size={16}
                aria-hidden="true"
                className="group-data-[state=open]:rotate-180 motion-safe:transition-transform"
              />
              {transcriptOpen ? 'Dökümü gizle' : 'Dökümü göster'}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p
              lang="en"
              className="mt-2 max-w-prose text-base leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]"
            >
              {recording.transcript}
            </p>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {recording.attributions.length > 0 ? (
        <ul aria-label="Kaynak gösterimi" className="mt-4 grid gap-1 text-xs text-muted-foreground">
          {recording.attributions.map((item) => (
            <li key={`${item.work}:${item.author}:${item.source}`}>
              <span lang="en">{item.work}</span> — {item.author}, {item.source}
              {item.year ? ` (${item.year})` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/** Etkin altyazı satırlarının düz metni (VTT etiketleri, ör. `<v Tom>`, atılır). */
function activeCueText(track: TextTrack): string {
  return Array.from(track.activeCues ?? [])
    .map((cue) => (cue instanceof VTTCue ? cue.text : '').replace(/<[^>]*>/g, '').trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * Altyazıyı (`captionsVtt`) `<track>`'a Blob adresiyle bağlayan ref: adres öğe bağlanınca üretilir,
 * öğe kalkınca ya da metin değişince bırakılır (`revokeObjectURL`; React 19 ref temizliği).
 * `onCue` verilirse iz gizli kipte (`hidden`) etkinleşir ve etkin satır `cuechange` ile bildirilir;
 * `<audio>` altyazıyı kendisi çizmez.
 */
function useCaptionsSource(vtt: string | null, onCue: ((text: string) => void) | null) {
  return useCallback(
    (node: HTMLTrackElement | null) => {
      if (!node || !vtt) return
      const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
      node.src = url
      const track = node.track
      const update = () => onCue?.(activeCueText(track))
      if (onCue) {
        track.mode = 'hidden'
        track.addEventListener('cuechange', update)
      }
      return () => {
        track.removeEventListener('cuechange', update)
        onCue?.('')
        node.removeAttribute('src')
        URL.revokeObjectURL(url)
      }
    },
    [vtt, onCue],
  )
}
