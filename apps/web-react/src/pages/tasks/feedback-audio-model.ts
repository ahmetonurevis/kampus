import { FEEDBACK_AUDIO_SECONDS } from '@kampus/school-core/skills/recording.ts'
import type { FileProcessing } from '@kampus/react-shared/files.ts'
import {
  REJECTED_NOTICE,
  TOO_SHORT_NOTICE,
  clockLabel,
  durationLabel,
  type BlockReason,
  type RecorderPhase,
  type SendStep,
  type SpeakingLimits,
} from './speaking-recorder-model.ts'

/**
 * Öğretmenin sesli geri bildiriminin saf kuralları (IST-052; DOM-BEC-056). Kayıt, konuşma
 * görevinin kayıt makinesiyle (`speaking-recorder-model.ts`) alınır: hazırlık yok, sınır core
 * `FEEDBACK_AUDIO_SECONDS`, deneme hakkı yok. Kayıt bitince kendiliğinden yüklenir, sunucuda
 * işlenmesi beklenir ve puan gövdesine `feedbackAudioFileId` olarak eklenir; dosyayı puana sunucu
 * puanla aynı işlemde bağlar. Ses isteğe bağlıdır, yazılı genel geri bildirim yine zorunludur.
 */

/** Hazırlıksız, sınırı core'dan gelen kayıt. */
export const FEEDBACK_AUDIO_LIMITS: SpeakingLimits = {
  preparationSeconds: 0,
  speakingSeconds: FEEDBACK_AUDIO_SECONDS,
}

/** Deneme hakkı yoktur; kayıt makinesinin hak sayımı bu değerle hiç dolmaz. */
export const FEEDBACK_AUDIO_TAKES = Number.MAX_SAFE_INTEGER

/** Formun gördüğü değer: ses yok, hazırlanıyor (puan kaydı bekler) ya da hazır dosya. */
export type FeedbackAudioValue =
  { kind: 'none' } | { kind: 'pending' } | { kind: 'ready'; fileId: string }

export const NO_FEEDBACK_AUDIO: FeedbackAudioValue = { kind: 'none' }

/**
 * Kayıt evresinden formun değeri: kayıt yokken (boşta, izin reddi) `none`; kayıt, yükleme ve
 * işlenme sürerken ya da yükleme başarısızken `pending`. İşlenen dosya makinede gönderimin son
 * adımında (`submitting`) bekler: teslimi puan kaydı yapar, dosya `ready` olur.
 */
export function feedbackAudioValue(phase: RecorderPhase): FeedbackAudioValue {
  if (phase.kind === 'sending' && phase.step === 'submitting' && phase.fileId !== null)
    return { kind: 'ready', fileId: phase.fileId }
  if (phase.kind === 'idle' || phase.kind === 'blocked' || phase.kind === 'submitted')
    return NO_FEEDBACK_AUDIO
  return { kind: 'pending' }
}

/** Puan gövdesine giden kimlik; ses yoksa alan hiç gönderilmez. */
export const feedbackAudioBody = (value: FeedbackAudioValue) =>
  value.kind === 'ready' ? { feedbackAudioFileId: value.fileId } : {}

/** Ses hazırlanırken puan kaydedilmez: yarım kalan ses sessizce düşmesin. */
export const PENDING_FEEDBACK_AUDIO =
  'Sesli geri bildirim hazır olunca puanı kaydedebilirsiniz; istemiyorsanız sesi silin.'

/**
 * Dosya işlenmesinin sonucu (`useFileProcessing`): hazır (ya da tarayıcısız ortamda `pending`:
 * kararı sunucu verir) dosya eklenir; ret ve kayıp yeniden kayıt ister; bekleme süresi ve hata
 * yeniden denenir. `processing` henüz sonuç değildir (`null`).
 */
