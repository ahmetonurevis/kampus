import {
  linkUsable,
  type AttemptListening,
  type ListeningAllowance,
  type ListeningErrorCode,
  type ListeningRecording,
} from '@kampus/react-shared/listening.ts'
import type { ResultAudience } from './student-task-model.ts'

/**
 * Dinleme bölümünün durumu (OG-052; IST-045, DOM-BEC-005). Saf; bileşen (`ListeningRecording`)
 * yalnız bağlar.
 *
 * - `attempt`: öğrencinin süren denemesi. Bağlantı `attemptId` ile istenir ve hak sayılır.
 * - `review`: sonuç ekranı, personel ve veli. `attemptId` gönderilmez, sayılmaz.
 *
 * Bağlantı geçerliyken (`linkUsable`) oynatıcı açıktır ve yeniden bağlanma yeni istek atmaz.
 * Kayıt çalarken bağlantının bitimine yaklaşılsa da oynatıcı kaldırılmaz (dinleme ortasında
 * kesilmez); duraklatılmışsa bitime 5 sn kala kapanır ve yeni dinleme istenir.
 * Denemede hak bitmiş görünse de son dinlemenin penceresi sürüyor olabilir (sayfa yenilendi):
 * öğrenci dinlemeyi sürdürmeyi dener, sunucu pencere içindeyse saymadan bağlantı verir, değilse
 * 422 `listening_plays_exhausted` döner ve oynatıcı kilitlenir.
 * Sonuç ekranında sunucunun geçici reddi (`listening_attempt_running`: aynı kaydı sınırlı hakla
 * bağlayan başka deneme sürüyor) notun altında "Yeniden dene" bırakır; o deneme bitince kayıt
 * buradan açılır (OG-998).
 */
export type ListeningMode = 'attempt' | 'review'

export interface ListeningLink {
  url: string
  expiresAt: string
}

export type ListeningPhase =
  /** Ana eylem "Kaydı dinle". */
  | { kind: 'idle' }
  /** Oynatıcı açık; bağlantı geçerli. */
  | { kind: 'playing'; url: string }
  /** Hak bitti; yenilemeden önce süren dinleme olabilir: "Dinlemeyi sürdür". */
  | { kind: 'resume' }
  /** Hak bitti ve son dinlemenin penceresi kapandı: oynatıcı kilitli. */
  | { kind: 'locked' }
  /**
   * Sonuç ekranında kayıt bu kişiye şimdi açılmaz (sakin not). `retry`: ret geçicidir, notun
   * altında "Yeniden dene" durur.
   */
  | { kind: 'unavailable'; message: string; retry: boolean }

export interface ListeningPhaseInput {
  mode: ListeningMode
  allowance: ListeningAllowance | null
  link: ListeningLink | null
  /** Sunucu hakkın bittiğini söyledi (422 `listening_plays_exhausted`). */
  exhausted: boolean
  /** Sonuç ekranında sunucunun reddi ya da kuralın kapattığı kayıt; metni gösterilir. */
  refusal: string | null
  /** Ret geçici mi (`reviewRetryable`); kuralın kapattığı kayıtta `false`. */
  retryable: boolean
  /** Oynatıcı şu an çalıyor (`!audio.paused`); çalarken oynatıcı kaldırılmaz. */
  audioPlaying: boolean
  now: number
}

export function listeningPhase(input: ListeningPhaseInput): ListeningPhase {
  if (input.link && (input.audioPlaying || linkUsable(input.link, input.now)))
    return { kind: 'playing', url: input.link.url }
  if (input.mode === 'review')
    return input.refusal === null
      ? { kind: 'idle' }
      : { kind: 'unavailable', message: input.refusal, retry: input.retryable }
  const spent = input.exhausted || (input.allowance !== null && input.allowance.remaining <= 0)
  if (!spent) return { kind: 'idle' }
  // Kendi bağlantısının süresi dolduysa pencere kapanmıştır; sunucuya sormaya gerek yok.
  if (input.exhausted || input.link !== null) return { kind: 'locked' }
  return { kind: 'resume' }
}

export const RECORDING_CLOSED_NOTE = 'Kayıt, görev kapanınca burada yeniden dinlenebilir.'

/**
 * Sonuç ekranında kayıt kime açılır (sunucu kuralının istemci yansıması; son söz sunucudadır):
 * personel her zaman; veli bağlantısı sayılmaz, her zaman; öğrenci sınırsız hakta ya da görev
 * kapanınca (döküm açık), aksi hâlde sınırlı hak açık görevde yalnız deneme içinde kullanılır.
 */
export function reviewRefusal(
  audience: ResultAudience,
  recording: Pick<ListeningRecording, 'transcriptShown'>,
  listening: AttemptListening,
): string | null {
  if (audience !== 'learner') return null
  if (listening === null || recording.transcriptShown) return null
  return RECORDING_CLOSED_NOTE
}

/**
 * Sonuç ekranında sunucunun reddi geçici mi: yalnız `listening_attempt_running` (süren sınırlı
 * deneme bitince ya da teslim edilince kayıt sayılmadan açılır). Diğer retler kalıcıdır ya da
 * kuralın kendisidir; yeniden denemek aynı yanıtı verir.
 */
export const reviewRetryable = (code: ListeningErrorCode | null) =>
  code === 'listening_attempt_running'

/** Döküm bölümü yalnız döküm açıkken ve metin varken çizilir. */
export const transcriptVisible = (
  recording: Pick<ListeningRecording, 'transcriptShown' | 'transcript'>,
) => recording.transcriptShown && !!recording.transcript?.trim()
