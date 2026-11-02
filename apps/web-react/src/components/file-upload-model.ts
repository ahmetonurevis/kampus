// Dosya yükleme alanının saf mantığı (`FileUploadField`; OG-224, ADR 0003, DOM-KYN-004): amaçtan
// `accept`, seçimin sığdırılması, sıralı yükleme kuyruğu, belirsiz hatada yeniden deneme kuyruğu ve
// yüklenen dosyanın güvenlik taraması beklemesi (OG-987, ADR 0003 karar 8).
// Çizimden ayrıdır; `node --test` ile sınanır.
import { keepsIdempotencyKey, type CommandOutcome } from '@kampus/react-shared/commands.ts'
import {
  FILE_REJECTED_MESSAGE,
  FILE_SCAN_WAIT_MESSAGE,
  fileBlocksAttach,
  type FileProcessing,
} from '@kampus/react-shared/files.ts'
import { fileIdentity, type UploadedFile } from '@kampus/react-shared/use-file-upload.ts'
import {
  FILE_PURPOSES,
  type FilePurpose,
  type FilePurposeRule,
} from '@kampus/school-core/content/taxonomy.ts'

/** Alanın listesindeki dosya; adı bilinmeyen (önceden bağlı) dosyayı çağıran çözer. */
export type FileUploadItem = {
  id: string
  name: string
  /** Yerel kimlik (`fileIdentity`): aynı dosyanın yeniden seçilmesini yakalar. */
  key?: string
}

/**
 * Alan meşgul mü: yükleme sürüyorsa, yeniden denenecek (ağ hatasıyla yarım kalmış) dosya varsa ya
 * da listedeki bir dosya henüz bağlanamıyorsa (taranıyor, tarama beklemesi doldu ya da taramada
 * reddedildi; `fileBlocksAttach`, OG-987). Meşgulken çağıran gönderim düğmesini açmaz; yoksa kayıt
 * eksik ya da hazır olmayan dosyayla gider. Tarayıcısız ortamın (`pending`) dosyası kilitlemez.
 */
export const isUploadBusy = (
  uploading: boolean,
  retryCount: number,
  fileStates: readonly FileProcessing[] = [],
) => uploading || retryCount > 0 || fileStates.some(fileBlocksAttach)

/**
 * Taraması izlenecek dosyalar: bu alanda yüklenip yanıtı `processing` gelen ve hâlâ listede
 * bulunan dosyalar (sıra listenin sırası). Önceden bağlı dosya ve `pending` yanıt izlenmez.
 */
export function scanWatchIds(
  items: readonly Pick<FileUploadItem, 'id'>[],
  scanning: ReadonlySet<string>,
): string[] {
  return items.flatMap((item) => (scanning.has(item.id) ? [item.id] : []))
}

/** Satırdaki tarama durumu: metin ve görünüm; hazır ya da izlenmeyen dosyada `null`. */
export type ScanRowView = { text: string; tone: 'muted' | 'danger'; retry: boolean }

export function scanRowView(state: FileProcessing | undefined): ScanRowView | null {
  switch (state) {
    case 'processing':
      return { text: 'Taranıyor…', tone: 'muted', retry: false }
    case 'timed_out':
      return { text: FILE_SCAN_WAIT_MESSAGE, tone: 'muted', retry: true }
    case 'rejected':
      return { text: FILE_REJECTED_MESSAGE, tone: 'danger', retry: false }
    default:
      return null
  }
}

/**
 * Alanın canlı bölgesinde (`aria-live`) duyurulan tarama özeti; en önemli durum önce: ret, süre
 * dolması, süren tarama, sonra taramadan geçiş. İzlenen dosya yoksa `null`.
 */
export function scanAnnouncement(states: readonly FileProcessing[]): string | null {
  if (states.length === 0) return null
  if (states.includes('rejected')) return FILE_REJECTED_MESSAGE
  if (states.includes('timed_out')) return FILE_SCAN_WAIT_MESSAGE
  if (states.includes('processing'))
    return 'Dosya güvenlik taramasında. Tarama bitince gönderebilirsiniz.'
  return states.every((state) => state === 'ready') ? 'Dosya güvenlik taramasından geçti.' : null
}

/** Amaca göre tarayıcı seçicisinin `accept` değeri; çekirdekteki tür tablosundan türetilir. */
export function acceptFor(purpose: FilePurpose): string {
  return FILE_PURPOSES[purpose].mimeTypes.join(',')
}

/** Seçilebilecek en çok dosya: çoklu seçimde amacın sınırı (yoksa 10), tekil seçimde 1. */
export function defaultMaxFiles(purpose: FilePurpose, multiple: boolean): number {
  if (!multiple) return 1
  const rule: FilePurposeRule = FILE_PURPOSES[purpose]
  return rule.maxFiles ?? 10
}

/**
 * Seçimi listeye sığdırır: aynı dosya (anahtarı listede ya da seçimde yinelenen) atlanır, kalan
 * yere sığmayan dosya bırakılır. Her ikisi sayı olarak döner (tek uyarıda bildirilir).
 */
