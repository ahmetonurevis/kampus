import { RECORDING_MIN_SECONDS } from '@kampus/school-core/skills/submission.ts'

/**
 * Konuşma görevi kaydının saf durum makinesi (IST-051; DOM-BEC-002, 040, 050, 054). Tarayıcı
 * API'leri (mikrofon, MediaRecorder, zamanlayıcı, yükleme) `use-speaking-recorder.ts`'tedir; burada
 * yalnız geçişler, hak sayımı ve ekrana/ekran okuyucuya giden metin vardır. Saat `now` ile verilir.
 *
 * Akış: izin → hazırlık geri sayımı (görev ayarı `preparationSeconds`; atlanabilir) → kayıt (sınır
 * `speakingSeconds`, sınırda kendiliğinden durur) → dinleme → yeniden kayıt ya da gönderim
 * (yükleme → sunucuda işlenme → teslim). Sınırlar atamanın teslim ayarından gelir (core
 * `submissionSettingsSchema`); burada varsayılan tutulmaz.
 *
 * Deneme hakkı: sunucu gönderilen her kaydı bir deneme sayar (`allowance.remaining`). Ekranda
 * alınıp gönderilmeden atılan kayıt da bir denemedir: yeniden kayıt yalnız kalan hak yetiyorsa
 * açılır. Kullanıcının elinde olmayan kayıplar (1 saniyeden kısa kayıt, sunucunun reddettiği kayıt)
 * hak düşürmez. Atılan kayıt sayısı yalnız bu sayfada tutulur (ses ve sayı hiçbir yere yazılmaz).
 */

// TODO(konusma-deneme-sunucu): Kayıt başlatma sunucuda sayılmıyor; sayfa yenilenince atılan
// kayıt sayısı sıfırlanır. Sunucu yalnız gönderilen kaydı sayar (DOM-BEC-040, IST-051).

/**
 * Kayıt süre sınırından bu kadar önce durdurulur: kodlayıcı ve dönüşüm birkaç on milisaniye ekler,
 * sunucu ölçülen süre sınırı aşarsa kaydı reddeder (core `recording_too_long`, tolerans yok).
 */
export const RECORDING_STOP_MARGIN_MS = 500
/** Bundan kısa kayıt boştur (core `RECORDING_MIN_SECONDS`); gönderilmez, hak düşürmez. */
export const RECORDING_MIN_MS = RECORDING_MIN_SECONDS * 1000
/** Kayıt sonundaki "son saniyeler" duyurusu. */
export const FINAL_SECONDS = 10
/** Hazırlık bitmeden "kayıt birazdan başlıyor" duyurusu. */
export const PREPARATION_WARNING_SECONDS = 5

export type SpeakingLimits = {
  preparationSeconds: number
  speakingSeconds: number
}

/** Bellekteki kayıt; yalnız bu sayfada yaşar, kalıcı depoya yazılmaz (DOM-BEC-054). */
export type Take<TMedia = Blob> = {
  /** Kaydın içeriği: web `Blob`, mobil kayıt dosyasının adresi (`{ uri }`). */
  blob: TMedia
  durationMs: number
  mimeType: string
}

export type BlockReason = 'unsupported' | 'denied' | 'no_device' | 'failed' | 'consent'
export type SendStep = 'uploading' | 'processing' | 'submitting'

export type RecorderPhase<TMedia = Blob> =
  | { kind: 'idle'; notice: string | null }
  | { kind: 'requesting' }
  | { kind: 'blocked'; reason: BlockReason }
  | { kind: 'preparing'; endsAt: number }
  | { kind: 'starting' }
  | { kind: 'recording'; startedAt: number; stopAt: number; stop: 'user' | 'limit' | null }
  | { kind: 'recorded'; take: Take<TMedia>; autoStopped: boolean }
  | { kind: 'sending'; take: Take<TMedia>; step: SendStep; fileId: string | null }
  | { kind: 'send_failed'; take: Take<TMedia>; fileId: string | null; message: string }
  | { kind: 'submitted' }

export type RecorderState<TMedia = Blob> = {
  phase: RecorderPhase<TMedia>
  /** Bu sayfada alınıp gönderilmeden atılan kayıt sayısı (hak sayımı). */
  discarded: number
}

export type RecorderEvent<TMedia = Blob> =
  | { type: 'start'; remaining: number }
  | { type: 'granted'; now: number; preparationSeconds: number }
  | { type: 'blocked'; reason: BlockReason }
  | { type: 'preparation_over' }
  | { type: 'recorder_started'; now: number; speakingSeconds: number }
  | { type: 'stop'; by: 'user' | 'limit' }
  | { type: 'recorded'; take: Take<TMedia> }
  | { type: 'rerecord'; remaining: number }
  | { type: 'send' }
  | { type: 'uploaded'; fileId: string }
  | { type: 'file_ready' }
  | { type: 'file_rejected' }
  | { type: 'recording_rejected'; message: string }
  | { type: 'send_failed'; message: string }
  | { type: 'submitted' }
  | { type: 'reset' }

