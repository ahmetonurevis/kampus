// Öğrenci konuşma görevi (OG-064; IST-051; DOM-BEC-002, 040, 050, 054) saf kararları: görev
// telefonda kaydedilebilir mi, kayıt sınırları, kaydın yükleme ve teslim istekleri, hata sınıfı ve
// Türkçe metinleri. Kayıt durum makinesi, süre ve etiket işlevleri web ile ortaktır
// (`@kampus/react-shared/speaking-recorder-model.ts`); burada yalnız telefonun kararları vardır.
// Kural sunucudadır (rıza, süre ölçümü, deneme hakkı); buradaki karar yalnız geçersiz isteği
// göndermemek ve hatayı doğru metne çevirmek içindir. Ses cihazın önbelleğinden başka yere yazılmaz
// ve AsyncStorage'a hiçbir şey girmez (DOM-BEC-054).
import type { ApiError } from '@kampus/api-client/errors.ts'
import { commandFeedback } from '@kampus/react-shared/commands.ts'
import type { FileProcessing } from '@kampus/react-shared/files.ts'
import {
  BLOCK_MESSAGES,
  liveMessage,
  type BlockReason,
  type RecorderEvent,
  type RecorderPhase,
  type SpeakingLimits,
  type Take,
} from '@kampus/react-shared/speaking-recorder-model.ts'
import { isSpeakingTask } from '@kampus/react-shared/task-labels.ts'
import type { TaskAssignmentLearner } from '@kampus/react-shared/use-task-assignments.ts'
import {
  TASK_SUBMISSION_MESSAGES,
  type SubmitTaskSubmissionInput,
} from '@kampus/react-shared/use-task-submissions.ts'
import { canonicalMimeType } from '@kampus/school-core/content/taxonomy.ts'
import type { PickedFile } from './homework-submission.ts'

/** Sunucudaki dosya amacı; rıza (`speaking_recording`) bu amaca bağlıdır. */
export const SPEAKING_RECORDING_PURPOSE = 'speaking_recording'

// --- Görev ayarı -------------------------------------------------------------------------

type Submission = NonNullable<TaskAssignmentLearner['submission']>
export type SpeakingSettings = Extract<Submission, { submissionKind: 'audio' }>

/** Görevin ses teslimi ayarı; konuşma görevi değilse `null`. */
export function speakingSettings(
  assignment: Pick<TaskAssignmentLearner, 'submission'>,
): SpeakingSettings | null {
  const settings = assignment.submission
  return settings?.submissionKind === 'audio' ? settings : null
}

/** Telefonda kaydedilebilir: ses teslimi bekleyen görev (süre ve hak görev ayarından gelir). */
export const canRecordOnPhone = (assignment: Pick<TaskAssignmentLearner, 'submission'>): boolean =>
  isSpeakingTask(assignment) && speakingSettings(assignment) !== null

/** Kayıt süreleri atamanın teslim ayarından gelir; burada varsayılan tutulmaz. */
export const speakingLimits = (settings: SpeakingSettings): SpeakingLimits => ({
  preparationSeconds: settings.preparationSeconds,
  speakingSeconds: settings.speakingSeconds,
})

/**
 * Yeni kayıt için kalan hak: sunucunun `allowance.remaining` değeri; ayrıntı okunmadıysa görevin
 * en düşük sınırından (sürüm ve konuşma denemesi) gönderilen teslim sayısı düşülür.
 */
export function speakingRemaining(
  settings: SpeakingSettings,
  allowanceRemaining: number | null | undefined,
  versionCount: number,
): number {
  if (typeof allowanceRemaining === 'number') return Math.max(0, allowanceRemaining)
  return Math.max(0, Math.min(settings.maxVersions, settings.speakingAttempts) - versionCount)
}

// --- Kayıt dosyası -----------------------------------------------------------------------

/** Telefondaki kayıt: `blob` alanında kayıt dosyasının adresi tutulur (önbellekte, geçici). */
export type PhoneRecordingMedia = { uri: string }
export type PhoneTake = Take<PhoneRecordingMedia>
export type PhoneRecorderEvent = RecorderEvent<PhoneRecordingMedia>

/** Telefonun kaydettiği biçim (AAC, m4a); webde Expo tarayıcı kaydı webm üretir. */
export const PHONE_RECORDING_MIME = 'audio/mp4'

export function phoneTake(
  uri: string,
  durationMs: number,
  mimeType = PHONE_RECORDING_MIME,
): PhoneTake {
  return { blob: { uri }, durationMs, mimeType }
}

/** Yüklenen dosyanın adı: uzantı içerikle tutarlı olmalı (sunucu `file_type_mismatch`). */
export function recordingFileName(mimeType: string): string {
  const canonical = canonicalMimeType(mimeType)
  const extension = canonical === 'audio/mpeg' ? 'mp3' : canonical === 'audio/webm' ? 'webm' : 'm4a'
  return `konusma-kaydi.${extension}`
}

