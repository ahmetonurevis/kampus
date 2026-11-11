import type { KampusClient } from '@kampus/api-client/client.ts'

import { collectionKeyPrefix } from './collections.ts'

/**
 * Video izleme ilerlemesi (`POST /videos/{videoId}/progress`, IST-041; DOM-KYN-005) saf
 * yardımcıları: istek kurucu, yazma sıklığını sınırlayan raporlayıcı ve kaldığı yerden devam
 * konumu. Kanca `use-video-progress.ts`'tedir; oynatıcıya bağlama (DOM olayları) web uygulamasındadır.
 * Burası React ve tarayıcı olmadan sınanır.
 */

/** Oynatırken ilerlemenin en sık gönderildiği aralık (ms); her `timeupdate` gönderilmez. */
export const VIDEO_PROGRESS_INTERVAL_MS = 15_000

/** Bitişe bu kadar saniye kala kalınan yer "bitmiş" sayılır: devam yerine baştan başlanır. */
export const VIDEO_RESUME_END_MARGIN_SECONDS = 3

/** İlerleme yazmaları `videoProgress` koleksiyon okumalarını (liste, panel yüzdesi) tazeler. */
export const VIDEO_PROGRESS_INVALIDATES = [collectionKeyPrefix('videoProgress')] as const

export interface VideoProgressSample {
  /** Oynatıcının konumu (saniye). */
  positionSeconds: number
  /** Oynatıcının bildirdiği süre (saniye). */
  durationSeconds: number
}

export interface RecordVideoProgressInput extends VideoProgressSample {
  videoId: string
}

/**
 * Öğrencinin kendi ilerlemesini yazar; gövdesiz kimlik oturumdan gelir, `If-Match` yoktur.
 * `keepalive`: sekme/pencere kapanırken (`pagehide`, sekme gizlenmesi) istek sayfadan sonra da
 * sürsün diye `fetch` seçeneği olarak geçer; çerez ve `Origin` kuralları normal istekle aynıdır.
 */
export function recordVideoProgressRequest(
  client: KampusClient,
  input: RecordVideoProgressInput,
  options: { keepalive?: boolean } = {},
) {
  return client.POST('/api/v1/videos/{videoId}/progress', {
    params: { path: { videoId: input.videoId } },
    body: { positionSeconds: input.positionSeconds, durationSeconds: input.durationSeconds },
    ...(options.keepalive ? { keepalive: true } : {}),
  })
}

const usable = (sample: VideoProgressSample) =>
  Number.isFinite(sample.positionSeconds) &&
  sample.positionSeconds >= 0 &&
  Number.isFinite(sample.durationSeconds) &&
  sample.durationSeconds > 0

export interface VideoProgressReporter {
  /** Oynatıcı konum olayı (`timeupdate`): aralık dolduysa gönderir, yoksa yalnız son örneği tutar. */
  tick(sample: VideoProgressSample): void
  /**
   * Duraklatma, bitiş, kapanış ve sekme gizlenmesi: son örneği (ya da verileni) hemen gönderir.
   * Son gönderilenle aynı konumda ve hiç oynatılmamışsa gönderilmez. `closing`: sayfa kapanıyor
   * ya da gizleniyor; `sendOnClose` verilmişse (keepalive'lı istek) onunla gönderilir.
   */
  flush(sample?: VideoProgressSample, options?: { closing?: boolean }): void
}

export interface VideoProgressReporterOptions {
  send: (sample: VideoProgressSample) => void
  /** Sayfa kapanırken gönderici (`keepalive`); yoksa `send` kullanılır. */
  sendOnClose?: (sample: VideoProgressSample) => void
  intervalMs?: number
  /** Saat (ms); test için. */
  now?: () => number
  /** Açılışta oynatıcının konumlandığı yer: aynı konum yeniden gönderilmez. */
  initialPositionSeconds?: number
}

/**
 * Yazma sıklığını sınırlar: oynatırken en çok `intervalMs`'de bir gönderir; duraklatma, bitiş ve
 * kapanışta `flush` ile hemen. Aynı (yuvarlanmış) konum art arda gönderilmez. Hata yönetimi
 * göndericinindir (ilerleme sakin bir yan kayıttır, tekrar denenmez).
 */
export function createVideoProgressReporter(
  options: VideoProgressReporterOptions,
): VideoProgressReporter {
  const interval = options.intervalMs ?? VIDEO_PROGRESS_INTERVAL_MS
  const now = options.now ?? Date.now
  let latest: VideoProgressSample | null = null
  let lastSentAt: number | null = null
  let lastSentPosition: number | null =
    options.initialPositionSeconds === undefined ? null : Math.round(options.initialPositionSeconds)

  function send(sample: VideoProgressSample, closing = false) {
    lastSentAt = now()
    lastSentPosition = Math.round(sample.positionSeconds)
    if (closing && options.sendOnClose) options.sendOnClose(sample)
    else options.send(sample)
  }

  return {
    tick(sample) {
      if (!usable(sample)) return
      latest = sample
      // Sayaç ilk konum olayında başlar: kısa izleme kapanışta gönderilir.
      lastSentAt ??= now()
      if (now() - lastSentAt >= interval && Math.round(sample.positionSeconds) !== lastSentPosition)
        send(sample)
    },
    flush(sample, flushOptions) {
      const next = sample ?? latest
      if (next === null || !usable(next)) return
      latest = next
      if (Math.round(next.positionSeconds) === lastSentPosition) return
      send(next, flushOptions?.closing === true)
    },
  }
}

export interface ResumeSource {
  /** Kayıtlı en yüksek yüzde (0–100). */
  progress: number
  /** Kayıtlı son konum (saniye); eski ve örnek kayıtlarda yoktur. */
  positionSeconds?: number | undefined
}

/**
 * Oynatıcının açılışta gideceği konum (saniye). Son konum varsa o, yoksa (eski kayıt) yüzdeden
 * türetilir. Konum yoksa, tamamlanmış ya da bitişe çok yakınsa baştan başlanır (0).
 */
export function resumePosition(source: ResumeSource, playerDurationSeconds: number): number {
  if (!Number.isFinite(playerDurationSeconds) || playerDurationSeconds <= 0) return 0
  const stored =
    source.positionSeconds !== undefined
      ? source.positionSeconds
      : source.progress > 0 && source.progress < 100
        ? (playerDurationSeconds * source.progress) / 100
        : 0
  if (!Number.isFinite(stored) || stored <= 0) return 0
  return stored >= playerDurationSeconds - VIDEO_RESUME_END_MARGIN_SECONDS ? 0 : stored
}