export const initialRecorderState: RecorderState<never> = {
  phase: { kind: 'idle', notice: null },
  discarded: 0,
}

export const TOO_SHORT_NOTICE =
  'Kayıt 1 saniyeden kısa olduğu için alınmadı. Deneme hakkınızdan düşülmedi; yeniden kaydedin.'
export const REJECTED_NOTICE =
  'Kaydınız işlenemedi: boş, sessiz ya da bozuk olabilir veya süre sınırını aşıyor olabilir. Deneme hakkınızdan düşülmedi; yeniden kaydedin.'

const holdsTake = (phase: RecorderPhase<unknown>) =>
  phase.kind === 'recorded' || phase.kind === 'sending' || phase.kind === 'send_failed'

/**
 * Yeni kayıt için kalan hak: sunucunun kalan hakkından bu sayfada atılan kayıtlar ve elde tutulan
 * (henüz gönderilmemiş) kayıt düşülür.
 */
export function takesLeft(state: RecorderState<unknown>, remaining: number): number {
  return Math.max(0, remaining - state.discarded - (holdsTake(state.phase) ? 1 : 0))
}

/** İzin istenip kayda başlanabilir mi (boşta ya da izin/mikrofon sorunu sonrası yeniden deneme). */
export function canStart(state: RecorderState<unknown>, remaining: number): boolean {
  const { kind } = state.phase
  const retryable =
    kind === 'blocked' && state.phase.reason !== 'unsupported' && state.phase.reason !== 'consent'
  return (kind === 'idle' || retryable) && takesLeft(state, remaining) >= 1
}

/** Elde tutulan kayıt atılıp yenisi alınabilir mi (atılan kayıt bir hak düşürür). */
export const canRerecord = (state: RecorderState<unknown>, remaining: number): boolean =>
  state.phase.kind === 'recorded' && takesLeft(state, remaining) >= 1

export function recorderReducer<TMedia = Blob>(
  state: RecorderState<TMedia>,
  event: RecorderEvent<TMedia>,
): RecorderState<TMedia> {
  const { phase } = state
  const to = (next: RecorderPhase<TMedia>, discarded = state.discarded): RecorderState<TMedia> => ({
    phase: next,
    discarded,
  })
  switch (event.type) {
    case 'start':
      return canStart(state, event.remaining) ? to({ kind: 'requesting' }) : state
    case 'granted':
      if (phase.kind !== 'requesting') return state
      return event.preparationSeconds > 0
        ? to({ kind: 'preparing', endsAt: event.now + event.preparationSeconds * 1000 })
        : to({ kind: 'starting' })
    case 'blocked':
      // Rıza her an geri çekilebilir: gönderim sırasında da kayıt durur (DOM-BEC-050).
      if (event.reason === 'consent') return to({ kind: 'blocked', reason: 'consent' })
      return phase.kind === 'requesting' || phase.kind === 'starting' || phase.kind === 'recording'
        ? to({ kind: 'blocked', reason: event.reason })
        : state
    case 'preparation_over':
      return phase.kind === 'preparing' ? to({ kind: 'starting' }) : state
    case 'recorder_started':
      return phase.kind === 'starting'
        ? to({
            kind: 'recording',
            startedAt: event.now,
            stopAt: event.now + event.speakingSeconds * 1000 - RECORDING_STOP_MARGIN_MS,
            stop: null,
          })
        : state
    case 'stop':
      return phase.kind === 'recording' && phase.stop === null
        ? to({ ...phase, stop: event.by })
        : state
    case 'recorded':
      if (phase.kind !== 'recording') return state
      return event.take.durationMs < RECORDING_MIN_MS
        ? to({ kind: 'idle', notice: TOO_SHORT_NOTICE })
        : to({ kind: 'recorded', take: event.take, autoStopped: phase.stop === 'limit' })
    case 'rerecord':
      return canRerecord(state, event.remaining)
        ? to({ kind: 'requesting' }, state.discarded + 1)
        : state
    case 'send':
      if (phase.kind === 'recorded')
        return to({ kind: 'sending', take: phase.take, step: 'uploading', fileId: null })
      if (phase.kind === 'send_failed')
        return to({
          kind: 'sending',
          take: phase.take,
          // Yüklenmiş kayıt yeniden yüklenmez: işlenmesi beklenir ve teslim yeniden denenir.
          step: phase.fileId === null ? 'uploading' : 'processing',
          fileId: phase.fileId,
        })
      return state
    case 'uploaded':
      return phase.kind === 'sending' && phase.step === 'uploading'
        ? to({ ...phase, step: 'processing', fileId: event.fileId })
        : state
    case 'file_ready':
      return phase.kind === 'sending' && phase.step === 'processing'
        ? to({ ...phase, step: 'submitting' })
        : state
    case 'file_rejected':
      return phase.kind === 'sending' ? to({ kind: 'idle', notice: REJECTED_NOTICE }) : state
    case 'recording_rejected':
      return phase.kind === 'sending'
        ? to({ kind: 'idle', notice: `${event.message} Deneme hakkınızdan düşülmedi.` })
        : state
    case 'send_failed':
      return phase.kind === 'sending'
        ? to({
            kind: 'send_failed',
            take: phase.take,
            fileId: phase.fileId,
            message: event.message,
          })
        : state
    case 'submitted':
      return phase.kind === 'sending' ? to({ kind: 'submitted' }) : state
    case 'reset':
      return phase.kind === 'submitted' ? to({ kind: 'idle', notice: null }) : state
    default:
      return event satisfies never
  }
}

