// Öğrenci ödev teslimi (`screens/homework-submission.tsx`) saf kararları: teslim edilebilir mi,
// seçilen dosya yüklenebilir mi, teslim gönderilebilir mi, hata hangi Türkçe metne döner. Kural
// sunucudadır (core `submitHomework`, DOM-AKD-072); buradaki karar yalnız geçersiz işlemi
// göstermemek ve dosyayı yüklemeden önce elemek içindir. Dosya yükleme tablosu core
// `FILE_PURPOSES.submission`'dır (ADR 0003 karar 3).
import type { ApiError } from '@kampus/api-client/errors.ts'
import { commandFeedback, keepsIdempotencyKey } from '@kampus/react-shared/commands.ts'
import { fileBlocksAttach, type FileProcessing } from '@kampus/react-shared/files.ts'
import {
  HOMEWORK_MESSAGES,
  submitHomeworkBody,
  type HomeworkListItem,
  type HomeworkSubmission,
  type SubmitHomeworkBody,
} from '@kampus/react-shared/homework.ts'
import {
  assertFileAllowed,
  canonicalMimeType,
  MIME,
  type AllowedMimeType,
} from '@kampus/school-core/content/taxonomy.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import {
  acceptsLate,
  isHomeworkClosed,
  SUBMISSION_FILE_LIMIT,
  SUBMISSION_NOTE_MAX_LENGTH,
} from '@kampus/school-core/lib/homework.ts'
import type { QueueItem } from './upload-queue.ts'

export { SUBMISSION_FILE_LIMIT, SUBMISSION_NOTE_MAX_LENGTH }

// --- Teslim edilebilir mi ----------------------------------------------------------------

/**
 * Teslim durumu (DOM-AKD-072): son teslimden önce açık; sonra ödev geç teslime açıksa geç olarak
 * kabul edilir, değilse kapalı. Puanlanmış teslim kilitlidir.
 */
export type SubmissionAvailability = 'open' | 'late' | 'closed' | 'graded'

export function submissionAvailability(
  homework: Pick<HomeworkListItem, 'dueDate' | 'allowLate'>,
  submission: Pick<HomeworkSubmission, 'score'> | undefined,
  now: Date,
): SubmissionAvailability {
  if (submission && submission.score != null) return 'graded'
  if (!isHomeworkClosed(homework, now.toISOString())) return 'open'
  return acceptsLate(homework) ? 'late' : 'closed'
}

/** Teslim formu yalnız açık ve geç teslime açık ödevde çıkar. */
export const canSubmitHomework = (availability: SubmissionAvailability) =>
  availability === 'open' || availability === 'late'

// --- Dosya -------------------------------------------------------------------------------

/** Seçiciden gelen dosya; yükleme bitene kadar yalnız cihazdadır, kalıcı yazılmaz. */
export type PickedFile = {
  uri: string
  name: string
  /** Bayt; seçici bildirmezse `null` (boyut denetimi sunucuya kalır). */
  size: number | null
  /** Seçicinin bildirdiği tür; boşsa uzantıdan çıkarılır. */
  mimeType: string | null
}

const EXTENSION_TYPES: Readonly<Record<string, AllowedMimeType>> = {
  pdf: MIME.pdf,
  jpg: MIME.jpeg,
  jpeg: MIME.jpeg,
  png: MIME.png,
  webp: MIME.webp,
  docx: MIME.docx,
}

/** Dosyanın kanonik türü: bildirilen tür, yoksa uzantı; tanınmazsa `null`. */
export function resolveMimeType(
  file: Pick<PickedFile, 'name' | 'mimeType'>,
): AllowedMimeType | null {
  const declared = file.mimeType ? canonicalMimeType(file.mimeType) : null
  if (declared) return declared
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return Object.hasOwn(EXTENSION_TYPES, extension) ? (EXTENSION_TYPES[extension] ?? null) : null
}

/**
 * Yüklemeden önce amaç kuralı (core `assertFileAllowed`, amaç `submission`): uymayan dosyanın
 * Türkçe iletisi, uyan dosyada `null`. Sunucu içerikten yeniden denetler.
 */
export function pickedFileProblem(file: PickedFile): string | null {
  const contentType = resolveMimeType(file)
  if (contentType === null)
    return `${file.name}: PDF, Word (.docx) ya da görsel (JPG, PNG, WebP) dosyası seçin.`
  if (file.size === 0) return `${file.name}: dosya boş.`
  try {
    assertFileAllowed('submission', {
      contentType,
      // Boyutu bildirilmeyen dosyada boyut karar sunucuya kalır.
      byteSize: file.size ?? 1,
    })
    return null
  } catch (error) {
    if (error instanceof DomainError) return `${file.name}: ${error.message}`
    throw error
  }
}

/** Seçilen dosyanın yerel kimliği: aynı dosyanın yeniden eklenmesini yüklemeden önce yakalar. */
export const pickedFileKey = (file: Pick<PickedFile, 'uri' | 'name' | 'size'>) =>
  [file.name, file.size ?? '', file.uri].join('|')

/**
 * Formdaki dosya satırı: yeni seçilen (`file` dolu) ya da önceki teslimden gelen. Kuyruk alanları
 * (`state`, `fileId`, `message`) `upload-queue.ts` durum makinesindendir.
 */
export type SubmissionItem = QueueItem & {
  name: string
  file: PickedFile | null
  /** Bu oturumda yüklendi ve güvenlik taraması izleniyor. */
  scanning: boolean
}

/** Yeni seçilen dosyanın kuyruk satırı (sırada). */
export const queuedItem = (file: PickedFile): SubmissionItem => ({
  key: pickedFileKey(file),
  name: file.name,
  file,
  state: 'queued',
  fileId: null,
  scanning: false,
  message: null,
})

