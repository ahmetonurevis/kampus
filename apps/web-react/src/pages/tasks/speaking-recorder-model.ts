import type { BlockReason } from '@kampus/react-shared/speaking-recorder-model.ts'

/**
 * Tarayıcıya özgü kayıt yardımcıları (MediaRecorder biçimi, getUserMedia hata adı). Durum makinesi,
 * limitler ve metinler platformdan bağımsızdır: `@kampus/react-shared/speaking-recorder-model.ts`.
 */

// --- Tarayıcı yardımcıları (saf) -----------------------------------------------------------------

/**
 * Kayıt biçimi: sunucunun kabul ettiği türlerden tarayıcının kaydedebildiği ilki (core
 * `FILE_PURPOSES.speaking_recording`: webm, m4a, mp3). Chrome/Edge/Firefox webm (Opus), Safari mp4
 * (AAC) kaydeder. Hiçbiri yoksa `null` (desteklenmiyor).
 */
export const RECORDING_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
] as const

export function pickRecordingMime(isTypeSupported: (type: string) => boolean): string | null {
  return RECORDING_MIME_CANDIDATES.find((type) => isTypeSupported(type)) ?? null
}

/** Yüklenen dosyanın adı: uzantı içerikle tutarlı olmalı (sunucu `file_type_mismatch`). */
export function recordingFileName(mimeType: string): string {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  const extension = base === 'audio/mp4' ? 'm4a' : base === 'audio/mpeg' ? 'mp3' : 'webm'
  return `konusma-kaydi.${extension}`
}

/** `getUserMedia` hatasının nedeni (DOMException adı); ayrıntı kullanıcıya gösterilmez. */
export function mediaErrorReason(error: unknown): BlockReason {
  const name = error instanceof Error || error instanceof DOMException ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'denied'
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'DevicesNotFoundError':
      return 'no_device'
    default:
      return 'failed'
  }
}
