import type { KampusClient } from '@kampus/api-client/client.ts'
import { isApiError, type ApiError } from '@kampus/api-client/errors.ts'
import type { components } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'

/**
 * Yüklenmiş dosyanın okunması (ADR 0003 karar 4, 6): meta veri (`GET /files/:id`, özgün ad ve
 * boyut) ve kısa ömürlü imzalı indirme bağlantısı (`GET /files/:id/url`). Bağlı dosya bağlı
 * kaydın okuma kuralından geçer (ör. teslim: DOM-AKD-074). Teslim dosyasında her bağlantı üretimi
 * denetim kaydına yazılır; bu yüzden bağlantı önceden değil, kullanıcı dosyayı açınca istenir.
 */

export type StoredFile = components['schemas']['File']
export type FileUrl = components['schemas']['FileUrl']

export const fileItemKey = (fileId: string): unknown[] => ['files', 'item', fileId]

export function getFileRequest(client: KampusClient, fileId: string, signal?: AbortSignal) {
  return client.GET('/api/v1/files/{fileId}', {
    params: { path: { fileId } },
    ...(signal ? { signal } : {}),
  })
}

export function fileUrlRequest(client: KampusClient, fileId: string) {
  return client.GET('/api/v1/files/{fileId}/url', { params: { path: { fileId } } })
}

/** İmzalı bağlantıyı ister; hata `ApiError` olarak fırlar. */
export async function fetchFileUrl(client: KampusClient, fileId: string): Promise<FileUrl> {
  const body = await runRequest(() => fileUrlRequest(client, fileId))
  return body.data
}

/** Dosyanın gösterim adı: temizlenmiş özgün ad, yoksa sıra numarası. */
export function fileLabel(file: Pick<StoredFile, 'originalName'> | undefined, index: number) {
  return file?.originalName?.trim() || `Dosya ${index + 1}`
}

/**
 * Yüklenen dosyanın işlenme sonucu (ADR 0003 karar 8, 10; DOM-BEC-054; OG-987):
 *
 * - `processing` tarama ya da ses dönüşümü sürüyor (ilk yanıt gelmeden de böyle sayılır);
 * - `pending` tarayıcı kapalı ortam (`FILE_SCANNER=off`, yalnız üretim dışı): dosya kendiliğinden
 *   hazır olmaz, yoklama yapılmaz; bağlama bugünkü gibi denenir, kararı sunucu verir;
 * - `ready` kullanıma hazır;
 * - `rejected` sunucu dosyayı reddetti ya da sildi: taramada reddedilen dosyada yükleyen 422
 *   `file_rejected` alır (Sabah kararı 42), ses dönüşümünün reddettiği kayıt okumada görünmez (404);
 *   nedeni istemciye dönmez;
 * - `failed` başka bir okuma hatası (yetki, modül);
 * - `timed_out` bekleme üst süresi doldu, sonuç hâlâ belli değil.
 *
 * Ağ ve sunucu hatası beklemeyi bozmaz: dosya hâlâ işleniyor olabilir.
 */
export type FileProcessing =
  'processing' | 'pending' | 'ready' | 'rejected' | 'failed' | 'timed_out'

/**
 * İşlenmeyi bekleme üst süresi; yalnız sekme görünürken geçen süre sayılır (`waitRemainingMs`).
 * Aşılınca yoklama durur (`timed_out`), `fileId` korunur.
 */
export const FILE_WAIT_LIMIT_MS = 120_000

/**
 * `timedOut` bekleme süresi dolduysa `true`: sonuç hâlâ belli değilse (`processing`) `timed_out`
 * döner. Dosya bu arada hazır, reddedilmiş, tarayıcısız ya da okunamıyorsa o sonuç korunur.
 */
export function fileProcessing(
  file: Pick<StoredFile, 'status'> | undefined,
  error: unknown,
  timedOut = false,
): FileProcessing {
  if (file?.status === 'ready') return 'ready'
  if (file?.status === 'pending') return 'pending'
  if (file?.status === 'rejected' || file?.status === 'deleted') return 'rejected'
  if (isApiError(error) && error.status === 404) return 'rejected'
  if (isApiError(error) && error.code === 'file_rejected') return 'rejected'
  if (isApiError(error) && error.status >= 400 && error.status < 500) return 'failed'
  return timedOut ? 'timed_out' : 'processing'
}

