import type { components } from './schema.d.ts'

/** Sunucu hata zarfındaki doğrulama maddesi (`issues[]`). */
export type ApiIssue = NonNullable<components['schemas']['ErrorResponse']['issues']>[number]

/** Ağ hatasında ve zarf olmayan yanıtlarda kullanılan, sunucunun üretmediği kodlar. */
export const CLIENT_ERROR_CODES = {
  network: 'network_error',
  unexpectedResponse: 'unexpected_response',
} as const

const NETWORK_MESSAGE = 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip yeniden deneyin.'
const UNEXPECTED_MESSAGE = 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.'

export interface ApiErrorInit {
  status: number
  code: string
  message: string
  issues?: readonly ApiIssue[] | undefined
  requestId?: string | undefined
  cause?: unknown
}

/**
 * Sunucu hata zarfının (`{ code, message, issues?, requestId }`) istemcideki karşılığı.
 * `message` Türkçe ve kullanıcıya gösterilebilir; teknik ayrıntı taşımaz. Ağ hatasında
 * `status` 0, `code` `network_error`'dır.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly issues: readonly ApiIssue[]
  readonly requestId: string | undefined

  constructor(init: ApiErrorInit) {
    super(init.message, { cause: init.cause })
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code
    this.issues = init.issues ?? []
    this.requestId = init.requestId
  }

  get isUnauthenticated(): boolean {
    return this.status === 401
  }

  get isNetworkError(): boolean {
    return this.code === CLIENT_ERROR_CODES.network
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

function isIssue(value: unknown): value is ApiIssue {
  if (typeof value !== 'object' || value === null) return false
  const { path, code, message } = value as Record<string, unknown>
  return (
    Array.isArray(path) &&
    path.every((part) => typeof part === 'string' || typeof part === 'number') &&
    typeof code === 'string' &&
    typeof message === 'string'
  )
}

/** Yanıt gövdesi hata zarfıysa `ApiError`'a çevirir; değilse genel hata üretir. */
export function apiErrorFromResponse(
  status: number,
  body: unknown,
  headerRequestId?: string | null,
): ApiError {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const { code, message, issues, requestId } = record
  if (typeof code === 'string' && typeof message === 'string') {
    return new ApiError({
      status,
      code,
      message,
      issues: Array.isArray(issues) ? issues.filter(isIssue) : undefined,
      requestId: typeof requestId === 'string' ? requestId : (headerRequestId ?? undefined),
    })
  }
  // Ters vekil/ağ geçidi HTML'i gibi zarf olmayan gövdeler: ayrıntı kullanıcıya gösterilmez.
  return new ApiError({
    status,
    code: CLIENT_ERROR_CODES.unexpectedResponse,
    message: UNEXPECTED_MESSAGE,
    requestId: headerRequestId ?? undefined,
  })
}

export function networkApiError(cause: unknown): ApiError {
  return new ApiError({
    status: 0,
    code: CLIENT_ERROR_CODES.network,
    message: NETWORK_MESSAGE,
    cause,
  })
}

/** Form alanına aktarılabilir tek doğrulama hatası (react-hook-form `setError` biçimi). */
export interface FieldIssue {
  /** Noktalı yol (`items.0.amount`); yol yoksa `root.server`. */
  name: string
  type: string
  message: string
}

export const ROOT_FIELD = 'root.server'

/** `ApiError.issues`'i noktalı alan yollarına çevirir; yolsuz madde `root.server` olur. */
export function issuesToFieldIssues(issues: readonly ApiIssue[]): FieldIssue[] {
  return issues.map((issue) => ({
    name: issue.path.length > 0 ? issue.path.join('.') : ROOT_FIELD,
    type: issue.code,
    message: issue.message,
  }))
}

/**
 * Hatadaki doğrulama maddelerini formun `setError` işlevine verir. Doğrulama maddesi yoksa
 * ve hata `ApiError` ise mesajı `root.server` alanına yazar (form düzeyi hata). Hiçbir şey
 * aktarılamadıysa `false` döner; çağıran toast gösterir.
 */
export function applyApiErrorToForm<TName extends string>(
  error: unknown,
  setError: (name: TName, error: { type: string; message: string }) => void,
): boolean {
  if (!isApiError(error)) return false
  const fieldIssues: FieldIssue[] =
    error.issues.length > 0
      ? issuesToFieldIssues(error.issues)
      : [{ name: ROOT_FIELD, type: error.code, message: error.message }]
  for (const { name, type, message } of fieldIssues) {
    // Sunucu yolu formun alan adıdır; tanınmayan yol react-hook-form'da yalnız boşta bir hata olur.
    setError(name as TName, { type, message })
  }
  return true
}
