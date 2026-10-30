import type { QueryClient } from '@tanstack/react-query'

import {
  CLIENT_ERROR_CODES,
  isApiError,
  issuesToFieldIssues,
  ROOT_FIELD,
  toApiError,
  type ApiError,
  type FieldIssue,
} from '@kampus/api-client/errors.ts'

import { institutionKey } from './query-keys.ts'

/**
 * Yazma komutlarının (`POST /invoices/:id/pay` gibi) saf mantığı: `Idempotency-Key` yaşam
 * döngüsü, `If-Match` başlığı, çift gönderim kilidi ve hata geri bildirimi. Hook
 * `use-api-command.ts`'tedir; burası React olmadan test edilir (api-tasarimi.md §7).
 */

/** openapi-fetch `params.header` biçimi (OpenAPI şemasında başlık adları küçük harflidir). */
export interface CommandHeaders {
  'idempotency-key': string
  'if-match'?: string
}

/**
 * Yeni istek anahtarı. `crypto.randomUUID` yalnız güvenli bağlamda (HTTPS, localhost) vardır;
 * düz HTTP'deki yerel ağ adresinde aynı güçte `getRandomValues` kullanılır.
 */
export function newIdempotencyKey(): string {
  const crypto = globalThis.crypto
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  if (typeof crypto?.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  throw new Error('Güvenli rastgele sayı üreteci bulunamadı.')
}

/** Anahtar sırasından bağımsız JSON özeti: aynı gövde aynı denemeyi gösterir. */
export function stableFingerprint(value: unknown): string {
  return (
    JSON.stringify(value, (_key, item: unknown) =>
      item !== null && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(
            Object.entries(item).sort(([left], [right]) => (left < right ? -1 : 1)),
          )
        : item,
    ) ?? ''
  )
}

/**
 * Sonucu belirsiz kalan hata: istek sunucuda işlenmiş olabilir (ağ koptu, 5xx, aynı anahtar hâlâ
 * işleniyor). Yeniden gönderim aynı anahtarı taşımalıdır; sunucu işlenmişse ilk yanıtı tekrarlar.
 */
export function keepsIdempotencyKey(error: unknown): boolean {
  if (!isApiError(error)) return false
  return (
    error.code === CLIENT_ERROR_CODES.network ||
    error.status >= 500 ||
    error.code === 'idempotency_in_progress'
  )
}

export interface IdempotencyTracker {
  /** Denemenin anahtarı: önceki deneme belirsiz bittiyse ve gövde aynıysa aynı anahtar döner. */
  keyFor: (fingerprint: string) => string
  /** Başarı: sonraki gönderim yeni kullanıcı eylemidir. */
  succeed: () => void
  /** Kesin hatada anahtar bırakılır; belirsiz hatada (ağ, 5xx) yeniden gönderim için saklanır. */
  fail: (error: unknown) => void
}

export function createIdempotencyTracker(generate = newIdempotencyKey): IdempotencyTracker {
  let pending: { key: string; fingerprint: string } | null = null
  return {
    keyFor(fingerprint) {
      // Kullanıcı gövdeyi değiştirdiyse yeni işlemdir; eski anahtar 422 `idempotency_key_reused` verir.
      if (pending?.fingerprint !== fingerprint) pending = { key: generate(), fingerprint }
      return pending.key
    },
    succeed() {
      pending = null
    },
    fail(error) {
      if (!keepsIdempotencyKey(error)) pending = null
    },
  }
}

/** Sunucu `"4"`, `4` ve `W/"4"` biçimlerini kabul eder; güçlü ETag biçimi gönderilir. */
export function commandHeaders(key: string, version?: number | null): CommandHeaders {
  return version == null
    ? { 'idempotency-key': key }
    : { 'idempotency-key': key, 'if-match': `"${version}"` }
}

/** Kod → kullanıcı mesajı; verilmeyen kodda sunucunun Türkçe mesajı kullanılır. */
export type CommandMessages = Readonly<Partial<Record<string, string>>>

export interface CommandFeedback {
  /**
   * Form alanlarına kendiliğinden yazılacak doğrulama maddeleri (yolsuz madde yok). Yalnız 400
   * `validation_failed` içindir; iş kuralı hatasının (422/409/403) `issues` yolu kendiliğinden
   * alana yazılmaz (aynı mesaj alanda ve toast'ta çifte görünürdü): formun açık tercihi olarak
   * `routeCommandErrors`'un `fieldFor`'u (ör. `errorRoutes(…, true)`) alana bağlar.
   */
  fieldIssues: FieldIssue[]
  /** Toast metni; 401'de `null` (oturum katmanı girişe yönlendirir). */
  message: string | null
  /** Ekrandaki veri eski: ilgili sorgular tazelenmeli (409 çakışma). */
  refresh: boolean
}

export function commandFeedback(error: ApiError, messages: CommandMessages = {}): CommandFeedback {
  return {
    fieldIssues:
      error.status === 400
        ? issuesToFieldIssues(error.issues).filter((issue) => issue.name !== ROOT_FIELD)
        : [],
    message: error.status === 401 ? null : (messages[error.code] ?? error.message),
    // `idempotency_in_progress` veri eskimesi değildir; aynı istek hâlâ işleniyordur.
    refresh: error.status === 409 && error.code !== 'idempotency_in_progress',
  }
}

export type SetFieldError = (name: string, error: { type: string; message: string }) => void

export interface CommandErrorTargets {
  /** react-hook-form `form.setError`; alan maddeleri buraya yazılır. */
  setError?: SetFieldError | undefined
  /** Kullanıcı bildirimi (web'de sonner toast). Yoksa mesaj formun `root.server` alanına yazılır. */
  notifyError?: ((message: string, error: ApiError) => void) | undefined
}

export function reportCommandError(
  error: ApiError,
  feedback: CommandFeedback,
  { setError, notifyError }: CommandErrorTargets,
): void {
  for (const { name, type, message } of feedback.fieldIssues) setError?.(name, { type, message })
  if (feedback.message === null) return
  if (notifyError) notifyError(feedback.message, error)
  else setError?.(ROOT_FIELD, { type: error.code, message: feedback.message })
}

/** Formun kendi göstereceği hatalar: toast yerine alan altı ya da form içi bildirim. */
export interface InlineErrorRoutes {
  /** Hatanın (kod ya da yol) bağlandığı form alanı; bağlıysa mesaj yalnız o alanın altında görünür. */
  fieldFor?: ((error: ApiError) => string | undefined) | undefined
  /** Formun kendi bildirdiği hata (ör. sürüm çakışması uyarısı): toast gösterilmez. */
  silent?: ((error: ApiError) => boolean) | undefined
}

/**
 * Hata tek yerde görünür: alana bağlanan kod yalnız alan altında, formun kendi bildirdiği hata
 * yalnız formda, diğerleri yalnız toast'ta (ikisi birden gösterilmez).
 */
export function routeCommandErrors(
  { setError, notifyError }: CommandErrorTargets,
  { fieldFor, silent }: InlineErrorRoutes,
): CommandErrorTargets {
  // Bildirim yoksa mesaj zaten `root.server` alanına (formun içine) yazılır.
  if (!notifyError) return { setError, notifyError }
  return {
    setError,
    notifyError: (message, error) => {
      const field = fieldFor?.(error)
      if (field !== undefined && setError) setError(field, { type: error.code, message })
      else if (silent?.(error)) return
      else notifyError?.(message, error)
    },
  }
}

/** Etkin kurumun verilen önekli sorgularını geçersiz kılar (yazma sonrası liste ve detay). */
export async function invalidateInstitutionQueries(
  queryClient: QueryClient,
  institutionId: string | null,
  prefixes: readonly (readonly unknown[])[],
): Promise<void> {
  await Promise.all(
    prefixes.map((prefix) =>
      queryClient.invalidateQueries({ queryKey: institutionKey(institutionId, ...prefix) }),
    ),
  )
}

export type CommandOutcome<TData> =
  | { status: 'success'; data: TData }
  | { status: 'failed'; error: ApiError }
  /** Önceki gönderim sürüyor; ikinci istek atılmadı (çift tıklama, Enter + tıklama). */
  | { status: 'busy' }

/** Bileşen ömrü boyunca yaşayan durum: gönderim kilidi ve anahtar izleyici. */
export interface CommandSession {
  locked: boolean
  tracker: IdempotencyTracker
}

export function createCommandSession(generate = newIdempotencyKey): CommandSession {
  return { locked: false, tracker: createIdempotencyTracker(generate) }
}

export interface CommandSteps<TVariables, TData> {
  /** İsteği başlıklarla gönderir (mutasyon). Başarı sonrası geçersiz kılma bunun içindedir. */
  execute: (variables: TVariables, headers: CommandHeaders) => Promise<TData>
  /** Konu kaydın okunan sürümü (`If-Match`); verilmezse başlık gönderilmez. */
  version?: ((variables: TVariables) => number | null | undefined) | undefined
  /** Çakışmada ilgili sorguları tazeler. */
  refresh: () => Promise<void>
  messages?: CommandMessages | undefined
  /**
   * Alana bağlanan hata yalnız alanın altında gösterilir, toast çıkmaz; alan yolu olmayan hata
   * (ve alan hatasını yazacak form verilmemişse her hata) toast olur. İçerik havuzu formları.
   */
  exclusive?: boolean | undefined
}

/**
 * Hatanın nereye gösterileceği: `exclusive` ise alan maddesi varken toast bastırılır.
 */
export function routeFeedback(
  feedback: CommandFeedback,
  { exclusive, hasForm }: { exclusive: boolean; hasForm: boolean },
): CommandFeedback {
  return exclusive && hasForm && feedback.fieldIssues.length > 0
    ? { ...feedback, message: null }
    : feedback
}

/**
 * Tek kullanıcı eylemi: kilit → anahtar → istek → sonuç. Kilit eşzamanlıdır (render beklemez);
 * böylece düğme kilitlenmeden gelen ikinci tıklama da istek atmaz. Hata fırlatılmaz, sonuç döner.
 */
export async function runCommand<TVariables, TData>(
  session: CommandSession,
  steps: CommandSteps<TVariables, TData>,
  variables: TVariables,
  targets: CommandErrorTargets = {},
): Promise<CommandOutcome<TData>> {
  if (session.locked) return { status: 'busy' }
  session.locked = true
  try {
    const key = session.tracker.keyFor(stableFingerprint(variables))
    const data = await steps.execute(variables, commandHeaders(key, steps.version?.(variables)))
    session.tracker.succeed()
    return { status: 'success', data }
  } catch (cause) {
    const error = toApiError(cause)
    session.tracker.fail(error)
    const feedback = routeFeedback(commandFeedback(error, steps.messages), {
      exclusive: steps.exclusive ?? false,
      hasForm: targets.setError !== undefined,
    })
    if (feedback.refresh) await steps.refresh()
    reportCommandError(error, feedback, targets)
    return { status: 'failed', error }
  } finally {
    session.locked = false
  }
}