export function fitFiles<T>(
  current: readonly Pick<FileUploadItem, 'id' | 'key'>[],
  picked: readonly T[],
  limit: number,
  identity: (item: T) => string = String,
): { accepted: T[]; dropped: number; duplicates: number } {
  const seen = new Set(current.flatMap((file) => (file.key === undefined ? [] : [file.key])))
  const unique = picked.filter((item) => {
    const key = identity(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const room = Math.max(0, limit - current.length)
  return {
    accepted: unique.slice(0, room),
    dropped: Math.max(0, unique.length - room),
    duplicates: picked.length - unique.length,
  }
}

/** Tek yükleme denemesinin kullanıcıya dönük sonucu. */
export type UploadAttempt =
  /** İstek atılmadan reddedildi (tür ya da boyut); Türkçe ileti alanda gösterilir. */
  | { kind: 'rejected'; message: string }
  | { kind: 'uploaded'; file: UploadedFile }
  /** Sunucu ya da ağ hatası. `retryable`: sonuç belirsiz, aynı dosya aynı anahtarla yeniden denenir. */
  | { kind: 'failed'; retryable: boolean }
  /** Önceki gönderim sürüyor; istek atılmadı. */
  | { kind: 'busy' }

/** `useFileUpload().upload` sonucu: amaç kuralına uymayan dosya ya da ortak komut sonucu. */
export type UploadOutcome = { ok: false; message: string } | CommandOutcome<{ data: UploadedFile }>

export function attemptFrom(outcome: UploadOutcome): UploadAttempt {
  if ('ok' in outcome) return { kind: 'rejected', message: outcome.message }
  switch (outcome.status) {
    case 'success':
      return { kind: 'uploaded', file: outcome.data.data }
    case 'busy':
      return { kind: 'busy' }
    case 'failed':
      return { kind: 'failed', retryable: keepsIdempotencyKey(outcome.error) }
    default:
      return outcome satisfies never
  }
}

export type UploadQueueInput = {
  queue: readonly File[]
  /** Listenin güncel hâli (yükleme sürerken çağıran güncelleyebilir). */
  current: () => readonly FileUploadItem[]
  upload: (file: File) => Promise<UploadAttempt>
  onUploaded: (item: FileUploadItem, file: UploadedFile) => void
  signal: AbortSignal
}

export type UploadQueueResult = {
  /** Dosya adıyla Türkçe uyarılar (reddedilen ve yinelenen dosyalar). */
  problems: string[]
  /**
   * Belirsiz hatada durulan dosya ve henüz denenmemiş kalanı. Başarısız dosya başta durur: kancanın
   * anahtarı son başarısız gövdeye aittir, yeniden denemede aynı `Idempotency-Key` gider.
   */
  retry: File[]
  /** Sinyal durdu (kullanıcı iptal etti ya da bileşen kalktı). */
  aborted: boolean
}

/**
 * Dosyaları sırayla yükler. Kesin red (tür, boyut, 4xx) dosyayı atlar ve sürer; belirsiz hata
 * (ağ, 5xx) kuyruğu durdurur ki yeniden deneme aynı dosyayla ve aynı anahtarla başlasın. Başarılı
 * dosya `onUploaded` ile bildirilir; listede zaten bulunan kayıt yeniden eklenmez.
 */
export async function runUploadQueue(input: UploadQueueInput): Promise<UploadQueueResult> {
  const problems: string[] = []
  const added = new Set<string>()
  for (const [index, file] of input.queue.entries()) {
    if (input.signal.aborted) return { problems, retry: [], aborted: true }
    const attempt = await input.upload(file)
    if (input.signal.aborted) return { problems, retry: [], aborted: true }
    if (attempt.kind === 'rejected') {
      problems.push(`${file.name}: ${attempt.message}`)
    } else if (attempt.kind === 'busy' || (attempt.kind === 'failed' && attempt.retryable)) {
      return { problems, retry: input.queue.slice(index), aborted: false }
    } else if (attempt.kind === 'uploaded') {
      const { id, originalName } = attempt.file
      if (added.has(id) || input.current().some((item) => item.id === id)) {
        problems.push(`${file.name}: bu dosya zaten ekli.`)
        continue
      }
      added.add(id)
      input.onUploaded(
        { id, name: originalName ?? file.name, key: fileIdentity(file) },
        attempt.file,
      )
    }
  }
  return { problems, retry: [], aborted: false }
}

/** Seçimin sığdırma sonucundan alan altındaki tek uyarı iletisi (yoksa `null`). */
export function pickProblems(
  problems: readonly string[],
  fit: { dropped: number; duplicates: number },
  limit: number,
): string | null {
  const all = [...problems]
  if (fit.duplicates > 0) all.push(`${fit.duplicates} dosya zaten ekli olduğu için atlandı.`)
  if (fit.dropped > 0) {
    all.push(`En fazla ${limit} dosya ekleyebilirsiniz; ${fit.dropped} dosya eklenmedi.`)
  }
  return all.length > 0 ? all.join(' ') : null
}

/**
 * Alanın altında görünen hata: dışarıdan gelen alan hatası (form doğrulaması, sunucu `files` hatası)
 * alanın eski uyarısını geçersiz kılar; yoksa alanın kendi uyarısı gösterilir.
 */
export function fieldError(
  problem: string | null,
  external: { message?: string } | undefined,
): { message: string } | undefined {
  if (external?.message) return { message: external.message }
  return problem !== null ? { message: problem } : undefined
}