/**
 * Elde tutulan kayıt değişince ya da bırakılınca (yeniden kayıt, sıfırlama, ret, teslim) artık
 * kullanılmayan önceki dosya: silinmesi gereken adres, yoksa `null`.
 */
export function staleRecordingUri(previous: string | null, next: string | null): string | null {
  return previous !== null && previous !== next ? previous : null
}

/** Pencerenin kapatılma durumu: serbest, gönderilmemiş kayıt var ya da kayıt gönderiliyor. */
export type LeaveGuard = 'free' | 'unsent' | 'sending'

export function leaveGuard(phase: RecorderPhase<unknown>): LeaveGuard {
  if (phase.kind === 'sending') return 'sending'
  return phase.kind === 'preparing' ||
    phase.kind === 'starting' ||
    phase.kind === 'recording' ||
    'take' in phase
    ? 'unsent'
    : 'free'
}

export const recordingPickedFile = (take: PhoneTake): PickedFile => ({
  uri: take.blob.uri,
  name: recordingFileName(take.mimeType),
  size: null,
  mimeType: take.mimeType,
})

/**
 * Kaydı `speaking_recording` amacıyla yükleyen istek; mevcut yükleyicinin (`submission-files.ts`
 * `SubmissionUploadInput`) girdisiyle aynı biçimdedir. Yükleyici react-native'e bağlı olduğundan
 * tip burada yinelenir (saf model Node testinde yüklenebilir kalır).
 */
export type SpeakingUploadInput = {
  file: PickedFile
  purpose: typeof SPEAKING_RECORDING_PURPOSE
  signal?: AbortSignal
}

export const speakingUploadInput = (
  take: PhoneTake,
  signal?: AbortSignal,
): SpeakingUploadInput => ({
  file: recordingPickedFile(take),
  purpose: SPEAKING_RECORDING_PURPOSE,
  ...(signal ? { signal } : {}),
})

/** Yüklenip işlenen kaydın teslim isteği: `{ submissionKind: 'audio', recordingFileId }`. */
export const speakingSubmitInput = (
  assignmentId: string,
  recordingFileId: string,
): SubmitTaskSubmissionInput => ({
  assignmentId,
  submission: { submissionKind: 'audio', recordingFileId },
})

// --- Kayıt işlenme sonucu ----------------------------------------------------------------

export const FAILED_UPLOAD_TEXT = 'Kaydınız gönderilemedi.'
export const STILL_PROCESSING_TEXT = 'Kaydınız hâlâ işleniyor; birazdan yeniden deneyin.'
export const SPEAKING_DONE_TEXT = 'Konuşma kaydınız teslim edildi.'

/**
 * Sunucudaki kaydın işlenme durumunun kayıt makinesindeki karşılığı (web `settle` ile aynı):
 * `null` beklemeye devam, `'submit'` teslim edilir, diğerleri makineye gönderilecek olaydır.
 * `pending` (tarayıcısız ortam) teslim denenir; kararı sunucu verir.
 */
export function settleOutcome(state: FileProcessing): PhoneRecorderEvent | 'submit' | null {
  switch (state) {
    case 'processing':
      return null
    case 'timed_out':
      return { type: 'send_failed', message: STILL_PROCESSING_TEXT }
    case 'rejected':
    case 'missing':
      return { type: 'file_rejected' }
    case 'failed':
      return { type: 'send_failed', message: FAILED_UPLOAD_TEXT }
    case 'ready':
    case 'pending':
      return 'submit'
    default:
      return state satisfies never
  }
}

// --- Hata sınıfı -------------------------------------------------------------------------

/**
 * - `consent`: ses kaydı rızası yok; kayıt kapanır, görev yüz yüze değerlendirilir.
 * - `recording`: kayıt reddedildi (boş, süre sınırını aştı, dosya kullanılamıyor); hak düşmez,
 *   yeniden kayıt alınır.
 * - `limit`: deneme hakkı doldu.
 * - `closed`: teslim süresi doldu ya da teslim kilitli.
 * - `duplicate`: kayıt zaten gönderilmiş; teslim kaybolmadı, ekran tazelenir.
 * - `processing`: kayıt henüz işleniyor; aynı kayıtla yeniden denenir.
 * - `network`: ağ ya da sunucu hatası; istek işlenmiş olabilir, aynı anahtarla yeniden denenir.
 * - `other`: sunucunun Türkçe mesajıyla gösterilir (kurum dosya kotası dolu dahil: kayıt değil
 *   kurum sorunudur, yeniden kayıt çözmez).
 */
export type SpeakingFailureKind =
  'consent' | 'recording' | 'limit' | 'closed' | 'duplicate' | 'processing' | 'network' | 'other'