/** İlk yoklama aralığı; tarama ve dönüşüm çoğunlukla birkaç saniye sürer. */
export const FILE_POLL_INTERVAL_MS = 1500
/** Geri çekilen aralığın üst sınırı. */
export const FILE_POLL_MAX_INTERVAL_MS = 10_000

/**
 * Yoklama yalnız dosya işlenirken sürer; sonuç belli olunca (hazır, ret, tarayıcısız, hata) ya da
 * bekleme üst süresi dolunca durur. Aralık her okumada 1,5 kat geri çekilir (`attempt`: o ana kadar
 * yapılan okuma sayısı), `FILE_POLL_MAX_INTERVAL_MS`'yi geçmez.
 */
export function filePollInterval(
  file: Pick<StoredFile, 'status'> | undefined,
  error: unknown,
  timedOut = false,
  attempt = 0,
): number | false {
  if (fileProcessing(file, error, timedOut) !== 'processing') return false
  const backoff = FILE_POLL_INTERVAL_MS * 1.5 ** Math.max(0, attempt - 1)
  return Math.min(FILE_POLL_MAX_INTERVAL_MS, Math.round(backoff))
}

/**
 * Bekleme saati: yalnız sekme görünürken (`visibleSince` dolu) süre işler. Saf değerdir; kanca
 * görünürlük değişince `pauseWaitClock`/`resumeWaitClock` ile yenisini üretir.
 */
export interface WaitClock {
  /** Önceki görünür aralıklarda geçen süre. */
  spentMs: number
  /** Sekme şu an görünürse görünür olduğu an; gizliyse `null`. */
  visibleSince: number | null
}

export const startWaitClock = (now: number, visible: boolean): WaitClock => ({
  spentMs: 0,
  visibleSince: visible ? now : null,
})

export function pauseWaitClock(clock: WaitClock, now: number): WaitClock {
  if (clock.visibleSince === null) return clock
  return { spentMs: clock.spentMs + Math.max(0, now - clock.visibleSince), visibleSince: null }
}

export function resumeWaitClock(clock: WaitClock, now: number): WaitClock {
  return clock.visibleSince === null ? { ...clock, visibleSince: now } : clock
}

/** Bekleme üst süresinden kalan; sekme gizliyken azalmaz. `0` süre doldu demektir. */
export function waitRemainingMs(clock: WaitClock, now: number, limitMs = FILE_WAIT_LIMIT_MS) {
  const running = clock.visibleSince === null ? 0 : Math.max(0, now - clock.visibleSince)
  return Math.max(0, limitMs - clock.spentMs - running)
}

/**
 * Dosyanın bağlanmaya engel olup olmadığı: işlenen, süresi dolan ve reddedilen dosya formun
 * gönderimini kilitler; hazır, tarayıcısız (`pending`, bugünkü gibi sunucu karar verir) ve
 * okunamayan (`failed`, bağlamada sunucu yanıtlar) dosya kilitlemez.
 */
export const fileBlocksAttach = (state: FileProcessing) =>
  state === 'processing' || state === 'timed_out' || state === 'rejected'

export const FILE_SCAN_WAIT_MESSAGE = 'Dosyanız güvenlik taramasında, birazdan yeniden deneyin.'
export const FILE_REJECTED_MESSAGE =
  'Dosya güvenlik taramasından geçmedi. Başka bir dosya yükleyin.'

/** Dosya bağlama kodları (422): bağlayan formda dosya alanının altında gösterilir. */
export const FILE_ATTACH_CODES = ['file_not_ready', 'file_rejected'] as const

/**
 * Formun `fieldFor`'u (`routeCommandErrors`): bağlamada 422 `file_not_ready` ya da `file_rejected`
 * dosya alanına (`field`) yazılır, toast çıkmaz. Diğer hatalarda `fallback` sorulur.
 */
export function fileAttachField(
  field: string,
  fallback?: (error: ApiError) => string | undefined,
): (error: ApiError) => string | undefined {
  return (error) =>
    error.status === 422 && (FILE_ATTACH_CODES as readonly string[]).includes(error.code)
      ? field
      : fallback?.(error)
}
