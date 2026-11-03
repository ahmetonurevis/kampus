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

export interface FileUrlOptions {
  /**
   * Dinleme hakkının düşeceği süren deneme (IST-045, DOM-BEC-005): yalnız öğrenci kendi süren
   * denemesinde gönderir. Sonuç ekranında, personelde ve velide verilmez; sunucu personel ve
   * velide yok sayar.
   */
  attemptId?: string | undefined
}

export function fileUrlRequest(client: KampusClient, fileId: string, options: FileUrlOptions = {}) {
  const { attemptId } = options
  return client.GET('/api/v1/files/{fileId}/url', {
    params: { path: { fileId }, ...(attemptId ? { query: { attemptId } } : {}) },
  })
}

/** İmzalı bağlantıyı ister; hata `ApiError` olarak fırlar. */
export async function fetchFileUrl(
  client: KampusClient,
  fileId: string,
  options: FileUrlOptions = {},
): Promise<FileUrl> {
  const body = await runRequest(() => fileUrlRequest(client, fileId, options))
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
 * - `rejected` taramada reddedilen dosya: yükleyen 422 `file_rejected` alır (Sabah kararı 42);
 *   nedeni istemciye dönmez;
 * - `missing` dosya artık bulunamıyor (404 ya da `deleted`): bağlanmamış dosya 24 saat sonra
 *   silinir, ses dönüşümünün reddettiği kayıt da okumada görünmez. Varlık ipucu verilmediğinden
 *   sunucu ikisini ayırmaz; ileti nötrdür (`FILE_MISSING_MESSAGE`), "taramadan geçmedi" denmez;
 * - `failed` başka bir okuma hatası (yetki, modül, oturum);
 * - `timed_out` bekleme üst süresi doldu, sonuç hâlâ belli değil.
 *
 * Ağ, sunucu ve hız sınırı (429) hatası beklemeyi bozmaz: dosya hâlâ işleniyor olabilir, yoklama
 * geri çekilerek sürer. 401 `failed` sayılır: yoklama durur, oturum katmanı
 * (`createKampusQueryClient` `onUnauthenticated`) girişe yönlendirir; sürdürmek her aralıkta yeni 401
 * üretirdi.
 */
export type FileProcessing =
  'processing' | 'pending' | 'ready' | 'rejected' | 'missing' | 'failed' | 'timed_out'

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
  if (file?.status === 'rejected') return 'rejected'
  if (file?.status === 'deleted') return 'missing'
  if (isApiError(error) && error.code === 'file_rejected') return 'rejected'
  if (isApiError(error) && error.status === 404) return 'missing'
  // Hız sınırı geçicidir: sonuç belli değil, yoklama geri çekilerek sürer (aşağıda `processing`).
  const throttled = isApiError(error) && error.status === 429
  if (!throttled && isApiError(error) && error.status >= 400 && error.status < 500) return 'failed'
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

/** Sorgunun o ana kadarki okuma sayısı (başarılı + hatalı); geri çekilmenin ham sayacı. */
export const queryReads = (state: { dataUpdateCount: number; errorUpdateCount: number }) =>
  state.dataUpdateCount + state.errorUpdateCount

/** Bekleme denetçisinin dış bağımlılıkları; testte sahte saat ve görünürlük verilir. */
export interface WaitDeadlineDeps {
  now: () => number
  /** Sekme (uygulama) şu an görünür mü. */
  visible: () => boolean
  /** Görünürlük değişimine abone olur; aboneliği bitiren işlev döner. */
  subscribe: (listener: (visible: boolean) => void) => () => void
  setTimer: (run: () => void, ms: number) => unknown
  clearTimer: (timer: unknown) => void
  /** Süresi dolan kimlikler değişince (sıra izlenen listenin sırası). */
  onExpired: (ids: readonly string[]) => void
  limitMs?: number
}

export interface WaitDeadlines {
  /** İzlenen kimlikler: yeni kimliğin saati başlar, listeden çıkanın saati ve sayacı silinir. */
  sync: (ids: readonly string[]) => void
  /** Kimliğin saatini ve geri çekilme sayacını sıfırlar (yeniden deneme). */
  restart: (id: string) => void
  /**
   * Geri çekilmede kullanılacak deneme sayısı: sorgunun okuma sayısı (`queryReads`) eksi kimliğin
   * tabanı. Taban kimlik ilk sorulduğunda ve her `restart`'tan sonra o anki okuma sayısıdır; böylece
   * önbellekte birikmiş sayaç (yeniden deneme, aynı kimliğin yeniden izlenmesi) aralığı büyütmez.
   */
  attempt: (id: string, reads: number) => number
  expired: () => readonly string[]
  /** Zamanlayıcıyı ve görünürlük aboneliğini bırakır; sonraki `sync` yeniden abone olur. */
  dispose: () => void
}

/**
 * Bekleme üst süresi denetçisi (`useWaitDeadlines`'ın saf çekirdeği; OG-987): kimlik başına
 * görünür süreyi tutar, en yakın dolma anına tek zamanlayıcı kurar. Sekme gizliyken zamanlayıcı
 * kurulmaz ve süre işlemez; görününce kalan süreyle sürer.
 */
export function createWaitDeadlines(deps: WaitDeadlineDeps): WaitDeadlines {
  const limitMs = deps.limitMs ?? FILE_WAIT_LIMIT_MS
  const entries = new Map<string, { clock: WaitClock; expired: boolean }>()
  const bases = new Map<string, number>()
  let ids: readonly string[] = []
  let published: readonly string[] = []
  let timer: unknown = undefined
  let unsubscribe: (() => void) | null = null

  const publish = () => {
    const next = ids.filter((id) => entries.get(id)?.expired === true)
    if (next.length === published.length && next.every((id, i) => published[i] === id)) return
    published = next
    deps.onExpired(next)
  }
  const stopTimer = () => {
    if (timer !== undefined) deps.clearTimer(timer)
    timer = undefined
  }
  const schedule = () => {
    stopTimer()
    const now = deps.now()
    let next = Infinity
    for (const entry of entries.values()) {
      if (entry.expired || entry.clock.visibleSince === null) continue
      const left = waitRemainingMs(entry.clock, now, limitMs)
      if (left === 0) entry.expired = true
      else next = Math.min(next, left)
    }
    publish()
    if (next !== Infinity) timer = deps.setTimer(schedule, next)
  }
  const onVisibility = (visible: boolean) => {
    const now = deps.now()
    for (const entry of entries.values())
      entry.clock = visible ? resumeWaitClock(entry.clock, now) : pauseWaitClock(entry.clock, now)
    schedule()
  }
  const start = () => ({ clock: startWaitClock(deps.now(), deps.visible()), expired: false })

  return {
    sync(next) {
      ids = [...next]
      for (const id of [...entries.keys()]) if (!ids.includes(id)) entries.delete(id)
      for (const id of [...bases.keys()]) if (!ids.includes(id)) bases.delete(id)
      for (const id of ids) if (!entries.has(id)) entries.set(id, start())
      unsubscribe ??= deps.subscribe(onVisibility)
      schedule()
    },
    restart(id) {
      bases.delete(id)
      if (!ids.includes(id)) return
      entries.set(id, start())
      schedule()
    },
    attempt(id, reads) {
      const base = bases.get(id)
      if (base === undefined || base > reads) {
        bases.set(id, reads)
        return 0
      }
      return reads - base
    },
    expired: () => published,
    dispose() {
      stopTimer()
      unsubscribe?.()
      unsubscribe = null
    },
  }
}

/**
 * Dosyanın bağlanmaya engel olup olmadığı: işlenen, süresi dolan, reddedilen ve artık bulunmayan
 * dosya formun gönderimini kilitler; hazır, tarayıcısız (`pending`, bugünkü gibi sunucu karar
 * verir) ve okunamayan (`failed`, bağlamada sunucu yanıtlar) dosya kilitlemez.
 */
export const fileBlocksAttach = (state: FileProcessing) =>
  state === 'processing' || state === 'timed_out' || state === 'rejected' || state === 'missing'

export const FILE_SCAN_WAIT_MESSAGE = 'Dosyanız güvenlik taramasında, birazdan yeniden deneyin.'
export const FILE_REJECTED_MESSAGE =
  'Dosya güvenlik taramasından geçmedi. Başka bir dosya yükleyin.'
/** 404: dosya silinmiş ya da bulunamıyor; nedeni bilinmediğinden nötr ileti. */
export const FILE_MISSING_MESSAGE = 'Dosya artık bulunamadı. Yeniden yükleyin.'

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
