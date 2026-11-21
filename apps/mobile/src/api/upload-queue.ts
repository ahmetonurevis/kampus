// Ödev teslimindeki dosya yükleme kuyruğunun saf durum makinesi. Dosyalar sırayla yüklenir (komut
// kilidi tek istek ister); kuyruk durumu `queued → uploading → done | failed` yolunu izler.
// Kurallar:
// - Yükleme sürerken eklenen dosya kuyruğa girer ve sırası gelince yüklenir (`drainQueue` her
//   dosyadan sonra kuyruğu yeniden okur).
// - Kuyruktan çıkarılan (`queued`) dosya yüklenmez; her yüklemeden önce dosyanın hâlâ kuyrukta
//   olduğu denetlenir. Yüklenmekte olan dosya çıkarılamaz.
// - Belirsiz hata (ağ, 5xx) kuyruğu durdurur, kalan dosyalar `queued` kalır; yeniden deneme
//   başarısız dosyayı ve ardındakileri sırayla yükler (aynı dosya aynı `Idempotency-Key` ile).
//   Kesin ret (4xx) yalnız o dosyayı `failed` yapar, kuyruk sürer.

export type QueueState = 'queued' | 'uploading' | 'failed' | 'done'

export type QueueItem = {
  key: string
  state: QueueState
  /** Yüklenen ya da önceki teslimdeki dosyanın sunucu kimliği. */
  fileId: string | null
  /** Başarısız yüklemenin Türkçe nedeni. */
  message: string | null
}

/** Yükleme sürüyor mu: gönderim ve dosya ekleme kilidi yalnız bu durumda kapanır. */
export const isUploading = (items: readonly QueueItem[]) =>
  items.some((item) => item.state === 'uploading')

/** Sıradaki yüklenecek dosya (listenin sırasıyla ilk `queued`). */
export const nextQueued = <T extends QueueItem>(items: readonly T[]): T | undefined =>
  items.find((item) => item.state === 'queued')

/** Yeni dosyaları kuyruğun sonuna ekler; anahtarı listede olan dosya atlanır. */
export function enqueue<T extends QueueItem>(items: readonly T[], added: readonly T[]): T[] {
  const seen = new Set(items.map((item) => item.key))
  const fresh = added.filter((item) => {
    if (seen.has(item.key)) return false
    seen.add(item.key)
    return true
  })
  return [...items, ...fresh.map((item) => ({ ...item, state: 'queued' as const }))]
}

/** Dosyayı çıkarır; yüklenmekte olan dosya çıkarılamaz (istek yarıda kalmasın). */
export const removeItem = <T extends QueueItem>(items: readonly T[], key: string): T[] =>
  items.filter((item) => item.key !== key || item.state === 'uploading')

/** Başarısız dosyayı yeniden sıraya alır; sıra listedeki yerindedir (ardındakilerin önünde). */
export const retryItem = <T extends QueueItem>(items: readonly T[], key: string): T[] =>
  items.map((item) =>
    item.key === key && item.state === 'failed'
      ? { ...item, state: 'queued' as const, message: null }
      : item,
  )

const update = <T extends QueueItem>(
  items: readonly T[],
  key: string,
  change: Partial<QueueItem>,
) => items.map((item) => (item.key === key ? { ...item, ...change } : item))

export type UploadResult =
  | { kind: 'done'; fileId: string; scanning: boolean }
  | { kind: 'failed'; message: string; retryable: boolean }

export type QueueIo<T extends QueueItem> = {
  read: () => readonly T[]
  write: (items: T[]) => void
  /** Dosyayı yükler; hata fırlatmaz, sonucu döndürür. */
  upload: (item: T) => Promise<UploadResult>
  /** `false` ise (pencere kapandı) sonuç yazılmaz ve kuyruk durur. */
  active: () => boolean
  /** Başarılı yüklemede satıra ek alan yazar (ör. tarama izleme). */
  onDone?: (item: T, result: Extract<UploadResult, { kind: 'done' }>) => Partial<T>
}

/**
 * Kuyruğu boşalana kadar sırayla yükler. Yazma eşzamanlıdır; aynı anda ikinci çağrı sürmekte olan
 * yükleme görünce hemen döner, süren çağrı sonradan eklenen dosyaları da işler.
 */
export async function drainQueue<T extends QueueItem>(io: QueueIo<T>): Promise<void> {
  for (;;) {
    const current = io.read()
    if (isUploading(current)) return
    const item = nextQueued(current)
    if (!item) return
    io.write(update(current, item.key, { state: 'uploading', message: null }))
    const result = await io.upload(item)
    if (!io.active()) return
    const latest = io.read()
    if (result.kind === 'done') {
      const extra = io.onDone?.(item, result) ?? {}
      io.write(
        latest.map((entry) =>
          entry.key === item.key
            ? { ...entry, ...extra, state: 'done' as const, fileId: result.fileId, message: null }
            : entry,
        ),
      )
    } else {
      io.write(update(latest, item.key, { state: 'failed', message: result.message }))
      if (result.retryable) return
    }
  }
}