export const previousItem = (fileId: string): SubmissionItem => ({
  key: `onceki:${fileId}`,
  name: '',
  file: null,
  state: 'done',
  fileId,
  scanning: false,
  message: null,
})

export type PickResult = { accepted: PickedFile[]; problems: string[] }

/**
 * Seçimi listeye sığdırır: türü/boyutu uymayan, listede zaten bulunan ve sınıra sığmayan dosya
 * atlanır; her biri Türkçe uyarı olur.
 */
export function fitPicked(
  current: readonly Pick<SubmissionItem, 'key'>[],
  picked: readonly PickedFile[],
  limit = SUBMISSION_FILE_LIMIT,
): PickResult {
  const seen = new Set(current.map((item) => item.key))
  const accepted: PickedFile[] = []
  const problems: string[] = []
  let duplicates = 0
  let dropped = 0
  for (const file of picked) {
    const problem = pickedFileProblem(file)
    if (problem) {
      problems.push(problem)
      continue
    }
    const key = pickedFileKey(file)
    if (seen.has(key)) {
      duplicates += 1
      continue
    }
    if (current.length + accepted.length >= limit) {
      dropped += 1
      continue
    }
    seen.add(key)
    accepted.push(file)
  }
  if (duplicates > 0) problems.push(`${duplicates} dosya zaten ekli olduğu için atlandı.`)
  if (dropped > 0)
    problems.push(`En fazla ${limit} dosya ekleyebilirsin; ${dropped} dosya eklenmedi.`)
  return { accepted, problems }
}

// --- Gönderilebilir mi -------------------------------------------------------------------

export type SubmitCheck = { ok: true; body: SubmitHomeworkBody } | { ok: false; message: string }

/**
 * Teslim düğmesinin kararı. Core `submitHomework` gibi açıklama ya da dosyadan en az biri ister
 * (DOM-AKD-072); dosya zorunlu değildir. Yükleme sürerken, yarım kalmış dosya varken ya da
 * güvenlik taraması bitmemişken gönderilmez, böylece yarıda kalan yükleme teslim oluşturmaz.
 * `scan` dosya kimliğine göre tarama durumudur.
 */
export function checkSubmission(input: {
  note: string
  items: readonly SubmissionItem[]
  scan: ReadonlyMap<string, FileProcessing>
}): SubmitCheck {
  const { items, scan } = input
  if (input.note.trim().length > SUBMISSION_NOTE_MAX_LENGTH)
    return {
      ok: false,
      message: `Açıklama en fazla ${SUBMISSION_NOTE_MAX_LENGTH} karakter olabilir.`,
    }
  if (items.some((item) => item.state === 'queued' || item.state === 'uploading'))
    return { ok: false, message: 'Dosyalar yükleniyor; bitince teslim edebilirsin.' }
  if (items.some((item) => item.state === 'failed'))
    return {
      ok: false,
      message: 'Yüklenemeyen dosya var. Yeniden dene ya da dosyayı kaldır.',
    }
  const ready = items.filter((item) => item.state === 'done' && item.fileId !== null)
  if (ready.length === 0 && input.note.trim().length === 0)
    return { ok: false, message: 'Teslim için açıklama yaz ya da dosya ekle.' }
  if (
    ready.some((item) => item.fileId !== null && fileBlocksAttach(scan.get(item.fileId) ?? 'ready'))
  )
    return {
      ok: false,
      message: 'Dosyalar güvenlik taramasında ya da kabul edilmedi. Taranınca teslim edebilirsin.',
    }
  return {
    ok: true,
    body: submitHomeworkBody({
      note: input.note,
      fileIds: ready.flatMap((item) => (item.fileId === null ? [] : [item.fileId])),
    }),
  }
}

// --- Hata eşleme -------------------------------------------------------------------------

const SUBMIT_FALLBACK = 'Teslim gönderilemedi. Bağlantını kontrol edip yeniden dene.'
const UPLOAD_FALLBACK = 'Dosya yüklenemedi. Bağlantını kontrol edip yeniden dene.'
const SESSION_ENDED = 'Oturumun sona erdi. Yeniden giriş yapıp tekrar dene.'

/**
 * Teslim hatasının sayfa içi Türkçe metni (kod → `HOMEWORK_MESSAGES`, yoksa sunucunun Türkçe
 * iletisi). Oturum bitince (401) giriş katmanı yönlendirir; yine de metin boş kalmaz.
 */
export function submissionFailureText(error: ApiError): string {
  if (error.status === 401) return SESSION_ENDED
  return commandFeedback(error, HOMEWORK_MESSAGES).message?.trim() || SUBMIT_FALLBACK
}

const TOO_LARGE = 'Dosya çok büyük. En fazla 20 MB olabilir.'
const UPLOAD_MESSAGES = {
  file_too_large: TOO_LARGE,
  file_type_not_allowed: 'Bu dosya türü kabul edilmez. PDF, Word ya da görsel seç.',
} as const

/** Dosya yükleme hatasının metni; teknik ayrıntı gösterilmez. */
export function uploadFailureText(error: ApiError): string {
  if (error.status === 401) return SESSION_ENDED
  if (error.status === 413) return TOO_LARGE
  if (error.status === 429) return 'Çok fazla deneme yapıldı. Biraz bekleyip yeniden dene.'
  return commandFeedback(error, UPLOAD_MESSAGES).message?.trim() || UPLOAD_FALLBACK
}

/** Belirsiz hata (ağ, 5xx): yükleme aynı dosyayla yeniden denenebilir. */
export const uploadIsRetryable = (error: ApiError) => keepsIdempotencyKey(error)