export type SpeakingFailure = {
  kind: SpeakingFailureKind
  message: string
  /** Kayıt makinesine giden olay. */
  event: PhoneRecorderEvent
}

const RECORDING_CODES = new Set([
  'recording_empty',
  'recording_too_long',
  'file_unavailable',
  'file_rejected',
  'file_type_mismatch',
  'file_type_not_allowed',
  'file_too_large',
  'file_too_long',
])
const CLOSED_CODES = new Set([
  'submission_closed',
  'submission_locked',
  'resubmission_not_requested',
  'submission_not_expected',
  'submission_kind_mismatch',
])

/** Çevrimiçi hata kodundan sınıf; adım `upload` ise 413 ve 422 kayıt reddidir. */
export function classifySpeakingError(
  error: ApiError,
  step: 'upload' | 'submit' = 'submit',
): SpeakingFailureKind {
  if (error.isNetworkError || error.status >= 500) return 'network'
  if (error.code === 'idempotency_in_progress') return 'network'
  if (error.code === 'consent_required') return 'consent'
  if (error.code === 'version_limit_reached') return 'limit'
  if (error.code === 'file_already_attached') return 'duplicate'
  if (error.code === 'file_not_ready') return 'processing'
  if (CLOSED_CODES.has(error.code)) return 'closed'
  if (RECORDING_CODES.has(error.code)) return 'recording'
  if (error.code === 'storage_quota_exceeded') return 'other'
  if (step === 'upload' && (error.status === 413 || error.status === 422)) return 'recording'
  return 'other'
}

const EXTRA_MESSAGES = {
  file_too_large: 'Kayıt çok büyük; daha kısa bir kayıt alın.',
  storage_quota_exceeded: 'Kurumunuzun dosya depolama alanı doldu. Yöneticinize başvurun.',
  file_rejected:
    'Kaydınız işlenemedi: boş, sessiz ya da bozuk olabilir. Deneme hakkınızdan düşülmedi; yeniden kaydedin.',
} as const

/** Hatanın ekrandaki Türkçe metni, sınıfı ve kayıt makinesi olayı; teknik ayrıntı gösterilmez. */
export function speakingFailure(
  error: ApiError,
  step: 'upload' | 'submit' = 'submit',
): SpeakingFailure {
  const kind = classifySpeakingError(error, step)
  const known =
    commandFeedback(error, { ...TASK_SUBMISSION_MESSAGES, ...EXTRA_MESSAGES }).message ??
    FAILED_UPLOAD_TEXT
  const message = kind === 'network' ? FAILED_UPLOAD_TEXT : known
  switch (kind) {
    case 'consent':
      return { kind, message, event: { type: 'blocked', reason: 'consent' } }
    case 'recording':
      return { kind, message, event: { type: 'recording_rejected', message } }
    case 'limit':
    case 'closed':
    case 'duplicate':
    case 'other':
      return { kind, message, event: { type: 'send_failed', message } }
    case 'processing':
    case 'network':
      return { kind, message, event: { type: 'send_failed', message } }
    default:
      return kind satisfies never
  }
}

// --- Telefon metinleri ---------------------------------------------------------------------

/**
 * Engel metinleri: ortak `BLOCK_MESSAGES`'ın tarayıcıya özgü iki iletisi (`unsupported`, `denied`)
 * telefon için yeniden yazılır; rıza, mikrofon yok ve başlatılamadı iletileri aynıdır.
 */
export const PHONE_BLOCK_MESSAGES: Record<BlockReason, string> = {
  ...BLOCK_MESSAGES,
  unsupported: 'Bu cihaz ses kaydını desteklemiyor. Görevi web sürümünden çözün.',
  denied:
    'Mikrofon izni verilmedi. Telefonun Ayarlar > Uygulamalar bölümünden mikrofona izin verip yeniden deneyin.',
}

/** Canlı bölge metni: ortak `liveMessage`, engel evresinde telefon metinleriyle. */
export const phoneLiveMessage = (phase: RecorderPhase<unknown>, now: number): string =>
  phase.kind === 'blocked' ? PHONE_BLOCK_MESSAGES[phase.reason] : liveMessage(phase, now)

/** İzin yanıtından engel nedeni; izin verildiyse `null`. */
export const permissionBlock = (granted: boolean): BlockReason | null => (granted ? null : 'denied')

/**
 * Sayaç için ekran okuyucu etiketi: görünen saat her saniye değişir, etiket yalnız dakikada bir
 * (son dakikada on saniyede bir) değişir; böylece her saniye okunmaz.
 */
export function recordingClockSpoken(remainingMs: number, what: 'Hazırlık' | 'Kayıt'): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000))
  if (seconds <= 60) return `${what}: kalan ${Math.ceil(seconds / 10) * 10} saniye`
  return `${what}: kalan ${Math.ceil(seconds / 60)} dakika`
}