// --- Gösterim ---------------------------------------------------------------------------------

/** Kalan süre (ms): hazırlıkta kayda, kayıtta durmaya kadar; diğer evrelerde `null`. */
export function phaseRemainingMs(phase: RecorderPhase<unknown>, now: number): number | null {
  if (phase.kind === 'preparing') return Math.max(0, phase.endsAt - now)
  if (phase.kind === 'recording') return Math.max(0, phase.stopAt - now)
  return null
}

/** Kayıtta geçen süre (ms). */
export const elapsedMs = (phase: RecorderPhase<unknown>, now: number): number =>
  phase.kind === 'recording' ? Math.max(0, now - phase.startedAt) : 0

/** "dk:sn" saati; yukarı yuvarlanır (geri sayım 0'a inmeden biter). */
export function clockLabel(ms: number, round: 'up' | 'down' = 'up'): string {
  const total = Math.max(0, round === 'up' ? Math.ceil(ms / 1000) : Math.floor(ms / 1000))
  const two = (value: number) => String(value).padStart(2, '0')
  return `${two(Math.floor(total / 60))}:${two(total % 60)}`
}

/** Süre sınırının okunur hâli: "45 saniye", "3 dakika", "1 dakika 30 saniye". */
export function durationLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes === 0) return `${rest} saniye`
  return rest === 0 ? `${minutes} dakika` : `${minutes} dakika ${rest} saniye`
}

export const BLOCK_MESSAGES: Record<BlockReason, string> = {
  unsupported:
    'Tarayıcınız ses kaydını desteklemiyor. Görevi güncel Chrome, Edge, Firefox ya da Safari ile açın.',
  denied:
    'Mikrofon izni verilmedi. Tarayıcının adres çubuğundaki site ayarlarından mikrofona izin verip yeniden deneyin.',
  no_device: 'Mikrofon bulunamadı. Bir mikrofon bağlayıp yeniden deneyin.',
  failed:
    'Mikrofon başlatılamadı; başka bir uygulama kullanıyor olabilir. Onu kapatıp yeniden deneyin.',
  consent:
    'Ses kaydı için gerekli onay bulunmuyor; bu görev öğretmeninizle yüz yüze değerlendirilecek. Bu yüzden puan kaybetmezsiniz.',
}

const SEND_MESSAGES: Record<SendStep, string> = {
  uploading: 'Kaydınız yükleniyor…',
  processing: 'Kaydınız işleniyor…',
  submitting: 'Kaydınız teslim ediliyor…',
}

/**
 * Canlı bölgenin (`aria-live`) metni: yalnız evre değişince ve eşik geçilince değişir; her saniye
 * duyurulmaz (geri sayım saati ayrı ve sessizdir).
 */
export function liveMessage(phase: RecorderPhase<unknown>, now: number): string {
  switch (phase.kind) {
    case 'idle':
      return phase.notice ?? ''
    case 'requesting':
      return 'Mikrofon izni isteniyor.'
    case 'blocked':
      return BLOCK_MESSAGES[phase.reason]
    case 'preparing':
      return phase.endsAt - now > PREPARATION_WARNING_SECONDS * 1000
        ? 'Hazırlık süresi başladı.'
        : 'Kayıt birazdan başlıyor.'
    case 'starting':
      return 'Kayıt başlıyor.'
    case 'recording':
      if (phase.stop !== null) return 'Kayıt durduruluyor.'
      return phase.stopAt - now > FINAL_SECONDS * 1000 ? 'Kayıt sürüyor.' : 'Son 10 saniye.'
    case 'recorded':
      return phase.autoStopped
        ? 'Süre sınırına ulaşıldı, kayıt durdu. Göndermeden önce dinleyebilirsiniz.'
        : 'Kayıt tamamlandı. Göndermeden önce dinleyebilirsiniz.'
    case 'sending':
      return SEND_MESSAGES[phase.step]
    case 'send_failed':
      return `${phase.message} Kaydınız bu sayfada duruyor; yeniden deneyebilirsiniz.`
    case 'submitted':
      return 'Kaydınız teslim edildi.'
    default:
      return phase satisfies never
  }
}
