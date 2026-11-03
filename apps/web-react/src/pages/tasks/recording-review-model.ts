import { isApiError } from '@kampus/api-client/errors.ts'
import type { TaskSubmissionDetail } from '@kampus/react-shared/use-task-submissions.ts'
import { clockLabel } from './speaking-recorder-model.ts'
import type { ResultAudience } from './student-task-model.ts'

/**
 * Konuşma teslimini dinleme ve değerlendirmenin saf sunum kuralları (IST-052; DOM-BEC-021, 045,
 * 052, 053). Kayıt sürüme bağlı `speaking_recording` dosyasıdır; dinleme kısa ömürlü imzalı
 * bağlantıyla ve yalnız kullanıcı istediğinde açılır (her bağlantı üretimi denetim kaydıdır).
 * Erişim kararı sunucudadır; burada yalnız gösterim ve metin vardır.
 */

type Version = TaskSubmissionDetail['versions'][number]
export type SubmissionFile = Version['files'][number]

/** Oynatma hızları (yavaşlatma dinlemeyi kolaylaştırır); varsayılan 1. */
export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5] as const
export type PlaybackRate = (typeof PLAYBACK_RATES)[number]
export const DEFAULT_PLAYBACK_RATE: PlaybackRate = 1

/** "0,75×", "1×" (Türkçe ondalık virgülü). */
export const playbackRateLabel = (rate: number) =>
  `${rate.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}×`

/** Seçim kutusundan gelen değeri bilinen hıza oturtur; bilinmeyen değer varsayılana döner. */
export function parsePlaybackRate(value: string): PlaybackRate {
  const rate = Number(value)
  return PLAYBACK_RATES.find((item) => item === rate) ?? DEFAULT_PLAYBACK_RATE
}

/** Sürümün konuşma kaydı; konuşma dışı (metin, el yazısı) sürümde `null`. */
export function versionRecording(version: Pick<Version, 'files'>): SubmissionFile | null {
  return version.files.find((file) => file.purpose === 'speaking_recording') ?? null
}

/** Teslim konuşma teslimi mi: herhangi bir sürümünde kayıt var. */
export const isSpeakingSubmission = (versions: readonly Pick<Version, 'files'>[]) =>
  versions.some((version) => versionRecording(version) !== null)

export type RecordingView =
  { kind: 'ready'; duration: string | null } | { kind: 'unavailable'; message: string }

/**
 * Kaydın dinlenebilirliği: `ready` dinlenir; `processing` henüz ölçülmedi; `deleted` saklama
 * süresi dolup imha edildi (DOM-BEC-052: süre ve puan kalır, ses kalmaz).
 */
export function recordingView(file: Pick<SubmissionFile, 'status' | 'durationMs'>): RecordingView {
  const duration = file.durationMs === null ? null : clockLabel(file.durationMs, 'down')
  switch (file.status) {
    case 'ready':
      return { kind: 'ready', duration }
    case 'processing':
      return { kind: 'unavailable', message: 'Kayıt işleniyor; birazdan dinlenebilir.' }
    case 'deleted':
      return {
        kind: 'unavailable',
        message: `Kayıt saklama süresi dolduğu için silindi${duration ? ` (süresi ${duration})` : ''}; puan ve geri bildirim korunur.`,
      }
    default:
      return file.status satisfies never
  }
}

const RECORDING_TITLES = {
  learner: 'Kaydınız',
  staff: 'Öğrencinin kaydı',
  parent: 'Çocuğunuzun kaydı',
} as const satisfies Record<ResultAudience, string>

/** Oynatıcının erişilebilir adı: kim için ve hangi sürüm ("Sürüm 2 · Öğrencinin kaydı"). */
export const recordingTitle = (audience: ResultAudience, versionNumber: number) =>
  `Sürüm ${versionNumber} · ${RECORDING_TITLES[audience]}`

/**
 * Bağlantı alınamayınca gösterilen metin: 404 kaydın bu kişiye açık olmadığını ya da artık
 * bulunmadığını söyler (DOM-BEC-053: varlığı sızdırılmaz), diğer hatalar geçicidir.
 */
export function recordingOpenError(error: unknown): string {
  if (isApiError(error) && (error.status === 404 || error.status === 403))
    return 'Bu kayda erişilemiyor.'
  return 'Kayıt açılamadı. Biraz sonra yeniden deneyin.'
}

/** Bağlantının süresi dolunca oynatıcı yeniden bağlantı ister. */
export const RECORDING_EXPIRED =
  'Dinleme bağlantısının süresi doldu. Yeniden dinlemek için düğmeye basın.'

/**
 * Konuşmada hangi denemenin puanlandığı (DOM-BEC-021, 024; IST-052): puan yalnız son gönderilen
 * sürüme verilir (core `planRubricScore` eski sürümü reddeder); önceki kayıtlar
 * karşılaştırma için dinlenir. Tek sürümde açıklama gerekmez (`null`).
 */
export function gradedVersionNote(versions: readonly Pick<Version, 'number'>[]): string | null {
  if (versions.length < 2) return null
  const latest = Math.max(...versions.map((version) => version.number))
  return `Yalnız son gönderilen kayıt (Sürüm ${latest}) puanlanır; önceki kayıtlar karşılaştırma için dinlenebilir.`
}
