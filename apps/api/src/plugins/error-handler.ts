import type { FastifyError, FastifyInstance } from 'fastify'
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod'

import {
  AppError,
  codeForStatus,
  MESSAGES,
  UnclassifiedUniqueViolationError,
  type ErrorResponse,
  type Issue,
} from '../errors.ts'

function issuePath(instancePath: string): string[] {
  return instancePath.split('/').filter(Boolean)
}

interface LoggedError {
  type: string
  code?: string
  stack?: string
  cause?: LoggedError
}

function stringProperty(value: object, key: string): string | undefined {
  const property: unknown = Reflect.get(value, key)
  return typeof property === 'string' || typeof property === 'number' ? String(property) : undefined
}

/**
 * Hata loga mesajsız yazılır: Drizzle `Failed query: … params: …` mesajı sorgu parametrelerini
 * (e-posta vb.), pg `detail` alanı benzersizlik çakışmasındaki değeri taşır. Kalan: hata adı, kodu
 * (pg SQLSTATE dahil), mesaj satırı çıkarılmış yığın ve aynı biçimde `cause` zinciri.
 */
export function loggableError(error: unknown, depth = 0): LoggedError {
  if (typeof error !== 'object' || error === null) return { type: typeof error }
  const type = error instanceof Error ? error.name : (error.constructor?.name ?? 'Object')
  const logged: LoggedError = { type }
  const code = stringProperty(error, 'code')
  if (code !== undefined) logged.code = code
  if (error instanceof Error && typeof error.stack === 'string') {
    // Yığının ilk satırları `Ad: mesaj`tır (mesaj çok satırlı olabilir); yalnız çerçeveler kalır.
    const frames = error.stack.split('\n').filter((line) => /^\s+at /.test(line))
    if (frames.length > 0) logged.stack = frames.join('\n')
  }
  const cause: unknown = error instanceof Error ? error.cause : undefined
  if (cause !== undefined && depth < 3) logged.cause = loggableError(cause, depth + 1)
  return logged
}

/** Bütün hataları tek zarfa çevirir; 5xx ayrıntısı yalnız logda kalır. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const requestId = request.id
    if (hasZodFastifySchemaValidationErrors(error)) {
      const issues: Issue[] = error.validation.map((item) => ({
        path: issuePath(item.instancePath),
        code: item.keyword,
        message: item.message ?? MESSAGES.validation_failed,
      }))
      // Değerler değil yalnız alan yolları loglanır.
      request.log.info({ event: 'request.validation_failed', paths: issues.map((i) => i.path) })
      const body: ErrorResponse = {
        code: 'validation_failed',
        message: MESSAGES.validation_failed,
        issues,
        requestId,
      }
      return reply.status(400).send(body)
    }
    if (error instanceof AppError) {
      const body: ErrorResponse = { code: error.code, message: error.message, requestId }
      if (error.issues) body.issues = error.issues
      if (error.statusCode >= 500)
        request.log.error({ err: loggableError(error) }, 'request failed')
      // Sınıflanmamış tekillik kısıtı: yalnız kısıt adı (değer ve kişisel veri yok; OG-279).
      if (error instanceof UnclassifiedUniqueViolationError)
        request.log.warn({
          event: 'db.unclassified_unique_violation',
          constraint: error.constraint,
        })
      return reply.status(error.statusCode).send(body)
    }
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500
    if (status >= 400 && status < 500) {
      const code = codeForStatus(status)
      if (status === 429) request.log.warn({ event: 'request.rate_limited' })
      const body: ErrorResponse = { code, message: MESSAGES[code], requestId }
      return reply.status(status).send(body)
    }
    request.log.error({ err: loggableError(error) }, 'unexpected error')
    const body: ErrorResponse = {
      code: 'internal_error',
      message: MESSAGES.internal_error,
      requestId,
    }
    return reply.status(500).send(body)
  })

  app.setNotFoundHandler((request, reply) => {
    const body: ErrorResponse = {
      code: 'not_found',
      message: MESSAGES.not_found,
      requestId: request.id,
    }
    return reply.status(404).send(body)
  })
}
