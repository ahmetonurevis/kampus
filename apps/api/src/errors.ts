import { z } from 'zod'

/** Tek hata zarfı (docs/muhendislik/api-tasarimi.md §4). `message` Türkçe, `code` snake_case. */
export const issueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  code: z.string(),
  message: z.string(),
})
export type Issue = z.infer<typeof issueSchema>

export const errorResponseSchema = z
  .object({
    code: z.string().describe('Kararlı, İngilizce, snake_case hata kodu'),
    message: z.string().describe('Kullanıcıya gösterilebilir Türkçe mesaj'),
    issues: z.array(issueSchema).optional(),
    requestId: z.string(),
  })
  .meta({ id: 'ErrorResponse' })
export type ErrorResponse = z.infer<typeof errorResponseSchema>

export const MESSAGES = {
  validation_failed: 'Formda düzeltilmesi gereken alanlar var.',
  bad_request: 'İstek okunamadı. Bilgileri kontrol edip yeniden deneyin.',
  unauthenticated: 'Oturum açmanız gerekiyor.',
  forbidden: 'Bu işlem için yetkiniz yok.',
  no_active_institution: 'Etkin bir kurum üyeliğiniz bulunmuyor.',
  csrf_rejected: 'İstek güvenilmeyen bir kaynaktan geldi.',
  not_found: 'İstenen kayıt bulunamadı.',
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Sayfayı yenileyip yeniden deneyin.',
  record_too_large: 'Kayıt izin verilen boyutu aşıyor.',
  payload_too_large: 'Gönderilen veri çok büyük.',
  unsupported_media_type: 'İstek biçimi desteklenmiyor.',
  rate_limited: 'Çok fazla istek gönderildi. Lütfen biraz sonra yeniden deneyin.',
  unavailable: 'Hizmet şu anda kullanılamıyor. Lütfen biraz sonra yeniden deneyin.',
  internal_error: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.',
} as const
export type ErrorCode = keyof typeof MESSAGES

export class AppError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly issues: Issue[] | undefined

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { issues?: Issue[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.issues = options.issues
  }
}

export class ValidationError extends AppError {
  constructor(issues: Issue[]) {
    super(400, 'validation_failed', MESSAGES.validation_failed, { issues })
    this.name = 'ValidationError'
  }
}

export class AuthenticationError extends AppError {
  constructor() {
    super(401, 'unauthenticated', MESSAGES.unauthenticated)
    this.name = 'AuthenticationError'
  }
}

export class ForbiddenError extends AppError {
  constructor(code: 'forbidden' | 'no_active_institution' | 'csrf_rejected' = 'forbidden') {
    super(403, code, MESSAGES[code])
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends AppError {
  constructor() {
    super(404, 'not_found', MESSAGES.not_found)
    this.name = 'NotFoundError'
  }
}

/** 409: iyimser kilit (`version`) tutmadı; istemci kaydı yeniden yükler. */
export class ConflictError extends AppError {
  constructor(options: { cause?: unknown } = {}) {
    super(409, 'version_conflict', MESSAGES.version_conflict, options)
    this.name = 'ConflictError'
  }
}

/** 422: biçim doğru, iş kuralı reddetti. `message` school-core'un Türkçe mesajıdır. */
export class RuleViolationError extends AppError {
  constructor(code: string, message: string, options: { issues?: Issue[]; cause?: unknown } = {}) {
    super(422, code, message, options)
    this.name = 'RuleViolationError'
  }
}

export class UnavailableError extends AppError {
  constructor(options: { cause?: unknown } = {}) {
    super(503, 'unavailable', MESSAGES.unavailable, options)
    this.name = 'UnavailableError'
  }
}

/** Veritabanı hatasının SQLSTATE'i ve kısıt adı; Drizzle sürücü hatasını `cause`'a sarar. */
export function databaseErrorInfo(error: unknown): { code: string; constraint?: string } | null {
  let current: unknown = error
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    const code: unknown = Reflect.get(current, 'code')
    // SQLSTATE beş karakterdir (ör. 23514, 40P01); Node hata kodları (ERR_…) elenir.
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      const constraint: unknown = Reflect.get(current, 'constraint')
      return typeof constraint === 'string' ? { code, constraint } : { code }
    }
    current = Reflect.get(current, 'cause')
  }
  return null
}

/**
 * Kullanıcıya anlamlı veritabanı hatalarını uygulama hatasına çevirir; ötekiler aynen döner
 * (500, ayrıntı yalnız logda). `records_data_size_check`: jsonb'nin ikili boyutu JSON metninden
 * büyük olabildiği için uygulamanın metin denetimi geçse de kısıt reddedebilir.
 */
export function mapDatabaseError(error: unknown): Error {
  if (error instanceof AppError) return error
  const info = databaseErrorInfo(error)
  if (info?.code === '23514' && info.constraint === 'records_data_size_check')
    return new RuleViolationError('record_too_large', MESSAGES.record_too_large, { cause: error })
  if (error instanceof Error) return error
  return new AppError(500, 'internal_error', MESSAGES.internal_error, { cause: error })
}

/** Veritabanı işinin hatasını `mapDatabaseError` ile çevirir. */
export async function withDatabaseErrors<T>(work: Promise<T>): Promise<T> {
  try {
    return await work
  } catch (error) {
    throw mapDatabaseError(error)
  }
}

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  400: 'bad_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
  503: 'unavailable',
}

/** Çatıdan gelen (Fastify, eklenti) 4xx hatalarının genel kodu. */
export function codeForStatus(status: number): ErrorCode {
  return STATUS_CODES[status] ?? (status >= 500 ? 'internal_error' : 'bad_request')
}