export function processingOutcome(
  state: FileProcessing,
): 'ready' | 'rejected' | 'retry' | 'still_processing' | null {
  switch (state) {
    case 'processing':
      return null
    case 'ready':
    case 'pending':
      return 'ready'
    case 'rejected':
    case 'missing':
      return 'rejected'
    case 'timed_out':
      return 'still_processing'
    case 'failed':
      return 'retry'
    default:
      return state satisfies never
  }
}

export const FEEDBACK_UPLOAD_FAILED = 'Sesli geri bildirim yüklenemedi.'
export const FEEDBACK_STILL_PROCESSING =
  'Sesli geri bildirim hâlâ işleniyor; birazdan yeniden deneyin.'

/** Öğretmene dönük izin ve mikrofon iletileri (rıza sorulmaz: ses öğretmenindir). */
export const FEEDBACK_BLOCK_MESSAGES: Record<BlockReason, string> = {
  unsupported:
    'Tarayıcınız ses kaydını desteklemiyor; yazılı geri bildirimle puanlayabilirsiniz. Sesli geri bildirim için güncel Chrome, Edge, Firefox ya da Safari kullanın.',
  denied:
    'Mikrofon izni verilmedi; yazılı geri bildirimle puanlayabilirsiniz. Sesli geri bildirim için adres çubuğundaki site ayarlarından mikrofona izin verip yeniden deneyin.',
  no_device: 'Mikrofon bulunamadı. Bir mikrofon bağlayıp yeniden deneyin.',
  failed:
    'Mikrofon başlatılamadı; başka bir uygulama kullanıyor olabilir. Onu kapatıp yeniden deneyin.',
  consent: 'Sesli geri bildirim kaydı alınamadı.',
}

const NOTICES = new Map([
  [TOO_SHORT_NOTICE, 'Ses 1 saniyeden kısa olduğu için alınmadı; yeniden kaydedin.'],
  [
    REJECTED_NOTICE,
    `Ses işlenemedi: boş, sessiz ya da bozuk olabilir veya ${durationLabel(FEEDBACK_AUDIO_SECONDS)} sınırını aşıyor olabilir. Yeniden kaydedin.`,
  ],
])

const SENDING_MESSAGES: Record<SendStep, string> = {
  uploading: 'Sesli geri bildirim yükleniyor…',
  processing: 'Sesli geri bildirim işleniyor…',
  submitting: 'Sesli geri bildirim hazır; puanla birlikte kaydedilecek.',
}

/**
 * Canlı bölgenin metni (`aria-live`): evre değişince değişir, her saniye duyurulmaz. Kayıt
 * makinesinin kursiyere dönük iletileri burada öğretmene göre yazılır.
 */
export function feedbackLiveMessage(phase: RecorderPhase): string {
  switch (phase.kind) {
    case 'idle':
      return phase.notice === null ? '' : (NOTICES.get(phase.notice) ?? phase.notice)
    case 'requesting':
      return 'Mikrofon izni isteniyor.'
    case 'blocked':
      return FEEDBACK_BLOCK_MESSAGES[phase.reason]
    case 'preparing':
    case 'starting':
      return 'Kayıt başlıyor.'
    case 'recording':
      return phase.stop === null ? 'Sesli geri bildirim kaydediliyor.' : 'Kayıt durduruluyor.'
    case 'recorded':
      return 'Sesli geri bildirim yükleniyor…'
    case 'sending':
      return SENDING_MESSAGES[phase.step]
    case 'send_failed':
      return `${phase.message} Ses bu pencerede duruyor; yeniden deneyebilir ya da silebilirsiniz.`
    case 'submitted':
      return ''
    default:
      return phase satisfies never
  }
}

/** Kaydın yanındaki süre: "Süre 00:42 / 03:00". */
export const feedbackClock = (elapsedMs: number) =>
  `${clockLabel(elapsedMs, 'down')} / ${clockLabel(FEEDBACK_AUDIO_SECONDS * 1000)}`

/** Puan kartındaki ve sürüm listesindeki oynatıcının adı. */
export const FEEDBACK_AUDIO_TITLE = 'Öğretmenin sesli geri bildirimi'
