import type { FastifyError, FastifyInstance } from 'fastify'
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod'

import { AppError, codeForStatus, MESSAGES, type ErrorResponse, type Issue } from '../errors.ts'

function issuePath(instancePath: string): string[] {
  return instancePath.split('/').filter(Boolean)
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
      if (error.statusCode >= 500) request.log.error({ err: error }, 'request failed')
      return reply.status(error.statusCode).send(body)
    }
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500
    if (status >= 400 && status < 500) {
      const code = codeForStatus(status)
      if (status === 429) request.log.warn({ event: 'request.rate_limited' })
      const body: ErrorResponse = { code, message: MESSAGES[code], requestId }
      return reply.status(status).send(body)
    }
    request.log.error({ err: error }, 'unexpected error')
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
